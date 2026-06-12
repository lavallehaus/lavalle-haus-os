import { useState, useEffect } from "react";

// LAVALLE HAUS OS — FBA Shipments & Labels (Phase A)
// Lists live inbound shipments from Amazon and prints/reprints box labels
// without logging into Seller Central. Phase B will add in-app shipment
// creation. Read-only against app data: no Redis writes (no undo needed).

const c = {
  bg: "#f7f4ef", ink: "#1a1714", sub: "#8c7d6b", line: "#c8c2b8",
  green: "#5a7a5a", clay: "#a07848", red: "#9b5e5e", card: "#efece5",
};
const serif = "'IM Fell English', Georgia, serif";
const sans = "monospace";

const STATUS_COLOR = {
  WORKING: c.clay, READY_TO_SHIP: c.clay, SHIPPED: c.green, IN_TRANSIT: c.green,
  DELIVERED: c.green, CHECKED_IN: c.green, RECEIVING: c.green, CLOSED: c.sub,
  CANCELLED: c.red, DELETED: c.red, ERROR: c.red,
};

const PAGE_TYPES = [
  ["PackageLabel_Letter_6", "Letter — 6 per page"],
  ["PackageLabel_Letter_4", "Letter — 4 per page"],
  ["PackageLabel_Letter_2", "Letter — 2 per page"],
  ["PackageLabel_Thermal", "Thermal printer"],
  ["PackageLabel_Plain_Paper", "Plain paper — 1 per page"],
];

export default function FbaShipments() {
  const [state, setState] = useState({ loading: true, connected: false, shipments: [], error: null });
  const [open, setOpen] = useState(null); // shipmentId expanded
  const [items, setItems] = useState({}); // shipmentId -> items[]
  const [pageType, setPageType] = useState("PackageLabel_Letter_6");
  const [count, setCount] = useState("1");
  const [busy, setBusy] = useState(null); // shipmentId fetching labels
  const [err, setErr] = useState(null);

  async function load() {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const r = await fetch("/api/fba-shipments?op=shipments");
      const d = await r.json();
      if (d.error) setState({ loading: false, connected: true, shipments: [], error: d.error });
      else setState({ loading: false, connected: !!d.connected, shipments: d.shipments || [], error: d.reason || null });
    } catch (e) {
      setState({ loading: false, connected: false, shipments: [], error: String(e) });
    }
  }
  useEffect(() => { load(); }, []);

  async function toggleItems(id) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    if (!items[id]) {
      try {
        const r = await fetch(`/api/fba-shipments?op=items&shipmentId=${encodeURIComponent(id)}`);
        const d = await r.json();
        setItems(prev => ({ ...prev, [id]: d.items || [] }));
      } catch {
        setItems(prev => ({ ...prev, [id]: [] }));
      }
    }
  }

  async function getLabels(id) {
    setBusy(id); setErr(null);
    try {
      const r = await fetch(`/api/fba-shipments?op=labels&shipmentId=${encodeURIComponent(id)}&pageType=${encodeURIComponent(pageType)}&count=${encodeURIComponent(count || "1")}`);
      const d = await r.json();
      if (d.downloadUrl) window.open(d.downloadUrl, "_blank");
      else setErr(d.error || "No label returned — check the shipment status.");
    } catch (e) {
      setErr(String(e));
    }
    setBusy(null);
  }

  const active = state.shipments.filter(s => s.status !== "CLOSED" && s.status !== "CANCELLED" && s.status !== "DELETED");
  const past = state.shipments.filter(s => !active.includes(s));

  const card = { background: c.card, border: `1px solid ${c.line}`, borderRadius: 2, padding: "14px 16px", marginBottom: 10 };

  function ShipmentCard({ s }) {
    const color = STATUS_COLOR[s.status] || c.sub;
    return (
      <div style={{ ...card, borderLeft: `3px solid ${color}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: serif, fontSize: 16, color: c.ink }}>{s.name || s.id}</div>
            <div style={{ fontFamily: sans, fontSize: 10, color: c.sub, marginTop: 2 }}>
              {s.id} · → {s.destination || "?"} · <span style={{ color }}>{s.status}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <select value={pageType} onChange={e => setPageType(e.target.value)}
              style={{ background: "#e5e1da", border: `1px solid ${c.line}`, color: c.ink, fontSize: 11, padding: "5px 6px", borderRadius: 1 }}>
              {PAGE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input value={count} onChange={e => setCount(e.target.value.replace(/[^0-9]/g, ""))} title="Number of boxes"
              style={{ width: 44, background: "#e5e1da", border: `1px solid ${c.line}`, color: c.ink, fontSize: 11, padding: "5px 6px", borderRadius: 1, textAlign: "center" }} />
            <button onClick={() => getLabels(s.id)} disabled={busy === s.id}
              style={{ background: "transparent", border: `1px solid ${c.green}`, color: c.green, borderRadius: 1, padding: "5px 14px", cursor: busy === s.id ? "default" : "pointer", fontSize: 10, fontFamily: sans, letterSpacing: 1 }}>
              {busy === s.id ? "GENERATING…" : "⎙ BOX LABELS"}
            </button>
          </div>
        </div>
        <div onClick={() => toggleItems(s.id)} style={{ cursor: "pointer", marginTop: 8, fontSize: 10, fontFamily: sans, letterSpacing: 1, color: c.sub }}>
          {open === s.id ? "▾ CONTENTS" : "▸ CONTENTS"}
        </div>
        {open === s.id && (
          <div style={{ marginTop: 6, borderLeft: `2px solid ${c.line}`, paddingLeft: 10 }}>
            {(items[s.id] || []).map((it, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: sans, color: c.sub, padding: "2px 0" }}>
                <span>{it.sku}</span>
                <span>{it.qtyShipped} shipped{it.qtyReceived ? ` · ${it.qtyReceived} received` : ""}</span>
              </div>
            ))}
            {items[s.id] && items[s.id].length === 0 && <div style={{ fontSize: 11, fontStyle: "italic", color: c.sub }}>No items found.</div>}
            {!items[s.id] && <div style={{ fontSize: 11, fontStyle: "italic", color: c.sub }}>Loading…</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div>
          <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 400, color: c.ink, margin: 0 }}>FBA Shipments & Labels</h1>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: "rgba(111,102,87,0.6)" }}>Envíos FBA y etiquetas — sin entrar a Seller Central</div>
        </div>
        <button onClick={load} style={{ background: "transparent", border: `1px solid ${c.line}`, color: c.sub, borderRadius: 1, padding: "5px 14px", cursor: "pointer", fontSize: 10, fontFamily: sans, letterSpacing: 1 }}>REFRESH</button>
      </div>
      <div style={{ fontSize: 11, fontFamily: sans, color: c.sub, marginBottom: 16 }}>
        Pick a label format and box count, then ⎙ BOX LABELS opens the printable PDF. Creating new shipments in-app is Phase B.
      </div>

      {state.loading && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>Loading shipments from Amazon…</div>}
      {!state.loading && state.error && (
        <div style={{ ...card, borderLeft: `3px solid ${c.red}` }}>
          <div style={{ fontFamily: sans, fontSize: 11, color: c.red }}>{String(state.error)}</div>
        </div>
      )}
      {!state.loading && !state.error && active.length === 0 && (
        <div style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>No active shipments. Closed ones are below.</div>
      )}

      {active.map(s => <ShipmentCard key={s.id} s={s} />)}
      {err && <div style={{ fontFamily: sans, fontSize: 11, color: c.red, margin: "6px 0" }}>{err}</div>}

      {past.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 9, letterSpacing: 4, color: "#b0a89a", textTransform: "uppercase", fontFamily: sans, marginBottom: 8 }}>Closed / Past</div>
          {past.map(s => <ShipmentCard key={s.id} s={s} />)}
        </div>
      )}
    </div>
  );
}
