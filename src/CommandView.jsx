import { useEffect, useMemo, useRef, useState } from "react";
import { BrainCanvas, BRAIN_THEMES, timeGreeting } from "./BusinessBrain.jsx";
import { ASK_SUGGESTIONS } from "./businessBrain.js";

// LAVALLE HAUS OS — Command View
// The immersive, touch-friendly layer over the Business Brain, for large
// screens, team meetings and founder review. Not a presentation gimmick: the
// same live model, presented so the business feels present in the room.
// Desktop first; typography scales with the viewport for TVs, and after a few
// idle minutes Ambient Mode slowly rotates through what matters.

const serif = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";

// Atmospheric background themes (CSS-only; texture without distraction).
const BACKGROUNDS = {
  gallery: { label: "Gallery White", day: "radial-gradient(ellipse at 50% 30%, #FFFFFF 0%, #FAFAF9 55%, #F4F4F3 100%)", night: "radial-gradient(ellipse at 50% 30%, #2c231b 0%, #241c15 55%, #1b150f 100%)" },
  travertine: { label: "Travertine", day: "radial-gradient(ellipse at 50% 30%, #FBFAF8 0%, #F5F3EF 55%, #EFEDE8 100%)", night: "radial-gradient(ellipse at 50% 30%, #2c231b 0%, #241c15 55%, #1b150f 100%)" },
  ceramic: { label: "Ceramic", day: "linear-gradient(170deg, #FDFDFC 0%, #F6F6F4 60%, #F0F0EE 100%)", night: "linear-gradient(170deg, #28201a 0%, #221a14 60%, #1a130e 100%)" },
  stone: { label: "Stone", day: "linear-gradient(180deg, #FAFAF9 0%, #F0F0EE 100%)", night: "linear-gradient(180deg, #26211c 0%, #1c1712 100%)" },
};

const AMBIENT_AFTER_MS = 3 * 60 * 1000; // idle minutes before ambient mode
const AMBIENT_STEP_MS = 12 * 1000;

export default function CommandView({ model, themeId, onToggleTheme, onExit, onNavigate, onAsk }) {
  const t = BRAIN_THEMES[themeId] || BRAIN_THEMES.day;
  const [selected, setSelected] = useState(null);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const iv = setInterval(() => setClock(new Date()), 30000); return () => clearInterval(iv); }, []);
  const [bg, setBg] = useState(() => { try { return localStorage.getItem("lh_cv_bg") || "gallery"; } catch { return "gallery"; } });
  useEffect(() => { try { localStorage.setItem("lh_cv_bg", bg); } catch {} }, [bg]);
  const [q, setQ] = useState("");
  const [ambient, setAmbient] = useState(false);
  const idleRef = useRef(null);
  const ambientRef = useRef(null);
  const [ambientIdx, setAmbientIdx] = useState(0);

  // idle → ambient mode; any interaction wakes it
  useEffect(() => {
    const arm = () => {
      setAmbient(false);
      if (idleRef.current) clearTimeout(idleRef.current);
      idleRef.current = setTimeout(() => setAmbient(true), AMBIENT_AFTER_MS);
    };
    arm();
    const evs = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];
    evs.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    return () => { evs.forEach((e) => window.removeEventListener(e, arm)); if (idleRef.current) clearTimeout(idleRef.current); };
  }, []);
  useEffect(() => {
    if (!ambient) { if (ambientRef.current) clearInterval(ambientRef.current); return; }
    setSelected(null);
    ambientRef.current = setInterval(() => setAmbientIdx((i) => i + 1), AMBIENT_STEP_MS);
    return () => clearInterval(ambientRef.current);
  }, [ambient]);

  // keyboard: Esc exits, arrows cycle nodes, Enter opens
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { selected ? setSelected(null) : onExit(); }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const ids = model.nodes.map((n) => n.id);
        const cur = ids.indexOf(selected);
        const next = e.key === "ArrowRight" ? (cur + 1 + ids.length) % ids.length : (cur - 1 + ids.length) % ids.length;
        setSelected(ids[next]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, model.nodes, onExit]);

  const ambientInsight = model.insights.length ? model.insights[ambientIdx % model.insights.length] : null;
  const node = selected && selected !== "health" ? model.nodes.find((n) => n.id === selected) : null;
  const suggestions = ASK_SUGGESTIONS[selected] || ASK_SUGGESTIONS.default;
  const bgCss = (BACKGROUNDS[bg] || BACKGROUNDS.travertine)[themeId] || BACKGROUNDS.travertine.day;
  const canvasH = Math.max(460, Math.min(760, typeof window !== "undefined" ? window.innerHeight - 210 : 560));

  const nodeStat = (id) => model.nodes.find((n) => n.id === id);
  const stats = [
    { l: "Health", v: model.healthScore + " · " + model.status },
    { l: "Opportunities", v: String(model.opportunities) },
    { l: "Risks", v: String(model.risks), tone: model.risks > 0 ? t.red : null },
    { l: "Revenue", v: (nodeStat("revenue") || {}).value || "—" },
    { l: "Marketing", v: (nodeStat("marketing") || {}).value || "—" },
    { l: "Inventory", v: (nodeStat("inventory") || {}).value || "—" },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: bgCss, color: t.ink, overflowY: "auto" }}>
      {/* atmosphere: fine dot grid + vignette */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: `radial-gradient(${t.ring || t.line} 0.8px, transparent 0.8px)`, backgroundSize: "34px 34px", opacity: themeId === "night" ? 0.5 : 0.55, maskImage: "radial-gradient(ellipse at 50% 42%, black 30%, transparent 78%)", WebkitMaskImage: "radial-gradient(ellipse at 50% 42%, black 30%, transparent 78%)" }} />
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", background: themeId === "night" ? "radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,0.35) 100%)" : "radial-gradient(ellipse at 50% 45%, transparent 60%, rgba(26,26,26,0.05) 100%)" }} />

      {/* toolbar */}
      <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px clamp(16px, 3vw, 40px)", flexWrap: "wrap", gap: 10, borderBottom: `1px solid ${t.line}` }}>
        <div>
          <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 4, textTransform: "uppercase", color: t.sub }}>
            {model.businessName} · Command View
            <span style={{ margin: "0 10px", color: t.line }}>|</span>
            <span style={{ color: t.accent }}>● Live</span>
            <span style={{ margin: "0 10px", color: t.line }}>|</span>
            {clock.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            <span style={{ margin: "0 10px", color: t.line }}>|</span>
            Interpreting {model.insights.length} signal{model.insights.length === 1 ? "" : "s"}
          </div>
          <div style={{ fontFamily: serif, fontSize: "clamp(18px, 2.2vw, 26px)", fontWeight: 300 }}>{timeGreeting(model.businessName)}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={bg} onChange={(e) => setBg(e.target.value)} aria-label="Background theme"
            style={{ background: "transparent", border: `1px solid ${t.line}`, borderRadius: 1, color: t.sub, fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", padding: "8px 10px", cursor: "pointer" }}>
            {Object.entries(BACKGROUNDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <button onClick={onToggleTheme} style={tbBtn(t)}>{themeId === "day" ? "◐ Night" : "◑ Day"}</button>
          <button onClick={() => onNavigate({ tab: "profit" })} style={tbBtn(t)}>Standard Dashboard</button>
          <button onClick={onExit} style={{ ...tbBtn(t), background: t.ink, color: t.bg, borderColor: t.ink }}>Exit Command View</button>
        </div>
      </div>

      {/* canvas — larger nodes, generous spacing */}
      <div style={{ position: "relative", padding: "0 clamp(10px, 2vw, 30px)" }}>
        <BrainCanvas model={model} theme={t} scale={1.25} selectedId={selected} onSelect={(id) => { setAmbient(false); setSelected(id); }} height={canvasH} pannable deluxe />
      </div>

      {/* instrument strip — the numbers at a glance */}
      <div style={{ position: "relative", display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 0, padding: "4px clamp(16px, 3vw, 40px) 0" }}>
        {stats.map((s, i) => (
          <div key={s.l} style={{ padding: "6px 22px", borderLeft: i === 0 ? "none" : `1px solid ${t.line}`, textAlign: "center" }}>
            <div style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 2, textTransform: "uppercase", color: t.sub }}>{s.l}</div>
            <div style={{ fontFamily: sans, fontSize: 13.5, fontWeight: 300, letterSpacing: 0.5, color: s.tone || t.ink, marginTop: 2 }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* ambient ribbon */}
      {ambient && ambientInsight && (
        <div style={{ position: "fixed", left: "50%", bottom: 90, transform: "translateX(-50%)", background: t.card, border: `1px solid ${t.line}`, borderRadius: 2, padding: "14px 26px", maxWidth: "min(680px, 90vw)", textAlign: "center", boxShadow: "0 10px 40px rgba(0,0,0,0.15)" }}>
          <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: t.accent }}>{ambientInsight.tone === "risk" ? "Risk" : ambientInsight.tone === "good" ? "Opportunity" : "Note"}</div>
          <div style={{ fontFamily: serif, fontSize: "clamp(15px, 1.8vw, 20px)", marginTop: 4 }}>{ambientInsight.title}</div>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: t.sub, marginTop: 3 }}>{ambientInsight.body}</div>
        </div>
      )}

      {/* ask bar */}
      <div style={{ position: "sticky", bottom: 0, padding: "14px clamp(16px, 3vw, 40px) 22px", display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", gap: 8, width: "min(680px, 94vw)" }}>
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) onAsk(q.trim()); }}
            placeholder={node ? "Ask Chief about " + node.label.toLowerCase() + "…" : "Ask Chief about this part of the business…"}
            style={{ flex: 1, background: t.card, border: `1px solid ${t.line}`, borderRadius: 1, padding: "13px 18px", fontFamily: serif, fontSize: 14, color: t.ink, outline: "none" }} />
          <button onClick={() => q.trim() && onAsk(q.trim())} style={{ padding: "0 20px", background: t.ink, color: t.bg, border: "none", borderRadius: 1, fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Ask</button>
        </div>
      </div>

      {/* insight panel */}
      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,0.30)", display: "flex", justifyContent: "flex-end", zIndex: 210 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(460px, 94vw)", height: "100%", background: t.card, borderLeft: `1px solid ${t.line}`, padding: "clamp(20px, 3vh, 34px) clamp(20px, 2.5vw, 34px)", overflowY: "auto" }}>
            {selected === "health" ? (
              <div>
                <PanelHeader title="Executive Brief" t={t} onClose={() => setSelected(null)} />
                <div style={{ fontFamily: serif, fontSize: 40, marginTop: 8 }}>{model.healthScore} <span style={{ fontSize: 17, fontStyle: "italic", color: t.accent }}>{model.status}</span></div>
                {model.insights.map((ins) => (
                  <div key={ins.id} style={{ padding: "10px 0", borderBottom: `1px solid ${t.line}` }}>
                    <div style={{ fontFamily: serif, fontSize: 15 }}>{ins.title}</div>
                    <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12.5, color: t.sub, marginTop: 2 }}>{ins.body}</div>
                  </div>
                ))}
                <button onClick={() => onNavigate({ tab: "growth", sub: "checklist" })} style={panelBtn(t)}>View Recommendations</button>
              </div>
            ) : node && (
              <div>
                <PanelHeader title={node.label} t={t} onClose={() => setSelected(null)} />
                <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", marginTop: 4, color: node.status === "improving" ? t.green : node.status === "declining" ? t.red : t.sub }}>
                  Status: {node.status}{node.change ? " · " + node.change : ""}
                </div>
                {[["What happened", node.summary.what], ["Why it matters", node.summary.why], ["What to do next", node.summary.next]].map(([h, body]) => (
                  <div key={h} style={{ marginTop: 16 }}>
                    <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: t.accent }}>{h}</div>
                    <div style={{ fontFamily: serif, fontSize: "clamp(14px, 1.5vw, 16px)", lineHeight: 1.65, marginTop: 4 }}>{body}</div>
                  </div>
                ))}
                {node.children && node.children.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    {node.children.map((c) => (
                      <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${t.line}` }}>
                        <span style={{ fontFamily: serif, fontSize: 14 }}>{c.label}</span>
                        <span style={{ fontFamily: sans, fontSize: 10.5, color: c.tone === "risk" ? t.red : t.sub }}>{c.value || ""}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 16 }}>
                  {suggestions.map((s) => (
                    <button key={s} onClick={() => onAsk(s)} style={{ display: "inline-block", background: "transparent", border: `1px solid ${t.line}`, borderRadius: 1, color: t.sub, fontFamily: serif, fontStyle: "italic", fontSize: 12, padding: "6px 12px", margin: "0 6px 6px 0", cursor: "pointer" }}>{s}</button>
                  ))}
                </div>
                <button onClick={() => onNavigate(node.nav)} style={panelBtn(t)}>View Full Dashboard</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PanelHeader({ title, t, onClose }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <div style={{ fontFamily: serif, fontSize: "clamp(22px, 2.4vw, 28px)", color: t.ink }}>{title}</div>
      <button onClick={onClose} aria-label="Close panel" style={{ background: "none", border: "none", fontSize: 24, color: t.sub, cursor: "pointer" }}>×</button>
    </div>
  );
}

const tbBtn = (t) => ({ padding: "9px 14px", background: "transparent", border: `1px solid ${t.line}`, borderRadius: 1, color: t.sub, fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap" });
const panelBtn = (t) => ({ display: "block", width: "100%", marginTop: 18, padding: "12px 0", background: t.ink, color: t.bg, border: "none", borderRadius: 1, fontFamily: sans, fontSize: 10, letterSpacing: 3, textTransform: "uppercase", cursor: "pointer" });
