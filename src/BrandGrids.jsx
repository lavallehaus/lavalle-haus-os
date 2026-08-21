import { useEffect, useMemo, useRef, useState } from "react";

// LAVALLE HAUS OS — Brand Grids (Content → Grids)
// Plann-style 21-slot planning grid per brand account. The moment a card on a
// brand board gets a cover photo it appears in that brand's grid — position 1
// at the BOTTOM-LEFT, new covers stacking upward (7 rows × 3). Drag tiles to
// hand-arrange; Arrange orders by tone so neighbors alternate
// light/dark and similar shots don't clump.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", green: "#5a7a5a" };
const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const serif = "Georgia, 'Times New Roman', serif";

const BRANDS = [
  { acct: "refilleryhaus", label: "Lavalle Haus", handle: "@refilleryhaus" },
  { acct: "thefoldlabel", label: "The Fold Label", handle: "@thefoldlabel" },
  { acct: "lavallesisters", label: "Lavalle Sisters", handle: "@lavallesisters" },
];
// Only the three MAIN content boards feed the grids — "Lavalle Sisters",
// "Lavalle Haus", "The Fold" — never ops/R&D/archive/PR boards (a PR board
// even shares the name "The Fold", so boards are pinned by key).
const GRID_BOARDS = { "lavalle-sisters": "lavallesisters", "refillery-haus": "refilleryhaus", "the-fold": "thefoldlabel" };

const SLOTS = 21, COLS = 3, ROWS = 7;

// Stable identity matters: this exact function is added on drag start and must
// be the SAME reference when removed on drop, or scrolling locks up for good.
const preventScroll = (e) => e.preventDefault();

const guid = () => "g" + Math.random().toString(36).slice(2, 9);

// ── The Row-level arranger ───────────────────────────────────────────────────
// Works on art-director labels (who / kind / color / tone from Claude vision),
// not just pixels. Slots s and s±1 share a row (when in the same row band) and
// s±3 stack vertically, so adjacency in slot space IS visual adjacency.
function slotNeighbors(s2, n) {
  const out = [];
  const row = Math.floor(s2 / 3);
  if (s2 - 1 >= 0 && Math.floor((s2 - 1) / 3) === row) out.push(s2 - 1);
  if (s2 + 1 < n && Math.floor((s2 + 1) / 3) === row) out.push(s2 + 1);
  if (s2 - 3 >= 0) out.push(s2 - 3);
  if (s2 + 3 < n) out.push(s2 + 3);
  return out;
}
function slotsWithin2(s2, n) {
  const r = Math.floor(s2 / 3), c2 = s2 % 3, out = [];
  for (let q = 0; q < n; q++) {
    if (q === s2) continue;
    const qr = Math.floor(q / 3), qc = q % 3;
    if (Math.abs(qr - r) + Math.abs(qc - c2) <= 2) out.push(q);
  }
  return out;
}
// pattern is read top-left→bottom-right on screen; convert a visual index to a
// slot number (position 1 renders bottom-right)
function visualToSlot(v, n) {
  const rows = Math.ceil(n / 3);
  const r = Math.floor(v / 3), c2 = v % 3;
  return (rows - 1 - r) * 3 + (2 - c2);
}
function arrangeByClasses(visible, lockedSlots, classes, pattern) {
  const n = visible.length;
  const tplBySlot = {};
  if (pattern && pattern.length) {
    for (let v = 0; v < n; v++) tplBySlot[visualToSlot(v, n)] = pattern[v % pattern.length];
  }
  const cls = (key) => classes[key] || {};
  const personOf = (key) => { const w = cls(key).w; return w === "kiabeth" || w === "kiaredza" || w === "both" ? w : null; };
  const cost = (pos) => {
    let total = 0;
    for (let s2 = 0; s2 < n; s2++) {
      const a = cls(visible[pos[s2]].key);
      // template rhythm: the strongest editorial signal when a reference is set
      if (tplBySlot[s2] && a.k && a.k !== tplBySlot[s2]) total += 4;
      for (const q of slotNeighbors(s2, n)) {
        if (q < s2) continue; // count each edge once
        const b2 = cls(visible[pos[q]].key);
        if (a.k === "face" && b2.k === "face") total += 6;           // never two faces touching
        if (a.k && a.k === b2.k && a.k !== "face") total += 1.5;    // same kind clumps read flat
        if (a.c && a.c === b2.c) total += 3;                        // color families separate
        if (a.t && a.t === b2.t) total += 1;                        // tonal rhythm
      }
      const pa = personOf(visible[pos[s2]].key);
      if (pa) for (const q of slotsWithin2(s2, n)) {
        if (q < s2) continue;
        const pb = personOf(visible[pos[q]].key);
        if (pb && (pa === pb || pa === "both" || pb === "both")) total += pa === pb ? 8 : 3; // same sister needs distance
      }
    }
    return total;
  };
  let pos = visible.map((_, i) => i);
  const free = pos.map((_, s2) => s2).filter((s2) => !lockedSlots.has(s2));
  if (free.length < 2) return pos;
  let best = [...pos], bestCost = cost(pos), cur = bestCost;
  for (let it = 0; it < 3200; it++) {
    const i = free[Math.floor(Math.random() * free.length)];
    const j = free[Math.floor(Math.random() * free.length)];
    if (i === j) continue;
    [pos[i], pos[j]] = [pos[j], pos[i]];
    const c2 = cost(pos);
    const temp = 3 * (1 - it / 3200);
    if (c2 <= cur || Math.random() < Math.exp((cur - c2) / Math.max(0.05, temp))) {
      cur = c2;
      if (c2 < bestCost) { bestCost = c2; best = [...pos]; }
    } else {
      [pos[i], pos[j]] = [pos[j], pos[i]];
    }
  }
  return best;
}

// Park uploads in the media store; the card keeps a short reference (inline
// base64 in the blob is what once blew Vercel's 4.5MB save limit).
async function storeImage(dataUrl) {
  try {
    const r = await fetch("/api/data?op=media_put", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl }) });
    const d = await r.json();
    return r.ok && d.url ? d.url : dataUrl;
  } catch { return dataUrl; }
}

export default function BrandGrids({ boards, data, onSave, onSaveBoards }) {
  const [acct, setAcct] = useState(BRANDS[0].acct);
  // Lavalle Sisters runs TWO grids: Instagram and TikTok. Same 21 cards, but
  // the TikTok side keeps its own covers (card.tiktokCover, falling back to the
  // IG cover), its own order, its own zoom crops and its own lock — all stored
  // under the separate "lavallesisters:tiktok" key.
  const [platform, setPlatform] = useState("ig");
  // Generated monthly grids (The Fold): archives at Social Media/<Month>/grid,
  // listed once and viewable via the month dropdown.
  const [genGrids, setGenGrids] = useState([]);
  const [genSel, setGenSel] = useState("");
  useEffect(() => {
    let dead = false;
    fetch("/api/data?op=fold_grid_list").then((r) => r.json()).then((d) => {
      if (dead || !d || !d.grids) return;
      setGenGrids(d.grids);
      // Default straight to the newest generated month — the live planner
      // duplicates what the generated grid already shows.
      if (d.grids.length) setGenSel(d.grids[d.grids.length - 1].fileId);
    }).catch(() => {});
    return () => { dead = true; };
  }, []);
  // Lavalle Sisters pre-grid + cycle archive (Courtney's hand-off view).
  const [sisGrids, setSisGrids] = useState({ pregrid: null, archive: [] });
  const [sisSel, setSisSel] = useState("");
  useEffect(() => {
    let dead = false;
    fetch("/api/data?op=sisters_grid_list").then((r) => r.json()).then((d) => {
      if (dead || !d) return;
      setSisGrids({ pregrid: null, archive: d.archive || [] });
      if (d.archive && d.archive.length) setSisSel(d.archive[0].fileId);
    }).catch(() => {});
    return () => { dead = true; };
  }, []);
  const tt = acct === "lavallesisters" && platform === "tt";
  const gk = tt ? "lavallesisters:tiktok" : acct;
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const [pickIdx, setPickIdx] = useState(null); // tap-to-move still works as a fallback
  const touchRef = useRef(null); // real finger-drag: long-press lifts the tile, ghost follows the finger
  const suppressClickRef = useRef(0);
  const [arranging, setArranging] = useState(false);
  const [editKey, setEditKey] = useState(null); // tile in inline reframe mode
  const [editZoom, setEditZoom] = useState({ s: 1.3, x: 0, y: 0 });
  const [editMsg, setEditMsg] = useState(null);
  const panRef = useRef(null);
  const pinchRef = useRef(new Map()); // active pointers on the editing tile
  const gPointersRef = useRef(new Map()); // all grid touches: pointerId → {x,y,key}
  const gPinchRef = useRef(null); // direct pinch-on-tile gesture {key,d0,s0}
  const actionsRef = useRef({});
  const [msg, setMsg] = useState(null);
  const savedRef = useRef("");

  // Covers from the brand board's "Schedule 1-21" column ONLY — planning
  // columns like Stories, Strategy Outline or August Schedule stay out.
  const candidates = useMemo(() => {
    const map = {};
    for (const [bk, board] of Object.entries(boards || {})) {
      if (bk.startsWith("_") || !board || !board.cards) continue;
      if (GRID_BOARDS[bk] !== acct) continue;
      const schedLists = new Set((board.lists || []).filter((l) => /^schedule\s*1\s*[-\u2013]\s*21$/i.test((l.name || "").trim())).map((l) => l.id));
      let seq = 0;
      for (const card of board.cards) {
        if (!card.cover || !schedLists.has(card.listId)) continue;
        // "Post 7 [reel]" → 7. This is the order SHE arranged in Schedule 1-21,
        // and it's what pins the posted block — most cards are ticked off by
        // hand and never get a publish timestamp, so time alone can't order them.
        const n = parseInt(((card.name || "").match(/post\s*(\d+)/i) || [])[1], 10);
        map[bk + ":" + card.id] = { key: bk + ":" + card.id, cover: (tt && card.tiktokCover) || card.cover, coverUrl: tt && card.tiktokCover ? "" : (card.coverUrl || ""), hasTT: !!card.tiktokCover, name: card.name || "", done: !!card.done, postedAt: (card.pub && card.pub.publishedAt) || null, seq: Number.isFinite(n) ? n : 1000 + seq, boardName: board.name || "" };
        seq++;
      }
    }
    return map;
  }, [boards, acct, tt]);

  // Saved order merged with reality: dead refs drop out, new covers append
  // (append = next slot up — position 1 stays the earliest planned post).
  const order = useMemo(() => {
    const saved = ((data || {})[gk] || {}).order || [];
    const kept = saved.filter((k) => candidates[k]);
    const known = new Set(kept);
    const fresh = Object.keys(candidates).filter((k) => !known.has(k));
    const merged = [...kept, ...fresh];
    // RULE: ✓ posted tiles ALWAYS occupy positions 1, 2, 3… and they sit in the
    // order SHE set in Schedule 1-21 (Post 1, Post 2, …). Publish timestamps are
    // only a tiebreak — cards ticked off by hand don't have one at all, and
    // sorting on the missing value is what scrambled the locked block.
    const posted = merged.filter((k) => candidates[k].done);
    posted.sort((a, b) => {
      const sa = candidates[a].seq, sb = candidates[b].seq;
      if (sa !== sb) return sa - sb;
      const pa = candidates[a].postedAt || "", pb = candidates[b].postedAt || "";
      if (pa && pb) return pa < pb ? -1 : pa > pb ? 1 : 0;
      return merged.indexOf(a) - merged.indexOf(b);
    });
    return [...posted, ...merged.filter((k) => !candidates[k].done)];
  }, [data, gk, candidates]);

  // Auto-ingest persists the merged order the moment it differs from what's saved.
  useEffect(() => {
    const j = gk + "|" + JSON.stringify(order);
    if (savedRef.current === j) return;
    const saved = ((data || {})[gk] || {}).order || [];
    if (JSON.stringify(saved) !== JSON.stringify(order)) {
      savedRef.current = j;
      onSave({ ...(data || {}), [gk]: { ...((data || {})[gk] || {}), order } });
    } else savedRef.current = j;
  }, [order, gk]); // eslint-disable-line

  const zooms = ((data || {})[gk] || {}).zoom || {};
  const saveZoom = (key, z) => {
    const cur = (data || {})[gk] || {};
    const zoom = { ...(cur.zoom || {}) };
    if (z) zoom[key] = z; else delete zoom[key];
    onSave({ ...(data || {}), [gk]: { ...cur, zoom } });
  };
  const items = order.map((k) => candidates[k]).filter(Boolean);
  const windowStart = Math.max(0, items.length - SLOTS);
  const visible = items.slice(windowStart); // newest 21 — older ones have shipped

  const saveOrder = (next) => onSave({ ...(data || {}), [gk]: { ...((data || {})[gk] || {}), order: next } });
  const locked = !!((data || {})[gk] || {}).locked;
  // Pinned individual placements she's happy with — auto-arrange must not move
  // them even while it reshuffles everything else ("I like 9 of the 21").
  const pins = ((data || {})[gk] || {}).pins || [];
  const togglePin = (key) => {
    const next = pins.includes(key) ? pins.filter((k) => k !== key) : [...pins, key];
    onSave({ ...(data || {}), [gk]: { ...((data || {})[gk] || {}), pins: next } });
  };
  const setLocked = () => {
    const locking = !locked;
    onSave({ ...(data || {}), [gk]: { ...((data || {})[gk] || {}), locked: locking } });
    // Locking = "this IS the sequence" — so the board's Schedule 1-21 list
    // snaps to it: the card in grid position 1 becomes first in the list,
    // position 2 second, and so on. Cards outside the grid keep their spots.
    // Only the Instagram grid drives the board; the TikTok grid is view-only
    // ordering for TikTok itself.
    if (locking && !tt && onSaveBoards && boards) {
      const bk = Object.keys(GRID_BOARDS).find((k) => GRID_BOARDS[k] === acct);
      const b = bk && boards[bk];
      if (b && b.cards) {
        const seqIds = order.map((k) => k.slice(k.indexOf(":") + 1)).filter((id) => b.cards.some((cd) => cd.id === id));
        const inGrid = new Set(seqIds);
        const queue = [...seqIds];
        // position index for each grid card, so names renumber to 1..21
        const posOf = {}; seqIds.forEach((id, i) => (posOf[id] = i + 1));
        const cards = b.cards.map((cd) => {
          if (!inGrid.has(cd.id)) return cd;
          const nextId = queue.shift(); // hoisted — inside find() it would shift once per comparison
          const src = b.cards.find((x) => x.id === nextId) || cd;
          // Her rule: the Post number IS the grid position. Dates/tags in the
          // name stay; only the leading number changes.
          const renamed = (src.name || "").replace(/^(\s*Post\s*)\d+/i, "$1" + posOf[src.id]);
          return renamed !== src.name ? { ...src, name: renamed } : src;
        });
        onSaveBoards({ ...boards, [bk]: { ...b, cards } });
        setMsg("Grid locked — Schedule 1-21 now matches this order, and every card is renumbered to its grid position.");
      }
    }
  };

  // A different photo entirely for TikTok — stored in the media store, written
  // to card.tiktokCover; the Instagram grid never sees it.
  const uploadTikTokCover = (file, it) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const maxW = 1440, sc = Math.min(1, maxW / img.width);
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        const u = await storeImage(cv.toDataURL("image/jpeg", 0.9));
        const bk = it.key.slice(0, it.key.indexOf(":")), cardId = it.key.slice(it.key.indexOf(":") + 1);
        if (onSaveBoards && boards && boards[bk]) onSaveBoards({ ...boards, [bk]: { ...boards[bk], cards: boards[bk].cards.map((cd) => (cd.id === cardId ? { ...cd, tiktokCover: u } : cd)) } });
        setMsg("TikTok cover set for " + (it.name || "this post") + " — the Instagram grid keeps its own.");
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  };

  // A reference grid = a screenshot of a feed whose editorial rhythm she wants.
  // The vision op reads its tile pattern; arranging then follows that rhythm.
  const [tplBusy, setTplBusy] = useState(false);
  const gridCfg = (data || {})[gk] || {};
  const templates = gridCfg.templates || [];
  const addTemplate = (file) => {
    const fr = new FileReader();
    fr.onload = async () => {
      setTplBusy(true); setMsg(null);
      try {
        const r = await fetch("/api/data?op=grid_template", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl: fr.result }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "couldn't read the grid");
        const t = { id: guid(), name: "Reference " + (templates.length + 1), pattern: d.pattern, logic: d.logic };
        onSave({ ...(data || {}), [gk]: { ...gridCfg, templates: [...templates, t].slice(-3), tplActive: t.id } });
        setMsg("Reference grid read — " + (d.logic || "pattern of " + d.pattern.length + " tiles") + ". Auto-arrange now follows it.");
      } catch (e) { setMsg("Reference grid failed: " + String(e.message || e).slice(0, 90)); }
      setTplBusy(false);
    };
    fr.readAsDataURL(file);
  };
  const setTplActive = (id) => onSave({ ...(data || {}), [gk]: { ...gridCfg, tplActive: gridCfg.tplActive === id ? null : id } });
  const removeTemplate = (id) => onSave({ ...(data || {}), [gk]: { ...gridCfg, templates: templates.filter((t) => t.id !== id), tplActive: gridCfg.tplActive === id ? null : gridCfg.tplActive } });

  // Direct upload: photos become real cards on the brand board's Schedule 1-21
  // list (cards are what publish), cover stored in the media store.
  const uploadToGrid = (files) => {
    const bk = Object.keys(GRID_BOARDS).find((k) => GRID_BOARDS[k] === acct);
    const b = bk && boards && boards[bk];
    if (!b) { setMsg("No board found for this account."); return; }
    const list = (b.lists || []).find((l) => /^schedule\s*1\s*[-\u2013]\s*21$/i.test((l.name || "").trim()));
    if (!list) { setMsg('This board needs a "Schedule 1-21" list first.'); return; }
    const arr = [...files].slice(0, 21);
    let done = 0; const made = [];
    arr.forEach((f) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = async () => {
          const maxW = 1440, sc = Math.min(1, maxW / img.width);
          const cv = document.createElement("canvas");
          cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          const u = await storeImage(cv.toDataURL("image/jpeg", 0.9));
          made.push({ id: guid(), listId: list.id, name: "Post — new upload", cover: u, labels: [], members: [], desc: "", done: false, comments: [] });
          done++;
          if (done === arr.length && onSaveBoards) {
            onSaveBoards({ ...boards, [bk]: { ...b, cards: [...b.cards, ...made] } });
            setMsg(made.length + " photo" + (made.length === 1 ? "" : "s") + " added to the grid — they're real cards on " + b.name + "'s Schedule 1-21, so they can publish like any post.");
          }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(f);
    });
  };

  const moveItem = (fromVis, toVis) => {
    if (locked) return; // finalised grid — nothing moves
    if (fromVis === toVis) return;
    if (visible[fromVis] && visible[fromVis].done) return; // posted tiles are pinned
    const lockedVis = visible.filter((v) => v.done).length; // posted block sits at the front
    toVis = Math.max(lockedVis, toVis);
    if (fromVis === toVis) return;
    const next = [...order];
    const [x] = next.splice(windowStart + fromVis, 1);
    next.splice(windowStart + toVis, 0, x);
    saveOrder(next);
  };

  // Classes live on the card (cd.gclass) so one classification pays forever.
  const classesOf = () => {
    const m = {};
    visible.forEach((it) => { const bk = it.key.slice(0, it.key.indexOf(":")); const cd = boards[bk] && boards[bk].cards.find((x) => x.id === it.key.slice(it.key.indexOf(":") + 1)); if (cd && cd.gclass) m[it.key] = cd.gclass; });
    return m;
  };
  const absUrl = (u) => (u && u.startsWith("/") ? window.location.origin + u : u);
  const ensureClasses = async () => {
    const have = classesOf();
    const todo = visible.filter((it) => !have[it.key]).map((it) => ({ key: it.key, url: absUrl(hiResSource(it)) }));
    if (!todo.length) return have;
    // Reference faces come from her own FTC tags — a solo (Kiabeth FTC) cover
    // and a solo (Kiaredza FTC) cover teach the model who is who.
    const refs = {};
    for (const it of visible) {
      const nm = it.name || "";
      if (!refs.kiabeth && /\(kiabeth\s+ftc\)/i.test(nm)) refs.kiabeth = absUrl(hiResSource(it));
      if (!refs.kiaredza && /\(kiaredza\s+ftc\)/i.test(nm)) refs.kiaredza = absUrl(hiResSource(it));
    }
    const r = await fetch("/api/data?op=grid_classify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: todo, refs }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "classification failed");
    const merged = { ...have, ...(d.classes || {}) };
    // persist onto the cards so re-runs are free
    if (onSaveBoards && d.classes && Object.keys(d.classes).length) {
      const next = { ...boards };
      for (const [key, cls] of Object.entries(d.classes)) {
        const bk = key.slice(0, key.indexOf(":")), cid = key.slice(key.indexOf(":") + 1);
        if (next[bk]) next[bk] = { ...next[bk], cards: next[bk].cards.map((cd) => (cd.id === cid ? { ...cd, gclass: cls } : cd)) };
      }
      onSaveBoards(next);
    }
    return merged;
  };

  // Arrange: art-director pass when classes are available (who's in
  // frame, tile kind, color family — plus the active reference-grid rhythm);
  // falls back to the original tone interleave if classification fails.
  const autoArrange = async () => {
    if (locked) return;
    setArranging(true); setMsg(null);
    try {
      const lockedSlots0 = new Set(visible.map((it, i) => (it.done || pins.includes(it.key) ? i : -1)).filter((i) => i >= 0));
      let classes = null;
      try { classes = await ensureClasses(); } catch (e) { setMsg("Vision pass unavailable (" + String(e.message || e).slice(0, 60) + ") — using tone arrangement."); }
      if (classes && Object.keys(classes).length >= Math.min(6, visible.length)) {
        const tpl = (((data || {})[gk] || {}).templates || []).find((t) => t.id === ((data || {})[gk] || {}).tplActive);
        const pos = arrangeByClasses(visible, lockedSlots0, classes, tpl ? tpl.pattern : null);
        const head = order.slice(0, windowStart);
        saveOrder([...head, ...pos.map((vi) => order[windowStart + vi])]);
        const nfaces = visible.filter((it) => (classes[it.key] || {}).k === "face").length;
        setMsg("Arranged editorially — " + nfaces + " face tiles separated, colors alternated" + (tpl ? ", following your reference grid “" + (tpl.name || "reference") + "”" : "") + (lockedSlots0.size ? "; " + lockedSlots0.size + " pinned/posted stayed put." : "."));
        setArranging(false);
        return;
      }
    } catch (e) { /* fall through to tone pass */ }
    try {
      const tones = await Promise.all(visible.map(async (it) => {
        try {
          const img = await loadImg(it.cover);
          return tone(img);
        } catch { return { l: 0.5 + Math.random() * 0.001, h: Math.random() }; }
      }));
      // RULE: posted (✓) tiles are locked in place — only unposted ones move.
      const lockedSlots = new Set(visible.map((it, i) => (it.done || pins.includes(it.key) ? i : -1)).filter((i) => i >= 0));
      const freeIdx = visible.map((_, i) => i).filter((i) => !lockedSlots.has(i)).sort((a, b) => tones[a].l - tones[b].l);
      const half = Math.ceil(freeIdx.length / 2);
      const darks = freeIdx.slice(0, half), lights = freeIdx.slice(half).reverse();
      const inter = [];
      for (let i = 0; i < half; i++) { if (lights[i] != null) inter.push(lights[i]); if (darks[i] != null) inter.push(darks[i]); }
      // weave arranged free tiles around the locked ones, slot by slot
      const pos = new Array(visible.length);
      let take = 0;
      for (let s = 0; s < visible.length; s++) pos[s] = lockedSlots.has(s) ? s : inter[take++];
      const freeSlots = pos.map((_, s) => s).filter((s) => !lockedSlots.has(s));
      // local polish: reduce neighbor similarity (luminance + hue) with swaps
      const near = (i) => { const out = []; const r = Math.floor(i / COLS), col = i % COLS; if (col > 0) out.push(i - 1); if (col < COLS - 1 && i + 1 < pos.length) out.push(i + 1); if (r > 0) out.push(i - COLS); if (i + COLS < pos.length) out.push(i + COLS); return out; };
      const cost = (i) => near(i).reduce((s, j) => { const a = tones[pos[i]], b = tones[pos[j]]; return s + Math.max(0, 0.35 - Math.abs(a.l - b.l)) + Math.max(0, 0.2 - hueDist(a.h, b.h)); }, 0);
      for (let pass = 0; pass < 400 && freeSlots.length > 1; pass++) {
        const i = freeSlots[Math.floor(Math.random() * freeSlots.length)], j = freeSlots[Math.floor(Math.random() * freeSlots.length)];
        if (i === j) continue;
        const before = cost(i) + cost(j);
        [pos[i], pos[j]] = [pos[j], pos[i]];
        if (cost(i) + cost(j) >= before) [pos[i], pos[j]] = [pos[j], pos[i]];
      }
      const head = order.slice(0, windowStart);
      saveOrder([...head, ...pos.map((vi) => order[windowStart + vi])]);
      setMsg(lockedSlots.size ? `Arranged for tonal balance — ${lockedSlots.size} posted tile${lockedSlots.size === 1 ? "" : "s"} stayed locked in place.` : "Arranged for tonal balance — drag anything you'd place differently.");
    } catch (e) { setMsg("Couldn't analyze the photos (" + String(e).slice(0, 60) + ")"); }
    setArranging(false);
  };

  // Render top row first; position 1 lives bottom-RIGHT (like a real IG grid —
  // the first-posted ends up bottom-right). Slot s sits at row floor(s/3) from
  // the bottom, filling right-to-left. Cells above the filled count stay empty.
  const cells = [];
  for (let rowFromTop = 0; rowFromTop < ROWS; rowFromTop++) {
    for (let col = 0; col < COLS; col++) {
      const slot = (ROWS - 1 - rowFromTop) * COLS + (COLS - 1 - col); // 0-based position
      cells.push({ slot, item: visible[slot] || null });
    }
  }
  const brand = BRANDS.find((b) => b.acct === acct);
  actionsRef.current = {
    openEditFor(key) {
      const z = zooms[key] || { s: 1.15, x: 0, y: 0 };
      setEditKey(key); setEditZoom(z); setEditMsg(null); setPickIdx(null);
      return z;
    },
    zoomScale(s) { setEditZoom((cur) => clampZoom({ ...cur, s: Math.max(1, Math.min(3, s)) })); },
  };

  // ── Touch drag (Plann-style). HTML5 dnd doesn't exist on touch, so: press a
  // tile ~a quarter second without moving → it lifts (vibrates), a ghost
  // follows the finger, the hovered slot highlights, release drops it there.
  // A quick swipe still scrolls the page; a quick tap still tap-to-moves.
  const endTouchDrag = (commit, x, y) => {
    const t = touchRef.current;
    if (!t) return;
    clearTimeout(t.timer);
    clearInterval(t.scroller);
    document.removeEventListener("touchmove", preventScroll);
    document.querySelectorAll(".lh-drag-ghost").forEach((g) => g.remove()); // sweep orphans too
    if (t.active) {
      suppressClickRef.current = Date.now();
      if (commit && t.over != null && t.over !== t.slot) moveItem(t.slot, Math.min(visible.length - 1, t.over));
      if (navigator.vibrate) navigator.vibrate(8);
    }
    touchRef.current = null;
    setDragIdx(null); setOverIdx(null);
  };
  const startAutoScroll = (t) => {
    if (t.scroller) return;
    t.scroller = setInterval(() => {
      if (!t.dy) return;
      window.scrollBy(0, t.dy);
      if (t.ghost && t.lastXY) { // re-hit-test under the (stationary) finger as content slides
        const el = document.elementFromPoint(t.lastXY[0], t.lastXY[1]);
        const cell = el && el.closest && el.closest("[data-slot]");
        t.over = cell ? parseInt(cell.getAttribute("data-slot"), 10) : t.over;
        setOverIdx(t.over);
      }
    }, 16);
  };
  const beginTouchDrag = (t) => {
    t.active = true;
    t.dy = 0;
    startAutoScroll(t);
    document.addEventListener("touchmove", preventScroll, { passive: false });
    if (navigator.vibrate) navigator.vibrate(12);
    const img = document.querySelector(`[data-slot="${t.slot}"] img`);
    document.querySelectorAll(".lh-drag-ghost").forEach((x) => x.remove());
    const g = document.createElement("div");
    g.className = "lh-drag-ghost";
    g.style.cssText = "position:fixed;z-index:9999;width:84px;aspect-ratio:3/4;pointer-events:none;box-shadow:0 12px 32px rgba(0,0,0,0.35);transform:translate(-50%,-60%) scale(1.05);border-radius:2px;overflow:hidden;opacity:0.92";
    if (img) { const gi = img.cloneNode(); gi.style.cssText = "width:100%;height:100%;object-fit:cover"; g.appendChild(gi); }
    g.style.left = t.x + "px"; g.style.top = t.y + "px";
    document.body.appendChild(g);
    t.ghost = g;
    setDragIdx(t.slot);
  };
  const onTilePointerDown = (e, slot) => {
    if (e.pointerType !== "touch") return; // mouse keeps native HTML5 drag
    const it = visible[slot];
    gPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, key: it ? it.key : null });
    // Second finger on the SAME photo → pinch-to-zoom right here: reframe mode
    // opens on the spot and the pinch drives the zoom immediately.
    const same = it ? [...gPointersRef.current.values()].filter((p) => p.key === it.key) : [];
    if (same.length >= 2) {
      if (touchRef.current) endTouchDrag(false);
      const z = actionsRef.current.openEditFor(it.key);
      gPinchRef.current = { key: it.key, d0: Math.max(20, Math.hypot(same[0].x - same[1].x, same[0].y - same[1].y)), s0: z.s };
      document.addEventListener("touchmove", preventScroll, { passive: false });
      return;
    }
    if (locked) return; // finalised grid — no lifting, but pinch-to-reframe above still works
    if (it && it.done) return; // posted tiles are pinned (but pinch-view above still allowed)
    if (touchRef.current) endTouchDrag(false); // clear any stale gesture first
    const t = { slot, x: e.clientX, y: e.clientY, active: false, over: null, ghost: null };
    t.timer = setTimeout(() => beginTouchDrag(t), 240);
    touchRef.current = t;
  };
  // Listeners bind ONCE; everything mutable flows through refs. (Re-binding
  // per render left micro-gaps where a drop event could slip through unheard —
  // orphaned ghosts stacked up on the tile and the scroll lock stuck.)
  const endRef = useRef(null);
  endRef.current = endTouchDrag;
  useEffect(() => {
    const move = (e) => {
      if (e.pointerType === "touch" && gPointersRef.current.has(e.pointerId)) {
        const gp = gPointersRef.current.get(e.pointerId);
        gPointersRef.current.set(e.pointerId, { ...gp, x: e.clientX, y: e.clientY });
        const pin = gPinchRef.current;
        if (pin) {
          const pts = [...gPointersRef.current.values()].filter((p) => p.key === pin.key);
          if (pts.length >= 2) {
            const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            actionsRef.current.zoomScale(pin.s0 * (d / pin.d0));
            return;
          }
        }
      }
      const t = touchRef.current;
      if (!t || e.pointerType !== "touch") return;
      if (!t.active) {
        if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 12) { clearTimeout(t.timer); touchRef.current = null; } // it's a scroll
        return;
      }
      if (t.ghost) { t.ghost.style.left = e.clientX + "px"; t.ghost.style.top = e.clientY + "px"; }
      t.lastXY = [e.clientX, e.clientY];
      const edge = 96, vh = window.innerHeight;
      t.dy = e.clientY < edge ? -Math.ceil((edge - e.clientY) / 6) : e.clientY > vh - edge ? Math.ceil((e.clientY - (vh - edge)) / 6) : 0;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el && el.closest && el.closest("[data-slot]");
      t.over = cell ? parseInt(cell.getAttribute("data-slot"), 10) : null;
      setOverIdx(t.over);
    };
    const releaseG = (e) => {
      gPointersRef.current.delete(e.pointerId);
      const pin = gPinchRef.current;
      if (pin && [...gPointersRef.current.values()].filter((p) => p.key === pin.key).length < 2) {
        gPinchRef.current = null;
        document.removeEventListener("touchmove", preventScroll);
      }
    };
    const up = (e) => { if (e.pointerType === "touch") { releaseG(e); if (endRef.current) endRef.current(true); } };
    const cancel = (e) => { if (e.pointerType === "touch") { releaseG(e); if (endRef.current) endRef.current(false); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); };
  }, []);

  const tapCell = (slot, hasItem) => {
    if (Date.now() - suppressClickRef.current < 400) return; // that click was the tail of a drag
    if (pickIdx == null) { if (hasItem && !(visible[slot] && visible[slot].done)) setPickIdx(slot); return; }
    if (pickIdx === slot) { setPickIdx(null); return; }
    moveItem(pickIdx, Math.min(visible.length - 1, slot));
    setPickIdx(null);
  };

  return (
    <div style={{ fontFamily: sans, maxWidth: 560, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        {BRANDS.map((b) => (
          <button key={b.acct} onClick={() => { setAcct(b.acct); setPlatform("ig"); setMsg(null); setPickIdx(null); setEditKey(null); }}
            style={{ border: `1px solid ${acct === b.acct ? c.ink : c.line}`, background: acct === b.acct ? c.ink : "transparent", color: acct === b.acct ? "#fff" : c.sub, borderRadius: 1, padding: "8px 14px", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>
            {b.label}
          </button>
        ))}
      </div>
      {acct === "lavallesisters" && (
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {[["ig", "Instagram grid"], ["tt", "TikTok grid"]].map(([k, lab]) => (
            <button key={k} onClick={() => { setPlatform(k); setMsg(null); setPickIdx(null); setEditKey(null); }}
              style={{ border: `1px solid ${platform === k ? c.taupe : c.line}`, background: platform === k ? c.taupe : "transparent", color: platform === k ? "#fff" : c.sub, borderRadius: 1, padding: "6px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>
              {lab}
            </button>
          ))}
        </div>
      )}
      {acct === "thefoldlabel" && genGrids.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub }}>Generated grids</span>
          <select value={genSel} onChange={(e) => setGenSel(e.target.value)}
            style={{ border: `1px solid ${c.line}`, background: "transparent", color: c.ink, borderRadius: 1, padding: "6px 10px", fontFamily: sans, fontSize: 10, letterSpacing: 1 }}>
            {genGrids.map((g) => <option key={g.fileId} value={g.fileId}>{g.month}</option>)}
          </select>
        </div>
      )}
      {acct === "lavallesisters" && sisGrids.archive.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub }}>Grids</span>
          <select value={sisSel} onChange={(e) => setSisSel(e.target.value)}
            style={{ border: `1px solid ${c.line}`, background: "transparent", color: c.ink, borderRadius: 1, padding: "6px 10px", fontFamily: sans, fontSize: 10, letterSpacing: 1 }}>
            {sisGrids.archive.map((g) => <option key={g.fileId} value={g.fileId}>{g.name.slice(0, 44)}</option>)}
          </select>
        </div>
      )}
      {acct === "lavallesisters" && sisSel && (
        <div style={{ marginBottom: 14 }}>
          <img src={"/api/data?op=drive_img&id=" + sisSel} alt="Sisters grid"
            style={{ width: "100%", maxWidth: 420, display: "block", border: `1px solid ${c.line}` }} />
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub, marginTop: 6 }}>
            Chronological — Post 1 bottom-right. Tiles with a taupe top strip are Courtney's Mon/Wed/Fri posts.
          </div>
        </div>
      )}
      {acct === "thefoldlabel" && genSel && (
        <div style={{ marginBottom: 14 }}>
          <img src={"/api/data?op=drive_img&id=" + genSel} alt="Generated grid"
            style={{ width: "100%", maxWidth: 420, display: "block", border: `1px solid ${c.line}` }} />
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub, marginTop: 6 }}>
            {genGrids.find((g) => g.fileId === genSel)?.month} — generated grid. Reads top-left to bottom-right; Post 1 is the bottom-right tile.
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.sub }}>
          {brand.handle}{acct === "lavallesisters" ? (tt ? " · TikTok" : " · Instagram") : ""} · {items.length} cover{items.length === 1 ? "" : "s"}{items.length > SLOTS ? ` · showing newest ${SLOTS}` : ""} · 1 starts bottom-right
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Finalised grids get locked so a second founder can't nudge the
              layout by accident — auto-arrange and dragging both go dead until
              someone deliberately unlocks it. */}
          <button onClick={setLocked}
            style={{ border: `1px solid ${locked ? c.green : c.line}`, background: locked ? c.green : "transparent", borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: locked ? "#fff" : c.sub, cursor: "pointer" }}>
            {locked ? "Grid locked" : "Lock grid"}
          </button>
          <button onClick={autoArrange} disabled={locked || arranging || visible.length < 4}
            title={locked ? "Unlock the grid to re-arrange it" : ""}
            style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, cursor: locked ? "not-allowed" : "pointer", opacity: locked || arranging || visible.length < 4 ? 0.4 : 1 }}>
            {arranging ? "Arranging…" : "Arrange"}
          </button>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <label style={{ border: `1px dashed ${c.line}`, background: "transparent", borderRadius: 1, padding: "6px 10px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>
          Add photos to grid
          <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files && e.target.files.length) uploadToGrid(e.target.files); e.target.value = ""; }} />
        </label>
        <label style={{ border: `1px dashed ${c.line}`, background: "transparent", borderRadius: 1, padding: "6px 10px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: tplBusy ? c.taupe : c.sub, cursor: "pointer" }}>
          {tplBusy ? "Reading reference…" : "◫ Reference grid"}
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) addTemplate(f); e.target.value = ""; }} />
        </label>
        {templates.map((t) => (
          <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <button onClick={() => setTplActive(t.id)} title={t.logic || ""}
              style={{ border: `1px solid ${gridCfg.tplActive === t.id ? c.taupe : c.line}`, background: gridCfg.tplActive === t.id ? c.taupe : "transparent", color: gridCfg.tplActive === t.id ? "#fff" : c.sub, borderRadius: 1, padding: "6px 10px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer" }}>{t.name}</button>
            <button onClick={() => removeTemplate(t.id)} style={{ border: "none", background: "transparent", color: c.line, cursor: "pointer", fontSize: 12, padding: 0 }}>×</button>
          </span>
        ))}
      </div>
      {locked && (
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11.5, color: c.green, marginBottom: 10 }}>
          This grid is finalised — tiles can't be dragged or re-arranged. Tap “Grid locked” to open it back up.
        </div>
      )}
      {pickIdx != null && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.ink }}>Post {windowStart + pickIdx + 1} — tap the spot it should take, or:</div>
          <button onClick={() => { const it = visible[pickIdx]; if (it) { setEditKey(it.key); setEditZoom(zooms[it.key] || { s: 1.3, x: 0, y: 0 }); setEditMsg(null); } setPickIdx(null); }}
            style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "5px 10px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.ink, cursor: "pointer" }}>Reframe</button>
          {tt && (
            <label style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "5px 10px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.ink, cursor: "pointer" }}>
              Different TikTok cover
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; const it = visible[pickIdx]; if (f && it) uploadTikTokCover(f, it); setPickIdx(null); }} />
            </label>
          )}
        </div>
      )}
      {msg && !arranging && pickIdx == null && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.taupe, marginBottom: 8 }}>{msg}</div>}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 3, background: c.bg }}>
        {cells.map(({ slot, item }) => item ? (
          <div key={item.key} draggable={!locked && editKey !== item.key} data-slot={slot}
            onPointerDown={(e) => {
              if (editKey === item.key) {
                e.preventDefault(); e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                pinchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                if (pinchRef.current.size === 2) {
                  const [p1, p2] = [...pinchRef.current.values()];
                  panRef.current = { pinch: true, d0: Math.hypot(p1.x - p2.x, p1.y - p2.y), s0: editZoom.s, w: r.width, h: r.height, zx: editZoom.x, zy: editZoom.y };
                } else {
                  panRef.current = { x: e.clientX, y: e.clientY, w: r.width, h: r.height, zx: editZoom.x, zy: editZoom.y };
                }
                e.currentTarget.setPointerCapture(e.pointerId);
                return;
              }
              onTilePointerDown(e, slot);
            }}
            onPointerMove={(e) => {
              const p = panRef.current;
              if (editKey !== item.key || !p) return;
              e.preventDefault();
              if (pinchRef.current.has(e.pointerId)) pinchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              if (p.pinch) {
                if (pinchRef.current.size < 2) return;
                const [p1, p2] = [...pinchRef.current.values()];
                const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                setEditZoom((cur) => clampZoom({ ...cur, s: Math.max(1, Math.min(3, p.s0 * (d / p.d0))) }));
              } else {
                setEditZoom((cur) => clampZoom({ ...cur, x: p.zx + ((e.clientX - p.x) / p.w) * 100, y: p.zy + ((e.clientY - p.y) / p.h) * 100 }));
              }
            }}
            onPointerUp={(e) => { if (editKey === item.key) { pinchRef.current.delete(e.pointerId); if (pinchRef.current.size === 0) panRef.current = null; else if (pinchRef.current.size === 1 && panRef.current && panRef.current.pinch) { const [p1] = [...pinchRef.current.values()]; panRef.current = { x: p1.x, y: p1.y, w: panRef.current.w, h: panRef.current.h, zx: editZoom.x, zy: editZoom.y }; } } }}
            onPointerCancel={(e) => { if (editKey === item.key) { pinchRef.current.delete(e.pointerId); if (pinchRef.current.size === 0) panRef.current = null; } }}
            onDragStart={() => setDragIdx(slot)}
            onDragOver={(e) => { e.preventDefault(); setOverIdx(slot); }}
            onDragLeave={() => setOverIdx((v) => (v === slot ? null : v))}
            onDrop={(e) => { e.preventDefault(); if (dragIdx != null) moveItem(dragIdx, slot); setDragIdx(null); setOverIdx(null); }}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
            onClick={() => { if (editKey !== item.key) tapCell(slot, true); }}
            title={item.name + (item.boardName ? " · " + item.boardName : "")}
            style={{ position: "relative", aspectRatio: "3 / 4", overflow: "hidden", cursor: editKey === item.key ? "move" : "grab", touchAction: editKey === item.key ? "none" : "pan-y", zIndex: editKey === item.key ? 5 : "auto", boxShadow: editKey === item.key ? `0 0 0 3px ${c.ink}` : "none", WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none", outline: pickIdx === slot ? `3px solid ${c.ink}` : overIdx === slot && dragIdx !== slot ? `2px solid ${c.taupe}` : "none", outlineOffset: pickIdx === slot ? -3 : 0, opacity: dragIdx === slot ? 0.4 : pickIdx != null && pickIdx !== slot ? 0.82 : 1 }}>
            <img src={item.cover} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none", transform: (editKey === item.key ? `translate(${editZoom.x}%, ${editZoom.y}%) scale(${editZoom.s})` : zooms[item.key] ? `translate(${zooms[item.key].x}%, ${zooms[item.key].y}%) scale(${zooms[item.key].s})` : "none") }} />
            <div style={{ position: "absolute", left: 4, bottom: 4, background: "rgba(0,0,0,0.55)", color: "#fff", fontFamily: sans, fontSize: 9, letterSpacing: 1, padding: "2px 6px", borderRadius: 1 }}>{windowStart + slot + 1}</div>
            {tt && !item.hasTT && <div style={{ position: "absolute", left: 4, top: 4, background: "rgba(0,0,0,0.4)", color: "#fff", fontFamily: sans, fontSize: 8, letterSpacing: 1, padding: "1px 5px", borderRadius: 1 }}>IG cover</div>}
            {item.done && <div style={{ position: "absolute", right: 4, top: 4, background: c.green, color: "#fff", fontSize: 10, width: 16, height: 16, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</div>}
            {!item.done && pins.includes(item.key) && <div title="Pinned — auto-arrange keeps this placement" style={{ position: "absolute", right: 4, top: 4, background: c.taupe, color: "#fff", fontSize: 9, width: 16, height: 16, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>●</div>}
          </div>
        ) : (
          <div key={"empty" + slot} data-slot={slot}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (dragIdx != null) moveItem(dragIdx, Math.min(visible.length - 1, slot)); setDragIdx(null); setOverIdx(null); }}
            onClick={() => tapCell(slot, false)}
            style={{ aspectRatio: "3 / 4", border: `1px dashed ${c.line}`, cursor: pickIdx != null ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", color: c.line, fontFamily: sans, fontSize: 10 }}>
            {slot + windowStart + 1 <= items.length + SLOTS ? slot + 1 : ""}
          </div>
        ))}
      </div>
      <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub, marginTop: 10 }}>
        Covers land here the moment they're added to a card on a {brand.label} board. Press and hold a photo to drag it. Pinch a photo with two fingers to zoom it in place. Tap a photo to move it by tapping its new spot. ✓ posted tiles hold positions 1, 2, 3… in their real posted order and never move.
      </div>
      {editKey && candidates[editKey] && (() => {
        const item = candidates[editKey];
        const barBtn = { border: `1px solid ${c.line}`, background: "#fff", borderRadius: 1, padding: "8px 10px", fontFamily: sans, fontSize: 9, letterSpacing: 1.2, textTransform: "uppercase", color: c.ink, cursor: "pointer" };
        const doExport = async (mode) => {
          setEditMsg("Rendering…");
          try {
            const soft = isLowResPreview(hiResSource(item));
            const cv = await renderCoverCrop(item, editZoom, mode === "download" ? 2160 : 1080);
            if (mode === "download") {
              const a = document.createElement("a");
              a.href = cv.toDataURL("image/png");
              a.download = (item.name || "cover").replace(/[^\w\s-]/g, "").trim().slice(0, 40) + " — zoomed cover.png";
              a.click();
              setEditMsg(soft
                ? "Downloaded — but this card only has the small board preview, so it's soft. Link the full-size photo from Drive on the card for a sharp file."
                : "Downloaded at full resolution from Drive — good to repost on TikTok.");
            } else {
              const dataUrl = cv.toDataURL("image/jpeg", 0.88);
              const bk = editKey.slice(0, editKey.indexOf(":")), cardId = editKey.slice(editKey.indexOf(":") + 1);
              if (onSaveBoards && boards && boards[bk]) onSaveBoards({ ...boards, [bk]: { ...boards[bk], cards: boards[bk].cards.map((cd) => (cd.id === cardId ? { ...cd, [tt ? "tiktokCover" : "cover"]: dataUrl } : cd)) } });
              saveZoom(editKey, null); // the crop IS the cover now
              setEditKey(null);
            }
          } catch { setEditMsg("Couldn't export this image — Save zoom still displays it reframed."); }
        };
        return (
          <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 120, background: "#fff", borderTop: `1px solid ${c.line}`, boxShadow: "0 -8px 30px rgba(0,0,0,0.12)", padding: "10px 14px calc(10px + env(safe-area-inset-bottom))" }}>
            <div style={{ maxWidth: 560, margin: "0 auto" }}>
              <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 6 }}>
                Reframing post {(() => { const i = visible.findIndex((v) => v.key === editKey); return i >= 0 ? windowStart + i + 1 : ""; })()} — pinch or slide to zoom · drag to position
              </div>
              <input type="range" min={100} max={300} value={Math.round(editZoom.s * 100)}
                onChange={(e) => setEditZoom((cur) => clampZoom({ ...cur, s: parseInt(e.target.value, 10) / 100 }))}
                style={{ width: "100%", margin: "2px 0 8px" }} />
              {editMsg && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.taupe, marginBottom: 6 }}>{editMsg}</div>}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button style={{ ...barBtn, background: c.ink, color: "#fff", borderColor: c.ink }} onClick={() => { saveZoom(editKey, clampZoom(editZoom)); setEditKey(null); }}>Save</button>
                <button style={barBtn} onClick={() => { saveZoom(editKey, null); setEditKey(null); }}>Reset</button>
                <button style={barBtn} onClick={() => setEditKey(null)}>Cancel</button>
                <button style={barBtn} onClick={() => doExport("download")}>Download</button>
                <button style={barBtn} onClick={() => doExport("cover")}>{tt ? "Set as TikTok cover" : "Set as cover"}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// Keep the visible area covering the tile at any zoom.
function clampZoom(zz) {
  const lim = ((zz.s - 1) / 2 / zz.s) * 100 * zz.s;
  return { s: zz.s, x: Math.max(-lim, Math.min(lim, zz.x)), y: Math.max(-lim, Math.min(lim, zz.y)) };
}
// Render the currently-framed area to a 1080×1440 canvas. Drive-hosted covers
// are proxied through our own domain so the canvas stays export-clean.
// Grid tiles render the small /boards-media preview on purpose — streaming 21
// full-size Drive files would eat the bandwidth budget. But a DOWNLOAD (she
// reposts these by hand on TikTok) and a set-as-cover crop must come from the
// original file, or she gets a 300px thumbnail blown up to 1080.
function driveIdFrom(s) {
  if (typeof s !== "string" || s.startsWith("data:") || s.includes("/folders/")) return null;
  if (s.includes("op=media") || s.includes("/cover/")) return null; // media-store id, not a Drive id
  const m = s.match(/[?&]id=([-\w]{20,})/) || s.match(/\/d\/([-\w]{20,})/)
    || (s.includes("drive.google.com") ? s.match(/([-\w]{25,})/) : null);
  return m ? m[1] : null;
}
// NOTE: never fall back to assetUrl here — on a [reel] card that's the .mov,
// and pointing an <img> at a video is what broke cover downloads outright.
export function hiResSource(item) {
  const id = driveIdFrom(item.cover) || driveIdFrom(item.coverUrl);
  return id ? "/api/data?op=drive_img&id=" + id : item.cover;
}
export const isLowResPreview = (u) => typeof u === "string" && u.includes("/boards-media/");

// maxW caps the exported width. Downloads go up to 2160 so a manual TikTok
// repost keeps the original's detail; set-as-cover stays at 1080 because that
// JPEG is stored inline in the board blob and bandwidth is metered.
function renderCoverCrop(item, z, maxW = 1080) {
  const src = typeof item === "string" ? item : hiResSource(item);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const FW = 1080, FH = 1440;
        const b = Math.max(FW / img.naturalWidth, FH / img.naturalHeight);
        const total = b * z.s;
        const sw = FW / total, sh = FH / total;
        const sx = img.naturalWidth / 2 - ((z.x / 100) * FW) / total - sw / 2;
        const sy = img.naturalHeight / 2 - ((z.y / 100) * FH) / total - sh / 2;
        // Frame the crop off the 1080×1440 geometry, then export at whatever
        // the source actually supports — never upscaling past its own pixels.
        const OW = Math.max(FW, Math.min(maxW, Math.round(sw)));
        const OH = Math.round((OW * FH) / FW);
        const cv = document.createElement("canvas");
        cv.width = OW; cv.height = OH;
        const ctx = cv.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OW, OH);
        resolve(cv);
      } catch (e) { reject(e); }
    };
    // If the Drive original won't load (permissions, or it isn't an image after
    // all), fall back to the cover the grid is already showing rather than
    // failing the download outright.
    let triedFallback = false;
    img.onerror = () => {
      const fb = typeof item === "string" ? null : item.cover;
      if (!triedFallback && fb && fb !== src) { triedFallback = true; img.src = fb; return; }
      reject(new Error("image load failed"));
    };
    img.src = src;
  });
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
// Average luminance + rough hue from an 8×8 downsample.
function tone(img) {
  const cv = document.createElement("canvas");
  cv.width = 8; cv.height = 8;
  const ctx = cv.getContext("2d");
  ctx.drawImage(img, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  let l = 0, rs = 0, gs = 0, bs = 0;
  for (let i = 0; i < d.length; i += 4) { l += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; rs += d[i]; gs += d[i + 1]; bs += d[i + 2]; }
  const n = d.length / 4;
  return { l: l / n / 255, h: rgbHue(rs / n, gs / n, bs / n) };
}
function rgbHue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  let h = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn);
  h /= 6; return h < 0 ? h + 1 : h;
}
const hueDist = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 1 - d); };
