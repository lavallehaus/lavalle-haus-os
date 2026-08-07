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
  if (w) return w.id;
  // Fallback by board-key shape (covers R&D boards not listed in a workspace).
  const k = boardKey || "";
  if (k.includes("the-fold")) return "the-fold";
  if (k.includes("lavalle-sisters")) return "lavalle-sisters";
  if (k.includes("refillery") || k.startsWith("rh-") || k.includes("lavalle-haus")) return "lavalle-haus";
  return null;
};
// Which board+list actually feed the calendar's launches. Scoped tight so the
// content/sister boards (reels, posts, strategy) don't flood the tray. The Fold
// R&D + The Fold ops outfits are all looks; LH Ops only via its Launch Timeline.
const launchAllowed = (boardKey, listName) => {
  if (boardKey === "the-fold-rd") return true; // August Collection looks
  if (boardKey === "rh-operations") return /launch timeline/i.test(listName || ""); // LH launch products
  if (boardKey === "rd") return /^r\s*&?\s*d$/i.test((listName || "").trim()); // LH R&D pipeline list
  return false;
};
// Not just photoshoots — any dated thing on the ops calendar.
const EVENT_TYPES = [
  { key: "shoot", label: "Photoshoot", icon: "📸" },
  { key: "tradeshow", label: "Trade show", icon: "👗" },
  { key: "event", label: "Event", icon: "★" },
  { key: "meeting", label: "Meeting", icon: "🤝" },
  { key: "launch", label: "Launch", icon: "🚀" },
  { key: "travel", label: "Travel", icon: "✈️" },
  { key: "deadline", label: "Deadline", icon: "⏳" },
];
const typeMeta = (t) => EVENT_TYPES.find((x) => x.key === t) || EVENT_TYPES[0];
// Tray categories — Kiaredza reads the pipeline off these colors.
const CATS = {
  launch: { label: "Launching", color: "#5a7a5a" },
  rd:     { label: "R&D pipeline", color: "#7a5a7a" },
  pr:     { label: "PR", color: "#5a6b7a" },
};
const catMeta = (k) => CATS[k] || CATS.launch;
const to12h = (hhmm) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ""); if (!m) return hhmm || ""; let h = +m[1]; const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return h + ":" + m[2] + " " + ap; };
// Downscale an image file to a compact JPEG data URL for an event cover.
const fileToCover = (file, cb) => { const r = new FileReader(); r.onload = () => { const img = new Image(); img.onload = () => { const max = 900; let w = img.width, h = img.height; if (w > max || h > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); } const cv = document.createElement("canvas"); cv.width = w; cv.height = h; cv.getContext("2d").drawImage(img, 0, 0, w, h); cb(cv.toDataURL("image/jpeg", 0.82)); }; img.src = r.result; }; r.readAsDataURL(file); };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const uid = () => "s" + Math.random().toString(36).slice(2, 9);
const input = { width: "100%", padding: "9px 10px", border: `1px solid ${c.line}`, borderRadius: 1, fontFamily: sans, fontSize: 13, color: c.ink, boxSizing: "border-box", background: c.bg };

export default function OpsCalendar({ boards, shoots, onSaveShoots, onSetLaunchMonth }) {
  const [brand, setBrand] = useState("all");
  // all · launch · rd · pr · happening — her "separate calendars and all together"
  const [cat, setCat] = useState("all");
  const [editing, setEditing] = useState(null);
  const [ym, setYm] = useState(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); });
  const [ci, setCi] = useState(0);
  const [assign, setAssign] = useState(null); // an unscheduled look being given a month
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
      const listName = {}; (b.lists || []).forEach((l) => (listName[l.id] = l.name));
      b.cards.forEach((cd) => { if (cd.launchMonth === ym && launchAllowed(bk, listName[cd.listId])) out.push({ name: cd.name, cover: cd.cover || null, brand: br, board: b.name, cat: cd.calCat || (bk === "rd" ? "rd" : "launch") }); });
    });
    return out;
  }, [boards, ym, brand]);
  useEffect(() => { setCi(0); }, [cat, ym, brand]); // eslint-disable-line

  // Unscheduled looks — items on the boards with a cover but no launch month yet.
  const unscheduled = useMemo(() => {
    const out = [];
    Object.entries(boards || {}).forEach(([bk, b]) => {
      if (!b || !b.cards || bk.startsWith("_")) return;
      const br = boardBrand(bk, boards);
      if (!br || (brand !== "all" && br !== brand)) return;
      const listName = {}; (b.lists || []).forEach((l) => (listName[l.id] = l.name));
      b.cards.forEach((cd) => { if (cd.cover && !cd.launchMonth && launchAllowed(bk, listName[cd.listId])) out.push({ boardKey: bk, cardId: cd.id, name: cd.name, cover: cd.cover, brand: br, board: b.name }); });
    });
    return out;
  }, [boards, brand]);

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

  const shownLaunches = cat === "happening" ? [] : launchItems.filter((it) => cat === "all" || it.cat === cat);
  const shownShootsByDay = cat === "all" || cat === "happening" ? shootsByDay : {};
  const n = shownLaunches.length;
  const cur = shownLaunches[ci];

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ fontFamily: sans, fontSize: 22, fontWeight: 300, letterSpacing: 1, color: c.ink }}>Operations Calendar</div>
        <div style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>Launches & shoots across every brand</div>
        <button onClick={() => setEditing({ brands: brand === "all" ? [] : [brand], date: ym + "-15", type: "event" })} style={{ marginLeft: "auto", background: c.ink, color: c.bg, border: "none", borderRadius: 1, padding: "8px 14px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer" }}>+ Add event</button>
      </div>

      {/* brand toggle */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {[{ key: "all", label: "All", color: c.taupe }, ...BRANDS].map((b) => (
          <button key={b.key} onClick={() => setBrand(b.key)} style={{ background: brand === b.key ? b.color : "transparent", color: brand === b.key ? "#FFFFFF" : c.sub, border: `1px solid ${brand === b.key ? b.color : c.line}`, borderRadius: 20, padding: "6px 15px", fontFamily: sans, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", cursor: "pointer" }}>{b.label}</button>
        ))}
      </div>

      {/* category toggle: each tag its own calendar, or everything at once */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {[["all", "All", c.taupe], ["launch", CATS.launch.label, CATS.launch.color], ["rd", CATS.rd.label, CATS.rd.color], ["pr", CATS.pr.label, CATS.pr.color], ["happening", "Happening", c.ink]].map(([k, lab, col]) => (
          <button key={k} onClick={() => setCat(k)} style={{ background: cat === k ? col : "transparent", color: cat === k ? "#FFFFFF" : c.sub, border: `1px solid ${cat === k ? col : c.line}`, borderRadius: 20, padding: "5px 13px", fontFamily: sans, fontSize: 9.5, letterSpacing: 1.2, textTransform: "uppercase", cursor: "pointer" }}>{lab}</button>
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
          {cur.cover
            ? <img src={cur.cover} alt={cur.name} style={{ width: 96, height: 124, objectFit: "cover", borderRadius: 2, flexShrink: 0, border: `1px solid ${c.line}` }} />
            : <div style={{ width: 96, height: 124, borderRadius: 2, flexShrink: 0, border: `1px solid ${c.line}`, background: catMeta(cur.cat).color, display: "flex", alignItems: "center", justifyContent: "center", padding: 8, boxSizing: "border-box", fontFamily: sans, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#fff", textAlign: "center" }}>{cur.name.slice(0, 40)}</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: catMeta(cur.cat).color }}>{catMeta(cur.cat).label} · this month</div>
            <div style={{ fontFamily: sans, fontSize: 16, color: c.ink, margin: "3px 0 5px" }}>{cur.name}</div>
            <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: "#FFFFFF", background: (brandOf(cur.brand) || {}).color, borderRadius: 3, padding: "2px 8px" }}>{(brandOf(cur.brand) || {}).label}</span>
            <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: "#FFFFFF", background: catMeta(cur.cat).color, borderRadius: 3, padding: "2px 8px", marginLeft: 6 }}>{catMeta(cur.cat).label}</span>
            {n > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                <button onClick={() => setCi((ci - 1 + n) % n)} style={miniBtn}>‹</button>
                <div style={{ display: "flex", gap: 5 }}>{shownLaunches.map((_, i) => <div key={i} onClick={() => setCi(i)} style={{ width: i === ci ? 18 : 6, height: 6, borderRadius: 3, background: i === ci ? c.taupe : c.line, cursor: "pointer", transition: "width .2s" }} />)}</div>
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
              const list = (d && shownShootsByDay[d]) || [];
              return (
                <div key={i} onClick={() => d && setEditing({ brands: brand === "all" ? [] : [brand], date: ym + "-" + String(d).padStart(2, "0") })}
                  style={{ minHeight: 92, borderRight: `1px solid ${c.line}`, borderBottom: `1px solid ${c.line}`, padding: 5, background: d ? c.bg : "#FAFAF9", cursor: d ? "pointer" : "default", position: "relative" }}>
                  {d && <div style={{ fontFamily: sans, fontSize: 11, color: isToday ? "#FFFFFF" : c.sub, fontWeight: isToday ? 600 : 400, width: isToday ? 20 : "auto", height: isToday ? 20 : "auto", borderRadius: "50%", background: isToday ? c.taupe : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{d}</div>}
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 3 }}>
                    {list.map((s) => (
                      <button key={s.id} onClick={(e) => { e.stopPropagation(); setEditing(s); }} title={s.title}
                        style={{ display: "flex", alignItems: "center", gap: 4, textAlign: "left", border: "none", borderRadius: 3, padding: "3px 5px", cursor: "pointer", background: (brandOf((s.brands || [])[0]) || {}).color || c.taupe, color: "#FFFFFF", fontFamily: sans, fontSize: 9, lineHeight: 1.25, overflow: "hidden" }}>
                        {s.cover && <img src={s.cover} alt="" style={{ width: 16, height: 16, borderRadius: 2, objectFit: "cover", flexShrink: 0 }} />}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{typeMeta(s.type).icon} {s.title || typeMeta(s.type).label}{s.start ? " · " + to12h(s.start) : ""}{s.tbd ? " · TBD" : s.tentative ? " ~" : ""}
                          {(s.brands || []).length > 1 && <span style={{ fontSize: 8, opacity: 0.85 }}> · {(s.brands || []).map((b) => (brandOf(b) || {}).label).join(" + ")}</span>}</span>
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

      {/* Unscheduled looks tray — items connected from the boards, awaiting a month */}
      {unscheduled.length > 0 && (
        <div style={{ marginTop: 24, borderTop: `1px solid ${c.line}`, paddingTop: 16 }}>
          <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 3 }}>Unscheduled looks · {unscheduled.length}</div>
          <div style={{ fontFamily: sans, fontSize: 11, color: c.sub, marginBottom: 10 }}>These are pulled from your boards — tap one to give it a launch month and it jumps onto the calendar.</div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, WebkitOverflowScrolling: "touch" }}>
            {unscheduled.map((it) => (
              <div key={it.boardKey + it.cardId} onClick={() => setAssign(it)} style={{ flex: "0 0 auto", width: 92, cursor: "pointer", opacity: assign && assign.cardId === it.cardId ? 1 : 0.96 }}>
                <div style={{ position: "relative" }}>
                  <img src={it.cover} alt={it.name} style={{ width: 92, height: 118, objectFit: "cover", borderRadius: 2, border: `2px solid ${assign && assign.cardId === it.cardId ? c.ink : c.line}`, display: "block" }} />
                  <span style={{ position: "absolute", top: 4, left: 4, fontFamily: sans, fontSize: 8, letterSpacing: 0.5, textTransform: "uppercase", color: "#FFFFFF", background: (brandOf(it.brand) || {}).color, borderRadius: 2, padding: "1px 5px" }}>{(brandOf(it.brand) || {}).label.split(" ").pop()}</span>
                </div>
                <div style={{ fontFamily: sans, fontSize: 9.5, color: c.sub, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
              </div>
            ))}
          </div>
          {assign && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, background: c.card, border: `1px solid ${c.line}`, borderRadius: 2, padding: "10px 12px", flexWrap: "wrap" }}>
              <span style={{ fontFamily: sans, fontSize: 12, color: c.ink }}>Launch <strong>{assign.name}</strong> in:</span>
              <input type="month" autoFocus onChange={(e) => { const m = e.target.value; if (m && onSetLaunchMonth) { onSetLaunchMonth(assign.boardKey, assign.cardId, m); setYm(m); setAssign(null); } }}
                style={{ ...input, width: "auto", flex: "0 0 auto" }} />
              <button onClick={() => setAssign(null)} style={{ background: "transparent", border: `1px solid ${c.line}`, borderRadius: 1, padding: "8px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {editing && <ShootEditor shoot={editing} onSave={(s) => { const list = shoots || []; onSaveShoots(s.id && list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, { ...s, id: s.id || uid() }]); setEditing(null); }} onDelete={editing.id ? () => { onSaveShoots((shoots || []).filter((x) => x.id !== editing.id)); setEditing(null); } : null} onClose={() => setEditing(null)} />}
    </div>
  );
}
const navBtn = { background: "transparent", border: `1px solid ${c.line}`, borderRadius: "50%", width: 34, height: 34, fontSize: 18, color: c.ink, cursor: "pointer", lineHeight: 1 };
const miniBtn = { background: c.bg, border: `1px solid ${c.line}`, borderRadius: "50%", width: 26, height: 26, fontSize: 14, color: c.ink, cursor: "pointer", lineHeight: 1 };

function ShootEditor({ shoot, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState(shoot.title || "");
  const [type, setType] = useState(shoot.type || "shoot");
  const [cover, setCover] = useState(shoot.cover || null);
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
          <div style={{ fontFamily: sans, fontSize: 18, fontWeight: 300, color: c.ink }}>{shoot.id ? "Edit event" : "New event"}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: c.sub, cursor: "pointer" }}>×</button>
        </div>

        <div style={label}>Type</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {EVENT_TYPES.map((t) => (
            <button key={t.key} onClick={() => setType(t.key)} style={{ background: type === t.key ? c.ink : "transparent", color: type === t.key ? "#FFFFFF" : c.sub, border: `1px solid ${type === t.key ? c.ink : c.line}`, borderRadius: 20, padding: "6px 12px", fontFamily: sans, fontSize: 10, letterSpacing: 0.5, cursor: "pointer" }}>{t.icon} {t.label}</button>
          ))}
        </div>

        <div style={label}>Title</div>
        <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fashion trade show · The Fold — Sacia shoot" />

        <div style={label}>Cover photo (optional)</div>
        {cover && <img src={cover} alt="" style={{ display: "block", width: "100%", maxHeight: 200, objectFit: "cover", borderRadius: 2, border: `1px solid ${c.line}`, marginBottom: 6 }} />}
        <div style={{ display: "flex", gap: 6 }}>
          <label style={{ border: `1px solid ${c.line}`, borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>
            {cover ? "Replace" : "Upload"}
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) fileToCover(f, setCover); }} />
          </label>
          {cover && <button onClick={() => setCover(null)} style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.red, cursor: "pointer" }}>Remove</button>}
        </div>

        <div style={label}>Brands (optional — tag one or more; a founder shoot can be all)</div>
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
          <div style={{ flex: 1 }}><div style={label}>Start</div><input style={input} type="time" value={start} onChange={(e) => setStart(e.target.value)} />{start && <div style={{ fontFamily: sans, fontSize: 10, color: c.sub, marginTop: 2 }}>{to12h(start)}</div>}</div>
          <div style={{ flex: 1 }}><div style={label}>End</div><input style={input} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />{end && <div style={{ fontFamily: sans, fontSize: 10, color: c.sub, marginTop: 2 }}>{to12h(end)}</div>}</div>
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: sans, fontSize: 12, color: c.ink, cursor: "pointer" }}><input type="checkbox" checked={tbd} onChange={() => setTbd(!tbd)} /> Date/time TBD</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: sans, fontSize: 12, color: c.ink, cursor: "pointer" }}><input type="checkbox" checked={tentative} onChange={() => setTentative(!tentative)} /> Tentative</label>
        </div>

        <div style={label}>Note</div>
        <textarea style={{ ...input, resize: "vertical" }} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Location, looks to shoot, who's needed…" />

        <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
          <button onClick={() => onSave({ ...shoot, type, cover, title: title.trim(), brands, date, start, end, dateLabel: dateLabel.trim(), tbd, tentative, note: note.trim() })}
            style={{ flex: 1, background: c.ink, color: c.bg, border: "none", borderRadius: 1, padding: "11px 0", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Save event</button>
          {onDelete && <button onClick={onDelete} style={{ background: "transparent", color: c.red, border: `1px solid ${c.line}`, borderRadius: 1, padding: "11px 16px", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Delete</button>}
        </div>
      </div>
    </div>
  );
}
