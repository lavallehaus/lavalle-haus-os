// api/shopify-sync.js
// LAVALLE HAUS OS — Shopify live inventory sync
// GET  -> { connected, shop, lastSync }   (connection status check)
// POST -> { connected, syncedAt, items: [{ productId, title, qty }], unmatched }
//
// Uses the GraphQL Admin API (the recommended path — Shopify's REST product
// endpoints are legacy). totalInventory gives the total stock across all
// variants and locations per product, which is exactly what the app needs.
// Shopify titles are mapped to app product IDs via TITLE_MAP below.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const API_VERSION = "2025-10";

// Exact Shopify product titles (lowercased) -> app product IDs.
// From the dev handoff mapping table. Add new lines here as products launch.
const TITLE_MAP = {
  "seashell sand wax candle set": 1, // SeaShell Vessel Candle
  "sandwax refill pouch": 2, // Beeswax Candle Sand 16oz
  "mini spiced apple botanical candle": 4, // Small Apple Vanilla Candle
  "large spiced apple botanical candle": 5, // Large Apple Vanilla Candle
  "dough bowl sand wax candle set": 7, // Dough Bowl Vessel Candle
  "vanilla cashmere sugar scrub": 8, // Sugar Scrub
};

async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const d = await r.json();
  if (!d || d.result == null) return null;
  try {
    return JSON.parse(d.result);
  } catch {
    return null;
  }
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
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
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

export default async function handler(req, res) {
  const auth = await kvGet("shopify_oauth");
  if (!auth || !auth.accessToken) {
    res.status(200).json({ connected: false });
    return;
  }

  if (req.method === "GET") {
    res.status(200).json({ connected: true, shop: auth.shop, lastSync: auth.lastSync || null });
    return;
  }

  try {
    const query = `
      query Products($after: String) {
        products(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          edges { node { title status totalInventory } }
        }
      }`;

    let after = null;
    let all = [];
    // Loop pages defensively; the store has ~10 products so one page suffices.
    for (let i = 0; i < 10; i++) {
      const data = await gql(auth.shop, auth.accessToken, query, { after });
      const conn = data.products;
      all = all.concat(conn.edges.map((e) => e.node));
      if (!conn.pageInfo.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }

    const items = [];
    const unmatched = [];
    for (const p of all) {
      const key = (p.title || "").trim().toLowerCase();
      const qty = Number(p.totalInventory) || 0;
      if (TITLE_MAP[key] !== undefined) {
        items.push({ productId: TITLE_MAP[key], title: p.title, qty });
      } else {
        unmatched.push({ title: p.title, qty });
      }
    }

    const syncedAt = new Date().toISOString();
    await kvSet("shopify_oauth", { ...auth, lastSync: syncedAt });

    res.status(200).json({ connected: true, syncedAt, items, unmatched });
  } catch (e) {
    res.status(500).json({ connected: true, error: String(e).slice(0, 300) });
  }
}
