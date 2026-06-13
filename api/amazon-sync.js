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

import { gunzipSync } from "node:zlib";

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
