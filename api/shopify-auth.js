// api/shopify-auth.js
// LAVALLE HAUS OS — Shopify OAuth step 1
// Redirects the browser to Shopify's authorization page for the store.
// On approval, Shopify redirects back to /api/shopify-callback with a code.

export default async function handler(req, res) {
  const store = process.env.SHOPIFY_STORE || "refilleryhaus";
  const clientId = process.env.SHOPIFY_CLIENT_ID || "e07e0e968d9d69f37f5d0546546f4f10";
  const redirectUri = "https://lavalle-haus-os.vercel.app/api/shopify-callback";
  // write_draft_orders lets the PR board stage gifting orders as DRAFTS — never
  // placed orders. A draft sits in Shopify until Kiabeth reviews the address and
  // completes it herself, so nothing ships on the app's say-so.
  const scopes = "read_products,read_inventory,read_orders,write_draft_orders";

  const url =
    `https://${store}.myshopify.com/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.writeHead(302, { Location: url });
  res.end();
}
