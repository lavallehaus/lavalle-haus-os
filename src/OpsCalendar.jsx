import { useMemo, useState, useEffect } from "react";
import { WORKSPACES } from "./Boards.jsx";

// LAVALLE HAUS OS — Master Operations Calendar
// A real month calendar across all brands: shoot dates sit on their day, and the
// products launching that month (pulled live from the Lavalle Haus + The Fold
// operations boards) show as a carousel you can flip through. Toggle a brand or
// see them all. Founder shoots tag multiple brands so they appear on each.

const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", red: "#9b5e5e", green: "#5a7a5a" };

const BRANDS = [
  { key: "lavalle-sisters", label: "Lavalle Sisters", color: "#B98C8C" },
  { key: "lavalle-haus", label: "Lavalle Haus", color: "#8F8676" },
  { key: "the-fold", label: "The Fold", color: "#2B2A28" },
];
const brandOf = (k) => BRANDS.find((b) => b.key === k);
const boardBrand = (boardKey, boards) => {
  const ws = (boards && boards[boardKey] && boards[boardKey].ws) || null;
  if (ws && BRANDS.some((b) => b.key === ws)) return ws;
  const w = WORKSPACES.find((w) => (w.boards || []).includes(boardKey) && BRANDS.some((b) => b.key === w.id));
  return w ? w.id : null;
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const uid = () => "s" + Math.random().toString(36).slice(2, 9);
const input = { width: "100%", padding: "9px 10px", border: `1px solid ${c.line}`, borderRadius: 1, fontFamily: sans, fontSize: 13, color: c.ink, boxSizing: "border-box", background: c.bg };

export default function OpsCalendar({ boards, shoots, onSaveShoots }) {
  const [brand, setBrand] = useState("all");
  const [editing, setEditing] = useState(null);
  const [ym, setYm] = useState(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); });
  const [ci, setCi] = useState(0);
  const [y, m] = ym.split("-").map(Number); // m = 1..12

  const shiftMonth = (delta) => { let mm = m - 1 + delta, yy = y; while (mm < 0) { mm += 12; yy--; } while (mm > 11) { mm -= 12; yy++; } setYm(yy + "-" + String(mm + 1).padStart(2, "0")); setCi(0); };

  // Products launching in the visible month — live from every board (the ops
  // boards are where the Outfit/product looks live), filtered by brand.
  const launchItems = useMemo(() => {
    const out = [];
    Object.entries(boards || {}).forEach(([bk, b]) => {
      if (!b || !b.cards || bk.startsWith("_")) return;
      const br = boardBrand(bk, boards);
      if (!br || (brand !== "all" && br !== brand)) return;
      b.cards.forEach((cd) => { if (cd.launchMonth === ym && cd.cover) out.push({ name: cd.name, cover: cd.cover, brand: br, board: b.name }); });
    });
    return out;
  }, [boards, ym, brand]);
  useEffect(() => { if (ci >= launchItems.length) setCi(0); }, [launchItems.length]); // eslint-disable-line

  const monthShoots = (shoots || []).filter((s) => (s.date || "").startsWith(ym) && (brand === "all" || (s.brands || []).includes(brand)));
  const shootsByDay = {};
  monthShoots.forEach((s) => { const d = Number((s.date || "").slice(8, 10)); (shootsByDay[d] = shootsByDay[d] || []).push(s); });

  const firstDow = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  const now = new Date();
  const todayYm = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const todayD = now.getDate();

  const n = launchItems.length;
  const cur = launchItems[ci];

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ fontFamily: sans, fontSize: 22, fontWeight: 300, letterSpacing: 1, color: c.ink }}>Operations Calendar</div>
        <div style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>Launches & shoots across every brand</div>
        <button onClick={() => setEditing({ brands: brand === "all" ? [] : [brand], date: ym + "-15" })} style={{ marginLeft: "auto", background: c.ink, color: c.bg, border: "none", borderRadius: 1, padding: "8px 14px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer" }}>+ Add shoot</button>
      </div>

      {/* brand toggle */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {[{ key: "all", label: "All", color: c.taupe }, ...BRANDS].map((b) => (
          <button key={b.key} onClick={() => setBrand(b.key)} style={{ background: brand === b.key ? b.color : "transparent", color: brand === b.key ? "#FFFFFF" : c.sub, border: `1px solid ${brand === b.key ? b.color : c.line}`, borderRadius: 20, padding: "6px 15px", fontFamily: sans, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", cursor: "pointer" }}>{b.label}</button>
        ))}
      </div>

      {/* month nav */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, marginBottom: 12 }}>
        <button onClick={() => shiftMonth(-1)} style={navBtn}>‹</button>
        <div style={{ fontFamily: sans, fontSize: 16, letterSpacing: 2, textTransform: "uppercase", color: c.ink, minWidth: 200, textAlign: "center" }}>{MONTHS[m - 1]} {y}</div>
        <button onClick={() => shiftMonth(1)} style={navBtn}>›</button>
      </div>

      {/* this month's launching products — carousel */}
      {n > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, background: c.card, border: `1px solid ${c.line}`, borderRadius: 3, padding: 12, marginBottom: 14 }}>
          <img src={cur.cover} alt={cur.name} style={{ width: 96, height: 124, objectFit: "cover", borderRadius: 2, flexShrink: 0, border: `1px solid ${c.line}` }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe }}>Launching this month</div>
            <div style={{ fontFamily: sans, fontSize: 16, color: c.ink, margin: "3px 0 5px" }}>{cur.name}</div>
            <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: "#FFFFFF", background: (brandOf(cur.brand) || {}).color, borderRadius: 3, padding: "2px 8px" }}>{(brandOf(cur.brand) || {}).label}</span>
            {n > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                <button onClick={() => setCi((ci - 1 + n) % n)} style={miniBtn}>‹</button>
                <div style={{ display: "flex", gap: 5 }}>{launchItems.map((_, i) => <div key={i} onClick={() => setCi(i)} style={{ width: i === ci ? 18 : 6, height: 6, borderRadius: 3, background: i === ci ? c.taupe : c.line, cursor: "pointer", transition: "width .2s" }} />)}</div>
                <button onClick={() => setCi((ci + 1) % n)} style={miniBtn}>›</button>
                <span style={{ fontFamily: sans, fontSize: 10, color: c.sub, marginLeft: 4 }}>{ci + 1} / {n}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* the calendar grid */}
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ minWidth: 700 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {DOW.map((d) => <div key={d} style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, textAlign: "center", padding: "6px 0" }}>{d}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", border: `1px solid ${c.line}`, borderRight: "none", borderBottom: "none" }}>
            {cells.map((d, i) => {
              const isToday = d && ym === todayYm && d === todayD;
              const list = (d && shootsByDay[d]) || [];
              return (
                <div key={i} onClick={() => d && setEditing({ brands: brand === "all" ? [] : [brand], date: ym + "-" + String(d).padStart(2, "0") })}
                  style={{ minHeight: 92, borderRight: `1px solid ${c.line}`, borderBottom: `1px solid ${c.line}`, padding: 5, background: d ? c.bg : "#FAFAF9", cursor: d ? "pointer" : "default", position: "relative" }}>
                  {d && <div style={{ fontFamily: sans, fontSize: 11, color: isToday ? "#FFFFFF" : c.sub, fontWeight: isToday ? 600 : 400, width: isToday ? 20 : "auto", height: isToday ? 20 : "auto", borderRadius: "50%", background: isToday ? c.taupe : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{d}</div>}
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 3 }}>
                    {list.map((s) => (
                      <button key={s.id} onClick={(e) => { e.stopPropagation(); setEditing(s); }} title={s.title}
                        style={{ textAlign: "left", border: "none", borderRadius: 3, padding: "3px 5px", cursor: "pointer", background: (brandOf((s.brands || [])[0]) || {}).color || c.taupe, color: "#FFFFFF", fontFamily: sans, fontSize: 9, lineHeight: 1.25, overflow: "hidden" }}>
                        📸 {s.title || "Shoot"}{s.start ? " · " + s.start : ""}{s.tbd ? " · TBD" : s.tentative ? " ~" : ""}
                        {(s.brands || []).length > 1 && <div style={{ fontSize: 8, opacity: 0.85 }}>{(s.brands || []).map((b) => (brandOf(b) || {}).label).join(" + ")}</div>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 10.5, color: c.sub, marginTop: 8 }}>Tap a day to add a shoot · tap a shoot to edit. Products with a launch month + cover on any board show in the carousel above.</div>

      {editing && <ShootEditor shoot={editing} onSave={(s) => { const list = shoots || []; onSaveShoots(s.id && list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, { ...s, id: s.id || uid() }]); setEditing(null); }} onDelete={editing.id ? () => { onSaveShoots((shoots || []).filter((x) => x.id !== editing.id)); setEditing(null); } : null} onClose={() => setEditing(null)} />}
    </div>
  );
}
const navBtn = { background: "transparent", border: `1px solid ${c.line}`, borderRadius: "50%", width: 34, height: 34, fontSize: 18, color: c.ink, cursor: "pointer", lineHeight: 1 };
const miniBtn = { background: c.bg, border: `1px solid ${c.line}`, borderRadius: "50%", width: 26, height: 26, fontSize: 14, color: c.ink, cursor: "pointer", lineHeight: 1 };

function ShootEditor({ shoot, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState(shoot.title || "");
  const [brands, setBrands] = useState(shoot.brands || []);
  const [date, setDate] = useState(shoot.date || "");
  const [start, setStart] = useState(shoot.start || "");
  const [end, setEnd] = useState(shoot.end || "");
  const [dateLabel, setDateLabel] = useState(shoot.dateLabel || "");
  const [tbd, setTbd] = useState(!!shoot.tbd);
  const [tentative, setTentative] = useState(!!shoot.tentative);
  const [note, setNote] = useState(shoot.note || "");
  const toggle = (k) => setBrands((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const label = { fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, margin: "14px 0 4px" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.35)", zIndex: 400, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px, 94vw)", height: "100%", background: c.card, borderLeft: `1px solid ${c.line}`, padding: "24px 26px", overflowY: "auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontFamily: sans, fontSize: 18, fontWeight: 300, color: c.ink }}>{shoot.id ? "Edit shoot" : "New shoot"}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: c.sub, cursor: "pointer" }}>×</button>
        </div>

        <div style={label}>Title</div>
        <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Fold — Sacia shoot" />

        <div style={label}>Brands (a founder shoot can be more than one)</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {BRANDS.map((b) => (
            <button key={b.key} onClick={() => toggle(b.key)} style={{ background: brands.includes(b.key) ? b.color : "transparent", color: brands.includes(b.key) ? "#FFFFFF" : c.sub, border: `1px solid ${brands.includes(b.key) ? b.color : c.line}`, borderRadius: 20, padding: "6px 13px", fontFamily: sans, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>{b.label}</button>
          ))}
        </div>

        <div style={label}>Date {tbd ? "(best estimate — flagged TBD)" : tentative ? "(tentative)" : ""}</div>
        <input style={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <div style={label}>Date label (optional — for fuzzy dates)</div>
        <input style={input} value={dateLabel} onChange={(e) => setDateLabel(e.target.value)} placeholder="e.g. Week of Jul 27 · 4th week of Nov" />

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><div style={label}>Start</div><input style={input} type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div style={{ flex: 1 }}><div style={label}>End</div><input style={input} type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: sans, fontSize: 12, color: c.ink, cursor: "pointer" }}><input type="checkbox" checked={tbd} onChange={() => setTbd(!tbd)} /> Date/time TBD</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: sans, fontSize: 12, color: c.ink, cursor: "pointer" }}><input type="checkbox" checked={tentative} onChange={() => setTentative(!tentative)} /> Tentative</label>
        </div>

        <div style={label}>Note</div>
        <textarea style={{ ...input, resize: "vertical" }} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Location, looks to shoot, who's needed…" />

        <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
          <button onClick={() => onSave({ ...shoot, title: title.trim(), brands, date, start, end, dateLabel: dateLabel.trim(), tbd, tentative, note: note.trim() })}
            style={{ flex: 1, background: c.ink, color: c.bg, border: "none", borderRadius: 1, padding: "11px 0", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Save shoot</button>
          {onDelete && <button onClick={onDelete} style={{ background: "transparent", color: c.red, border: `1px solid ${c.line}`, borderRadius: 1, padding: "11px 16px", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Delete</button>}
        </div>
      </div>
    </div>
  );
}
