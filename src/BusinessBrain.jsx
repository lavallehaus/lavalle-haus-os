import { useEffect, useMemo, useRef, useState } from "react";
import { ASK_SUGGESTIONS } from "./businessBrain.js";

// LAVALLE HAUS OS — Business Brain landing page
// A quiet-luxury visual map of the business: Business Health at the center,
// the departments breathing around it, insights on the right, Ask Chief below.
// The standard dashboard stays one click away — this is a navigation layer,
// not a replacement.

const serif = "'IM Fell English', Georgia, serif";
const sans = "monospace";

// ── Day / Night themes ───────────────────────────────────────────────────────
export const BRAIN_THEMES = {
  day: {
    id: "day", bg: "#f7f4ef", card: "#efece5", ink: "#1a1714", sub: "#8c7d6b",
    line: "#c8c2b8", accent: "#a07848", brass: "#a89060", green: "#5a7a5a", red: "#9b5e5e",
    canvas: "radial-gradient(ellipse at 50% 38%, #f2eee6 0%, #f7f4ef 62%, #efeae1 100%)",
    nodeBg: "#efece5", nodeBorder: "#c8c2b8", link: "#d5cfc3", halo: "rgba(168,144,96,0.16)",
  },
  night: {
    id: "night", bg: "#211a14", card: "#2b2219", ink: "#efe7da", sub: "#a8917a",
    line: "#463829", accent: "#c2a878", brass: "#c2a878", green: "#8fae8f", red: "#c88f83",
    canvas: "radial-gradient(ellipse at 50% 38%, #2a211a 0%, #211a14 62%, #1a140f 100%)",
    nodeBg: "#2b2219", nodeBorder: "#463829", link: "#3b2f22", halo: "rgba(194,168,120,0.14)",
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
@keyframes bbFloat { 0%,100% { transform: translate(-50%,-50%) translateY(0); } 50% { transform: translate(-50%,-50%) translateY(-6px); } }
@keyframes bbBreathe { 0%,100% { box-shadow: 0 0 0 0 var(--bb-halo), 0 8px 30px rgba(0,0,0,0.08); } 50% { box-shadow: 0 0 0 18px transparent, 0 8px 30px rgba(0,0,0,0.08); } }
@keyframes bbPulse { 0%,100% { stroke-opacity: 0.55; } 50% { stroke-opacity: 0.95; } }
@media (prefers-reduced-motion: reduce) {
  .bb-node, .bb-center { animation: none !important; }
  .bb-link { animation: none !important; }
}
.bb-node { transition: transform 0.45s ease, box-shadow 0.45s ease; }
.bb-node:hover { transform: translate(-50%,-50%) scale(1.07) !important; z-index: 5; }
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
// Pure layout: center node + majors on an ellipse, thin pulsing links behind.
export function BrainCanvas({ model, theme: t, scale = 1, selectedId, onSelect, height = 520 }) {
  useMotionCss();
  const wrapRef = useRef(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => { for (const e of es) setW(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  return (
    <div ref={wrapRef} style={{ position: "relative", height: H, "--bb-halo": t.halo }}>
      <svg width="100%" height={H} style={{ position: "absolute", inset: 0 }} aria-hidden="true">
        {pos.map(({ n, x, y }, i) => (
          <line key={n.id} className="bb-link" x1={cx} y1={cy} x2={x} y2={y}
            stroke={selectedId === n.id ? t.brass : t.link} strokeWidth={selectedId === n.id ? 1.4 : 1}
            style={{ animation: `bbPulse ${5 + (i % 3)}s ease-in-out infinite` }} />
        ))}
      </svg>

      {/* center — Business Health */}
      <button
        className="bb-center"
        onClick={() => onSelect && onSelect("health")}
        aria-label={"Business Health " + model.healthScore + ", " + model.status}
        style={{
          position: "absolute", left: cx, top: cy, transform: "translate(-50%,-50%)",
          width: centerR * 2, height: centerR * 2, borderRadius: "50%",
          background: t.nodeBg, border: `1px solid ${t.brass}`, cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          animation: "bbBreathe 6s ease-in-out infinite", boxShadow: "0 8px 30px rgba(0,0,0,0.08)",
        }}>
        <div style={{ fontFamily: sans, fontSize: 9 * scale + 1, letterSpacing: 2, textTransform: "uppercase", color: t.sub }}>Business Health</div>
        <div style={{ fontFamily: serif, fontSize: 44 * scale, color: t.ink, lineHeight: 1.05 }}>{model.healthScore}</div>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13 * scale, color: t.accent }}>{model.status}</div>
        <div style={{ fontFamily: sans, fontSize: 8 * scale + 1, letterSpacing: 1, color: t.sub, marginTop: 4 }}>
          {model.opportunities} opportunities · {model.risks} risk{model.risks === 1 ? "" : "s"}
        </div>
      </button>

      {/* major nodes */}
      {pos.map(({ n, x, y }, i) => (
        <button
          key={n.id}
          className="bb-node"
          onClick={() => onSelect && onSelect(n.id)}
          aria-label={n.label + (n.value ? ", " + n.value : "")}
          style={{
            position: "absolute", left: x, top: y, transform: "translate(-50%,-50%)",
            minWidth: 108 * scale, padding: `${10 * scale}px ${14 * scale}px`, borderRadius: "50%",
            aspectRatio: "1.25 / 1",
            background: t.nodeBg, border: `1px solid ${selectedId === n.id ? t.brass : t.nodeBorder}`,
            cursor: "pointer", textAlign: "center",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            animation: `bbFloat ${7 + (i % 4)}s ease-in-out infinite`,
            boxShadow: "0 4px 18px rgba(0,0,0,0.06)",
          }}>
          <div style={{ fontFamily: serif, fontSize: 14 * scale + 1, color: t.ink }}>{n.label}</div>
          {n.value && <div style={{ fontFamily: sans, fontSize: 10 * scale, color: t.sub, marginTop: 2 }}>{n.value}</div>}
          {n.change && <div style={{ fontFamily: sans, fontSize: 9 * scale, color: toneOf(n.status), marginTop: 1 }}>{n.change}</div>}
        </button>
      ))}
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
