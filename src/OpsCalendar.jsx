import { useMemo, useState } from "react";
import { WORKSPACES } from "./Boards.jsx";

// LAVALLE HAUS OS — Master Operations Calendar
// One cross-brand timeline: product launches (with their look photos) + shoot
// dates, across Lavalle Sisters / Lavalle Haus / The Fold. Toggle a brand or see
// them all. Launches are pulled live from the boards (any card with a launch
// month + cover); shoots are entered here (with room for TBD / tentative dates).

const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", red: "#9b5e5e", green: "#5a7a5a" };

const BRANDS = [
  { key: "lavalle-sisters", label: "Lavalle Sisters", color: "#B98C8C" },
  { key: "lavalle-haus", label: "Lavalle Haus", color: "#8F8676" },
  { key: "the-fold", label: "The Fold", color: "#2B2A28" },
];
const brandOf = (k) => BRANDS.find((b) => b.key === k);
// Map a board key → brand key via the workspaces it belongs to.
const boardBrand = (boardKey, boards) => {
  const ws = (boards && boards[boardKey] && boards[boardKey].ws) || null;
  if (ws && BRANDS.some((b) => b.key === ws)) return ws;
  const w = WORKSPACES.find((w) => (w.boards || []).includes(boardKey) && BRANDS.some((b) => b.key === w.id));
  return w ? w.id : null;
};
const monthLabel = (k) => { const m = /^(\d{4})-(\d{2})$/.exec(k || ""); if (!m) return k; return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); };
const dayLabel = (iso) => { const d = new Date(iso + "T12:00:00"); return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); };
const uid = () => "s" + Math.random().toString(36).slice(2, 9);
const input = { width: "100%", padding: "9px 10px", border: `1px solid ${c.line}`, borderRadius: 1, fontFamily: sans, fontSize: 13, color: c.ink, boxSizing: "border-box", background: c.bg };

export default function OpsCalendar({ boards, shoots, onSaveShoots }) {
  const [brand, setBrand] = useState("all");
  const [editing, setEditing] = useState(null); // shoot being edited (or new)

  // Launches pulled live from every board: any card with launchMonth + cover.
  const launches = useMemo(() => {
    const map = {};
    Object.entries(boards || {}).forEach(([bk, b]) => {
      if (!b || !b.cards || bk.startsWith("_")) return;
      const br = boardBrand(bk, boards);
      if (!br) return;
      b.cards.forEach((cd) => {
        if (cd.launchMonth && cd.cover) {
          const key = br + "|" + cd.launchMonth;
          (map[key] = map[key] || { type: "launch", brand: br, month: cd.launchMonth, board: b.name, boardKey: bk, items: [] }).items.push({ name: cd.name, cover: cd.cover });
        }
      });
    });
    return Object.values(map).map((g) => ({ ...g, date: g.month + "-15", sort: g.month + "-15" }));
  }, [boards]);

  const shootEntries = (shoots || []).map((s) => ({ ...s, type: "shoot", sort: s.date || "9999-12-31" }));

  const timeline = useMemo(() => {
    let all = [...launches, ...shootEntries];
    if (brand !== "all") all = all.filter((e) => e.type === "shoot" ? (e.brands || []).includes(brand) : e.brand === brand);
    return all.sort((a, b) => String(a.sort).localeCompare(String(b.sort)));
  }, [launches, shootEntries, brand]);

  const save = (s) => {
    const list = shoots || [];
    const next = s.id && list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, { ...s, id: s.id || uid() }];
    onSaveShoots(next);
    setEditing(null);
  };
  const remove = (id) => { onSaveShoots((shoots || []).filter((x) => x.id !== id)); setEditing(null); };

  const todayIso = "2026-07-15"; // seeded "today" for upcoming highlighting

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <div style={{ fontFamily: sans, fontSize: 22, fontWeight: 300, letterSpacing: 1, color: c.ink }}>Operations Calendar</div>
        <div style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>Launches & shoots across every brand</div>
        <button onClick={() => setEditing({ brands: brand === "all" ? [] : [brand] })} style={{ marginLeft: "auto", background: c.ink, color: c.bg, border: "none", borderRadius: 1, padding: "8px 14px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer" }}>+ Add shoot</button>
      </div>

      {/* brand toggle */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "14px 0 22px" }}>
        {[{ key: "all", label: "All", color: c.taupe }, ...BRANDS].map((b) => (
          <button key={b.key} onClick={() => setBrand(b.key)} style={{ background: brand === b.key ? b.color : "transparent", color: brand === b.key ? "#FFFFFF" : c.sub, border: `1px solid ${brand === b.key ? b.color : c.line}`, borderRadius: 20, padding: "6px 15px", fontFamily: sans, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", cursor: "pointer" }}>{b.label}</button>
        ))}
      </div>

      {timeline.length === 0 && <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 13, color: c.sub, padding: "40px 0", textAlign: "center" }}>Nothing scheduled yet — add a shoot, or set a launch month on a look in any board.</div>}

      {/* timeline */}
      <div style={{ position: "relative" }}>
        {timeline.map((e, i) => {
          const upcoming = String(e.sort) >= todayIso;
          return (
            <div key={(e.id || e.brand + e.month) + i} style={{ display: "flex", gap: 16, paddingBottom: 22, opacity: upcoming ? 1 : 0.55 }}>
              {/* date rail */}
              <div style={{ flex: "0 0 92px", textAlign: "right", paddingTop: 2 }}>
                <div style={{ fontFamily: sans, fontSize: 12, color: c.ink, fontWeight: 500 }}>
                  {e.type === "shoot" ? (e.dateLabel || dayLabel(e.date)) : monthLabel(e.month).split(" ")[0]}
                </div>
                <div style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>{e.type === "shoot" ? (e.tbd ? "TBD" : e.tentative ? "tentative" : (e.start ? e.start + (e.end ? "–" + e.end : "") : "")) : monthLabel(e.month).split(" ")[1]}</div>
              </div>
              {/* dot + line */}
              <div style={{ flex: "0 0 12px", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: e.type === "shoot" ? "#CDBBA7" : (brandOf(e.brand) || {}).color || c.taupe, border: "2px solid #FFFFFF", boxShadow: `0 0 0 1px ${c.line}`, marginTop: 2 }} />
                {i < timeline.length - 1 && <div style={{ flex: 1, width: 1, background: c.line, marginTop: 4 }} />}
              </div>
              {/* content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {e.type === "shoot" ? (
                  <div onClick={() => setEditing(e)} style={{ cursor: "pointer", border: `1px solid ${c.line}`, borderRadius: 2, padding: "10px 13px", background: c.bg }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#CDBBA7", border: "1px solid #E4DACB", borderRadius: 4, padding: "2px 7px" }}>📸 Shoot</span>
                      <span style={{ fontFamily: sans, fontSize: 13.5, color: c.ink }}>{e.title || "Shoot"}</span>
                      {e.tbd && <span style={{ fontFamily: sans, fontSize: 9, color: c.red }}>· time/date TBD</span>}
                      {e.tentative && <span style={{ fontFamily: sans, fontSize: 9, color: c.sub }}>· tentative</span>}
                    </div>
                    <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
                      {(e.brands || []).map((bk) => { const b = brandOf(bk); return b ? <span key={bk} style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: "#FFFFFF", background: b.color, borderRadius: 3, padding: "2px 8px" }}>{b.label}</span> : null; })}
                    </div>
                    {e.note && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub, marginTop: 6 }}>{e.note}</div>}
                  </div>
                ) : (
                  <div style={{ border: `1px solid ${c.line}`, borderRadius: 2, padding: "10px 13px", background: c.bg }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: "#FFFFFF", background: (brandOf(e.brand) || {}).color, borderRadius: 3, padding: "2px 8px" }}>{(brandOf(e.brand) || {}).label}</span>
                      <span style={{ fontFamily: sans, fontSize: 13.5, color: c.ink }}>{monthLabel(e.month)} launch</span>
                      <span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>· {e.items.length} look{e.items.length === 1 ? "" : "s"} · {e.board}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, WebkitOverflowScrolling: "touch" }}>
                      {e.items.map((it, j) => (
                        <div key={j} style={{ flex: "0 0 auto", width: 84 }}>
                          <img src={it.cover} alt={it.name} style={{ width: 84, height: 108, objectFit: "cover", borderRadius: 2, border: `1px solid ${c.line}`, display: "block" }} />
                          <div style={{ fontFamily: sans, fontSize: 9, color: c.sub, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editing && <ShootEditor shoot={editing} onSave={save} onDelete={editing.id ? () => remove(editing.id) : null} onClose={() => setEditing(null)} />}
    </div>
  );
}

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
          <div style={{ fontFamily: sans, fontSize: 18, fontWeight: 300, color: c.ink }}>{shoot.id ? "Shoot" : "New shoot"}</div>
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
        <input style={input} value={dateLabel} onChange={(e) => setDateLabel(e.target.value)} placeholder="e.g. Week of Jul 27 · 3rd week of Nov" />

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
