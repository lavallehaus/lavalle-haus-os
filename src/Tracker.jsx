import { useState, useMemo, useEffect } from "react";

// LAVALLE HAUS OS — generic Tracker.
// A schema-driven editable table used by several sub-tabs (Suppliers, Creators,
// Competitor Intel, B2B Ads, Packaging Components). Each instance gets a column
// config and persists its rows to Redis. Add / edit / delete, with Undo/Redo.
//
// columns: [{ key, label, type: "text"|"number"|"url"|"select", options?, align?, width? }]

const c = {
  bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD",
  green: "#5a7a5a", clay: "#8F8676", red: "#9b5e5e", card: "#F4F4F3",
};
const serif = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const btnGhost = { padding: "5px 12px", fontSize: 10, fontFamily: sans, letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: `1px solid ${c.line}`, background: "transparent", color: c.sub, textTransform: "uppercase" };
const cellInput = { background: "#F0F0EE", border: `1px solid ${c.line}`, color: c.ink, fontSize: 12, padding: "4px 6px", borderRadius: 1, boxSizing: "border-box", width: "100%", fontFamily: serif };
const selStyle = { background: "#F0F0EE", border: `1px solid ${c.line}`, color: c.ink, fontSize: 12, padding: "4px 6px", borderRadius: 1, fontFamily: sans, width: "100%" };
const uid = () => "r_" + Math.random().toString(36).slice(2, 8);

export default function Tracker({ title, titleEs, intro, columns = [], data = [], onSave, addLabel = "+ Add row" }) {
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [rows, setRows] = useState(() => Array.isArray(data) ? data : []);

  const commit = (next) => { setPast((p) => [...p.slice(-49), rows]); setFuture([]); setRows(next); };
  const undo = () => { if (!past.length) return; const prev = past[past.length - 1]; setPast((p) => p.slice(0, -1)); setFuture((f) => [rows, ...f].slice(0, 50)); setRows(prev); };
  const redo = () => { if (!future.length) return; const nx = future[0]; setFuture((f) => f.slice(1)); setPast((p) => [...p.slice(-49), rows]); setRows(nx); };

  const persistKey = JSON.stringify(rows);
  useEffect(() => { if (onSave) onSave(rows); /* eslint-disable-next-line */ }, [persistKey]);

  const addRow = () => { const blank = { id: uid() }; columns.forEach((col) => { blank[col.key] = ""; }); commit([...rows, blank]); };
  const delRow = (id) => commit(rows.filter((r) => r.id !== id));
  const setCell = (id, key, val) => commit(rows.map((r) => r.id === id ? { ...r, [key]: val } : r));

  // simple totals for number columns
  const totals = useMemo(() => {
    const t = {};
    columns.forEach((col) => { if (col.type === "number") t[col.key] = rows.reduce((s, r) => s + (parseFloat(r[col.key]) || 0), 0); });
    return t;
  }, [rows, columns]);
  const hasTotals = columns.some((col) => col.type === "number");

  const th = { fontFamily: sans, fontSize: 8.5, letterSpacing: 1, textTransform: "uppercase", color: c.sub, padding: "6px 8px", textAlign: "left", borderBottom: `1px solid ${c.line}`, whiteSpace: "nowrap" };
  const td = { padding: "5px 8px", borderBottom: "1px solid #00000008", verticalAlign: "middle" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <div>
          <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 400, color: c.ink, margin: 0 }}>{title}</h1>
          {(intro || titleEs) && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: "rgba(111,102,87,0.6)" }}>{intro || titleEs}</div>}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={undo} disabled={!past.length} style={{ ...btnGhost, opacity: past.length ? 1 : 0.4 }}>↶ Undo</button>
          <button onClick={redo} disabled={!future.length} style={{ ...btnGhost, opacity: future.length ? 1 : 0.4 }}>Redo ↷</button>
          <button onClick={addRow} style={{ ...btnGhost, color: c.ink, borderColor: c.clay }}>{addLabel}</button>
        </div>
      </div>

      <div style={{ background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: 0, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
          <thead><tr>
            {columns.map((col) => <th key={col.key} style={{ ...th, textAlign: col.align || (col.type === "number" ? "right" : "left") }}>{col.label}</th>)}
            <th style={{ ...th, width: 30 }}></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={columns.length + 1} style={{ ...td, fontFamily: serif, fontStyle: "italic", color: c.sub, textAlign: "center", padding: 18 }}>Nothing here yet — use “{addLabel}” to start.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                {columns.map((col) => (
                  <td key={col.key} style={{ ...td, width: col.width, textAlign: col.type === "number" ? "right" : "left" }}>
                    {col.type === "select" ? (
                      <select style={selStyle} value={r[col.key] || ""} onChange={(e) => setCell(r.id, col.key, e.target.value)}>
                        <option value=""></option>
                        {(col.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : col.type === "url" ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input style={cellInput} placeholder="https://" value={r[col.key] || ""} onChange={(e) => setCell(r.id, col.key, e.target.value)} />
                        {r[col.key] && <a href={r[col.key]} target="_blank" rel="noreferrer" style={{ color: c.clay, textDecoration: "none", fontSize: 14 }} title="open">↗︎</a>}
                      </div>
                    ) : (
                      <input style={{ ...cellInput, textAlign: col.type === "number" ? "right" : "left", fontFamily: col.type === "number" ? sans : serif }} value={r[col.key] || ""} onChange={(e) => setCell(r.id, col.key, col.type === "number" ? e.target.value.replace(/[^0-9.\-]/g, "") : e.target.value)} />
                    )}
                  </td>
                ))}
                <td style={{ ...td, textAlign: "center" }}>
                  <button onClick={() => delRow(r.id)} title="delete" style={{ border: "none", background: "transparent", color: c.sub, cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
          {hasTotals && rows.length > 0 && (
            <tfoot><tr>
              {columns.map((col, i) => (
                <td key={col.key} style={{ ...td, textAlign: col.type === "number" ? "right" : "left", borderTop: `1px solid ${c.line}`, fontFamily: sans, fontSize: 11, color: c.sub }}>
                  {i === 0 ? "TOTAL" : (col.type === "number" ? (Number.isInteger(totals[col.key]) ? totals[col.key] : totals[col.key].toFixed(2)) : "")}
                </td>
              ))}
              <td style={{ ...td, borderTop: `1px solid ${c.line}` }}></td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
