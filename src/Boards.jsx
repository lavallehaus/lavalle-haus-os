import { useEffect, useMemo, useRef, useState } from "react";
import ContentBrain from "./ContentBrain.jsx";
import { UGC_DM_SCRIPT, UGC_EMAIL_SUBJECT, UGC_EMAIL_BODY, UGC_BRIEF_PDF, UGC_EMAIL_FROM, composeOutreachEmail } from "./ugcOutreach.js";

// LAVALLE HAUS OS — Boards (Content → Boards)
// The Trello workspaces, brought home. Three businesses, each with its boards;
// lists as columns; cards with covers, neutral-palette labels, members, due
// dates, a completion circle, and a comments & activity thread with @tags.
// Tagged members get an email when their card changes or they're mentioned
// (delivery needs their email on the Team roster). Undo/Redo on every change.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", red: "#9b5e5e", green: "#5a7a5a" };
const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export const WORKSPACES = [
  { id: "lavalle-sisters", label: "Lavalle Sisters", tagline: "Sister founder business", boards: ["lavalle-sisters", "archives-lavalle-sisters", "master-projects"] },
  { id: "lavalle-haus", label: "Lavalle Haus", tagline: "Body & home · operations · R&D", boards: ["refillery-haus", "rh-operations", "rd"] },
  { id: "the-fold", label: "The Fold", tagline: "The label", boards: ["the-fold", "the-fold-operations"] },
  { id: "pr-ugc", label: "PR + UGC", tagline: "Creator seeding · press · UGC reference edits", boards: ["pr-refillery-haus", "pr-the-fold"] },
];

const uid = () => "bc" + Math.random().toString(36).slice(2, 9);
// Each board's brand → its locked Instagram handle (Sisters → @lavallesisters,
// The Fold → @thefoldlabel, Lavalle Haus → @refilleryhaus). Mirrors api/data.js.
const igForBoardName = (name) => /lavalle\s*sisters/i.test(name || "") ? "lavallesisters"
  : /the\s*fold|^tf\b/i.test(name || "") ? "thefoldlabel"
  : /lavalle\s*haus|refillery|^lh\b/i.test(name || "") ? "refilleryhaus" : null;
const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

// URLs pasted into Notes become tappable chips. Real <a> tags matter here:
// on the phone a genuine tap on a tiktok.com / drive.google.com link hands
// off to the TikTok / Google Drive app via universal links.
export const URL_RX = /https?:\/\/[^\s<>")\]]+/g;
export const linkMeta = (u) => {
  try {
    const h = new URL(u).hostname.replace(/^www\./, "");
    if (h.includes("tiktok.com")) return { icon: "♪", label: "TikTok" };
    if (h === "drive.google.com") return { icon: "▸", label: u.includes("/folders/") ? "Drive folder" : "Drive file" };
    if (h === "docs.google.com") return { icon: "▸", label: u.includes("/spreadsheets/") ? "Google Sheet" : "Google Doc" };
    if (h.includes("instagram.com")) return { icon: "◉", label: "Instagram" };
    if (h.includes("pinterest.")) return { icon: "◌", label: "Pinterest" };
    if (h.includes("thefoldlabel.com")) return { icon: "⌂", label: "The Fold site" };
    if (h.includes("refilleryhaus.com")) return { icon: "⌂", label: "Refillery site" };
    return { icon: "↗", label: h };
  } catch { return { icon: "↗", label: String(u).slice(0, 30) }; }
};
export function NotesLinks({ text }) {
  const urls = [...new Set(String(text || "").match(URL_RX) || [])];
  if (!urls.length) return null;
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6, marginBottom: 4 }}>
      {urls.map((u, i) => {
        const m = linkMeta(u);
        return (
          <a key={i} href={u} target="_blank" rel="noopener noreferrer" title={u}
            style={{ border: `1px solid ${c.line}`, borderRadius: 1, padding: "5px 11px", fontFamily: sans, fontSize: 10.5, letterSpacing: 0.5, color: c.ink, textDecoration: "none", background: c.bg, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: c.taupe }}>{m.icon}</span> {m.label} ↗
          </a>
        );
      })}
    </div>
  );
}

// The Row palette — neutral label colors only.
export const LABEL_PALETTE = [
  { c: "#E9E6DF", t: "#1A1A1A", name: "Ivory" },
  { c: "#E3DCCC", t: "#1A1A1A", name: "Sand" },
  { c: "#D9CFC1", t: "#1A1A1A", name: "Taupe" },
  { c: "#CDBBA7", t: "#1A1A1A", name: "Clay" },
  { c: "#C9C6B4", t: "#1A1A1A", name: "Olive" },
  { c: "#CBD1C5", t: "#1A1A1A", name: "Sage" },
  { c: "#C6CCCF", t: "#1A1A1A", name: "Slate" },
  { c: "#E2D4CD", t: "#1A1A1A", name: "Blush" },
  { c: "#8F8676", t: "#FFFFFF", name: "Deep taupe" },
  { c: "#1A1A1A", t: "#FFFFFF", name: "Ink" },
];
// legacy Trello color names → the neutral palette
const LEGACY_COLOR = { green: "#CBD1C5", yellow: "#E3DCCC", orange: "#CDBBA7", red: "#E2D4CD", purple: "#C6CCCF", blue: "#C6CCCF", sky: "#C6CCCF", lime: "#C9C6B4", pink: "#E2D4CD", black: "#8F8676" };
const normLabel = (lb) => {
  if (typeof lb === "string") return { n: lb, c: LEGACY_COLOR[lb.toLowerCase()] || "#E9E6DF" };
  return { n: lb.n || "", c: lb.c || "#E9E6DF" };
};
const labelText = (hex) => (hex === "#8F8676" || hex === "#1A1A1A" ? "#FFFFFF" : "#1A1A1A");

// Board backgrounds — Trello-style picker: upload a photo or pick a tone.
const BG_PRESETS = [
  { id: "ivory", css: "linear-gradient(165deg,#EDE9E2,#DDD5C8)" },
  { id: "sand", css: "linear-gradient(165deg,#E3DCCC,#CDBBA7)" },
  { id: "sage", css: "linear-gradient(165deg,#D9DED2,#B9C2B1)" },
  { id: "slate", css: "linear-gradient(165deg,#D6DBDE,#AEB8BE)" },
  { id: "night", css: "linear-gradient(165deg,#3A3A38,#1E1E1D)" },
];
const boardBgStyle = (bg) => !bg ? {} : bg.startsWith("linear-gradient") || bg.startsWith("#")
  ? { background: bg }
  : { backgroundImage: `url(${bg})`, backgroundSize: "cover", backgroundPosition: "center" };

// Asset links — Drive convention: <asset root>/<Month>/<Reels|Carousels>/<postNumber>.*
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthOf = (cardName, listName) => {
  const t = ((cardName || "") + " " + (listName || "")).toLowerCase();
  return MONTH_NAMES.find((m) => t.includes(m)) || null;
};
const postNumOf = (cardName) => { const m = /post\s*(\d+)/i.exec(cardName || ""); return m ? m[1] : null; };
const isReelCard = (cardName) => /\[(.*reel.*)\]/i.test(cardName || "");
const isCarouselCard = (cardName) => /\[(.*carousel.*)\]/i.test(cardName || "");
const driveIdFrom = (link) => ((link || "").match(/[-\w]{25,}/) || [])[0] || null;
const firstVideoUrl = (text) => (String(text || "").match(URL_RX) || []).find((u) => /tiktok\.com|instagram\.com|youtu/.test(u)) || null;
async function driveLs(folderId) {
  const r = await fetch("/api/data?op=drive_list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId, all: true }) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || ("drive_list " + r.status));
  return d.files || [];
}

// Covers are parked in the media store and the card keeps only a short
// reference. Inlining the base64 here is what grew the saved blob past
// Vercel's 4.5MB request limit, at which point every save was refused and a
// whole session of uploads was lost. If the upload can't be stored we fall back
// to the inline data URL rather than dropping the photo.
async function storeImage(dataUrl) {
  try {
    const r = await fetch("/api/data?op=media_put", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    });
    const d = await r.json();
    return r.ok && d.url ? d.url : dataUrl;
  } catch { return dataUrl; }
}

// Card covers default to 1440px @ 0.9 — Instagram wants at least 1080 wide and
// the old 700px default meant every uploaded cover was upscaled and soft. Now
// that images live in the media store instead of the saved blob, the extra
// weight costs nothing at save time.
function fileToCover(file, cb, maxW = 1440, q = 0.9) {
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = async () => {
      const s = Math.min(1, maxW / img.width);
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      cb(await storeImage(cv.toDataURL("image/jpeg", q)));
    };
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}

// ── Planned cycle generator ──────────────────────────────────────────────────
// Kiabeth plans in blocks of 21 because it's the grid she can hold in her head,
// even though the real cadence (2x/day) posts more than that a month.
// The rules she set:
//   • niche alternates in PAIRS — a whole day stays on one topic before it
//     switches — starting on beauty, which lands 11 beauty / 10 fashion over 21.
//   • 5 carousels, always on TikTok; 2 of those 5 also run as a single static
//     image on Instagram (her existing "[IG static / TikTok carousel]" tag).
//   • the other 16 are reels, split b-roll vs face-to-camera on her 15:20 ratio
//     → 7 b-roll and 9 face-to-camera, alternating between the two sisters.
// Everything generated is a starting point: titles and tags are ordinary fields
// she or the copy editor can rename.
// A "day" is a pair of posts (2x/day), and she requires a face to camera EVERY
// day. That's the binding constraint: 21 posts = 10 pairs + 1, so 11 slots must
// be face to camera, leaving 10 for everything else. Holding her 5 carousels
// fixed, b-roll lands at 5 — her original 7 b-roll simply can't coexist with a
// face to camera every single day.
function buildPlannedCycle(faces = ["Kiabeth", "Kiaredza"]) {
  const N = 21, DAYS = 10;
  // Deliberately NOT every-other-day: even days are beauty and odd days are
  // fashion, so an alternating pattern would have put every carousel on beauty
  // and every b-roll on fashion. These land 3 carousels on beauty days, 2 on
  // fashion, and the b-roll days fall the other way.
  const carouselDays = [0, 3, 4, 7, 8];
  const igStaticDays = [3, 8];            // one fashion, one beauty
  const cards = [];
  let faceTurn = 0;
  const push = (n, kind, niche) => {
    let title, member = null, tag;
    if (kind === "carousel" || kind === "igstatic") {
      tag = kind === "igstatic" ? "IG static / TikTok carousel" : "carousel";
      title = `Post ${n} [${tag}] · ${niche}`;
    } else if (kind === "broll") {
      title = `Post ${n} [reel] B-roll · ${niche}`;
    } else {
      member = faces[faceTurn % faces.length];
      faceTurn++;
      title = `Post ${n} [reel] Face to camera — ${member} · ${niche}`;
    }
    cards.push({ n, title, niche, member });
  };
  for (let d = 0; d < DAYS; d++) {
    const niche = d % 2 === 0 ? "Beauty" : "Fashion"; // whole day on one topic
    const other = carouselDays.includes(d) ? (igStaticDays.includes(d) ? "igstatic" : "carousel") : "broll";
    const first = d * 2 + 1;
    // alternate which half of the day carries the face to camera so it isn't
    // always the morning post
    if (d % 2 === 0) { push(first, "face", niche); push(first + 1, other, niche); }
    else { push(first, other, niche); push(first + 1, "face", niche); }
  }
  push(N, "face", "Beauty"); // 21st post closes the cycle on beauty
  return cards;
}

// Small avatar circle — member photo when uploaded, initials otherwise.
function Avatar({ member, size = 26, ring = "#FFFFFF" }) {
  const s = { width: size, height: size, borderRadius: "50%", border: `2px solid ${ring}`, flexShrink: 0, boxSizing: "border-box" };
  return member && member.avatar
    ? <img src={member.avatar} alt={member.name || ""} title={member.name || ""} style={{ ...s, objectFit: "cover", display: "block" }} />
    : <span title={(member && member.name) || ""} style={{ ...s, background: "#CDBBA7", color: "#FFFFFF", fontFamily: sans, fontSize: size * 0.34, letterSpacing: 0.5, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(member && member.name)}</span>;
}

export default function Boards({ data, onSave, team = [], viewer = { name: "", email: "", owner: true }, onSaveTeam, gridPlanner = null }) {
  const [boards, setBoards] = useState(data || null);
  const [loading, setLoading] = useState(!data);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [ws, setWs] = useState(() => { try { return localStorage.getItem("lh_boards_ws") || "lavalle-haus"; } catch { return "lavalle-haus"; } });
  useEffect(() => { try { localStorage.setItem("lh_boards_ws", ws); } catch {} }, [ws]);
  const [open, setOpen] = useState(null);
  const [editCard, setEditCard] = useState(null);
  // Comment/activity attribution follows the login; localStorage only backs up
  // house-password sessions that have no personal name.
  const [me, setMe] = useState(() => { try { return localStorage.getItem("lh_me") || ""; } catch { return ""; } });
  useEffect(() => { if (viewer.name && viewer.name !== me) setMe(viewer.name); }, [viewer.name]); // eslint-disable-line
  useEffect(() => { try { if (me) localStorage.setItem("lh_me", me); } catch {} }, [me]);
  // Display-only refresh: while a reel is in flight, pull the latest board state
  // every ~10s so the card's progress bar reflects reality. The actual advancing
  // (publish_item) is done by a single app-level poller (App.jsx) that runs on any
  // screen — keeping it there avoids two pollers double-firing on the same card.
  const boardsRef = useRef(boards); boardsRef.current = boards;
  useEffect(() => {
    if (!viewer.owner) return;
    const tick = async () => {
      const b = boardsRef.current || {};
      let inflight = false;
      for (const bk in b) for (const cd of ((b[bk] && b[bk].cards) || [])) if (cd.pub && (cd.pub.status === "converting" || cd.pub.status === "processing")) inflight = true;
      if (!inflight) return;
      try { const fresh = await (await fetch("/api/data", { cache: "no-store" })).json(); if (fresh && fresh.boards) setBoards(fresh.boards); } catch {}
    };
    const t = setInterval(tick, 10000);
    return () => clearInterval(t);
  }, [viewer.owner]);
  // Tapping the Boards sub-tab always lands on this home (Content Brain view),
  // even if a board was left open.
  useEffect(() => {
    const onSeg = (e) => { if (e.detail && e.detail.id === "content" && e.detail.seg === "boards") setOpen(null); };
    window.addEventListener("lh-seg-click", onSeg);
    return () => window.removeEventListener("lh-seg-click", onSeg);
  }, []);

  // Recently viewed — per person, like Trello's home strip.
  const [recents, setRecents] = useState(() => { try { return JSON.parse(localStorage.getItem("lh_recent_boards") || "[]"); } catch { return []; } });
  const openBoard = (key) => {
    setOpen(key);
    setRecents((r) => { const next = [key, ...r.filter((x) => x !== key)].slice(0, 6); try { localStorage.setItem("lh_recent_boards", JSON.stringify(next)); } catch {} return next; });
  };
  const tileBg = (b) => (b && b.bg ? boardBgStyle(b.bg) : { background: "linear-gradient(150deg,#EDE9E2,#DDD5C8)" });
  const [bgMenu, setBgMenu] = useState(false);
  const [lookbook, setLookbook] = useState(false); // full-screen swipeable month view of a board's looks
  const [shoots, setShoots] = useState(null); // photoshoot dates from the connected calendar ([{month:"YYYY-MM", label, date}])
  const [linking, setLinking] = useState(null); // progress text while Link assets runs
  const [accessMenu, setAccessMenu] = useState(null); // boardKey whose access editor is open
  const [membersMenu, setMembersMenu] = useState(false); // open-board header member panel
  const [profileMember, setProfileMember] = useState(null); // member name whose Trello-style profile card is open
  const [profileActivity, setProfileActivity] = useState(false);
  const [listMenu, setListMenu] = useState(null); // list id whose ⋯ menu is open
  const [dragCard, setDragCard] = useState(null); // card id being dragged (Trello drag & drop)
  const [dropHint, setDropHint] = useState(null); // card id we'd drop before, or "list:<id>" for end-of-list
  const [touchDrag, setTouchDrag] = useState(null); // card id being long-press dragged (phone)
  // Live-reorder preview: while the finger travels, the list re-flows so cards
  // part around the drag — and the drop commits WHEREVER THE GAP IS, never a
  // recalculation at lift (recalculating at lift is what snapped cards back to
  // the bottom when the finger released over a header, gap or sticky bar).
  const [previewAt, setPreviewAt] = useState(null); // { listId, anchorId|null, after }
  const previewRef = useRef(null);
  const [touchPos, setTouchPos] = useState(null); // finger position for the drag ghost
  const touchTimer = useRef(null);
  const touchStartPos = useRef(null);
  const suppressClick = useRef(0);

  // Long-press drag on touch screens, like the Trello app: hold a card ~0.4s,
  // then slide it anywhere. Native listeners because React's are passive and
  // the page must stop scrolling while a card is in hand.
  useEffect(() => {
    if (!touchDrag) return;
    const hintFor = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const cardEl = el.closest("[data-dragcard]");
      if (cardEl && cardEl.dataset.dragcard !== touchDrag) {
        const r = cardEl.getBoundingClientRect();
        return { type: "card", cardId: cardEl.dataset.dragcard, listId: cardEl.dataset.draglist, after: y > r.top + r.height / 2 };
      }
      const colEl = el.closest("[data-dragcol]");
      if (colEl) {
        // Not on a card — snap to the NEAREST card in this column by vertical
        // distance. Landing in a 6px gap used to mean "append to the end",
        // which yanked the card straight back to the bottom of the list.
        let best = null, bestD = Infinity;
        colEl.querySelectorAll("[data-dragcard]").forEach((ce) => {
          if (ce.dataset.dragcard === touchDrag) return;
          const r = ce.getBoundingClientRect();
          const d2 = Math.abs(y - (r.top + r.height / 2));
          if (d2 < bestD) { bestD = d2; best = { type: "card", cardId: ce.dataset.dragcard, listId: ce.dataset.draglist, after: y > r.top + r.height / 2 }; }
        });
        return best || { type: "list", listId: colEl.dataset.dragcol };
      }
      return null;
    };
    const lastPos = { x: 0, y: 0 };
    const onMove = (e) => {
      e.preventDefault();
      const t = e.touches[0];
      lastPos.x = t.clientX; lastPos.y = t.clientY;
      setTouchPos({ x: t.clientX, y: t.clientY });
      const h = hintFor(t.clientX, t.clientY);
      if (h) {
        const p = h.type === "card" ? { listId: h.listId, anchorId: h.cardId, after: h.after } : { listId: h.listId, anchorId: null, after: true };
        previewRef.current = p;
        setPreviewAt(p);
      }
      // h === null (sticky bar, page chrome): the last good preview stands
    };
    // While the card is lifted the page can't scroll (deliberate), so the
    // column scrolls itself whenever the finger parks near its edges.
    const scroller = setInterval(() => {
      if (!lastPos.y) return;
      const el = document.elementFromPoint(lastPos.x, lastPos.y);
      const colEl = el && el.closest("[data-dragcol]");
      const scrollEl = colEl && [...colEl.querySelectorAll("div")].find((d2) => d2.scrollHeight > d2.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(d2).overflowY));
      if (scrollEl) {
        const r = scrollEl.getBoundingClientRect();
        if (lastPos.y < r.top + 90) scrollEl.scrollTop -= 16;
        else if (lastPos.y > r.bottom - 90) scrollEl.scrollTop += 16;
      }
      // and the page itself, for reaching other lists on a phone
      if (lastPos.y < 100) window.scrollBy(0, -14);
      else if (lastPos.y > window.innerHeight - 100) window.scrollBy(0, 14);
    }, 50);
    const onEnd = () => {
      const p = previewRef.current;
      if (p) moveCard(touchDrag, p.listId, p.anchorId, p.after);
      suppressClick.current = Date.now();
      previewRef.current = null;
      setPreviewAt(null); setTouchDrag(null); setDragCard(null); setDropHint(null); setTouchPos(null);
    };
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      clearInterval(scroller);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [touchDrag, boards, open]); // eslint-disable-line

  // Lists reorder like Trello too — drag a column by its header (long-press on phones).
  const [dragList, setDragList] = useState(null);
  const [touchDragList, setTouchDragList] = useState(null);
  const moveList = (listId, beforeListId) => {
    const b = boards[open];
    const moving = b.lists.find((x) => x.id === listId);
    if (!moving || listId === beforeListId) return;
    let rest = b.lists.filter((x) => x.id !== listId);
    if (beforeListId) {
      const i = rest.findIndex((x) => x.id === beforeListId);
      rest = i === -1 ? [...rest, moving] : [...rest.slice(0, i), moving, ...rest.slice(i)];
    } else rest = [...rest, moving];
    patchBoard(open, { lists: rest });
  };
  useEffect(() => {
    if (!touchDragList) return;
    const colFor = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const colEl = el.closest("[data-dragcol]");
      return colEl && colEl.dataset.dragcol !== touchDragList ? colEl.dataset.dragcol : null;
    };
    const onMove = (e) => {
      e.preventDefault();
      const t = e.touches[0];
      setTouchPos({ x: t.clientX, y: t.clientY });
      const c2 = colFor(t.clientX, t.clientY);
      setDropHint(c2 ? "listmove:" + c2 : null);
    };
    const onEnd = (e) => {
      const t = (e.changedTouches || [])[0];
      const c2 = t ? colFor(t.clientX, t.clientY) : null;
      if (c2) moveList(touchDragList, c2);
      suppressClick.current = Date.now();
      setTouchDragList(null); setDragList(null); setDropHint(null); setTouchPos(null);
    };
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [touchDragList, boards, open]); // eslint-disable-line

  // Move a whole list — cards and all — to another board (Trello's Move list).
  const moveListToBoard = (listId, destKey) => {
    const src = boards[open];
    const dest = boards[destKey];
    const list = src.lists.find((l) => l.id === listId);
    if (!list || !dest || destKey === open) return;
    const movingCards = src.cards.filter((cd) => cd.listId === listId);
    commit({
      ...boards,
      [open]: { ...src, lists: src.lists.filter((l) => l.id !== listId), cards: src.cards.filter((cd) => cd.listId !== listId) },
      [destKey]: { ...dest, lists: [...dest.lists, list], cards: [...dest.cards, ...movingCards] },
    });
  };

  // Duplicate a card in place (Trello's Copy).
  const duplicateCard = (boardKey, cardId) => {
    const b = boards[boardKey];
    const src = b.cards.find((x) => x.id === cardId);
    if (!src) return;
    const clone = { ...src, id: uid(), name: src.name + " (copy)", done: false, pub: null, comments: [], members: src.members || [] };
    const i = b.cards.findIndex((x) => x.id === cardId);
    patchBoard(boardKey, { cards: [...b.cards.slice(0, i + 1), clone, ...b.cards.slice(i + 1)] });
  };

  // Trello-style drag & drop: drop on a card inserts before it, drop on the
  // list body appends. Order lives in the board's cards array.
  const moveCard = (cardId, toListId, anchorCardId, placeAfter) => {
    const b = boards[open];
    const moving = b.cards.find((x) => x.id === cardId);
    if (!moving || (moving.listId === toListId && anchorCardId === cardId)) return;
    let rest = b.cards.filter((x) => x.id !== cardId);
    const moved = { ...moving, listId: toListId };
    if (anchorCardId) {
      const i = rest.findIndex((x) => x.id === anchorCardId);
      // placeAfter: dropped on the lower half of the anchor card → land below
      // it. Insert-before-only meant dragging DOWN one slot was a no-op.
      rest = i === -1 ? [...rest, moved] : [...rest.slice(0, i + (placeAfter ? 1 : 0)), moved, ...rest.slice(i + (placeAfter ? 1 : 0))];
    } else rest = [...rest, moved];
    patchBoard(open, { cards: rest });
  };
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 700);
  useEffect(() => {
    const onR = () => setNarrow(window.innerWidth < 700);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  const teamByName = useMemo(() => { const m = {}; team.forEach((t) => { m[t.name] = t; }); return m; }, [team]);

  // Account health now lives in the ContentBrain component on the home page.
  const setAvatar = (memberName, dataUrl) => {
    if (!onSaveTeam) return;
    onSaveTeam(team.map((t) => (t.name === memberName ? { ...t, avatar: dataUrl } : t)));
  };

  // Board access — board.access = null/[] means everyone with the Content tab;
  // otherwise only the listed roster members (and the owner) see the board.
  const canSee = (b) => {
    if (!b) return false;
    if (viewer.owner || !b.access || !b.access.length) return true;
    return b.access.some((n) => n === viewer.name || (viewer.email && n.toLowerCase() === viewer.email.toLowerCase()));
  };
  const toggleAccess = (boardKey, memberName) => {
    const b = boards[boardKey];
    const cur = b.access || [];
    const next = cur.includes(memberName) ? cur.filter((x) => x !== memberName) : [...cur, memberName];
    commit({ ...boards, [boardKey]: { ...b, access: next.length ? next : null } });
  };

  // Link assets: walk <asset root>/<Month>/<Reels|Carousels> in Drive and stamp
  // each "Post N" card with a direct link to its numbered file.
  const runLinkAssets = async (boardKey) => {
    const b = boards[boardKey];
    let root = b.assetRoot;
    if (!root) {
      root = prompt("Paste the Drive folder that holds the month folders (April, May, June…)");
      if (!root || !driveIdFrom(root)) return;
    }
    setLinking("Reading Drive…");
    try {
      const listName = {}; b.lists.forEach((l) => { listName[l.id] = l.name; });
      const months = [...new Set(b.cards.map((cd) => monthOf(cd.name, listName[cd.listId])).filter(Boolean))];
      const rootEntries = await driveLs(driveIdFrom(root));
      const monthMaps = {};
      for (const m of months) {
        const mf = rootEntries.find((f) => f.folder && f.name.toLowerCase().includes(m));
        if (!mf) continue;
        const inside = await driveLs(mf.id);
        const map = { reels: {}, carousels: {} };
        for (const kind of ["reels", "carousels"]) {
          const sub = inside.find((f) => f.folder && new RegExp(kind.slice(0, -1), "i").test(f.name));
          if (!sub) continue;
          map[kind + "Id"] = sub.id;
          (await driveLs(sub.id)).forEach((f) => { const n = /^(\d+)/.exec(f.name); if (n && !map[kind][n[1]]) map[kind][n[1]] = f; });
        }
        monthMaps[m] = map;
        setLinking("Reading Drive… " + m + " ✓");
      }
      let linked = 0;
      const cards = b.cards.map((cd) => {
        const m = monthOf(cd.name, listName[cd.listId]); const num = postNumOf(cd.name);
        if (!m || !num || !monthMaps[m]) return cd;
        const map = monthMaps[m];
        const kind = isCarouselCard(cd.name) && !isReelCard(cd.name) ? "carousels" : "reels";
        const hit = map[kind][num] || map[kind === "reels" ? "carousels" : "reels"][num];
        const url = hit ? (hit.folder ? "https://drive.google.com/drive/folders/" + hit.id : "https://drive.google.com/file/d/" + hit.id + "/view")
          : map[kind + "Id"] ? "https://drive.google.com/drive/folders/" + map[kind + "Id"] : null;
        if (!url || cd.assetUrl === url) return cd;
        linked++;
        return { ...cd, assetUrl: url };
      });
      commit({ ...boards, [boardKey]: { ...b, assetRoot: root, cards } });
      setLinking(null);
      alert(linked + " cards linked to their Drive assets.");
    } catch (e) {
      setLinking(null);
      alert(String(e.message || e).includes("google") ? "Google Drive isn't connected — open /api/google-auth once, then run this again." : "Link assets failed: " + (e.message || e));
    }
  };

  // Sync covers: pull the numbered files from this brand's Cover Photos ▸ <Month>
  // folder and stamp each "Post N" card's cover. Re-runnable whenever The Loft
  // drops new covers in the folder.
  const runSyncCovers = async (boardKey) => {
    setLinking("Syncing covers…");
    try {
      const tok = localStorage.getItem("lh_token") || "";
      const r = await fetch("/api/data?op=sync_covers", { method: "POST", headers: { "Content-Type": "application/json", "x-app-token": tok }, body: JSON.stringify({ boardKey }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ("sync " + r.status));
      const fresh = await (await fetch("/api/data")).json();
      if (fresh && fresh.boards) setBoards(fresh.boards);
      setLinking(null);
      const msg = (d.report || []).map((x) => x.month + ": " + (x.covered != null ? x.covered + "/" + x.files + " covered" : x.status)).join(" · ");
      alert("Covers synced from Drive — " + (msg || "done"));
    } catch (e) {
      setLinking(null);
      alert(String(e.message || e).includes("google") ? "Google Drive isn't connected — open /api/google-auth once, then run this again." : "Sync covers failed: " + (e.message || e));
    }
  };

  // First run: seed from the Trello export; later runs merge covers/members once.
  useEffect(() => {
    (async () => {
      if (boards && boards._mediaV3) return;
      try {
        const seed = await fetch("/boards-seed.json").then((r) => r.json());
        if (!boards) {
          setBoards(seed);
          onSave && onSave(seed);
        } else {
          const next = { ...boards, _mediaV2: true, _mediaV3: true };
          for (const [key, sb] of Object.entries(seed)) {
            if (key.startsWith("_") || !next[key]) continue;
            const seedById = {};
            (sb.cards || []).forEach((sc) => { seedById[sc.id] = sc; });
            next[key] = { ...next[key], cards: next[key].cards.map((card) => {
              const sc = seedById[card.id];
              if (!sc) return card;
              return {
                ...card,
                // restore the real notes if ours still carry the [link] placeholders
                desc: sc.desc && (!card.desc || card.desc.includes("[link]")) ? sc.desc : card.desc,
                links: (card.links && card.links.length) ? card.links : (sc.links || []),
                attachments: (card.attachments && card.attachments.length) ? card.attachments : (sc.attachments || []),
                members: (card.members && card.members.length) ? card.members : (sc.members || []),
                cover: card.cover || sc.cover || null,
              };
            }) };
          }
          setBoards(next);
          onSave && onSave(next);
        }
      } catch (e) { if (!boards) setBoards({}); }
      setLoading(false);
    })();
  }, []);

  const commit = (next) => { setPast((p) => [...p.slice(-49), boards]); setFuture([]); setBoards(next); onSave && onSave(next); };
  const undo = () => { if (!past.length) return; const prev = past[past.length - 1]; setPast((p) => p.slice(0, -1)); setFuture((f) => [boards, ...f].slice(0, 50)); setBoards(prev); onSave && onSave(prev); };
  const redo = () => { if (!future.length) return; const nxt = future[0]; setFuture((f) => f.slice(1)); setPast((p) => [...p.slice(-49), boards]); setBoards(nxt); onSave && onSave(nxt); };

  const workspace = WORKSPACES.find((w) => w.id === ws) || WORKSPACES[0];
  const _openBoard = open && boards ? boards[open] : null;
  const board = _openBoard && canSee(_openBoard) ? _openBoard : null;

  const memberPool = useMemo(() => {
    const set = new Set(team.map((t) => t.name).filter(Boolean));
    if (boards) Object.values(boards).forEach((b) => { if (b && b.cards) b.cards.forEach((x) => (x.members || []).forEach((m) => set.add(m))); });
    return [...set].sort();
  }, [boards, team]);

  // name → roster email (loose match: exact, or first names line up)
  const emailFor = (name) => {
    const n = (name || "").trim().toLowerCase();
    const hit = team.find((t) => t.email && (
      t.name.trim().toLowerCase() === n ||
      n.startsWith(t.name.trim().toLowerCase().split(" ")[0]) ||
      t.name.trim().toLowerCase().startsWith(n.split(" ")[0])
    ));
    return hit ? hit.email : null;
  };

  // email everyone tagged on the card (except whoever made the change)
  const notify = (card, summary, extraNames = []) => {
    const names = new Set([...(card.members || []), ...extraNames]);
    names.forEach((m) => {
      if (me && m.trim().toLowerCase().startsWith(me.trim().toLowerCase().split(" ")[0])) return;
      const to = emailFor(m);
      if (!to) return;
      fetch("/api/data?op=notify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject: "Board update — " + card.name, itemTitle: card.name, itemDetail: summary, assignedBy: me || "Lavalle Haus OS Boards" }),
      }).catch(() => {});
    });
  };

  if (loading || !boards) return <div style={{ fontFamily: sans, fontSize: 12, letterSpacing: 2, color: c.sub, textAlign: "center", padding: 50 }}>OPENING THE BOARDS…</div>;

  const boardsIndex = {};
  Object.entries(boards).forEach(([k, b]) => { if (!k.startsWith("_") && b && b.lists) boardsIndex[k] = { name: b.name, lists: b.lists }; });

  const editing = editCard && boards[editCard.boardKey]
    ? (editCard.isNew ? { id: null, listId: editCard.listId, name: "", desc: "", due: null, labels: [], members: [], cover: null, comments: [] } : boards[editCard.boardKey].cards.find((x) => x.id === editCard.cardId))
    : null;

  const patchBoard = (bk, patch, base) => commit({ ...(base || boards), [bk]: { ...(base || boards)[bk], ...patch } });

  const sysComment = (text) => ({ id: uid(), by: me || "Someone", text, at: new Date().toISOString(), sys: true });

  const saveCard = (vals, targetBoardKey) => {
    const srcKey = editCard.boardKey;
    const destKey = targetBoardKey || srcKey;
    const old = editCard.isNew ? null : boards[srcKey].cards.find((x) => x.id === editCard.cardId);
    // describe what changed, for activity + email
    const changes = [];
    if (old) {
      if (old.name !== vals.name) changes.push("renamed");
      if ((old.desc || "") !== (vals.desc || "")) changes.push("notes updated");
      if ((old.due || null) !== (vals.due || null)) changes.push("due date " + (vals.due ? new Date(vals.due).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "cleared"));
      if ((old.cover || null) !== (vals.cover || null)) changes.push(vals.cover ? "cover updated" : "cover removed");
      if (JSON.stringify(old.labels || []) !== JSON.stringify(vals.labels || [])) changes.push("tags updated");
      if (destKey !== srcKey) changes.push("moved to " + boardsIndex[destKey].name);
      else if (old.listId !== vals.listId) changes.push("moved to “" + (boardsIndex[destKey].lists.find((l) => l.id === vals.listId) || {}).name + "”");
      if ((old.done || false) !== (vals.done || false)) changes.push(vals.done ? "marked done" : "reopened");
      const added = (vals.members || []).filter((m) => !(old.members || []).includes(m));
      if (added.length) changes.push("tagged " + added.join(", "));
    }
    const summary = old ? (changes.length ? changes.join(" · ") : null) : "card created";
    const withActivity = summary ? [...(vals.comments || []), sysComment(summary)] : (vals.comments || []);
    const cardOut = editCard.isNew
      ? { id: uid(), ...vals, comments: withActivity }
      : { ...old, ...vals, comments: withActivity };

    if (destKey === srcKey) {
      patchBoard(srcKey, { cards: editCard.isNew ? [...boards[srcKey].cards, cardOut] : boards[srcKey].cards.map((x) => (x.id === editCard.cardId ? cardOut : x)) });
    } else {
      // cross-board move: remove from source, add to destination
      const next = { ...boards };
      next[srcKey] = { ...next[srcKey], cards: next[srcKey].cards.filter((x) => x.id !== editCard.cardId) };
      next[destKey] = { ...next[destKey], cards: [...next[destKey].cards, cardOut] };
      commit(next);
    }
    if (summary && (cardOut.members || []).length) notify(cardOut, summary);
    setEditCard(null);
  };

  // Persist a single field (e.g. cover) immediately, without closing the sheet —
  // so a change survives even if the sheet is dismissed by tapping the backdrop.
  const patchCard = (partial) => {
    if (!editCard || editCard.isNew) return;
    const bk = editCard.boardKey;
    if (!boards[bk]) return;
    patchBoard(bk, { cards: boards[bk].cards.map((x) => (x.id === editCard.cardId ? { ...x, ...partial } : x)) });
  };

  const deleteCard = () => {
    const bk = editCard.boardKey;
    const card = boards[bk].cards.find((x) => x.id === editCard.cardId);
    patchBoard(bk, { cards: boards[bk].cards.filter((x) => x.id !== editCard.cardId) });
    if (card && (card.members || []).length) notify(card, "card removed from " + boards[bk].name);
    setEditCard(null);
  };

  const toggleDone = (bk, cardId) => {
    const card = boards[bk].cards.find((x) => x.id === cardId);
    const nowDone = !card.done;
    patchBoard(bk, { cards: boards[bk].cards.map((x) => (x.id === cardId ? { ...x, done: nowDone, comments: [...(x.comments || []), sysComment(nowDone ? "marked done" : "reopened")] } : x)) });
    if ((card.members || []).length) notify(card, nowDone ? "marked done — posted" : "reopened");
  };

  const addComment = (bk, cardId, text) => {
    const card = boards[bk].cards.find((x) => x.id === cardId);
    const entry = { id: uid(), by: me || "Someone", text, at: new Date().toISOString() };
    patchBoard(bk, { cards: boards[bk].cards.map((x) => (x.id === cardId ? { ...x, comments: [...(x.comments || []), entry] } : x)) });
    // @mentions: notify anyone named after an @
    const mentioned = memberPool.filter((m) => new RegExp("@" + m.split(" ")[0], "i").test(text));
    notify(card, (me || "Someone") + " commented: " + text.slice(0, 140), mentioned);
  };

  const renameList = (l) => {
    const name = prompt("Rename list", l.name);
    if (!name || !name.trim()) return;
    patchBoard(open, { lists: board.lists.map((x) => (x.id === l.id ? { ...x, name: name.trim() } : x)) });
  };
  const deleteList = (l) => {
    const n = board.cards.filter((x) => x.listId === l.id).length;
    if (!confirm(n ? `Delete the list "${l.name}" and its ${n} card${n === 1 ? "" : "s"}?` : `Delete the empty list "${l.name}"?`)) return;
    patchBoard(open, { lists: board.lists.filter((x) => x.id !== l.id), cards: board.cards.filter((x) => x.listId !== l.id) });
  };

  const ghost = { background: "transparent", border: `1px solid ${c.line}`, borderRadius: 1, color: c.sub, fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", padding: "7px 12px", cursor: "pointer" };

  return (
    <div>
      <style>{"@keyframes lhpulse{0%,100%{opacity:.35}50%{opacity:1}}@keyframes lhslide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}</style>
      {/* Click-anywhere backdrop: closes any open header/tile popup. z-index must
          stay BELOW the board header's own stacking context (position:relative;
          zIndex:30 on line ~690) — otherwise it paints over the popups trapped
          inside that context and eats their clicks (e.g. the bg "Upload" button).
          At z:12 it covers the board body (z:0) to catch outside clicks, while the
          header + its popups (z:30+) stay above it and remain clickable. */}
      {(accessMenu || membersMenu || bgMenu || profileMember) && (
        <div onClick={() => { setAccessMenu(null); setMembersMenu(false); setBgMenu(false); setProfileMember(null); setProfileActivity(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 12 }} />
      )}
      {/* undo / redo — identity comes from the login now, no picker needed */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={undo} disabled={!past.length} style={{ ...ghost, color: past.length ? c.sub : c.line, cursor: past.length ? "pointer" : "default" }}>Undo</button>
        <button onClick={redo} disabled={!future.length} style={{ ...ghost, color: future.length ? c.sub : c.line, cursor: future.length ? "pointer" : "default" }}>Redo</button>
        <span style={{ fontFamily: sans, fontSize: 10, color: c.sub, opacity: 0.7 }}>{past.length ? `${past.length} change${past.length === 1 ? "" : "s"} this session` : "no changes yet"}</span>
      </div>

      {/* home: every workspace and its boards on one page — Trello's "Boards" home */}
      {!board ? (
        <div>
          {/* the Content Brain — Business Brain's node map for the three accounts */}
          <ContentBrain boards={boards} gridPlanner={gridPlanner} />

          {/* recently viewed — Trello's home strip, personal to each member */}
          {recents.filter((k) => boards[k] && boards[k].lists && canSee(boards[k])).length > 0 && (
            <div style={{ marginBottom: 26 }}>
              <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 8 }}>Recently viewed</div>
              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
                {recents.filter((k) => boards[k] && boards[k].lists && canSee(boards[k])).slice(0, 6).map((k) => (
                  <div key={k} onClick={() => openBoard(k)} style={{ flex: "0 0 172px", borderRadius: 8, overflow: "hidden", border: `1px solid ${c.line}`, background: c.bg, cursor: "pointer" }}>
                    <div style={{ height: 62, ...tileBg(boards[k]) }} />
                    <div style={{ padding: "8px 12px", fontFamily: sans, fontSize: 12, color: c.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{boards[k].name}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {WORKSPACES.map((w) => (
            <div key={w.id} style={{ marginBottom: 30 }}>
              <div style={{ marginBottom: 10 }}>
                <span style={{ fontFamily: sans, fontSize: 12.5, letterSpacing: 2, textTransform: "uppercase", color: c.ink, fontWeight: 500 }}>{w.label}</span>
                <span style={{ fontFamily: sans, fontSize: 10.5, color: c.sub, marginLeft: 10 }}>{w.tagline}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {[...w.boards, ...Object.keys(boards).filter((k) => !k.startsWith("_") && boards[k] && boards[k].ws === w.id && !w.boards.includes(k))].filter((key) => canSee(boards[key])).map((key) => {
            const b = boards[key];
            if (!b || !b.lists) return null;
            const done = b.cards.filter((x) => x.done).length;
            return (
              <div key={key} onClick={() => openBoard(key)}
                style={{ position: "relative", textAlign: "left", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 8, cursor: "pointer", boxShadow: "0 1px 3px rgba(26,26,26,0.05)", zIndex: accessMenu === key ? 90 : "auto" }}>
                <div style={{ height: 190, position: "relative", borderRadius: "7px 7px 0 0", overflow: "hidden", ...tileBg(b) }}>
                  <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 4 }}>
                    <button title="Rename board" onClick={(e) => { e.stopPropagation(); const name = prompt("Rename board", b.name); if (name && name.trim()) commit({ ...boards, [key]: { ...b, name: name.trim() } }); }}
                      style={{ background: "rgba(255,255,255,0.85)", border: "none", borderRadius: 5, cursor: "pointer", color: c.sub, fontSize: 11, padding: "3px 7px" }}>✎</button>
                    <button title="Delete board" onClick={(e) => { e.stopPropagation(); if (!confirm(`Delete the board "${b.name}"${b.cards.length ? " and its " + b.cards.length + " cards" : ""}?`)) return; const next = { ...boards }; delete next[key]; commit(next); }}
                      style={{ background: "rgba(255,255,255,0.85)", border: "none", borderRadius: 5, cursor: "pointer", color: c.sub, fontSize: 12, padding: "3px 7px" }}>×</button>
                  </div>
                </div>
                <div style={{ padding: "10px 14px 12px" }}>
                <div style={{ fontFamily: sans, fontSize: 14.5, color: c.ink }}>{b.name}</div>
                <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: c.sub, marginTop: 5 }}>
                  {b.lists.length} lists · {b.cards.length} cards{done ? " · " + done + " done" : ""}
                </div>
                {viewer.owner && (
                  <div style={{ position: "relative", marginTop: 8 }}>
                    <button title="Who can open this board" onClick={(e) => { e.stopPropagation(); setAccessMenu(accessMenu === key ? null : key); }}
                      style={{ background: "transparent", border: `1px solid ${c.line}`, borderRadius: 6, padding: "3px 9px", fontFamily: sans, fontSize: 9, letterSpacing: 1.2, textTransform: "uppercase", color: b.access && b.access.length ? c.taupe : c.sub, cursor: "pointer" }}>
                      {b.access && b.access.length ? b.access.length + " member" + (b.access.length > 1 ? "s" : "") : "Everyone"}
                    </button>
                    {accessMenu === key && (
                      <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 80, background: "#FFFFFF", border: `1px solid ${c.line}`, borderRadius: 8, boxShadow: "0 10px 30px rgba(26,26,26,0.14)", padding: 12, width: 220 }}>
                        <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 6 }}>Who can open this board</div>
                        <button onClick={() => { commit({ ...boards, [key]: { ...b, access: null } }); }}
                          style={{ display: "block", width: "100%", textAlign: "left", background: !b.access || !b.access.length ? c.card : "transparent", border: `1px solid ${c.line}`, borderRadius: 6, padding: "6px 9px", fontFamily: sans, fontSize: 11.5, color: c.ink, cursor: "pointer", marginBottom: 6 }}>
                          {!b.access || !b.access.length ? "✓ " : ""}Everyone with the Content tab
                        </button>
                        {team.map((t) => (
                          <label key={t.id || t.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", cursor: "pointer" }}>
                            <input type="checkbox" checked={!!(b.access || []).includes(t.name)} onChange={() => toggleAccess(key, t.name)} />
                            <span style={{ fontFamily: sans, fontSize: 12, color: c.ink }}>{t.name}</span>
                          </label>
                        ))}
                        {!team.length && <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 11, color: c.sub }}>Add people on the Team roster first.</div>}
                        <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 10, color: c.sub, marginTop: 6 }}>Checking names hides this board from everyone else. You always see everything.</div>
                      </div>
                    )}
                  </div>
                )}
                </div>
              </div>
            );
          })}
          <button onClick={() => { const name = prompt("New board name"); if (!name || !name.trim()) return; const key = "b" + uid(); commit({ ...boards, [key]: { name: name.trim(), ws: w.id, lists: [{ id: uid(), name: "To do" }], cards: [] } }); }}
            style={{ background: "transparent", border: `1px dashed ${c.line}`, borderRadius: 1, minHeight: 92, cursor: "pointer", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: c.sub }}>
            + Board
          </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: 12, margin: "0 -24px", minHeight: "calc(100vh - 235px)", boxSizing: "border-box", ...boardBgStyle(board.bg) }}>
          <div style={{ position: "relative", zIndex: 30, display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap", background: board.bg ? "rgba(255,255,255,0.85)" : "transparent", backdropFilter: board.bg ? "blur(6px)" : "none", WebkitBackdropFilter: board.bg ? "blur(6px)" : "none", borderRadius: 8, padding: board.bg ? "8px 12px" : "0 0 2px" }}>
            <button onClick={() => setOpen(null)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, padding: 0 }}>← All boards</button>
            <div style={{ fontFamily: sans, fontSize: 20, fontWeight: 300, color: c.ink }}>{board.name}</div>
            <div style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>{board.cards.length} cards</div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", position: "relative" }}>
              {(() => {
                const members = board.access && board.access.length ? team.filter((t) => board.access.includes(t.name)) : team;
                const shown = members.slice(0, 5);
                return (
                  <button onClick={() => setMembersMenu(!membersMenu)} title="Who can open this board"
                    style={{ display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 0, marginRight: 4 }}>
                    {shown.map((t, i) => <span key={t.id || t.name} style={{ marginLeft: i ? -8 : 0, display: "inline-flex" }}><Avatar member={t} /></span>)}
                    {members.length > shown.length && <span style={{ marginLeft: -8, width: 26, height: 26, borderRadius: "50%", border: "2px solid #FFFFFF", background: c.card, color: c.sub, fontFamily: sans, fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>+{members.length - shown.length}</span>}
                    {!members.length && <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, border: `1px solid ${c.line}`, borderRadius: 6, padding: "4px 9px" }}>Members</span>}
                  </button>
                );
              })()}
              {membersMenu && profileMember && (() => {
                // Trello's member profile card: banner, big avatar, @handle, actions.
                const t = teamByName[profileMember] || { name: profileMember };
                const handle = "@" + ((t.email && !/^(info|ops|hello|contact)@/.test(t.email)) ? t.email.split("@")[0] : (t.name || "").toLowerCase().replace(/[^a-z0-9]+/g, ""));
                const canEditPhoto = viewer.owner || t.name === viewer.name;
                const myCards = board.cards.filter((cd) => (cd.members || []).includes(t.name));
                const activity = board.cards.flatMap((cd) => (cd.comments || []).filter((x) => x.by === t.name).map((x) => ({ ...x, cardName: cd.name }))).sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))).slice(0, 5);
                const row = { display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "12px 16px", fontFamily: sans, fontSize: 13.5, color: "#F2F0EC", cursor: "pointer" };
                return (
                  <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 70, width: 300, borderRadius: 2, overflow: "hidden", boxShadow: "0 14px 40px rgba(26,26,26,0.3)" }}>
                    <div style={{ position: "relative", height: 78, background: "linear-gradient(120deg, #CDBBA7, #8F8676)" }}>
                      <button onClick={() => { setProfileMember(null); setProfileActivity(false); }}
                        style={{ position: "absolute", top: 8, right: 8, width: 28, height: 28, background: "rgba(0,0,0,0.15)", border: "1.5px solid rgba(255,255,255,0.8)", borderRadius: 6, color: "#FFFFFF", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
                      <div style={{ position: "absolute", left: 16, top: 26, display: "flex", gap: 14, alignItems: "center" }}>
                        <Avatar member={t} size={68} ring="#FFFFFF" />
                        <div>
                          <div style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, color: "#FFFFFF", textShadow: "0 1px 3px rgba(0,0,0,0.15)" }}>{t.name}</div>
                          <div style={{ fontFamily: sans, fontSize: 11.5, color: "rgba(255,255,255,0.9)" }}>{handle}</div>
                        </div>
                      </div>
                    </div>
                    <div style={{ background: "#2B2A28", padding: "26px 0 8px" }}>
                      {canEditPhoto ? (
                        <label style={{ ...row, boxSizing: "border-box" }}>
                          Edit profile info
                          <span style={{ display: "block", fontFamily: sans, fontSize: 10.5, color: "rgba(242,240,236,0.55)", marginTop: 2 }}>{t.avatar ? "Change their photo" : "Upload their photo"} · {t.email || "no email on roster"}</span>
                          <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) fileToCover(f, (u) => setAvatar(t.name, u), 200, 0.8); }} />
                        </label>
                      ) : (
                        <div style={{ ...row, cursor: "default" }}>{t.email || "no email on roster"}</div>
                      )}
                      <div style={{ height: 1, background: "rgba(255,255,255,0.12)", margin: "2px 16px" }} />
                      <button onClick={() => setProfileActivity(!profileActivity)} style={row}>View member's board activity</button>
                      {profileActivity && (
                        <div style={{ padding: "0 16px 10px" }}>
                          <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(242,240,236,0.5)", margin: "4px 0 6px" }}>On {myCards.length} card{myCards.length === 1 ? "" : "s"} here</div>
                          {myCards.slice(0, 4).map((cd) => <div key={cd.id} style={{ fontFamily: sans, fontSize: 11.5, color: "#F2F0EC", padding: "2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>· {cd.name}</div>)}
                          {activity.length > 0 && <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(242,240,236,0.5)", margin: "8px 0 6px" }}>Recent activity</div>}
                          {activity.map((a, i) => (
                            <div key={i} style={{ fontFamily: sans, fontSize: 11, color: "rgba(242,240,236,0.8)", padding: "2px 0" }}>
                              {a.sys ? a.text : '"' + String(a.text).slice(0, 50) + '"'} <span style={{ color: "rgba(242,240,236,0.45)" }}>— {a.cardName ? String(a.cardName).slice(0, 26) : ""}{a.at ? " · " + new Date(a.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</span>
                            </div>
                          ))}
                          {!myCards.length && !activity.length && <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 11.5, color: "rgba(242,240,236,0.6)" }}>Nothing on this board yet.</div>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              {membersMenu && !profileMember && (
                <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 70, background: "#FFFFFF", border: `1px solid ${c.line}`, borderRadius: 8, boxShadow: "0 10px 30px rgba(26,26,26,0.14)", padding: 14, width: 270 }}>
                  <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 8 }}>Board members</div>
                  {viewer.owner && (
                    <button onClick={() => patchBoard(open, { access: null })}
                      style={{ display: "block", width: "100%", textAlign: "left", background: !board.access || !board.access.length ? c.card : "transparent", border: `1px solid ${c.line}`, borderRadius: 6, padding: "6px 9px", fontFamily: sans, fontSize: 11.5, color: c.ink, cursor: "pointer", marginBottom: 8 }}>
                      {!board.access || !board.access.length ? "✓ " : ""}Everyone with the Content tab
                    </button>
                  )}
                  {team.map((t) => {
                    const inBoard = !board.access || !board.access.length || board.access.includes(t.name);
                    const canEditPhoto = viewer.owner || t.name === viewer.name;
                    return (
                      <div key={t.id || t.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", opacity: inBoard ? 1 : 0.45 }}>
                        <button onClick={() => { setProfileMember(t.name); setProfileActivity(false); }} title="View profile"
                          style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                          <Avatar member={t} size={40} ring={c.line} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: "block", fontFamily: sans, fontSize: 13, fontWeight: 500, color: c.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                            <span style={{ display: "block", fontFamily: sans, fontSize: 10.5, color: c.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.email || (t.role || "team member")}</span>
                          </span>
                        </button>
                        {canEditPhoto && (
                          <label title="Upload their profile photo" style={{ border: `1px solid ${c.line}`, borderRadius: 6, padding: "3px 8px", fontFamily: sans, fontSize: 8.5, letterSpacing: 1, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>
                            {t.avatar ? "Photo ✓" : "+ Photo"}
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) fileToCover(f, (u) => setAvatar(t.name, u), 200, 0.8); }} />
                          </label>
                        )}
                        {viewer.owner && <input type="checkbox" title="Can open this board" checked={inBoard}
                          onChange={() => {
                            const startFrom = board.access && board.access.length ? board.access : team.map((x) => x.name);
                            const next = inBoard ? startFrom.filter((n) => n !== t.name) : [...startFrom, t.name];
                            patchBoard(open, { access: next.length >= team.length ? null : next });
                          }} />}
                      </div>
                    );
                  })}
                  {!team.length && <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 11, color: c.sub }}>Add people on the Team roster first.</div>}
                  {viewer.owner && <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 10, color: c.sub, marginTop: 8 }}>Untick someone and the board disappears for them. Photos show wherever members appear.</div>}
                </div>
              )}
              <button onClick={() => runLinkAssets(open)} disabled={!!linking} style={{ ...ghost, opacity: linking ? 0.5 : 1 }} title="Match every Post N card to its numbered reel/carousel in Drive">{linking || "Link assets"}</button>
              {viewer.owner && <button onClick={() => runSyncCovers(open)} disabled={!!linking} style={{ ...ghost, opacity: linking ? 0.5 : 1 }} title="Pull numbered covers from this brand's Cover Photos ▸ Month folder onto each Post N card">{linking || "⟳ Sync covers"}</button>}
              <button onClick={() => setLookbook(true)} style={ghost} title="Swipe through this board's looks by launch month">◫ Lookbook</button>
              <button onClick={() => setBgMenu(!bgMenu)} style={ghost} title="Change the board background">▦ Background</button>
              <button onClick={() => {
                const existing = board.lists.find((l) => /^planned\s*1\s*[-–]\s*21$/i.test((l.name || "").trim()));
                const already = existing ? board.cards.filter((cd) => cd.listId === existing.id).length : 0;
                if (already && !window.confirm(`"Planned 1-21" already has ${already} card${already === 1 ? "" : "s"}. Add another 21 below them?`)) return;
                const listId = existing ? existing.id : uid();
                const lists = existing ? board.lists : [...board.lists, { id: listId, name: "Planned 1-21" }];
                // The beauty/fashion + face-to-camera cadence is the Lavalle
                // Sisters recipe. Other boards get a plain numbered cycle rather
                // than inheriting a rhythm that was never meant for them.
                const sisters = open === "lavalle-sisters";
                const made = sisters
                  ? buildPlannedCycle().map((p) => ({
                      id: uid(), listId, name: p.title,
                      labels: [p.niche],                    // rename or recolour like any label
                      members: p.member ? [p.member] : [],
                      desc: "", done: false, comments: [],
                    }))
                  : Array.from({ length: 21 }, (_, i) => ({
                      id: uid(), listId, name: `Post ${i + 1}`,
                      labels: [], members: [], desc: "", done: false, comments: [],
                    }));
                patchBoard(open, { lists, cards: [...board.cards, ...made] });
              }} style={ghost} title="Create the next 21 planned posts — niche paired by day, formats balanced">✦ Plan next 21</button>
              <button onClick={() => { const name = prompt("New list name"); if (name && name.trim()) patchBoard(open, { lists: [...board.lists, { id: uid(), name: name.trim() }] }); }}
                style={ghost}>+ List</button>
              {bgMenu && (
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60, background: "#FFFFFF", border: `1px solid ${c.line}`, borderRadius: 8, boxShadow: "0 10px 30px rgba(26,26,26,0.14)", padding: 12, width: 230 }}>
                  <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 8 }}>Board background</div>
                  <label style={{ display: "block", textAlign: "center", border: `1px solid ${c.line}`, borderRadius: 6, padding: "8px 0", fontFamily: sans, fontSize: 9.5, letterSpacing: 2, textTransform: "uppercase", color: c.ink, cursor: "pointer", marginBottom: 8 }}>
                    ⇪ Upload photo
                    <input type="file" accept="image/*" style={{ display: "none" }}
                      onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) fileToCover(f, (dataUrl) => { patchBoard(open, { bg: dataUrl }); setBgMenu(false); }, 1600, 0.7); }} />
                  </label>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {BG_PRESETS.map((p) => (
                      <button key={p.id} title={p.id} onClick={() => { patchBoard(open, { bg: p.css }); setBgMenu(false); }}
                        style={{ flex: 1, height: 34, borderRadius: 6, border: board.bg === p.css ? `2px solid ${c.ink}` : `1px solid ${c.line}`, background: p.css, cursor: "pointer" }} />
                    ))}
                  </div>
                  {board.bg && <button onClick={() => { patchBoard(open, { bg: null }); setBgMenu(false); }}
                    style={{ width: "100%", background: "transparent", border: `1px solid ${c.line}`, borderRadius: 6, padding: "7px 0", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.red, cursor: "pointer" }}>Remove background</button>}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, overflowX: "auto", alignItems: "flex-start", paddingBottom: 16, scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}>
            {board.lists.map((l) => {
              let cards = board.cards.filter((x) => x.listId === l.id);
              if (touchDrag && previewAt) {
                const dragged = board.cards.find((x) => x.id === touchDrag);
                cards = cards.filter((x) => x.id !== touchDrag);
                if (dragged && previewAt.listId === l.id) {
                  let at = previewAt.anchorId ? cards.findIndex((x) => x.id === previewAt.anchorId) : cards.length;
                  if (at < 0) at = cards.length; else if (previewAt.after) at += 1;
                  cards = [...cards.slice(0, at), dragged, ...cards.slice(at)];
                }
              }
              return (
                <div key={l.id} data-dragcol={l.id}
                  onDragOver={(e) => { if (dragCard) { e.preventDefault(); setDropHint("list:" + l.id); } else if (dragList && dragList !== l.id) { e.preventDefault(); setDropHint("listmove:" + l.id); } }}
                  onDrop={(e) => { if (dragCard) { e.preventDefault(); moveCard(dragCard, l.id, null); } else if (dragList && dragList !== l.id) { e.preventDefault(); moveList(dragList, l.id); } setDragCard(null); setDragList(null); setDropHint(null); }}
                  style={{ flex: "0 0 min(82vw, 276px)", scrollSnapAlign: "start", background: "rgba(250,249,247,0.94)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", border: `1px solid ${c.line}`, borderRadius: 2, padding: "12px 10px 10px", opacity: (dragList === l.id || touchDragList === l.id) ? 0.45 : 1, outline: dropHint === "list:" + l.id ? "2px solid #A39B8B" : "none", outlineOffset: -2, boxShadow: dropHint === "listmove:" + l.id ? "inset 3px 0 0 #A39B8B" : "none" }}>
                  <div
                    draggable
                    onDragStart={(e) => { e.stopPropagation(); setDragList(l.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { setDragList(null); setDropHint(null); }}
                    onTouchStart={(e) => {
                      const t0 = e.touches[0];
                      touchStartPos.current = { x: t0.clientX, y: t0.clientY };
                      clearTimeout(touchTimer.current);
                      touchTimer.current = setTimeout(() => {
                        setTouchDragList(l.id); setDragList(l.id); setTouchPos({ x: t0.clientX, y: t0.clientY });
                        if (navigator.vibrate) navigator.vibrate(30);
                      }, 400);
                    }}
                    onTouchMove={(e) => {
                      if (touchDragList) return;
                      const t0 = e.touches[0]; const s = touchStartPos.current;
                      if (s && Math.hypot(t0.clientX - s.x, t0.clientY - s.y) > 8) clearTimeout(touchTimer.current);
                    }}
                    onTouchEnd={() => { if (!touchDragList) clearTimeout(touchTimer.current); }}
                    title="Drag to reorder this list"
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 6px 8px", position: "relative", cursor: "grab", WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}>
                    <div style={{ flex: 1, fontFamily: sans, fontSize: 12.5, fontWeight: 500, color: c.ink }}>
                      {l.name} <span style={{ color: c.sub, fontSize: 11 }}>{cards.length}</span>
                    </div>
                    <button onClick={() => setListMenu(listMenu === l.id ? null : l.id)} title="List actions" style={{ background: "none", border: "none", cursor: "pointer", color: c.sub, fontSize: 14, padding: "0 4px", lineHeight: 1 }}>⋯</button>
                    {listMenu === l.id && (
                      <div style={{ position: "absolute", top: "calc(100% + 2px)", right: 0, zIndex: 60, background: "#FFFFFF", border: `1px solid ${c.line}`, borderRadius: 8, boxShadow: "0 10px 30px rgba(26,26,26,0.18)", padding: 6, width: 190 }}>
                        <button onClick={() => { setListMenu(null); renameList(l); }} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderRadius: 6, padding: "7px 10px", fontFamily: sans, fontSize: 12, color: c.ink, cursor: "pointer" }}>Rename list</button>
                        <div style={{ borderTop: `1px solid ${c.line}`, margin: "4px 6px", paddingTop: 4 }}>
                          <div style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1.5, textTransform: "uppercase", color: c.taupe, padding: "2px 4px 4px" }}>Move list to board</div>
                          {Object.entries(boards).filter(([k, b2]) => !k.startsWith("_") && b2 && b2.lists && k !== open && canSee(b2)).map(([k, b2]) => (
                            <button key={k} onClick={() => { setListMenu(null); if (confirm('Move "' + l.name + '" and its ' + cards.length + ' cards to "' + b2.name + '"?')) moveListToBoard(l.id, k); }}
                              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderRadius: 6, padding: "6px 10px", fontFamily: sans, fontSize: 11.5, color: c.ink, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>→ {b2.name}</button>
                          ))}
                        </div>
                        <button onClick={() => { setListMenu(null); deleteList(l); }} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderRadius: 6, padding: "7px 10px", fontFamily: sans, fontSize: 12, color: c.red, cursor: "pointer", borderTop: `1px solid ${c.line}` }}>Delete list</button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "calc(100vh - 285px)", overflowY: "auto" }}>
                    {cards.map((card) => (
                      <div key={card.id} data-dragcard={card.id} data-draglist={l.id}
                        onClick={() => { if (Date.now() - suppressClick.current < 500) return; setEditCard({ boardKey: open, cardId: card.id }); }}
                        draggable
                        onDragStart={(e) => { setDragCard(card.id); e.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => { setDragCard(null); setDropHint(null); }}
                        onDragOver={(e) => { if (dragCard && dragCard !== card.id) { e.preventDefault(); e.stopPropagation(); setDropHint(card.id); } }}
                        onDrop={(e) => { if (dragCard && dragCard !== card.id) { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); moveCard(dragCard, l.id, card.id, e.clientY > r.top + r.height / 2); } setDragCard(null); setDropHint(null); }}
                        onTouchStart={(e) => {
                          const t = e.touches[0];
                          touchStartPos.current = { x: t.clientX, y: t.clientY };
                          clearTimeout(touchTimer.current);
                          touchTimer.current = setTimeout(() => {
                            setTouchDrag(card.id); setDragCard(card.id); setTouchPos({ x: t.clientX, y: t.clientY });
                            if (navigator.vibrate) navigator.vibrate(30);
                          }, 300);
                        }}
                        onTouchMove={(e) => {
                          if (touchDrag) return;
                          const t = e.touches[0]; const s = touchStartPos.current;
                          if (s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > 8) clearTimeout(touchTimer.current);
                        }}
                        onTouchEnd={() => { if (!touchDrag) clearTimeout(touchTimer.current); }}
                        style={{ flexShrink: 0, background: c.bg, border: `1px solid ${c.line}`, borderRadius: 8, cursor: "pointer", opacity: (dragCard === card.id || touchDrag === card.id) ? 0.4 : card.done ? 0.62 : 1, overflow: "hidden", boxShadow: "0 1px 2px rgba(26,26,26,0.06)", outline: dropHint === card.id ? "2px solid #A39B8B" : "none", outlineOffset: 2, WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}>
                        {card.cover && <img src={card.cover} alt="" style={{ display: "block", width: "100%", height: "auto" }} />}
                        <div style={{ padding: "9px 11px" }}>
                          {(card.labels || []).length > 0 && (
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 7 }}>
                              {(card.labels || []).slice(0, 6).map((lb, i) => { const L = normLabel(lb); return (
                                <span key={i} style={{ fontFamily: sans, fontSize: 9.5, fontWeight: 500, letterSpacing: 0.5, color: labelText(L.c), background: L.c, borderRadius: 4, padding: "3px 8px" }}>{L.n}</span>
                              ); })}
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleDone(open, card.id); }}
                              title={card.done ? "Mark not done" : "Mark done — posted"}
                              style={{ flexShrink: 0, width: 16, height: 16, borderRadius: "50%", border: `1.5px solid ${(card.done || (card.pub && card.pub.status === "published")) ? c.green : c.line}`, background: (card.done || (card.pub && card.pub.status === "published")) ? c.green : "transparent", color: c.bg, fontSize: 10, lineHeight: 1, cursor: "pointer", padding: 0, marginTop: 1 }}>
                              {(card.done || (card.pub && card.pub.status === "published")) ? "✓" : ""}
                            </button>
                            <div style={{ flex: 1, fontFamily: sans, fontSize: 12.5, lineHeight: 1.45, color: c.ink, textDecoration: (card.done || (card.pub && card.pub.status === "published")) ? "line-through" : "none" }}>{card.name}</div>
                          </div>
                          {((card.labels && card.labels.length > 0) || card.due || (card.members && card.members.length > 0) || (card.comments && card.comments.filter((x) => !x.sys).length > 0) || card.assetUrl || card.exampleUrl || firstVideoUrl(card.desc) || (card.checklist && card.checklist.length > 0)) && (
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 6, paddingLeft: 24 }}>
                              {card.due && (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: sans, fontSize: 9.5, background: card.done ? "#DFE8DF" : new Date(card.due) < new Date() ? "#F3E3E0" : "#EEECE6", color: card.done ? c.green : new Date(card.due) < new Date() ? c.red : c.ink, borderRadius: 4, padding: "2px 7px" }}>
                                  {card.done ? "✓" : "◦"} {new Date(card.due).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                </span>
                              )}
                              {(card.hook || card.desc) && <span title="Has hook/caption" style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>≡</span>}
                              {(card.checklist || []).length > 0 && (
                                <span title="Checklist" style={{ fontFamily: sans, fontSize: 9, color: (card.checklist || []).every((x) => x.done) ? "#FFFFFF" : c.sub, background: (card.checklist || []).every((x) => x.done) ? c.green : "transparent", border: (card.checklist || []).every((x) => x.done) ? "none" : `1px solid ${c.line}`, borderRadius: 4, padding: "1px 6px" }}>
                                  ✓ {(card.checklist || []).filter((x) => x.done).length}/{(card.checklist || []).length}
                                </span>
                              )}
                              {(card.exampleUrl || firstVideoUrl(card.desc)) && (
                                <a href={card.exampleUrl || firstVideoUrl(card.desc)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Example video"
                                  style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1, textTransform: "uppercase", color: c.taupe, border: `1px solid ${c.line}`, borderRadius: 6, padding: "2px 7px", textDecoration: "none", background: c.bg }}>▷ Example</a>
                              )}
                              {card.assetUrl && (
                                <a href={card.assetUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Open this post's asset in Drive"
                                  style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1, textTransform: "uppercase", color: c.taupe, border: `1px solid ${c.line}`, borderRadius: 6, padding: "2px 7px", textDecoration: "none", background: c.bg }}>▸ Asset</a>
                              )}
                              {card.pub && card.pub.status === "scheduled" && card.pub.auto && card.pub.at && (
                                <span title={"Auto-publishes to " + (card.pub.platform || "Instagram") + " @" + card.pub.account + " · " + new Date(card.pub.at).toLocaleString()}
                                  style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 0.8, color: "#FFFFFF", background: c.green, borderRadius: 6, padding: "2px 7px" }}>
                                  ⏱ {card.pub.platform === "tiktok" ? "TikTok" : "IG"} @{card.pub.account} · {new Date(card.pub.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} {new Date(card.pub.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                </span>
                              )}
                              {card.pub && card.pub.status === "published" && (
                                <span title={"Posted to " + (card.pub.platform || "Instagram") + " @" + card.pub.account + " · " + new Date(card.pub.publishedAt).toLocaleString()}
                                  style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 0.8, color: c.green, border: `1px solid ${c.green}`, borderRadius: 6, padding: "2px 7px" }}>
                                  ✓ {card.pub.platform === "tiktok" ? "TikTok" : "IG"} @{card.pub.account}
                                </span>
                              )}
                              {card.pub && card.pub.status === "failed" && <span title={card.pub.error} style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1, color: c.red }}>✗ publish failed</span>}
                              {(card.comments || []).filter((x) => !x.sys).length > 0 && <span style={{ fontFamily: sans, fontSize: 9, color: c.sub }}>✎ {(card.comments || []).filter((x) => !x.sys).length}</span>}
                              {(card.links || []).length > 0 && <span style={{ fontFamily: sans, fontSize: 9, color: c.sub }}>↗ {(card.links || []).length}</span>}
                              {(card.attachments || []).length > 0 && <span title={(card.attachments || []).length + " photos"} style={{ fontFamily: sans, fontSize: 9, color: c.sub }}>⊞ {(card.attachments || []).length}</span>}
                              {(card.members || []).map((m, i) => (
                                <span key={"m" + i} style={{ display: "inline-flex" }}><Avatar member={teamByName[m] || { name: m }} size={20} ring="#FFFFFF" /></span>
                              ))}
                            </div>
                          )}
                          {card.pub && (card.pub.status === "converting" || card.pub.status === "processing") && (
                            <div style={{ marginTop: 8, paddingLeft: 24 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: sans, fontSize: 8.5, letterSpacing: 0.8, textTransform: "uppercase", color: c.taupe, marginBottom: 3 }}>
                                <span><span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: c.taupe, marginRight: 5, animation: "lhpulse 1.1s ease-in-out infinite" }} />{card.pub.status === "converting" ? "Converting video…" : "Posting to Instagram…"}</span>
                                <span>{card.pub.status === "converting" ? "Step 1 of 2" : "Step 2 of 2"}</span>
                              </div>
                              <div style={{ height: 4, background: "#EEECE6", borderRadius: 3, overflow: "hidden", position: "relative" }}>
                                <div style={{ height: "100%", width: card.pub.status === "converting" ? "45%" : "85%", background: c.taupe, borderRadius: 3, transition: "width .5s ease" }} />
                                <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: "30%", background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent)", animation: "lhslide 1.4s linear infinite" }} />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setEditCard({ boardKey: open, listId: l.id, isNew: true })}
                    style={{ width: "100%", marginTop: 6, textAlign: "left", background: "transparent", border: "none", borderRadius: 8, color: c.sub, fontFamily: sans, fontSize: 12.5, padding: "7px 8px", cursor: "pointer" }}>+ Add a card</button>
                </div>
              );
            })}
            {dragList && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDropHint("listmove:end"); }}
                onDrop={(e) => { e.preventDefault(); moveList(dragList, null); setDragList(null); setDropHint(null); }}
                style={{ flex: "0 0 90px", alignSelf: "stretch", minHeight: 120, border: `2px dashed ${dropHint === "listmove:end" ? "#A39B8B" : c.line}`, borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub }}>
                End
              </div>
            )}
          </div>
          {touchDragList && touchPos && (() => {
            const l0 = board.lists.find((x) => x.id === touchDragList);
            return l0 ? (
              <div style={{ position: "fixed", left: touchPos.x - 60, top: touchPos.y - 46, zIndex: 400, pointerEvents: "none", background: "rgba(250,249,247,0.97)", border: `1px solid ${c.line}`, borderRadius: 2, boxShadow: "0 14px 34px rgba(0,0,0,0.3)", padding: "10px 16px", transform: "rotate(2deg)", fontFamily: sans, fontSize: 12, fontWeight: 500, color: c.ink, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ⣿ {l0.name}
              </div>
            ) : null;
          })()}
          {touchDrag && touchPos && (() => {
            const cd = board.cards.find((x) => x.id === touchDrag);
            return cd ? (
              <div style={{ position: "fixed", left: touchPos.x - 70, top: touchPos.y - 60, zIndex: 400, pointerEvents: "none", width: 140, background: "#FFFFFF", border: `1px solid ${c.line}`, borderRadius: 8, boxShadow: "0 14px 34px rgba(0,0,0,0.3)", overflow: "hidden", transform: "rotate(3deg)" }}>
                {cd.cover && <img src={cd.cover} alt="" style={{ display: "block", width: "100%", height: 54, objectFit: "cover" }} />}
                <div style={{ padding: "7px 10px", fontFamily: sans, fontSize: 10.5, color: c.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cd.name}</div>
              </div>
            ) : null;
          })()}
          {narrow && (
            <div style={{ position: "fixed", bottom: 14, left: "50%", transform: "translateX(-50%)", zIndex: 90, display: "flex", gap: 8, alignItems: "center", background: "rgba(29,32,34,0.95)", borderRadius: 2, padding: "8px 14px", boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
              <button onClick={() => setOpen(null)} style={{ background: "none", border: "none", color: "#E8E6E1", fontFamily: sans, fontSize: 12, cursor: "pointer", padding: 0 }}>☰ Boards</button>
              <select value={open} onChange={(e) => openBoard(e.target.value)} title="Switch boards"
                style={{ background: "transparent", color: "#E8E6E1", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 14, fontFamily: sans, fontSize: 12, padding: "3px 8px", maxWidth: 160 }}>
                {Object.keys(boards).filter((k) => !k.startsWith("_") && boards[k] && boards[k].lists && canSee(boards[k])).map((k) => <option key={k} value={k} style={{ color: "#1A1A1A" }}>{boards[k].name}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {editing && (
        <CardSheet
          key={editCard.cardId || "new"}
          card={editing}
          boardKey={editCard.boardKey}
          boardsIndex={boardsIndex}
          isNew={!!editCard.isNew}
          memberPool={memberPool}
          me={me}
          autoTag={(() => {
            const bd = boards[editCard.boardKey];
            const active = !!(bd && bd.ws === "pr-ugc");
            const list = ((bd && bd.lists) || []).find((l) => l.id === (editing.listId || editCard.listId));
            const label = ((bd && /ugc/i.test(bd.name)) || (list && /ugc/i.test(list.name))) ? "UGC" : "PR";
            const nums = ((bd && bd.cards) || []).map((cd) => { const m = (cd.name || "").match(new RegExp("^" + label + "\\s+(\\d+)")); return m ? parseInt(m[1]) : 0; });
            return { active, label, nextNum: (nums.length ? Math.max(0, ...nums) : 0) + 1 };
          })()}
          onClose={() => setEditCard(null)}
          onSave={saveCard}
          onPatch={patchCard}
          onDuplicate={editCard.isNew ? null : () => { duplicateCard(editCard.boardKey, editCard.cardId); setEditCard(null); }}
          onDelete={editCard.isNew ? null : deleteCard}
          onComment={(text) => addComment(editCard.boardKey, editCard.cardId, text)}
        />
      )}
      {lookbook && board && <LookbookView board={board} shoots={shoots} onClose={() => setLookbook(false)} />}
    </div>
  );
}

// Monthly lookbook — a full-screen, swipeable gallery of a board's looks grouped
// by each card's launch month (falls back to grouping by list if none are set).
// Shows the shoot date for the month when a matching calendar event exists.
function LookbookView({ board, shoots, onClose }) {
  const monthKey = (c) => c.launchMonth || null;
  const cards = (board.cards || []).filter((c) => c.cover);
  const byMonth = {};
  cards.forEach((c) => { const k = monthKey(c); if (k) (byMonth[k] = byMonth[k] || []).push(c); });
  let groups;
  if (Object.keys(byMonth).length) {
    groups = Object.keys(byMonth).sort().map((k) => ({ key: k, label: monthLabel(k), cards: byMonth[k] }));
  } else {
    // No launch months set yet — group by list so the view is useful immediately.
    groups = (board.lists || []).map((l) => ({ key: l.id, label: l.name, cards: cards.filter((c) => c.listId === l.id) })).filter((g) => g.cards.length);
  }
  const [gi, setGi] = useState(0);
  const [si, setSi] = useState(0);
  const g = groups[gi] || { label: "—", cards: [] };
  const shot = (shoots || []).find((s) => s.month === g.key);
  const touchX = useRef(null);
  const go = (d) => { const n = g.cards.length; if (!n) return; setSi((p) => (p + d + n) % n); };
  useEffect(() => { setSi(0); }, [gi]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); else if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line
  const card = g.cards[si];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "#141310", display: "flex", flexDirection: "column" }}>
      {/* top bar: month tabs + close */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase", color: "#EDE9E2" }}>{board.name} · Lookbook</div>
        <div style={{ flex: 1, display: "flex", gap: 6, overflowX: "auto", justifyContent: "center", WebkitOverflowScrolling: "touch" }}>
          {groups.map((gg, i) => (
            <button key={gg.key} onClick={() => setGi(i)} style={{ flexShrink: 0, background: i === gi ? "#EDE9E2" : "transparent", color: i === gi ? "#1a1a1a" : "rgba(237,233,226,0.6)", border: `1px solid ${i === gi ? "#EDE9E2" : "rgba(237,233,226,0.25)"}`, borderRadius: 2, padding: "5px 14px", fontFamily: sans, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap" }}>{gg.label}</button>
          ))}
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "1px solid rgba(237,233,226,0.4)", borderRadius: 6, color: "#EDE9E2", width: 32, height: 32, fontSize: 16, cursor: "pointer" }}>×</button>
      </div>
      {/* shoot-date banner */}
      <div style={{ textAlign: "center", padding: "8px 16px", fontFamily: sans, fontSize: 11, letterSpacing: 1, color: shot ? "#CDBBA7" : "rgba(237,233,226,0.4)" }}>
        {shot ? "Shoot with Sacia · " + shot.label : "Shoot date — connect your calendar to show it here"}
      </div>
      {/* swipeable stage */}
      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { if (touchX.current == null) return; const dx = e.changedTouches[0].clientX - touchX.current; if (Math.abs(dx) > 45) go(dx < 0 ? 1 : -1); touchX.current = null; }}>
        {card ? (
          <>
            {g.cards.length > 1 && <button onClick={() => go(-1)} style={arrowBtn("left")}>‹</button>}
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "6px 16px 16px" }}>
              <img src={card.cover} alt={card.name} style={{ maxHeight: "calc(100vh - 210px)", maxWidth: "min(560px, 92vw)", objectFit: "contain", borderRadius: 3, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }} />
              <div style={{ marginTop: 12, fontFamily: sans, fontSize: 13, letterSpacing: 1, color: "#EDE9E2" }}>{card.name}</div>
            </div>
            {g.cards.length > 1 && <button onClick={() => go(1)} style={arrowBtn("right")}>›</button>}
          </>
        ) : (
          <div style={{ fontFamily: sans, fontSize: 12, color: "rgba(237,233,226,0.5)", textAlign: "center", padding: 30 }}>No looks with a cover image in this {Object.keys(byMonth).length ? "month" : "list"} yet.</div>
        )}
      </div>
      {/* dots */}
      {g.cards.length > 1 && (
        <div style={{ display: "flex", gap: 6, justifyContent: "center", padding: "10px 0 18px" }}>
          {g.cards.map((_, i) => <div key={i} onClick={() => setSi(i)} style={{ width: i === si ? 20 : 7, height: 7, borderRadius: 4, background: i === si ? "#CDBBA7" : "rgba(237,233,226,0.3)", cursor: "pointer", transition: "width .2s" }} />)}
        </div>
      )}
    </div>
  );
}
const arrowBtn = (side) => ({ position: "absolute", [side]: 10, top: "50%", transform: "translateY(-50%)", zIndex: 2, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(237,233,226,0.3)", color: "#EDE9E2", width: 44, height: 44, borderRadius: "50%", fontSize: 22, cursor: "pointer", lineHeight: 1 });
const monthLabel = (k) => { const m = /^(\d{4})-(\d{2})$/.exec(k); if (!m) return k; return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); };

function CardSheet({ card, boardKey, boardsIndex, isNew, memberPool, me, autoTag, onClose, onSave, onPatch, onDelete, onComment, onDuplicate }) {
  const [name, setName] = useState(card.name);
  const [hook, setHook] = useState(card.hook || "");
  const [tags, setTags] = useState(card.tags || "");
  const [draft, setDraft] = useState(card.draft || {});
  const [draftNotes, setDraftNotes] = useState(card.draftNotes || {});
  const [showPoint3, setShowPoint3] = useState(!!(card.draft && card.draft.point3));
  const [showResolved, setShowResolved] = useState(false);
  const [noteOn, setNoteOn] = useState(null);
  const [noteText, setNoteText] = useState("");
  const draftBeats = [
    { key: "intro", label: "Intro", hint: "How it opens — the first 2 seconds" },
    { key: "point1", label: "Main point 1", hint: "" },
    { key: "point2", label: "Main point 2", hint: "" },
    ...(showPoint3 || draft.point3 ? [{ key: "point3", label: "Main point 3", hint: "" }] : []),
    { key: "close", label: "Close", hint: "How it lands — CTA or last line" },
  ];
  const addDraftNote = (beatKey) => {
    const t = noteText.trim();
    if (!t) return;
    const n = { id: uid(), text: t, by: (typeof me === "string" && me.trim()) || "Me", at: new Date().toISOString(), resolved: false };
    setDraftNotes({ ...draftNotes, [beatKey]: [...(draftNotes[beatKey] || []), n] });
    setNoteText(""); setNoteOn(null);
  };
  const [desc, setDesc] = useState(card.desc || "");
  const [exampleUrl, setExampleUrl] = useState(card.exampleUrl || firstVideoUrl(card.desc) || "");
  // PR/UGC auto-title: on a PR + UGC board, resolve the creator @handle from the
  // linked TikTok/IG video and title the card "PR N [@handle]" (or "UGC N […]").
  // Only fills blank or already-auto titles, so a custom name is never clobbered.
  useEffect(() => {
    if (!autoTag || !autoTag.active) return;
    const url = (exampleUrl || "").trim();
    if (!/tiktok\.com|instagram\.com/i.test(url)) return;
    const cur = (name || "").trim();
    const isAuto = !cur || /^new card$/i.test(cur) || /^(PR|UGC)\s+\d+/i.test(cur) || /^(PR|UGC) example/i.test(cur);
    if (!isAuto) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/data?op=resolve_handle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
        const d = await r.json();
        if (cancelled || !d.handle) return;
        const existing = (cur.match(/^(?:PR|UGC)\s+(\d+)/i) || [])[1];
        setName(`${autoTag.label} ${existing || autoTag.nextNum} [${d.handle}]`);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [exampleUrl, autoTag && autoTag.active]); // eslint-disable-line
  const [checklist, setChecklist] = useState(card.checklist || []);
  const [checkInput, setCheckInput] = useState("");
  const [pub, setPub] = useState(card.pub || null);
  const [pubAccounts, setPubAccounts] = useState(null); // connected IG accounts (owner only — 403 hides the section)
  // UGC outreach card state
  const [outreachEmail, setOutreachEmail] = useState(card.outreachEmail || "");
  const [emailBody, setEmailBody] = useState(card.emailBody || UGC_EMAIL_BODY);
  const [refExamples, setRefExamples] = useState(() => { const r = card.refExamples || []; return [r[0] || "", r[1] || "", r[2] || ""]; });
  const [dmCopied, setDmCopied] = useState(false);
  const [emailState, setEmailState] = useState("");
  const isOutreach = !!(autoTag && autoTag.active && autoTag.label === "UGC"); // UGC → full DM/email/PDF automation
  const isPrUgc = !!(autoTag && autoTag.active); // PR or UGC → the "3 videos we loved" suggestions only
  const brandAcct = igForBoardName((boardsIndex[boardKey] || {}).name); // locked IG handle for this board's brand
  const [postingNow, setPostingNow] = useState(false);
  const [plannCopied, setPlannCopied] = useState(false);
  // Where this post goes — Instagram (our auto-poster) and/or TikTok (handed to
  // Plann). Independent, so a post can be IG-only, TikTok-only, or both.
  const [dest, setDest] = useState(card.dest || { ig: true, tiktok: false });
  // Live elapsed timer while a reel is converting/processing, so it's obvious the
  // post is still working (not frozen) even for a 2-minute video.
  const [elapsed, setElapsed] = useState(0);
  const postStartRef = useRef(null);
  useEffect(() => {
    const inflight = pub && (pub.status === "converting" || pub.status === "processing");
    if (!inflight) { postStartRef.current = null; setElapsed(0); return; }
    if (!postStartRef.current) postStartRef.current = Date.now();
    setElapsed(Math.floor((Date.now() - postStartRef.current) / 1000));
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - postStartRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [pub && pub.status]); // eslint-disable-line
  const mmss = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  useEffect(() => { fetch("/api/data?op=instagram_status").then((r) => (r.ok ? r.json() : null)).then((d) => d && setPubAccounts(d.accounts || [])).catch(() => {}); }, []);
  const dtLocal = (iso) => { if (!iso) return ""; const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()); };
  const [due, setDue] = useState(card.due ? card.due.slice(0, 10) : "");
  const [launchMonth, setLaunchMonth] = useState(card.launchMonth || ""); // "YYYY-MM" — groups looks in the Lookbook view
  const [labels, setLabels] = useState((card.labels || []).map(normLabel));
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState(LABEL_PALETTE[2].c);
  const [destBoard, setDestBoard] = useState(boardKey);
  const [listId, setListId] = useState(card.listId);
  const [members, setMembers] = useState(card.members || []);
  const [memberInput, setMemberInput] = useState("");
  const [cover, setCover] = useState(card.cover || null);
  const [done, setDone] = useState(!!card.done);
  const [commentText, setCommentText] = useState("");
  const [links, setLinks] = useState(card.links || []);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  // Two Drive-asset buttons — cover photo + reel/carousel — each editable inline.
  const coverLinkOf = (cd) => cd.coverUrl || ((cd.links || []).find((l) => /cover/i.test(l.n)) || {}).u || "";
  const [coverUrl, setCoverUrl] = useState(coverLinkOf(card));
  const [assetUrlState, setAssetUrlState] = useState(card.assetUrl || "");
  const [editCover, setEditCover] = useState(false);
  const [editAsset, setEditAsset] = useState(false);
  const [attachments, setAttachments] = useState(card.attachments || []);
  const input = { width: "100%", boxSizing: "border-box", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "9px 12px", fontFamily: sans, fontSize: 13, color: c.ink, outline: "none" };
  const label = { fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, margin: "14px 0 4px" };
  // Set the cover AND persist it right away for existing cards, so the change
  // sticks even if the sheet is dismissed by tapping outside instead of Save.
  const applyCover = (val) => { setCover(val); if (!isNew && onPatch) onPatch({ cover: val || null }); };
  const addMember = (m) => { const v = (m || "").trim(); if (!v || members.includes(v)) return; setMembers([...members, v]); setMemberInput(""); };
  const addLabel = () => { const n = labelName.trim(); if (!n) return; setLabels([...labels, { n, c: labelColor }]); setLabelName(""); };
  const destLists = (boardsIndex[destBoard] || {}).lists || [];
  const comments = (card.comments || []);
  // Auto-save: persist an existing card ~0.6s after the last edit, so nobody has
  // to press Save. Skips the first render and new (unsaved) cards.
  const autoSkip = useRef(true);
  useEffect(() => {
    if (isNew || !onPatch) return;
    if (autoSkip.current) { autoSkip.current = false; return; }
    const t = setTimeout(() => {
      if (!name.trim()) return;
      const patch = { name: name.trim(), hook: hook.trim() || null, tags: tags.trim() || null, draft: Object.keys(draft).length ? draft : null, draftNotes: Object.keys(draftNotes).length ? draftNotes : null, desc, exampleUrl: exampleUrl.trim() || null, coverUrl: coverUrl.trim() || null, assetUrl: assetUrlState.trim() || null, due: due ? due + "T12:00:00.000Z" : null, launchMonth: launchMonth || null, labels, members, cover, links, checklist, attachments, outreachEmail: outreachEmail.trim() || null, emailBody: emailBody === UGC_EMAIL_BODY ? null : emailBody, refExamples: refExamples.map((s) => s.trim()).filter(Boolean).length ? refExamples.map((s) => s.trim()).filter(Boolean) : null, dest };
      // A reel mid-flight (converting/processing) is owned by the server — its pub
      // advances faster than the board's local copy, so saving the whole board here
      // would clobber it back to "scheduled," kill the progress bar, and stall the
      // post. Skip auto-save entirely while in-flight.
      if (pub && (pub.status === "converting" || pub.status === "processing")) return;
      const serverOwned = pub && pub.status === "published";
      if (!serverOwned) { patch.pub = pub || null; patch.done = done; }
      onPatch(patch);
    }, 600);
    return () => clearTimeout(t);
  }, [name, hook, tags, draft, draftNotes, attachments, desc, exampleUrl, coverUrl, assetUrlState, due, launchMonth, labels, members, cover, done, links, checklist, pub, outreachEmail, emailBody, refExamples, dest]);
  // While a post is converting/processing, poll the server so the OPEN card
  // reflects progress and flips to Posted (green check) on its own.
  useEffect(() => {
    if (isNew || !pub || (pub.status !== "converting" && pub.status !== "processing")) return;
    const t = setInterval(async () => {
      try {
        const fresh = await (await fetch("/api/data", { cache: "no-store" })).json();
        const cc = (((fresh.boards || {})[boardKey] || {}).cards || []).find((x) => x.id === card.id);
        if (cc && cc.pub) { setPub(cc.pub); if (cc.pub.status === "published") { setDone(true); onPatch && onPatch({ done: true, pub: cc.pub }); } }
      } catch {}
    }, 12000);
    return () => clearInterval(t);
  }, [pub && pub.status, isNew]);
  // Publish now (or resume a Reel that's still processing) — keeps the IG
  // container id so a slow video finishes on the next tap without re-uploading.
  const runPost = async (confirm) => {
    const account = brandAcct || (pub && pub.account) || (pubAccounts && pubAccounts[0] && pubAccounts[0].username);
    if (!account) return;
    if (confirm && !window.confirm('Post "' + name + '" to @' + account + " on Instagram right now?\n\n" + (isReelCard(card.name) ? "Uploads the linked Reel video (auto-converts to H.264 first) + caption — a large video can take a minute or two." : "Posts the last saved cover + caption (the on-screen hook and TikTok hashtags stay off Instagram)."))) return;
    setPostingNow(true);
    try {
      const r = await fetch("/api/data?op=publish_item", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boardKey, cardId: card.id, account }) });
      const d = await r.json();
      const item = (d.items || [])[0];
      // Re-read the pub the server just saved — it holds the convert/container ids
      // that a partial local update would otherwise wipe via auto-save.
      let sp = null;
      try { const fresh = await (await fetch("/api/data", { cache: "no-store" })).json(); const cc = (((fresh.boards || {})[boardKey] || {}).cards || []).find((x) => x.id === card.id); sp = cc && cc.pub; } catch {}
      if (sp) { setPub(sp); if (sp.status === "published") { setDone(true); onPatch && onPatch({ done: true, pub: sp }); } }
      else if (item && item.ok) { const np = { ...(pub || {}), account, status: "published", mediaId: item.mediaId, publishedAt: item.publishedAt }; setPub(np); setDone(true); onPatch && onPatch({ done: true, pub: np }); }
      else if (item && item.converting) { setPub({ ...(pub || {}), account, status: "converting" }); }
      else if (item && item.processing) { setPub({ ...(pub || {}), account, status: "processing" }); }
      else setPub({ ...(pub || {}), account, status: "failed", error: (item && item.error) || d.error || "no response for this card" });
    } catch (e) { setPub({ ...(pub || {}), account, status: "failed", error: String(e).slice(0, 160) }); }
    setPostingNow(false);
  };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.35)", zIndex: 300, display: "flex", justifyContent: "flex-end" }}>
      {/* 100dvh, not 100% — Safari's 100% includes the strip under its bottom
          toolbar, which is exactly where the Add card button sat: painted but
          untappable, with no way to scroll it into reach. dvh tracks the
          VISIBLE viewport. The extra bottom padding keeps the last button clear
          of the home-indicator area once you do scroll down. */}
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(460px, 94vw)", height: "100dvh", background: c.card, borderLeft: `1px solid ${c.line}`, padding: "24px 26px calc(56px + env(safe-area-inset-bottom, 0px))", overflowY: "auto", boxSizing: "border-box", WebkitOverflowScrolling: "touch" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontFamily: sans, fontSize: 18, fontWeight: 300, color: c.ink }}>{isNew ? "New card" : "Card"}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: c.sub, cursor: "pointer" }}>×</button>
        </div>

        <button onClick={() => setDone(!done)}
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, background: "transparent", border: `1px solid ${done ? c.green : c.line}`, borderRadius: 1, padding: "8px 12px", cursor: "pointer" }}>
          <span style={{ width: 15, height: 15, borderRadius: "50%", border: `1.5px solid ${done ? c.green : c.line}`, background: done ? c.green : "transparent", color: c.bg, fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{done ? "✓" : ""}</span>
          <span style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: done ? c.green : c.sub }}>{done ? "Done — posted" : "Mark as done"}</span>
        </button>

        {/* members — surfaced up top so tagging someone is the first thing you see */}
        <div style={label}>Tag a team member</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
          {members.map((m) => (
            <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${c.line}`, borderRadius: 1, background: c.bg, padding: "4px 8px", fontFamily: sans, fontSize: 11, color: c.ink }}>
              <span style={{ width: 16, height: 16, borderRadius: "50%", border: `1px solid ${c.taupe}`, color: c.taupe, fontSize: 7.5, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(m)}</span>
              {m}
              <button onClick={() => setMembers(members.filter((x) => x !== m))} style={{ background: "none", border: "none", color: c.sub, cursor: "pointer", padding: 0, fontSize: 12 }}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <select style={{ ...input, color: c.sub, flex: 1 }} value=""
            onChange={(e) => { if (e.target.value === "__custom") { const v = prompt("Name to tag"); if (v && v.trim()) addMember(v); } else if (e.target.value) addMember(e.target.value); }}>
            <option value="">+ Assign a team member…</option>
            {memberPool.filter((m) => !members.includes(m)).map((m) => <option key={m} value={m}>{m}</option>)}
            <option value="__custom">Someone not on the roster…</option>
          </select>
          {me && !members.includes(me) && (
            <button onClick={() => addMember(me)} title="Add yourself to this card"
              style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "0 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.ink, cursor: "pointer" }}>⊕ Join</button>
          )}
        </div>

        {/* 3 videos we loved — shows on BOTH PR and UGC cards. On UGC they append
            to the outreach email; on PR they're just reference picks (the PR lead
            has their own messaging, so no email/DM automation on PR). */}
        {isPrUgc && (
          <div style={{ border: `1px solid ${c.line}`, borderRadius: 2, background: c.bg, padding: "12px 14px", marginTop: 14 }}>
            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 6 }}>3 videos we loved</div>
            {[0, 1, 2].map((i) => (
              <input key={i} value={refExamples[i]} onChange={(e) => setRefExamples(refExamples.map((v, j) => (j === i ? e.target.value : v)))} placeholder={"Example video " + (i + 1) + " — link from their account"} style={{ ...input, marginBottom: 5, fontSize: 11 }} />
            ))}
            <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 10, color: c.sub, marginTop: 2 }}>
              {isOutreach ? "Appended to the outreach email as inspiration — with a note to keep their natural style." : "Reference picks — examples of the feel we love from their content."}
            </div>
          </div>
        )}

        {isOutreach && (
          <div style={{ border: `1px solid ${c.line}`, borderRadius: 2, background: c.bg, padding: "12px 14px", marginTop: 14 }}>
            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 8 }}>Creator outreach</div>
            <div style={{ fontFamily: sans, fontSize: 11, color: c.sub, marginBottom: 6, whiteSpace: "pre-wrap", lineHeight: 1.5, background: c.card, border: `1px solid ${c.line}`, borderRadius: 2, padding: "8px 10px", maxHeight: 104, overflowY: "auto" }}>{UGC_DM_SCRIPT}</div>
            <button onClick={async () => { try { await navigator.clipboard.writeText(UGC_DM_SCRIPT); setDmCopied(true); setTimeout(() => setDmCopied(false), 1800); } catch {} const u = (exampleUrl || "").trim() || (links[0] && links[0].url); if (u) window.open(u, "_blank", "noopener"); }}
              style={{ width: "100%", background: c.ink, color: c.bg, border: "none", borderRadius: 1, padding: "9px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer", marginBottom: 14 }}>
              {dmCopied ? "✓ DM copied — opening profile…" : "Copy DM & open profile"}</button>
            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, marginBottom: 4 }}>Follow-up email · from {UGC_EMAIL_FROM}</div>
            <input value={outreachEmail} onChange={(e) => setOutreachEmail(e.target.value)} placeholder="creator's email (once they reply)" style={{ ...input, marginBottom: 6 }} />
            <div style={{ fontFamily: sans, fontSize: 10, color: c.sub, marginBottom: 4 }}>Subject: {UGC_EMAIL_SUBJECT}</div>
            <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={7} style={{ ...input, fontFamily: sans, fontSize: 11, lineHeight: 1.5, resize: "vertical" }} />
            <a href={UGC_BRIEF_PDF} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", margin: "6px 0", fontFamily: sans, fontSize: 10, color: c.taupe, textDecoration: "none", border: `1px solid ${c.line}`, borderRadius: 4, padding: "4px 9px" }}>Lavalle Haus — Creator Brief.pdf</a>
            <div style={{ fontFamily: sans, fontSize: 10, color: c.sub, marginTop: 4 }}>The 3 videos above are appended automatically.</div>
            <button disabled={!outreachEmail.trim() || emailState === "sending"} onClick={async () => {
              setEmailState("sending");
              try {
                const r = await fetch("/api/data?op=send_outreach_email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: outreachEmail.trim(), subject: UGC_EMAIL_SUBJECT, body: composeOutreachEmail(emailBody, refExamples), cardId: card.id }) });
                const d = await r.json();
                setEmailState(d.ok ? "sent" : ("err:" + (d.error || "failed")));
              } catch (e) { setEmailState("err:" + String(e).slice(0, 80)); }
            }} style={{ display: "block", width: "100%", background: outreachEmail.trim() ? c.green : c.line, color: "#fff", border: "none", borderRadius: 1, padding: "9px 0", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", cursor: outreachEmail.trim() ? "pointer" : "default", marginTop: 8 }}>
              {emailState === "sending" ? "Sending…" : emailState === "sent" ? "✓ Sent with brief attached" : "Send from " + UGC_EMAIL_FROM}</button>
            {emailState.startsWith("err:") && <div style={{ fontFamily: sans, fontSize: 10, color: c.red, marginTop: 6 }}>{emailState.slice(4)}</div>}
            <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 10, color: c.sub, marginTop: 6 }}>Sending goes live once {UGC_EMAIL_FROM} is verified in Resend.</div>
          </div>
        )}

        <div style={label}>Cover photo</div>
        {cover && <img src={cover} alt="" style={{ display: "block", width: "100%", height: "auto", maxHeight: 320, objectFit: "contain", background: c.bg, borderRadius: 1, border: `1px solid ${c.line}`, marginBottom: 6 }} />}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <label style={{ border: `1px solid ${c.line}`, borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>
            Upload
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) fileToCover(f, applyCover); }} />
          </label>
          {cover && (
            <a href={cover} download={(card.name || "cover").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() + ".jpg"}
              style={{ border: `1px solid ${c.line}`, borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, textDecoration: "none" }}>
              ⤓ Download
            </a>
          )}
          {cover && <button onClick={() => applyCover(null)} style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.red, cursor: "pointer" }}>Remove</button>}
        </div>

        {/* Card photos — up to 5 (an Instagram carousel's worth). First one
            doubles as the cover unless she taps a different one. */}
        <div style={label}>Photos ({attachments.length}/5) — tap one to set as cover</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5, marginBottom: 10 }}>
          {attachments.map((a, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img src={a} alt="" onClick={() => applyCover(a)}
                style={{ width: "100%", height: 64, objectFit: "cover", borderRadius: 1, cursor: "pointer", border: cover === a ? `2px solid ${c.ink}` : `1px solid ${c.line}` }} />
              <button onClick={() => setAttachments(attachments.filter((_, j) => j !== i))} title="Remove photo"
                style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 9, border: `1px solid ${c.line}`, background: "#fff", color: c.sub, fontSize: 11, lineHeight: 1, cursor: "pointer", padding: 0 }}>×</button>
            </div>
          ))}
          {attachments.length < 5 && (
            <label style={{ height: 64, border: `1px dashed ${c.line}`, borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>
              ⇪ Add
              <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => {
                const files = [...(e.target.files || [])].slice(0, 5 - attachments.length);
                files.forEach((f) => fileToCover(f, (u) => setAttachments((cur) => {
                  if (cur.length >= 5) return cur;
                  const next = [...cur, u];
                  if (!cover && next.length === 1) applyCover(u); // first photo becomes the cover
                  return next;
                })));
                e.target.value = "";
              }} />
            </label>
          )}
        </div>

        <div style={label}>Title</div>
        <input style={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus={isNew} />
        <div style={label}>On-screen hook</div>
        <input style={input} placeholder="Text that appears ON the video — never posted as caption" value={hook} onChange={(e) => setHook(e.target.value)} />
        <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 10.5, color: c.sub, marginTop: -6, marginBottom: 10 }}>Stays on the card as a filming note. Only the caption below goes live.</div>
        <div style={label}>Caption</div>
        <textarea style={{ ...input, resize: "vertical" }} rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <NotesLinks text={desc} />
        {/* TikTok-only hashtags: she wants 2 on TikTok and none on Instagram, so
            these are stored apart from the caption and never reach the IG post. */}
        <div style={label}>Hashtags · TikTok only</div>
        <input style={input} placeholder="#cozyhome #candle — added to TikTok only, never Instagram" value={tags} onChange={(e) => setTags(e.target.value)} />
        {tags.trim() && (
          <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 10.5, color: c.sub, marginTop: -6, marginBottom: 10 }}>
            {(tags.match(/#/g) || []).length} hashtag{(tags.match(/#/g) || []).length === 1 ? "" : "s"} — added to TikTok only
          </div>
        )}

        {/* checklist — the film → edit → post steps live on the card */}
        <div style={label}>Checklist{checklist.length ? " · " + checklist.filter((x) => x.done).length + "/" + checklist.length : ""}</div>
        {checklist.length > 0 && (
          <div style={{ height: 5, background: c.bg, border: `1px solid ${c.line}`, borderRadius: 3, marginBottom: 8, overflow: "hidden" }}>
            <div style={{ width: (checklist.filter((x) => x.done).length / checklist.length) * 100 + "%", height: "100%", background: c.green, transition: "width 0.3s ease" }} />
          </div>
        )}
        {checklist.map((it) => (
          <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "3px 0" }}>
            <input type="checkbox" checked={!!it.done} onChange={() => setChecklist(checklist.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))} />
            <span style={{ flex: 1, fontFamily: sans, fontSize: 12.5, color: it.done ? c.sub : c.ink, textDecoration: it.done ? "line-through" : "none" }}>{it.t}</span>
            <button onClick={() => setChecklist(checklist.filter((x) => x.id !== it.id))} style={{ background: "none", border: "none", color: c.sub, cursor: "pointer", padding: 0, fontSize: 12 }}>×</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 6, marginTop: checklist.length ? 6 : 0 }}>
          <input style={{ ...input, flex: 1 }} placeholder="Add a step… (film, edit, approve)" value={checkInput} onChange={(e) => setCheckInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && checkInput.trim()) { setChecklist([...checklist, { id: uid(), t: checkInput.trim(), done: false }]); setCheckInput(""); } }} />
          <button onClick={() => { if (!checkInput.trim()) return; setChecklist([...checklist, { id: uid(), t: checkInput.trim(), done: false }]); setCheckInput(""); }}
            style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "0 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>Add</button>
        </div>

        {/* the two standing buttons: reference video + this post's Drive asset */}
        <div style={label}>Example video</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input style={{ ...input, flex: 1 }} placeholder="https://www.tiktok.com/…" value={exampleUrl} onChange={(e) => setExampleUrl(e.target.value)} />
          {exampleUrl.trim() && (
            <a href={exampleUrl.trim()} target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${c.line}`, borderRadius: 1, padding: "0 14px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.ink, textDecoration: "none", background: c.bg }}>▷ Open</a>
          )}
        </div>
        {/* Rough draft — the beat sheet Kiabeth writes off the example video so
            the copy editor can see the intent before writing the real caption.
            Each beat carries its own comment thread, Google-Docs style. */}
        <div style={label}>Rough draft</div>
        <div style={{ border: `1px solid ${c.line}`, borderRadius: 2, padding: 10, marginBottom: 10, background: c.bg }}>
          {draftBeats.map((beat) => {
            const notes = (draftNotes[beat.key] || []).filter((n) => showResolved || !n.resolved);
            const openCount = (draftNotes[beat.key] || []).filter((n) => !n.resolved).length;
            return (
              <div key={beat.key} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub }}>{beat.label}</span>
                  <button onClick={() => setNoteOn(noteOn === beat.key ? null : beat.key)}
                    style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontFamily: sans, fontSize: 10, color: openCount ? c.taupe : c.line }}
                    title="Comment on this section">✎{openCount ? " " + openCount : ""}</button>
                  {beat.key === "point3" && !draft.point3 && (
                    <span style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 10, color: c.line }}>optional</span>
                  )}
                </div>
                <textarea rows={beat.key === "intro" || beat.key === "close" ? 2 : 2}
                  style={{ ...input, resize: "vertical", marginBottom: 4 }}
                  placeholder={beat.hint}
                  value={draft[beat.key] || ""}
                  onChange={(e) => setDraft({ ...draft, [beat.key]: e.target.value })} />
                {notes.map((n) => (
                  <div key={n.id} style={{ display: "flex", gap: 6, alignItems: "flex-start", background: n.resolved ? "transparent" : "#FBF7F0", border: `1px solid ${n.resolved ? c.line : "#E8DFD0"}`, borderRadius: 2, padding: "6px 8px", marginBottom: 4, opacity: n.resolved ? 0.55 : 1 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: sans, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase", color: c.sub }}>
                        {n.by}{n.resolved ? " · resolved" : ""} · {new Date(n.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </div>
                      <div style={{ fontFamily: sans, fontSize: 12, color: c.ink, whiteSpace: "pre-wrap" }}>{n.text}</div>
                    </div>
                    <button onClick={() => setDraftNotes({ ...draftNotes, [beat.key]: (draftNotes[beat.key] || []).map((x) => (x.id === n.id ? { ...x, resolved: !x.resolved } : x)) })}
                      title={n.resolved ? "Reopen" : "Mark resolved"}
                      style={{ border: "none", background: "transparent", cursor: "pointer", color: c.sub, fontSize: 12, padding: 0 }}>{n.resolved ? "↺" : "✓"}</button>
                    <button onClick={() => { if (window.confirm("Delete this comment?")) setDraftNotes({ ...draftNotes, [beat.key]: (draftNotes[beat.key] || []).filter((x) => x.id !== n.id) }); }}
                      title="Delete" style={{ border: "none", background: "transparent", cursor: "pointer", color: c.line, fontSize: 13, padding: 0 }}>×</button>
                  </div>
                ))}
                {noteOn === beat.key && (
                  <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                    <input autoFocus style={{ ...input, flex: 1, marginBottom: 0 }} placeholder="Leave a note on this section…"
                      value={noteText} onChange={(e) => setNoteText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && noteText.trim()) { addDraftNote(beat.key); } }} />
                    <button onClick={() => addDraftNote(beat.key)} disabled={!noteText.trim()}
                      style={{ border: `1px solid ${c.ink}`, background: noteText.trim() ? c.ink : c.line, color: "#fff", borderRadius: 1, padding: "0 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Add</button>
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {!draft.point3 && !showPoint3 && (
              <button onClick={() => setShowPoint3(true)}
                style={{ border: `1px dashed ${c.line}`, background: "transparent", borderRadius: 1, padding: "5px 10px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>+ Main point 3</button>
            )}
            <button onClick={() => setShowResolved(!showResolved)}
              style={{ border: "none", background: "transparent", padding: 0, fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 11, color: c.sub, cursor: "pointer" }}>
              {showResolved ? "Hide resolved comments" : "Show resolved comments"}
            </button>
          </div>
        </div>

        <div style={label}>Post asset</div>
        {(() => {
          // One editable Drive button. url/setUrl live in state; the pencil (top
          // right) reveals an input to paste/replace the link the button opens.
          const btnRow = (title, url, setUrl, editing, setEditing, field) => (
            <div style={{ position: "relative", marginBottom: 8 }}>
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${c.line}`, borderRadius: 1, padding: "9px 34px 9px 14px", fontFamily: sans, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: c.ink, textDecoration: "none", background: c.bg }}>
                  ▸ Open {title} in Drive
                </a>
              ) : (
                <div style={{ display: "inline-flex", alignItems: "center", border: `1px dashed ${c.line}`, borderRadius: 1, padding: "9px 34px 9px 14px", fontFamily: sans, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, background: "transparent" }}>
                  No {title} link yet
                </div>
              )}
              <button onClick={() => setEditing(!editing)} title={"Edit " + title + " link"}
                style={{ position: "absolute", top: 8, right: 8, background: "transparent", border: "none", color: editing ? c.ink : c.sub, cursor: "pointer", fontSize: 13, lineHeight: 1 }}>✎</button>
              {editing && (
                <input autoFocus value={url} placeholder="Paste the Drive link…" onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { const v = url.trim() || null; if (!isNew && onPatch) onPatch({ [field]: v }); setEditing(false); } }}
                  onBlur={() => { const v = url.trim() || null; if (!isNew && onPatch) onPatch({ [field]: v }); }}
                  style={{ ...input, marginTop: 6 }} />
              )}
            </div>
          );
          const reelLabel = isCarouselCard(card.name) && !isReelCard(card.name) ? "carousel" : "reel";
          return (
            <div>
              {btnRow("cover photo", coverUrl, setCoverUrl, editCover, setEditCover, "coverUrl")}
              {btnRow(reelLabel, assetUrlState, setAssetUrlState, editAsset, setEditAsset, "assetUrl")}
            </div>
          );
        })()}

        {/* publish straight from the card — same engine as the Grid */}
        {pubAccounts && pubAccounts.length > 0 && !isNew && (
          <>
            <div style={label}>Where does this post go?</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {[["ig", "Instagram", brandAcct ? "@" + brandAcct + " · auto-posts" : "auto-posts"], ["tiktok", "TikTok", "schedule in TikTok Studio"]].map(([k, lab, sub]) => (
                <button key={k} onClick={() => setDest({ ...dest, [k]: !dest[k] })}
                  style={{ flex: 1, textAlign: "left", background: dest[k] ? c.card : "transparent", border: `1px solid ${dest[k] ? c.ink : c.line}`, borderRadius: 2, padding: "8px 10px", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${dest[k] ? c.ink : c.line}`, background: dest[k] ? c.ink : "transparent", color: c.bg, fontSize: 10, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{dest[k] ? "✓" : ""}</span>
                    <span style={{ fontFamily: sans, fontSize: 12, color: c.ink }}>{lab}</span>
                  </div>
                  <div style={{ fontFamily: sans, fontSize: 9, color: c.sub, marginTop: 2, marginLeft: 20 }}>{sub}</div>
                </button>
              ))}
            </div>
            {dest.ig && (pub && pub.status === "published" ? (
              <div>
                <div style={{ fontFamily: sans, fontSize: 12, color: c.green, marginBottom: 7 }}>✓ Posted to @{pub.account}{pub.publishedAt ? " · " + new Date(pub.publishedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</div>
                <button disabled={postingNow}
                  onClick={async () => {
                    if (!window.confirm('Re-post "' + name + '" to @' + pub.account + "?\n\nOnly do this AFTER deleting the old post on Instagram — otherwise you'll have two.")) return;
                    setPostingNow(true);
                    try { await fetch("/api/data?op=repost", { method: "POST", headers: { "Content-Type": "application/json", "x-app-token": localStorage.getItem("lh_token") || "" }, body: JSON.stringify({ boardKey, cardId: card.id }) }); } catch {}
                    setPub({ ...(pub || {}), status: "scheduled", mediaId: undefined, publishedAt: undefined }); setDone(false);
                    setPostingNow(false);
                    runPost(false);
                  }}
                  style={{ background: "transparent", border: `1px solid ${c.line}`, borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, cursor: "pointer", opacity: postingNow ? 0.5 : 1 }}>
                  {postingNow ? "Re-posting…" : "↻ Re-post"}</button>
              </div>
            ) : pub && (pub.status === "converting" || pub.status === "processing") ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: sans, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: c.taupe, marginBottom: 4 }}>
                  <span><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: c.taupe, marginRight: 6, animation: "lhpulse 1.1s ease-in-out infinite" }} />{pub.status === "converting" ? "Converting video…" : "Posting to Instagram…"} · {mmss(elapsed)}</span>
                  <span>{pub.status === "converting" ? "Step 1 of 2" : "Step 2 of 2"}</span>
                </div>
                <style>{"@keyframes lhpulse{0%,100%{opacity:.35}50%{opacity:1}}@keyframes lhslide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}</style>
                <div style={{ height: 6, background: "#EEECE6", borderRadius: 4, overflow: "hidden", marginBottom: 8, position: "relative" }}>
                  <div style={{ height: "100%", width: pub.status === "converting" ? "45%" : "85%", background: c.taupe, borderRadius: 4, transition: "width .5s ease" }} />
                  <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: "30%", background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent)", animation: "lhslide 1.4s linear infinite" }} />
                </div>
                <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 11.5, color: c.sub, marginBottom: 8 }}>Still working — a reel can take 1–2 minutes (longer for a big video). It keeps going even if you switch screens; keep the app open and the card's green check ticks the moment it's live on @{pub.account}.</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button disabled={postingNow} onClick={() => runPost(false)}
                    style={{ background: "transparent", border: `1px solid ${c.line}`, borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, cursor: "pointer", opacity: postingNow ? 0.5 : 1 }}>
                    {postingNow ? "Checking…" : "↻ Check now"}</button>
                  <button onClick={() => setPub({ ...pub, status: "scheduled", containerId: undefined, convId: undefined, mp4Url: undefined })}
                    style={{ background: "transparent", border: `1px solid ${c.line}`, borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                {pub && pub.status === "failed" && (
                  <div style={{ background: "#F7F0EE", border: "1px solid #E2D4CD", borderRadius: 1, padding: "8px 11px", fontFamily: sans, fontSize: 11.5, lineHeight: 1.5, color: c.red, marginBottom: 6 }}>
                    ✗ {pub.error}
                    <button onClick={() => setPub({ ...pub, status: "scheduled", error: null })} style={{ marginLeft: 8, border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "2px 8px", fontFamily: sans, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>Retry</button>
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {brandAcct ? (
                    <div style={{ ...input, width: "auto", flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 6 }} title="Locked to this board's brand account">
                      <span style={{ fontFamily: sans, fontSize: 12, color: c.ink }}>@{brandAcct}</span>
                      <span style={{ fontFamily: sans, fontSize: 8, letterSpacing: 1, textTransform: "uppercase", color: c.sub }}>locked</span>
                    </div>
                  ) : (
                    <select style={{ ...input, width: "auto", flex: "0 0 auto" }} value={(pub && pub.account) || pubAccounts[0].username}
                      onChange={(e) => setPub({ ...(pub || { status: "scheduled", auto: false }), account: e.target.value })}>
                      {pubAccounts.map((a) => <option key={a.user_id} value={a.username}>@{a.username}</option>)}
                      <option value="" disabled>TikTok — pending approval</option>
                    </select>
                  )}
                  <input type="datetime-local" style={{ ...input, width: "auto", flex: 1, minWidth: 170 }} value={dtLocal(pub && pub.at)}
                    onChange={(e) => setPub({ ...(pub || { auto: false }), status: "scheduled", account: brandAcct || (pub && pub.account) || pubAccounts[0].username, at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, cursor: pub && pub.at ? "pointer" : "default", opacity: pub && pub.at ? 1 : 0.45 }}>
                  <input type="checkbox" checked={!!(pub && pub.auto)} disabled={!(pub && pub.at)}
                    onChange={(e) => setPub({ ...pub, auto: e.target.checked, status: "scheduled", account: brandAcct || pub.account || pubAccounts[0].username })} />
                  <span style={{ fontFamily: sans, fontSize: 12, color: c.ink }}>
                    Auto-publish{pub && pub.auto && pub.at ? " — " + new Date(pub.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : " at the scheduled time"}
                  </span>
                </label>
                <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                  <button disabled={postingNow || !cover} onClick={() => runPost(true)}
                    style={{ background: c.ink, color: c.bg, border: `1px solid ${c.ink}`, borderRadius: 1, padding: "8px 14px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", opacity: postingNow || !cover ? 0.5 : 1 }}>
                    {postingNow ? "Posting…" : "◉ Post now"}
                  </button>
                  {!cover && <span style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 11, color: c.sub }}>Add a cover photo to post.</span>}
                </div>
                <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 10.5, color: c.sub, marginTop: 6 }}>
                  Schedules save with the card. Photos post instantly; Reels upload the linked .mov and post once Instagram finishes processing the video (can take a minute). For TikTok, use the TikTok Studio hand-off below.
                </div>
              </>
            ))}
            {dest.tiktok && (
              <div style={{ marginTop: 14, border: `1px solid ${c.line}`, borderRadius: 2, background: c.bg, padding: "12px 14px" }}>
                <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 6 }}>TikTok · via TikTok Studio</div>
                <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 11, color: c.sub, marginBottom: 8 }}>TikTok can't post from here (their API declined internal tools), so it's scheduled natively in TikTok Studio — free, up to 10 days ahead. This copies your caption and opens the Studio upload page — switch to the right brand account, add the video, paste the caption, and pick the time.</div>
                <button onClick={async () => { const cap = (desc || "") + (tags.trim() ? "\n\n" + tags.trim() : ""); try { await navigator.clipboard.writeText(cap); setPlannCopied(true); setTimeout(() => setPlannCopied(false), 1800); } catch {} window.open("https://www.tiktok.com/tiktokstudio/upload", "_blank", "noopener"); }}
                  style={{ width: "100%", background: c.ink, color: c.bg, border: "none", borderRadius: 1, padding: "9px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer", marginBottom: 8 }}>
                  {plannCopied ? "✓ Caption copied — opening TikTok Studio…" : "Copy caption & open TikTok Studio"}</button>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {assetUrlState && <a href={assetUrlState} target="_blank" rel="noopener noreferrer" style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: c.taupe, border: `1px solid ${c.line}`, borderRadius: 4, padding: "5px 9px", textDecoration: "none" }}>▶ Video in Drive</a>}
                  {cover && <a href={cover} download={(name || "cover").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() + ".jpg"} style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: c.taupe, border: `1px solid ${c.line}`, borderRadius: 4, padding: "5px 9px", textDecoration: "none" }}>⤓ Cover</a>}
                </div>
              </div>
            )}
          </>
        )}

        {/* links */}
        <div style={label}>Links</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          {links.map((L, i) => {
            const m = linkMeta(L.u);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "6px 10px" }}>
                <a href={L.u} target="_blank" rel="noopener noreferrer" title={L.u} style={{ flex: 1, fontFamily: sans, fontSize: 12, color: c.ink, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ color: c.taupe }}>{m.icon}</span> {L.n && L.n !== L.u ? L.n : m.label} <span style={{ color: c.taupe }}>↗</span>
                </a>
                <button onClick={() => setLinks(links.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: c.sub, cursor: "pointer", padding: 0, fontSize: 12 }}>×</button>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input style={{ ...input, flex: 1 }} placeholder="Link name" value={linkName} onChange={(e) => setLinkName(e.target.value)} />
          <input style={{ ...input, flex: 2 }} placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && linkUrl.trim()) { setLinks([...links, { n: linkName.trim() || linkUrl.trim(), u: linkUrl.trim() }]); setLinkName(""); setLinkUrl(""); } }} />
          <button onClick={() => { if (!linkUrl.trim()) return; setLinks([...links, { n: linkName.trim() || linkUrl.trim(), u: linkUrl.trim() }]); setLinkName(""); setLinkUrl(""); }}
            style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "0 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>Add</button>
        </div>

        {/* tags — neutral palette */}
        <div style={label}>Tags</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
          {labels.map((L, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: L.c, color: labelText(L.c), borderRadius: 1, padding: "4px 9px", fontFamily: sans, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase" }}>
              {L.n}
              <button onClick={() => setLabels(labels.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: labelText(L.c), cursor: "pointer", padding: 0, fontSize: 11 }}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
          {LABEL_PALETTE.map((p) => (
            <button key={p.c} onClick={() => setLabelColor(p.c)} title={p.name}
              style={{ width: 24, height: 18, background: p.c, borderRadius: 1, cursor: "pointer", border: labelColor === p.c ? `2px solid ${c.ink}` : `1px solid ${c.line}`, padding: 0 }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input style={{ ...input, flex: 1 }} placeholder="New tag name…" value={labelName}
            onChange={(e) => setLabelName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addLabel(); }} />
          <button onClick={addLabel} style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "0 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>Add</button>
        </div>

        {/* board + list (move across boards) */}
        <div style={label}>Board</div>
        <select style={input} value={destBoard} onChange={(e) => { const k = e.target.value; setDestBoard(k); const ls = (boardsIndex[k] || {}).lists || []; setListId(ls.length ? ls[0].id : null); }}>
          {Object.entries(boardsIndex).map(([k, b]) => <option key={k} value={k}>{b.name}</option>)}
        </select>
        <div style={label}>List</div>
        <select style={input} value={listId || ""} onChange={(e) => setListId(e.target.value)}>
          {destLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div style={label}>Launch month <span style={{ textTransform: "none", letterSpacing: 0, color: c.sub }}>· groups this look in the Lookbook</span></div>
        <input style={input} type="month" value={launchMonth} onChange={(e) => setLaunchMonth(e.target.value)} />

        <div style={label}>Due date</div>
        <input style={input} type="date" value={due} onChange={(e) => setDue(e.target.value)} />

        <button onClick={() => {
          if (!name.trim() || !listId) return;
          // Fold in anything still sitting in the add-rows — a typed tag or link
          // shouldn't vanish just because Add wasn't pressed before Save.
          const finalLabels = labelName.trim() ? [...labels, { n: labelName.trim(), c: labelColor }] : labels;
          const finalLinks = linkUrl.trim() ? [...links, { n: linkName.trim() || linkUrl.trim(), u: linkUrl.trim() }] : links;
          onSave({ name: name.trim(), hook: hook.trim() || null, tags: tags.trim() || null, draft: Object.keys(draft).length ? draft : null, draftNotes: Object.keys(draftNotes).length ? draftNotes : null, exampleUrl: exampleUrl.trim() || null, coverUrl: coverUrl.trim() || null, assetUrl: assetUrlState.trim() || null, pub: pub || null, checklist: checkInput.trim() ? [...checklist, { id: uid(), t: checkInput.trim(), done: false }] : checklist, desc, due: due ? due + "T12:00:00.000Z" : null, launchMonth: launchMonth || null, labels: finalLabels, listId, members, cover, done, links: finalLinks, attachments, comments: card.comments || [], outreachEmail: outreachEmail.trim() || null, emailBody: emailBody === UGC_EMAIL_BODY ? null : emailBody, refExamples: refExamples.map((s) => s.trim()).filter(Boolean).length ? refExamples.map((s) => s.trim()).filter(Boolean) : null, dest }, destBoard);
        }}
          style={{ display: "block", width: "100%", marginTop: 20, padding: "12px 0", background: c.ink, color: c.bg, border: "none", borderRadius: 1, fontFamily: sans, fontSize: 10, letterSpacing: 3, textTransform: "uppercase", cursor: "pointer" }}>
          {isNew ? "Add card" : destBoard !== boardKey ? "Save & move board" : "Done — changes save automatically"}
        </button>
        {!isNew && onDuplicate && (
          <button onClick={onDuplicate}
            style={{ display: "block", width: "100%", marginTop: 8, padding: "10px 0", background: "transparent", color: c.ink, border: `1px solid ${c.line}`, borderRadius: 1, fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>
            ⧉ Duplicate card
          </button>
        )}
        {onDelete && (
          <button onClick={() => { if (confirm("Delete this card?")) onDelete(); }}
            style={{ display: "block", width: "100%", marginTop: 8, padding: "10px 0", background: "transparent", color: c.red, border: `1px solid ${c.line}`, borderRadius: 1, fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>
            Delete card
          </button>
        )}

        {/* comments & activity */}
        {!isNew && (
          <div>
            <div style={{ ...label, marginTop: 22 }}>Comments & activity</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input style={{ ...input, flex: 1 }} placeholder={"Write a comment… tag with @name" + (me ? "" : " (set your name top right first)")} value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && commentText.trim()) { onComment(commentText.trim()); setCommentText(""); } }} />
              <button onClick={() => { if (commentText.trim()) { onComment(commentText.trim()); setCommentText(""); } }}
                style={{ border: "none", background: c.ink, color: c.bg, borderRadius: 1, padding: "0 14px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Post</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 260, overflowY: "auto" }}>
              {[...comments].reverse().map((cm) => (
                <div key={cm.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", opacity: cm.sys ? 0.7 : 1 }}>
                  <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", border: `1px solid ${c.taupe}`, color: c.taupe, fontSize: 8.5, display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>{initials(cm.by)}</span>
                  <div>
                    <div style={{ fontFamily: sans, fontSize: 12.5, lineHeight: 1.5, color: c.ink }}>
                      <span style={{ fontWeight: 500 }}>{cm.by}</span>{" "}
                      <span style={{ color: cm.sys ? c.sub : c.ink, fontStyle: cm.sys ? "italic" : "normal" }}>{cm.text}</span>
                    </div>
                    <div style={{ fontFamily: sans, fontSize: 9.5, color: c.sub, marginTop: 1 }}>{new Date(cm.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                  </div>
                </div>
              ))}
              {comments.length === 0 && <div style={{ fontFamily: sans, fontSize: 12, fontStyle: "italic", color: c.sub }}>No activity yet.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
