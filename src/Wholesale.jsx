import { useState } from "react";

/* ============================================================================
   LAVALLE HAUS OS — WHOLESALE ACCOUNTS
   A real tracker for B2B/wholesale relationships: who they are, when they last
   ordered, how often they reorder, and open opportunity value. Reorder timing
   is computed from the last-order date vs. the typical interval.
   Persists through onSave (parent writes to Redis under dbState.wholesale).
       <Wholesale data={dbState.wholesale || []} onSave={(accts) => ...} />
   ========================================================================== */

const c = {
  bg: "#f7f4ef", panel: "#fffdf9", ink: "#2b2620", sub: "#6f6657",
  line: "#e4ddd0", lineSoft: "#efe9de", clay: "#a8643c", gold: "#b08d57",
  green: "#5c7a52", yellow: "#b78b2e", red: "#a8483a",
};
const serif = "'IM Fell English', Georgia, 'Times New Roman', serif";
const sans = "'IM Fell English', Georgia, serif";
const faintEs = { fontFamily: sans, fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 1 };

const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? 0 : Number(v));
const money = (n) => "$" + num(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const uid = () => "w" + Math.random().toString(36).slice(2, 9);

function daysSince(dateStr) {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}
function reorderState(a) {
  if (a.status === "lead") return { label: "LEAD", color: c.gold };
  if (a.status === "dormant") return { label: "DORMANT", color: c.sub };
  const d = daysSince(a.lastOrder);
  const interval = num(a.reorderDays);
  if (d == null || interval <= 0) return { label: "ACTIVE", color: c.green };
  if (d > interval) return { label: `OVERDUE ${d - interval}d`, color: c.red };
  if (d >= interval - 7) return { label: "DUE SOON", color: c.yellow };
  return { label: `ON TRACK · ${interval - d}d`, color: c.green };
}

const S = {
  wrap: { fontFamily: serif, color: c.ink, background: c.bg, padding: "26px 22px 60px", maxWidth: 1180, margin: "0 auto" },
  h1: { fontFamily: serif, fontSize: 30, fontWeight: 400, letterSpacing: 0.3, margin: 0 },
  sub: { color: c.sub, fontSize: 14.5, marginTop: 4, fontStyle: "italic" },
  panel: { background: c.panel, border: `1px solid ${c.line}`, borderRadius: 4, padding: 18 },
  cap: { fontFamily: sans, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: c.sub },
  input: { width: "100%", boxSizing: "border-box", fontFamily: sans, fontSize: 13, padding: "6px 8px", border: `1px solid ${c.line}`, borderRadius: 2, background: c.panel, color: c.ink },
};

const BLANK = { name: "", platform: "Faire", lastOrder: "", reorderDays: 60, oppValue: 0, status: "active", notes: "" };

export default function Wholesale({ data = [], onSave }) {
  const [accounts, setAccounts] = useState(Array.isArray(data) ? data : []);
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState(BLANK);

  const commit = (next) => { setAccounts(next); onSave?.(next); };

  const startAdd = () => { const a = { ...BLANK, id: uid() }; setEditId(a.id); setDraft(a); setAccounts((p) => [a, ...p]); };
  const startEdit = (a) => { setEditId(a.id); setDraft({ ...a }); };
  const saveDraft = () => {
    const clean = { ...draft, reorderDays: num(draft.reorderDays), oppValue: num(draft.oppValue) };
    commit(accounts.map((a) => (a.id === clean.id ? clean : a)));
    setEditId(null);
  };
  const cancel = () => { if (!accounts.find((a) => a.id === editId)?.name) commit(accounts.filter((a) => a.id !== editId)); setEditId(null); };
  const del = (id) => commit(accounts.filter((a) => a.id !== id));

  const active = accounts.filter((a) => a.status === "active");
  const totalOpp = accounts.reduce((s, a) => s + num(a.oppValue), 0);
  const dueCount = accounts.filter((a) => { const r = reorderState(a); return r.label.startsWith("OVERDUE") || r.label === "DUE SOON"; }).length;
  const sorted = [...accounts].sort((a, b) => {
    const rank = (x) => { const l = reorderState(x).label; return l.startsWith("OVERDUE") ? 0 : l === "DUE SOON" ? 1 : x.status === "lead" ? 2 : x.status === "dormant" ? 4 : 3; };
    return rank(a) - rank(b);
  });

  return (
    <div style={S.wrap}>
      <div>
        <h1 style={S.h1}>Wholesale Accounts</h1><div style={faintEs}>Cuentas mayoristas</div>
        <div style={S.sub}>Accounts, reorder timing, and open opportunities — your B2B relationships in one place.</div>
        <div style={faintEs}>Cuentas, tiempos de recompra y oportunidades abiertas.</div>
      </div>

      {/* SUMMARY */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12, marginTop: 16 }}>
        {[
          { l: "Accounts", le: "Cuentas", v: String(accounts.length) },
          { l: "Active", le: "Activas", v: String(active.length) },
          { l: "Due / overdue", le: "Por vencer", v: String(dueCount), color: dueCount ? c.red : c.green },
          { l: "Open opportunity", le: "Oportunidad", v: money(totalOpp), color: c.gold },
        ].map((x) => (
          <div key={x.l} style={{ ...S.panel, padding: "14px 16px" }}>
            <div style={S.cap}>{x.l}</div><div style={faintEs}>{x.le}</div>
            <div style={{ fontSize: 24, marginTop: 4, color: x.color || c.ink }}>{x.v}</div>
          </div>
        ))}
      </div>

      <button onClick={startAdd} style={{ marginTop: 16, fontFamily: sans, fontSize: 13, cursor: "pointer", padding: "8px 16px", borderRadius: 2, border: `1px solid ${c.clay}`, background: "transparent", color: c.clay }}>+ Add account · agregar cuenta</button>

      {/* LIST */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
        {sorted.length === 0 && <div style={{ ...S.panel, fontStyle: "italic", color: c.sub, fontSize: 13 }}>No accounts yet — add your first wholesale or Faire account. · Sin cuentas aún.</div>}
        {sorted.map((a) => {
          const r = reorderState(a);
          const editing = editId === a.id;
          return (
            <div key={a.id} style={{ ...S.panel, borderLeft: `3px solid ${r.color}` }}>
              {editing ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 10 }}>
                  <label><div style={S.cap}>Account name · nombre</div><input style={S.input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Retailer / spa name" /></label>
                  <label><div style={S.cap}>Platform · plataforma</div>
                    <select style={S.input} value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value })}>
                      {["Faire", "Direct", "Spa", "Boutique", "Other"].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select></label>
                  <label><div style={S.cap}>Status · estado</div>
                    <select style={S.input} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                      {["active", "lead", "dormant"].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select></label>
                  <label><div style={S.cap}>Last order date · última orden</div><input type="date" style={S.input} value={draft.lastOrder || ""} onChange={(e) => setDraft({ ...draft, lastOrder: e.target.value })} /></label>
                  <label><div style={S.cap}>Reorder every (days) · cada</div><input style={S.input} value={draft.reorderDays} onChange={(e) => setDraft({ ...draft, reorderDays: e.target.value })} /></label>
                  <label><div style={S.cap}>Open opportunity $ · oportunidad</div><input style={S.input} value={draft.oppValue} onChange={(e) => setDraft({ ...draft, oppValue: e.target.value })} /></label>
                  <label style={{ gridColumn: "1 / -1" }}><div style={S.cap}>Notes · notas</div><input style={S.input} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
                  <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                    <button onClick={saveDraft} style={{ fontFamily: sans, fontSize: 13, cursor: "pointer", padding: "7px 18px", borderRadius: 2, border: "none", background: c.ink, color: c.bg }}>Save · guardar</button>
                    <button onClick={cancel} style={{ fontFamily: sans, fontSize: 13, cursor: "pointer", padding: "7px 18px", borderRadius: 2, border: `1px solid ${c.line}`, background: "transparent", color: c.sub }}>Cancel · cancelar</button>
                  </div>
                </div>) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 16 }}>{a.name || "Untitled account"}</span>
                      <span style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1, color: c.sub }}>{a.platform}</span>
                      <span style={{ fontFamily: sans, fontSize: 10, letterSpacing: 0.5, color: r.color }}>{r.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: c.sub, marginTop: 3 }}>
                      {a.lastOrder ? `last order ${a.lastOrder}` : "no last order set"}{num(a.reorderDays) ? ` · reorders ~${num(a.reorderDays)}d` : ""}{num(a.oppValue) ? ` · ${money(a.oppValue)} open` : ""}
                    </div>
                    {a.notes && <div style={{ fontSize: 12, color: c.sub, fontStyle: "italic", marginTop: 3 }}>{a.notes}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => startEdit(a)} style={{ fontFamily: sans, fontSize: 11.5, cursor: "pointer", padding: "5px 12px", borderRadius: 2, border: `1px solid ${c.line}`, background: "transparent", color: c.sub }}>Edit</button>
                    <button onClick={() => del(a.id)} style={{ fontFamily: sans, fontSize: 11.5, cursor: "pointer", padding: "5px 10px", borderRadius: 2, border: `1px solid ${c.line}`, background: "transparent", color: c.red }}>✕</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
