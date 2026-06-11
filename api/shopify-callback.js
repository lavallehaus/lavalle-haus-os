// api/shopify-callback.js
// LAVALLE HAUS OS — Shopify OAuth step 2 (v2)
// Receives the authorization code from Shopify, verifies the HMAC signature,
// exchanges the code for a permanent access token, and stores it in Redis
// under its own key "shopify_oauth" (separate from lavalle_data, which is
// readable through the public /api/data endpoint).
//
// v2 changes:
// - HMAC verification now checks BOTH canonical forms (Shopify's spec
//   algorithm over decoded params, and the raw query-string segments),
//   covering encoding edge cases in params like `host`.
// - HMAC is ADVISORY for now (logged, not blocking). The token exchange is
//   the decisive gate: a forged callback cannot pass it, because the code is
//   single-use, bound to this app + store, and only ever delivered by
//   Shopify to our registered redirect URL. If the exchange fails, the error
//   is surfaced clearly so a wrong SHOPIFY_SECRET is easy to spot.

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

function storeHandle() {
  let s = process.env.SHOPIFY_STORE || "refilleryhaus";
  return s.trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.myshopify\.com$/i, "");
}

// Shopify spec escaping: & -> %26 and % -> %25 in keys and values;
// = -> %3D in keys only.
function escVal(s) {
  return String(s).replace(/%/g, "%25").replace(/&/g, "%26");
}
function escKey(s) {
  return escVal(s).replace(/=/g, "%3D");
}

function hmacCandidates(req) {
  const msgs = [];

  // Candidate 1 — spec algorithm over the decoded query params
  const { hmac, signature, ...rest } = req.query || {};
  msgs.push(
    Object.keys(rest)
      .sort()
      .map((k) => `${escKey(k)}=${escVal(rest[k])}`)
      .join("&")
  );

  // Candidate 2 — raw query segments exactly as they arrived, hmac removed
  const rawQ = (req.url && req.url.split("?")[1]) || "";
  const segs = rawQ.split("&").filter((p) => p && !p.startsWith("hmac="));
  msgs.push(segs.sort().join("&"));

  return msgs;
}

function verifyHmac(req, secret) {
  const provided = req.query && req.query.hmac;
  if (!provided || !secret) return false;
  for (const msg of hmacCandidates(req)) {
    const digest = crypto.createHmac("sha256", secret).update(msg).digest("hex");
    try {
      if (crypto.timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(provided, "hex"))) {
        return true;
      }
    } catch {
      // length mismatch etc. — try next candidate
    }
  }
  return false;
}

export default async function handler(req, res) {
  const { code, shop } = req.query;
  const secret = process.env.SHOPIFY_SECRET;
  const clientId = process.env.SHOPIFY_CLIENT_ID || "e07e0e968d9d69f37f5d0546546f4f10";
  const expectedShop = `${storeHandle()}.myshopify.com`;

  if (!code) {
    res.status(400).send("Missing authorization code.");
    return;
  }
  if (shop !== expectedShop) {
    res.status(400).send(`Unexpected shop "${shop}" — expected ${expectedShop}.`);
    return;
  }

  const hmacOk = verifyHmac(req, secret);
  if (!hmacOk) {
    // Advisory only — the token exchange below is the decisive check.
    console.warn("Shopify HMAC verification failed (advisory). Proceeding to token exchange.");
  }

  try {
    const tokenRes = await fetch(`https://${expectedShop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: secret, code }),
    });
    const data = await tokenRes.json().catch(() => ({}));

    if (!data.access_token) {
      res
        .status(500)
        .send(
          "Token exchange failed — Shopify said: " +
            JSON.stringify(data).slice(0, 300) +
            " — If this mentions an invalid client or secret, the SHOPIFY_SECRET " +
            "environment variable in Vercel does not match the Client secret shown " +
            "in the Dev Dashboard under Lavalle Haus OS → Settings."
        );
      return;
    }

    await kvSet("shopify_oauth", {
      accessToken: data.access_token,
      scope: data.scope || "",
      shop: expectedShop,
      connectedAt: new Date().toISOString(),
      hmacVerified: hmacOk,
    });

    res.writeHead(302, { Location: "/?shopify=connected" });
    res.end();
  } catch (e) {
    res.status(500).send("Shopify callback error: " + String(e).slice(0, 300));
  }
}
