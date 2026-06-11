import { useState } from "react";

/* ============================================================================
   LAVALLE HAUS OS — META / SHOPIFY ADS
   Manual tracker for Meta (Facebook/Instagram) campaigns driving Shopify sales:
   spend, revenue, ROAS, CPA, purchases. CRUD with session Undo/Redo.
   Persists through onSave (parent -> Redis under dbState.metaAds).
       <MetaAds data={dbState.metaAds || []} onSave={(rows) => ...} />
   ========================================================================== */

const c = {
  bg: "#f7f4ef", panel: "#fffdf9", ink: "#2b2620", sub: "#6f6657",
  line: "#e4ddd0", lineSoft: "#efe9de", clay: "#a8643c", gold: "#b08d57",
  green: "#5c7a52", yellow: "#b78b2e", red: "#a8483a", blue: "#5a6a86",
};
const serif = "'IM Fell English', Georgia, 'Times New Roman', serif";
const sans = "'IM Fell English', Georgia, serif";
const faintEs = { fontFamily: sans, fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 1 };

const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? 0 : Number(v));
const dollars = (n) => "$" + num(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n) => "$" + num(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const uid = () => "m" + Math.random().toString(36).slice(2, 9);

const TYPES = ["Prospecting", "Retargeting", "Catalog / DPA", "Creator / UGC", "Awareness", "Lookalike"];
const STATUSES = ["active", "paused", "testing"];
const BLANK = { name: "", type: "Prospecting", budget: "", spend: "", revenue: "", purchases: "", clicks: "", status: "active", notes: "" };

const roasOf = (a) => { const s = num(a.spend); return s > 0 ? num(a.revenue) / s : 0; };
const cpaOf = (a) => { const p = num(a.purchases); return p > 0 ? num(a.spend) / p : 0; };

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

export default function MetaAds({ data = [], onSave }) {
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

  const clean = (d) => ({ ...d, budget: num(d.budget), spend: num(d.spend), revenue: num(d.revenue), purchases: num(d.purchases), clicks: num(d.clicks) });
  function saveNew() { if (!draft.name.trim()) return; mutate([{ ...clean(draft), id: uid() }, ...rows]); setDraft(BLANK); setAdding(false); }
  function startEdit(a) { setEditId(a.id); setDraft({ ...a }); }
  function saveEdit() { mutate(rows.map((r) => (r.id === editId ? { ...clean(draft), id: editId } : r))); setEditId(null); }
  function del(id) { if (!window.confirm("Delete this campaign?")) return; mutate(rows.filter((r) => r.id !== id)); }

  const totalSpend = rows.reduce((s, a) => s + num(a.spend), 0);
  const totalRev = rows.reduce((s, a) => s + num(a.revenue), 0);
  const blended = totalSpend > 0 ? totalRev / totalSpend : 0;
  const losing = rows.filter((a) => a.status === "active" && num(a.spend) > 0 && roasOf(a) < 1).length;

  const Field = ({ k, label, ph }) => (
    <label><div style={S.cap}>{label}</div><input style={S.input} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} placeholder={ph || ""} /></label>
  );

  const form = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 10 }}>
      <label style={{ gridColumn: "1 / -1" }}><div style={S.cap}>Campaign name · nombre</div><input style={S.input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. IG Retargeting - Scrub" /></label>
      <label><div style={S.cap}>Type · tipo</div>
        <select style={S.input} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label><div style={S.cap}>Status · estado</div>
        <select style={S.input} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>{STATUSES.map((t) => <option key={t}>{t}</option>)}</select></label>
      <Field k="budget" label="Daily budget $ · presupuesto" ph="0" />
      <Field k="spend" label="Spend $ · gasto" ph="0" />
      <Field k="revenue" label="Revenue $ · ingresos" ph="0" />
      <Field k="purchases" label="Purchases · compras" ph="0" />
      <Field k="clicks" label="Clicks · clics" ph="0" />
      <label style={{ gridColumn: "1 / -1" }}><div style={S.cap}>Notes · notas</div><input style={S.input} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
    </div>
  );

  return (
    <div style={S.wrap}>
      <div>
        <h1 style={S.h1}>Meta / Shopify Ads</h1><div style={faintEs}>Anuncios Meta / Shopify</div>
        <div style={S.sub}>Track Facebook & Instagram campaigns driving your Shopify sales — spend, ROAS, CPA.</div>
        <div style={faintEs}>Campañas de Facebook e Instagram para tus ventas de Shopify.</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <button onClick={undo} disabled={!past.length} style={{ ...S.btnGhost, padding: "6px 16px", opacity: past.length ? 1 : 0.4, cursor: past.length ? "pointer" : "default" }}>Undo</button>
        <button onClick={redo} disabled={!future.length} style={{ ...S.btnGhost, padding: "6px 16px", opacity: future.length ? 1 : 0.4, cursor: future.length ? "pointer" : "default" }}>Redo</button>
        <span style={{ fontSize: 11, color: c.sub, fontStyle: "italic" }}>{past.length ? `${past.length} change${past.length === 1 ? "" : "s"} this session` : "no changes yet"} · deshacer / rehacer</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12, marginTop: 14 }}>
        {[
          { l: "Campaigns", le: "Campañas", v: String(rows.length) },
          { l: "Total spend", le: "Gasto total", v: money0(totalSpend), color: c.clay },
          { l: "Revenue", le: "Ingresos", v: money0(totalRev), color: c.green },
          { l: "Blended ROAS", le: "ROAS combinado", v: blended ? blended.toFixed(2) + "x" : "—", color: blended >= 1 ? c.green : c.red },
          { l: "Losing money", le: "Perdiendo", v: String(losing), color: losing ? c.red : c.green },
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
        <button onClick={() => { setAdding(true); setDraft(BLANK); }} style={{ ...S.btnGhost, marginTop: 16, color: c.clay, borderColor: c.clay }}>+ Add campaign · agregar campaña</button>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
        {rows.length === 0 && !adding && <div style={{ ...S.panel, fontStyle: "italic", color: c.sub, fontSize: 13 }}>No Meta campaigns yet — add your first. · Sin campañas aún.</div>}
        {rows.map((a) => {
          const roas = roasOf(a), cpa = cpaOf(a);
          const editing = editId === a.id;
          const sColor = a.status === "active" ? c.green : a.status === "paused" ? c.sub : c.gold;
          return (
            <div key={a.id} style={{ ...S.panel, borderLeft: `3px solid ${num(a.spend) > 0 && roas < 1 && a.status === "active" ? c.red : sColor}` }}>
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
                      <span style={{ fontSize: 16 }}>{a.name || "Untitled campaign"}</span>
                      <span style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1, color: c.sub }}>{a.type}</span>
                      <span style={{ fontFamily: sans, fontSize: 10, letterSpacing: 0.5, color: sColor }}>{a.status.toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: 12, color: c.sub, marginTop: 3 }}>
                      {dollars(a.spend)} spent · {dollars(a.revenue)} revenue{num(a.budget) ? ` · ${dollars(a.budget)}/day` : ""}
                    </div>
                    {a.notes && <div style={{ fontSize: 12, color: c.sub, fontStyle: "italic", marginTop: 3 }}>{a.notes}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                    {[
                      ["ROAS", roas ? roas.toFixed(2) + "x" : "—", roas ? (roas >= 1 ? c.green : c.red) : c.sub],
                      ["CPA", cpa ? dollars(cpa) : "—", c.ink],
                      ["Purch.", num(a.purchases) || "—", c.ink],
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
