import { useEffect, useMemo, useRef, useState } from "react";

// LAVALLE HAUS OS — Brand Grids (Content → Grids)
// Plann-style 21-slot planning grid per brand account. The moment a card on a
// brand board gets a cover photo it appears in that brand's grid — position 1
// at the BOTTOM-LEFT, new covers stacking upward (7 rows × 3). Drag tiles to
// hand-arrange; ✨ Auto-arrange orders by tone so neighbors alternate
// light/dark and similar shots don't clump.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", green: "#5a7a5a" };
const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";
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

export default function BrandGrids({ boards, data, onSave }) {
  const [acct, setAcct] = useState(BRANDS[0].acct);
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const [pickIdx, setPickIdx] = useState(null); // tap-to-move still works as a fallback
  const touchRef = useRef(null); // real finger-drag: long-press lifts the tile, ghost follows the finger
  const suppressClickRef = useRef(0);
  const [arranging, setArranging] = useState(false);
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
      for (const card of board.cards) {
        if (!card.cover || !schedLists.has(card.listId)) continue;
        map[bk + ":" + card.id] = { key: bk + ":" + card.id, cover: card.cover, name: card.name || "", done: !!card.done, boardName: board.name || "" };
      }
    }
    return map;
  }, [boards, acct]);

  // Saved order merged with reality: dead refs drop out, new covers append
  // (append = next slot up — position 1 stays the earliest planned post).
  const order = useMemo(() => {
    const saved = ((data || {})[acct] || {}).order || [];
    const kept = saved.filter((k) => candidates[k]);
    const known = new Set(kept);
    const fresh = Object.keys(candidates).filter((k) => !known.has(k));
    return [...kept, ...fresh];
  }, [data, acct, candidates]);

  // Auto-ingest persists the merged order the moment it differs from what's saved.
  useEffect(() => {
    const j = acct + "|" + JSON.stringify(order);
    if (savedRef.current === j) return;
    const saved = ((data || {})[acct] || {}).order || [];
    if (JSON.stringify(saved) !== JSON.stringify(order)) {
      savedRef.current = j;
      onSave({ ...(data || {}), [acct]: { ...((data || {})[acct] || {}), order } });
    } else savedRef.current = j;
  }, [order, acct]); // eslint-disable-line

  const items = order.map((k) => candidates[k]).filter(Boolean);
  const windowStart = Math.max(0, items.length - SLOTS);
  const visible = items.slice(windowStart); // newest 21 — older ones have shipped

  const saveOrder = (next) => onSave({ ...(data || {}), [acct]: { ...((data || {})[acct] || {}), order: next } });

  const moveItem = (fromVis, toVis) => {
    if (fromVis === toVis) return;
    const next = [...order];
    const [x] = next.splice(windowStart + fromVis, 1);
    next.splice(windowStart + toVis, 0, x);
    saveOrder(next);
  };

  // ✨ Auto-arrange: sample each cover's tone (tiny canvas), then interleave
  // light/dark and polish with swap passes so grid neighbors contrast.
  const autoArrange = async () => {
    setArranging(true); setMsg(null);
    try {
      const tones = await Promise.all(visible.map(async (it) => {
        try {
          const img = await loadImg(it.cover);
          return tone(img);
        } catch { return { l: 0.5 + Math.random() * 0.001, h: Math.random() }; }
      }));
      let idx = visible.map((_, i) => i).sort((a, b) => tones[a].l - tones[b].l);
      const half = Math.ceil(idx.length / 2);
      const darks = idx.slice(0, half), lights = idx.slice(half).reverse();
      const inter = [];
      for (let i = 0; i < half; i++) { if (lights[i] != null) inter.push(lights[i]); if (darks[i] != null) inter.push(darks[i]); }
      // local polish: reduce neighbor similarity (luminance + hue) with swaps
      const pos = inter.slice();
      const near = (i) => { const out = []; const r = Math.floor(i / COLS), col = i % COLS; if (col > 0) out.push(i - 1); if (col < COLS - 1 && i + 1 < pos.length) out.push(i + 1); if (r > 0) out.push(i - COLS); if (i + COLS < pos.length) out.push(i + COLS); return out; };
      const cost = (i) => near(i).reduce((s, j) => { const a = tones[pos[i]], b = tones[pos[j]]; return s + Math.max(0, 0.35 - Math.abs(a.l - b.l)) + Math.max(0, 0.2 - hueDist(a.h, b.h)); }, 0);
      for (let pass = 0; pass < 400; pass++) {
        const i = Math.floor(Math.random() * pos.length), j = Math.floor(Math.random() * pos.length);
        if (i === j) continue;
        const before = cost(i) + cost(j);
        [pos[i], pos[j]] = [pos[j], pos[i]];
        if (cost(i) + cost(j) >= before) [pos[i], pos[j]] = [pos[j], pos[i]];
      }
      const head = order.slice(0, windowStart);
      saveOrder([...head, ...pos.map((vi) => order[windowStart + vi])]);
      setMsg("Arranged for tonal balance — drag anything you'd place differently.");
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

  // ── Touch drag (Plann-style). HTML5 dnd doesn't exist on touch, so: press a
  // tile ~a quarter second without moving → it lifts (vibrates), a ghost
  // follows the finger, the hovered slot highlights, release drops it there.
  // A quick swipe still scrolls the page; a quick tap still tap-to-moves.
  const preventScroll = (e) => e.preventDefault();
  const endTouchDrag = (commit, x, y) => {
    const t = touchRef.current;
    if (!t) return;
    clearTimeout(t.timer);
    clearInterval(t.scroller);
    document.removeEventListener("touchmove", preventScroll);
    if (t.ghost) t.ghost.remove();
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
    const g = document.createElement("div");
    g.style.cssText = "position:fixed;z-index:9999;width:84px;aspect-ratio:3/4;pointer-events:none;box-shadow:0 12px 32px rgba(0,0,0,0.35);transform:translate(-50%,-60%) scale(1.05);border-radius:2px;overflow:hidden;opacity:0.92";
    if (img) { const gi = img.cloneNode(); gi.style.cssText = "width:100%;height:100%;object-fit:cover"; g.appendChild(gi); }
    g.style.left = t.x + "px"; g.style.top = t.y + "px";
    document.body.appendChild(g);
    t.ghost = g;
    setDragIdx(t.slot);
  };
  const onTilePointerDown = (e, slot) => {
    if (e.pointerType !== "touch") return; // mouse keeps native HTML5 drag
    const t = { slot, x: e.clientX, y: e.clientY, active: false, over: null, ghost: null };
    t.timer = setTimeout(() => beginTouchDrag(t), 240);
    touchRef.current = t;
  };
  useEffect(() => {
    const move = (e) => {
      const t = touchRef.current;
      if (!t || e.pointerType !== "touch") return;
      if (!t.active) {
        if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 12) { clearTimeout(t.timer); touchRef.current = null; } // it's a scroll
        return;
      }
      t.ghost.style.left = e.clientX + "px"; t.ghost.style.top = e.clientY + "px";
      t.lastXY = [e.clientX, e.clientY];
      const edge = 96, vh = window.innerHeight;
      t.dy = e.clientY < edge ? -Math.ceil((edge - e.clientY) / 6) : e.clientY > vh - edge ? Math.ceil((e.clientY - (vh - edge)) / 6) : 0;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cell = el && el.closest && el.closest("[data-slot]");
      t.over = cell ? parseInt(cell.getAttribute("data-slot"), 10) : null;
      setOverIdx(t.over);
    };
    const up = (e) => { if (e.pointerType === "touch") endTouchDrag(true); };
    const cancel = (e) => { if (e.pointerType === "touch") endTouchDrag(false); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    // cleanup only unbinds — the drag itself lives in touchRef and must
    // survive the re-renders that setDragIdx/setOverIdx trigger mid-gesture
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); };
  }); // re-binds each render so moveItem sees fresh order

  const tapCell = (slot, hasItem) => {
    if (Date.now() - suppressClickRef.current < 400) return; // that click was the tail of a drag
    if (pickIdx == null) { if (hasItem) setPickIdx(slot); return; }
    if (pickIdx === slot) { setPickIdx(null); return; }
    moveItem(pickIdx, Math.min(visible.length - 1, slot));
    setPickIdx(null);
  };

  return (
    <div style={{ fontFamily: sans, maxWidth: 560, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        {BRANDS.map((b) => (
          <button key={b.acct} onClick={() => { setAcct(b.acct); setMsg(null); setPickIdx(null); }}
            style={{ border: `1px solid ${acct === b.acct ? c.ink : c.line}`, background: acct === b.acct ? c.ink : "transparent", color: acct === b.acct ? "#fff" : c.sub, borderRadius: 1, padding: "8px 14px", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>
            {b.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.sub }}>
          {brand.handle} · {items.length} cover{items.length === 1 ? "" : "s"}{items.length > SLOTS ? ` · showing newest ${SLOTS}` : ""} · 1 starts bottom-right
        </div>
        <button onClick={autoArrange} disabled={arranging || visible.length < 4}
          style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, cursor: "pointer", opacity: arranging || visible.length < 4 ? 0.5 : 1 }}>
          {arranging ? "Arranging…" : "✨ Auto-arrange"}
        </button>
      </div>
      {pickIdx != null && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.ink, marginBottom: 8 }}>Moving post {windowStart + pickIdx + 1} — tap the spot it should take (tap it again to cancel).</div>}
      {msg && !arranging && pickIdx == null && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.taupe, marginBottom: 8 }}>{msg}</div>}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 3, background: c.bg }}>
        {cells.map(({ slot, item }) => item ? (
          <div key={item.key} draggable data-slot={slot}
            onPointerDown={(e) => onTilePointerDown(e, slot)}
            onDragStart={() => setDragIdx(slot)}
            onDragOver={(e) => { e.preventDefault(); setOverIdx(slot); }}
            onDragLeave={() => setOverIdx((v) => (v === slot ? null : v))}
            onDrop={(e) => { e.preventDefault(); if (dragIdx != null) moveItem(dragIdx, slot); setDragIdx(null); setOverIdx(null); }}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
            onClick={() => tapCell(slot, true)}
            title={item.name + (item.boardName ? " · " + item.boardName : "")}
            style={{ position: "relative", aspectRatio: "3 / 4", overflow: "hidden", cursor: "grab", touchAction: "pan-y", WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none", outline: pickIdx === slot ? `3px solid ${c.ink}` : overIdx === slot && dragIdx !== slot ? `2px solid ${c.taupe}` : "none", outlineOffset: pickIdx === slot ? -3 : 0, opacity: dragIdx === slot ? 0.4 : pickIdx != null && pickIdx !== slot ? 0.82 : 1 }}>
            <img src={item.cover} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            <div style={{ position: "absolute", left: 4, bottom: 4, background: "rgba(0,0,0,0.55)", color: "#fff", fontFamily: sans, fontSize: 9, letterSpacing: 1, padding: "2px 6px", borderRadius: 1 }}>{windowStart + slot + 1}</div>
            {item.done && <div style={{ position: "absolute", right: 4, top: 4, background: c.green, color: "#fff", fontSize: 10, width: 16, height: 16, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</div>}
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
        Covers land here the moment they're added to a card on a {brand.label} board. Press and hold a photo, then drag it where it goes (or tap it, then tap the target spot). ✓ means posted.
      </div>
    </div>
  );
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
