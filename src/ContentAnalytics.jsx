import { useEffect, useMemo, useState } from "react";

// LAVALLE HAUS OS — Content → Analytics
// Live channel numbers straight from the Instagram API (TikTok joins the
// moment its app review clears). Saves / reach / retention appear once an
// account has been reconnected with the insights scope.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", red: "#9b5e5e", green: "#5a7a5a" };
const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const serif = "Georgia, 'Times New Roman', serif";

const fmt = (n) => (n == null ? "—" : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));

export default function ContentAnalytics() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [acct, setAcct] = useState(0);

  useEffect(() => {
    fetch("/api/data?op=ig_insights")
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status); return d; })
      .then(setData)
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  const a = data && data.accounts && data.accounts[acct];
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

  if (err) return <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: c.sub }}>{/only the owner/i.test(err) ? "Analytics are visible to the owner." : "Couldn't load analytics: " + err}</div>;
  if (!data) return <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: c.sub }}>Reading the channels…</div>;

  const label = { fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe };
  return (
    <div>
      {/* account picker */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {data.accounts.map((x, i) => (
          <button key={x.username || i} onClick={() => setAcct(i)}
            style={{ padding: "8px 16px", borderRadius: 1, cursor: "pointer", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", border: `1px solid ${i === acct ? c.ink : c.line}`, background: i === acct ? c.ink : "transparent", color: i === acct ? "#FFFFFF" : c.sub }}>
            ◉ @{x.username}
          </button>
        ))}
        <span title="TikTok analytics unlock when the app review is approved"
          style={{ padding: "8px 16px", borderRadius: 1, fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", border: `1px dashed ${c.line}`, color: c.sub, opacity: 0.7 }}>
          ♪ TikTok — pending review
        </span>
      </div>

      {!a ? (
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: c.sub }}>No Instagram accounts connected yet.</div>
      ) : a.error ? (
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: c.red }}>@{a.username}: {a.error}</div>
      ) : (
        <>
          {/* headline stats */}
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
              Saves, reach and retention unlock after a quick reconnect of this account (Boards → any board → ↻ next to the Instagram chip) — the connection needs the new insights permission.
            </div>
          )}

          {/* recent posts */}
          <div style={{ ...label, marginBottom: 6 }}>Last {a.items.length} posts</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: c.bg, border: `1px solid ${c.line}` }}>
              <thead>
                <tr>
                  {["Posted", "Type", "Likes", "Comments", "Saves", "Reach", "Retention", "Caption"].map((h) => (
                    <th key={h} style={{ ...label, textAlign: "left", padding: "9px 12px", borderBottom: `1px solid ${c.line}`, background: c.card }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.items.map((m) => (
                  <tr key={m.id}>
                    <td style={{ padding: "8px 12px", borderBottom: `1px solid ${c.line}`, fontFamily: sans, fontSize: 11.5, color: c.ink, whiteSpace: "nowrap" }}>
                      {m.permalink ? <a href={m.permalink} target="_blank" rel="noopener noreferrer" style={{ color: c.ink }}>{new Date(m.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ↗</a> : new Date(m.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </td>
                    <td style={{ padding: "8px 12px", borderBottom: `1px solid ${c.line}`, fontFamily: sans, fontSize: 11, color: c.sub }}>{String(m.type || "").replace("_", " ").toLowerCase()}</td>
                    <td style={{ padding: "8px 12px", borderBottom: `1px solid ${c.line}`, fontFamily: sans, fontSize: 11.5, color: c.ink }}>{fmt(m.likes)}</td>
                    <td style={{ padding: "8px 12px", borderBottom: `1px solid ${c.line}`, fontFamily: sans, fontSize: 11.5, color: c.ink }}>{fmt(m.comments)}</td>
                    <td style={{ padding: "8px 12px", borderBottom: `1px solid ${c.line}`, fontFamily: sans, fontSize: 11.5, color: c.ink }}>{fmt(m.saved)}</td>
                    <td style={{ padding: "8px 12px", borderBottom: `1px solid ${c.line}`, fontFamily: sans, fontSize: 11.5, color: c.ink }}>{fmt(m.reach)}</td>
                    <td style={{ padding: "8px 12px", borderBottom: `1px solid ${c.line}`, fontFamily: sans, fontSize: 11.5, color: c.ink }}>{m.avgWatchSec != null ? m.avgWatchSec + "s" : "—"}</td>
                    <td style={{ padding: "8px 12px", borderBottom: `1px solid ${c.line}`, fontFamily: sans, fontSize: 11, color: c.sub, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.caption}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
