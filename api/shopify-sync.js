import { createHmac } from "node:crypto";
// api/shopify-sync.js
// LAVALLE HAUS OS — Shopify sync: live inventory, 30-day sales, variant detail,
// and UGC/marketing order separation.
// GET            -> { connected, shop, lastSync }
// GET ?debug=1   -> full product/variant tree
// POST           -> { connected, syncedAt, items, sold, ugcSold, variantDetail,
//                     unmatched, soldUnmatched }
//
// Sales rules: only paid, non-cancelled orders count. Orders tagged "marketing"
// (any case) OR with a $0 total are classified as UGC/marketing and reported
// separately in ugcSold — they never inflate real Sold/30d. Orders tagged only
// FF26K (free shipping, paid product) count as real sales.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const API_VERSION = "2025-10";

// Product title (lowercased) -> app product ID.
// ids 13/14 are retired cards; their mappings remain so those listings don't
// clutter the "unmatched" warning — the quantities flow to no visible card.
const TITLE_MAP = {
  "seashell sand wax candle set": 1,
  "mini spiced apple botanical candle": 4,
  "large spiced apple botanical candle": 5,
  "dough bowl sand wax candle set": 7,
  "vanilla cashmere sugar scrub": 8,
  "vanilla cashmere sugar scrub sample": 11,
  "mini spiced apple cider botanical candle sample": 12,
  "mini spiced apple cider botanical candle wholesale": 13,
  "spiced apple cider sandwax candle": 14,
};

// Variant routing for products whose variants belong to different app products.
const VARIANT_SPLIT = {
  "sandwax refill pouch": [
    { match: "16 oz", id: 2 }, // Beeswax Candle Sand 16oz
    { match: "32 oz", id: 3 }, // Beeswax Candle Sand 32oz
  ],
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

async function gql(shop, token, query, variables) {
  const r = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Shopify API ${r.status}: ${t.slice(0, 200)}`);
  }
  const d = await r.json();
  if (d.errors) throw new Error("GraphQL: " + JSON.stringify(d.errors).slice(0, 200));
  return d.data;
}

async function fetchProducts(shop, token) {
  const query = `
    query Products($after: String) {
      products(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges { node {
          title status totalInventory tracksInventory
          variants(first: 50) { edges { node { title inventoryQuantity sku } } }
        } }
      }
    }`;
  let after = null;
  let all = [];
  for (let i = 0; i < 10; i++) {
    const data = await gql(shop, token, query, { after });
    const conn = data.products;
    all = all.concat(conn.edges.map((e) => ({
      title: e.node.title,
      status: e.node.status,
      tracksInventory: e.node.tracksInventory,
      totalInventory: e.node.totalInventory,
      variants: ((e.node.variants && e.node.variants.edges) || []).map((v) => ({
        title: v.node.title, sku: v.node.sku, qty: v.node.inventoryQuantity,
      })),
    })));
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return all;
}

// Sold units in the last 30 days from paid, non-cancelled orders, split into
// real sales vs UGC/marketing ($0 or tagged "marketing").
// Returns { real: {"ptitle||vtitle": qty}, ugc: {...} }
async function fetchSold30(shop, token) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const query = `
    query Orders($after: String, $q: String!) {
      orders(first: 100, after: $after, query: $q) {
        pageInfo { hasNextPage endCursor }
        edges { node {
          tags
          totalPriceSet { shopMoney { amount } }
          lineItems(first: 50) {
            edges { node { quantity product { title } variant { title } } }
          }
        } }
      }
    }`;
  const q = `created_at:>=${since} AND financial_status:paid AND -status:cancelled`;
  const real = {};
  const ugc = {};
  let after = null;
  for (let i = 0; i < 20; i++) {
    const data = await gql(shop, token, query, { after, q });
    const conn = data.orders;
    for (const edge of conn.edges) {
      const node = edge.node;
      const tags = (node.tags || []).map((t) => String(t).trim().toLowerCase());
      const total = parseFloat(node.totalPriceSet && node.totalPriceSet.shopMoney && node.totalPriceSet.shopMoney.amount) || 0;
      const isMarketing = tags.includes("marketing") || total === 0;
      const bucket = isMarketing ? ugc : real;
      const lis = (node.lineItems && node.lineItems.edges) || [];
      for (const li of lis) {
        const pkey = ((li.node.product && li.node.product.title) || "").trim().toLowerCase();
        const vkey = ((li.node.variant && li.node.variant.title) || "").trim().toLowerCase();
        if (!pkey) continue;
        const k = pkey + "||" + vkey;
        bucket[k] = (bucket[k] || 0) + (Number(li.node.quantity) || 0);
      }
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return { real, ugc };
}

function resolveId(pkey, vkey) {
  const split = VARIANT_SPLIT[pkey];
  if (split) {
    const rule = split.find((r) => (vkey || "").includes(r.match));
    return rule ? rule.id : null;
  }
  return TITLE_MAP[pkey] !== undefined ? TITLE_MAP[pkey] : null;
}

// Per-period GROSS & NET sales (+ units) from paid, non-cancelled orders,
// bucketed in the STORE's own timezone so totals line up with the Shopify
// Analytics dashboard. Gross = pre-discount product subtotal; Net = after
// discounts and returns, before tax & shipping (Shopify's "Net sales").
async function fetchSalesByPeriod(shop, token) {
  let tz = "America/Los_Angeles";
  try {
    const sd = await gql(shop, token, `{ shop { ianaTimezone } }`, {});
    if (sd && sd.shop && sd.shop.ianaTimezone) tz = sd.shop.ianaTimezone;
  } catch (_) {}

  const partsInTz = (date) => {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
    const p = {}; f.formatToParts(date).forEach((x) => { p[x.type] = x.value; });
    return p;
  };
  const ymd = (dt) => dt.toISOString().slice(0, 10);
  const addDays = (dt, n) => new Date(dt.getTime() + n * 86400000);

  const P = partsInTz(new Date());
  const today = new Date(`${P.year}-${P.month}-${P.day}T12:00:00Z`); // noon-UTC anchor of the LOCAL date (DST-safe for date math)
  const wd = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[P.weekday] || 0;
  const weekStart = addDays(today, -wd);            // Sunday of the current week (Shopify default)
  const lastWeekStart = addDays(weekStart, -7);
  const lastWeekEnd = addDays(weekStart, -1);
  const fourWeekStart = addDays(today, -27);        // trailing 28 days
  const qMonth = [0, 0, 0, 3, 3, 3, 6, 6, 6, 9, 9, 9][Number(P.month) - 1];
  const qtdStart = new Date(`${P.year}-${String(qMonth + 1).padStart(2, "0")}-01T12:00:00Z`);
  const ytdStart = new Date(`${P.year}-01-01T12:00:00Z`);

  const blank = () => ({ gross: 0, net: 0, units: 0, orders: 0 });
  const out = { thisWeek: blank(), lastWeek: blank(), last4: blank(), qtd: blank(), ytd: blank(), tz, weekStart: ymd(weekStart) };
  let oldest = null;

  const query = `
    query Sales($after: String, $q: String!) {
      orders(first: 100, after: $after, query: $q) {
        pageInfo { hasNextPage endCursor }
        edges { node {
          createdAt
          currentSubtotalPriceSet { shopMoney { amount } }
          totalDiscountsSet { shopMoney { amount } }
          lineItems(first: 50) { edges { node { quantity } } }
        } }
      }
    }`;
  const q = `created_at:>=${ymd(ytdStart)} AND financial_status:paid AND -status:cancelled`;
  let after = null;
  for (let i = 0; i < 40; i++) {
    const data = await gql(shop, token, query, { after, q });
    const conn = data.orders;
    for (const edge of conn.edges) {
      const node = edge.node;
      const net = parseFloat(node.currentSubtotalPriceSet && node.currentSubtotalPriceSet.shopMoney && node.currentSubtotalPriceSet.shopMoney.amount) || 0;
      const disc = parseFloat(node.totalDiscountsSet && node.totalDiscountsSet.shopMoney && node.totalDiscountsSet.shopMoney.amount) || 0;
      const gross = net + disc; // pre-discount subtotal
      let units = 0;
      for (const li of ((node.lineItems && node.lineItems.edges) || [])) units += Number(li.node.quantity) || 0;
      const op = partsInTz(new Date(node.createdAt));
      if (node.createdAt && (!oldest || node.createdAt < oldest)) oldest = node.createdAt;
      const ods = `${op.year}-${op.month}-${op.day}`;
      const add = (b) => { b.gross += gross; b.net += net; b.units += units; b.orders += 1; };
      if (ods >= ymd(weekStart)) add(out.thisWeek);
      if (ods >= ymd(lastWeekStart) && ods <= ymd(lastWeekEnd)) add(out.lastWeek);
      if (ods >= ymd(fourWeekStart)) add(out.last4);
      if (ods >= ymd(qtdStart)) add(out.qtd);
      add(out.ytd);
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  for (const k of ["thisWeek", "lastWeek", "last4", "qtd", "ytd"]) {
    out[k].gross = Math.round(out[k].gross * 100) / 100;
    out[k].net = Math.round(out[k].net * 100) / 100;
  }
  // If the oldest order we can see is within ~60 days, the store almost
  // certainly lacks read_all_orders and older history is being withheld —
  // so Quarter/Year are truncated. Resolves itself once the scope is granted.
  out.limited = oldest ? (Date.now() - new Date(oldest).getTime()) < 62 * 86400000 : true;
  out.oldestOrder = oldest;
  return out;
}


// Custom date-range sales total (any start/end). Same money basis as the
// per-period feed: net = subtotal after discounts/returns, gross = pre-discount.
async function fetchSalesRange(shop, token, startYmd, endYmd) {
  let tz = "America/Los_Angeles";
  try { const sd = await gql(shop, token, `{ shop { ianaTimezone } }`, {}); if (sd && sd.shop && sd.shop.ianaTimezone) tz = sd.shop.ianaTimezone; } catch (_) {}
  const partsInTz = (date) => { const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }); const p = {}; f.formatToParts(date).forEach((x) => { p[x.type] = x.value; }); return p; };
  const out = { gross: 0, net: 0, units: 0, orders: 0, start: startYmd, end: endYmd, tz };
  let oldest = null;
  const query = `
    query Sales($after: String, $q: String!) {
      orders(first: 100, after: $after, query: $q) {
        pageInfo { hasNextPage endCursor }
        edges { node {
          createdAt
          currentSubtotalPriceSet { shopMoney { amount } }
          totalDiscountsSet { shopMoney { amount } }
          lineItems(first: 50) { edges { node { quantity } } }
        } }
      }
    }`;
  const q = `created_at:>=${startYmd} AND created_at:<=${endYmd}T23:59:59 AND financial_status:paid AND -status:cancelled`;
  let after = null;
  for (let i = 0; i < 60; i++) {
    const data = await gql(shop, token, query, { after, q });
    const conn = data.orders; if (!conn) break;
    for (const edge of conn.edges) {
      const node = edge.node;
      const net = parseFloat(node.currentSubtotalPriceSet && node.currentSubtotalPriceSet.shopMoney && node.currentSubtotalPriceSet.shopMoney.amount) || 0;
      const disc = parseFloat(node.totalDiscountsSet && node.totalDiscountsSet.shopMoney && node.totalDiscountsSet.shopMoney.amount) || 0;
      const gross = net + disc;
      let units = 0; for (const li of ((node.lineItems && node.lineItems.edges) || [])) units += Number(li.node.quantity) || 0;
      const op = partsInTz(new Date(node.createdAt)); const ods = `${op.year}-${op.month}-${op.day}`;
      if (node.createdAt && (!oldest || node.createdAt < oldest)) oldest = node.createdAt;
      if (ods >= startYmd && ods <= endYmd) { out.gross += gross; out.net += net; out.units += units; out.orders += 1; }
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  out.gross = Math.round(out.gross * 100) / 100;
  out.net = Math.round(out.net * 100) / 100;
  // Shopify withholds orders older than ~60 days without read_all_orders — warn
  // when the requested start reaches past that window.
  out.beyondWindow = (Date.now() - Date.parse(startYmd + "T00:00:00Z")) > 58 * 86400000;
  out.oldestOrder = oldest;
  return out;
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
  const auth = await kvGet("shopify_oauth");
  if (!auth || !auth.accessToken) {
    res.status(200).json({ connected: false });
    return;
  }

  if (req.method === "GET") {
    if (req.query && req.query.debug) {
      try {
        const products = await fetchProducts(auth.shop, auth.accessToken);
        const tree = products.map((p) => ({
          product: p.title,
          status: p.status,
          tracksInventory: p.tracksInventory,
          totalInventory: p.totalInventory,
          mappedToAppId: TITLE_MAP[(p.title || "").trim().toLowerCase()] ?? (VARIANT_SPLIT[(p.title || "").trim().toLowerCase()] ? "variant-split" : null),
          variants: p.variants.map((v) => ({ variant: v.title, sku: v.sku, qty: v.qty })),
        }));
        res.status(200).json({ shop: auth.shop, productCount: tree.length, tree });
      } catch (e) {
        res.status(500).json({ error: String(e).slice(0, 300) });
      }
      return;
    }
    if (req.query && req.query.op === "sales") {
      try {
        const ds = /^\d{4}-\d{2}-\d{2}$/;
        // Custom range: ?op=sales&start=YYYY-MM-DD&end=YYYY-MM-DD
        if (ds.test(req.query.start || "") && ds.test(req.query.end || "")) {
          const range = await fetchSalesRange(auth.shop, auth.accessToken, req.query.start, req.query.end);
          res.status(200).json({ connected: true, range });
          return;
        }
        const cached = await kvGet("shopify_sales");
        if (!req.query.refresh && cached && cached.syncedAt && (Date.now() - new Date(cached.syncedAt).getTime()) < 3600000) {
          res.status(200).json({ connected: true, cached: true, ...cached });
          return;
        }
        const periods = await fetchSalesByPeriod(auth.shop, auth.accessToken);
        const payload = { periods, syncedAt: new Date().toISOString() };
        await kvSet("shopify_sales", payload);
        res.status(200).json({ connected: true, ...payload });
      } catch (e) {
        res.status(500).json({ connected: true, error: String(e).slice(0, 300) });
      }
      return;
    }
    res.status(200).json({ connected: true, shop: auth.shop, lastSync: auth.lastSync || null });
    return;
  }

  try {
    const products = await fetchProducts(auth.shop, auth.accessToken);

    const qtyById = {};
    const unmatched = [];
    const variantDetail = {}; // appId -> [{ name, nameKey, qty, sold, ugc }]
    const addDetail = (id, name, qty) => {
      if (!variantDetail[id]) variantDetail[id] = [];
      variantDetail[id].push({ name, nameKey: name.trim().toLowerCase(), qty: Number(qty) || 0, sold: 0, ugc: 0 });
    };

    for (const p of products) {
      const pkey = (p.title || "").trim().toLowerCase();
      if (VARIANT_SPLIT[pkey]) {
        for (const v of p.variants) {
          const vkey = (v.title || "").trim().toLowerCase();
          const id = resolveId(pkey, vkey);
          if (id !== null) {
            qtyById[id] = (qtyById[id] || 0) + (Number(v.qty) || 0);
            addDetail(id, v.title || "", v.qty);
          }
        }
      } else if (TITLE_MAP[pkey] !== undefined) {
        const id = TITLE_MAP[pkey];
        qtyById[id] = (qtyById[id] || 0) + (Number(p.totalInventory) || 0);
        const meaningful = p.variants.filter((v) => (v.title || "").trim().toLowerCase() !== "default title");
        for (const v of meaningful) addDetail(id, v.title || "", v.qty);
      } else {
        unmatched.push({ title: p.title, qty: Number(p.totalInventory) || 0 });
      }
    }
    const items = Object.entries(qtyById).map(([id, qty]) => ({ productId: Number(id), qty }));

    let sold = [];
    let ugcSold = [];
    let soldUnmatched = [];
    let soldError = null;
    try {
      const { real, ugc } = await fetchSold30(auth.shop, auth.accessToken);
      const soldById = {};
      const ugcById = {};
      const apply = (totals, byId, field) => {
        for (const k of Object.keys(totals)) {
          const [pkey, vkey] = k.split("||");
          const id = resolveId(pkey, vkey);
          if (id === null) {
            if (field === "sold") soldUnmatched.push({ title: vkey ? `${pkey} (${vkey})` : pkey, qty: totals[k] });
            continue;
          }
          byId[id] = (byId[id] || 0) + totals[k];
          const rows = variantDetail[id];
          if (rows) {
            const row = rows.find((r) => r.nameKey === vkey);
            if (row) row[field] += totals[k];
          }
        }
      };
      apply(real, soldById, "sold");
      apply(ugc, ugcById, "ugc");
      sold = Object.entries(soldById).map(([id, qty]) => ({ productId: Number(id), qty }));
      ugcSold = Object.entries(ugcById).map(([id, qty]) => ({ productId: Number(id), qty }));
    } catch (e) {
      soldError = String(e).slice(0, 200);
    }

    // Strip internal nameKey before responding
    for (const id of Object.keys(variantDetail)) {
      variantDetail[id] = variantDetail[id].map(({ name, qty, sold: s, ugc: u }) => ({ name, qty, sold: s, ugc: u }));
    }

    const syncedAt = new Date().toISOString();
    await kvSet("shopify_oauth", { ...auth, lastSync: syncedAt });

    res.status(200).json({ connected: true, syncedAt, items, sold, ugcSold, variantDetail, unmatched, soldUnmatched, soldError });
  } catch (e) {
    res.status(500).json({ connected: true, error: String(e).slice(0, 300) });
  }
}
