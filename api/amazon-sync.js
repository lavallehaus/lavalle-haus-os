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

export default async function handler(req, res) {
  const configured = Boolean(LWA_ID && LWA_SECRET && REFRESH_TOKEN);

  if (req.method === "GET") {
    if (!configured) {
      res.status(200).json({ connected: false, reason: "Missing AMZ_LWA_CLIENT_ID / AMZ_LWA_CLIENT_SECRET / AMZ_REFRESH_TOKEN env vars" });
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
