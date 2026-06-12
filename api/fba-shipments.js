import { createHmac } from "node:crypto";
// api/fba-shipments.js
// LAVALLE HAUS OS — FBA inbound shipments: list shipments + box label download.
// GET ?op=shipments                          -> { connected, shipments: [...] }
// GET ?op=labels&shipmentId=X&pageType=Y&count=N -> { downloadUrl }
//
// Phase A of the FBA label feature: works with shipments that already exist
// (created in Seller Central). Phase B adds in-app shipment creation.
// Uses the same LWA credentials as amazon-sync.js.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const LWA_ID = process.env.AMZ_LWA_CLIENT_ID;
const LWA_SECRET = process.env.AMZ_LWA_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.AMZ_REFRESH_TOKEN;

const SPAPI = "https://sellingpartnerapi-na.amazon.com";
const MARKETPLACE = "ATVPDKIKX0DER";

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

async function getAccessToken() {
  const cached = await kvGet("amazon_lwa");
  if (cached && cached.token && cached.exp && Date.now() < cached.exp - 300000) return cached.token;
  const r = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
      client_id: LWA_ID,
      client_secret: LWA_SECRET,
    }),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error(`LWA failed (${r.status}): ${JSON.stringify(d).slice(0, 200)}`);
  await kvSet("amazon_lwa", { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 });
  return d.access_token;
}

async function spapi(token, path) {
  const r = await fetch(`${SPAPI}${path}`, {
    headers: { "x-amz-access-token": token, "Content-Type": "application/json" },
  });
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); } catch { d = { raw: text.slice(0, 300) }; }
  if (!r.ok) throw new Error(`SP-API ${r.status} on ${path.split("?")[0]}: ${text.slice(0, 300)}`);
  return d;
}

async function spapiW(token, path, method, body) {
  const r = await fetch(`${SPAPI}${path}`, {
    method,
    headers: { "x-amz-access-token": token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); } catch { d = { raw: text.slice(0, 300) }; }
  if (!r.ok) throw new Error(`SP-API ${r.status} on ${path.split("?")[0]}: ${text.slice(0, 350)}`);
  return d;
}

const INBOUND = "/inbound/fba/2024-03-20";


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
  if (!isAuthed(req)) { res.status(401).json({ error: "Locked" }); return; }
  if (!(LWA_ID && LWA_SECRET && REFRESH_TOKEN)) {
    res.status(200).json({ connected: false, reason: "Amazon credentials not configured" });
    return;
  }
  const op = (req.query && req.query.op) || "shipments";

  try {
    const token = await getAccessToken();

    // ── WIZARD: ship-from address, stored in Redis ──
    if (op === "address") {
      if (req.method === "POST") {
        await kvSet("ship_from_address", (req.body && req.body.address) || {});
        res.status(200).json({ ok: true });
        return;
      }
      const a = await kvGet("ship_from_address");
      res.status(200).json({ connected: true, address: a || null });
      return;
    }

    // ── WIZARD: list inbound plans (drafts and active) ──
    if (op === "plans") {
      const d = await spapi(token, `${INBOUND}/inboundPlans?pageSize=20&sortBy=LAST_UPDATED_TIME&sortOrder=DESC`);
      const plans = (d.inboundPlans || []).map((p) => ({
        id: p.inboundPlanId,
        name: p.name,
        status: p.status,
        created: p.createdAt,
        updated: p.lastUpdatedAt,
        marketplaces: p.marketplaceIds,
      }));
      res.status(200).json({ connected: true, plans });
      return;
    }

    // ── WIZARD: create a draft inbound plan ──
    if (op === "createplan" && req.method === "POST") {
      const b = req.body || {};
      const a = b.address || {};
      const items = (b.items || []).filter((i) => i.msku && Number(i.quantity) > 0);
      if (!items.length) { res.status(400).json({ error: "No items with quantity > 0" }); return; }
      const payload = {
        destinationMarketplaces: [MARKETPLACE],
        name: b.name || `LH OS plan ${new Date().toISOString().slice(0, 10)}`,
        sourceAddress: {
          name: a.name,
          companyName: a.companyName || undefined,
          addressLine1: a.addressLine1,
          addressLine2: a.addressLine2 || undefined,
          city: a.city,
          stateOrProvinceCode: a.stateOrProvinceCode,
          postalCode: a.postalCode,
          countryCode: "US",
          phoneNumber: a.phoneNumber,
          email: a.email || undefined,
        },
        items: items.map((i) => ({
          msku: i.msku,
          quantity: Number(i.quantity),
          prepOwner: "SELLER",
          labelOwner: "SELLER",
        })),
      };
      const d = await spapiW(token, `${INBOUND}/inboundPlans`, "POST", payload);
      res.status(200).json({ connected: true, inboundPlanId: d.inboundPlanId, operationId: d.operationId });
      return;
    }

    // ── WIZARD: poll an async inbound operation ──
    if (op === "operation") {
      const d = await spapi(token, `${INBOUND}/operations/${encodeURIComponent(req.query.operationId || "")}`);
      res.status(200).json({ connected: true, status: d.operationStatus, problems: d.operationProblems || [] });
      return;
    }

    // ── WIZARD: packing options (generate / list / confirm) ──
    if (op === "packing") {
      const planId = encodeURIComponent(req.query.planId || "");
      const action = req.query.action || "list";
      if (action === "generate") {
        const d = await spapiW(token, `${INBOUND}/inboundPlans/${planId}/packingOptions`, "POST", {});
        res.status(200).json({ connected: true, operationId: d.operationId });
        return;
      }
      if (action === "confirm") {
        const optId = encodeURIComponent(req.query.optionId || "");
        const d = await spapiW(token, `${INBOUND}/inboundPlans/${planId}/packingOptions/${optId}/confirmation`, "POST", {});
        res.status(200).json({ connected: true, operationId: d.operationId });
        return;
      }
      const d = await spapi(token, `${INBOUND}/inboundPlans/${planId}/packingOptions?pageSize=20`);
      const options = (d.packingOptions || []).map((o) => ({
        id: o.packingOptionId,
        status: o.status,
        expiration: o.expiration,
        discounts: o.discounts || [],
        fees: o.fees || [],
        groupIds: o.packingGroups || [],
      }));
      res.status(200).json({ connected: true, options });
      return;
    }

    // ── WIZARD: items inside one packing group ──
    if (op === "packinggroupitems") {
      const planId = encodeURIComponent(req.query.planId || "");
      const groupId = encodeURIComponent(req.query.groupId || "");
      const d = await spapi(token, `${INBOUND}/inboundPlans/${planId}/packingGroups/${groupId}/items?pageSize=100`);
      const items = (d.items || []).map((i) => ({ msku: i.msku, quantity: i.quantity, asin: i.asin }));
      res.status(200).json({ connected: true, items });
      return;
    }

    if (op === "shipments") {
      const statuses = "WORKING,READY_TO_SHIP,SHIPPED,IN_TRANSIT,DELIVERED,CHECKED_IN,RECEIVING,CLOSED";
      const d = await spapi(
        token,
        `/fba/inbound/v0/shipments?QueryType=SHIPMENT&MarketplaceId=${MARKETPLACE}&ShipmentStatusList=${statuses}`
      );
      const list = (d.payload && d.payload.ShipmentData) || [];
      const shipments = list.map((s) => ({
        id: s.ShipmentId,
        name: s.ShipmentName,
        status: s.ShipmentStatus,
        destination: s.DestinationFulfillmentCenterId,
        labelPrepType: s.LabelPrepType,
        casesRequired: s.AreCasesRequired,
      }));
      res.status(200).json({ connected: true, shipments });
      return;
    }

    if (op === "items") {
      const shipmentId = req.query.shipmentId;
      if (!shipmentId) throw new Error("shipmentId required");
      const d = await spapi(
        token,
        `/fba/inbound/v0/shipments/${encodeURIComponent(shipmentId)}/items?MarketplaceId=${MARKETPLACE}`
      );
      const items = ((d.payload && d.payload.ItemData) || []).map((it) => ({
        sku: it.SellerSKU,
        qtyShipped: it.QuantityShipped,
        qtyReceived: it.QuantityReceived,
      }));
      res.status(200).json({ connected: true, items });
      return;
    }

    if (op === "labels") {
      const shipmentId = req.query.shipmentId;
      if (!shipmentId) throw new Error("shipmentId required");
      const pageType = req.query.pageType || "PackageLabel_Letter_6";
      const count = Math.max(1, Math.min(999, parseInt(req.query.count, 10) || 1));
      const d = await spapi(
        token,
        `/fba/inbound/v0/shipments/${encodeURIComponent(shipmentId)}/labels?PageType=${encodeURIComponent(pageType)}&LabelType=BARCODE_2D&NumberOfPackages=${count}`
      );
      const url = d.payload && d.payload.TransportDocument && d.payload.TransportDocument.DownloadURL;
      if (!url) throw new Error("No label document returned: " + JSON.stringify(d).slice(0, 200));
      res.status(200).json({ connected: true, downloadUrl: url });
      return;
    }

    res.status(400).json({ error: "Unknown op" });
  } catch (e) {
    res.status(500).json({ connected: true, error: String(e).slice(0, 400) });
  }
}
