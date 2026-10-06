import { useEffect, useState } from "react";

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

const NOTE_TAGS = ["Marketing", "R&D", "Newsletter", "Scripts", "Stories", "Ops", "Courtney"];
const NOTE_STATUSES = [["not-started", "Not started", "#EEECE6", "#71716C"], ["in-progress", "In progress", "#E3DCCC", "#6E5F3F"], ["done", "Done", "#DFE8DF", "#5a7a5a"]];
const itemStatus = (it) => it.done ? "done" : (it.status || "not-started");
const assignedOf = (it, note) => it.assignedAt || (note && note.date ? note.date + "T12:00" : null);
const weeksBehind = (it, note) => { const a = assignedOf(it, note); if (!a || it.done) return 0; return Math.floor((Date.now() - new Date(a).getTime()) / (7 * 86400000)); };

// Meeting Notes (her ask, Oct 5 2026) — the notes she keeps per meeting date,
// mirrored both ways with her phone's Notes app by the daily notes-comms-sync
// routine on her Mac. Private by default: only Kiabeth + Kiaredza see a note
// unless someone is granted on it (Courtney sees her own). Items carry a tag
// (R&D / Newsletter / Marketing…) so each line files where it impacts.
function MeetingNotes({ notes, onSave, team, viewer, meetings = [] }) {
  // brand scoping (her rule Oct 5 2026): a note tagged for a brand shows only
  // in that brand's view — sisters items never appear under The Fold's comms
  const [bvMN, setBvMN] = useState(() => { try { return localStorage.getItem("lh_brand_view") || "all"; } catch { return "all"; } });
  useEffect(() => { const h = (e) => setBvMN(e.detail || "all"); window.addEventListener("lh-brand-view", h); return () => window.removeEventListener("lh-brand-view", h); }, []);
  const canSee = (n) => viewer.owner || (n.access || []).some((a) => String(a).toLowerCase().split(" ")[0] === String(viewer.name || "").toLowerCase().split(" ")[0]);
  const inBrand = (n) => !n.brand || bvMN === "all" || !["the-fold", "lavalle-sisters", "lavalle-haus"].includes(bvMN) || n.brand === bvMN;
  const visible = (notes || []).filter((n) => canSee(n) && inBrand(n)).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (a.title || "").localeCompare(b.title || ""));
  const [selId, setSelId] = useState(visible[0] ? visible[0].id : null);
  const note = visible.find((n) => n.id === selId) || visible[0] || null;
  const [itemText, setItemText] = useState("");
  const [mnPerson, setMnPerson] = useState("All");
  const [mnMonth, setMnMonth] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; });
  const people = [...new Set(visible.map((n) => n.title || "Meeting"))];
  const PERSON_C = { Sarah: "#8F8676", Courtney: "#C9A96A" };
  const dueOf = (it, n) => { if (it.due) return String(it.due).slice(0, 10); const m = /^(Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep)[a-z]*\s+(\d{1,2})/i.exec(it.text || ""); if (m) { const mo = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(m[1].slice(0,3).toLowerCase()); const y = mo >= 5 ? 2026 : 2027; return y + "-" + String(mo + 1).padStart(2, "0") + "-" + String(+m[2]).padStart(2, "0"); } return n.date || null; };
  const patchNote = (id, patch) => onSave((notes || []).map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const lbl = (n) => { const d = n.date ? new Date(n.date + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "undated"; return d + " · " + (n.title || "Meeting"); };
  const addNote = () => {
    const date = prompt("Meeting date (YYYY-MM-DD)", new Date().toISOString().slice(0, 10));
    if (!date) return;
    const title = prompt("Who / what is this meeting?", "Sarah");
    if (!title) return;
    const nn = { id: uid(), date: date.trim(), title: title.trim(), access: [], items: [], src: "app", brand: ["the-fold", "lavalle-sisters", "lavalle-haus"].includes(bvMN) ? bvMN : null };
    onSave([...(notes || []), nn]); setSelId(nn.id);
  };
  const grouped = note ? NOTE_TAGS.concat([null]).map((tg) => [tg, (note.items || []).filter((it) => (tg === null ? !NOTE_TAGS.includes(it.tag) : it.tag === tg))]).filter(([, l]) => l.length) : [];
  return (
    <div style={{ border: `1px solid ${c.line}`, borderRadius: 2, padding: "14px 16px", marginBottom: 22, background: "#FAF9F7" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontFamily: sans, fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: c.ink }}>Meeting notes</span>
        <select value={note ? note.id : ""} onChange={(e) => setSelId(e.target.value)}
          style={{ border: `1px solid ${c.line}`, background: "#fff", color: c.ink, borderRadius: 1, padding: "6px 10px", fontFamily: sans, fontSize: 11 }}>
          {visible.map((n) => <option key={n.id} value={n.id}>{lbl(n)}</option>)}
          {!visible.length && <option value="">No notes yet</option>}
        </select>
        <button onClick={addNote} style={{ border: `1px dashed ${c.line}`, background: "transparent", borderRadius: 1, padding: "6px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>+ New</button>
        <span style={{ flex: 1 }} />
        {note && viewer.owner && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10.5, color: c.sub }}>{(note.access || []).length ? "Shared with " + note.access.join(", ") : "Private — Kiabeth + Kiaredza"}</span>
            {team.filter((m) => !/kiabeth|kiaredza/i.test(m.name || "")).map((m) => {
              const on = (note.access || []).includes(m.name);
              return <button key={m.name} onClick={() => patchNote(note.id, { access: on ? (note.access || []).filter((a) => a !== m.name) : [...(note.access || []), m.name] })}
                style={{ border: `1px solid ${on ? c.ink : c.line}`, background: on ? c.ink : "transparent", color: on ? "#fff" : c.sub, borderRadius: 10, padding: "3px 10px", fontFamily: sans, fontSize: 9, letterSpacing: 1, cursor: "pointer" }}>{m.name.split(" ")[0]}</button>;
            })}
          </span>
        )}
      </div>
      {!note && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.sub }}>Notes from your phone's Notes app land here each morning, filed by meeting date.</div>}
      {note && (
        <div>
          {grouped.map(([tg, list]) => (
            <div key={tg || "untagged"} style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 4 }}>{tg || "To file"}</div>
              {list.map((it) => (
                <div key={it.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 0", borderBottom: `1px solid ${c.line}`, opacity: it.done ? 0.55 : 1 }}>
                  <input type="checkbox" checked={!!it.done} style={{ marginTop: 3 }}
                    onChange={() => patchNote(note.id, { items: note.items.map((q) => (q.id === it.id ? { ...q, done: !q.done, status: !q.done ? "done" : "in-progress", doneAt: !q.done ? new Date().toISOString() : undefined } : q)) })} />
                  <span style={{ flex: 1, fontFamily: sans, fontSize: 12, lineHeight: 1.55, color: c.ink, textDecoration: it.done ? "line-through" : "none" }}>
                    {it.text}
                    {(() => {
                      // assigned date + how far behind (her ask Oct 5 2026)
                      const a = assignedOf(it, note); if (!a) return null;
                      const wk = weeksBehind(it, note);
                      return <span style={{ display: "block", fontFamily: sans, fontSize: 9.5, color: wk >= 2 ? c.red : wk >= 1 ? "#8a6d3b" : c.sub, marginTop: 1 }}>
                        assigned {new Date(a).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{it.done ? "" : wk >= 1 ? ` · ${wk} week${wk === 1 ? "" : "s"} behind` : " · this week"}
                      </span>;
                    })()}
                    {((it.links || []).length > 0 || true) && (
                      <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                        {(it.links || []).map((lk, li) => (
                          <a key={li} href={lk.u} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                            style={{ fontFamily: sans, fontSize: 9.5, color: c.taupe, border: `1px solid ${c.line}`, borderRadius: 10, padding: "2px 9px", textDecoration: "none", background: "#fff" }}>↗ {lk.n || "link"}</a>
                        ))}
                        <button onClick={() => { const u = prompt("Link URL"); if (!u) return; const n0 = prompt("Label for this link", "Drive folder") || "link"; patchNote(note.id, { items: note.items.map((q) => (q.id === it.id ? { ...q, links: [...(q.links || []), { n: n0, u }] } : q)) }); }}
                          style={{ fontFamily: sans, fontSize: 9.5, color: c.sub, border: `1px dashed ${c.line}`, borderRadius: 10, padding: "2px 8px", background: "transparent", cursor: "pointer" }}>+ link</button>
                      </span>
                    )}
                  </span>
                  {false}
                  {(() => { const st = NOTE_STATUSES.find(([k]) => k === itemStatus(it)) || NOTE_STATUSES[0]; return (
                    <select value={itemStatus(it)} onChange={(e) => { const v = e.target.value; patchNote(note.id, { items: note.items.map((q) => (q.id === it.id ? { ...q, status: v, done: v === "done", doneAt: v === "done" ? new Date().toISOString() : undefined } : q)) }); }}
                      style={{ border: "none", borderRadius: 10, padding: "3px 6px", fontFamily: sans, fontSize: 9, color: st[3], background: st[2], cursor: "pointer" }}>
                      {NOTE_STATUSES.map(([k, lb]) => <option key={k} value={k}>{lb}</option>)}
                    </select>
                  ); })()}
                  <select value={it.tag || ""} onChange={(e) => patchNote(note.id, { items: note.items.map((q) => (q.id === it.id ? { ...q, tag: e.target.value || null } : q)) })}
                    style={{ border: `1px solid ${c.line}`, borderRadius: 1, padding: "3px 5px", fontFamily: sans, fontSize: 9.5, color: it.tag ? c.ink : c.sub, background: "#fff" }}>
                    <option value="">tag…</option>
                    {NOTE_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button onClick={() => { if (window.confirm("Remove this line from the app note?")) patchNote(note.id, { items: note.items.filter((q) => q.id !== it.id) }); }}
                    style={{ border: "none", background: "transparent", color: c.line, cursor: "pointer", fontSize: 13, padding: 0 }}>×</button>
                </div>
              ))}
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input style={{ ...input, flex: 1 }} placeholder="Add a line to this meeting's notes…" value={itemText} onChange={(e) => setItemText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && itemText.trim()) { patchNote(note.id, { items: [...(note.items || []), { id: uid(), text: itemText.trim(), tag: null, done: false, status: "not-started", assignedAt: new Date().toISOString(), src: "app", at: new Date().toISOString() }] }); setItemText(""); } }} />
            <button onClick={() => { if (itemText.trim()) { patchNote(note.id, { items: [...(note.items || []), { id: uid(), text: itemText.trim(), tag: null, done: false, status: "not-started", assignedAt: new Date().toISOString(), src: "app", at: new Date().toISOString() }] }); setItemText(""); } }}
              style={{ border: `1px solid ${c.ink}`, background: c.ink, color: "#fff", borderRadius: 1, padding: "0 14px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Add</button>
          </div>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10, color: c.sub, marginTop: 8 }}>
            Backed up to the Notes app on your phone each morning — nothing there is ever overwritten; only lines marked (done) are cleared out.
          </div>
        </div>
      )}

      {/* calendar — always its own section under the notes (her ask Oct 5 2026):
          due-date pills colored by status, meetings as dark chips, and a person
          dropdown so each calendar can be viewed per person (Sarah / Courtney) */}
      <div style={{ marginTop: 16, borderTop: `1px solid ${c.line}`, paddingTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontFamily: sans, fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: c.ink }}>Calendar</span>
          {viewer.owner && (
            <select value={mnPerson} onChange={(e) => setMnPerson(e.target.value)}
              style={{ border: `1px solid ${c.line}`, background: "#fff", color: c.ink, borderRadius: 1, padding: "5px 10px", fontFamily: sans, fontSize: 11 }}>
              <option value="All">Everyone</option>
              {people.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={() => setMnMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "3px 10px", cursor: "pointer", color: c.sub }}>←</button>
          <span style={{ fontFamily: sans, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: c.ink }}>{new Date(mnMonth.y, mnMonth.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
          <button onClick={() => setMnMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "3px 10px", cursor: "pointer", color: c.sub }}>→</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => <div key={w} style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, padding: "0 2px 4px" }}>{w}</div>)}
          {(() => {
            const first = new Date(mnMonth.y, mnMonth.m, 1);
            const days = new Date(mnMonth.y, mnMonth.m + 1, 0).getDate();
            const all = [];
            for (const n of visible) { if (mnPerson !== "All" && (n.title || "Meeting") !== mnPerson) continue; for (const it of (n.items || [])) { const dk = dueOf(it, n); if (dk) all.push({ it, n, dk }); } }
            // meetings (Fathom / Outlook) land as dark chips; non-owners only see
            // meetings that carry their own name — each person gets their calendar
            const myFirst = String(viewer.name || "").toLowerCase().split(" ")[0];
            const mByDay = {};
            for (const mt of (meetings || [])) {
              const t = String(mt.title || "");
              if (!viewer.owner && myFirst && !t.toLowerCase().includes(myFirst)) continue;
              if (viewer.owner && mnPerson !== "All" && !t.toLowerCase().includes(mnPerson.toLowerCase())) continue;
              const d0 = new Date(mt.date); if (isNaN(d0)) continue;
              if (d0.getFullYear() !== mnMonth.y || d0.getMonth() !== mnMonth.m) continue;
              (mByDay[d0.getDate()] = mByDay[d0.getDate()] || []).push(mt);
            }
            const cells = [];
            for (let i = 0; i < first.getDay(); i++) cells.push(<div key={"p" + i} />);
            const todayK = new Date().toISOString().slice(0, 10);
            for (let dd = 1; dd <= days; dd++) {
              const k = mnMonth.y + "-" + String(mnMonth.m + 1).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
              const dayItems = all.filter((x) => x.dk === k);
              const dayMeets = mByDay[dd] || [];
              cells.push(
                <div key={k} style={{ border: `1px solid ${c.line}`, borderRadius: 3, minHeight: 72, padding: "3px 4px", background: k === todayK ? c.card : "#fff" }}>
                  <div style={{ fontFamily: sans, fontSize: 9.5, color: c.sub, textAlign: "right" }}>{dd}</div>
                  {dayMeets.map((mt, mi) => (
                    <div key={"m" + mi} title={mt.title + (mt.url ? " — click for the recording" : "")} onClick={() => { if (mt.url) window.open(mt.url, "_blank"); }}
                      style={{ fontFamily: sans, fontSize: 9, lineHeight: 1.35, color: "#fff", background: c.ink, borderRadius: 2, padding: "2px 4px", marginTop: 2, cursor: mt.url ? "pointer" : "default", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {new Date(mt.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":00", "")} {mt.title}
                    </div>
                  ))}
                  {dayItems.slice(0, 3).map(({ it, n }, ii) => { const stC = it.done ? ["#5a7a5a", "#DFE8DF"] : itemStatus(it) === "in-progress" ? ["#8a6d3b", "#EADFC3"] : ["#9b5e5e", "#F3E3E0"]; return (
                    <div key={ii} title={(n.title || "") + " — " + it.text} onClick={() => setSelId(n.id)}
                      style={{ fontFamily: sans, fontSize: 9, lineHeight: 1.35, color: stC[0], background: stC[1], borderLeft: `3px solid ${stC[0]}`, borderRadius: 2, padding: "2px 4px", marginTop: 2, cursor: "pointer", textDecoration: it.done ? "line-through" : "none", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                      {(it.done ? "\u2713 " : "") + (n.title || "") + ": " + it.text}
                    </div>
                  ); })}
                  {dayItems.length > 3 && <div style={{ fontFamily: sans, fontSize: 8.5, color: c.sub }}>+{dayItems.length - 3} more</div>}
                </div>
              );
            }
            return cells;
          })()}
        </div>
        <div style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1, color: c.sub, marginTop: 6 }}>
          <span style={{ marginRight: 12 }}><span style={{ color: c.ink }}>■</span> meeting</span>
          <span style={{ marginRight: 12 }}><span style={{ color: "#9b5e5e" }}>●</span> not started</span>
          <span style={{ marginRight: 12 }}><span style={{ color: "#8a6d3b" }}>●</span> in progress</span>
          <span><span style={{ color: "#5a7a5a" }}>●</span> ✓ done</span>
        </div>
      </div>
    </div>
  );
}

export default function CommsHub({ data, onSave, team = [], viewer = { name: "", owner: true }, meetings = [] }) {
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
    <div>
    <MeetingNotes notes={(data && data.meetingNotes) || []} team={team} viewer={viewer} meetings={meetings} onSave={(mn) => save({ meetingNotes: mn })} />
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
    </div>
  );
}
