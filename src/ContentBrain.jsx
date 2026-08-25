import { useEffect, useMemo, useState } from "react";
import { BrainCanvas, BRAIN_THEMES } from "./BusinessBrain.jsx";

// LAVALLE HAUS OS — Content Brain
// The Business Brain's living neural map, tuned to content: drifting nodes,
// synapse impulses, day/night — one brain per account (Lavalle Sisters ·
// Lavalle Haus · The Fold) plus the all-accounts view. Tapping a node jumps
// to where that number is managed.

const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const serif = "Georgia, 'Times New Roman', serif";

// workspace ↔ Instagram account mapping (TikTok joins after its app review)
const BRANDS = [
  { ws: "lavalle-sisters", label: "Lavalle Sisters", ig: "lavallesisters" },
  { ws: "lavalle-haus", label: "Lavalle Haus", ig: "refilleryhaus" },
  { ws: "the-fold", label: "The Fold", ig: "thefoldlabel" },
];

import { WORKSPACES } from "./Boards.jsx";

const goSeg = (seg) => {
  try { localStorage.setItem("lh_seg_content", seg); } catch {}
  window.dispatchEvent(new CustomEvent("lh-seg", { detail: { id: "content", seg } }));
};

const CONTENT_PURPOSE = {
  q: "Is the content engine running?",
  body: "Scheduled posts and recent publishing push this up; an unscheduled backlog pulls it down; strong engagement earns a bonus.",
  qEs: "¿Está funcionando el motor de contenido?",
  bodyEs: "Las publicaciones programadas y recientes lo suben; el atraso sin programar lo baja; el buen engagement suma.",
};

export default function ContentBrain({ boards, gridPlanner }) {
  // board-access scoping: brand chips only for brands with a visible board
  // (the server already strips boards the viewer can't open).
  const visBrands = BRANDS.filter((b) => { if (!boards) return true; const keys = Object.keys(boards); const w = (typeof WORKSPACES !== "undefined" ? WORKSPACES : []).find((x) => x.id === b.ws); return (w && w.boards.some((k) => boards[k])) || keys.some((k) => boards[k] && boards[k].ws === b.ws); });
  const [view, setView] = useState(() => { try { return localStorage.getItem("lh_brand_view") || "all"; } catch { return "all"; } }); // "all" | ws id — picking a brand here filters EVERY content sub-tab and sticks
  useEffect(() => { try { localStorage.setItem("lh_brand_view", view); } catch {} window.dispatchEvent(new CustomEvent("lh-brand-view", { detail: view })); }, [view]);
  const [live, setLive] = useState(null); // op=ig_insights&light=1 — owner only
  const [themeId, setThemeId] = useState(() => { try { return localStorage.getItem("lh_cb_theme") || "day"; } catch { return "day"; } });
  useEffect(() => { try { localStorage.setItem("lh_cb_theme", themeId); } catch {} }, [themeId]);
  const t = BRAIN_THEMES[themeId] || BRAIN_THEMES.day;

  const [conn, setConn] = useState(null); // {ig:[usernames], tiktok:[names]} — owner only
  const loadConn = () => {
    Promise.all([
      fetch("/api/data?op=instagram_status").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/data?op=tiktok_status").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([ig, tk]) => {
      if (!ig && !tk) return;
      const tkAll = tk ? [...((tk.production && tk.production.accounts) || []), ...((tk.sandbox && tk.sandbox.accounts) || [])] : [];
      setConn({ ig: ((ig && ig.accounts) || []).map((a) => (a.username || "").toLowerCase()), tiktok: tkAll.map((a) => (a.display_name || "").toLowerCase()) });
    });
  };
  useEffect(() => {
    fetch("/api/data?op=ig_insights&light=1").then((r) => (r.ok ? r.json() : null)).then((d) => d && setLive(d.accounts || [])).catch(() => {});
    loadConn();
    const onFocus = () => loadConn();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
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
    const igConnected = brands.filter((br) => (live || []).some((a) => (a.username || "").toLowerCase() === br.ig)).length;
    let score = 50;
    score += Math.min(25, armed * 5);
    score += Math.min(20, posted30 * 2);
    score -= Math.min(25, Math.round(backlog / 4));
    if (eng != null) { const e = parseFloat(eng); score += e >= 1 ? 10 : e >= 0.5 ? 5 : 0; }
    score = Math.max(5, Math.min(98, Math.round(score)));
    const status = score >= 75 ? "Good" : score >= 55 ? "Steady" : "Needs attention";
    const fmtK = (n) => (n == null ? "—" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
    const nodes = [
      { id: "scheduled", label: "Scheduled", value: armed + " armed", change: armed ? "auto-posting on" : "nothing armed", status: armed ? "improving" : "declining", purpose: { q: "What goes out next?", body: "Posts armed with a date and auto-publish. Tap to open the Schedule calendar.", qEs: "¿Qué sale después?", bodyEs: "Publicaciones armadas con fecha y auto-publicación." } },
      { id: "posted", label: "Posted", value: posted30 + " in 30 days", change: posted30 ? "engine running" : "quiet month", status: posted30 ? "improving" : "steady", purpose: { q: "Is the feed alive?", body: "What actually went out through the app in the last 30 days.", qEs: "¿Está vivo el feed?", bodyEs: "Lo publicado en los últimos 30 días." } },
      { id: "backlog", label: "To schedule", value: backlog + " posts", change: backlogPer.filter((x) => x.n > 0).map((x) => x.label.split(" ")[0] + " " + x.n).join(" · ") || "all scheduled", status: backlog > 20 ? "declining" : "steady", purpose: { q: "What's waiting for a slot?", body: "Planned post cards without a scheduled date yet — the working backlog on the boards below.", qEs: "¿Qué espera su turno?", bodyEs: "Tarjetas de posts sin fecha programada." } },
      { id: "followers", label: "Followers", value: fmtK(followers), change: followers != null ? "across " + igConnected + " connected" : "owner view", status: "steady", purpose: { q: "How big is the audience?", body: "Live follower count across the connected Instagram accounts. Tap for Analytics.", qEs: "¿Qué tan grande es la audiencia?", bodyEs: "Seguidores en vivo de las cuentas conectadas." } },
      { id: "engagement", label: "Engagement", value: eng || "—", change: eng ? "likes+comments / followers" : "see Analytics", status: eng && parseFloat(eng) >= 1 ? "improving" : "steady", purpose: { q: "Does the audience care?", body: "Average likes + comments per recent post, divided by followers. Live from Instagram.", qEs: "¿Le importa a la audiencia?", bodyEs: "Likes + comentarios promedio entre seguidores." } },
      { id: "boards", label: "Boards", value: boardsCount + " live", change: "below", status: "steady", purpose: { q: "Where the work lives", body: "The content boards for this view — planning, assets, approvals.", qEs: "Dónde vive el trabajo", bodyEs: "Los tableros de contenido de esta vista." } },
    ];
    return { healthScore: score, status, opportunities: armed, risks: backlogPer.filter((x) => x.n > 0).length, nodes, insights: [], priorities: [], caption: armed + " armed · " + backlog + " to schedule", brandLabel: view === "all" ? "all accounts" : (BRANDS.find((b) => b.ws === view) || {}).label };
  }, [boards, gridPlanner, view, live]);

  if (!model) return null;

  const onSelect = (id) => {
    if (id === "scheduled") goSeg("grid");
    else if (id === "posted" || id === "followers" || id === "engagement") goSeg("analytics");
  };

  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: t.accent }}>Content brain</span>
        {(visBrands.length > 1 ? [{ ws: "all", label: "All accounts" }, ...visBrands] : []).map((b) => (
          <button key={b.ws} onClick={() => setView(b.ws)}
            style={{ padding: "6px 13px", borderRadius: 1, cursor: "pointer", fontFamily: sans, fontSize: 9.5, letterSpacing: 1.5, textTransform: "uppercase", border: `1px solid ${view === b.ws ? t.brass : t.line}`, background: "transparent", color: view === b.ws ? t.ink : t.sub, fontWeight: view === b.ws ? 500 : 400 }}>
            {b.label}
          </button>
        ))}
        <button onClick={() => setThemeId(themeId === "day" ? "night" : "day")} title="Switch the brain's lighting"
          style={{ marginLeft: "auto", padding: "6px 13px", borderRadius: 1, cursor: "pointer", fontFamily: sans, fontSize: 9.5, letterSpacing: 1.5, textTransform: "uppercase", border: `1px solid ${t.line}`, background: "transparent", color: t.sub }}>
          {themeId === "day" ? "◐ Night" : "◑ Day"}
        </button>
      </div>

      {/* account connections — one row per brand, connect where missing */}
      {conn && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {BRANDS.filter((b) => view === "all" || b.ws === view).map((b) => {
            const igOn = b.ig && conn.ig.includes(b.ig);
            return (
              <div key={b.ws} style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${t.line}`, borderRadius: 2, padding: "6px 10px", background: t.card }}>
                <span style={{ fontFamily: sans, fontSize: 10.5, color: t.ink }}>{b.label}</span>
                {igOn ? (
                  <span title={"@" + b.ig + " connected"} style={{ fontFamily: sans, fontSize: 9, letterSpacing: 0.5, color: t.green }}>◉ IG ✓</span>
                ) : (
                  <button onClick={() => { window.open("/api/instagram-auth", "_blank"); }} title={"Connect this brand's Instagram (log in as @" + (b.ig || "the account") + ")"}
                    style={{ fontFamily: sans, fontSize: 9, letterSpacing: 0.5, border: `1px solid ${t.brass}`, borderRadius: 1, padding: "3px 8px", background: "transparent", color: t.ink, cursor: "pointer" }}>◉ Connect Instagram</button>
                )}
                <span title="TikTok connects once its app review is approved" style={{ fontFamily: sans, fontSize: 9, letterSpacing: 0.5, color: t.sub, opacity: 0.7 }}>♪ TikTok — review pending</span>
              </div>
            );
          })}
          <button onClick={loadConn} title="Refresh connection status" style={{ alignSelf: "center", fontFamily: sans, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", border: "none", background: "transparent", color: t.sub, cursor: "pointer" }}>↻ Refresh</button>
        </div>
      )}

      <div style={{ position: "relative", borderRadius: 4, overflow: "hidden", border: `1px solid ${t.line}`, background: t.canvas }}>
        <BrainCanvas
          model={model}
          theme={t}
          scale={0.92}
          selectedId={null}
          onSelect={onSelect}
          height={400}
          deluxe
          centerTitle="Content Health"
          centerCaption={model.caption + " · " + model.brandLabel}
          centerPurpose={CONTENT_PURPOSE}
        />
        <div style={{ position: "absolute", right: 12, bottom: 8, fontFamily: serif, fontStyle: "italic", fontSize: 10, color: t.sub, opacity: 0.85, pointerEvents: "none" }}>♪ TikTok joins after app review</div>
      </div>
    </div>
  );
}
