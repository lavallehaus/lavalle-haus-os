import { useState } from "react";

/* ============================================================================
   LAVALLE HAUS OS — EMAIL / RETENTION
   Manual tracker for email campaigns & automated flows (Klaviyo-style):
   sends, open rate, click rate, and attributed revenue. CRUD + session Undo/Redo.
   Persists through onSave (parent -> Redis under dbState.emailRetention).
       <EmailRetention data={dbState.emailRetention || []} onSave={(rows) => ...} />
   ========================================================================== */

const c = {
  bg: "#FFFFFF", panel: "#fffdf9", ink: "#2b2620", sub: "#6f6657",
  line: "#e4ddd0", lineSoft: "#efe9de", clay: "#a8643c", gold: "#b08d57",
  green: "#5c7a52", yellow: "#b78b2e", red: "#a8483a", blue: "#5a6a86",
};
const serif = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const faintEs = { fontFamily: sans, fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 1 };

const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? 0 : Number(v));
const money0 = (n) => "$" + num(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const dollars = (n) => "$" + num(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (num(n) ? num(n).toFixed(1) + "%" : "—");
const uid = () => "e" + Math.random().toString(36).slice(2, 9);

const KINDS = ["Campaign", "Welcome Flow", "Abandoned Cart", "Browse Abandon", "Post-Purchase", "Winback", "Other Flow"];
const STATUSES = ["live", "draft", "paused"];
const BLANK = { name: "", kind: "Campaign", sends: "", openRate: "", clickRate: "", revenue: "", status: "live", notes: "" };

const S = {
  wrap: { fontFamily: serif, color: c.ink, background: c.bg, padding: "26px 22px 60px", maxWidth: 1180, margin: "0 auto" },
  h1: { fontFamily: serif, fontSize: 30, fontWeight: 400, letterSpacing: 0.3, margin: 0 },
  sub: { color: c.sub, fontSize: 14.5, marginTop: 4, fontStyle: "italic" },
  panel: { background: c.panel, border: `1px solid ${c.line}`, borderRadius: 4, padding: 18 },
  cap: { fontFamily: sans, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: c.sub },
  input: { width: "100%", boxSizing: "border-box", fontFamily: sans, fontSize: 13, padding: "6px 8px", border: `1px solid ${c.line}`, borderRadius: 2, background: c.panel, color: c.ink },
  btn: { fontFamily: sans, fontSize: 13, cursor: "pointer", padding: "7px 18px", borderRadius: 2, border: "none", background: c.ink, color: c.bg },
  btnGhost: { fontFamily: sans, fontSize: 13, cursor: "pointer", padding: "7px 16px", borderRadius: 2, border: `1px solid ${c.line}`, background: "transparent", color: c.sub },
};

export default function EmailRetention({ data = [], onSave }) {
  const [rows, setRows] = useState(Array.isArray(data) ? data : []);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [editId, setEditId] = useState(null);

  function commit(next, record = true) {
    if (record) { setPast((p) => [...p, rows].slice(-50)); setFuture([]); }
    setRows(next); onSave?.(next);
  }
  const mutate = (next) => commit(next, true);
  function undo() { if (!past.length) return; const prev = past[past.length - 1]; setFuture((f) => [...f, rows].slice(-50)); setPast((p) => p.slice(0, -1)); setRows(prev); onSave?.(prev); }
  function redo() { if (!future.length) return; const nxt = future[future.length - 1]; setPast((p) => [...p, rows].slice(-50)); setFuture((f) => f.slice(0, -1)); setRows(nxt); onSave?.(nxt); }

  const clean = (d) => ({ ...d, sends: num(d.sends), openRate: num(d.openRate), clickRate: num(d.clickRate), revenue: num(d.revenue) });
  function saveNew() { if (!draft.name.trim()) return; mutate([{ ...clean(draft), id: uid() }, ...rows]); setDraft(BLANK); setAdding(false); }
  function startEdit(a) { setEditId(a.id); setDraft({ ...a }); }
  function saveEdit() { mutate(rows.map((r) => (r.id === editId ? { ...clean(draft), id: editId } : r))); setEditId(null); }
  function del(id) { if (!window.confirm("Delete this entry?")) return; mutate(rows.filter((r) => r.id !== id)); }

  const totalRev = rows.reduce((s, a) => s + num(a.revenue), 0);
  const withOpen = rows.filter((a) => num(a.openRate) > 0);
  const avgOpen = withOpen.length ? withOpen.reduce((s, a) => s + num(a.openRate), 0) / withOpen.length : 0;
  const withClick = rows.filter((a) => num(a.clickRate) > 0);
  const avgClick = withClick.length ? withClick.reduce((s, a) => s + num(a.clickRate), 0) / withClick.length : 0;
  const liveFlows = rows.filter((a) => a.status === "live" && a.kind !== "Campaign").length;

  const Field = ({ k, label, ph }) => (
    <label><div style={S.cap}>{label}</div><input style={S.input} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} placeholder={ph || ""} /></label>
  );

  const form = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 10 }}>
      <label style={{ gridColumn: "1 / -1" }}><div style={S.cap}>Name · nombre</div><input style={S.input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. May Newsletter, or Abandoned Cart Flow" /></label>
      <label><div style={S.cap}>Type · tipo</div>
        <select style={S.input} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>{KINDS.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label><div style={S.cap}>Status · estado</div>
        <select style={S.input} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>{STATUSES.map((t) => <option key={t}>{t}</option>)}</select></label>
      <Field k="sends" label="Sends / recipients · envíos" ph="0" />
      <Field k="openRate" label="Open rate % · apertura" ph="0" />
      <Field k="clickRate" label="Click rate % · clics" ph="0" />
      <Field k="revenue" label="Revenue $ · ingresos" ph="0" />
      <label style={{ gridColumn: "1 / -1" }}><div style={S.cap}>Notes · notas</div><input style={S.input} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
    </div>
  );

  return (
    <div style={S.wrap}>
      <div>
        <h1 style={S.h1}>Email / Retention</h1><div style={faintEs}>Email / Retención</div>
        <div style={S.sub}>Track campaigns and automated flows — open rate, click rate, and revenue earned.</div>
        <div style={faintEs}>Campañas y flujos automáticos — apertura, clics e ingresos.</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <button onClick={undo} disabled={!past.length} style={{ ...S.btnGhost, padding: "6px 16px", opacity: past.length ? 1 : 0.4, cursor: past.length ? "pointer" : "default" }}>Undo</button>
        <button onClick={redo} disabled={!future.length} style={{ ...S.btnGhost, padding: "6px 16px", opacity: future.length ? 1 : 0.4, cursor: future.length ? "pointer" : "default" }}>Redo</button>
        <span style={{ fontSize: 11, color: c.sub, fontStyle: "italic" }}>{past.length ? `${past.length} change${past.length === 1 ? "" : "s"} this session` : "no changes yet"} · deshacer / rehacer</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12, marginTop: 14 }}>
        {[
          { l: "Email revenue", le: "Ingresos email", v: money0(totalRev), color: c.green },
          { l: "Avg open rate", le: "Apertura prom.", v: pct(avgOpen), color: c.blue },
          { l: "Avg click rate", le: "Clics prom.", v: pct(avgClick), color: c.gold },
          { l: "Live flows", le: "Flujos activos", v: String(liveFlows), color: c.ink },
        ].map((x) => (
          <div key={x.l} style={{ ...S.panel, padding: "14px 16px" }}>
            <div style={S.cap}>{x.l}</div><div style={faintEs}>{x.le}</div>
            <div style={{ fontSize: 23, marginTop: 4, color: x.color || c.ink }}>{x.v}</div>
          </div>
        ))}
      </div>

      {adding ? (
        <div style={{ ...S.panel, marginTop: 16, borderLeft: `3px solid ${c.clay}` }}>
          {form}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={saveNew} style={S.btn}>Save · guardar</button>
            <button onClick={() => { setAdding(false); setDraft(BLANK); }} style={S.btnGhost}>Cancel · cancelar</button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setAdding(true); setDraft(BLANK); }} style={{ ...S.btnGhost, marginTop: 16, color: c.clay, borderColor: c.clay }}>+ Add campaign / flow · agregar</button>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
        {rows.length === 0 && !adding && <div style={{ ...S.panel, fontStyle: "italic", color: c.sub, fontSize: 13 }}>Nothing tracked yet — add a campaign or flow. · Nada aún.</div>}
        {rows.map((a) => {
          const editing = editId === a.id;
          const isFlow = a.kind !== "Campaign";
          const sColor = a.status === "live" ? c.green : a.status === "paused" ? c.sub : c.gold;
          return (
            <div key={a.id} style={{ ...S.panel, borderLeft: `3px solid ${isFlow ? c.blue : sColor}` }}>
              {editing ? (
                <>
                  {form}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button onClick={saveEdit} style={S.btn}>Save · guardar</button>
                    <button onClick={() => setEditId(null)} style={S.btnGhost}>Cancel · cancelar</button>
                  </div>
                </>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 16 }}>{a.name || "Untitled"}</span>
                      <span style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1, color: isFlow ? c.blue : c.sub }}>{a.kind}{isFlow ? " · FLOW" : ""}</span>
                      <span style={{ fontFamily: sans, fontSize: 10, letterSpacing: 0.5, color: sColor }}>{a.status.toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: 12, color: c.sub, marginTop: 3 }}>
                      {num(a.sends) ? `${num(a.sends).toLocaleString()} sends · ` : ""}{dollars(a.revenue)} earned
                    </div>
                    {a.notes && <div style={{ fontSize: 12, color: c.sub, fontStyle: "italic", marginTop: 3 }}>{a.notes}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                    {[
                      ["Open", pct(a.openRate), c.blue],
                      ["Click", pct(a.clickRate), c.gold],
                      ["Revenue", money0(a.revenue), c.green],
                    ].map(([l, v, col]) => (
                      <div key={l} style={{ textAlign: "center" }}>
                        <div style={{ fontFamily: sans, fontSize: 15, color: col }}>{v}</div>
                        <div style={{ ...S.cap, fontSize: 9 }}>{l}</div>
                      </div>
                    ))}
                    <button onClick={() => startEdit(a)} style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11.5 }}>Edit</button>
                    <button onClick={() => del(a.id)} style={{ ...S.btnGhost, padding: "5px 10px", fontSize: 11.5, color: c.red }}>✕</button>
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
