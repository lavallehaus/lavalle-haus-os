import { useEffect, useRef, useState } from "react";

// LAVALLE HAUS OS — Command Dashboard
// Quiet-luxury command-center: a central business-health core orbited by seven
// sector nodes on a living node-graph. Canvas draws the animated field (rings,
// pulses, particles, radar); DOM holds everything with text/interaction. The
// "Chief" answers in the ask bar and by voice ("🎙 Hi Chief"). Recreated from the
// design handoff; wired to the live Business Brain model + the TTS voice.

const STAGE_W = 1400, STAGE_H = 900;
const mono = "'JetBrains Mono', ui-monospace, monospace";
const serifD = "'Cormorant Garamond', Georgia, serif";

const PALETTES = {
  day: { bg: "#f4f2ed", ink: "#1c1a17", muted: "#8a8579", line: "rgba(120,110,92,0.26)", lineStrong: "rgba(120,110,92,0.5)", accent: "#a89574", accentSoft: "#c9b896", risk: "#8f4a43", good: "#5f6b52", card: "#faf9f6", cardBorder: "rgba(28,26,23,0.09)", shadow: "0 26px 60px -32px rgba(70,58,38,0.45)", particle: "rgba(120,110,92,0.32)", ring: "rgba(120,110,92,0.5)", panelBg: "rgba(250,249,246,0.92)", hudBg: "rgba(250,249,246,0.52)" },
  night: { bg: "#0c0c0e", ink: "#ece9e2", muted: "#7a766e", line: "rgba(201,184,150,0.15)", lineStrong: "rgba(201,184,150,0.42)", accent: "#c9b896", accentSoft: "#a89574", risk: "#cf837a", good: "#a6b48f", card: "#141416", cardBorder: "rgba(236,233,226,0.10)", shadow: "0 34px 74px -34px rgba(0,0,0,0.75)", particle: "rgba(201,184,150,0.26)", ring: "rgba(201,184,150,0.46)", panelBg: "rgba(18,18,20,0.90)", hudBg: "rgba(16,16,18,0.55)" },
};

// Placeholder copy from the design; live values overwrite where the model has them.
const SECTORS = [
  { key: "revenue", name: "Revenue", mono: "ALL CHANNELS", value: "$469", unit: "wk", delta: "-56%", status: "warn", metrics: [["DTC / Shopify", "$312 wk"], ["Amazon", "$157 wk"], ["Wholesale", "$0 wk"], ["4-wk trend", "↓ declining"]], insight: "Revenue slid 56% week-over-week — DTC softened after the last promo ended. Wholesale is the fastest lever if we can close a single account.", actions: ["Draft wholesale outreach", "Model a promo"] },
  { key: "ads", name: "Ads", mono: "AMAZON · META", value: "$378", unit: "/mo", delta: "ROAS 0.59", status: "risk", metrics: [["Spend", "$378 /mo"], ["ROAS", "0.59 · target 1.4"], ["CPA", "$44"], ["Best channel", "Meta retargeting"]], insight: "Ads are the single biggest drag on health. ROAS 0.59 means you lose $0.41 per ad dollar. I'd pause Amazon exact-match and shift budget to Meta retargeting.", actions: ["Pause losing campaigns", "Rebalance budget"] },
  { key: "content", name: "Content", mono: "SOCIAL HEALTH", value: "72", unit: "/100", delta: "IG +4.2%", status: "good", metrics: [["Instagram reach", "+4.2% wk"], ["Posting cadence", "3 / wk"], ["Top format", "Reels"], ["Saves rate", "strong"]], insight: "Organic content is your quiet win — reach is up 4.2% on a light cadence. Reels are carrying it. Doubling cadence could offset the paid-ads shortfall cheaply.", actions: ["Plan a Reels sprint", "Repurpose top posts"] },
  { key: "inventory", name: "Inventory", mono: "10 SKUS", value: "10", unit: "SKUs", delta: "2 at risk", status: "warn", metrics: [["Total SKUs", "10"], ["At risk (stockout)", "2"], ["Overstocked", "1"], ["Reorder lead time", "21 days"]], insight: "Two hero SKUs will stock out inside the reorder window. One slow SKU is tying up cash you could redeploy into the at-risk restock.", actions: ["Place reorder", "Discount slow SKU"] },
  { key: "launches", name: "Launches", mono: "PIPELINE", value: "4", unit: "planned", delta: "next 12d", status: "neutral", metrics: [["In pipeline", "4"], ["Next launch", "in 12 days"], ["Assets ready", "2 of 4"], ["At risk of slip", "1"]], insight: "The next launch is 12 days out with assets only half-ready. One item is likely to slip. Locking the shot list this week keeps the date honest.", actions: ["Lock shot list", "Reassign owner"] },
  { key: "operations", name: "Operations", mono: "OPEN TASKS", value: "7", unit: "tasks", delta: "1 urgent", status: "warn", metrics: [["Open tasks", "7"], ["High urgency", "1"], ["Overdue", "2"], ["Owner load", "uneven"]], insight: "One high-urgency task is overdue and blocking the reorder. Two other tasks are stale. Clearing the blocker unblocks Inventory too.", actions: ["Clear the blocker", "Rebalance owners"] },
  { key: "profit", name: "Profit & Cash", mono: "GROSS MARGIN", value: "62", unit: "%", delta: "after COGS", status: "good", metrics: [["Gross margin", "62%"], ["Net margin", "9%"], ["Runway", "5.2 mo"], ["Ad drag on net", "-14 pts"]], insight: "Product economics are healthy at 62% gross. Net is thin at 9% almost entirely because of ad waste — fix Ads and net roughly doubles without touching price.", actions: ["See margin bridge", "Set a spend cap"] },
];
const BRIEFINGS = [
  "Ads ROAS 0.59 is the biggest drag on business health right now.",
  "Two hero SKUs will stock out before the reorder lands.",
  "Organic content reach is up 4.2% — your cheapest growth lever.",
  "One overdue Operations task is blocking the inventory reorder.",
  "Net margin is thin only because of ad waste, not product cost.",
];
const TELEMETRY = [["REVENUE PACE", 44, "risk"], ["AD EFFICIENCY", 31, "risk"], ["CONTENT REACH", 72, "good"], ["INVENTORY COVER", 60, "accent"], ["TASKS ON TRACK", 58, "accent"], ["LAUNCH READINESS", 50, "accent"]];
const FEED = ["Ads spend cap suggested", "Reorder draft ready", "Content reach spiking", "Wholesale lead scored", "Margin bridge computed", "Two SKUs flagged low", "Reels sprint proposed"];

const toneColor = (s, p) => s === "risk" ? p.risk : s === "good" ? p.good : s === "warn" ? p.accent : s === "accent" ? p.accent : p.muted;

// TTS via the neural "Chief" voice, browser fallback.
let _cdAudio = null;
async function speakChief(text, lang = "en") {
  try { if (_cdAudio) { _cdAudio.pause(); _cdAudio = null; } } catch (e) {}
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
  if (!text) return;
  try {
    const r = await fetch("/api/data?op=tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang }) });
    if (r.ok) { const url = URL.createObjectURL(await r.blob()); const a = new Audio(url); _cdAudio = a; a.onended = () => { try { URL.revokeObjectURL(url); } catch (e) {} }; await a.play(); return; }
  } catch (e) {}
  try { const u = new SpeechSynthesisUtterance(text); u.rate = 0.97; u.pitch = 0.9; window.speechSynthesis.speak(u); } catch (e) {}
}

export default function CommandDashboard({ model, onNavigate }) {
  const [theme, setTheme] = useState(() => { const h = new Date().getHours(); return h >= 7 && h < 19 ? "day" : "night"; });
  const [selected, setSelected] = useState(null); // sector key
  const [thinking, setThinking] = useState(false);
  const [brief, setBrief] = useState("");
  const [q, setQ] = useState("");
  const [listening, setListening] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [jit, setJit] = useState([0, 0, 0, 0, 0, 0]);
  const [logIdx, setLogIdx] = useState(0);

  const canvasRef = useRef(null);
  const radarRef = useRef(null);
  const nodeEls = useRef({});
  const stageRef = useRef(null);
  const wrapRef = useRef(null);
  const st = useRef(null);
  const recogRef = useRef(null);
  const uptimeStart = useRef(Date.now());
  const pal = PALETTES[theme];

  // Merge live model values onto the design sectors.
  const sectors = SECTORS.map((s) => {
    const n = (model && model.nodes || []).find((x) => (x.label || "").toLowerCase().includes(s.name.split(" ")[0].toLowerCase()));
    if (!n) return s;
    return { ...s, value: n.value != null ? String(n.value) : s.value, delta: n.change || s.delta, status: n.status === "declining" ? "risk" : n.status === "improving" ? "good" : n.status === "warn" ? "warn" : s.status };
  });
  const coreScore = (model && model.healthScore != null) ? model.healthScore : 64;
  const coreStatus = (model && model.status) || "Needs attention";
  const riskCount = (model && model.risks != null) ? model.risks : ((model && model.healthNotes && model.healthNotes.length) || 4);
  const oppCount = (model && model.opportunities != null) ? model.opportunities : 1;

  // Telemetry meters derived from each sector's live status.
  const statusPct = (s) => s === "good" ? 74 : s === "warn" ? 40 : s === "risk" ? 28 : s === "neutral" ? 55 : 62;
  const meterDefs = [["REVENUE PACE", "revenue"], ["AD EFFICIENCY", "ads"], ["CONTENT REACH", "content"], ["INVENTORY COVER", "inventory"], ["TASKS ON TRACK", "operations"], ["LAUNCH READINESS", "launches"]].map(([label, key]) => { const s = sectors.find((x) => x.key === key); return { label, base: statusPct(s ? s.status : "neutral"), tone: s ? s.status : "accent" }; });
  // Live feed from real insights (fallback to the design samples).
  const feedItems = (model && model.insights && model.insights.length) ? model.insights.map((i) => i.title) : FEED;
  // Ledger from the model's projected-quarter figures.
  const L = (model && model.ledger) || {};
  const fmt$ = (n) => n == null ? "—" : "$" + Number(n).toLocaleString("en-US");

  // ── init physics + rAF field ──
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = STAGE_W * dpr; canvas.height = STAGE_H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = 700, cy = 356, R = 300, RY = 0.72, n = sectors.length;
    const jit = (i) => (Math.sin(i * 12.9898) * 43758.5453 % 1) * 6 - 3;
    const nodes = sectors.map((sec, i) => {
      const ang = (-90 + i * (360 / n) + jit(i)) * Math.PI / 180;
      const home = { x: cx + Math.cos(ang) * R, y: cy + Math.sin(ang) * R * RY };
      return { sec, home, pos: { ...home }, vel: { x: 0, y: 0 }, phase: i * 1.7, w: 186, h: 132, hover: false, _pt: 30 + i * 20 };
    });
    const particles = Array.from({ length: 26 }, () => ({ x: Math.random() * STAGE_W, y: Math.random() * STAGE_H, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25, r: Math.random() * 1.4 + 0.4 }));
    const pulses = sectors.map(() => []);
    st.current = { ctx, cx, cy, R, RY, nodes, particles, pulses, t: 0, ring: 0, radar: 0 };

    let raf;
    const pointAt = (from, to, s) => ({ x: from.x + (to.x - from.x) * s, y: from.y + (to.y - from.y) * s });
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const S = st.current; if (!S) return; S.t += 1 / 60;
      const P = PALETTES[themeRef.current];
      ctx.clearRect(0, 0, STAGE_W, STAGE_H);
      // particles
      ctx.fillStyle = P.particle;
      S.particles.forEach((p) => { p.x += p.vx; p.y += p.vy; if (p.x < 0) p.x += STAGE_W; if (p.x > STAGE_W) p.x -= STAGE_W; if (p.y < 0) p.y += STAGE_H; if (p.y > STAGE_H) p.y -= STAGE_H; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill(); });
      // physics + connections + pulses
      S.nodes.forEach((nd, i) => {
        const isDrag = S.drag && S.drag.i === i;
        if (!isDrag) { const tx = nd.home.x + Math.sin(S.t * 0.5 + nd.phase) * 7, ty = nd.home.y + Math.cos(S.t * 0.42 + nd.phase) * 7; const k = 0.02, damp = 0.86; nd.vel.x = (nd.vel.x + (tx - nd.pos.x) * k) * damp; nd.vel.y = (nd.vel.y + (ty - nd.pos.y) * k) * damp; nd.pos.x += nd.vel.x; nd.pos.y += nd.vel.y; }
        const el = nodeEls.current[nd.sec.key]; if (el) el.style.transform = `translate(${nd.pos.x - nd.w / 2}px, ${nd.pos.y - nd.h / 2}px)`;
        const from = nd.pos, to = { x: S.cx, y: S.cy };
        const active = selectedRef.current === nd.sec.key || nd.hover;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.strokeStyle = active ? P.lineStrong : P.line; ctx.lineWidth = active ? 1.4 : 0.9; ctx.stroke();
        nd._pt -= 1;
        if (nd._pt <= 0) { S.pulses[i].push({ t: 0, speed: 0.45 + Math.random() * 0.25 }); nd._pt = 150 + Math.random() * 120; }
        S.pulses[i] = S.pulses[i].filter((pu) => { pu.t += pu.speed / 100 * (thinkRef.current ? 2.4 : 1); if (pu.t > 1) return false; const pt = pointAt(from, to, pu.t); const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 6); g.addColorStop(0, P.accent); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pt.x, pt.y, 6, 0, 6.2832); ctx.fill(); ctx.fillStyle = P.accentSoft; ctx.beginPath(); ctx.arc(pt.x, pt.y, 2, 0, 6.2832); ctx.fill(); return true; });
      });
      // core rings
      S.ring += (thinkRef.current ? 0.0034 : 0.001) * 3.4 * (thinkRef.current ? 3.4 : 1);
      drawRings(ctx, S, P, S.ring);
      // radar
      drawRadar(radarRef.current, S, P);
    };
    const drawRings = (ctx, S, P, rot) => {
      const cx = S.cx, cy = S.cy, base = 274 / 2 + 8;
      ctx.strokeStyle = P.ring; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, base, 0, 6.2832); ctx.stroke();
      ctx.strokeStyle = P.line; ctx.beginPath(); ctx.arc(cx, cy, base + 22, 0, 6.2832); ctx.stroke();
      for (let k = 0; k < 72; k++) { const a = rot + k * (6.2832 / 72); const long = k % 6 === 0; const r1 = base + 4, r2 = base + (long ? 12 : 7); ctx.strokeStyle = long ? P.accentSoft : P.line; ctx.lineWidth = long ? 1 : 0.6; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke(); }
      // spikes toward each node
      S.nodes.forEach((nd) => { const a = Math.atan2(nd.pos.y - cy, nd.pos.x - cx); const active = selectedRef.current === nd.sec.key || nd.hover; const len = active ? 40 : 26; const r1 = base + 14, r2 = r1 + len; const col = nd.sec.status === "risk" ? P.risk : P.accent; ctx.strokeStyle = col; ctx.lineWidth = active ? 1.6 : 1; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke(); const dx = cx + Math.cos(a) * r2, dy = cy + Math.sin(a) * r2; ctx.fillStyle = col; ctx.save(); ctx.translate(dx, dy); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(3, 0); ctx.lineTo(0, 3); ctx.lineTo(-3, 0); ctx.lineTo(0, -3); ctx.closePath(); ctx.fill(); ctx.restore(); });
      // sweep arc
      const sa = rot * 2.2; ctx.strokeStyle = P.accentSoft; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, base + 22, sa, sa + 0.5); ctx.stroke();
    };
    const drawRadar = (rc, S, P) => {
      if (!rc) return; const c = rc.getContext("2d"); const w = rc.width, h = rc.height, cx = w / 2, cy = h / 2, rr = w / 2 - 6;
      c.clearRect(0, 0, w, h);
      c.strokeStyle = P.line; for (let g = 1; g <= 3; g++) { c.beginPath(); c.arc(cx, cy, rr * g / 3, 0, 6.2832); c.stroke(); }
      c.beginPath(); c.moveTo(cx - rr, cy); c.lineTo(cx + rr, cy); c.moveTo(cx, cy - rr); c.lineTo(cx, cy + rr); c.stroke();
      S.radar += 0.02; const a = S.radar;
      const grad = c.createConicGradient ? null : null;
      c.strokeStyle = P.accent; c.lineWidth = 1.5; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); c.stroke();
      S.nodes.forEach((nd, i) => { const ba = (-90 + i * (360 / S.nodes.length)) * Math.PI / 180; const br = rr * 0.72; const near = Math.abs(((a - ba + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > Math.PI - 0.4; c.fillStyle = nd.sec.status === "risk" ? P.risk : (near ? P.accentSoft : P.accent); c.beginPath(); c.arc(cx + Math.cos(ba) * br, cy + Math.sin(ba) * br, near ? 3 : 2, 0, 6.2832); c.fill(); });
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line

  // refs mirrored for the rAF loop (never re-inits)
  const themeRef = useRef(theme); themeRef.current = theme;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const thinkRef = useRef(thinking); thinkRef.current = thinking;

  // clock + telemetry jitter + log rotation + idle brief rotation
  useEffect(() => {
    const a = setInterval(() => setClock(new Date()), 1000);
    const b = setInterval(() => setJit((j) => j.map(() => (Math.random() - 0.5) * 4)), 2600);
    const c = setInterval(() => setLogIdx((i) => i + 1), 3200);
    const d = setInterval(() => { if (!thinkRef.current) setBrief(BRIEFINGS[Math.floor(Math.random() * BRIEFINGS.length)]); }, 6500);
    setBrief(BRIEFINGS[0]);
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); clearInterval(d); };
  }, []);

  // ── ask the Chief (real assistant) ──
  const ask = async (question) => {
    const Q = (question || "").trim(); if (!Q) return;
    setQ(""); setThinking(true); setBrief("");
    let text = "";
    try {
      const summary = { businessName: model && model.businessName, healthScore: coreScore, status: coreStatus, sectors: sectors.map((s) => `${s.name}: ${s.value}${s.unit ? " " + s.unit : ""} (${s.delta}, ${s.status})`), insights: (model && model.insights || []).slice(0, 6).map((i) => i.title + " — " + i.body) };
      const r = await fetch("/api/categorize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ system: "You are Chief, the senior operator running this business's command dashboard. Answer the owner's question in under 55 words, plainly and specifically, grounded only in the data below. No lists, no emojis. End with one concrete next move.\nData:\n" + JSON.stringify(summary), max_tokens: 300, messages: [{ role: "user", content: Q }] }) });
      const d = await r.json(); if (r.ok && d.content && d.content[0] && d.content[0].text) text = d.content[0].text.trim();
    } catch (e) {}
    if (!text) text = "I can't reach the intelligence service right now. Biggest single move from the live data: fix Ads — it drags revenue, cash, and health at once.";
    setThinking(false); setBrief(text); speakChief(text);
  };

  const startListen = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice input needs Chrome or Safari."); return; }
    try { if (recogRef.current) recogRef.current.abort(); } catch (e) {}
    const r = new SR(); r.lang = "en-US"; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e) => { const txt = (e.results[0] && e.results[0][0] && e.results[0][0].transcript) || ""; setListening(false); ask(txt.replace(/^\s*(hi|hey|hello|ok|okay)\s+chief[\s,.:!-]*/i, "").trim() || txt); };
    r.onerror = () => setListening(false); r.onend = () => setListening(false);
    recogRef.current = r; setListening(true); try { r.start(); } catch (e) { setListening(false); }
  };

  // fit the 1400×900 stage into the viewport (desktop); mobile uses a stacked view
  const [scale, setScale] = useState(1);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 820);
  useEffect(() => {
    const fit = () => { setNarrow(window.innerWidth < 820); const w = wrapRef.current; if (!w) return; setScale(Math.min(w.clientWidth / STAGE_W, (w.clientHeight || window.innerHeight - 120) / STAGE_H)); };
    fit(); window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit);
  }, []);

  // node drag
  const onPointerDown = (i, e) => { const S = st.current; if (!S) return; const r = stageRef.current.getBoundingClientRect(); const sx = r.width / STAGE_W; S.drag = { i, moved: 0, sx, ox: (e.clientX - r.left) / sx - S.nodes[i].pos.x, oy: (e.clientY - r.top) / sx - S.nodes[i].pos.y }; try { e.target.setPointerCapture(e.pointerId); } catch (er) {} };
  const onPointerMove = (e) => { const S = st.current; if (!S || !S.drag) return; const r = stageRef.current.getBoundingClientRect(); const sx = r.width / STAGE_W; const nd = S.nodes[S.drag.i]; const nx = (e.clientX - r.left) / sx - S.drag.ox, ny = (e.clientY - r.top) / sx - S.drag.oy; S.drag.moved += Math.abs(nx - nd.pos.x) + Math.abs(ny - nd.pos.y); nd.pos.x = nx; nd.pos.y = ny; };
  const onPointerUp = (i) => { const S = st.current; if (!S || !S.drag) return; const wasClick = S.drag.moved < 6; S.drag = null; if (wasClick) setSelected((cur) => cur === sectors[i].key ? null : sectors[i].key); };

  const sel = sectors.find((s) => s.key === selected);
  const cor = (s) => toneColor(s, pal);
  const hud = { background: pal.hudBg, border: `1px solid ${pal.cardBorder}`, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", position: "absolute", boxSizing: "border-box" };
  const bracket = (pos) => (<span style={{ position: "absolute", width: 11, height: 11, borderColor: pal.accentSoft, ...pos }} />);
  const Brackets = () => (<>{bracket({ top: -1, left: -1, borderTop: "1px solid", borderLeft: "1px solid" })}{bracket({ top: -1, right: -1, borderTop: "1px solid", borderRight: "1px solid" })}{bracket({ bottom: -1, left: -1, borderBottom: "1px solid", borderLeft: "1px solid" })}{bracket({ bottom: -1, right: -1, borderBottom: "1px solid", borderRight: "1px solid" })}</>);

  // ── Mobile: a stacked, readable version of the same dashboard ──
  if (narrow) {
    return (
      <div style={{ background: pal.bg, minHeight: "calc(100vh - 110px)", padding: "16px 14px 96px", position: "relative" }}>
        <button onClick={() => setTheme((t) => t === "day" ? "night" : "day")} style={{ ...tbtn(pal), position: "absolute", top: 12, right: 12 }}>{theme === "day" ? "DAY" : "NIGHT"}</button>
        <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 3, color: pal.muted }}>BUSINESS HEALTH</div>
          <div style={{ fontFamily: serifD, fontSize: 92, fontWeight: 300, color: pal.ink, lineHeight: 0.95 }}>{coreScore}</div>
          <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: 3, color: pal.accent, textTransform: "uppercase" }}>{coreStatus}</div>
          <div style={{ fontFamily: mono, fontSize: 10, color: pal.muted, marginTop: 4 }}>{oppCount} opportunity · {riskCount} risks</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {sectors.map((s) => (
            <div key={s.key} onClick={() => setSelected(selected === s.key ? null : s.key)} style={{ background: pal.card, border: `1px solid ${selected === s.key ? pal.accent : pal.cardBorder}`, boxShadow: pal.shadow, padding: "12px 14px", cursor: "pointer", gridColumn: selected === s.key ? "1 / -1" : "auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: cor(s.status) }} /><span style={{ fontFamily: serifD, fontSize: 18, color: pal.ink }}>{s.name}</span></div>
              <div style={{ fontFamily: mono, fontSize: 8, letterSpacing: 1.4, color: pal.muted, margin: "3px 0" }}>{s.mono}</div>
              <div style={{ fontFamily: serifD, fontSize: 22, color: pal.ink }}>{s.value}<span style={{ fontFamily: mono, fontSize: 10, color: pal.muted }}> {s.unit}</span></div>
              <div style={{ fontFamily: mono, fontSize: 9, color: cor(s.status), marginTop: 2 }}>{s.delta}</div>
              {selected === s.key && (
                <div style={{ marginTop: 10, borderTop: `1px solid ${pal.line}`, paddingTop: 8 }}>
                  {s.metrics.map((m, j) => (<div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span style={{ fontFamily: mono, fontSize: 9, letterSpacing: 1, color: pal.muted, textTransform: "uppercase" }}>{m[0]}</span><span style={{ fontFamily: serifD, fontSize: 15, color: pal.ink }}>{m[1]}</span></div>))}
                  <div style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: 1.5, color: pal.accent, margin: "8px 0 4px" }}>CHIEF'S READ</div>
                  <div style={{ fontFamily: serifD, fontSize: 15, color: pal.ink, lineHeight: 1.45 }}>{s.insight}</div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2.2, color: pal.muted, marginBottom: 10 }}>SECTOR HEALTH · %</div>
          {meterDefs.map((m, i) => { const v = Math.max(8, Math.min(96, Math.round(m.base + jit[i]))); return (
            <div key={m.label} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2, color: pal.muted }}>{m.label}</span><span style={{ fontFamily: serifD, fontSize: 15, color: pal.ink }}>{v}</span></div>
              <div style={{ height: 3, background: pal.line, marginTop: 3 }}><div style={{ height: "100%", width: v + "%", background: cor(m.tone) }} /></div>
            </div>
          ); })}
        </div>
        <div style={{ marginTop: 18, border: `1px solid ${pal.cardBorder}`, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2, color: pal.muted }}>PROJ. QUARTER · NET</div><div style={{ fontFamily: serifD, fontSize: 30, color: pal.ink }}>{L.quarterNet != null ? fmt$(L.quarterNet) : "—"}</div></div>
          <div style={{ textAlign: "right", fontFamily: mono, fontSize: 10 }}><div style={{ color: pal.good }}>GROSS {fmt$(L.quarterGross)}</div><div style={{ color: pal.risk, marginTop: 3 }}>COSTS {fmt$(L.quarterCosts)}</div></div>
        </div>
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: pal.bg, borderTop: `1px solid ${pal.cardBorder}`, padding: "10px 12px", zIndex: 30 }}>
          {brief && <div style={{ fontFamily: serifD, fontStyle: "italic", fontSize: 13, color: pal.muted, textAlign: "center", marginBottom: 8 }}>{thinking ? "Chief is thinking…" : "Chief · " + brief}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => (listening ? recogRef.current && recogRef.current.stop() : startListen())} style={{ ...tbtn(pal), border: `1px solid ${listening ? pal.risk : pal.accent}`, color: listening ? pal.risk : pal.accent, fontSize: 14 }}>{listening ? "●" : "🎙"}</button>
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask(q)} placeholder="Ask the Chief…" style={{ flex: 1, background: pal.card, border: `1px solid ${pal.cardBorder}`, color: pal.ink, fontFamily: serifD, fontSize: 16, padding: "10px 14px", outline: "none" }} />
            <button onClick={() => ask(q)} style={{ border: "none", background: pal.ink, color: pal.bg, fontFamily: mono, fontSize: 11, letterSpacing: 2, padding: "0 16px" }}>ASK</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={{ background: pal.bg, transition: "background .5s ease", minHeight: "calc(100vh - 120px)", overflow: "hidden", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
      <div ref={stageRef} onPointerMove={onPointerMove} style={{ width: STAGE_W, height: STAGE_H, position: "relative", transform: `scale(${scale})`, transformOrigin: "top center", flex: "0 0 auto" }}>
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: STAGE_W, height: STAGE_H }} />

        {/* status strip */}
        <div style={{ ...hud, top: 14, left: 24, right: 214, height: 30, display: "flex", alignItems: "center", padding: "0 14px", fontFamily: mono, fontSize: 10, letterSpacing: 1.5, color: pal.muted }}>
          <Brackets />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: pal.good }} /> CHIEF v2.4.0 · ONLINE</span>
          <span style={{ margin: "0 auto", color: pal.ink }}>{clock.toLocaleTimeString("en-US", { hour12: false })}</span>
          <span>UPTIME {fmtUptime(Date.now() - uptimeStart.current)}</span>
        </div>
        {/* top-right toggles */}
        <div style={{ position: "absolute", top: 22, right: 26, display: "flex", gap: 10, fontFamily: mono, fontSize: 10, letterSpacing: 1.5 }}>
          <button onClick={() => setTheme((t) => t === "day" ? "night" : "day")} style={tbtn(pal)}>{theme === "day" ? "DAY" : "NIGHT"}</button>
        </div>

        {/* left telemetry rail */}
        <div style={{ ...hud, top: 60, left: 24, width: 236, height: 648, padding: 16 }}>
          <Brackets />
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2.2, color: pal.muted, marginBottom: 12 }}>SECTOR HEALTH · %</div>
          {meterDefs.map((m, i) => { const v = Math.max(8, Math.min(96, Math.round(m.base + jit[i]))); return (
            <div key={m.label} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2.2, color: pal.muted }}>{m.label}</span>
                <span style={{ fontFamily: serifD, fontSize: 16, color: pal.ink }}>{v}</span>
              </div>
              <div style={{ height: 3, background: pal.line, marginTop: 4 }}><div style={{ height: "100%", width: v + "%", background: cor(m.tone), transition: "width .8s ease" }} /></div>
            </div>
          ); })}
          <div style={{ height: 1, background: pal.line, margin: "16px 0" }} />
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2.2, color: pal.muted, marginBottom: 8 }}>ACTIVE SIGNALS</div>
          {[0, 1, 2, 3].map((k) => { const idx = (logIdx + k) % feedItems.length; return <div key={k} style={{ fontFamily: mono, fontSize: 10, color: pal.ink, opacity: 1 - k * 0.22, padding: "3px 0" }}>› {feedItems[idx]}</div>; })}
        </div>

        {/* right radar + sparkline */}
        <div style={{ ...hud, top: 60, right: 24, width: 210, height: 210, padding: 12 }}>
          <Brackets />
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2.2, color: pal.muted, marginBottom: 6 }}>SECTOR RADAR</div>
          <canvas ref={radarRef} width={186} height={150} style={{ width: 186, height: 150 }} />
        </div>
        {/* right live feed */}
        <div style={{ ...hud, top: 286, right: 24, width: 210, height: 414, padding: 14, overflow: "hidden" }}>
          <Brackets />
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2.2, color: pal.muted, marginBottom: 8 }}>LIVE FEED</div>
          {feedItems.slice(0, 7).map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "8px 0", borderBottom: `1px solid ${pal.line}` }}>
              <span style={{ fontFamily: mono, fontSize: 9, color: pal.accent, flexShrink: 0 }}>{fmtClock(clock, i)}</span>
              <span style={{ fontFamily: mono, fontSize: 10.5, color: pal.ink, lineHeight: 1.35 }}>{f}</span>
            </div>
          ))}
        </div>

        {/* core */}
        <div onClick={() => setSelected("__core")} style={{ position: "absolute", left: 700 - 137, top: 356 - 137, width: 274, height: 274, borderRadius: "50%", background: pal.card, border: `1px solid ${pal.cardBorder}`, boxShadow: pal.shadow, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 8, cursor: "pointer", animation: "cd-breathe 7s ease-in-out infinite" }}>
          {thinking ? (
            <>
              <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 40 }}>{[0, 1, 2, 3, 4, 5, 6].map((i) => <span key={i} style={{ width: 4, background: pal.accent, height: 12, animation: `cd-wave 1s ${i * 0.08}s ease-in-out infinite` }} />)}</div>
              <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: 3, color: pal.accent, marginTop: 14 }}>CHIEF IS THINKING</div>
            </>
          ) : (
            <>
              <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: 3, color: pal.muted, marginBottom: 6 }}>BUSINESS HEALTH</div>
              <div style={{ fontFamily: serifD, fontSize: 118, fontWeight: 300, color: pal.ink, lineHeight: 0.9 }}>{coreScore}</div>
              <div style={{ fontFamily: mono, fontSize: 12, letterSpacing: 4, color: pal.accent, textTransform: "uppercase", marginTop: 4 }}>{coreStatus}</div>
              <div style={{ fontFamily: mono, fontSize: 10, color: pal.muted, marginTop: 6 }}>{oppCount} opportunity · {riskCount} risks</div>
            </>
          )}
        </div>

        {/* sector nodes */}
        {sectors.map((s, i) => (
          <div key={s.key} ref={(el) => (nodeEls.current[s.key] = el)}
            onPointerDown={(e) => onPointerDown(i, e)} onPointerUp={() => onPointerUp(i)}
            onPointerEnter={() => { if (st.current) st.current.nodes[i].hover = true; }} onPointerLeave={() => { if (st.current) st.current.nodes[i].hover = false; }}
            style={{ position: "absolute", left: 0, top: 0, width: 186, height: 132, borderRadius: "50% / 50%", background: pal.card, border: `1px solid ${selected === s.key ? pal.accent : pal.cardBorder}`, boxShadow: pal.shadow, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 10, cursor: "grab", touchAction: "none", willChange: "transform" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: cor(s.status), marginBottom: 4 }} />
            <div style={{ fontFamily: serifD, fontSize: 23, fontWeight: 500, color: pal.ink, lineHeight: 1 }}>{s.name}</div>
            <div style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: 1.6, color: pal.muted, margin: "2px 0" }}>{s.mono}</div>
            <div style={{ fontFamily: serifD, fontSize: 26, color: pal.ink, lineHeight: 1 }}>{s.value}<span style={{ fontFamily: mono, fontSize: 11, color: pal.muted, letterSpacing: 0.5 }}> {s.unit}</span></div>
            <div style={{ fontFamily: mono, fontSize: 9, color: cor(s.status), marginTop: 2 }}>{s.delta}</div>
          </div>
        ))}

        {/* ledger */}
        <div style={{ ...hud, bottom: 150, left: 700 - 235, width: 470, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Brackets />
          <div>
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2.2, color: pal.muted }}>PROJECTED QUARTER · NET</div>
            <div style={{ fontFamily: serifD, fontSize: 38, color: pal.ink }}>{L.quarterNet != null ? fmt$(L.quarterNet) : "—"} <span style={{ fontFamily: mono, fontSize: 11, color: pal.muted }}>{L.quarterNet != null ? "proj" : "syncing"}</span></div>
          </div>
          <div style={{ textAlign: "right", fontFamily: mono, fontSize: 11 }}>
            <div style={{ color: pal.good }}>GROSS {fmt$(L.quarterGross)}</div>
            <div style={{ color: pal.risk, marginTop: 4 }}>COSTS {fmt$(L.quarterCosts)}</div>
          </div>
        </div>

        {/* ask bar */}
        <div style={{ position: "absolute", left: 36, right: 36, bottom: 30, zIndex: 12 }}>
          <div style={{ fontFamily: serifD, fontStyle: "italic", fontSize: 17, color: pal.muted, textAlign: "center", minHeight: 24, marginBottom: 10, transition: "opacity .5s" }}>{brief ? "Chief · " + brief : ""}</div>
          <div style={{ display: "flex", gap: 10, maxWidth: 720, margin: "0 auto" }}>
            <button onClick={() => (listening ? recogRef.current && recogRef.current.stop() : startListen())} title="Ask out loud — “Hi Chief, what are today's stats?”"
              style={{ ...tbtn(pal), padding: "0 16px", border: `1px solid ${listening ? pal.risk : pal.accent}`, color: listening ? pal.risk : pal.accent, fontSize: 11 }}>{listening ? "● LISTENING" : "🎙 HI CHIEF"}</button>
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask(q)} placeholder="Ask the Chief anything about the business…"
              style={{ flex: 1, background: pal.card, border: `1px solid ${pal.cardBorder}`, color: pal.ink, fontFamily: serifD, fontSize: 18, padding: "12px 18px", outline: "none" }} />
            <button onClick={() => ask(q)} style={{ border: "none", cursor: "pointer", padding: "0 34px", background: pal.ink, color: pal.bg, fontFamily: mono, fontSize: 12, letterSpacing: 4 }}>ASK</button>
          </div>
        </div>

        {/* detail panel */}
        <div style={{ position: "fixed", top: 0, right: 0, width: 400, height: "100%", background: pal.panelBg, borderLeft: `1px solid ${pal.cardBorder}`, backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", boxShadow: pal.shadow, padding: "34px 30px", overflowY: "auto", zIndex: 40, transform: (sel || selected === "__core") ? "translateX(0)" : "translateX(101%)", transition: "transform .55s cubic-bezier(.16,1,.3,1)", boxSizing: "border-box" }}>
          <button onClick={() => setSelected(null)} style={{ position: "absolute", top: 20, right: 22, background: "none", border: "none", color: pal.muted, fontSize: 22, cursor: "pointer" }}>×</button>
          {selected === "__core" ? (
            <div>
              <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2, color: pal.muted }}>EXECUTIVE BRIEF</div>
              <div style={{ fontFamily: serifD, fontSize: 64, color: pal.ink, lineHeight: 1, marginTop: 6 }}>{coreScore} <span style={{ fontSize: 20, fontStyle: "italic", color: pal.accent }}>{coreStatus}</span></div>
              {(model && model.insights || []).slice(0, 6).map((ins) => (
                <div key={ins.id || ins.title} style={{ padding: "12px 0", borderBottom: `1px solid ${pal.line}` }}>
                  <div style={{ fontFamily: serifD, fontSize: 18, color: pal.ink }}>{ins.title}</div>
                  <div style={{ fontFamily: serifD, fontStyle: "italic", fontSize: 13.5, color: pal.muted, marginTop: 3 }}>{ins.body}</div>
                </div>
              ))}
            </div>
          ) : sel ? (
            <div>
              <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2, color: pal.muted }}>{sel.mono}</div>
              <div style={{ fontFamily: serifD, fontSize: 38, color: pal.ink, lineHeight: 1, marginTop: 4 }}>{sel.name}</div>
              <div style={{ fontFamily: serifD, fontSize: 64, color: pal.ink, lineHeight: 1, margin: "10px 0 2px" }}>{sel.value}<span style={{ fontFamily: mono, fontSize: 14, color: pal.muted }}> {sel.unit}</span></div>
              <div style={{ fontFamily: mono, fontSize: 11, color: cor(sel.status), marginBottom: 18 }}>{sel.delta}</div>
              {sel.metrics.map((m, j) => (
                <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderBottom: `1px solid ${pal.line}` }}>
                  <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1, color: pal.muted, textTransform: "uppercase" }}>{m[0]}</span>
                  <span style={{ fontFamily: serifD, fontSize: 19, color: pal.ink }}>{m[1]}</span>
                </div>
              ))}
              <div style={{ background: pal.card, border: `1px solid ${pal.cardBorder}`, padding: "16px 18px", margin: "18px 0" }}>
                <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2, color: pal.accent, marginBottom: 8 }}>CHIEF'S READ</div>
                <div style={{ fontFamily: serifD, fontSize: 19, lineHeight: 1.5, color: pal.ink }}>{sel.insight}</div>
              </div>
              {sel.actions.map((a, j) => (
                <button key={j} onClick={() => onNavigate && onNavigate({ tab: sel.key === "content" ? "content" : sel.key === "ads" ? "ads" : sel.key === "inventory" ? "inventory" : "profit" })}
                  style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer", padding: "15px 18px", marginBottom: 8, fontFamily: mono, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", background: j === 0 ? pal.ink : "transparent", color: j === 0 ? pal.bg : pal.ink, border: `1px solid ${j === 0 ? pal.ink : pal.cardBorder}` }}>{a}</button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <style>{`@keyframes cd-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.012)}}@keyframes cd-wave{0%,100%{height:10px}50%{height:34px}}`}</style>
    </div>
  );
}

function tbtn(pal) { return { background: "transparent", border: `1px solid ${pal.cardBorder}`, color: pal.muted, fontFamily: mono, fontSize: 10, letterSpacing: 1.5, padding: "8px 12px", cursor: "pointer" }; }
function fmtUptime(ms) { const s = Math.floor(ms / 1000); return String(Math.floor(s / 3600)).padStart(2, "0") + ":" + String(Math.floor(s / 60) % 60).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
function fmtClock(d, offset) { const t = new Date(d.getTime() - offset * 7 * 60000); return t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }); }
