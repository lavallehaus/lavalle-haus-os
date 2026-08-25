import { Fragment, useEffect, useMemo, useState } from "react";

// LAVALLE HAUS OS — Content → Analytics
// Live channel numbers from the Instagram API. Post type reads Static / Carousel
// / Reel; hashtags get their own column; and each row expands to the post's
// comments with a reply box that posts straight back to Instagram.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", red: "#9b5e5e", green: "#5a7a5a" };
const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const serif = "Georgia, 'Times New Roman', serif";
const fmt = (n) => (n == null ? "—" : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));

export default function ContentAnalytics({ allowedAccts = null }) {
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
