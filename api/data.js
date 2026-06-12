import { createHmac } from "node:crypto";

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
  // Login: exchange the password for the session token
  if (req.method === "POST" && req.query && req.query.op === "login") {
    const pw = (req.body && req.body.password) || "";
    if (process.env.APP_PASSWORD && pw === process.env.APP_PASSWORD) {
      res.json({ token: appToken() });
    } else {
      res.status(401).json({ error: "Wrong password" });
    }
    return;
  }
  if (!isAuthed(req)) { res.status(401).json({ error: "Locked" }); return; }

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
