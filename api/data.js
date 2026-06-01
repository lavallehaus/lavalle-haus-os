export default async function handler(req, res) {
const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;

if (req.method === "GET") {
const r = await fetch(`${url}/get/lavalle_data`, {
headers: { Authorization: `Bearer ${token}` }
});
const d = await r.json();
let data = d.result ? JSON.parse(d.result) : null;
// Fix: if data is an array (old bug), unwrap it
if (Array.isArray(data)) data = data[0];
res.json(data || { products: [], materials: [], weekly: [] });
} else if (req.method === "POST") {
const body = req.body;
await fetch(`${url}/set/lavalle_data`, {
method: "POST",
headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
body: JSON.stringify(body)
});
res.json({ ok: true });
}
}
