import { useState, useMemo } from "react";

/* ============================================================================
   LAVALLE HAUS OS — REORDER LIST (Inventory → Reorder List)
   Turns "you're going to stock out" into "order THIS many units, from THIS
   supplier, by THIS date." Three sections:
     1) Finished goods — velocity engine. Per-SKU: units/day → days of cover →
        stockout date → reorder-by date (stockout − lead time − safety) →
        suggested order qty (target weeks of cover, minus on-hand + inbound,
        rounded up to MOQ).
     2) Packaging — flagged when on-hand ≤ reorder point.
     3) Raw materials — flagged by status (out / reorder).
   Per-SKU lead time, target cover, MOQ and supplier link are editable and
   saved; global defaults sit at the top. Full Undo/Redo on every change.
   Each line can be sent to Action Items (with inline undo).

     <ReorderList products={...} packaging={...} materials={...}
                  data={dbState.reorder||{}} onSave={fn}
                  onAddAction={fn} onRemoveAction={fn} />
   ========================================================================== */

const c = {
  bg: "#f7f4ef", panel: "#fffdf9", ink: "#1a1714", sub: "#8c7d6b",
  line: "#d8d1c4", lineSoft: "#ece7dd", clay: "#a07848", green: "#5a7a5a",
  red: "#9b5e5e", amber: "#b06a2e", slate: "#7a7a9a",
};
const serif = "'IM Fell English', Georgia, serif";
const mono = "monospace";
const faintEs = { fontFamily: serif, fontSize: 10.5, fontStyle: "italic", color: "rgba(140,125,107,0.7)", marginTop: 1 };

const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? 0 : Number(v));
const money = (n) => "$" + num(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

const S = {
  wrap: { fontFamily: serif, color: c.ink, maxWidth: 1100, margin: "0 auto" },
  h1: { fontSize: 27, fontWeight: 400, margin: 0 },
  sec: { fontSize: 17, fontWeight: 400, margin: "26px 0 10px", borderBottom: `1px solid ${c.line}`, paddingBottom: 7 },
  panel: { background: c.panel, border: `1px solid ${c.line}`, borderRadius: 3, padding: 14, marginBottom: 10 },
  cap: { fontFamily: mono, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase", color: c.sub },
  btn: { background: "transparent", border: `1px solid ${c.clay}`, color: c.clay, borderRadius: 2, padding: "5px 11px", cursor: "pointer", fontFamily: mono, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase" },
  ghost: { background: "transparent", border: `1px solid ${c.line}`, color: c.sub, borderRadius: 2, padding: "5px 11px", cursor: "pointer", fontFamily: mono, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase" },
  input: { background: "#efece5", border: `1px solid ${c.line}`, color: c.ink, fontSize: 12, padding: "4px 7px", borderRadius: 1, fontFamily: mono, width: 64, boxSizing: "border-box" },
};

const STATUS = {
  now: { label: "REORDER NOW", color: c.red, rank: 0 },
  soon: { label: "REORDER SOON", color: c.amber, rank: 1 },
  overstock: { label: "OVERSTOCK · DELAY", color: c.slate, rank: 3 },
  healthy: { label: "HEALTHY", color: c.green, rank: 2 },
  dormant: { label: "NO SALES YET", color: c.sub, rank: 4 },
};

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtDate = (d) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");

export default function ReorderList({
  products = [], packaging = [], materials = [], data = {},
  onSave, onAddAction, onRemoveAction,
}) {
  const DEF = { leadTimeDays: 21, targetWeeks: 8, safetyDays: 7, ...(data.defaults || {}) };

  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [state, setState] = useState(() => ({ settings: data.settings || {}, defaults: DEF }));
  const [open, setOpen] = useState({}); // rowId -> settings panel open
  const [sent, setSent] = useState({}); // rowId -> action-item id

  const commit = (next) => { setPast((p) => [...p.slice(-49), state]); setFuture([]); setState(next); if (onSave) onSave(next); };
  const undo = () => { if (!past.length) return; const prev = past[past.length - 1]; setPast((p) => p.slice(0, -1)); setFuture((f) => [state, ...f].slice(0, 50)); setState(prev); if (onSave) onSave(prev); };
  const redo = () => { if (!future.length) return; const nxt = future[0]; setFuture((f) => f.slice(1)); setPast((p) => [...p.slice(-49), state]); setState(nxt); if (onSave) onSave(nxt); };

  const d = state.defaults;
  const setDefault = (k, v) => commit({ ...state, defaults: { ...state.defaults, [k]: num(v) } });
  const setSetting = (id, k, v) => commit({ ...state, settings: { ...state.settings, [id]: { ...(state.settings[id] || {}), [k]: v } } });

  const today = startOfToday();

  // ── Finished-goods reorder engine ──
  const rows = useMemo(() => {
    return products.filter((p) => !p.isSample).map((p) => {
      const set = state.settings[p.id] || {};
      const lead = set.leadTimeDays != null && set.leadTimeDays !== "" ? num(set.leadTimeDays) : num(d.leadTimeDays);
      const target = set.targetWeeks != null && set.targetWeeks !== "" ? num(set.targetWeeks) : num(d.targetWeeks);
      const moq = num(set.moq);
      const link = set.supplierLink || "";
      const perDay = num(p.unitsSold30) / 30;
      const available = num(p.available);
      const inbound = num(p.inbound);
      const onHandInbound = available + inbound;
      const coverDays = perDay > 0 ? Math.round(available / perDay) : (available > 0 ? Infinity : 0);
      const coverWeeks = coverDays === Infinity ? Infinity : Math.round(coverDays / 7);
      const stockout = perDay > 0 ? addDays(today, available / perDay) : null;
      const reorderBy = stockout ? addDays(stockout, -(lead + num(d.safetyDays))) : null;
      const orderUpTo = Math.ceil(target * 7 * perDay);
      let qty = Math.max(0, orderUpTo - onHandInbound);
      if (qty > 0 && moq) qty = Math.max(qty, moq);

      let status;
      if (perDay === 0 && available === 0 && inbound === 0) status = "dormant";
      else if (perDay === 0) status = available > 0 ? "overstock" : "dormant";
      else if (perDay > 0 && onHandInbound > orderUpTo * 2) status = "overstock";
      else if (qty <= 0) status = "healthy";
      else if (reorderBy && reorderBy.getTime() <= today.getTime()) status = "now";
      else status = "soon";

      return { id: "fg:" + p.id, pid: p.id, name: p.name, available, inbound, perDay, coverWeeks, stockout, reorderBy, qty, lead, target, moq, link, status, channels: p.channels || [] };
    }).sort((a, b) => {
      const ra = STATUS[a.status].rank, rb = STATUS[b.status].rank;
      if (ra !== rb) return ra - rb;
      const ta = a.reorderBy ? a.reorderBy.getTime() : Infinity, tb = b.reorderBy ? b.reorderBy.getTime() : Infinity;
      return ta - tb;
    });
  }, [products, state, d]);

  const pkgFlags = useMemo(() => packaging.filter((p) => num(p.reorderPoint) > 0 && num(p.onHand) <= num(p.reorderPoint))
    .map((p, i) => ({ id: "pkg:" + (p.id || i), name: p.component || "Packaging item", onHand: num(p.onHand), rp: num(p.reorderPoint), moq: num(p.moq), supplier: p.supplier || "", link: p.link || "", qty: num(p.moq) || Math.max(1, num(p.reorderPoint) * 2 - num(p.onHand)) })), [packaging]);

  const rawFlags = useMemo(() => materials.filter((m) => m.status === "out" || m.status === "reorder")
    .map((m) => ({ id: "raw:" + m.id, name: m.name, status: m.status, note: m.note || "", link: m.buyLink || "", cost: m.estCost })), [materials]);

  const counts = useMemo(() => {
    const k = { now: 0, soon: 0, overstock: 0 };
    rows.forEach((r) => { if (k[r.status] != null) k[r.status] += 1; });
    return { ...k, pkg: pkgFlags.length, raw: rawFlags.length };
  }, [rows, pkgFlags, rawFlags]);

  function send(row, item) {
    if (!onAddAction) return;
    const id = "ro_" + Date.now() + "_" + String(row.id).replace(/[^a-z0-9]/gi, "");
    onAddAction({ id, source: "coo", ...item, assigneeId: null, status: "open", createdAt: new Date().toISOString() });
    setSent((s) => ({ ...s, [row.id]: id }));
  }
  function unsend(row) {
    const id = sent[row.id];
    if (id && onRemoveAction) onRemoveAction(id);
    setSent((s) => { const n = { ...s }; delete n[row.id]; return n; });
  }

  const SendCell = ({ row, item }) => {
    if (!onAddAction) return null;
    return sent[row.id]
      ? <span style={{ fontFamily: mono, fontSize: 9.5, color: c.green }}>✓ sent · <button onClick={() => unsend(row)} style={{ background: "none", border: "none", color: c.clay, cursor: "pointer", fontFamily: mono, fontSize: 9.5, textDecoration: "underline", padding: 0 }}>undo</button></span>
      : <button onClick={() => send(row, item)} style={S.btn}>→ Action Item</button>;
  };

  const LinkBtn = ({ href }) => href ? <a href={href} target="_blank" rel="noreferrer" style={{ ...S.ghost, textDecoration: "none", display: "inline-block" }}>↗ Buy</a> : null;

  return (
    <div style={S.wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={S.h1}>Reorder List</h1>
          <div style={faintEs}>Lista de reorden — qué pedir, cuánto y para cuándo</div>
          <div style={{ fontSize: 13, color: c.sub, marginTop: 6 }}>
            <span style={{ color: c.red }}>{counts.now} reorder now</span> · <span style={{ color: c.amber }}>{counts.soon} soon</span> · <span style={{ color: c.slate }}>{counts.overstock} overstock</span> · {counts.pkg} packaging · {counts.raw} materials
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={undo} disabled={!past.length} style={{ ...S.ghost, opacity: past.length ? 1 : 0.4, cursor: past.length ? "pointer" : "not-allowed" }}>↶ Undo</button>
          <button onClick={redo} disabled={!future.length} style={{ ...S.ghost, opacity: future.length ? 1 : 0.4, cursor: future.length ? "pointer" : "not-allowed" }}>↷ Redo</button>
        </div>
      </div>

      {/* Global defaults */}
      <div style={{ ...S.panel, marginTop: 14, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
        <span style={S.cap}>Defaults</span>
        <label style={{ fontSize: 12, color: c.ink }}>Lead time (days) <input style={S.input} type="number" value={d.leadTimeDays} onChange={(e) => setDefault("leadTimeDays", e.target.value)} /></label>
        <label style={{ fontSize: 12, color: c.ink }}>Target cover (weeks) <input style={S.input} type="number" value={d.targetWeeks} onChange={(e) => setDefault("targetWeeks", e.target.value)} /></label>
        <label style={{ fontSize: 12, color: c.ink }}>Safety buffer (days) <input style={S.input} type="number" value={d.safetyDays} onChange={(e) => setDefault("safetyDays", e.target.value)} /></label>
        <span style={{ ...faintEs, flexBasis: "100%" }}>Per-SKU overrides live in each row's ⚙. · Los ajustes por SKU están en ⚙ de cada fila.</span>
      </div>

      {/* Finished goods */}
      <div style={S.sec}>Finished Goods<div style={faintEs}>Bienes terminados</div></div>
      {rows.filter((r) => r.status !== "dormant").length === 0 && <div style={{ ...S.panel, fontFamily: mono, fontSize: 12, color: c.green }}>Nothing to reorder. Stock is healthy. · Nada que reordenar.</div>}
      {rows.filter((r) => r.status !== "dormant").map((r) => {
        const st = STATUS[r.status];
        return (
          <div key={r.id} style={{ ...S.panel, borderLeft: `3px solid ${st.color}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: 1, color: "#fff", background: st.color, padding: "1px 6px", borderRadius: 2 }}>{st.label}</span>
                <div style={{ fontSize: 15, marginTop: 4 }}>{r.name}</div>
                <div style={{ fontSize: 11.5, color: c.sub, marginTop: 2 }}>{(r.channels || []).join(" · ")}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))", gap: 10, flex: 2, minWidth: 280 }}>
                <div><div style={S.cap}>On hand</div><div style={{ fontSize: 14 }}>{r.available}{r.inbound ? ` +${r.inbound}` : ""}</div></div>
                <div><div style={S.cap}>Velocity</div><div style={{ fontSize: 14 }}>{r.perDay > 0 ? `${r.perDay.toFixed(2)}/day` : "—"}</div></div>
                <div><div style={S.cap}>Cover</div><div style={{ fontSize: 14 }}>{r.coverWeeks === Infinity ? "∞" : r.coverWeeks + "w"}</div></div>
                <div><div style={S.cap}>Stockout</div><div style={{ fontSize: 14 }}>{fmtDate(r.stockout)}</div></div>
                <div><div style={S.cap}>Order by</div><div style={{ fontSize: 14, color: r.status === "now" ? c.red : c.ink }}>{r.status === "now" ? "now" : fmtDate(r.reorderBy)}</div></div>
                <div><div style={S.cap}>Order qty</div><div style={{ fontSize: 16, color: c.clay }}>{r.qty > 0 ? r.qty : "—"}</div></div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))} style={S.ghost}>⚙ {open[r.id] ? "close" : "settings"}</button>
              <LinkBtn href={r.link} />
              {r.qty > 0 && <SendCell row={r} item={{ title: `Reorder ${r.qty} units — ${r.name}`, detail: `On hand ${r.available}${r.inbound ? " +" + r.inbound + " inbound" : ""}, selling ${(r.perDay * 30).toFixed(0)}/mo (~${r.coverWeeks === Infinity ? "∞" : r.coverWeeks}w cover). ${r.status === "now" ? "Order now" : "Order by " + fmtDate(r.reorderBy)} · lead ${r.lead}d.`, name: r.name, severity: r.status === "now" ? "high" : "med" }} />}
            </div>
            {open[r.id] && (
              <div style={{ display: "flex", gap: 14, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.lineSoft}`, flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ fontSize: 11.5, color: c.sub }}>Lead days <input style={S.input} type="number" placeholder={String(d.leadTimeDays)} value={(state.settings[r.pid] || {}).leadTimeDays ?? ""} onChange={(e) => setSetting(r.pid, "leadTimeDays", e.target.value)} /></label>
                <label style={{ fontSize: 11.5, color: c.sub }}>Target wks <input style={S.input} type="number" placeholder={String(d.targetWeeks)} value={(state.settings[r.pid] || {}).targetWeeks ?? ""} onChange={(e) => setSetting(r.pid, "targetWeeks", e.target.value)} /></label>
                <label style={{ fontSize: 11.5, color: c.sub }}>MOQ <input style={S.input} type="number" value={(state.settings[r.pid] || {}).moq ?? ""} onChange={(e) => setSetting(r.pid, "moq", e.target.value)} /></label>
                <label style={{ fontSize: 11.5, color: c.sub }}>Supplier link <input style={{ ...S.input, width: 220 }} type="url" placeholder="https://…" value={(state.settings[r.pid] || {}).supplierLink ?? ""} onChange={(e) => setSetting(r.pid, "supplierLink", e.target.value)} /></label>
              </div>
            )}
          </div>
        );
      })}

      {/* Packaging */}
      <div style={S.sec}>Packaging Below Reorder Point<div style={faintEs}>Empaque bajo el punto de reorden</div></div>
      {pkgFlags.length === 0 ? <div style={{ ...S.panel, fontFamily: mono, fontSize: 12, color: c.sub }}>No packaging below reorder point. · Sin empaque por debajo del punto.</div>
        : pkgFlags.map((p) => (
          <div key={p.id} style={{ ...S.panel, borderLeft: `3px solid ${c.amber}`, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 14 }}>{p.name}</div>
              <div style={{ fontSize: 11.5, color: c.sub }}>{p.onHand} on hand · reorder pt {p.rp}{p.supplier ? ` · ${p.supplier}` : ""}</div>
            </div>
            <div style={{ fontSize: 13, color: c.clay }}>order {p.qty}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <LinkBtn href={p.link} />
              <SendCell row={p} item={{ title: `Reorder packaging — ${p.name}`, detail: `${p.onHand} on hand, reorder point ${p.rp}. Suggested order ${p.qty}${p.supplier ? " from " + p.supplier : ""}.`, name: p.name, severity: "med" }} />
            </div>
          </div>
        ))}

      {/* Raw materials */}
      <div style={S.sec}>Raw Materials Flagged<div style={faintEs}>Materias primas marcadas</div></div>
      {rawFlags.length === 0 ? <div style={{ ...S.panel, fontFamily: mono, fontSize: 12, color: c.sub }}>No materials flagged. · Sin materiales marcados.</div>
        : rawFlags.map((m) => (
          <div key={m.id} style={{ ...S.panel, borderLeft: `3px solid ${m.status === "out" ? c.red : c.amber}`, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: 1, color: "#fff", background: m.status === "out" ? c.red : c.amber, padding: "1px 6px", borderRadius: 2 }}>{m.status === "out" ? "OUT" : "REORDER"}</span>
              <div style={{ fontSize: 14, marginTop: 4 }}>{m.name}</div>
              {m.note && <div style={{ fontSize: 11.5, color: c.sub }}>{m.note}</div>}
            </div>
            {m.cost != null && m.cost !== "" && <div style={{ fontSize: 12, color: c.sub }}>~{money(m.cost)}</div>}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <LinkBtn href={m.link} />
              <SendCell row={m} item={{ title: `Reorder material — ${m.name}`, detail: `${m.status === "out" ? "Out of stock" : "Flagged for reorder"}.${m.note ? " " + m.note : ""}`, name: m.name, severity: m.status === "out" ? "high" : "med" }} />
            </div>
          </div>
        ))}

      <div style={{ ...faintEs, marginTop: 18 }}>
        Order qty = target weeks of cover × weekly velocity − (on hand + inbound), rounded up to MOQ. Reorder-by = stockout date − lead time − safety buffer.
        <div>Cantidad = semanas objetivo × velocidad − (en mano + en camino), redondeado al MOQ.</div>
      </div>
    </div>
  );
}
