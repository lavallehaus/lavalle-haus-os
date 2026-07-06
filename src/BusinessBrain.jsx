import { useEffect, useMemo, useRef, useState } from "react";
import { ASK_SUGGESTIONS } from "./businessBrain.js";

// LAVALLE HAUS OS — Business Brain landing page
// A quiet-luxury visual map of the business: Business Health at the center,
// the departments breathing around it, insights on the right, Ask Chief below.
// The standard dashboard stays one click away — this is a navigation layer,
// not a replacement.

const serif = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";

// ── Day / Night themes ───────────────────────────────────────────────────────
export const BRAIN_THEMES = {
  day: {
    id: "day", bg: "#FFFFFF", card: "#F4F4F3", ink: "#1A1A1A", sub: "#71716C",
    line: "#E0E0DD", accent: "#8F8676", brass: "#A39B8B", green: "#5a7a5a", red: "#9b5e5e",
    canvas: "radial-gradient(ellipse at 50% 38%, #FAFAF9 0%, #FFFFFF 62%, #F2F2F0 100%)",
    nodeBg: "#FFFFFF", nodeBorder: "#E3E3E0", link: "#DEDEDA", halo: "rgba(163,155,139,0.14)",
    nodeFill: "radial-gradient(circle at 32% 26%, #FFFFFF 0%, #FBFBFA 55%, #F0F0ED 100%)",
    coreFill: "radial-gradient(circle at 36% 28%, #FFFFFF 0%, #F8F8F6 58%, #ECECE8 100%)",
    nodeShadow: "0 1px 2px rgba(26,26,26,0.05), 0 16px 36px rgba(26,26,26,0.10), inset 0 1px 0 rgba(255,255,255,0.9)",
    coreShadow: "0 2px 4px rgba(26,26,26,0.05), 0 28px 64px rgba(26,26,26,0.13), inset 0 1.5px 0 rgba(255,255,255,0.95)",
    ring: "rgba(143,134,118,0.28)", impulse: "#9C8F79", coreGlow: "rgba(163,155,139,0.16)",
  },
  night: {
    id: "night", bg: "#1d1712", card: "#2b2219", ink: "#F0E8DC", sub: "#A8977F",
    line: "#463829", accent: "#C9AE82", brass: "#C9AE82", green: "#8fae8f", red: "#c88f83",
    canvas: "radial-gradient(ellipse at 50% 34%, #2e251c 0%, #211a14 55%, #14100b 100%)",
    nodeBg: "#2b2219", nodeBorder: "rgba(201,174,130,0.28)", link: "rgba(201,174,130,0.20)", halo: "rgba(201,174,130,0.16)",
    nodeFill: "radial-gradient(circle at 32% 26%, #3a2e22 0%, #2c231a 58%, #241c14 100%)",
    coreFill: "radial-gradient(circle at 36% 28%, #403325 0%, #2e251b 58%, #221a12 100%)",
    nodeShadow: "0 22px 52px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,244,224,0.07)",
    coreShadow: "0 34px 80px rgba(0,0,0,0.62), inset 0 1.5px 0 rgba(255,244,224,0.09)",
    ring: "rgba(201,174,130,0.16)", impulse: "#E2C89A", coreGlow: "rgba(201,174,130,0.22)",
  },
};

export function timeGreeting(name) {
  const h = new Date().getHours();
  const word = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return word + ", " + name + ".";
}

const STATUS_TONE = (t) => (s) => s === "improving" ? t.green : s === "declining" ? t.red : t.sub;

// Motion is injected once; every animation respects prefers-reduced-motion.
const MOTION_CSS = `
@keyframes bbBreathe { 0%,100% { box-shadow: 0 0 0 0 var(--bb-halo), 0 8px 30px rgba(0,0,0,0.08); } 50% { box-shadow: 0 0 0 18px transparent, 0 8px 30px rgba(0,0,0,0.08); } }
@keyframes bbRipple { 0% { transform: translate(-50%,-50%) scale(1); opacity: 0.45; } 100% { transform: translate(-50%,-50%) scale(1.45); opacity: 0; } }
@keyframes bbTwinkle { 0%,100% { opacity: 0.12; } 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) {
  .bb-node, .bb-center, .bb-ripple, .bb-syn { animation: none !important; }
}
.bb-node { transition: box-shadow 0.45s ease, border-color 0.45s ease; will-change: transform; }
.bb-node:hover { z-index: 5; }
.bb-node, .bb-center { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
`;

function useMotionCss() {
  useEffect(() => {
    if (document.getElementById("bb-motion")) return;
    const el = document.createElement("style");
    el.id = "bb-motion";
    el.textContent = MOTION_CSS;
    document.head.appendChild(el);
  }, []);
}

// ── Shared canvas (used by the landing page and Command View) ────────────────
// A living neural map: nodes drift organically, curved synapse lines carry
// electrical impulses into the Business Health core, the core ripples like a
// heartbeat, and the whole field leans gently toward the cursor. All motion is
// driven by one requestAnimationFrame loop that writes straight to the DOM
// (no re-renders), and prefers-reduced-motion freezes everything.
export function BrainCanvas({ model, theme: t, scale = 1, selectedId, onSelect, height = 520, pannable = false }) {
  useMotionCss();
  const wrapRef = useRef(null);
  const fieldRef = useRef(null);
  const [w, setW] = useState(900);
  const [transformed, setTransformed] = useState(false);
  const viewRef = useRef({ x: 0, y: 0, z: 1 });
  const movedRef = useRef(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => { for (const e of es) setW(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Touch: one-finger drag pans, two-finger pinch zooms, tap still selects ──
  // (Command View spec: tap to expand · swipe/drag to pan · pinch to zoom.)
  const applyView = () => {
    const v = viewRef.current;
    if (fieldRef.current) fieldRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    setTransformed(Math.abs(v.x) > 2 || Math.abs(v.y) > 2 || Math.abs(v.z - 1) > 0.02);
  };
  const resetView = () => { viewRef.current = { x: 0, y: 0, z: 1 }; applyView(); };
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => {
    if (!pannable) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const pointers = new Map();
    let start = null;   // one-finger drag origin {x, y, vx, vy}
    let pinch = null;   // two-finger base {d, z, mx, my, vx, vy}
    let lastTap = 0;
    let tapTarget = null; // node/center the gesture started on — taps select it directly
    const clampView = (v) => {
      v.z = Math.min(2.4, Math.max(0.6, v.z));
      const lim = Math.max(wrap.clientWidth, wrap.clientHeight) * 0.6 * v.z;
      v.x = Math.min(lim, Math.max(-lim, v.x));
      v.y = Math.min(lim, Math.max(-lim, v.y));
      return v;
    };
    const down = (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const v = viewRef.current;
      if (pointers.size === 1) {
        start = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y };
        tapTarget = e.target && e.target.closest ? e.target.closest("[data-bb-id]") : null;
      }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: v.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, vx: v.x, vy: v.y };
        start = null;
      }
    };
    const move = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1 && start) {
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (Math.hypot(dx, dy) > (e.pointerType === "touch" ? 16 : 8)) movedRef.current = true;
        if (movedRef.current) {
          viewRef.current = clampView({ ...viewRef.current, x: start.vx + dx, y: start.vy + dy });
          applyView();
        }
      } else if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        movedRef.current = true;
        viewRef.current = clampView({ z: pinch.z * (d / Math.max(1, pinch.d)), x: pinch.vx + (mx - pinch.mx), y: pinch.vy + (my - pinch.my) });
        applyView();
      }
    };
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        if (!movedRef.current) {
          const now = Date.now();
          if (now - lastTap < 320 && !tapTarget) resetView(); // double-tap on empty space returns home
          lastTap = now;
          // a clean tap on a node selects it directly — no reliance on the
          // browser synthesizing a click while the node is drifting
          if (tapTarget && onSelectRef.current) {
            onSelectRef.current(tapTarget.getAttribute("data-bb-id"));
            movedRef.current = true; // swallow the native click that may follow
          }
        }
        start = null;
        tapTarget = null;
        setTimeout(() => { movedRef.current = false; }, 120);
      }
    };
    wrap.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      wrap.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [pannable]);

  const H = height;
  const cx = w / 2, cy = H / 2;
  const rx = Math.min(w * 0.38, 430 * scale), ry = Math.min(H * 0.36, 250 * scale);
  const N = model.nodes.length;
  const pos = model.nodes.map((n, i) => {
    const a = (Math.PI * 2 * i) / N - Math.PI / 2;
    return { n, x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
  const toneOf = STATUS_TONE(t);
  const centerR = 92 * scale;

  // live-motion refs — the rAF loop writes to these DOM nodes directly
  const nodeRefs = useRef([]);
  const pathRefs = useRef([]);
  const impRefs = useRef([]);
  const hoverRef = useRef(-1);
  const selRef = useRef(null);
  useEffect(() => { selRef.current = selectedId; }, [selectedId]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !N) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // per-node motion signature: two incommensurate sine pairs = organic wander
    const sig = pos.map((_, i) => ({
      p1: i * 1.7 + 0.3, p2: i * 2.3 + 1.1, p3: i * 0.9 + 2.2,
      w1: 0.00042 + (i % 3) * 0.00013, w2: 0.00027 + (i % 4) * 0.00009, w3: 0.00035 + (i % 5) * 0.00007,
      amp: (7 + (i % 3) * 2.5) * scale,
      curve: (i % 2 ? 1 : -1) * (0.10 + (i % 3) * 0.04),
      // impulse speed/direction: most signals travel INTO the core
      sp: 0.00011 + (i % 4) * 0.00005,
      inward: i % 3 !== 1,
      scaleCur: 1,
    }));
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e) => {
      const r = wrap.getBoundingClientRect();
      mouse.tx = ((e.clientX - r.left) / r.width - 0.5) * 10;
      mouse.ty = ((e.clientY - r.top) / r.height - 0.5) * 8;
    };
    const onLeave = () => { mouse.tx = 0; mouse.ty = 0; };
    wrap.addEventListener("mousemove", onMove, { passive: true });
    wrap.addEventListener("mouseleave", onLeave, { passive: true });

    const qPoint = (x0, y0, cxp, cyp, x1, y1, u) => {
      const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c2 = u * u;
      return [a * x0 + b * cxp + c2 * x1, a * y0 + b * cyp + c2 * y1];
    };

    let raf;
    const step = (now) => {
      mouse.x += (mouse.tx - mouse.x) * 0.04;
      mouse.y += (mouse.ty - mouse.y) * 0.04;
      for (let i = 0; i < N; i++) {
        const s = sig[i];
        const base = pos[i];
        const dx = reduced ? 0 : s.amp * Math.sin(now * s.w1 + s.p1) + s.amp * 0.6 * Math.sin(now * s.w2 + s.p2) + mouse.x;
        const dy = reduced ? 0 : s.amp * 0.8 * Math.sin(now * s.w3 + s.p3) + s.amp * 0.5 * Math.cos(now * s.w1 + s.p2) + mouse.y;
        const nx = base.x + dx, ny = base.y + dy;
        // node: ease toward hover/selected scale
        const want = hoverRef.current === i || selRef.current === base.n.id ? 1.07 : 1;
        s.scaleCur += (want - s.scaleCur) * 0.12;
        const el = nodeRefs.current[i];
        if (el) el.style.transform = `translate(-50%,-50%) translate(${dx}px,${dy}px) scale(${s.scaleCur.toFixed(3)})`;
        // synapse path: gentle curve, control point offset perpendicular to the run
        const mx = (cx + nx) / 2, my = (cy + ny) / 2;
        const px = -(ny - cy), py = nx - cx; // perpendicular
        const cxp = mx + px * s.curve * 0.5, cyp = my + py * s.curve * 0.5;
        const path = pathRefs.current[i];
        if (path) path.setAttribute("d", `M ${cx} ${cy} Q ${cxp} ${cyp} ${nx} ${ny}`);
        // impulses: two per synapse, offset half a cycle
        for (let k = 0; k < 2; k++) {
          const dot = (impRefs.current[i] || [])[k];
          if (!dot) continue;
          if (reduced) { dot.setAttribute("opacity", "0"); continue; }
          const u = ((now * s.sp) + k * 0.5 + i * 0.13) % 1;
          const uu = s.inward ? 1 - u : u; // travel direction
          const [ix, iy] = qPoint(cx, cy, cxp, cyp, nx, ny, uu);
          dot.setAttribute("cx", ix);
          dot.setAttribute("cy", iy);
          dot.setAttribute("opacity", (Math.sin(Math.PI * u) * 0.85).toFixed(2));
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      wrap.removeEventListener("mousemove", onMove);
      wrap.removeEventListener("mouseleave", onLeave);
    };
  }, [w, H, scale, N, cx, cy, rx, ry]);

  // faint ambient synapse field — deterministic golden-angle scatter
  const synapses = Array.from({ length: 16 }, (_, i) => {
    const a = i * 2.399963;
    const r = 0.55 + 0.42 * ((i * 0.618) % 1);
    return { x: cx + rx * 1.18 * r * Math.cos(a), y: cy + ry * 1.3 * r * Math.sin(a), d: 3 + (i % 5), delay: (i % 7) * 0.6 };
  });

  const gid = "bb" + (t.id || "d"); // per-theme SVG def ids

  return (
    <div
      ref={wrapRef}
      onClickCapture={(e) => { if (movedRef.current) { e.preventDefault(); e.stopPropagation(); movedRef.current = false; } }}
      style={{ position: "relative", height: H, "--bb-halo": t.halo, overflow: "hidden", touchAction: pannable ? "none" : undefined }}>
      <div ref={fieldRef} style={{ position: "absolute", inset: 0, transformOrigin: "50% 50%", willChange: pannable ? "transform" : undefined }}>
        <svg width="100%" height={H} style={{ position: "absolute", inset: 0 }} aria-hidden="true">
          <defs>
            <filter id={gid + "-glow"} x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation={2.4 * scale} result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <radialGradient id={gid + "-corehalo"}>
              <stop offset="0%" stopColor={t.coreGlow || t.halo} />
              <stop offset="70%" stopColor={t.coreGlow || t.halo} stopOpacity="0.35" />
              <stop offset="100%" stopColor={t.coreGlow || t.halo} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* soft aura behind the core */}
          <circle cx={cx} cy={cy} r={centerR * 2.4} fill={`url(#${gid}-corehalo)`} />

          {/* orbit guides — the quiet architecture of the map */}
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={t.ring || t.link} strokeWidth="1" strokeDasharray="2 8" />
          <ellipse cx={cx} cy={cy} rx={rx * 1.28} ry={ry * 1.34} fill="none" stroke={t.ring || t.link} strokeOpacity="0.5" strokeWidth="1" strokeDasharray="1 10" />

          {/* ambient synapse dust */}
          {synapses.map((s, i) => (
            <circle key={"syn" + i} className="bb-syn" cx={s.x} cy={s.y} r={1.3 * scale}
              fill={t.impulse || t.brass} opacity="0.15"
              style={{ animation: `bbTwinkle ${s.d}s ease-in-out ${s.delay}s infinite` }} />
          ))}
          {/* curved synapse lines */}
          {pos.map(({ n }, i) => (
            <path key={n.id} ref={(el) => (pathRefs.current[i] = el)}
              d={`M ${cx} ${cy} L ${pos[i].x} ${pos[i].y}`}
              fill="none" stroke={selectedId === n.id ? t.brass : t.link}
              strokeWidth={selectedId === n.id ? 1.4 : 1} strokeOpacity="0.9" />
          ))}
          {/* traveling electrical impulses (glowing) */}
          {pos.map(({ n }, i) => [0, 1].map((k) => (
            <circle key={n.id + "-imp" + k}
              ref={(el) => { (impRefs.current[i] = impRefs.current[i] || [])[k] = el; }}
              r={2.3 * scale} fill={t.impulse || t.brass} opacity="0" filter={`url(#${gid}-glow)`} />
          )))}
        </svg>

        {/* heartbeat ripples behind the core */}
        {[0, 1].map((k) => (
          <div key={"rip" + k} className="bb-ripple" aria-hidden="true"
            style={{
              position: "absolute", left: cx, top: cy, width: centerR * 2, height: centerR * 2,
              borderRadius: "50%", border: `1px solid ${t.brass}`, pointerEvents: "none", opacity: 0,
              transform: "translate(-50%,-50%)",
              animation: `bbRipple 5.2s ease-out ${k * 2.6}s infinite`,
            }} />
        ))}

        {/* still outer ring framing the core */}
        <div aria-hidden="true" style={{
          position: "absolute", left: cx, top: cy, transform: "translate(-50%,-50%)",
          width: centerR * 2 + 22 * scale, height: centerR * 2 + 22 * scale, borderRadius: "50%",
          border: `1px solid ${t.ring || t.line}`, pointerEvents: "none",
        }} />

        {/* center — Business Health */}
        <button
          className="bb-center"
          data-bb-id="health"
          onClick={() => onSelect && onSelect("health")}
          onTouchEnd={(e) => { if (!movedRef.current) { e.preventDefault(); onSelect && onSelect("health"); } }}
          aria-label={"Business Health " + model.healthScore + ", " + model.status}
          style={{
            position: "absolute", left: cx, top: cy, transform: "translate(-50%,-50%)",
            width: centerR * 2, height: centerR * 2, borderRadius: "50%",
            background: t.coreFill || t.nodeBg, border: `1px solid ${t.brass}`, cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            animation: "bbBreathe 6s ease-in-out infinite",
            boxShadow: t.coreShadow || "0 8px 30px rgba(0,0,0,0.08)",
          }}>
          <div style={{ fontFamily: sans, fontSize: 9 * scale + 1, letterSpacing: 2.5, textTransform: "uppercase", color: t.sub }}>Business Health</div>
          <div style={{ fontFamily: serif, fontWeight: 300, fontSize: 47 * scale, color: t.ink, lineHeight: 1.02 }}>{model.healthScore}</div>
          <div style={{ fontFamily: sans, fontSize: 10 * scale + 1, letterSpacing: 2, textTransform: "uppercase", color: t.accent }}>{model.status}</div>
          <div style={{ fontFamily: sans, fontSize: 8 * scale + 1, letterSpacing: 1, color: t.sub, marginTop: 5 }}>
            {model.opportunities} opportunities · {model.risks} risk{model.risks === 1 ? "" : "s"}
          </div>
        </button>

        {/* major nodes */}
        {pos.map(({ n, x, y }, i) => (
          <button
            key={n.id}
            className="bb-node"
            data-bb-id={n.id}
            ref={(el) => (nodeRefs.current[i] = el)}
            onClick={() => onSelect && onSelect(n.id)}
            onTouchEnd={(e) => { if (!movedRef.current) { e.preventDefault(); onSelect && onSelect(n.id); } }}
            onMouseEnter={() => { hoverRef.current = i; }}
            onMouseLeave={() => { hoverRef.current = -1; }}
            aria-label={n.label + (n.value ? ", " + n.value : "")}
            style={{
              position: "absolute", left: x, top: y, transform: "translate(-50%,-50%)",
              minWidth: 110 * scale, padding: `${11 * scale}px ${15 * scale}px`, borderRadius: "50%",
              aspectRatio: "1.25 / 1",
              background: t.nodeFill || t.nodeBg,
              border: `1px solid ${selectedId === n.id ? t.brass : t.nodeBorder}`,
              cursor: "pointer", textAlign: "center",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              boxShadow: t.nodeShadow || "0 4px 18px rgba(0,0,0,0.06)",
            }}>
            <div style={{ fontFamily: serif, fontWeight: 400, fontSize: 14 * scale + 1, letterSpacing: 0.3, color: t.ink }}>{n.label}</div>
            {n.value && <div style={{ fontFamily: sans, fontSize: 9 * scale + 0.5, letterSpacing: 1.2, textTransform: "uppercase", color: t.sub, marginTop: 3 }}>{n.value}</div>}
            {n.change && <div style={{ fontFamily: sans, fontSize: 9 * scale, letterSpacing: 0.8, color: toneOf(n.status), marginTop: 1.5 }}>{n.change}</div>}
          </button>
        ))}
      </div>

      {/* reset chip appears once the view is panned/zoomed */}
      {pannable && transformed && (
        <button onClick={resetView}
          style={{
            position: "absolute", left: 14, bottom: 12, zIndex: 6,
            background: t.card, color: t.sub, border: `1px solid ${t.line}`, borderRadius: 1,
            fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
            padding: "8px 14px", cursor: "pointer",
          }}>
          ⤾ Reset view
        </button>
      )}
    </div>
  );
}

// ── Node drawer (landing page) ───────────────────────────────────────────────
function NodeDrawer({ node, model, theme: t, onClose, onNavigate, onAsk }) {
  const isHealth = node === "health";
  const n = isHealth ? null : model.nodes.find((x) => x.id === node);
  if (!isHealth && !n) return null;
  const toneOf = STATUS_TONE(t);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(26,23,20,0.35)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 92vw)", height: "100%", background: t.card, borderLeft: `1px solid ${t.line}`, padding: "26px 28px", overflowY: "auto", boxShadow: "-12px 0 40px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontFamily: serif, fontSize: 24, color: t.ink }}>{isHealth ? "Executive Brief" : n.label}</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 22, color: t.sub, cursor: "pointer" }}>×</button>
        </div>

        {isHealth ? (
          <div>
            <div style={{ fontFamily: serif, fontSize: 15, color: t.ink, margin: "10px 0 2px" }}>Business Health {model.healthScore} — <span style={{ fontStyle: "italic", color: t.accent }}>{model.status}</span></div>
            {model.healthNotes.length === 0 && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: t.sub, marginTop: 8 }}>No open deductions. The house is in order.</div>}
            {model.healthNotes.map((x, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: `1px solid ${t.line}` }}>
                <span style={{ fontFamily: sans, fontSize: 11, color: t.red, minWidth: 30 }}>−{x.pts}</span>
                <span style={{ fontFamily: serif, fontSize: 13, color: t.ink }}>{x.note}</span>
              </div>
            ))}
            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: t.sub, margin: "18px 0 6px" }}>This week's priorities</div>
            {model.priorities.length === 0 && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: t.sub }}>No open items on the board.</div>}
            {model.priorities.map((p) => (
              <div key={p.id} style={{ padding: "8px 0", borderBottom: `1px solid ${t.line}` }}>
                <div style={{ fontFamily: serif, fontSize: 13.5, color: t.ink }}>{p.title}</div>
                <div style={{ fontFamily: sans, fontSize: 10, color: t.sub, marginTop: 2 }}>
                  {p.owner ? "Assigned to " + p.owner : "Unassigned"}{p.due ? " · due " + p.due : ""} · {p.severity.toUpperCase()}
                </div>
              </div>
            ))}
            <button onClick={() => onNavigate({ tab: "growth", sub: "checklist" })} style={drawerBtn(t)}>Open Action Items</button>
          </div>
        ) : (
          <div>
            <div style={{ fontFamily: sans, fontSize: 10, color: toneOf(n.status), letterSpacing: 1, textTransform: "uppercase", marginTop: 4 }}>
              Status: {n.status}{n.change ? " · " + n.change : ""}
            </div>
            {[["What happened", n.summary.what], ["Why it matters", n.summary.why], ["What to do next", n.summary.next]].map(([h, body]) => (
              <div key={h} style={{ marginTop: 14 }}>
                <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: t.accent }}>{h}</div>
                <div style={{ fontFamily: serif, fontSize: 14, lineHeight: 1.6, color: t.ink, marginTop: 3 }}>{body}</div>
              </div>
            ))}
            {n.children && n.children.length > 0 && (
              <div style={{ marginTop: 16 }}>
                {n.children.map((c) => (
                  <button key={c.id} onClick={() => onNavigate(c.nav || n.nav)} style={{ display: "flex", justifyContent: "space-between", width: "100%", background: "none", border: "none", borderBottom: `1px solid ${t.line}`, padding: "9px 2px", cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontFamily: serif, fontSize: 13.5, color: t.ink }}>{c.label}</span>
                    <span style={{ fontFamily: sans, fontSize: 10, color: c.tone === "risk" ? t.red : t.sub }}>{c.value || "→"}</span>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => onNavigate(n.nav)} style={drawerBtn(t)}>View Full Dashboard</button>
            <button onClick={() => onAsk((ASK_SUGGESTIONS[n.id] || ASK_SUGGESTIONS.default)[0])} style={{ ...drawerBtn(t), background: "transparent", color: t.accent, border: `1px solid ${t.line}` }}>Ask Chief</button>
          </div>
        )}
      </div>
    </div>
  );
}
const drawerBtn = (t) => ({ display: "block", width: "100%", marginTop: 16, padding: "11px 0", background: t.ink, color: t.bg, border: "none", borderRadius: 1, fontFamily: sans, fontSize: 10, letterSpacing: 3, textTransform: "uppercase", cursor: "pointer" });

// ── Landing page ─────────────────────────────────────────────────────────────
export default function BusinessBrain({ model, themeId, onToggleTheme, onNavigate, onOpenCommand, onAsk }) {
  const t = BRAIN_THEMES[themeId] || BRAIN_THEMES.day;
  const [selected, setSelected] = useState(null);
  const [q, setQ] = useState("");
  const [narrow, setNarrow] = useState(typeof window !== "undefined" && window.innerWidth < 760);
  useEffect(() => {
    const onR = () => setNarrow(window.innerWidth < 760);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  const toneOf = STATUS_TONE(t);
  const insightColor = (tone) => (tone === "risk" ? t.red : tone === "good" ? t.green : t.accent);

  const ask = (text) => { if (!text || !text.trim()) return; onAsk(text.trim()); };

  return (
    <div style={{ background: t.canvas, minHeight: "calc(100vh - 130px)", padding: "26px clamp(16px, 4vw, 44px) 40px", color: t.ink }}>
      {/* greeting row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontFamily: serif, fontSize: "clamp(22px, 3vw, 30px)", color: t.ink }}>{timeGreeting(model.businessName)}</div>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: t.sub, marginTop: 2 }}>
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · Executive Intelligence
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onToggleTheme} title="Day / night" style={ghostBtn(t)}>{themeId === "day" ? "◐ Night" : "◑ Day"}</button>
          <button onClick={onOpenCommand} style={ghostBtn(t)}>⌘ Open Command View</button>
          <button onClick={() => onNavigate({ tab: "profit" })} style={{ ...ghostBtn(t), background: t.ink, color: t.bg, borderColor: t.ink }}>Standard Dashboard</button>
        </div>
      </div>

      {narrow ? (
        /* mobile: vertical executive summary, per spec */
        <div style={{ marginTop: 22 }}>
          <button onClick={() => setSelected("health")} style={{ width: "100%", background: t.nodeBg, border: `1px solid ${t.brass}`, borderRadius: 2, padding: "18px 16px", textAlign: "center", cursor: "pointer" }}>
            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: t.sub }}>Business Health</div>
            <div style={{ fontFamily: serif, fontSize: 40, color: t.ink }}>{model.healthScore}</div>
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: t.accent }}>{model.status} · {model.opportunities} opportunities · {model.risks} risks</div>
          </button>
          {model.nodes.map((n) => (
            <button key={n.id} onClick={() => setSelected(n.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: t.nodeBg, border: `1px solid ${t.nodeBorder}`, borderRadius: 2, padding: "13px 16px", marginTop: 8, cursor: "pointer" }}>
              <span style={{ fontFamily: serif, fontSize: 15, color: t.ink }}>{n.label}</span>
              <span style={{ fontFamily: sans, fontSize: 10, color: toneOf(n.status) }}>{n.value}{n.change ? " · " + n.change : ""}</span>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 24, marginTop: 8 }}>
          <BrainCanvas model={model} theme={t} selectedId={selected} onSelect={setSelected} height={520} />

          {/* insights panel */}
          <div style={{ paddingTop: 26 }}>
            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: t.sub, marginBottom: 10 }}>Insights</div>
            {model.insights.length === 0 && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: t.sub }}>Chief has nothing urgent to interpret — a quiet week.</div>}
            {model.insights.map((ins) => (
              <div key={ins.id} style={{ background: t.card, border: `1px solid ${t.line}`, borderLeft: `2px solid ${insightColor(ins.tone)}`, borderRadius: 1, padding: "12px 14px", marginBottom: 10 }}>
                <div style={{ fontFamily: serif, fontSize: 13.5, color: t.ink, lineHeight: 1.4 }}>{ins.title}</div>
                <div style={{ fontFamily: serif, fontSize: 12, color: t.sub, lineHeight: 1.5, marginTop: 4 }}>{ins.body}</div>
                <button onClick={() => onNavigate(ins.nav)} style={{ background: "none", border: "none", padding: 0, marginTop: 6, fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: t.accent, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>View insight</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ask bar */}
      <div style={{ maxWidth: 640, margin: narrow ? "26px auto 0" : "10px auto 0", display: "flex", gap: 8 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(q); }}
          placeholder="Ask anything about your business…"
          style={{ flex: 1, background: t.card, border: `1px solid ${t.line}`, borderRadius: 1, padding: "13px 18px", fontFamily: serif, fontSize: 14, color: t.ink, outline: "none" }}
        />
        <button onClick={() => ask(q)} style={{ padding: "0 22px", background: t.ink, color: t.bg, border: "none", borderRadius: 1, fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Ask Chief</button>
      </div>

      {selected && (
        <NodeDrawer node={selected} model={model} theme={t} onClose={() => setSelected(null)} onNavigate={(nav) => { setSelected(null); onNavigate(nav); }} onAsk={(text) => { setSelected(null); onAsk(text); }} />
      )}
    </div>
  );
}

const ghostBtn = (t) => ({ padding: "9px 14px", background: "transparent", border: `1px solid ${t.line}`, borderRadius: 1, color: t.sub, fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap" });
