// api/categorize.js — Lavalle Haus OS
// Reads a bank-statement PDF with the Claude API (server-side, key stays secret)
// and returns categorized transactions + token usage so the app can show cost.
//
// Setup: add ANTHROPIC_API_KEY in Vercel → Project → Settings → Environment Variables.
// Frontend POSTs { pdfBase64, knownMerchants } and receives { transactions, usage }.

import { createHmac } from "node:crypto";

// ── APP LOCK ── same session check as /api/data: without it this endpoint is
// an open Claude-API proxy on the business's key. No APP_PASSWORD = lock off.
const SESSION_SALT = "lavalle-haus-session-v1";
function appToken() {
  return createHmac("sha256", process.env.APP_PASSWORD || "").update(SESSION_SALT).digest("hex");
}
function isAuthed(req) {
  if (!process.env.APP_PASSWORD) return true;
  return (req.headers["x-app-token"] || "") === appToken();
}

const MODEL = "claude-sonnet-4-6"; // balanced + accurate; ~$3/$15 per 1M tokens
const CATEGORIES = [
  "Revenue / Sales", "Refunds", "COGS / Materials", "Packaging", "Shipping / Postage",
  "Advertising", "Software / SaaS", "Merchant / Bank Fees", "Office / Supplies",
  "Travel", "Meals", "Contractors / Labor", "Taxes", "Owner Draw / Transfer",
  "Other Expense", "Uncategorized",
];

export default async function handler(req, res) {
  if (!isAuthed(req)) { res.status(401).json({ error: "Locked" }); return; }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in Vercel environment variables." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  // Generic AI passthrough: any feature can POST { system, messages, max_tokens }.
  // Keeps the key server-side and avoids browser CORS. Model is fixed to a known-good one.
  if (body && Array.isArray(body.messages)) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: Math.min(Number(body.max_tokens) || 1024, 4096),
          system: body.system || undefined,
          messages: body.messages,
        }),
      });
      const data = await r.json();
      if (!r.ok) { res.status(502).json({ error: (data && data.error && data.error.message) || "Claude API error", detail: data }); return; }
      res.status(200).json({ content: data.content || [], usage: data.usage || {} });
    } catch (e) { res.status(500).json({ error: "Request failed: " + (e && e.message ? e.message : String(e)) }); }
    return;
  }

  // Transaction categorize: accepts { transactions:[{id,description,merchant,amount,type}], knownMerchants }
  // returns { transactions:[{id,merchant,type,category}] } using the fixed category list + rules.
  if (body && Array.isArray(body.transactions)) {
    const txns = body.transactions.slice(0, 150);
    const knownMerchants = (body && body.knownMerchants) || {};
    const rulesText = Object.keys(knownMerchants).length
      ? "Known merchant rules (PREFER these categories when the merchant matches): " + JSON.stringify(knownMerchants)
      : "No known merchant rules yet.";
    const instr =
      "You are a bookkeeping assistant building a P&L for a candle and body-care business. " +
      "Categorize each bank transaction below. For EACH, return its id unchanged, a short normalized merchant name " +
      "(e.g. 'Meta', 'USPS', 'Amazon', 'Stripe'), type ('income' for deposits/sales, 'expense' for purchases/fees), " +
      "and a category chosen ONLY from this list: " + CATEGORIES.join(", ") + ". " + rulesText + " " +
      "If unsure, use 'Uncategorized'. Return ONLY JSON shaped exactly: " +
      '{"transactions":[{"id":"","merchant":"","type":"expense","category":""}]}. Transactions: ' +
      JSON.stringify(txns.map((t) => ({ id: t.id, description: t.description, merchant: t.merchant, amount: t.amount, type: t.type })));
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content: instr }] }),
      });
      const data = await r.json();
      if (!r.ok) { res.status(502).json({ error: (data && data.error && data.error.message) || "Claude API error", detail: data }); return; }
      const tb = (data.content || []).find((b) => b.type === "text");
      let parsed = { transactions: [] };
      if (tb && tb.text) { try { parsed = JSON.parse(tb.text.replace(/```json|```/g, "").trim()); } catch (e) {} }
      res.status(200).json({ transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [], usage: data.usage || {} });
    } catch (e) { res.status(500).json({ error: "Request failed: " + (e && e.message ? e.message : String(e)) }); }
    return;
  }

  const pdfBase64 = body && body.pdfBase64;
  const knownMerchants = (body && body.knownMerchants) || {};
  if (!pdfBase64) {
    res.status(400).json({ error: "No PDF provided." });
    return;
  }

  const rulesText = Object.keys(knownMerchants).length
    ? "Known merchant rules (PREFER these categories when the merchant matches): " + JSON.stringify(knownMerchants)
    : "No known merchant rules yet.";

  const instructions =
    "You are a bookkeeping assistant building a P&L from a bank statement PDF. " +
    "Extract EVERY transaction. For each, return: date (YYYY-MM-DD), description (as printed), " +
    "merchant (a short normalized name, e.g. 'Meta', 'USPS', 'Amazon', 'Stripe'), amount (positive number, no sign), " +
    "type ('income' for deposits/credits/sales, 'expense' for debits/purchases/fees), and category. " +
    "Choose category ONLY from this list: " + CATEGORIES.join(", ") + ". " +
    rulesText + " " +
    "If unsure, use 'Uncategorized'. Ignore running balances and non-transaction lines. " +
    "Return ONLY a JSON object, no markdown, no commentary, shaped exactly: " +
    '{"transactions":[{"date":"","description":"","merchant":"","amount":0,"type":"expense","category":""}]}';

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
            { type: "text", text: instructions },
          ],
        }],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      res.status(502).json({ error: (data && data.error && data.error.message) || "Claude API error", detail: data });
      return;
    }

    const textBlock = (data.content || []).find((b) => b.type === "text");
    let parsed = { transactions: [] };
    if (textBlock && textBlock.text) {
      const clean = textBlock.text.replace(/```json|```/g, "").trim();
      try { parsed = JSON.parse(clean); } catch { parsed = { transactions: [] }; }
    }
    const transactions = Array.isArray(parsed.transactions) ? parsed.transactions : [];

    res.status(200).json({
      transactions,
      usage: data.usage || { input_tokens: 0, output_tokens: 0 },
    });
  } catch (e) {
    res.status(500).json({ error: "Request failed: " + (e && e.message ? e.message : String(e)) });
  }
}
