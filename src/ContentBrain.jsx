import { useEffect, useMemo, useState } from "react";

// LAVALLE HAUS OS — Content Brain
// The Business Brain's node map, tuned to content: one brain per account
// (Lavalle Sisters · Lavalle Haus · The Fold) plus an all-accounts view.
// Bubbles = the sub-categories that drive content health; tap one to jump
// to the place it's managed (Schedule, Analytics, the boards below).

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", red: "#9b5e5e", green: "#5a7a5a" };
const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const serif = "Georgia, 'Times New Roman', serif";

// workspace ↔ Instagram account mapping (TikTok joins after its app review)
const BRANDS = [
  { ws: "lavalle-sisters", label: "Lavalle Sisters", ig: "lavallesisters" },
  { ws: "lavalle-haus", label: "Lavalle Haus", ig: "refilleryhaus" },
  { ws: "the-fold", label: "The Fold", ig: "thefoldlabel" },
];

const goSeg = (seg) => {
  try { localStorage.setItem("lh_seg_content", seg); } catch {}
  window.dispatchEvent(new CustomEvent("lh-seg", { detail: { id: "content", seg } }));
};

export default function ContentBrain({ boards, gridPlanner }) {
  const [view, setView] = useState("all"); // "all" | ws id
  const [live, setLive] = useState(null); // op=ig_insights&light=1 — owner only

  useEffect(() => {
    fetch("/api/data?op=ig_insights&light=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setLive(d.accounts || []))
      .catch(() => {});
  }, []);

  const model = useMemo(() => {
    if (!boards) return null;
    const brands = view === "all" ? BRANDS : BRANDS.filter((b) => b.ws === view);
    const cards = Object.entries(boards)
      .filter(([k, b]) => !k.startsWith("_") && b && b.cards && brands.some((br) => (b.ws || k) === br.ws || k.startsWith(br.ws)))
      .flatMap(([k, b]) => b.cards.map((cd) => ({ ...cd, _ws: b.ws || k })));
    const accountNames = brands.map((b) => b.ig).filter(Boolean);
    const feeds = ((gridPlanner && gridPlanner.feeds) || []).filter((f) => accountNames.includes((f.account || "").toLowerCase()));
    const items = feeds.flatMap((f) => f.items || []);
    const armed = cards.filter((cd) => cd.pub && cd.pub.auto && cd.pub.status === "scheduled").length
      + items.filter((it) => it.pub && it.pub.auto && it.pub.status === "scheduled").length;
    const posted30 = cards.filter((cd) => cd.pub && cd.pub.status === "published" && Date.now() - new Date(cd.pub.publishedAt || 0) < 30 * 86400000).length
      + items.filter((it) => it.pub && it.pub.status === "published" && Date.now() - new Date(it.pub.publishedAt || 0) < 30 * 86400000).length;
    const backlogPer = brands.map((br) => ({
      label: br.label,
      n: cards.filter((cd) => cd._ws === br.ws && /post\s*\d+/i.test(cd.name || "") && !cd.done && !(cd.pub && ((cd.pub.status === "scheduled" && cd.pub.auto) || cd.pub.status === "published"))).length,
    }));
    const backlog = backlogPer.reduce((s, x) => s + x.n, 0);
    const liveFor = (live || []).filter((a) => brands.some((br) => br.ig === (a.username || "").toLowerCase()));
    const followers = liveFor.length ? liveFor.reduce((s, a) => s + (a.followers || 0), 0) : null;
    const eng = (() => {
      const withItems = liveFor.filter((a) => a.items && a.items.length && a.followers);
      if (!withItems.length) return null;
      const rates = withItems.map((a) => {
        const n = a.items.length;
        const lc = a.items.reduce((s, x) => s + (x.likes || 0) + (x.comments || 0), 0) / n;
        return (lc / a.followers) * 100;
      });
      return (rates.reduce((s, x) => s + x, 0) / rates.length).toFixed(1) + "%";
    })();
    const boardsCount = Object.entries(boards).filter(([k, b]) => !k.startsWith("_") && b && b.lists && brands.some((br) => (b.ws || k) === br.ws || k.startsWith(br.ws))).length;
    const igConnected = brands.map((br) => ({ label: br.label, on: (live || []).some((a) => (a.username || "").toLowerCase() === br.ig) })).filter((x) => x.on).length;
    // content health — transparent composite, mirrors the Business Brain tone
    let score = 50;
    score += Math.min(25, armed * 5);
    score += Math.min(20, posted30 * 2);
    score -= Math.min(25, Math.round(backlog / 4));
    if (eng != null) { const e = parseFloat(eng); score += e >= 1 ? 10 : e >= 0.5 ? 5 : 0; }
    score = Math.max(5, Math.min(98, Math.round(score)));
    const status = score >= 75 ? "Good" : score >= 55 ? "Steady" : "Needs attention";
    return { armed, posted30, backlog, backlogPer, followers, eng, boardsCount, score, status, brands, igConnected };
  }, [boards, gridPlanner, view, live]);

  if (!model) return null;

  const bubbles = [
    { id: "scheduled", title: "Scheduled", value: String(model.armed), sub: "armed to post", tone: model.armed ? c.green : c.red, x: 10, y: 12, go: () => goSeg("grid") },
    { id: "posted", title: "Posted", value: String(model.posted30), sub: "last 30 days", tone: model.posted30 ? c.green : c.sub, x: 76, y: 8, go: () => goSeg("analytics") },
    { id: "backlog", title: "To schedule", value: String(model.backlog), sub: model.backlogPer.filter((x) => x.n > 0).map((x) => x.label.split(" ")[0] + " " + x.n).join(" · ") || "all scheduled", tone: model.backlog > 20 ? c.red : model.backlog ? c.taupe : c.green, x: 5, y: 60, go: null },
    { id: "followers", title: "Followers", value: model.followers != null ? (model.followers >= 1000 ? (model.followers / 1000).toFixed(1) + "k" : String(model.followers)) : "—", sub: model.followers != null ? "across " + model.igConnected + " connected" : "connect / owner view", tone: c.ink, x: 80, y: 56, go: () => goSeg("analytics") },
    { id: "engagement", title: "Engagement", value: model.eng || "—", sub: model.eng ? "likes + comments / followers" : "see Analytics", tone: model.eng && parseFloat(model.eng) >= 1 ? c.green : c.taupe, x: 27, y: 82, go: () => goSeg("analytics") },
    { id: "boards", title: "Boards", value: String(model.boardsCount), sub: "live below", tone: c.ink, x: 62, y: 84, go: null },
  ];

  return (
    <div style={{ marginBottom: 30 }}>
      {/* brand selector — each brain on its own, or all together */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginRight: 6 }}>Content brain</span>
        {[{ ws: "all", label: "All accounts" }, ...BRANDS].map((b) => (
          <button key={b.ws} onClick={() => setView(b.ws)}
            style={{ padding: "6px 13px", borderRadius: 1, cursor: "pointer", fontFamily: sans, fontSize: 9.5, letterSpacing: 1.5, textTransform: "uppercase", border: `1px solid ${view === b.ws ? c.ink : c.line}`, background: c.bg, color: view === b.ws ? c.ink : c.sub, fontWeight: view === b.ws ? 500 : 400 }}>
            {b.label}
          </button>
        ))}
      </div>

      <div style={{ position: "relative", height: 340, background: c.card, border: `1px solid ${c.line}`, borderRadius: 2, overflow: "hidden" }}>
        {/* dotted connectors, center → each bubble */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          {bubbles.map((b) => (
            <line key={b.id} x1="50" y1="50" x2={b.x + 9} y2={b.y + 9} stroke="#D9D3C8" strokeWidth="0.25" strokeDasharray="1.4 1.6" />
          ))}
        </svg>

        {/* the center — content health */}
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: 168, height: 168, borderRadius: "50%", background: `conic-gradient(${model.score >= 75 ? c.green : model.score >= 55 ? c.taupe : c.red} ${model.score * 3.6}deg, #E8E4DC 0deg)`, padding: 5, boxShadow: "0 10px 34px rgba(26,26,26,0.10)" }}>
          <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: c.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 2, textTransform: "uppercase", color: c.taupe }}>Content health</div>
            <div style={{ fontFamily: sans, fontSize: 44, fontWeight: 300, color: c.ink, lineHeight: 1.05 }}>{model.score}</div>
            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: model.score >= 75 ? c.green : model.score >= 55 ? c.sub : c.red }}>{model.status}</div>
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10, color: c.sub, marginTop: 2 }}>{view === "all" ? "all accounts" : (BRANDS.find((b) => b.ws === view) || {}).label}</div>
          </div>
        </div>

        {/* the sub-brains */}
        {bubbles.map((b) => (
          <div key={b.id} onClick={b.go || undefined} title={b.title + " — " + b.sub}
            style={{ position: "absolute", left: b.x + "%", top: b.y + "%", width: 122, height: 122, borderRadius: "50%", background: c.bg, border: `1px solid ${c.line}`, boxShadow: "0 6px 20px rgba(26,26,26,0.07)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", cursor: b.go ? "pointer" : "default", padding: 8, boxSizing: "border-box" }}>
            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub }}>{b.title}</div>
            <div style={{ fontFamily: sans, fontSize: 24, fontWeight: 300, color: b.tone, lineHeight: 1.15 }}>{b.value}</div>
            <div style={{ fontFamily: sans, fontSize: 8.5, color: c.sub, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.sub}</div>
          </div>
        ))}

        {/* TikTok note, quiet corner */}
        <div style={{ position: "absolute", right: 10, bottom: 8, fontFamily: serif, fontStyle: "italic", fontSize: 10, color: c.sub, opacity: 0.8 }}>♪ TikTok joins after app review</div>
      </div>
    </div>
  );
}
