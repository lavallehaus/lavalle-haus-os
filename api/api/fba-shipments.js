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

export default async function handler(req, res) {
  if (!(LWA_ID && LWA_SECRET && REFRESH_TOKEN)) {
    res.status(200).json({ connected: false, reason: "Amazon credentials not configured" });
    return;
  }
  const op = (req.query && req.query.op) || "shipments";

  try {
    const token = await getAccessToken();

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
