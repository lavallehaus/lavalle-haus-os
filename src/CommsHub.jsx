import { useState } from "react";

// LAVALLE HAUS OS — Content → Communications
// Meeting-relationship tracker, styled after the PR hub. The left rail lists
// every ongoing communication (a person/company they meet with); the pane
// holds that relationship's notes, its own to-do list with team assignees,
// and its recorded calls — each recording sendable by email, with every
// address remembered as a contact for next time.
//
// Recordings today are pasted links (Zoom share / Fathom share). Auto-import
// from the info@refilleryhaus.com Outlook folder needs that mailbox connected
// via Microsoft sign-in — flagged in the UI, not yet wired.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", green: "#5a7a5a", red: "#9b5e5e", blue: "#5a6b7a" };
const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const serif = "Georgia, 'Times New Roman', serif";
const input = { width: "100%", boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 1, padding: "8px 10px", fontFamily: sans, fontSize: 12.5, color: c.ink, background: "#fff" };
const uid = () => "cm" + Math.random().toString(36).slice(2, 9);

export default function CommsHub({ data, onSave, team = [] }) {
  const contacts = (data && data.contacts) || [];
  const channels = (data && data.channels) || [];
  const [openId, setOpenId] = useState(channels[0] ? channels[0].id : null);
  const [sendFor, setSendFor] = useState(null); // recording id an email is being entered for
  const [sendTo, setSendTo] = useState("");
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [recTitle, setRecTitle] = useState("");
  const [recUrl, setRecUrl] = useState("");
  const [todoText, setTodoText] = useState("");

  const ch = channels.find((x) => x.id === openId) || null;
  const save = (next) => onSave({ contacts, channels, ...(data || {}), ...next });
  const patchCh = (id, patch) => save({ channels: channels.map((x) => (x.id === id ? { ...x, ...patch } : x)) });

  const addChannel = () => {
    const name = prompt("Who is this communication with? (person or company)");
    if (!name || !name.trim()) return;
    const nc = { id: uid(), name: name.trim(), company: "", email: "", notes: "", todos: [], recordings: [] };
    save({ channels: [...channels, nc] });
    setOpenId(nc.id);
  };

  const sendRecording = async (rec) => {
    const to = sendTo.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { setMsg("That doesn't look like an email address."); return; }
    setBusy(rec.id); setMsg(null);
    try {
      const r = await fetch("/api/data?op=comm_send_recording", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, title: rec.title || "Meeting recording", url: rec.url, channel: ch.name }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "send failed");
      // remember the contact + stamp the send on the recording
      const known = contacts.some((k) => k.email === to);
      save({
        contacts: known ? contacts : [...contacts, { id: uid(), email: to, name: to.split("@")[0] }],
        channels: channels.map((x) => (x.id === ch.id ? { ...x, recordings: x.recordings.map((q) => (q.id === rec.id ? { ...q, sent: [...(q.sent || []), { to, at: new Date().toISOString() }] } : q)) } : x)),
      });
      setSendFor(null); setSendTo("");
      setMsg("Sent to " + to + (known ? "" : " — saved as a contact for next time") + ".");
    } catch (e) { setMsg("Couldn't send: " + String(e.message || e)); }
    setBusy(null);
  };

  return (
    <div style={{ fontFamily: sans, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* left rail — switch between communications */}
      <div style={{ flex: "0 0 210px", minWidth: 170 }}>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.sub, marginBottom: 10 }}>
          Communications — one lane per person you meet with.
        </div>
        {channels.map((x) => (
          <button key={x.id} onClick={() => { setOpenId(x.id); setMsg(null); setSendFor(null); }}
            style={{ display: "block", width: "100%", textAlign: "left", background: openId === x.id ? c.ink : c.card, color: openId === x.id ? "#fff" : c.ink, border: `1px solid ${openId === x.id ? c.ink : c.line}`, borderRadius: 2, padding: "10px 12px", marginBottom: 6, cursor: "pointer" }}>
            <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase" }}>{x.name}</div>
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10.5, color: openId === x.id ? "rgba(255,255,255,0.7)" : c.sub }}>
              {(x.todos || []).filter((t) => !t.done).length} open · {(x.recordings || []).length} recording{(x.recordings || []).length === 1 ? "" : "s"}
            </div>
          </button>
        ))}
        <button onClick={addChannel}
          style={{ display: "block", width: "100%", border: `1px dashed ${c.line}`, background: "transparent", borderRadius: 2, padding: "10px 12px", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>+ New communication</button>
      </div>

      {/* right pane — the selected relationship */}
      <div style={{ flex: 1, minWidth: 300 }}>
        {!ch && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12.5, color: c.sub, padding: "30px 0" }}>Add your first communication on the left — one per person or company you're meeting with.</div>}
        {ch && (
          <div>
            {msg && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: msg.startsWith("Couldn't") || msg.startsWith("That") ? c.red : c.green, marginBottom: 10 }}>{msg}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
              {[["name", "Person / company"], ["company", "Organization"], ["email", "Their email"]].map(([k, lab]) => (
                <div key={k}>
                  <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, marginBottom: 4 }}>{lab}</div>
                  <input style={input} value={ch[k] || ""} onChange={(e) => patchCh(ch.id, { [k]: e.target.value })} />
                </div>
              ))}
            </div>
            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, marginBottom: 4 }}>Notes</div>
            <textarea rows={3} style={{ ...input, resize: "vertical", marginBottom: 14 }} placeholder="What this relationship is about, standing agenda, promises made…"
              value={ch.notes || ""} onChange={(e) => patchCh(ch.id, { notes: e.target.value })} />

            {/* to-dos with team assignment */}
            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, marginBottom: 6 }}>
              To-dos · {(ch.todos || []).filter((t) => !t.done).length} open
            </div>
            {(ch.todos || []).map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${c.line}`, borderRadius: 2, padding: "7px 10px", marginBottom: 5, background: t.done ? c.card : "#fff", opacity: t.done ? 0.6 : 1 }}>
                <input type="checkbox" checked={!!t.done} onChange={() => patchCh(ch.id, { todos: ch.todos.map((q) => (q.id === t.id ? { ...q, done: !q.done } : q)) })} />
                <span style={{ flex: 1, fontFamily: sans, fontSize: 12.5, color: c.ink, textDecoration: t.done ? "line-through" : "none" }}>{t.t}</span>
                <select value={t.assignee || ""} onChange={(e) => patchCh(ch.id, { todos: ch.todos.map((q) => (q.id === t.id ? { ...q, assignee: e.target.value || null } : q)) })}
                  style={{ border: `1px solid ${c.line}`, borderRadius: 1, padding: "4px 6px", fontFamily: sans, fontSize: 10.5, color: t.assignee ? c.ink : c.sub, background: "#fff" }}>
                  <option value="">unassigned</option>
                  {team.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
                <button onClick={() => patchCh(ch.id, { todos: ch.todos.filter((q) => q.id !== t.id) })}
                  style={{ border: "none", background: "transparent", color: c.line, cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              <input style={{ ...input, flex: 1 }} placeholder="New to-do from this meeting…" value={todoText} onChange={(e) => setTodoText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && todoText.trim()) { patchCh(ch.id, { todos: [...(ch.todos || []), { id: uid(), t: todoText.trim(), done: false, assignee: null }] }); setTodoText(""); } }} />
              <button onClick={() => { if (todoText.trim()) { patchCh(ch.id, { todos: [...(ch.todos || []), { id: uid(), t: todoText.trim(), done: false, assignee: null }] }); setTodoText(""); } }}
                style={{ border: `1px solid ${c.ink}`, background: c.ink, color: "#fff", borderRadius: 1, padding: "0 14px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Add</button>
            </div>

            {/* recorded calls */}
            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, marginBottom: 6 }}>Recorded calls</div>
            {(ch.recordings || []).map((r) => (
              <div key={r.id} style={{ border: `1px solid ${c.line}`, borderRadius: 2, padding: "8px 10px", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <a href={r.url} target="_blank" rel="noreferrer" style={{ fontFamily: sans, fontSize: 12.5, color: c.ink }}>{r.title || r.url}</a>
                  <span style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10.5, color: c.sub }}>{r.date ? new Date(r.date).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}</span>
                  <span style={{ flex: 1 }} />
                  <button onClick={() => { setSendFor(sendFor === r.id ? null : r.id); setSendTo(ch.email || ""); setMsg(null); }}
                    style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "5px 10px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.ink, cursor: "pointer" }}>Send link</button>
                  <button onClick={() => { if (window.confirm("Remove this recording link?")) patchCh(ch.id, { recordings: ch.recordings.filter((q) => q.id !== r.id) }); }}
                    style={{ border: "none", background: "transparent", color: c.line, cursor: "pointer", fontSize: 14 }}>×</button>
                </div>
                {(r.sent || []).length > 0 && (
                  <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10.5, color: c.sub, marginTop: 4 }}>
                    Sent to {(r.sent || []).map((s) => s.to).join(", ")}
                  </div>
                )}
                {sendFor === r.id && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <input list="comm-contacts" style={{ ...input, flex: 1 }} placeholder="who@example.com — saved contacts suggest as you type" value={sendTo} onChange={(e) => setSendTo(e.target.value)} autoFocus />
                    <datalist id="comm-contacts">{contacts.map((k) => <option key={k.id} value={k.email}>{k.name}</option>)}</datalist>
                    <button disabled={busy === r.id} onClick={() => sendRecording(r)}
                      style={{ border: `1px solid ${c.ink}`, background: c.ink, color: "#fff", borderRadius: 1, padding: "0 14px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>{busy === r.id ? "Sending…" : "Send"}</button>
                  </div>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              <input style={{ ...input, flex: "1 1 130px" }} placeholder="Title (e.g. Aug 7 intro call)" value={recTitle} onChange={(e) => setRecTitle(e.target.value)} />
              <input style={{ ...input, flex: "2 1 220px" }} placeholder="Zoom / Fathom share link" value={recUrl} onChange={(e) => setRecUrl(e.target.value)} />
              <button onClick={() => { const u = recUrl.trim(); if (!/^https?:\/\//.test(u)) { setMsg("Paste the full link (starts with https://)."); return; } patchCh(ch.id, { recordings: [...(ch.recordings || []), { id: uid(), title: recTitle.trim(), url: u, date: new Date().toISOString(), sent: [] }] }); setRecTitle(""); setRecUrl(""); setMsg(null); }}
                style={{ border: `1px solid ${c.ink}`, background: c.ink, color: "#fff", borderRadius: 1, padding: "0 14px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>+ Add</button>
            </div>
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10.5, color: c.sub }}>
              Auto-import from Outlook (info@refilleryhaus.com) needs that mailbox connected with a Microsoft sign-in — until then, paste the Fathom or Zoom share link here after each call.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
