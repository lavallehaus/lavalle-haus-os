import { createHmac } from "node:crypto";

// LAVALLE HAUS OS — Plaid endpoint (bank balances → cash runway).
// Access tokens live only in Redis, never in the browser. Guarded by the same
// app password as the rest of the API. One serverless function, op-switched.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const PLAID_ENV = process.env.PLAID_ENV || "production";
const PLAID_BASE =
  PLAID_ENV === "sandbox" ? "https://sandbox.plaid.com"
  : PLAID_ENV === "development" ? "https://development.plaid.com"
  : "https://production.plaid.com";
const CLIENT_ID = process.env.PLAID_CLIENT_ID || "";
const SECRET = process.env.PLAID_SECRET || "";
const REDIRECT_URI = process.env.PLAID_REDIRECT_URI || "";

const SESSION_SALT = "lavalle-haus-session-v1";
function appToken() { return createHmac("sha256", process.env.APP_PASSWORD || "").update(SESSION_SALT).digest("hex"); }
function isAuthed(req) { if (!process.env.APP_PASSWORD) return true; return (req.headers["x-app-token"] || "") === appToken(); }

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

async function plaid(path, body) {
  const r = await fetch(`${PLAID_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, secret: SECRET, ...body }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_message || d.error_code || `Plaid ${r.status}`);
  return d;
}

export default async function handler(req, res) {
  if (!isAuthed(req)) { res.status(401).json({ error: "Locked" }); return; }
  if (!CLIENT_ID || !SECRET) { res.status(400).json({ error: "Plaid credentials not set in Vercel (PLAID_CLIENT_ID, PLAID_SECRET)." }); return; }
  const op = (req.query && req.query.op) || "";
  try {
    if (op === "link_token") {
      const body = {
        user: { client_user_id: "lavalle-haus" },
        client_name: "Lavalle Haus OS",
        products: ["transactions"],
        country_codes: ["US"],
        language: "en",
      };
      if (REDIRECT_URI) body.redirect_uri = REDIRECT_URI;
      const d = await plaid("/link/token/create", body);
      res.status(200).json({ link_token: d.link_token });
      return;
    }

    if (op === "exchange" && req.method === "POST") {
      const { public_token, institution } = req.body || {};
      if (!public_token) { res.status(400).json({ error: "Missing public_token" }); return; }
      const d = await plaid("/item/public_token/exchange", { public_token });
      const items = (await kvGet("plaid_items")) || [];
      if (!items.some((x) => x.item_id === d.item_id)) {
        items.push({ item_id: d.item_id, access_token: d.access_token, institution: institution || "Bank", addedAt: new Date().toISOString() });
      }
      await kvSet("plaid_items", items.slice(-10));
      res.status(200).json({ ok: true, item_id: d.item_id });
      return;
    }

    if (op === "balances") {
      const items = (await kvGet("plaid_items")) || [];
      const accounts = [];
      let totalCash = 0;
      for (const it of items) {
        try {
          const d = await plaid("/accounts/balance/get", { access_token: it.access_token });
          for (const a of d.accounts || []) {
            const bal = (a.balances && (a.balances.available != null ? a.balances.available : a.balances.current)) || 0;
            if (a.type === "depository") totalCash += Number(bal) || 0;
            accounts.push({
              item_id: it.item_id, institution: it.institution,
              name: a.name, mask: a.mask || null, type: a.type, subtype: a.subtype,
              available: a.balances ? a.balances.available : null,
              current: a.balances ? a.balances.current : null,
              currency: a.balances ? a.balances.iso_currency_code : "USD",
            });
          }
        } catch (e) {
          accounts.push({ item_id: it.item_id, institution: it.institution, error: String(e).slice(0, 160) });
        }
      }
      res.status(200).json({ connected: items.length > 0, accounts, totalCash, updatedAt: new Date().toISOString() });
      return;
    }

    if (op === "items") {
      const items = (await kvGet("plaid_items")) || [];
      res.status(200).json({ items: items.map((i) => ({ item_id: i.item_id, institution: i.institution, addedAt: i.addedAt })) });
      return;
    }

    if (op === "remove" && req.method === "POST") {
      const { item_id } = req.body || {};
      const items = (await kvGet("plaid_items")) || [];
      const it = items.find((x) => x.item_id === item_id);
      if (it) { try { await plaid("/item/remove", { access_token: it.access_token }); } catch (e) { /* drop locally anyway */ } }
      await kvSet("plaid_items", items.filter((x) => x.item_id !== item_id));
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: "Unknown op" });
  } catch (e) {
    res.status(500).json({ error: String(e).slice(0, 400) });
  }
}
