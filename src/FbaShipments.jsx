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

// ── PHASE B1: CREATE-SHIPMENT WIZARD ─────────────────────────────────────────
// Address → items → create draft plan → packing options. Every step that
// writes to Amazon sits behind an explicit confirmation gate. Placement,
// carrier and labels are Phase B2.
const card = { background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: 14, marginBottom: 10 };
const inputS = { background: "#e5e1da", border: `1px solid ${c.line}`, color: c.ink, fontSize: 12, padding: "7px 9px", borderRadius: 1, boxSizing: "border-box" };
const btnDark = { padding: "8px 18px", fontSize: 10, fontFamily: sans, letterSpacing: 2, cursor: "pointer", borderRadius: 1, border: "1px solid #1a1714", background: "#1a1714", color: "#f7f4ef", textTransform: "uppercase" };
const btnGhost = { padding: "8px 14px", fontSize: 10, fontFamily: sans, letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: `1px solid ${c.line}`, background: "transparent", color: c.sub, textTransform: "uppercase" };

function CreateShipmentWizard({ onPlanCreated }) {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(1);
  const [addr, setAddr] = useState({ name: "", companyName: "", addressLine1: "", addressLine2: "", city: "", stateOrProvinceCode: "", postalCode: "", phoneNumber: "", email: "" });
  const [addrLoaded, setAddrLoaded] = useState(false);
  const [skus, setSkus] = useState({ loading: false, rows: [], error: null });
  const [qty, setQty] = useState({}); // msku -> string
  const [status, setStatus] = useState(null); // progress / error line
  const [planId, setPlanId] = useState(null);
  const [packing, setPacking] = useState({ phase: "idle", options: [], groupItems: {}, confirmedId: null });

  useEffect(() => {
    if (!show || addrLoaded) return;
    fetch("/api/fba-shipments?op=address").then(r => r.json()).then(d => {
      if (d.address) setAddr(a => ({ ...a, ...d.address }));
      setAddrLoaded(true);
    }).catch(() => setAddrLoaded(true));
  }, [show]);

  useEffect(() => {
    if (!show || skus.rows.length || skus.loading) return;
    setSkus({ loading: true, rows: [], error: null });
    fetch("/api/amazon-sync", { method: "POST" }).then(r => r.json()).then(d => {
      const rows = [];
      const detail = d.skuDetail || {};
      const items = d.items || [];
      const nameById = {};
      for (const it of items) nameById[it.id] = it.name;
      for (const pid of Object.keys(detail)) {
        for (const s of detail[pid]) {
          rows.push({ msku: s.sku, fba: s.fba, inbound: s.inbound, productName: nameById[pid] || "" });
        }
      }
      rows.sort((a, b) => (a.productName + a.msku).localeCompare(b.productName + b.msku));
      setSkus({ loading: false, rows, error: rows.length ? null : "No FBA SKUs found" });
    }).catch(e => setSkus({ loading: false, rows: [], error: String(e) }));
  }, [show]);

  const addrOk = addr.name && addr.addressLine1 && addr.city && addr.stateOrProvinceCode && addr.postalCode && addr.phoneNumber;
  const chosen = Object.entries(qty).map(([msku, q]) => ({ msku, quantity: Number(q) || 0 })).filter(i => i.quantity > 0);

  async function saveAddress() {
    setStatus("Saving address…");
    await fetch("/api/fba-shipments?op=address", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: addr }) });
    setStatus(null);
    setStep(2);
  }

  async function pollOperation(operationId, label) {
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 2500));
      const d = await fetch(`/api/fba-shipments?op=operation&operationId=${encodeURIComponent(operationId)}`).then(r => r.json());
      if (d.status === "SUCCESS") return true;
      if (d.status === "FAILED") {
        const why = (d.problems || []).map(p => p.message || p.code).join("; ").slice(0, 300);
        throw new Error(`${label} failed: ${why || "Amazon reported FAILED"}`);
      }
      setStatus(`${label} — Amazon is working (${d.status || "…"})`);
    }
    throw new Error(`${label} timed out — reopen the wizard in a minute; the plan may still complete`);
  }

  async function createPlan() {
    setStatus("Creating draft plan in Amazon…");
    try {
      const d = await fetch("/api/fba-shipments?op=createplan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr, items: chosen }),
      }).then(r => r.json());
      if (!d.inboundPlanId) throw new Error(d.error || "Plan was not created");
      setPlanId(d.inboundPlanId);
      await pollOperation(d.operationId, "Plan creation");
      setStatus(null);
      setStep(4);
      if (onPlanCreated) onPlanCreated();
    } catch (e) { setStatus(`✗ ${String(e).slice(0, 300)}`); }
  }

  async function generatePacking() {
    setPacking(p => ({ ...p, phase: "generating" }));
    setStatus("Asking Amazon for packing options…");
    try {
      const g = await fetch(`/api/fba-shipments?op=packing&action=generate&planId=${encodeURIComponent(planId)}`).then(r => r.json());
      await pollOperation(g.operationId, "Packing options");
      const l = await fetch(`/api/fba-shipments?op=packing&action=list&planId=${encodeURIComponent(planId)}`).then(r => r.json());
      const options = l.options || [];
      // pull contents of each packing group so options are readable
      const groupItems = {};
      for (const o of options) {
        for (const gid of o.groupIds.slice(0, 5)) {
          try {
            const gi = await fetch(`/api/fba-shipments?op=packinggroupitems&planId=${encodeURIComponent(planId)}&groupId=${encodeURIComponent(gid)}`).then(r => r.json());
            groupItems[gid] = gi.items || [];
          } catch { groupItems[gid] = []; }
        }
      }
      setPacking({ phase: "listed", options, groupItems, confirmedId: null });
      setStatus(null);
    } catch (e) {
      setPacking(p => ({ ...p, phase: "idle" }));
      setStatus(`✗ ${String(e).slice(0, 300)}`);
    }
  }

  async function confirmPacking(optionId) {
    setStatus("Confirming packing structure…");
    try {
      const d = await fetch(`/api/fba-shipments?op=packing&action=confirm&planId=${encodeURIComponent(planId)}&optionId=${encodeURIComponent(optionId)}`).then(r => r.json());
      await pollOperation(d.operationId, "Packing confirmation");
      setPacking(p => ({ ...p, phase: "confirmed", confirmedId: optionId }));
      setStatus(null);
    } catch (e) { setStatus(`✗ ${String(e).slice(0, 300)}`); }
  }

  if (!show) {
    return (
      <button onClick={() => setShow(true)} style={{ ...btnDark, marginBottom: 14 }}>＋ Create shipment</button>
    );
  }

  const StepDot = ({ n, label }) => (
    <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1, color: step === n ? c.ink : c.sub, borderBottom: step === n ? `2px solid ${c.clay}` : "none", paddingBottom: 2 }}>{n}. {label}</span>
  );

  return (
    <div style={{ ...card, borderLeft: `3px solid ${c.clay}`, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans }}>Create shipment · Phase B wizard</div>
          <div style={{ fontSize: 10, fontStyle: "italic", color: "rgba(111,102,87,0.55)", fontFamily: serif }}>Crear envío — cada paso que toca Amazon pide tu confirmación</div>
        </div>
        <button onClick={() => setShow(false)} style={btnGhost}>CLOSE</button>
      </div>
      <div style={{ display: "flex", gap: 14, margin: "10px 0 12px", flexWrap: "wrap" }}>
        <StepDot n={1} label="SHIP FROM" /><StepDot n={2} label="ITEMS" /><StepDot n={3} label="CREATE PLAN" /><StepDot n={4} label="PACKING" />
      </div>

      {step === 1 && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, maxWidth: 560 }}>
            <input style={inputS} placeholder="Full name *" value={addr.name} onChange={e => setAddr({ ...addr, name: e.target.value })} />
            <input style={inputS} placeholder="Company (optional)" value={addr.companyName} onChange={e => setAddr({ ...addr, companyName: e.target.value })} />
            <input style={{ ...inputS, gridColumn: "1 / -1" }} placeholder="Address line 1 *" value={addr.addressLine1} onChange={e => setAddr({ ...addr, addressLine1: e.target.value })} />
            <input style={{ ...inputS, gridColumn: "1 / -1" }} placeholder="Address line 2 (optional)" value={addr.addressLine2} onChange={e => setAddr({ ...addr, addressLine2: e.target.value })} />
            <input style={inputS} placeholder="City *" value={addr.city} onChange={e => setAddr({ ...addr, city: e.target.value })} />
            <input style={inputS} placeholder="State code (e.g. CA) *" maxLength={2} value={addr.stateOrProvinceCode} onChange={e => setAddr({ ...addr, stateOrProvinceCode: e.target.value.toUpperCase() })} />
            <input style={inputS} placeholder="ZIP *" value={addr.postalCode} onChange={e => setAddr({ ...addr, postalCode: e.target.value })} />
            <input style={inputS} placeholder="Phone *" value={addr.phoneNumber} onChange={e => setAddr({ ...addr, phoneNumber: e.target.value })} />
            <input style={{ ...inputS, gridColumn: "1 / -1" }} placeholder="Email (optional)" value={addr.email} onChange={e => setAddr({ ...addr, email: e.target.value })} />
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={saveAddress} disabled={!addrOk} style={{ ...btnDark, opacity: addrOk ? 1 : 0.4 }}>Save & continue ›</button>
            <span style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10, color: "rgba(111,102,87,0.55)" }}>Saved once, remembered for every future shipment — guardada una vez, recordada para siempre</span>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          {skus.loading && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>Loading your FBA SKUs from Amazon…</div>}
          {skus.error && <div style={{ fontFamily: sans, fontSize: 11, color: c.red }}>{skus.error}</div>}
          {skus.rows.map(r => (
            <div key={r.msku} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "4px 0", borderBottom: "1px solid #00000008", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontFamily: serif, fontSize: 14, color: c.ink }}>{r.productName || r.msku}</span>
                <span style={{ fontFamily: sans, fontSize: 9, color: c.sub, marginLeft: 8 }}>{r.msku} · {r.fba} at FBA{r.inbound ? ` · ${r.inbound} inbound` : ""}</span>
              </div>
              <input value={qty[r.msku] || ""} onChange={e => setQty({ ...qty, [r.msku]: e.target.value.replace(/[^0-9]/g, "") })} placeholder="0"
                style={{ ...inputS, width: 70, textAlign: "center" }} />
            </div>
          ))}
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button onClick={() => setStep(1)} style={btnGhost}>‹ Back</button>
            <button onClick={() => setStep(3)} disabled={!chosen.length} style={{ ...btnDark, opacity: chosen.length ? 1 : 0.4 }}>Review ›</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <div style={{ fontFamily: sans, fontSize: 11, color: c.sub, marginBottom: 6 }}>SHIPPING FROM: <span style={{ color: c.ink }}>{addr.addressLine1}, {addr.city} {addr.stateOrProvinceCode} {addr.postalCode}</span></div>
          {chosen.map(i => (
            <div key={i.msku} style={{ display: "flex", justifyContent: "space-between", fontFamily: sans, fontSize: 12, color: c.ink, padding: "3px 0", borderBottom: "1px solid #00000008" }}>
              <span>{i.msku}</span><span>{i.quantity} units</span>
            </div>
          ))}
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.clay, margin: "10px 0" }}>
            Gate 1: this creates a DRAFT inbound plan inside Amazon. No fees, no commitment, fully abandonable — packing, placement and carrier each ask again before anything binds.
            <br/>Compuerta 1: esto crea un plan BORRADOR en Amazon. Sin costos ni compromiso — cada paso siguiente vuelve a preguntar.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep(2)} style={btnGhost}>‹ Back</button>
            <button onClick={createPlan} style={btnDark}>Create draft plan</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div>
          <div style={{ fontFamily: sans, fontSize: 11, color: c.green, marginBottom: 8 }}>✓ Draft plan created · {planId}</div>
          {packing.phase === "idle" && (
            <button onClick={generatePacking} style={btnDark}>Get packing options</button>
          )}
          {packing.phase === "listed" && packing.options.map((o, i) => (
            <div key={o.id} style={{ border: `1px solid ${c.line}`, borderRadius: 1, padding: 10, marginBottom: 8 }}>
              <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1, color: c.sub }}>OPTION {i + 1} · {o.groupIds.length} packing group{o.groupIds.length !== 1 ? "s" : ""}{o.fees.length ? ` · fees apply` : ""}{o.discounts.length ? ` · discount available` : ""}</div>
              {o.groupIds.map(gid => (
                <div key={gid} style={{ fontFamily: sans, fontSize: 11, color: c.ink, marginTop: 4 }}>
                  ▸ Group: {(packing.groupItems[gid] || []).map(it => `${it.msku} ×${it.quantity}`).join(" · ") || "…"}
                </div>
              ))}
              <button onClick={() => confirmPacking(o.id)} style={{ ...btnDark, marginTop: 8 }}>Confirm this packing (Gate 2)</button>
            </div>
          ))}
          {packing.phase === "confirmed" && (
            <div style={{ fontFamily: sans, fontSize: 11, color: c.green }}>
              ✓ Packing structure confirmed. <span style={{ color: c.sub }}>Phase B2 continues from here: box contents & weights, placement (where Amazon routes the boxes), carrier, and labels — each behind its own gate.</span>
            </div>
          )}
        </div>
      )}

      {status && <div style={{ fontFamily: sans, fontSize: 11, color: status.startsWith("✗") ? c.red : c.clay, marginTop: 10 }}>{status}</div>}
    </div>
  );
}

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
        Pick a label format and box count, then ⎙ BOX LABELS opens the printable PDF — or start a new shipment below.
      </div>

      <CreateShipmentWizard onPlanCreated={load} />

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
