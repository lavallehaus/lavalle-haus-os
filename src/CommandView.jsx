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

// ── THE STEWARD — the agent present in the room ──────────────────────────────
// With Briefing on, every bubble press asks the Steward to read that part of
// the business: its state, what's missing, and the one next action. Spoken
// aloud via the browser's own voice when Voice is on. Answers come from the
// server-side Claude passthrough (/api/categorize) so the key stays private;
// if the API is unreachable it composes a brief from the live model instead.
const AGENT_NAME = "The Steward";

function stewardSystem(businessName, lang) {
  return `You are ${AGENT_NAME}, the senior operator who runs ${businessName}'s Chief operating system. The owner is reviewing the business on a large screen and has just opened one area. Brief them aloud.
Voice: composed, precise, quietly confident. Plain sentences, no emojis, no headers, no lists, no pleasantries.
In 60-100 words: state how this area stands; name specifically what is missing, unhealthy, or not yet connected (use only the data given — if a feed or number is absent, say exactly what to connect or enter); close with the single most important action, as one directive sentence starting "${lang === "es" ? "Siguiente:" : "Next:"}".` +
    (lang === "es" ? "\nRespond entirely in natural, professional Spanish (español de negocios, tono sereno)." : "");
}

function stewardContext(model, nodeId) {
  if (nodeId === "health") {
    return { area: "Business Health (overall)", healthScore: model.healthScore, status: model.status, deductions: model.healthNotes, insights: model.insights.map((i) => i.title + " — " + i.body), priorities: model.priorities };
  }
  const n = model.nodes.find((x) => x.id === nodeId);
  if (!n) return null;
  return {
    area: n.label, status: n.status, headline: n.value, change: n.change,
    whatHappened: n.summary.what, whyItMatters: n.summary.why, suggestedNext: n.summary.next,
    parts: (n.children || []).map((c) => c.label + ": " + (c.value || "no data yet")),
    relatedInsights: model.insights.filter((i) => (i.nav && i.nav.tab) || true).slice(0, 4).map((i) => i.title + " — " + i.body),
    healthScore: model.healthScore, healthStatus: model.status,
  };
}

// Offline/local fallback so the Steward never goes silent.
function composeLocalBrief(model, nodeId) {
  if (nodeId === "health") {
    const worst = model.healthNotes[0];
    return `${model.businessName} stands at ${model.healthScore}, ${model.status.toLowerCase()}. ` +
      (worst ? `The largest deduction: ${worst.note}. ` : "No open deductions. ") +
      (model.priorities[0] ? `Next: ${model.priorities[0].title}.` : "Next: review this week's priorities on the Action Items board.");
  }
  const n = model.nodes.find((x) => x.id === nodeId);
  if (!n) return "";
  const missing = (n.children || []).filter((c) => !c.value).map((c) => c.label);
  return `${n.label} is ${n.status}. ${n.summary.what} ${n.summary.why} ` +
    (missing.length ? `Not yet connected: ${missing.join(", ")}. ` : "") +
    `Next: ${n.summary.next}`;
}

function speak(text, enabled, lang = "en") {
  try {
    if (!enabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.97; u.pitch = 0.92; // a touch lower — a measured male register
    u.lang = lang === "es" ? "es-MX" : "en-US";
    const voices = window.speechSynthesis.getVoices();
    // The Steward has a male voice. Prefer named male voices, then any voice
    // that reports male gender, then any voice in the right language.
    const isLang = (v) => v.lang && v.lang.toLowerCase().startsWith(lang === "es" ? "es" : "en");
    const named = lang === "es"
      ? /Jorge|Juan|Diego|Carlos|Google español/i
      : /\b(Tom|Aaron|Reed|Eddy|Rocko|Daniel|Alex|Fred|Google UK English Male)\b/i;
    const pick =
      voices.find((v) => isLang(v) && named.test(v.name)) ||
      voices.find((v) => isLang(v) && /male/i.test(v.name) && !/female/i.test(v.name)) ||
      voices.find((v) => named.test(v.name)) ||
      voices.find(isLang);
    if (pick) u.voice = pick;
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

export default function CommandView({ model, themeId, onToggleTheme, onExit, onNavigate, onAsk }) {
  const t = BRAIN_THEMES[themeId] || BRAIN_THEMES.day;
  const [selected, setSelected] = useState(null);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const iv = setInterval(() => setClock(new Date()), 30000); return () => clearInterval(iv); }, []);

  // ── The Steward's presence ──
  const [briefing, setBriefing] = useState(() => { try { return localStorage.getItem("lh_cv_brief") === "1"; } catch { return false; } });
  const [voiceOn, setVoiceOn] = useState(() => { try { return localStorage.getItem("lh_cv_voice") !== "0"; } catch { return true; } });
  const [lang, setLang] = useState(() => { try { return localStorage.getItem("lh_cv_lang") || "en"; } catch { return "en"; } });
  useEffect(() => { try { localStorage.setItem("lh_cv_brief", briefing ? "1" : "0"); localStorage.setItem("lh_cv_voice", voiceOn ? "1" : "0"); localStorage.setItem("lh_cv_lang", lang); } catch {} }, [briefing, voiceOn, lang]);
  const [brief, setBrief] = useState({ nodeId: null, status: "idle", text: "" });
  const briefCache = useRef({});
  useEffect(() => {
    if (!briefing || !selected) { setBrief({ nodeId: null, status: "idle", text: "" }); return; }
    const nodeId = selected;
    const ck = nodeId + ":" + lang;
    if (briefCache.current[ck]) {
      setBrief({ nodeId, status: "ready", text: briefCache.current[ck] });
      speak(briefCache.current[ck], voiceOn, lang);
      return;
    }
    let dead = false;
    setBrief({ nodeId, status: "loading", text: "" });
    (async () => {
      let text = "";
      try {
        const ctx = stewardContext(model, nodeId);
        const r = await fetch("/api/categorize", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ system: stewardSystem(model.businessName, lang), max_tokens: 300, messages: [{ role: "user", content: "Brief me on this area now. Data:\n" + JSON.stringify(ctx) }] }),
        });
        const d = await r.json();
        if (r.ok && d.content && d.content[0] && d.content[0].text) text = d.content[0].text.trim();
      } catch (e) {}
      if (!text) text = (lang === "es" ? "(Sin conexión al servicio de inteligencia — datos en vivo:) " : "") + composeLocalBrief(model, nodeId);
      briefCache.current[ck] = text;
      if (!dead) { setBrief({ nodeId, status: "ready", text }); speak(text, voiceOn, lang); }
    })();
    return () => { dead = true; };
  }, [briefing, selected, lang]);
  // leaving the room silences the Steward
  useEffect(() => () => { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {} }, []);
  useEffect(() => { if (!selected || !briefing) { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {} } }, [selected, briefing]);
  // muting cuts speech mid-sentence
  useEffect(() => { if (!voiceOn) { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {} } }, [voiceOn]);
  // the Steward announces itself once when it enters the room
  const welcomedRef = useRef(false);
  useEffect(() => {
    if (briefing && !welcomedRef.current) { welcomedRef.current = true; speak((lang === "es" ? "Bienvenido, " : "Welcome, ") + model.businessName + ".", voiceOn, lang); }
  }, [briefing]);

  // ── per-bubble conversation with the Steward ──
  const [chats, setChats] = useState({}); // nodeId -> [{role: "user"|"steward", text}]
  const [chatBusy, setChatBusy] = useState(false);
  async function askSteward(nodeId, q) {
    const entry = { role: "user", text: q };
    const history = [...(chats[nodeId] || []), entry];
    setChats((c) => ({ ...c, [nodeId]: history }));
    setChatBusy(true);
    let text = "";
    try {
      const ctx = stewardContext(model, nodeId);
      const r = await fetch("/api/categorize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: stewardSystem(model.businessName, lang) + "\nYou are now in conversation about this area. Answer the owner's question directly in under 80 words, grounded only in the data below. If the data cannot answer it, say exactly what to connect or check.\nArea data:\n" + JSON.stringify(ctx),
          max_tokens: 400,
          messages: history.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text })),
        }),
      });
      const d = await r.json();
      if (r.ok && d.content && d.content[0] && d.content[0].text) text = d.content[0].text.trim();
    } catch (e) {}
    if (!text) text = (lang === "es" ? "No puedo alcanzar el servicio de inteligencia desde aquí. De los datos en vivo: " : "I can't reach the intelligence service from here. From the live data: ") + composeLocalBrief(model, nodeId);
    setChats((c) => ({ ...c, [nodeId]: [...(c[nodeId] || []), { role: "steward", text }] }));
    setChatBusy(false);
    speak(text, voiceOn, lang);
  }
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
          <button onClick={() => setBriefing((b) => !b)} title={AGENT_NAME + " briefs each area as you open it"}
            style={{ ...tbBtn(t), border: `1px solid ${briefing ? t.brass : t.line}`, color: briefing ? t.accent : t.sub }}>
            ◉ {AGENT_NAME}: {briefing ? "Present" : "Off"}
          </button>
          {briefing && (
            <button onClick={() => setVoiceOn((v) => !v)} title={voiceOn ? "Mute — replies stay in the chat" : "Unmute — speak replies aloud"}
              style={{ ...tbBtn(t), border: `1px solid ${voiceOn ? t.brass : t.line}`, color: voiceOn ? t.accent : t.sub }}>
              {voiceOn ? "🔊 Unmuted" : "🔇 Muted"}
            </button>
          )}
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
        {/* the Steward's language — minimal, top right of the map */}
        <div style={{ position: "absolute", top: 14, right: "clamp(18px, 3vw, 44px)", zIndex: 5, display: "flex", alignItems: "center", gap: 10 }}>
          {["en", "es"].map((l) => (
            <button key={l} onClick={() => setLang(l)} aria-label={l === "en" ? "Steward speaks English" : "El Steward habla español"}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: sans, fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: lang === l ? t.ink : t.sub, borderBottom: lang === l ? `1px solid ${t.brass}` : "1px solid transparent", lineHeight: 1.9 }}>
              {l}
            </button>
          ))}
        </div>
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
                {briefing && <StewardBrief brief={brief} t={t} chat={chats.health || []} busy={chatBusy} onAsk={(qq) => askSteward("health", qq)} areaLabel={lang === "es" ? "el negocio" : "the business"} lang={lang} />}
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
                {briefing && <StewardBrief brief={brief} t={t} chat={chats[node.id] || []} busy={chatBusy} onAsk={(qq) => askSteward(node.id, qq)} areaLabel={node.label} lang={lang} />}
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

function StewardBrief({ brief, t, chat = [], busy, onAsk, areaLabel, lang = "en" }) {
  const sansF = "'Jost', 'Helvetica Neue', Arial, sans-serif";
  const [q, setQ] = useState("");
  const endRef = useRef(null);
  useEffect(() => { if (endRef.current) endRef.current.scrollIntoView({ block: "nearest" }); }, [chat.length, busy]);
  const send = () => { const v = q.trim(); if (!v || busy) return; setQ(""); onAsk(v); };
  return (
    <div style={{ marginTop: 14, padding: "13px 16px", background: t.bg, border: `1px solid ${t.line}`, borderLeft: `2px solid ${t.brass}`, borderRadius: 1 }}>
      <div style={{ fontFamily: sansF, fontSize: 9, letterSpacing: 2.5, textTransform: "uppercase", color: t.accent }}>◉ {AGENT_NAME}</div>
      {brief.status === "loading" ? (
        <div style={{ fontFamily: sansF, fontStyle: "italic", fontSize: 13, color: t.sub, marginTop: 6 }}>{lang === "es" ? "Leyendo la sala…" : "Reading the room…"}</div>
      ) : (
        <div style={{ fontFamily: sansF, fontSize: 13.5, lineHeight: 1.65, color: t.ink, marginTop: 6, whiteSpace: "pre-wrap" }}>{brief.text}</div>
      )}

      {/* the conversation — always answers here; speaks only when unmuted */}
      {(chat.length > 0 || busy) && (
        <div style={{ marginTop: 12, maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {chat.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", padding: "8px 12px", borderRadius: 1, fontFamily: sansF, fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", background: m.role === "user" ? t.ink : t.card, color: m.role === "user" ? t.bg : t.ink, border: m.role === "user" ? "none" : `1px solid ${t.line}` }}>
              {m.text}
            </div>
          ))}
          {busy && <div style={{ alignSelf: "flex-start", fontFamily: sansF, fontStyle: "italic", fontSize: 12.5, color: t.sub }}>{AGENT_NAME}{lang === "es" ? " está pensando…" : " is thinking…"}</div>}
          <div ref={endRef} />
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder={(lang === "es" ? "Pregunta sobre " : "Ask about ") + (areaLabel || (lang === "es" ? "esta área" : "this area")) + "…"}
          style={{ flex: 1, background: t.card, border: `1px solid ${t.line}`, borderRadius: 1, padding: "9px 12px", fontFamily: sansF, fontSize: 13, color: t.ink, outline: "none" }}
        />
        <button onClick={send} disabled={busy}
          style={{ padding: "0 14px", background: t.ink, color: t.bg, border: "none", borderRadius: 1, fontFamily: sansF, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
          Ask
        </button>
      </div>
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
