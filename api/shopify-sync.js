// api/shopify-sync.js
// LAVALLE HAUS OS — Shopify live inventory + 30-day sales sync
// GET  -> { connected, shop, lastSync }
// POST -> { connected, syncedAt, items: [{ productId, title, qty }],
//          sold: [{ productId, qty }], unmatched }
//
// Inventory: GraphQL products.totalInventory (total across variants/locations).
// Sales: GraphQL orders from the last 30 days, summing line-item quantities per
// product title. Both map to app product IDs via TITLE_MAP. Needs read_orders.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const API_VERSION = "2025-10";

const TITLE_MAP = {
  "seashell sand wax candle set": 1,
  "sandwax refill pouch": 2,
  "mini spiced apple botanical candle": 4,
  "large spiced apple botanical candle": 5,
  "dough bowl sand wax candle set": 7,
  "vanilla cashmere sugar scrub": 8,
  "vanilla cashmere sugar scrub sample": 11,
  "mini spiced apple cider botanical candle sample": 12,
  "mini spiced apple cider botanical candle wholesale": 13,
  "spiced apple cider sandwax candle": 14,
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

async function fetchInventory(shop, token) {
  const query = `
    query Products($after: String) {
      products(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges { node { title status totalInventory } }
      }
    }`;
  let after = null;
  let all = [];
  for (let i = 0; i < 10; i++) {
    const data = await gql(shop, token, query, { after });
    const conn = data.products;
    all = all.concat(conn.edges.map((e) => e.node));
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return all;
}

async function fetchSold30(shop, token) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const query = `
    query Orders($after: String, $q: String!) {
      orders(first: 100, after: $after, query: $q) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            lineItems(first: 50) {
              edges { node { quantity product { title } } }
            }
          }
        }
      }
    }`;
  // Only paid, non-cancelled orders count as real sales. Refunded /
  // partially-refunded / voided / test orders are excluded so Sold/30d
  // reflects what actually sold and stayed sold.
  const q = `created_at:>=${since} AND financial_status:paid AND -status:cancelled`;
  const totals = {};
  let after = null;
  for (let i = 0; i < 20; i++) {
    const data = await gql(shop, token, query, { after, q });
    const conn = data.orders;
    for (const edge of conn.edges) {
      const lis = (edge.node.lineItems && edge.node.lineItems.edges) || [];
      for (const li of lis) {
        const title = (li.node.product && li.node.product.title) || "";
        const key = title.trim().toLowerCase();
        if (!key) continue;
        totals[key] = (totals[key] || 0) + (Number(li.node.quantity) || 0);
      }
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return totals;
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
    const products = await fetchInventory(auth.shop, auth.accessToken);

    const items = [];
    const unmatched = [];
    for (const p of products) {
      const key = (p.title || "").trim().toLowerCase();
      const qty = Number(p.totalInventory) || 0;
      if (TITLE_MAP[key] !== undefined) {
        items.push({ productId: TITLE_MAP[key], title: p.title, qty });
      } else {
        unmatched.push({ title: p.title, qty });
      }
    }

    let sold = [];
    let soldUnmatched = [];
    let soldError = null;
    try {
      const totals = await fetchSold30(auth.shop, auth.accessToken);
      for (const key of Object.keys(totals)) {
        if (TITLE_MAP[key] !== undefined) {
          sold.push({ productId: TITLE_MAP[key], qty: totals[key] });
        } else {
          soldUnmatched.push({ title: key, qty: totals[key] });
        }
      }
    } catch (e) {
      soldError = String(e).slice(0, 200);
    }

    const syncedAt = new Date().toISOString();
    await kvSet("shopify_oauth", { ...auth, lastSync: syncedAt });

    res.status(200).json({ connected: true, syncedAt, items, sold, unmatched, soldUnmatched, soldError });
  } catch (e) {
    res.status(500).json({ connected: true, error: String(e).slice(0, 300) });
  }
}
