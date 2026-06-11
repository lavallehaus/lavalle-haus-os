// api/shopify-callback.js
// LAVALLE HAUS OS — Shopify OAuth step 2
// Receives the authorization code from Shopify, verifies the HMAC signature,
// exchanges the code for a permanent access token, and stores it in Redis
// under its own key "shopify_oauth" (separate from lavalle_data, which is
// readable through the public /api/data endpoint).

import crypto from "crypto";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvSet(key, value) {
  await fetch(`${KV_URL}/set/${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(value),
  });
}

// Shopify signs the callback query string with the app secret.
// Rebuild the message (all params except hmac, sorted, k=v joined by &)
// and compare digests in constant time.
function verifyHmac(query, secret) {
  const { hmac, ...rest } = query;
  if (!hmac || !secret) return false;
  const msg = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("&");
  const digest = crypto.createHmac("sha256", secret).update(msg).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(hmac, "hex"));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const { code, shop } = req.query;
  const secret = process.env.SHOPIFY_SECRET;
  const clientId = process.env.SHOPIFY_CLIENT_ID || "e07e0e968d9d69f37f5d0546546f4f10";
  const store = process.env.SHOPIFY_STORE || "refilleryhaus";
  const expectedShop = `${store}.myshopify.com`;

  if (!code) {
    res.status(400).send("Missing authorization code.");
    return;
  }
  if (shop !== expectedShop) {
    res.status(400).send(`Unexpected shop "${shop}" — expected ${expectedShop}.`);
    return;
  }
  if (!verifyHmac(req.query, secret)) {
    res.status(401).send("HMAC verification failed — request did not come from Shopify.");
    return;
  }

  try {
    const tokenRes = await fetch(`https://${expectedShop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: secret, code }),
    });
    const data = await tokenRes.json();

    if (!data.access_token) {
      res.status(500).send("Token exchange failed: " + JSON.stringify(data).slice(0, 300));
      return;
    }

    await kvSet("shopify_oauth", {
      accessToken: data.access_token,
      scope: data.scope || "",
      shop: expectedShop,
      connectedAt: new Date().toISOString(),
    });

    res.writeHead(302, { Location: "/?shopify=connected" });
    res.end();
  } catch (e) {
    res.status(500).send("Shopify callback error: " + String(e).slice(0, 300));
  }
}
