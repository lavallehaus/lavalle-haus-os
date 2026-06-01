import crypto from "crypto";

// Map Shopify product titles to your app's product IDs
const PRODUCT_MAP = {
"Vanilla Cashmere Sugar Scrub": 8,
"Seashell Sand Wax Candle Set": 1,
"Mini Spiced Apple Botanical Candle": 4,
"Large Spiced Apple Botanical Candle": 5,
"Sandwax Refill Pouch": 2,
"Dough Bowl Sand Wax Candle Set": 7,
"Honey Onyx Candle Set": 7,
"Italian Viola Calcatta Candle Set": 7,
};

async function dbLoad(url, token) {
const r = await fetch(`${url}/get/lavalle_data`, {
headers: { Authorization: `Bearer ${token}` },
});
const d = await r.json();
let data = d.result ? JSON.parse(d.result) : null;
if (Array.isArray(data)) data = data[0];
return data || { products: [], materials: [], weekly: [] };
}

async function dbSave(url, token, record) {
await fetch(`${url}/set/lavalle_data`, {
method: "POST",
headers: {
Authorization: `Bearer ${token}`,
"Content-Type": "application/json",
},
body: JSON.stringify(record),
});
}

export default async function handler(req, res) {
if (req.method !== "POST") {
return res.status(405).json({ error: "Method not allowed" });
}

// Verify webhook is from Shopify
const hmac = req.headers["x-shopify-hmac-sha256"];
const secret = process.env.SHOPIFY_SECRET;
const body = JSON.stringify(req.body);
const hash = crypto
.createHmac("sha256", secret)
.update(body, "utf8")
.digest("base64");

if (hash !== hmac) {
return res.status(401).json({ error: "Unauthorized" });
}

const topic = req.headers["x-shopify-topic"];

// Only process paid orders
if (topic !== "orders/paid" && topic !== "orders/fulfilled") {
return res.status(200).json({ ok: true });
}

const order = req.body;
const kvUrl = process.env.KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN;

// Load current data
const data = await dbLoad(kvUrl, kvToken);

// Decrement inventory for each item in the order
let updated = false;
for (const item of order.line_items || []) {
const productTitle = item.title;
const quantity = item.quantity;

// Find matching product by title or partial match
const productId = PRODUCT_MAP[productTitle];
if (productId) {
data.products = data.products.map((p) => {
if (p.id === productId) {
const newAvailable = Math.max(0, (p.available || 0) - quantity);
console.log(`Shopify order: ${productTitle} -${quantity} units. ${p.available} → ${newAvailable}`);
updated = true;
return {
...p,
available: newAvailable,
unitsSold30: (p.unitsSold30 || 0) + quantity,
};
}
return p;
});
} else {
console.log(`No match found for Shopify product: ${productTitle}`);
}
}

if (updated) {
await dbSave(kvUrl, kvToken, data);
console.log("Inventory updated from Shopify order");
}

res.status(200).json({ ok: true });
}
