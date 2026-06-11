// api/shopify-sync.js
// LAVALLE HAUS OS — Shopify live inventory + 30-day sales sync (variant-aware)
// GET             -> { connected, shop, lastSync }
// GET ?debug=1    -> full product/variant tree with stock + tracking flags
// POST            -> { connected, syncedAt, items, sold, unmatched, soldUnmatched }
//
// Most products map at the product level via TITLE_MAP. Products whose
// variants belong to DIFFERENT app products (e.g. Sandwax Refill Pouch:
// 16oz vs 32oz) are split per-variant via VARIANT_SPLIT.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const API_VERSION = "2025-10";

// Product title (lowercased) -> app product ID
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

// Product title (lowercased) -> variant routing rules. First rule whose
// `match` appears in the lowercased variant title wins; its qty goes to `id`.
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

// Aggregated sold units in the last 30 days from paid, non-cancelled orders,
// keyed by product title + variant title (both lowercased).
async function fetchSold30(shop, token) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const query = `
    query Orders($after: String, $q: String!) {
      orders(first: 100, after: $after, query: $q) {
        pageInfo { hasNextPage endCursor }
        edges { node {
          lineItems(first: 50) {
            edges { node { quantity product { title } variant { title } } }
          }
        } }
      }
    }`;
  const q = `created_at:>=${since} AND financial_status:paid AND -status:cancelled`;
  const totals = {}; // "ptitle||vtitle" -> qty
  let after = null;
  for (let i = 0; i < 20; i++) {
    const data = await gql(shop, token, query, { after, q });
    const conn = data.orders;
    for (const edge of conn.edges) {
      const lis = (edge.node.lineItems && edge.node.lineItems.edges) || [];
      for (const li of lis) {
        const pkey = ((li.node.product && li.node.product.title) || "").trim().toLowerCase();
        const vkey = ((li.node.variant && li.node.variant.title) || "").trim().toLowerCase();
        if (!pkey) continue;
        const k = pkey + "||" + vkey;
        totals[k] = (totals[k] || 0) + (Number(li.node.quantity) || 0);
      }
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return totals;
}

// Resolve a product title (+ optional variant title) to an app product ID.
function resolveId(pkey, vkey) {
  const split = VARIANT_SPLIT[pkey];
  if (split) {
    const rule = split.find((r) => (vkey || "").includes(r.match));
    return rule ? rule.id : null;
  }
  return TITLE_MAP[pkey] !== undefined ? TITLE_MAP[pkey] : null;
}

export default async function handler(req, res) {
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
    res.status(200).json({ connected: true, shop: auth.shop, lastSync: auth.lastSync || null });
    return;
  }

  try {
    const products = await fetchProducts(auth.shop, auth.accessToken);

    const qtyById = {};
    const unmatched = [];
    for (const p of products) {
      const pkey = (p.title || "").trim().toLowerCase();
      if (VARIANT_SPLIT[pkey]) {
        for (const v of p.variants) {
          const id = resolveId(pkey, (v.title || "").trim().toLowerCase());
          if (id !== null) qtyById[id] = (qtyById[id] || 0) + (Number(v.qty) || 0);
        }
      } else if (TITLE_MAP[pkey] !== undefined) {
        const id = TITLE_MAP[pkey];
        qtyById[id] = (qtyById[id] || 0) + (Number(p.totalInventory) || 0);
      } else {
        unmatched.push({ title: p.title, qty: Number(p.totalInventory) || 0 });
      }
    }
    const items = Object.entries(qtyById).map(([id, qty]) => ({ productId: Number(id), qty }));

    let sold = [];
    let soldUnmatched = [];
    let soldError = null;
    try {
      const totals = await fetchSold30(auth.shop, auth.accessToken);
      const soldById = {};
      for (const k of Object.keys(totals)) {
        const [pkey, vkey] = k.split("||");
        const id = resolveId(pkey, vkey);
        if (id !== null) soldById[id] = (soldById[id] || 0) + totals[k];
        else soldUnmatched.push({ title: vkey ? `${pkey} (${vkey})` : pkey, qty: totals[k] });
      }
      sold = Object.entries(soldById).map(([id, qty]) => ({ productId: Number(id), qty }));
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
