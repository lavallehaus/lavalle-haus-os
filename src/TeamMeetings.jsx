import { useEffect, useState } from "react";

// LAVALLE HAUS OS — Marketing → Meetings
// Fathom pushes every finished meeting here (title, notes, recording link);
// notes auto-email to the saved recipients the moment they arrive. The month
// view mirrors the same meetings, and the ICS link keeps Google Calendar in
// sync without any account connection.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", green: "#5a7a5a", red: "#9b5e5e" };
const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const serif = "Georgia, 'Times New Roman', serif";
const input = { width: "100%", boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 1, padding: "8px 10px", fontFamily: sans, fontSize: 12.5, color: c.ink, background: "#fff" };
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function TeamMeetings({ data, onSave, iAmOwner }) {
  const recipients = (data && data.recipients) || [];
  const items = (data && data.items) || [];
  const [email, setEmail] = useState("");
  const [urls, setUrls] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [ym, setYm] = useState(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); });
  useEffect(() => { if (iAmOwner) fetch("/api/data?op=meetings_urls").then((r) => r.json()).then(setUrls).catch(() => {}); }, [iAmOwner]);

  const save = (next) => onSave({ recipients, items, ...(data || {}), ...next });
  const addRecipient = () => {
    const e2 = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e2) || recipients.includes(e2)) return;
    save({ recipients: [...recipients, e2] }); setEmail("");
  };

  const [y, m] = ym.split("-").map(Number);
  const shift = (d2) => { let mm = m - 1 + d2, yy = y; while (mm < 0) { mm += 12; yy--; } while (mm > 11) { mm -= 12; yy++; } setYm(yy + "-" + String(mm + 1).padStart(2, "0")); };
  const byDay = {};
  items.forEach((it) => { const d2 = new Date(it.date); if (d2.getFullYear() === y && d2.getMonth() === m - 1) (byDay[d2.getDate()] = byDay[d2.getDate()] || []).push(it); });
  const firstDow = new Date(y, m - 1, 1).getDay();
  const daysIn = new Date(y, m, 0).getDate();
  const cells = []; for (let i = 0; i < firstDow; i++) cells.push(null); for (let d2 = 1; d2 <= daysIn; d2++) cells.push(d2); while (cells.length % 7) cells.push(null);

  return (
    <div style={{ fontFamily: sans, maxWidth: 920 }}>
      <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.sub, marginBottom: 14 }}>
        Every Fathom meeting lands here when it finishes processing — notes email themselves to the people below.
      </div>

      {/* auto-send recipients */}
      <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, marginBottom: 6 }}>Notes auto-send to</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        {recipients.map((r) => (
          <span key={r} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${c.line}`, borderRadius: 1, padding: "5px 10px", fontFamily: sans, fontSize: 11.5 }}>
            {r}
            <button onClick={() => { if (window.confirm("Stop auto-sending notes to " + r + "?")) save({ recipients: recipients.filter((x) => x !== r) }); }}
              style={{ border: "none", background: "transparent", color: c.line, cursor: "pointer", fontSize: 12, padding: 0 }}>×</button>
          </span>
        ))}
        <input style={{ ...input, width: 230 }} placeholder="add an email…" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRecipient()} />
        <button onClick={addRecipient} style={{ border: `1px solid ${c.ink}`, background: c.ink, color: "#fff", borderRadius: 1, padding: "8px 14px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Add</button>
      </div>

      {/* connection setup — owner sees the two URLs to paste once */}
      {iAmOwner && urls && (
        <div style={{ border: `1px solid ${c.line}`, background: c.card, borderRadius: 2, padding: "12px 14px", marginBottom: 18 }}>
          <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, marginBottom: 8 }}>One-time setup</div>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11.5, color: c.sub, marginBottom: 4 }}>1 · In Fathom → Settings → Webhooks, add this URL (fires when a meeting finishes):</div>
          <input readOnly value={urls.webhook} onFocus={(e) => e.target.select()} style={{ ...input, fontSize: 11, marginBottom: 10 }} />
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11.5, color: c.sub, marginBottom: 4 }}>2 · In Google Calendar → Other calendars → From URL, paste this to see meetings on your calendar:</div>
          <input readOnly value={urls.ics} onFocus={(e) => e.target.select()} style={{ ...input, fontSize: 11 }} />
        </div>
      )}

      {/* month view */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
        <button onClick={() => shift(-1)} style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "4px 11px", cursor: "pointer", color: c.sub }}>‹</button>
        <div style={{ fontFamily: sans, fontSize: 12, letterSpacing: 2, textTransform: "uppercase" }}>{MONTHS[m - 1]} {y}</div>
        <button onClick={() => shift(1)} style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "4px 11px", cursor: "pointer", color: c.sub }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", border: `1px solid ${c.line}`, borderRight: "none", borderBottom: "none", marginBottom: 18 }}>
        {cells.map((d2, i) => (
          <div key={i} style={{ minHeight: 54, borderRight: `1px solid ${c.line}`, borderBottom: `1px solid ${c.line}`, padding: 4, background: d2 ? "#fff" : "#FAFAF9" }}>
            {d2 && <div style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>{d2}</div>}
            {(byDay[d2] || []).map((it) => (
              <button key={it.id} onClick={() => setOpenId(openId === it.id ? null : it.id)} title={it.title}
                style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderRadius: 1, background: c.ink, color: "#fff", fontFamily: sans, fontSize: 8.5, padding: "2px 4px", marginTop: 2, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</button>
            ))}
          </div>
        ))}
      </div>

      {/* meeting list */}
      {!items.length && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.sub }}>No meetings yet — they appear here automatically once the Fathom webhook is connected.</div>}
      {items.map((it) => (
        <div key={it.id} style={{ border: `1px solid ${c.line}`, borderRadius: 2, padding: "10px 14px", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setOpenId(openId === it.id ? null : it.id)} style={{ border: "none", background: "transparent", padding: 0, fontFamily: sans, fontSize: 13, color: c.ink, cursor: "pointer", textAlign: "left" }}>{it.title}</button>
            <span style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub }}>{new Date(it.date).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            {it.url && <a href={it.url} target="_blank" rel="noreferrer" style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.taupe, textDecoration: "none", marginLeft: "auto" }}>Recording →</a>}
            <button onClick={() => { if (window.confirm("Remove this meeting from the app? (The Fathom recording itself is untouched.)")) save({ items: items.filter((x) => x.id !== it.id) }); }}
              style={{ border: "none", background: "transparent", color: c.line, cursor: "pointer", fontSize: 13, padding: 0, marginLeft: it.url ? 0 : "auto" }}>×</button>
          </div>
          {(it.sentTo || []).length > 0 && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10.5, color: c.green, marginTop: 3 }}>Notes sent to {(it.sentTo || []).join(", ")}</div>}
          {openId === it.id && it.summary && <div style={{ fontFamily: sans, fontSize: 12, color: "#3d3d3a", whiteSpace: "pre-wrap", marginTop: 8, borderTop: `1px solid ${c.card}`, paddingTop: 8 }}>{it.summary}</div>}
        </div>
      ))}
    </div>
  );
}
