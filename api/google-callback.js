// api/google-callback.js — Lavalle Haus OS
// Google redirects here after the user approves. We exchange the auth code for
// tokens and store the refresh token in Redis under a SEPARATE key
// ("google_oauth") that is never exposed through /api/data — keeping the token
// out of the app's public data blob. Then we send the user back to the app.
//
// Needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, KV_REST_API_URL, KV_REST_API_TOKEN.

const REDIRECT = "https://lavalle-haus-os.vercel.app/api/google-callback";
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KEY = "google_oauth";

async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${key}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}
async function kvSet(key, val) {
  await fetch(`${KV_URL}/set/${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "text/plain" },
    body: JSON.stringify(val),
  });
}

export default async function handler(req, res) {
  const code = req.query && req.query.code;
  const err = req.query && req.query.error;
  if (err) { res.status(400).send("Google authorization was cancelled or denied."); return; }
  if (!code) { res.status(400).send("Missing authorization code."); return; }

  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT,
      }),
    });
    const tok = await r.json();
    if (!r.ok) { res.status(502).send("Token exchange failed: " + JSON.stringify(tok)); return; }

    const existing = (await kvGet(KEY)) || {};
    if (tok.refresh_token) existing.refresh_token = tok.refresh_token;
    if (!existing.refresh_token) {
      res.status(400).send(
        "No refresh token was returned. In your Google account, remove Lavalle Haus OS under " +
        "Security > Third-party access, then click Connect again."
      );
      return;
    }
    await kvSet(KEY, existing);

    res.writeHead(302, { Location: "/?drive=connected" });
    res.end();
  } catch (e) {
    res.status(500).send("OAuth error: " + (e && e.message ? e.message : String(e)));
  }
}
