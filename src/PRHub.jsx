import { useState } from "react";

// LAVALLE HAUS OS — Content → PR
// The Notion PR world, migrated: four folders (PR, UGC Creator Database,
// 2026 CozyTok/PR, 2026 UGC) laid out like the content boards home. Each
// folder opens a ready-to-ship table in the Loft-sheet format: Approve,
// date, IG, email, name, collaboration status, shared content, selection,
// address, phone, tracking number, comments — with colored status chips.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", green: "#5a7a5a", red: "#9b5e5e", blue: "#5a6b7a" };
const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const serif = "Georgia, 'Times New Roman', serif";

const APPROVE_OPTS = ["Ready for review", "Approved", "Decline"];
const STATUS_OPTS = ["Pending", "Waiting for: Contract", "Waiting for Shipment", "Products Shipped"];
const SHARED_OPTS = ["Pending", "Yes", "Additional Fee", "No"];
const chipColor = (v) => /ready for review/i.test(v) ? "#a8842c"
  : /approve|yes|shipped/i.test(v) ? c.green
  : /decline|^no$/i.test(v) ? c.red
  : /additional|contract/i.test(v) ? c.blue
  : /waiting for shipment/i.test(v) ? c.taupe : "#9A9A95";

// Sarah's ask: open a creator's page from the table instead of copying the @
// into Instagram or TikTok by hand. Handles are stored bare (@name) and usually
// work on both apps, so each one gets an IG and a TT jump; a pasted full URL
// wins outright and just opens itself.
// Not everyone is on both — @zayitbemmel has no Instagram — so each chip can be
// switched off per creator (row.noIg / row.noTt) and switched back on later.
const socialLinks = (raw, row = {}) => {
  const v = String(raw || "").replace(/\(.*?\)/g, "").trim();
  if (!v) return [];
  if (/^https?:\/\//i.test(v)) return [{ key: "url", label: "↗︎", href: v }];
  const h = v.replace(/^@+/, "").trim();
  if (!h) return [];
  if (/tiktok\.com/i.test(v)) return [{ key: "tt", label: "TT", href: "https://" + v.replace(/^\/+/, "") }];
  if (/instagram\.com/i.test(v)) return [{ key: "ig", label: "IG", href: "https://" + v.replace(/^\/+/, "") }];
  const all = [
    { key: "ig", label: "IG", href: "https://www.instagram.com/" + h + "/", off: !!row.noIg, flag: "noIg" },
    { key: "tt", label: "TT", href: "https://www.tiktok.com/@" + h, off: !!row.noTt, flag: "noTt" },
  ];
  return all;
};

const COLS = [
  { key: "approve", label: "Approve / Decline", type: "select", opts: APPROVE_OPTS, w: 120 },
  { key: "dateAdded", label: "Date added", type: "text", w: 100 },
  { key: "ig", label: "IG / TikTok", type: "social", w: 205 },
  { key: "email", label: "Email", type: "text", w: 190 },
  { key: "name", label: "Name", type: "text", w: 140 },
  { key: "status", label: "Collaboration Status", type: "select", opts: STATUS_OPTS, w: 160 },
  { key: "shared", label: "Shared Content", type: "select", opts: SHARED_OPTS, w: 120 },
  { key: "selection", label: "Selection", type: "text", w: 160 },
  { key: "address", label: "Address", type: "text", w: 230 },
  { key: "phone", label: "Phone", type: "text", w: 110 },
  { key: "tracking", label: "Tracking Number", type: "text", w: 170 },
  { key: "comments", label: "Comments", type: "text", w: 200 },
];

const uid = () => "pr" + Math.random().toString(36).slice(2, 9);

export default function PRHub({ data, onSave }) {
  const [openId, setOpenId] = useState(null);
  const folders = (data && data.folders) || [];
  const folder = folders.find((f) => f.id === openId);

  // Undo/redo: every save pushes the PREVIOUS state; capped at 40 steps.
  const histRef = useState({ past: [], future: [] })[0];
  const save = (next) => {
    histRef.past.push(JSON.stringify(data || {}));
    if (histRef.past.length > 40) histRef.past.shift();
    histRef.future.length = 0;
    onSave(next);
  };
  const undo = () => { const prev = histRef.past.pop(); if (prev === undefined) return; histRef.future.push(JSON.stringify(data || {})); onSave(JSON.parse(prev)); };
  const redo = () => { const nxt = histRef.future.pop(); if (nxt === undefined) return; histRef.past.push(JSON.stringify(data || {})); onSave(JSON.parse(nxt)); };

  const saveFolder = (fid, rows) => save({ ...(data || {}), folders: folders.map((f) => (f.id === fid ? { ...f, rows } : f)) });

  if (!folder) {
    return (
      <div style={{ fontFamily: sans }}>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.sub, marginBottom: 14 }}>
          Creator seeding & press — migrated from Notion. Open a folder to work its list.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {folders.map((f) => (
            <button key={f.id} onClick={() => setOpenId(f.id)}
              style={{ textAlign: "left", background: c.card, border: `1px solid ${c.line}`, borderRadius: 2, padding: "22px 18px", cursor: "pointer" }}>
              <div style={{ fontFamily: sans, fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: c.ink, marginBottom: 6 }}>{f.name}</div>
              <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11.5, color: c.sub }}>
                {(f.rows || []).length} creator{(f.rows || []).length === 1 ? "" : "s"} · {(f.rows || []).filter((r) => /shipped/i.test(r.status || "")).length} shipped
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const rows = folder.rows || [];
  const setCell = (rid, key, val) => saveFolder(folder.id, rows.map((r) => (r.id === rid ? { ...r, [key]: val } : r)));
  const addRow = () => saveFolder(folder.id, [...rows, { id: uid(), approve: "Ready for review", status: "Pending", shared: "Pending" }]);
  const delRow = (rid) => { if (confirm("Remove this creator row?")) saveFolder(folder.id, rows.filter((r) => r.id !== rid)); };

  return (
    <div style={{ fontFamily: sans }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={() => setOpenId(null)} style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>← Folders</button>
        <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase" }}>{folder.name}</div>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub }}>{rows.length} creators</div>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
          <button onClick={undo} disabled={!histRef.past.length} title="Undo last change"
            style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: histRef.past.length ? c.ink : "#C4C4C0", cursor: "pointer" }}>Undo</button>
          <button onClick={redo} disabled={!histRef.future.length} title="Redo"
            style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: histRef.future.length ? c.ink : "#C4C4C0", cursor: "pointer" }}>Redo</button>
          <button onClick={addRow} style={{ border: `1px solid ${c.ink}`, background: c.ink, color: "#fff", borderRadius: 1, padding: "7px 14px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>+ Add creator</button>
        </span>
      </div>
      <div style={{ overflowX: "auto", border: `1px solid ${c.line}` }}>
        <table style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%" }}>
          <thead>
            <tr>
              {COLS.map((col) => (
                <th key={col.key} style={{ position: "sticky", top: 0, background: c.card, borderBottom: `1px solid ${c.line}`, borderRight: `1px solid ${c.line}`, padding: "9px 10px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, textAlign: "left", minWidth: col.w }}>{col.label}</th>
              ))}
              <th style={{ background: c.card, borderBottom: `1px solid ${c.line}`, width: 34 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {COLS.map((col) => (
                  <td key={col.key} style={{ borderBottom: `1px solid ${c.line}`, borderRight: `1px solid ${c.line}`, padding: 0 }}>
                    {col.type === "social" ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, paddingRight: 6 }}>
                        <input value={r[col.key] || ""} onChange={(e) => setCell(r.id, col.key, e.target.value)}
                          style={{ flex: 1, minWidth: 0, border: "none", outline: "none", padding: "8px 10px", fontFamily: sans, fontSize: 12, color: c.ink, background: "transparent" }} />
                        {socialLinks(r[col.key], r).map((l) => (
                          l.off ? (
                            <button key={l.key} onClick={() => setCell(r.id, l.flag, false)} title={`${l.label} — turn back on`}
                              style={{ flex: "none", border: `1px dashed ${c.line}`, borderRadius: 1, padding: "2px 4px", fontFamily: sans, fontSize: 8.5, letterSpacing: 1, color: "#C4C4C0", background: "transparent", cursor: "pointer" }}>+{l.label}</button>
                          ) : (
                            <span key={l.key} style={{ flex: "none", display: "inline-flex", alignItems: "center", border: `1px solid ${c.line}`, borderRadius: 1, background: "#fff" }}>
                              <a href={l.href} target="_blank" rel="noreferrer" title={l.href}
                                style={{ textDecoration: "none", padding: "2px 4px", fontFamily: sans, fontSize: 8.5, letterSpacing: 1, color: c.sub }}>{l.label}</a>
                            </span>
                          )
                        ))}
                        {/* the off switches live apart from the open-chips so a
                            tap on IG/TT can't accidentally kill the handle */}
                        {socialLinks(r[col.key], r).filter((l) => l.flag && !l.off).map((l) => (
                          <button key={"off" + l.key}
                            onClick={() => { if (window.confirm(`Turn off the ${l.label === "IG" ? "Instagram" : "TikTok"} link for this creator?`)) setCell(r.id, l.flag, true); }}
                            title={`Mark: no ${l.label === "IG" ? "Instagram" : "TikTok"}`}
                            style={{ flex: "none", marginLeft: 8, border: "none", background: "transparent", padding: "2px 3px", fontFamily: sans, fontSize: 9, lineHeight: 1, color: "#D8D8D4", cursor: "pointer" }}>×{l.label.toLowerCase()}</button>
                        ))}
                      </div>
                    ) : col.type === "select" ? (
                      <select value={r[col.key] || col.opts[0]} onChange={(e) => setCell(r.id, col.key, e.target.value)}
                        style={{ width: "100%", border: "none", outline: "none", padding: "8px 8px", fontFamily: sans, fontSize: 11, letterSpacing: 0.5, appearance: "none", WebkitAppearance: "none", background: chipColor(r[col.key] || col.opts[0]), color: "#fff", borderRadius: 0, cursor: "pointer", textAlign: "center" }}>
                        {[...col.opts, ...(r[col.key] && !col.opts.includes(r[col.key]) ? [r[col.key]] : [])].map((o) => <option key={o} value={o} style={{ background: "#fff", color: c.ink }}>{o}</option>)}
                      </select>
                    ) : (
                      <input value={r[col.key] || ""} onChange={(e) => setCell(r.id, col.key, e.target.value)}
                        placeholder=""
                        style={{ width: "100%", boxSizing: "border-box", border: "none", outline: "none", padding: "8px 10px", fontFamily: sans, fontSize: 12, color: c.ink, background: "transparent" }} />
                    )}
                  </td>
                ))}
                <td style={{ borderBottom: `1px solid ${c.line}`, textAlign: "center" }}>
                  <button onClick={() => delRow(r.id)} title="Remove row" style={{ border: "none", background: "transparent", color: c.line, cursor: "pointer", fontSize: 13, padding: 6 }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub, marginTop: 10 }}>
        Every cell edits in place and saves automatically. Paste UPS/USPS numbers straight into Tracking.
      </div>
    </div>
  );
}
