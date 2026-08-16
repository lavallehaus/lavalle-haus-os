import { useEffect, useState } from "react";

// LAVALLE HAUS OS — Content tab
// Embeds the self-contained Content Scheduler module (scheduler/server.py —
// Plann × Loomly style: calendar → composer → cross-post to IG/TikTok/Threads/
// YouTube/Pinterest/Facebook for Lavalle Haus + The Fold). The scheduler is a
// local service so posts fire from a machine that's on at the scheduled
// minute; this tab embeds its UI and surfaces the posting report when the
// service is reachable, and shows how to start it when it isn't.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", green: "#5a7a5a", red: "#9b5e5e", taupe: "#8F8676" };
const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const SCHEDULER_URL = "http://localhost:8787";

export default function ContentScheduler() {
  const [status, setStatus] = useState({ phase: "checking" }); // checking | up | down
  const [report, setReport] = useState(null);

  async function check() {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch(SCHEDULER_URL + "/api/status", { signal: ctrl.signal });
      clearTimeout(to);
      const d = await r.json();
      setStatus({ phase: "up", editing: !!d.editing, businesses: d.businesses || {} });
      try {
        const bs = await fetch(SCHEDULER_URL + "/api/businesses").then((x) => x.json());
        const reps = await Promise.all(bs.map((b) => fetch(SCHEDULER_URL + "/api/report?biz=" + b.id).then((x) => x.json()).catch(() => null)));
        setReport(reps.filter(Boolean));
      } catch (e) {}
    } catch (e) {
      setStatus({ phase: "down" });
    }
  }
  useEffect(() => { check(); }, []);

  if (status.phase === "checking") {
    return <div style={{ fontFamily: sans, fontSize: 12, color: c.sub, letterSpacing: 2, padding: 40, textAlign: "center" }}>CHECKING FOR THE SCHEDULER…</div>;
  }

  if (status.phase === "down") {
    return (
      <div style={{ maxWidth: 620, margin: "40px auto" }}>
        <div style={{ background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: "26px 30px" }}>
          <div style={{ fontFamily: sans, fontSize: 20, fontWeight: 300, color: c.ink }}>Content Scheduler is not running</div>
          <div style={{ fontFamily: sans, fontSize: 13, color: c.sub, lineHeight: 1.6, marginTop: 8 }}>
            The scheduler is a small local service that posts to Instagram, TikTok, Threads, YouTube Shorts, Pinterest and Facebook
            for Lavalle Haus and The Fold. It runs on this computer so scheduled posts fire even while the web app is closed.
          </div>
          <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginTop: 18 }}>To start it</div>
          <div style={{ fontFamily: "monospace", fontSize: 12.5, background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "10px 14px", marginTop: 6, color: c.ink }}>
            python3 ~/lavalle-haus-os/scheduler/server.py
          </div>
          <div style={{ fontFamily: sans, fontSize: 12, color: c.sub, marginTop: 8 }}>
            (or double-click <b>scheduler/start.command</b> in the project folder — then reload this tab)
          </div>
          <button onClick={() => { setStatus({ phase: "checking" }); check(); }}
            style={{ marginTop: 16, padding: "10px 22px", background: c.ink, color: c.bg, border: "none", borderRadius: 1, fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>
            Check again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* posting report strip */}
      {report && report.length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          {report.map((r) => (
            <div key={r.business.id} style={{ flex: "1 1 260px", background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontFamily: sans, fontSize: 14, color: c.ink }}>{r.business.name}</span>
                <span style={{ fontFamily: sans, fontSize: 10, color: c.sub, letterSpacing: 1 }}>
                  {r.totals.scheduled} scheduled · {r.totals.published} published · {r.totals.draft} drafts
                </span>
              </div>
              {r.upcoming && r.upcoming[0] && (
                <div style={{ fontFamily: sans, fontSize: 11.5, color: c.sub, marginTop: 4 }}>
                  Next: {r.upcoming[0].nickname || r.upcoming[0].caption?.slice(0, 40) || "post"} · {new Date(r.upcoming[0].scheduledAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </div>
              )}
            </div>
          ))}
          <a href={SCHEDULER_URL} target="_blank" rel="noopener noreferrer"
            style={{ alignSelf: "center", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, textDecoration: "underline", textUnderlineOffset: 3, whiteSpace: "nowrap" }}>
            Open full window ↗
          </a>
        </div>
      )}

      {/* the scheduler itself */}
      <iframe
        title="Content Scheduler"
        src={SCHEDULER_URL}
        style={{ width: "100%", height: "calc(100vh - 260px)", minHeight: 560, border: `1px solid ${c.line}`, borderRadius: 1, background: c.bg }}
      />
    </div>
  );
}
