import { Fragment, useEffect, useMemo, useState } from "react";

// LAVALLE HAUS OS — Content → Analytics
// Live channel numbers from the Instagram API. Post type reads Static / Carousel
// / Reel; hashtags get their own column; and each row expands to the post's
// comments with a reply box that posts straight back to Instagram.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", red: "#9b5e5e", green: "#5a7a5a" };
const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const serif = "Georgia, 'Times New Roman', serif";
const fmt = (n) => (n == null ? "—" : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));

function LegacyAnalytics({ allowedAccts = null }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const WS2IGA = { "lavalle-sisters": "lavallesisters", "lavalle-haus": "refilleryhaus", "the-fold": "thefoldlabel" };
  const [acct, setAcct] = useState(0);
  useEffect(() => { const pick = (v) => { const ig = WS2IGA[v]; if (!ig || !visAccounts) return; const ix = visAccounts.findIndex((a0) => String(a0.username || a0.handle || "").toLowerCase() === ig); if (ix >= 0) setAcct(ix); }; try { pick(localStorage.getItem("lh_brand_view")); } catch {} const h = (e) => pick(e.detail); window.addEventListener("lh-brand-view", h); return () => window.removeEventListener("lh-brand-view", h); }, [visAccounts && visAccounts.length]);
  const [openId, setOpenId] = useState(null); // media id whose comments are expanded
  const [comments, setComments] = useState({}); // mediaId -> { loading, error, list }
  const [reply, setReply] = useState({}); // commentId -> draft text
  const [replyBusy, setReplyBusy] = useState(null); // commentId being sent

  useEffect(() => {
    fetch("/api/data?op=ig_insights")
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status); return d; })
      .then(setData)
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  const visAccounts = data && data.accounts ? data.accounts.filter((x) => !allowedAccts || allowedAccts.has(String(x.username || "").toLowerCase().replace(/^@/, ""))) : null;
  const a = visAccounts && visAccounts[acct];
  const stats = useMemo(() => {
    if (!a || !a.items || !a.items.length) return null;
    const n = a.items.length;
    const sum = (k) => a.items.reduce((s, x) => s + (x[k] || 0), 0);
    const avgLikes = Math.round(sum("likes") / n);
    const avgComments = Math.round((sum("comments") / n) * 10) / 10;
    const engagement = a.followers ? (((sum("likes") + sum("comments")) / n / a.followers) * 100).toFixed(1) + "%" : null;
    const watched = a.items.filter((x) => x.avgWatchSec != null);
    const avgWatch = watched.length ? Math.round(watched.reduce((s, x) => s + x.avgWatchSec, 0) / watched.length) : null;
    return { avgLikes, avgComments, engagement, avgWatch };
  }, [a]);

  const toggleComments = (m) => {
    if (openId === m.id) { setOpenId(null); return; }
    setOpenId(m.id);
    if (!comments[m.id]) {
      setComments((s) => ({ ...s, [m.id]: { loading: true } }));
      fetch("/api/data?op=ig_comments&media=" + encodeURIComponent(m.id) + "&account=" + encodeURIComponent(a.username))
        .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) => setComments((s) => ({ ...s, [m.id]: ok ? { list: d.comments || [] } : { error: d.error || "couldn't load" } })))
        .catch((e) => setComments((s) => ({ ...s, [m.id]: { error: String(e) } })));
    }
  };
  const sendReply = async (commentId, mediaId) => {
    const text = (reply[commentId] || "").trim();
    if (!text) return;
    setReplyBusy(commentId);
    try {
      const r = await fetch("/api/data?op=ig_reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commentId, message: text, account: a.username }) });
      const d = await r.json();
      if (r.ok && d.ok) {
        // optimistic: show the reply nested under the comment
        setComments((s) => {
          const cur = s[mediaId]; if (!cur || !cur.list) return s;
          return { ...s, [mediaId]: { list: cur.list.map((cc) => cc.id === commentId ? { ...cc, replies: [...(cc.replies || []), { id: d.id, text, username: "@" + a.username + " (you)", at: new Date().toISOString() }] } : cc) } };
        });
        setReply((s) => ({ ...s, [commentId]: "" }));
      } else alert("Reply failed: " + (d.error || "unknown"));
    } catch (e) { alert("Reply failed: " + e); }
    setReplyBusy(null);
  };

  if (err) return <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: c.sub }}>{/only the owner/i.test(err) ? "Analytics are visible to the owner." : "Couldn't load analytics: " + err}</div>;
  if (!data) return <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: c.sub }}>Reading the channels…</div>;

  const label = { fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe };
  const th = { ...label, textAlign: "left", padding: "9px 12px", borderBottom: `1px solid ${c.line}`, background: c.card, whiteSpace: "nowrap" };
  const td = { padding: "8px 12px", borderBottom: `1px solid ${c.line}`, fontFamily: sans, fontSize: 11.5, color: c.ink, verticalAlign: "top" };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {(visAccounts || []).map((x, i) => (
          <button key={x.username || i} onClick={() => setAcct(i)}
            style={{ padding: "8px 16px", borderRadius: 1, cursor: "pointer", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", border: `1px solid ${i === acct ? c.ink : c.line}`, background: i === acct ? c.ink : "transparent", color: i === acct ? "#FFFFFF" : c.sub }}>
            ◉ @{x.username}
          </button>
        ))}
        <span title="TikTok analytics unlock when the app review is approved"
          style={{ padding: "8px 16px", borderRadius: 1, fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", border: `1px dashed ${c.line}`, color: c.sub, opacity: 0.7 }}>♪ TikTok — pending review</span>
      </div>

      {!a ? (
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: c.sub }}>No Instagram accounts connected yet.</div>
      ) : a.error ? (
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: c.red }}>@{a.username}: {a.error}</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 18 }}>
            {[
              { l: "Followers", v: fmt(a.followers) },
              { l: "Posts", v: fmt(a.mediaCount) },
              { l: "Avg likes", v: stats ? fmt(stats.avgLikes) : "—" },
              { l: "Avg comments", v: stats ? String(stats.avgComments) : "—" },
              { l: "Engagement", v: (stats && stats.engagement) || "—" },
              { l: "Avg watch time", v: stats && stats.avgWatch != null ? stats.avgWatch + "s" : "—" },
            ].map((s) => (
              <div key={s.l} style={{ background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: "14px 16px" }}>
                <div style={{ fontFamily: sans, fontSize: 22, fontWeight: 300, color: c.ink }}>{s.v}</div>
                <div style={{ ...label, marginTop: 3 }}>{s.l}</div>
              </div>
            ))}
          </div>

          {!a.insightsAvailable && (
            <div style={{ background: "#F7F4EE", border: `1px solid ${c.line}`, borderRadius: 1, padding: "9px 13px", fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.sub, marginBottom: 14 }}>
              Views, saves and retention unlock after a quick reconnect of this account (Content Brain → this brand → Connect Instagram) — the connection needs the new insights permission.
            </div>
          )}

          <div style={{ ...label, marginBottom: 6 }}>Last {a.items.length} posts <span style={{ textTransform: "none", letterSpacing: 0, color: c.sub, fontStyle: "italic", fontFamily: serif }}>— tap the date to open the post · tap a comment count to read & reply</span></div>
          <div style={{ overflowX: "auto", border: `1px solid ${c.line}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: c.bg, minWidth: 860 }}>
              <thead>
                <tr>
                  {["Posted", "Type", "Views", "Reach", "Likes", "Comments", "Saves", "Retention", "Hashtags", "Caption"].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {a.items.map((m) => {
                  const cs = comments[m.id];
                  return (
                    <Fragment key={m.id}>
                      <tr style={{ background: openId === m.id ? c.card : "transparent" }}>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {m.permalink
                            ? <a href={m.permalink} target="_blank" rel="noopener noreferrer" title="Open this post on Instagram" style={{ color: c.taupe, textDecoration: "underline", textUnderlineOffset: 2, fontWeight: 500 }}>{new Date(m.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ↗︎</a>
                            : new Date(m.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </td>
                        <td style={{ ...td, color: c.taupe }}>{m.kind}</td>
                        <td style={td}>{fmt(m.views)}</td>
                        <td style={td} title="Unique accounts that saw this post">{fmt(m.reach)}</td>
                        <td style={td}>{fmt(m.likes)}</td>
                        <td onClick={() => toggleComments(m)} title={m.comments ? "Read & reply to comments" : "No comments"} style={{ ...td, color: m.comments ? c.ink : c.sub, cursor: m.comments ? "pointer" : "default", textDecoration: m.comments ? "underline" : "none", textUnderlineOffset: 2 }}>{fmt(m.comments)}{m.comments ? (openId === m.id ? " ▴" : " ▾") : ""}</td>
                        <td style={td}>{fmt(m.saved)}</td>
                        <td style={td}>{m.avgWatchSec != null ? m.avgWatchSec + "s" : "—"}</td>
                        <td style={{ ...td, color: c.sub }}>{m.hashtagCount || 0}</td>
                        <td style={{ ...td, color: c.sub, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.caption}</td>
                      </tr>
                      {openId === m.id && (
                        <tr>
                          <td colSpan={10} style={{ padding: "12px 16px 16px", background: c.card, borderBottom: `1px solid ${c.line}` }}>
                            {m.hashtags && m.hashtags.length > 0 && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ ...label, marginBottom: 5 }}>Hashtags ({m.hashtags.length})</div>
                                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                                  {m.hashtags.map((h, i) => <span key={i} style={{ fontFamily: sans, fontSize: 11, color: c.taupe, border: `1px solid ${c.line}`, borderRadius: 1, padding: "2px 8px", background: c.bg }}>{h}</span>)}
                                </div>
                              </div>
                            )}
                            <div style={{ ...label, marginBottom: 6 }}>Comments</div>
                            {!cs || cs.loading ? <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.sub }}>Loading comments…</div>
                              : cs.error ? <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.red }}>{cs.error}</div>
                              : !cs.list.length ? <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.sub }}>No comments yet.</div>
                              : cs.list.map((cc) => { const who = cc.username || "Instagram user"; return (
                                <div key={cc.id} style={{ borderTop: `1px solid ${c.line}`, padding: "8px 0" }}>
                                  <div style={{ fontFamily: sans, fontSize: 12.5, color: c.ink }}><b>{cc.username ? "@" + cc.username : who}</b> <span style={{ color: c.sub, fontSize: 10 }}>{cc.at ? new Date(cc.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}{cc.likes ? " · " + cc.likes + " likes" : ""}</span></div>
                                  <div style={{ fontFamily: sans, fontSize: 12.5, color: c.ink, margin: "2px 0 4px" }}>{cc.text}</div>
                                  {(cc.replies || []).map((r) => (
                                    <div key={r.id} style={{ marginLeft: 16, paddingLeft: 10, borderLeft: `2px solid ${c.line}`, marginTop: 4 }}>
                                      <div style={{ fontFamily: sans, fontSize: 11.5, color: c.sub }}><b>{r.username ? "@" + r.username : "Reply"}</b> · {r.text}</div>
                                    </div>
                                  ))}
                                  <div style={{ display: "flex", gap: 6, marginTop: 6, marginLeft: 16 }}>
                                    <input value={reply[cc.id] || ""} onChange={(e) => setReply((s) => ({ ...s, [cc.id]: e.target.value }))}
                                      onKeyDown={(e) => { if (e.key === "Enter") sendReply(cc.id, m.id); }}
                                      placeholder={"Reply" + (cc.username ? " to @" + cc.username : "") + " — posts to Instagram"}
                                      style={{ flex: 1, maxWidth: 460, boxSizing: "border-box", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "7px 11px", fontFamily: sans, fontSize: 12, color: c.ink, outline: "none" }} />
                                    <button disabled={replyBusy === cc.id || !(reply[cc.id] || "").trim()} onClick={() => sendReply(cc.id, m.id)}
                                      style={{ border: `1px solid ${c.ink}`, background: c.ink, color: "#FFFFFF", borderRadius: 1, padding: "0 14px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", opacity: replyBusy === cc.id || !(reply[cc.id] || "").trim() ? 0.5 : 1 }}>{replyBusy === cc.id ? "Sending…" : "Reply"}</button>
                                  </div>
                                </div>
                              ); })}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub, marginTop: 8 }}>
            Views = total times the post was seen · Reach = unique accounts · Retention = average watch time on Reels. Replies you send here post live to Instagram under your account.
          </div>
        </>
      )}
    </div>
  );
}


// ── Audit dive (her ask, Oct 5 2026) ─────────────────────────────────────────
// A month-by-month read of the channel audit: TikTok on top, Instagram below,
// a growth line, the top five reels and carousels, and the findings that feed
// next month's Strategy Outline. Lavalle Haus keeps the classic table view.
const BRANDS_AN = [
  { acct: "thefoldlabel", board: "the-fold", label: "The Fold Label", handle: "@thefoldlabel" },
  { acct: "lavallesisters", board: "lavalle-sisters", label: "Lavalle Sisters", handle: "@lavallesisters" },
  { acct: "refilleryhaus", board: null, label: "Lavalle Haus", handle: "@refilleryhaus" },
];
const WS2IGA2 = { "lavalle-sisters": "lavallesisters", "lavalle-haus": "refilleryhaus", "the-fold": "thefoldlabel" };
const secHead = { fontFamily: sans, fontSize: 11, letterSpacing: 4, textTransform: "uppercase", color: c.ink, margin: "26px 0 10px" };
const noteBox = (warm) => ({ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: warm ? "#8a6d3b" : c.sub, background: warm ? "#F6EEDC" : c.card, border: `1px solid ${warm ? "#E4D5B0" : c.line}`, borderRadius: 2, padding: "10px 14px", lineHeight: 1.6 });

function SparkAN({ points }) {
  const pts = (points || []).filter((p) => p.followers != null);
  if (pts.length < 2) return <div style={noteBox(false)}>The growth line draws itself as the audit runs (every 3 days){pts.length === 1 ? " — first point recorded " + pts[0].d + " at " + pts[0].followers + " followers." : "."}</div>;
  const W = 560, H = 110, pad = 8;
  const vals = pts.map((p) => p.followers);
  const min = Math.min(...vals), max = Math.max(...vals), span = Math.max(1, max - min);
  const xy = pts.map((p, i) => [pad + (i * (W - 2 * pad)) / (pts.length - 1), H - pad - ((p.followers - min) * (H - 2 * pad)) / span]);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 560, display: "block", background: c.card, border: `1px solid ${c.line}`, borderRadius: 2 }}>
        <polyline points={xy.map(([x, y]) => x.toFixed(1) + "," + y.toFixed(1)).join(" ")} fill="none" stroke={c.taupe} strokeWidth="1.6" />
        {xy.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2" fill={c.ink} />)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: sans, fontSize: 9, letterSpacing: 1, color: c.sub, marginTop: 4 }}>
        <span>{pts[0].d} · {min}</span><span>followers</span><span>{pts[pts.length - 1].d} · {max}</span>
      </div>
    </div>
  );
}

function TopListAN({ title, rows, tiktok }) {
  return (
    <div style={{ flex: "1 1 260px", minWidth: 250 }}>
      <div style={{ fontFamily: sans, fontSize: 9.5, letterSpacing: 2.5, textTransform: "uppercase", color: c.sub, marginBottom: 8 }}>{title}</div>
      {(!rows || !rows.length) && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11.5, color: c.sub }}>Nothing in this window yet.</div>}
      {(rows || []).map((r, i) => (
        <div key={i} style={{ borderTop: `1px solid ${c.line}`, padding: "8px 2px" }}>
          <div style={{ fontFamily: sans, fontSize: 11.5, color: c.ink, lineHeight: 1.45 }}>
            <span style={{ color: c.sub, marginRight: 6 }}>{i + 1}.</span>
            {(r.caption || "(no caption)").slice(0, 72)}{(r.caption || "").length > 72 ? "…" : ""}
          </div>
          <div style={{ fontFamily: sans, fontSize: 10, color: c.sub, marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>{fmt(r.likes)} likes</span><span>{fmt(r.comments)} comments</span>
            <span>{fmt(r.saved)} {tiktok ? "shares" : "saves"}</span><span>{fmt(r.reach)} {tiktok ? "views" : "reach"}</span>
            {r.url && <a href={r.url} target="_blank" rel="noreferrer" style={{ color: c.taupe }}>open ↗</a>}
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditDive({ board, handle }) {
  const [resp, setResp] = useState(null);
  const [err, setErr] = useState(null);
  const [month, setMonth] = useState("");
  useEffect(() => {
    setErr(null);
    fetch(`/api/data?op=sisters_analytics&board=${board}${month ? "&month=" + month : ""}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => { if (!ok) setErr(d.error || "couldn't load"); else { setResp(d); if (!month && d.month) setMonth(d.month); } })
      .catch((e) => setErr(String(e)));
  }, [board, month]);
  if (err) return <div style={noteBox(true)}>{err}</div>;
  if (!resp) return <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: 2, color: c.sub, padding: 30, textAlign: "center" }}>READING THE AUDIT…</div>;
  const d = resp.data;
  const moLbl = (k) => { if (!k) return ""; const [y, m] = k.split("-"); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); };
  const growth = resp.growth || [];
  const last = [...growth].reverse().find((p) => p.followers != null);
  const prev30 = [...growth].reverse().find((p) => p.followers != null && (Date.now() - new Date(p.d).getTime()) > 27 * 86400000);
  const delta = last && prev30 ? last.followers - prev30.followers : null;
  const chips = [
    ["Followers", (d && d.followers != null ? d.followers : last && last.followers) ?? "—"],
    ["30-day change", delta == null ? "—" : (delta >= 0 ? "+" : "") + delta],
    ["Avg engagement / post", last && last.avgEng != null ? last.avgEng : "—"],
    ["Posts read", d && d.window ? d.window : "—"],
  ];
  return (
    <div style={{ maxWidth: 620 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub }}>Month</span>
        <select value={month || ""} onChange={(e) => setMonth(e.target.value)}
          style={{ border: `1px solid ${c.line}`, background: "transparent", color: c.ink, borderRadius: 1, padding: "6px 10px", fontFamily: sans, fontSize: 10, letterSpacing: 1 }}>
          {(resp.months || []).map((k) => <option key={k} value={k}>{moLbl(k)}</option>)}
          {!(resp.months || []).length && <option value="">No audits yet</option>}
        </select>
      </div>

      <div style={secHead}>TikTok · {handle}</div>
      {resp.ttNote && <div style={noteBox(false)}>{resp.ttNote}</div>}
      {!resp.ttNote && <TopListAN title="Top 5 TikToks" rows={d && d.topTikTok} tiktok />}

      <div style={secHead}>Instagram · {handle}</div>
      {resp.igNote && <div style={{ ...noteBox(true), marginBottom: 12 }}>⚠ {resp.igNote}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {chips.map(([k, v]) => (
          <div key={k} style={{ border: `1px solid ${c.line}`, borderRadius: 2, padding: "8px 14px", background: c.bg }}>
            <div style={{ fontFamily: sans, fontSize: 14, color: c.ink }}>{v}</div>
            <div style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, marginTop: 2 }}>{k}</div>
          </div>
        ))}
      </div>
      <SparkAN points={growth} />
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 16 }}>
        <TopListAN title="Top 5 Reels" rows={d && d.topReels} />
        <TopListAN title="Top 5 Carousels" rows={d && d.topCarousels} />
      </div>

      {d && (d.headline || (d.findings || []).length > 0) && (
        <div style={{ marginTop: 22, border: `1px solid ${c.line}`, borderRadius: 2, padding: "14px 16px", background: c.card }}>
          {d.headline && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: c.ink, marginBottom: 8 }}>{d.headline}</div>}
          {(d.findings || []).map((x, i) => <div key={i} style={{ fontFamily: sans, fontSize: 11.5, color: c.ink, lineHeight: 1.7 }}>• {x}</div>)}
          {(d.carry || []).length > 0 && <div style={{ fontFamily: sans, fontSize: 9.5, letterSpacing: 2, textTransform: "uppercase", color: c.sub, margin: "10px 0 4px" }}>Carry into next month</div>}
          {(d.carry || []).map((x, i) => <div key={i} style={{ fontFamily: sans, fontSize: 11.5, color: c.ink, lineHeight: 1.7 }}>• {x}</div>)}
          {d.formatMix && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11.5, color: c.sub, marginTop: 8 }}>{d.formatMix}</div>}
          <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, marginTop: 10 }}>These findings feed next cycle's Strategy Outline automatically.</div>
        </div>
      )}
    </div>
  );
}

export default function ContentAnalytics({ allowedAccts = null }) {
  const visible = BRANDS_AN.filter((b) => !allowedAccts || allowedAccts.has(b.acct));
  const [bv, setBv] = useState(() => { try { return localStorage.getItem("lh_brand_view") || "all"; } catch { return "all"; } });
  const [acct, setAcct] = useState(() => { try { const ig = WS2IGA2[localStorage.getItem("lh_brand_view")]; if (ig && visible.some((b) => b.acct === ig)) return ig; } catch {} return (visible[0] || BRANDS_AN[0]).acct; });
  useEffect(() => { const h = (e) => { setBv(e.detail || "all"); const ig = WS2IGA2[e.detail]; if (ig && visible.some((b) => b.acct === ig)) setAcct(ig); }; window.addEventListener("lh-brand-view", h); return () => window.removeEventListener("lh-brand-view", h); }, []);
  const locked = !!WS2IGA2[bv];
  const brand = BRANDS_AN.find((b) => b.acct === acct) || BRANDS_AN[0];
  return (
    <div style={{ fontFamily: sans }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {(locked ? visible.filter((b) => b.acct === WS2IGA2[bv]) : visible).map((b) => (
          <button key={b.acct} onClick={() => setAcct(b.acct)}
            style={{ border: `1px solid ${acct === b.acct ? c.ink : c.line}`, background: acct === b.acct ? c.ink : "transparent", color: acct === b.acct ? "#fff" : c.sub, borderRadius: 1, padding: "8px 14px", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: locked ? "default" : "pointer" }}>
            {b.label}
          </button>
        ))}
      </div>
      {brand.board ? <AuditDive board={brand.board} handle={brand.handle} /> : <LegacyAnalytics allowedAccts={allowedAccts} />}
    </div>
  );
}
