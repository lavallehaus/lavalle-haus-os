import { createHmac } from "node:crypto";
// api/amazon-sync.js
// LAVALLE HAUS OS — Amazon SP-API sync: live FBA inventory, inbound quantities,
// and per-SKU units sold over the trailing 30 days.
// GET            -> { connected }  (env credentials present?)
// GET ?debug=1   -> live test: first page of FBA inventory summaries, raw
// POST           -> { connected, syncedAt, items: [{ productId, sku, fba,
//                     inbound }], sold: [{ productId, qty }], unmatchedSkus }
//
// Env (Vercel): AMZ_LWA_CLIENT_ID, AMZ_LWA_CLIENT_SECRET, AMZ_REFRESH_TOKEN
// No AWS IAM keys required (SP-API dropped SigV4 in 2023).

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const LWA_ID = process.env.AMZ_LWA_CLIENT_ID;
const LWA_SECRET = process.env.AMZ_LWA_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.AMZ_REFRESH_TOKEN;

import { gunzipSync, createGunzip } from "node:zlib";

export const maxDuration = 60; // headroom for the per-order item loop

const SPAPI = "https://sellingpartnerapi-na.amazon.com";
const MARKETPLACE = "ATVPDKIKX0DER"; // amazon.com (US)

// Seller SKU (lowercased) -> app product ID. Confirmed against live FBA
// inventory 2026-06-12. Sand pools by SIZE: AC (Apple Cider) and SC (Vanilla
// Cashmere) scent families both flow into the 16oz / 32oz cards.
const SKU_MAP = {
  "rh-seashell-9633": 1, // SeaShell Vessel Candle
  "rh-sandwax-ac-16oz": 2, // Apple Cider sand 16oz
  "rh-beeswax-sc-16oz": 2, // Vanilla Cashmere sand 16oz
  "rh-sandwax-ac-32oz": 3, // Apple Cider sand 32oz (2-pack of 16oz)
  "rh-beeswax-sc-32oz": 3, // Vanilla Cashmere sand 32oz (2-pack of 16oz)
  "rh-candle-sm-appl": 4, // Mini Spiced Apple Botanical Candle
  "rh-candle-lg-apple": 5, // Large Spiced Apple Botanical Candle
  "rh-scrub-8tin-fba": 8, // Sugar Scrub (upcoming Amazon launch listing)
};

async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${key}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  const d = await r.json();
  if (!d || d.result == null) return null;
  try { return JSON.parse(d.result); } catch { return null; }
}

async function kvSet(key, value) {
  await fetch(`${KV_URL}/set/${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(value),
  });
}

// LWA access token, cached in Redis until ~5 minutes before expiry.
async function getAccessToken() {
  const cached = await kvGet("amazon_lwa");
  if (cached && cached.token && cached.exp && Date.now() < cached.exp - 300000) {
    return cached.token;
  }
  const r = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
      client_id: LWA_ID,
      client_secret: LWA_SECRET,
    }),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) {
    throw new Error(`LWA token exchange failed (${r.status}): ${JSON.stringify(d).slice(0, 200)}`);
  }
  await kvSet("amazon_lwa", { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 });
  return d.access_token;
}

async function spapi(token, path) {
  const r = await fetch(`${SPAPI}${path}`, {
    headers: { "x-amz-access-token": token, "Content-Type": "application/json" },
  });
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); } catch { d = { raw: text.slice(0, 200) }; }
  if (!r.ok) throw new Error(`SP-API ${r.status} on ${path.split("?")[0]}: ${text.slice(0, 200)}`);
  return d;
}

async function spapiW(token, path, method, body) {
  const r = await fetch(`${SPAPI}${path}`, {
    method,
    headers: { "x-amz-access-token": token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); } catch { d = { raw: text.slice(0, 300) }; }
  if (!r.ok) throw new Error(`SP-API ${r.status} on ${path.split("?")[0]}: ${text.slice(0, 350)}`);
  return d;
}

const SELLER_ID = process.env.AMZ_SELLER_ID || "";

// All FBA inventory summaries (paginated).
async function fetchFbaInventory(token) {
  let path = `/fba/inventory/v1/summaries?details=true&granularityType=Marketplace&granularityId=${MARKETPLACE}&marketplaceIds=${MARKETPLACE}`;
  let all = [];
  for (let i = 0; i < 10; i++) {
    const d = await spapi(token, path);
    const page = (d.payload && d.payload.inventorySummaries) || [];
    all = all.concat(page);
    const next = d.pagination && d.pagination.nextToken;
    if (!next) break;
    path = `/fba/inventory/v1/summaries?details=true&granularityType=Marketplace&granularityId=${MARKETPLACE}&marketplaceIds=${MARKETPLACE}&nextToken=${encodeURIComponent(next)}`;
  }
  return all;
}

// Units sold in the trailing 30 days for one SKU (Sales API).
async function fetchSold30ForSku(token, sku) {
  const end = new Date();
  const start = new Date(Date.now() - 30 * 86400000);
  const interval = `${start.toISOString().slice(0, 19)}Z--${end.toISOString().slice(0, 19)}Z`;
  const path = `/sales/v1/orderMetrics?marketplaceIds=${MARKETPLACE}&interval=${encodeURIComponent(interval)}&granularity=Total&sku=${encodeURIComponent(sku)}`;
  const d = await spapi(token, path);
  const rows = d.payload || [];
  return rows.reduce((s, row) => s + (Number(row.unitCount) || 0), 0);
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// --- Brand Analytics report helpers (keyword research) ---
function baPeriod(period, offset) {
  const off = Number(offset) || 0;
  const now = new Date();
  if (period === "MONTH") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - off, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - off, 0)); // last day of that month
    return { start: start.toISOString(), end: end.toISOString() };
  }
  // WEEK: most recent complete Sunday–Saturday week, shifted back `off` weeks
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay(); // 0=Sun
  const daysSinceSat = dow === 6 ? 7 : dow + 1;
  const lastSat = new Date(d); lastSat.setUTCDate(d.getUTCDate() - daysSinceSat - off * 7);
  const weekStart = new Date(lastSat); weekStart.setUTCDate(lastSat.getUTCDate() - 6);
  return { start: weekStart.toISOString(), end: lastSat.toISOString() };
}
async function downloadReportRecords(doc, max, predicate, maxBytes) {
  const cap = maxBytes || 3500000;
  const r = await fetch(doc.url);
  const buf = Buffer.from(await r.arrayBuffer());
  const text = doc.compressionAlgorithm === "GZIP"
    ? await gunzipCapped(buf, cap)
    : buf.toString("utf-8").slice(0, cap);
  return extractRecords(text, max, predicate);
}
// Decompress only up to maxBytes of output, then stop — keeps memory tiny for huge reports.
function gunzipCapped(buf, maxBytes) {
  return new Promise((resolve, reject) => {
    const gz = createGunzip();
    let out = "", stopped = false;
    gz.on("data", (chunk) => { if (stopped) return; out += chunk.toString("utf-8"); if (out.length >= maxBytes) { stopped = true; try { gz.destroy(); } catch (e) {} resolve(out); } });
    gz.on("end", () => { if (!stopped) resolve(out); });
    gz.on("error", (e) => { if (stopped) resolve(out); else reject(e); });
    gz.end(buf);
  });
}
// Pull up to `max` complete record objects from the first data array, scanning by brace depth.
// Works even if `text` is truncated mid-document.
function extractRecords(text, max, predicate) {
  let i = -1;
  const m = text.search(/"data[A-Za-z]*"\s*:\s*\[/);
  if (m >= 0) i = text.indexOf("[", m);
  if (i < 0) i = text.indexOf("[");
  if (i < 0) return [];
  const recs = [];
  const BS = String.fromCharCode(92);
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let p = i + 1; p < text.length && recs.length < max; p++) {
    const ch = text[p];
    if (inStr) { if (esc) esc = false; else if (ch === BS) esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) start = p; depth++; }
    else if (ch === "}") { depth--; if (depth === 0 && start >= 0) { try { const rec = JSON.parse(text.slice(start, p + 1)); if (!predicate || predicate(rec)) recs.push(rec); } catch (e) {} start = -1; } }
    else if (ch === "]" && depth === 0) break;
  }
  return recs;
}
function firstArray(obj) {
  if (Array.isArray(obj)) return obj;
  for (const k of Object.keys(obj || {})) if (Array.isArray(obj[k])) return obj[k];
  return [];
}
function n(v) { const x = Number(v); return isNaN(x) ? null : x; }
function parseSearchTerms(json) {
  const arr = json.dataByDepartmentAndSearchTerm || json.dataBySearchTerm || firstArray(json);
  return arr.slice(0, 800).map((r) => ({
    term: r.searchTerm || r.SearchTerm || "",
    rank: n(r.searchFrequencyRank != null ? r.searchFrequencyRank : r["Search Frequency Rank"]),
    dept: r.departmentName || r.DepartmentName || "",
    clickedAsin: r.clickedAsin || r["#1 Clicked ASIN"] || (r.clickedItemAsin1) || "",
    clickedTitle: r.clickedItemName || r["#1 Product Title"] || (r.clickedItemTitle1) || "",
    clickShare: n(r.clickShare != null ? r.clickShare : r["#1 Click Share"]),
    convShare: n(r.conversionShare != null ? r.conversionShare : r["#1 Conversion Share"]),
  })).filter((x) => x.term);
}
function parseSqp(json) {
  const arr = json.dataByAsin || json.dataByDepartmentAndSearchTerm || firstArray(json);
  return arr.slice(0, 250).map((r) => {
    const imp = r.impressionData || r.impressions || {};
    const clk = r.clickData || r.clicks || {};
    const cart = r.cartAddData || r.cartAdds || {};
    const buy = r.purchaseData || r.purchases || {};
    return {
      term: r.searchQuery || r.SearchQuery || r.searchTerm || "",
      impressions: n(imp.totalCount != null ? imp.totalCount : imp.count),
      clicks: n(clk.totalClickCount != null ? clk.totalClickCount : (clk.totalCount != null ? clk.totalCount : clk.count)),
      cartAdds: n(cart.totalCartAddCount != null ? cart.totalCartAddCount : (cart.totalCount != null ? cart.totalCount : cart.count)),
      purchases: n(buy.totalPurchaseCount != null ? buy.totalPurchaseCount : (buy.totalCount != null ? buy.totalCount : buy.count)),
      asin: r.asin || "",
    };
  }).filter((x) => x.term);
}


// ── APP LOCK ──────────────────────────────────────────────────────────────────
// When APP_PASSWORD is set in Vercel, every request must carry the session
// token in the x-app-token header. Until it is set, the lock stays off — so
// deploying this code before adding the env var can never lock anyone out.
const SESSION_SALT = "lavalle-haus-session-v1";
function appToken() {
  return createHmac("sha256", process.env.APP_PASSWORD || "").update(SESSION_SALT).digest("hex");
}
function isAuthed(req) {
  if (!process.env.APP_PASSWORD) return true;
  return (req.headers["x-app-token"] || "") === appToken();
}

export default async function handler(req, res) {
  if (!isAuthed(req)) { res.status(401).json({ error: "Locked" }); return; }
  const configured = Boolean(LWA_ID && LWA_SECRET && REFRESH_TOKEN);

  // --- POST listing/pricing ops, hoisted above the GET/POST split so they actually run.
  // (The GET block below still serves the read actions: listing skus/get, pricing getcomp/list.)
  if (req.method === "POST" && req.query && req.query.op === "createlisting") {
    if (!SELLER_ID) { res.status(400).json({ error: "AMZ_SELLER_ID is not set in Vercel." }); return; }
    try {
      const token = await getAccessToken();
      const b = req.body || {};
      const sku = b.sku, productType = b.productType, attributes = b.attributes || {};
      if (!sku || !productType) { res.status(400).json({ error: "Missing sku or productType" }); return; }
      const d = await spapiW(token, `/listings/2021-08-01/items/${encodeURIComponent(SELLER_ID)}/${encodeURIComponent(sku)}?marketplaceIds=${MARKETPLACE}`, "PUT", { productType, requirements: "LISTING", attributes });
      res.status(200).json({ connected: true, status: d.status, submissionId: d.submissionId, issues: (d.issues || []).map((i) => ({ code: i.code, message: i.message, severity: i.severity, attributeNames: i.attributeNames || [] })) });
    } catch (e) { res.status(500).json({ connected: true, error: String(e).slice(0, 500) }); }
    return;
  }
  if (req.method === "POST" && req.query && req.query.op === "listing" && req.query.action === "patch") {
    if (!SELLER_ID) { res.status(400).json({ error: "AMZ_SELLER_ID is not set in Vercel environment variables." }); return; }
    try {
      const token = await getAccessToken();
      const b = req.body || {};
      const sku = b.sku || "";
      const productType = b.productType;
      if (!sku || !productType) { res.status(400).json({ error: "Missing sku or productType" }); return; }
      const patches = [];
      const L = (value) => [{ value: String(value), marketplace_id: MARKETPLACE, language_tag: "en_US" }];
      if (typeof b.itemName === "string" && b.itemName.length) { patches.push({ op: "replace", path: "/attributes/item_name", value: L(b.itemName) }); }
      if (Array.isArray(b.bullets)) { patches.push({ op: "replace", path: "/attributes/bullet_point", value: b.bullets.filter((x) => x && x.trim()).map((x) => ({ value: x, marketplace_id: MARKETPLACE, language_tag: "en_US" })) }); }
      if (typeof b.description === "string" && b.description.length) { patches.push({ op: "replace", path: "/attributes/product_description", value: L(b.description) }); }
      if (b.price !== undefined && b.price !== null && b.price !== "" && !isNaN(Number(b.price))) { patches.push({ op: "replace", path: "/attributes/purchasable_offer", value: [{ marketplace_id: MARKETPLACE, currency: "USD", our_price: [{ schedule: [{ value_with_tax: Number(b.price) }] }] }] }); }
      if (!patches.length) { res.status(400).json({ error: "Nothing to update" }); return; }
      const d = await spapiW(token, `/listings/2021-08-01/items/${encodeURIComponent(SELLER_ID)}/${encodeURIComponent(sku)}?marketplaceIds=${MARKETPLACE}`, "PATCH", { productType, patches });
      res.status(200).json({ connected: true, status: d.status, submissionId: d.submissionId, issues: (d.issues || []).map((i) => ({ code: i.code, message: i.message, severity: i.severity })) });
    } catch (e) { res.status(500).json({ connected: true, error: String(e).slice(0, 400) }); }
    return;
  }
  if (req.method === "POST" && req.query && req.query.op === "pricing" && req.query.action === "setcomp") {
    await kvSet("competitor_watchlist", { list: (req.body && req.body.competitors) || [] });
    res.status(200).json({ ok: true });
    return;
  }
  if (req.method === "POST" && req.query && req.query.op === "keywords") {
    try {
      const token = await getAccessToken();
      const body = req.body || {};
      const kind = body.kind === "sqp" ? "sqp" : "searchterms";
      const period = body.period === "MONTH" ? "MONTH" : "WEEK";
      const asins = Array.isArray(body.asins) ? body.asins.filter(Boolean) : [];
      const weekOffset = Number(body.weekOffset) || 0;
      const historyOnly = !!body.historyOnly;
      const cacheKey = "keywords_" + kind;
      const inflKey = "kwinflight_" + kind + "_" + period + "_" + weekOffset;

      // Serve cached result by default for the live view. Only an explicit pull (refresh)
      // or an active poll (reportId) spends Amazon's strict report-request quota.
      if (!historyOnly && weekOffset === 0 && !body.refresh && !body.reportId) {
        const cached = await kvGet(cacheKey);
        const hist = (await kvGet("kwhistory")) || {};
        const mhist = (await kvGet("kwhist_month")) || {};
        if (cached && cached.rows) { res.status(200).json({ connected: true, ...cached, cached: true, history: hist, monthHistory: mhist }); return; }
        res.status(200).json({ connected: true, idle: true, history: hist, monthHistory: mhist }); return;
      }

      const { start, end } = baPeriod(period, weekOffset);
      const weekKey = start.slice(0, 10);

      // History backfill: if this week is already recorded, return it without spending quota.
      if (historyOnly && !body.refresh && !body.reportId) {
        if (period === "MONTH") {
          const mhist = (await kvGet("kwhist_month")) || {};
          if (mhist[weekKey.slice(0, 7)]) { res.status(200).json({ connected: true, ok: true, monthHistory: mhist, alreadyHave: true }); return; }
        } else {
          const hist = (await kvGet("kwhistory")) || {};
          if (hist[weekKey]) { res.status(200).json({ connected: true, ok: true, history: hist, alreadyHave: true }); return; }
        }
      }
      const reportType = kind === "sqp"
        ? "GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT"
        : "GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT";
      const reportOptions = { reportPeriod: period };
      if (kind === "sqp" && asins.length) reportOptions.asins = asins.join(" ");

      // Resolve a report id: an active poll id > a recent in-flight report > create a new one.
      let rid = body.reportId;
      if (!rid) {
        const infl = await kvGet(inflKey);
        if (infl && infl.reportId && Date.now() - (infl.at || 0) < 1800000) rid = infl.reportId;
      }
      if (!rid) {
        let created;
        try {
          created = await spapiW(token, "/reports/2021-06-30/reports", "POST", {
            reportType, marketplaceIds: [MARKETPLACE], dataStartTime: start, dataEndTime: end, reportOptions,
          });
        } catch (e) {
          const msg = String(e);
          if (msg.indexOf("429") >= 0 || msg.indexOf("QuotaExceeded") >= 0) {
            res.status(200).json({ connected: true, quota: true, error: "Amazon limits how often a Brand Analytics report can be requested. Wait about a minute, then pull once more — after it loads it’s cached, so you rarely need to pull again." });
            return;
          }
          throw e;
        }
        rid = created && created.reportId;
        if (!rid) { res.status(200).json({ connected: true, error: "Amazon rejected the report request" + (created && created.errors ? ": " + JSON.stringify(created.errors).slice(0, 300) : "."), debug: created }); return; }
        await kvSet(inflKey, { reportId: rid, at: Date.now() });
      }

      // Short poll (~10s) so each request returns well within the 60s function limit;
      // the client keeps polling with the reportId until the report is ready.
      const deadline = Date.now() + 10000;
      let docId = null, status = null;
      while (Date.now() < deadline) {
        const r = await spapi(token, "/reports/2021-06-30/reports/" + rid);
        status = r.processingStatus;
        if (status === "DONE") { docId = r.reportDocumentId; break; }
        if (status === "FATAL" || status === "CANCELLED") {
          await kvSet(inflKey, null);
          res.status(200).json({ connected: true, error: "Amazon could not produce this report (" + status + "). Likely the Brand Analytics role isn’t granted to the app, or there is no data for this period.", status });
          return;
        }
        await sleep(3000);
      }
      if (!docId) { res.status(200).json({ connected: true, pending: true, reportId: rid, kind, period }); return; }

      const doc = await spapi(token, "/reports/2021-06-30/documents/" + docId);
      const filterTerms = Array.isArray(body.filter) ? body.filter.map((x) => String(x).toLowerCase()).filter(Boolean) : [];
      let predicate = null, cap = 3500000;
      if (kind !== "sqp" && filterTerms.length) {
        predicate = (rec) => { const t = String(rec.searchTerm || "").toLowerCase(); return filterTerms.some((f) => t.indexOf(f) >= 0); };
        cap = 22000000; // keep only matches, so we can scan far deeper than the top terms
      }
      const records = await downloadReportRecords(doc, 1200, predicate, cap);
      const rows = kind === "sqp" ? parseSqp(records) : parseSearchTerms(records);

      // Maintain a rolling rank history (last 6 weeks) for trend sparklines.
      let history = (await kvGet("kwhistory")) || {};
      let monthHistory = (await kvGet("kwhist_month")) || {};
      if (kind === "searchterms") {
        const ranks = {};
        rows.forEach((r) => { if (r.term && r.rank != null) { const k = r.term.toLowerCase(); if (ranks[k] == null || r.rank < ranks[k]) ranks[k] = r.rank; } });
        if (period === "MONTH") {
          monthHistory[weekKey.slice(0, 7)] = ranks;
          const mks = Object.keys(monthHistory).sort();
          while (mks.length > 14) { delete monthHistory[mks.shift()]; }
          await kvSet("kwhist_month", monthHistory);
        } else {
          history[weekKey] = ranks;
          const wk = Object.keys(history).sort();
          while (wk.length > 6) { delete history[wk.shift()]; }
          await kvSet("kwhistory", history);
        }
      }

      if (historyOnly) { await kvSet(inflKey, null); res.status(200).json({ connected: true, ok: true, history, monthHistory, weekKey }); return; }

      const payload = { rows, kind, period, dataStart: start, dataEnd: end, updatedAt: new Date().toISOString(), history, monthHistory,
        debug: { count: rows.length, firstRaw: records[0] || null } };
      if (weekOffset === 0) await kvSet(cacheKey, payload);
      await kvSet(inflKey, null);
      res.status(200).json({ connected: true, ...payload });
    } catch (e) {
      res.status(500).json({ connected: true, error: String(e).slice(0, 500) });
    }
    return;
  }


  if (req.method === "GET") {
    if (!configured) {
      res.status(200).json({ connected: false, reason: "Missing AMZ_LWA_CLIENT_ID / AMZ_LWA_CLIENT_SECRET / AMZ_REFRESH_TOKEN env vars" });
      return;
    }

    // ?op=orders — order-level ledger for the trailing 30 days (Orders API).
    // Classification: an order with a $0 total (and not Pending/Canceled) is a
    // Vine claim or 100%-off promo — real units and real fees, zero revenue.
    if (req.query && req.query.op === "orders") {
      try {
        const token = await getAccessToken();
        const ds = /^\d{4}-\d{2}-\d{2}$/;
        const qStart = ds.test(req.query.start || "") ? req.query.start : null;
        const qEnd = ds.test(req.query.end || "") ? req.query.end : null;
        const after = qStart ? `${qStart}T00:00:00Z` : new Date(Date.now() - 30 * 86400000).toISOString();
        // CreatedBefore must trail "now" by 2+ minutes; only send it for past end dates
        const todayKey = new Date().toISOString().slice(0, 10);
        const before = qEnd && qEnd < todayKey ? `${qEnd}T23:59:59Z` : null;
        let next = null;
        let orders = [];
        for (let i = 0; i < 3; i++) {
          const qs = next
            ? `NextToken=${encodeURIComponent(next)}`
            : `MarketplaceIds=${MARKETPLACE}&CreatedAfter=${encodeURIComponent(after)}${before ? `&CreatedBefore=${encodeURIComponent(before)}` : ""}&MaxResultsPerPage=100`;
          const d = await spapi(token, `/orders/v0/orders?${qs}`);
          const page = (d.payload && d.payload.Orders) || [];
          orders = orders.concat(page.map((o) => {
            const total = o.OrderTotal ? Number(o.OrderTotal.Amount) : null;
            const status = o.OrderStatus || "";
            let kind = "real";
            if (status === "Pending") kind = "pending";
            else if (status === "Canceled") kind = "canceled";
            else if (total !== null && total === 0) kind = "vine";
            return {
              id: o.AmazonOrderId,
              date: o.PurchaseDate,
              status,
              total,
              units: (Number(o.NumberOfItemsShipped) || 0) + (Number(o.NumberOfItemsUnshipped) || 0),
              kind,
            };
          }));
          next = d.payload && d.payload.NextToken;
          if (!next) break;
        }
        orders.sort((a, b) => (a.date < b.date ? 1 : -1));

        // For Vine/$0 orders, pull line items: ItemPrice carries the full list
        // value Amazon attributes before the 100% rebate — exactly the amount
        // that inflates the Sales Dashboard, so exactly what we reconcile out.
        const vineOrders = orders.filter((o) => o.kind === "vine").slice(0, 25);
        const vineByDate = {};
        const vineUnitsByDate = {};
        let vineValue = 0;
        for (const vo of vineOrders) {
          try {
            const di = await spapi(token, `/orders/v0/orders/${encodeURIComponent(vo.id)}/orderItems`);
            const items = (di.payload && di.payload.OrderItems) || [];
            let val = 0, units = 0;
            for (const it of items) {
              val += Number(it.ItemPrice && it.ItemPrice.Amount) || 0;
              units += Number(it.QuantityOrdered) || 0;
            }
            vo.attributed = val;
            if (units) vo.units = units;
            const dk = (vo.date || "").slice(0, 10);
            vineByDate[dk] = (vineByDate[dk] || 0) + val;
            vineUnitsByDate[dk] = (vineUnitsByDate[dk] || 0) + (units || vo.units || 0);
            vineValue += val;
            await sleep(350);
          } catch (e) { /* leave order without attributed value */ }
        }

        res.status(200).json({ connected: true, orders, vineByDate, vineUnitsByDate, vineValue });
      } catch (e) {
        res.status(500).json({ connected: true, error: String(e).slice(0, 400) });
      }
      return;
    }

    // ?op=daily — per-day revenue/units/orders for the trailing 30 days (Sales API)
    if (req.query && req.query.op === "daily") {
      try {
        const token = await getAccessToken();
        const ds = /^\d{4}-\d{2}-\d{2}$/;
        const qStart = ds.test(req.query.start || "") ? req.query.start : null;
        const qEnd = ds.test(req.query.end || "") ? req.query.end : null;
        const gran = ["Day", "Week", "Month", "Year"].includes(req.query.granularity) ? req.query.granularity : "Day";
        const startIso = qStart ? `${qStart}T00:00:00Z` : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 19) + "Z";
        const endIso = qEnd ? `${qEnd}T23:59:59Z` : new Date().toISOString().slice(0, 19) + "Z";
        const interval = `${startIso}--${endIso}`;
        const d = await spapi(
          token,
          `/sales/v1/orderMetrics?marketplaceIds=${MARKETPLACE}&interval=${encodeURIComponent(interval)}&granularity=${gran}`
        );
        const days = (d.payload || []).map((row) => ({
          date: (row.interval || "").slice(0, 10),
          units: Number(row.unitCount) || 0,
          orders: Number(row.orderCount) || 0,
          sales: row.totalSales ? Number(row.totalSales.amount) || 0 : 0,
        }));
        res.status(200).json({ connected: true, days });
      } catch (e) {
        res.status(500).json({ connected: true, error: String(e).slice(0, 400) });
      }
      return;
    }

    // ?op=producttype — Product Type Definitions API. Grounds the creator in
    // Amazon's real schema instead of guessed fields.
    //   action=search&keywords=candle holder -> candidate product types
    //   action=schema&productType=X          -> required + curated fields
    if (req.query && req.query.op === "producttype") {
      const action = req.query.action || "search";
      try {
        const token = await getAccessToken();
        if (action === "search") {
          const kw = encodeURIComponent(req.query.keywords || "");
          const d = await spapi(token, `/definitions/2020-09-01/productTypes?keywords=${kw}&marketplaceIds=${MARKETPLACE}`);
          const types = (d.productTypes || []).map((p) => ({ name: p.name, displayName: p.displayName || p.name }));
          res.status(200).json({ connected: true, types });
          return;
        }
        if (action === "schema") {
          const pt = req.query.productType || "";
          if (!pt) { res.status(400).json({ error: "Missing productType" }); return; }
          const meta = await spapi(
            token,
            `/definitions/2020-09-01/productTypes/${encodeURIComponent(pt)}?marketplaceIds=${MARKETPLACE}&requirements=LISTING&locale=en_US`
          );
          const link = meta.schema && meta.schema.link && meta.schema.link.resource;
          if (!link) { res.status(200).json({ connected: true, productType: pt, fields: [], required: [], note: "No schema link returned" }); return; }
          const schemaRes = await fetch(link);
          const schema = await schemaRes.json();
          const props = schema.properties || {};
          const required = schema.required || [];
          // Curated common fields we always want surfaced if the type allows them
          const curated = ["item_name", "brand", "product_description", "bullet_point",
            "main_product_image_locator", "other_product_image_locator", "purchasable_offer",
            "condition_type", "fulfillment_availability", "color", "material", "item_type_keyword",
            "number_of_items", "country_of_origin", "supplier_declared_dg_hz_regulation",
            "batteries_required", "list_price",
            // variation + body-care/perfume relevant
            "variation_theme", "size_name", "scent_name", "color_name", "item_form",
            "skin_type", "scent", "unit_count", "material_feature", "special_ingredients",
            "ingredients", "directions", "safety_warning", "fragrance_concentration"];
          const want = Array.from(new Set([...required, ...curated])).filter((n) => props[n]);
          const fields = want.slice(0, 60).map((name) => {
            const p = props[name] || {};
            const items = p.items || {};
            const ip = items.properties || {};
            const valLeaf = ip.value || {};
            const localizable = !!ip.language_tag;
            const enumVals = valLeaf.enum || (valLeaf.items && valLeaf.items.enum) || null;
            const enumNames = valLeaf.enumNames || null;
            return {
              name,
              title: p.title || name,
              description: (p.description || "").slice(0, 160),
              required: required.includes(name),
              localizable,
              valueType: valLeaf.type || (Array.isArray(p.type) ? p.type[0] : p.type) || "string",
              enum: enumVals ? enumVals.slice(0, 60) : null,
              enumNames: enumNames ? enumNames.slice(0, 60) : null,
              maxLength: valLeaf.maxLength || null,
              maxItems: p.maxItems || (items && items.maxUniqueItems) || null,
            };
          });
          res.status(200).json({ connected: true, productType: pt, required, fields });
          return;
        }
        res.status(400).json({ error: "Unknown producttype action" });
      } catch (e) {
        res.status(500).json({ connected: true, error: String(e).slice(0, 400) });
      }
      return;
    }

    // ?op=createlisting — full new-listing creation via putListingsItem.
    // Frontend sends an already-shaped attributes object. requirements=LISTING.
    if (req.query && req.query.op === "createlisting" && req.method === "POST") {
      if (!SELLER_ID) { res.status(400).json({ error: "AMZ_SELLER_ID is not set in Vercel." }); return; }
      try {
        const token = await getAccessToken();
        const b = req.body || {};
        const sku = b.sku, productType = b.productType, attributes = b.attributes || {};
        if (!sku || !productType) { res.status(400).json({ error: "Missing sku or productType" }); return; }
        const d = await spapiW(
          token,
          `/listings/2021-08-01/items/${encodeURIComponent(SELLER_ID)}/${encodeURIComponent(sku)}?marketplaceIds=${MARKETPLACE}`,
          "PUT",
          { productType, requirements: "LISTING", attributes }
        );
        res.status(200).json({
          connected: true,
          status: d.status,
          submissionId: d.submissionId,
          issues: (d.issues || []).map((i) => ({ code: i.code, message: i.message, severity: i.severity, attributeNames: i.attributeNames || [] })),
        });
      } catch (e) {
        res.status(500).json({ connected: true, error: String(e).slice(0, 500) });
      }
      return;
    }

    // ?op=listing — Listings Items API editor (Product Listing role).
    // action=skus  -> picker list from FBA inventory
    // action=get&sku=X -> current title/bullets/description/price/status/issues
    // action=patch (POST) -> apply field changes
    if (req.query && req.query.op === "listing") {
      const action = req.query.action || "get";
      if (!SELLER_ID) { res.status(400).json({ error: "AMZ_SELLER_ID is not set in Vercel environment variables." }); return; }
      try {
        const token = await getAccessToken();

        if (action === "skus") {
          const inv = await fetchFbaInventory(token);
          const seen = {};
          const skus = [];
          for (const s of inv) {
            const sku = s.sellerSku;
            if (!sku || seen[sku]) continue;
            seen[sku] = 1;
            skus.push({ sku, asin: s.asin || null, name: s.productName || "" });
          }
          skus.sort((a, b) => (a.name + a.sku).localeCompare(b.name + b.sku));
          res.status(200).json({ connected: true, skus });
          return;
        }

        if (action === "get") {
          const sku = req.query.sku || "";
          if (!sku) { res.status(400).json({ error: "Missing sku" }); return; }
          const d = await spapi(
            token,
            `/listings/2021-08-01/items/${encodeURIComponent(SELLER_ID)}/${encodeURIComponent(sku)}?marketplaceIds=${MARKETPLACE}&includedData=summaries,attributes,issues,offers,fulfillmentAvailability`
          );
          const attrs = d.attributes || {};
          const summ = (d.summaries || [])[0] || {};
          const offers = d.offers || [];
          const mp = (arr) => Array.isArray(arr) ? arr : [];
          const firstVal = (key) => {
            const a = mp(attrs[key]);
            return a.length ? (a[0].value !== undefined ? a[0].value : a[0]) : "";
          };
          const bullets = mp(attrs.bullet_point).map((b) => (b.value !== undefined ? b.value : b)).filter(Boolean);
          // current price: prefer offers, fall back to purchasable_offer attribute
          let price = null;
          if (offers.length && offers[0].price && offers[0].price.amount) price = Number(offers[0].price.amount);
          else {
            const po = mp(attrs.purchasable_offer)[0];
            const sched = po && po.our_price && po.our_price[0] && po.our_price[0].schedule && po.our_price[0].schedule[0];
            if (sched && sched.value_with_tax !== undefined) price = Number(sched.value_with_tax);
          }
          res.status(200).json({
            connected: true,
            sku,
            productType: summ.productType || (d.productTypes && d.productTypes[0] && d.productTypes[0].productType) || null,
            asin: summ.asin || null,
            status: summ.status || (summ.listingId ? "ACTIVE" : null),
            itemName: summ.itemName || firstVal("item_name"),
            bullets,
            description: firstVal("product_description"),
            price,
            issues: (d.issues || []).map((i) => ({ code: i.code, message: i.message, severity: i.severity, attributeNames: i.attributeNames || [] })),
          });
          return;
        }

        if (action === "patch" && req.method === "POST") {
          const b = req.body || {};
          const sku = b.sku || "";
          const productType = b.productType;
          if (!sku || !productType) { res.status(400).json({ error: "Missing sku or productType" }); return; }
          const patches = [];
          const L = (value) => [{ value: String(value), marketplace_id: MARKETPLACE, language_tag: "en_US" }];
          if (typeof b.itemName === "string" && b.itemName.length) {
            patches.push({ op: "replace", path: "/attributes/item_name", value: L(b.itemName) });
          }
          if (Array.isArray(b.bullets)) {
            patches.push({ op: "replace", path: "/attributes/bullet_point", value: b.bullets.filter((x) => x && x.trim()).map((x) => ({ value: x, marketplace_id: MARKETPLACE, language_tag: "en_US" })) });
          }
          if (typeof b.description === "string" && b.description.length) {
            patches.push({ op: "replace", path: "/attributes/product_description", value: L(b.description) });
          }
          if (b.price !== undefined && b.price !== null && b.price !== "" && !isNaN(Number(b.price))) {
            patches.push({
              op: "replace",
              path: "/attributes/purchasable_offer",
              value: [{
                marketplace_id: MARKETPLACE,
                currency: "USD",
                our_price: [{ schedule: [{ value_with_tax: Number(b.price) }] }],
              }],
            });
          }
          if (!patches.length) { res.status(400).json({ error: "Nothing to update" }); return; }
          const d = await spapiW(
            token,
            `/listings/2021-08-01/items/${encodeURIComponent(SELLER_ID)}/${encodeURIComponent(sku)}?marketplaceIds=${MARKETPLACE}`,
            "PATCH",
            { productType, patches }
          );
          res.status(200).json({
            connected: true,
            status: d.status,
            submissionId: d.submissionId,
            issues: (d.issues || []).map((i) => ({ code: i.code, message: i.message, severity: i.severity })),
          });
          return;
        }

        res.status(400).json({ error: "Unknown listing action" });
      } catch (e) {
        res.status(500).json({ connected: true, error: String(e).slice(0, 400) });
      }
      return;
    }

    // ?op=pricing — buy-box & competitor pricing (Product Pricing API v0).
    // No asins param: discovers her ASINs from FBA inventory and prices those.
    // ?asins=B0X,B0Y: prices arbitrary ASINs (competitor watchlist).
    // ?action=getcomp / setcomp(POST): competitor watchlist stored in Redis.
    if (req.query && req.query.op === "pricing") {
      const action = req.query.action || "";
      if (action === "getcomp") {
        const c = await kvGet("competitor_watchlist");
        res.status(200).json({ connected: true, competitors: (c && c.list) || [] });
        return;
      }
      if (action === "setcomp" && req.method === "POST") {
        await kvSet("competitor_watchlist", { list: (req.body && req.body.competitors) || [] });
        res.status(200).json({ ok: true });
        return;
      }
      try {
        const token = await getAccessToken();
        let targets = [];
        if (req.query.asins) {
          targets = String(req.query.asins).split(",").map((a) => ({ asin: a.trim(), skus: [] })).filter((t) => t.asin);
        } else {
          const inv = await spapi(
            token,
            `/fba/inventory/v1/summaries?granularityType=Marketplace&granularityId=${MARKETPLACE}&marketplaceIds=${MARKETPLACE}`
          );
          const byAsin = {};
          for (const s of (inv.payload && inv.payload.inventorySummaries) || []) {
            if (!s.asin) continue;
            if (!byAsin[s.asin]) byAsin[s.asin] = { asin: s.asin, skus: [] };
            byAsin[s.asin].skus.push(s.sellerSku);
          }
          targets = Object.values(byAsin);
        }
        targets = targets.slice(0, 12);
        const results = [];
        for (const t of targets) {
          try {
            const d = await spapi(
              token,
              `/products/pricing/v0/items/${encodeURIComponent(t.asin)}/offers?MarketplaceId=${MARKETPLACE}&ItemCondition=New`
            );
            const p = d.payload || {};
            const sum = p.Summary || {};
            const offers = p.Offers || [];
            const mine = offers.find((o) => o.MyOffer);
            const bbWinner = offers.find((o) => o.IsBuyBoxWinner);
            const num = (x) => (x === undefined || x === null ? null : Number(x));
            const landed = (o) =>
              o ? (num(o.ListingPrice && o.ListingPrice.Amount) || 0) + (num(o.Shipping && o.Shipping.Amount) || 0) : null;
            const bbPrice =
              (sum.BuyBoxPrices && sum.BuyBoxPrices[0] && num(sum.BuyBoxPrices[0].LandedPrice && sum.BuyBoxPrices[0].LandedPrice.Amount)) ??
              landed(bbWinner);
            const lowest =
              (sum.LowestPrices && sum.LowestPrices[0] && num(sum.LowestPrices[0].LandedPrice && sum.LowestPrices[0].LandedPrice.Amount)) ?? null;
            const offerCount =
              (sum.NumberOfOffers || []).reduce((s2, n2) => s2 + (Number(n2.OfferCount) || 0), 0) || offers.length;
            results.push({
              asin: t.asin,
              skus: t.skus,
              myPrice: landed(mine),
              buyBox: bbPrice,
              buyBoxIsMine: !!(bbWinner && bbWinner.MyOffer) || !!(mine && mine.IsBuyBoxWinner),
              lowest,
              offerCount,
            });
          } catch (e) {
            results.push({ asin: t.asin, skus: t.skus, error: String(e).slice(0, 160) });
          }
          await sleep(700);
        }
        res.status(200).json({ connected: true, results });
      } catch (e) {
        res.status(500).json({ connected: true, error: String(e).slice(0, 400) });
      }
      return;
    }

    // ?op=sns — Subscribe & Save report flow (Reports API).
    // action=create   -> { reportId }
    // action=status   -> { processingStatus, reportDocumentId }
    // action=download -> { headers, rows } parsed from the TSV document
    if (req.query && req.query.op === "sns") {
      const action = req.query.action || "create";
      try {
        const token = await getAccessToken();
        if (action === "create") {
          const r = await fetch(`${SPAPI}/reports/2021-06-30/reports`, {
            method: "POST",
            headers: { "x-amz-access-token": token, "Content-Type": "application/json" },
            body: JSON.stringify({
              reportType: req.query.type === "performance" ? "GET_FBA_SNS_PERFORMANCE_DATA" : "GET_FBA_SNS_FORECAST_DATA",
              marketplaceIds: [MARKETPLACE],
            }),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(`createReport ${r.status}: ${JSON.stringify(d).slice(0, 250)}`);
          res.status(200).json({ reportId: d.reportId });
          return;
        }
        if (action === "status") {
          const d = await spapi(token, `/reports/2021-06-30/reports/${encodeURIComponent(req.query.reportId || "")}`);
          res.status(200).json({ processingStatus: d.processingStatus, reportDocumentId: d.reportDocumentId || null });
          return;
        }
        if (action === "download") {
          const meta = await spapi(token, `/reports/2021-06-30/documents/${encodeURIComponent(req.query.documentId || "")}`);
          const docR = await fetch(meta.url);
          const buf = Buffer.from(await docR.arrayBuffer());
          const text = (meta.compressionAlgorithm === "GZIP" ? gunzipSync(buf) : buf).toString("utf8");
          const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
          if (!lines.length) { res.status(200).json({ headers: [], rows: [] }); return; }
          const headers = lines[0].split("\t").map((h) => h.trim());
          const rows = lines.slice(1).map((l) => {
            const cells = l.split("\t");
            const o = {};
            headers.forEach((h, i) => { o[h] = (cells[i] || "").trim(); });
            return o;
          });
          res.status(200).json({ headers, rows });
          return;
        }
        res.status(400).json({ error: "Unknown sns action" });
      } catch (e) {
        res.status(500).json({ connected: true, error: String(e).slice(0, 400) });
      }
      return;
    }

    // ?op=restock — Seller Central's NATIVE restock recommendations
    // (GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT). Days of supply, the
    // recommended replenishment quantity and recommended ship date come from
    // Amazon itself, not our projection. Self-orchestrating create→poll→
    // download: the client calls this repeatedly until { ready:true }.
    //   pending  -> report still generating (call again in a few seconds)
    //   ready    -> { items:[{productId, daysOfSupply, recommendedQty,
    //                recommendedShipDate, alert, available, inbound, sold30}],
    //                unmatched, syncedAt }
    if (req.query && req.query.op === "restock") {
      try {
        const token = await getAccessToken();
        const force = req.query.force === "1";
        const cached = await kvGet("amazon_restock");
        const job = await kvGet("amazon_restock_job");

        // Serve a fresh cache (< 12h) unless forced — restock reports are rate-limited.
        if (!force && cached && cached.syncedAt && (Date.now() - new Date(cached.syncedAt).getTime()) < 12 * 3600000) {
          res.status(200).json({ connected: true, ready: true, cached: true, items: cached.items || [], unmatched: cached.unmatched || [], syncedAt: cached.syncedAt });
          return;
        }

        // No in-flight job (or forced): create a fresh report and return its id.
        let reportId = job && job.reportId;
        if (force || !reportId) {
          const created = await spapiW(token, "/reports/2021-06-30/reports", "POST", {
            reportType: "GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT",
            marketplaceIds: [MARKETPLACE],
          });
          if (!created.reportId) { res.status(200).json({ connected: true, error: "Amazon rejected the restock report request. The FBA Inventory role may not be granted to the app." }); return; }
          await kvSet("amazon_restock_job", { reportId: created.reportId, startedAt: new Date().toISOString() });
          res.status(200).json({ connected: true, pending: true, reportId: created.reportId });
          return;
        }

        // Poll the in-flight report.
        const rep = await spapi(token, "/reports/2021-06-30/reports/" + encodeURIComponent(reportId));
        const status = rep.processingStatus;
        if (status === "CANCELLED" || status === "FATAL") {
          await kvSet("amazon_restock_job", null);
          res.status(200).json({ connected: true, error: "Amazon could not produce the restock report (" + status + "). Likely the FBA Inventory role isn't granted to the app, or there's no data yet.", status });
          return;
        }
        if (status !== "DONE") { res.status(200).json({ connected: true, pending: true, status }); return; }

        // DONE — download + parse the TSV, then map SKU -> app product id.
        const meta = await spapi(token, "/reports/2021-06-30/documents/" + encodeURIComponent(rep.reportDocumentId));
        const docR = await fetch(meta.url);
        const buf = Buffer.from(await docR.arrayBuffer());
        const text = (meta.compressionAlgorithm === "GZIP" ? gunzipSync(buf) : buf).toString("utf8");
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        const headers = (lines[0] || "").split("\t").map((h) => h.trim().toLowerCase());
        const idx = (...names) => { for (const nm of names) { const i = headers.findIndex((h) => h.indexOf(nm) >= 0); if (i >= 0) return i; } return -1; };
        const iSku = idx("merchant sku", "seller sku", "sku");
        const iAsin = idx("asin");
        const iName = idx("product name", "title");
        const iAvail = idx("available");
        const iInbound = idx("inbound");
        const iDays = idx("days of supply", "days of cover");
        const iRecQty = idx("recommended replenishment", "recommended units", "replenishment qty", "recommended ship qty");
        const iShipDate = idx("recommended ship date", "ship date");
        const iAlert = idx("alert", "recommended action");
        const iSold30 = idx("units sold last 30", "sales last 30", "units sold");

        const items = []; const unmatched = [];
        lines.slice(1).forEach((l) => {
          const cells = l.split("\t");
          const g = (i) => (i >= 0 && cells[i] != null ? String(cells[i]).trim() : "");
          const sku = g(iSku);
          if (!sku) return;
          const rec = {
            sku, asin: g(iAsin), name: g(iName),
            available: n(g(iAvail)), inbound: n(g(iInbound)),
            daysOfSupply: n(g(iDays)),
            recommendedQty: n(g(iRecQty)),
            recommendedShipDate: g(iShipDate) || null,
            alert: g(iAlert) || null,
            sold30: n(g(iSold30)),
          };
          const pid = SKU_MAP[sku.toLowerCase()];
          if (pid != null) items.push({ productId: pid, ...rec });
          else unmatched.push(rec);
        });

        const payload = { items, unmatched, syncedAt: new Date().toISOString(), reportId };
        await kvSet("amazon_restock", payload);
        await kvSet("amazon_restock_job", null);
        res.status(200).json({ connected: true, ready: true, ...payload });
        return;
      } catch (e) {
        res.status(500).json({ connected: true, error: String(e).slice(0, 400) });
      }
      return;
    }

    // ?op=netseries — settled net profit bucketed by posting MONTH over the
    // trailing 12 months (Finances API). Frontend rolls months into quarters
    // or years. Buckets by PostedDate, so the figures are real settled money.
    if (req.query && req.query.op === "netseries") {
      try {
        const token = await getAccessToken();
        const ds = /^\d{4}-\d{2}-\d{2}$/;
        const qStart = ds.test(req.query.start || "") ? req.query.start : null;
        const after = qStart ? `${qStart}T00:00:00Z` : new Date(Date.now() - 365 * 86400000).toISOString();
        let next = null;
        let truncated = false;
        const buckets = {}; // "YYYY-MM" -> { gross, fees, refunds }
        const b = (k) => (buckets[k] = buckets[k] || { gross: 0, fees: 0, refunds: 0 });
        for (let i = 0; i < 12; i++) {
          const qs = next
            ? `NextToken=${encodeURIComponent(next)}`
            : `PostedAfter=${encodeURIComponent(after)}&MaxResultsPerPage=100`;
          const d = await spapi(token, `/finances/v0/financialEvents?${qs}`);
          const ev = (d.payload && d.payload.FinancialEvents) || {};
          for (const se of ev.ShipmentEventList || []) {
            const mk = (se.PostedDate || "").slice(0, 7);
            if (!mk) continue;
            for (const item of se.ShipmentItemList || []) {
              for (const ch of item.ItemChargeList || []) {
                if (ch.ChargeType === "Principal") b(mk).gross += Number(ch.ChargeAmount && ch.ChargeAmount.CurrencyAmount) || 0;
              }
              for (const fee of item.ItemFeeList || []) {
                b(mk).fees += Math.abs(Number(fee.FeeAmount && fee.FeeAmount.CurrencyAmount) || 0);
              }
            }
          }
          for (const re of ev.RefundEventList || []) {
            const mk = (re.PostedDate || "").slice(0, 7);
            if (!mk) continue;
            for (const item of re.ShipmentItemAdjustmentList || []) {
              for (const ch of item.ItemChargeAdjustmentList || []) {
                if (ch.ChargeType === "Principal") b(mk).refunds += Math.abs(Number(ch.ChargeAmount && ch.ChargeAmount.CurrencyAmount) || 0);
              }
              for (const fee of item.ItemFeeAdjustmentList || []) {
                b(mk).fees += Math.abs(Number(fee.FeeAmount && fee.FeeAmount.CurrencyAmount) || 0);
              }
            }
          }
          next = d.payload && d.payload.NextToken;
          if (!next) break;
          if (i === 11) truncated = true;
        }
        const months = Object.keys(buckets).sort().map((k) => ({
          month: k,
          gross: buckets[k].gross,
          fees: buckets[k].fees,
          refunds: buckets[k].refunds,
          net: buckets[k].gross - buckets[k].fees - buckets[k].refunds,
        }));
        res.status(200).json({ connected: true, months, truncated });
      } catch (e) {
        res.status(500).json({ connected: true, error: String(e).slice(0, 400) });
      }
      return;
    }

    // ?op=finances — fee/refund/net summary for the trailing 30 days (Finances API)
    if (req.query && req.query.op === "finances") {
      try {
        const token = await getAccessToken();
        const after = new Date(Date.now() - 30 * 86400000).toISOString();
        let next = null;
        let gross = 0, refunds = 0;
        const feesByType = {};
        for (let i = 0; i < 6; i++) {
          const qs = next
            ? `NextToken=${encodeURIComponent(next)}`
            : `PostedAfter=${encodeURIComponent(after)}&MaxResultsPerPage=100`;
          const d = await spapi(token, `/finances/v0/financialEvents?${qs}`);
          const ev = (d.payload && d.payload.FinancialEvents) || {};
          for (const se of ev.ShipmentEventList || []) {
            for (const item of se.ShipmentItemList || []) {
              for (const ch of item.ItemChargeList || []) {
                if (ch.ChargeType === "Principal") gross += Number(ch.ChargeAmount && ch.ChargeAmount.CurrencyAmount) || 0;
              }
              for (const fee of item.ItemFeeList || []) {
                const t = fee.FeeType || "Other";
                const amt = Number(fee.FeeAmount && fee.FeeAmount.CurrencyAmount) || 0;
                feesByType[t] = (feesByType[t] || 0) + amt;
              }
            }
          }
          for (const re of ev.RefundEventList || []) {
            for (const item of re.ShipmentItemAdjustmentList || []) {
              for (const ch of item.ItemChargeAdjustmentList || []) {
                if (ch.ChargeType === "Principal") refunds += Math.abs(Number(ch.ChargeAmount && ch.ChargeAmount.CurrencyAmount) || 0);
              }
              for (const fee of item.ItemFeeAdjustmentList || []) {
                const t = (fee.FeeType || "Other") + " (refund adj)";
                const amt = Number(fee.FeeAmount && fee.FeeAmount.CurrencyAmount) || 0;
                feesByType[t] = (feesByType[t] || 0) + amt;
              }
            }
          }
          next = d.payload && d.payload.NextToken;
          if (!next) break;
        }
        const totalFees = Object.values(feesByType).reduce((s, v) => s + Math.abs(v), 0);
        const net = gross - totalFees - refunds;
        res.status(200).json({ connected: true, gross, refunds, feesByType, totalFees, net, since: after });
      } catch (e) {
        res.status(500).json({ connected: true, error: String(e).slice(0, 400) });
      }
      return;
    }

    if (req.query && req.query.debug) {
      try {
        const token = await getAccessToken();
        const inv = await fetchFbaInventory(token);
        res.status(200).json({
          connected: true,
          skuCount: inv.length,
          summaries: inv.map((s) => ({
            sku: s.sellerSku,
            asin: s.asin,
            total: s.totalQuantity,
            fulfillable: s.inventoryDetails && s.inventoryDetails.fulfillableQuantity,
            inboundShipped: s.inventoryDetails && s.inventoryDetails.inboundShippedQuantity,
            inboundWorking: s.inventoryDetails && s.inventoryDetails.inboundWorkingQuantity,
            inboundReceiving: s.inventoryDetails && s.inventoryDetails.inboundReceivingQuantity,
            mappedToAppId: SKU_MAP[(s.sellerSku || "").trim().toLowerCase()] ?? null,
          })),
        });
      } catch (e) {
        res.status(500).json({ connected: true, error: String(e).slice(0, 400) });
      }
      return;
    }
    const meta = await kvGet("amazon_meta");
    res.status(200).json({ connected: true, lastSync: (meta && meta.lastSync) || null });
    return;
  }

  if (!configured) {
    res.status(200).json({ connected: false });
    return;
  }

    // ?op=fees — live FBA fulfillment-fee estimate per ASIN (Product Fees API).
    // Body: { items:[{id, asin, price}] }. Returns the FBA fee only (referral is
    // applied separately in the Margins tab, so we exclude it here to avoid
    // double-counting). ~1 request/second rate limit, so we pace the loop.
    if (req.query && req.query.op === "fees" && req.method === "POST") {
      try {
        const token = await getAccessToken();
        const items = (req.body && req.body.items) || [];

        // One fee estimate by a given identifier type. Parses the FBA fulfillment
        // fee (excludes referral, applied separately in Margins). Falls back to
        // total − referral if no explicit FBA line is present.
        const estimateFee = async (idType, idValue, price, id) => {
          try {
            const body = {
              FeesEstimateRequest: {
                MarketplaceId: MARKETPLACE,
                IdType: idType,
                IdValue: idValue,
                PriceToEstimateFees: { ListingPrice: { CurrencyCode: "USD", Amount: price } },
                Identifier: String(id != null ? id : idValue),
                IsAmazonFulfilled: true,
              },
            };
            const path = idType === "SellerSKU"
              ? `/products/fees/v0/listings/${encodeURIComponent(idValue)}/feesEstimate`
              : `/products/fees/v0/items/${encodeURIComponent(idValue)}/feesEstimate`;
            const d = await spapiW(token, path, "POST", body);
            const result = (d && d.payload && d.payload.FeesEstimateResult) || (d && d.FeesEstimateResult) || null;
            const est = result && result.FeesEstimate;
            const status = result && result.Status;
            const details = (est && est.FeeDetailList) || [];
            const feeTypes = details.map((f) => f.FeeType);
            let fba = 0, found = false;
            for (const f of details) {
              const t = f.FeeType || "";
              if (/FBA|Fulfillment/i.test(t) && !/Referral/i.test(t)) {
                const a = (f.FeeAmount && f.FeeAmount.Amount != null) ? f.FeeAmount.Amount : (f.FinalFee && f.FinalFee.Amount);
                if (a != null) { fba += Number(a); found = true; }
              }
            }
            if (!found && est && est.TotalFeesEstimate && est.TotalFeesEstimate.Amount != null) {
              let referral = 0;
              for (const f of details) { if (/Referral/i.test(f.FeeType || "")) { const a = (f.FeeAmount && f.FeeAmount.Amount != null) ? f.FeeAmount.Amount : (f.FinalFee && f.FinalFee.Amount); if (a != null) referral += Number(a); } }
              const derived = Number(est.TotalFeesEstimate.Amount) - referral;
              if (derived > 0) { fba = derived; found = true; }
            }
            const errMsg = result && result.Error ? (result.Error.Message || result.Error.Code) : null;
            return { found, fba, status, feeTypes, error: errMsg, raw: found ? undefined : JSON.stringify(d).slice(0, 350) };
          } catch (e) {
            return { found: false, error: String(e).slice(0, 220) };
          }
        };

        const out = [];
        for (const it of items) {
          const sku = it && it.sku, asin = it && it.asin;
          const price = Number(it && it.price) || 0;
          if (!sku && !asin) { out.push({ id: it && it.id, asin, sku, fbaFee: null, error: "no SKU/ASIN" }); continue; }
          let r = null, used = null;
          if (sku) { r = await estimateFee("SellerSKU", sku, price, it.id); used = "sku"; await new Promise((x) => setTimeout(x, 700)); }
          if ((!r || !r.found) && asin) {
            const r2 = await estimateFee("ASIN", asin, price, it.id);
            await new Promise((x) => setTimeout(x, 700));
            if (r2 && r2.found) { r = r2; used = "asin"; } else if (!r) { r = r2; used = "asin"; }
          }
          out.push({
            id: it.id, asin, sku,
            fbaFee: r && r.found ? Number(r.fba.toFixed(2)) : null,
            status: r && r.status, feeTypes: r && r.feeTypes, error: r && r.error,
            idUsed: used, debug: (r && r.found) ? undefined : (r && r.raw),
          });
        }
        res.status(200).json({ items: out, updatedAt: new Date().toISOString() });
      } catch (e) {
        res.status(500).json({ error: String(e).slice(0, 400) });
      }
      return;
    }

  try {
    const token = await getAccessToken();
    const inv = await fetchFbaInventory(token);

    const byId = {}; // productId -> { fba, inbound }
    const skuDetail = {}; // productId -> [{ sku, fba, inbound, sold }]
    const unmatchedSkus = [];
    const mappedSkus = [];
    for (const s of inv) {
      const key = (s.sellerSku || "").trim().toLowerCase();
      const det = s.inventoryDetails || {};
      const fba = Number(det.fulfillableQuantity ?? s.totalQuantity) || 0;
      const inbound =
        (Number(det.inboundShippedQuantity) || 0) +
        (Number(det.inboundWorkingQuantity) || 0) +
        (Number(det.inboundReceivingQuantity) || 0);
      if (SKU_MAP[key] !== undefined) {
        const id = SKU_MAP[key];
        if (!byId[id]) byId[id] = { fba: 0, inbound: 0 };
        byId[id].fba += fba;
        byId[id].inbound += inbound;
        if (!skuDetail[id]) skuDetail[id] = [];
        skuDetail[id].push({ sku: s.sellerSku, fba, inbound, sold: 0 });
        mappedSkus.push({ id, sku: s.sellerSku });
      } else {
        unmatchedSkus.push({ sku: s.sellerSku, asin: s.asin, qty: Number(s.totalQuantity) || 0 });
      }
    }
    const items = Object.entries(byId).map(([id, v]) => ({ productId: Number(id), fba: v.fba, inbound: v.inbound }));

    // Sold/30d per mapped SKU — sequential with a small gap (Sales API ~0.5 rps).
    let sold = [];
    let soldError = null;
    try {
      const soldById = {};
      for (const m of mappedSkus) {
        const qty = await fetchSold30ForSku(token, m.sku);
        soldById[m.id] = (soldById[m.id] || 0) + qty;
        const rows = skuDetail[m.id];
        if (rows) {
          const row = rows.find((r) => r.sku === m.sku);
          if (row) row.sold = qty;
        }
        await sleep(600);
      }
      sold = Object.entries(soldById).map(([id, qty]) => ({ productId: Number(id), qty }));
    } catch (e) {
      soldError = String(e).slice(0, 200);
    }

    const syncedAt = new Date().toISOString();
    await kvSet("amazon_meta", { lastSync: syncedAt });

    res.status(200).json({ connected: true, syncedAt, items, sold, skuDetail, unmatchedSkus, soldError });
  } catch (e) {
    res.status(500).json({ connected: true, error: String(e).slice(0, 400) });
  }
}
