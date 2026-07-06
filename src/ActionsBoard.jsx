import { useState, useMemo, useEffect } from "react";

// LAVALLE HAUS OS — Action Items board (Growth → Action Items).
// A Trello-style priority board. Items are either:
//   • AUTO  — generated from the Margins tab's flags (losing money, ad waste,
//             thin margin, missing COGS, no price). Keyed so they dedupe and
//             auto-resolve when the underlying condition clears.
//   • MANUAL — anything the team adds by hand.
// Each item carries an urgency, an assignee (from the team roster, with email),
// and a status. Assigned items get a one-tap "Email" that drafts a notification
// to that person. Sorted by urgency. Undo/Redo on every change.
// The recurring bi-weekly ops review (the old checklist) lives at the bottom.

const c = {
  bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD",
  green: "#5a7a5a", clay: "#8F8676", red: "#9b5e5e", card: "#F4F4F3",
};
const serif = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const card = { background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: 14, marginBottom: 12 };
const btnGhost = { padding: "5px 12px", fontSize: 10, fontFamily: sans, letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: `1px solid ${c.line}`, background: "transparent", color: c.sub, textTransform: "uppercase" };
const input = { background: "#F0F0EE", border: `1px solid ${c.line}`, color: c.ink, fontSize: 12, padding: "5px 7px", borderRadius: 1, boxSizing: "border-box", fontFamily: sans };
const selStyle = { background: "#F0F0EE", border: `1px solid ${c.line}`, color: c.ink, fontSize: 11, padding: "4px 6px", borderRadius: 1, fontFamily: sans };

const AVATAR_COLORS = ["#8F8676", "#5a7a5a", "#9b5e5e", "#6b7a8c", "#8c6b7a", "#7a6b4a"];
// Role structure per the Team Portal spec — stored now so permissions can be
// enforced when per-user logins are enabled.
const TEAM_ROLES = ["Owner / Admin", "Manager", "Team Member", "Viewer"];
// App pages a login can be granted (mirrors NAV in App.jsx + PAGE_IDS in api/data.js)
const APP_PAGES = [
  { id: "brain", label: "Business Brain" }, { id: "profit", label: "Sales" }, { id: "ads", label: "Ads" },
  { id: "inventory", label: "Inventory" }, { id: "growth", label: "Growth" }, { id: "content", label: "Content" },
  { id: "roadmap", label: "Roadmap" }, { id: "materials", label: "Materials" }, { id: "ai", label: "AI" },
];
const ROLE_DEFAULT_PAGES = {
  "Owner / Admin": APP_PAGES.map((p) => p.id),
  "Manager": APP_PAGES.map((p) => p.id),
  "Team Member": ["inventory", "growth", "content", "roadmap", "materials"],
  "Viewer": ["content", "roadmap"],
};
const SEV = { high: { label: "HIGH", color: c.red, rank: 0 }, med: { label: "MED", color: c.clay, rank: 1 }, low: { label: "LOW", color: c.sub, rank: 2 } };
const STATUS = ["open", "doing", "done"];
const isLive = (it) => it.status !== "done" && it.status !== "resolved";
const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const uid = (seed) => seed + "_" + Math.random().toString(36).slice(2, 7);

// Merge Margins flags into the stored item list: upsert by key, refresh text,
// preserve user-set assignee/status/severity, auto-resolve vanished flags.
function reconcile(items, flags) {
  const byKey = {};
  items.forEach((it) => { if (it.key) byKey[it.key] = it; });
  const flagKeys = new Set(flags.map((f) => f.key));
  const out = [];
  items.forEach((it) => { if (!it.key) out.push(it); }); // manual items untouched
  flags.forEach((f) => {
    const ex = byKey[f.key];
    if (ex) out.push({ ...ex, title: f.title, detail: f.detail, name: f.name, productId: f.productId, autoResolved: false, status: ex.status === "resolved" ? "open" : ex.status });
    else out.push({ id: uid("ai"), key: f.key, source: "margins", title: f.title, detail: f.detail, name: f.name, productId: f.productId, severity: f.severity, assigneeId: null, status: "open", createdAt: new Date().toISOString() });
  });
  items.forEach((it) => { if (it.key && !flagKeys.has(it.key)) out.push({ ...it, status: "resolved", autoResolved: true }); });
  return out;
}

export default function ActionsBoard({ data = {}, flags = [], recurring = [], onSave, canInvite = false }) {
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [state, setState] = useState(() => ({
    items: data.items || [],
    team: data.team || [],
    recurringChecked: data.recurringChecked || {},
  }));
  const [filter, setFilter] = useState("live"); // live | all | done
  const [showRecurring, setShowRecurring] = useState(false);
  const [draft, setDraft] = useState(null); // new manual item draft
  const [member, setMember] = useState({ name: "", email: "", role: "Team Member" });
  const [emailState, setEmailState] = useState({}); // itemId -> "sending"|"sent"|"err:..."
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });

  const commit = (next) => { setPast((p) => [...p.slice(-49), state]); setFuture([]); setState(next); };
  const undo = () => { if (!past.length) return; const prev = past[past.length - 1]; setPast((p) => p.slice(0, -1)); setFuture((f) => [state, ...f].slice(0, 50)); setState(prev); };
  const redo = () => { if (!future.length) return; const nxt = future[0]; setFuture((f) => f.slice(1)); setPast((p) => [...p.slice(-49), state]); setState(nxt); };

  // Sync Margins flags in (does not create an undo entry).
  const flagsKey = JSON.stringify(flags);
  useEffect(() => {
    setState((prev) => {
      const merged = reconcile(prev.items, flags);
      if (JSON.stringify(merged) === JSON.stringify(prev.items)) return prev;
      return { ...prev, items: merged };
    });
    /* eslint-disable-next-line */
  }, [flagsKey]);

  // Persist everything on any change.
  const persistKey = JSON.stringify(state);
  useEffect(() => { if (onSave) onSave(state); /* eslint-disable-next-line */ }, [persistKey]);

  const memberById = useMemo(() => { const m = {}; state.team.forEach((t) => { m[t.id] = t; }); return m; }, [state.team]);

  // ── App access (owner only) — email invites, per-user logins, revoke ────────
  const [access, setAccess] = useState(null); // email -> user record from the server
  const [inviteState, setInviteState] = useState({}); // memberId -> "sending" | "sent" | "err:…" | { link, sendError }
  const refreshAccess = async () => {
    try {
      const r = await fetch("/api/data?op=users");
      const d = await r.json();
      if (r.ok) { const m = {}; (d.users || []).forEach((u) => { m[(u.email || "").toLowerCase()] = u; }); setAccess(m); }
    } catch (e) {}
  };
  useEffect(() => { if (canInvite) refreshAccess(); /* eslint-disable-next-line */ }, [canInvite]);
  const accessFor = (t) => (access && access[(t.email || "").toLowerCase()]) || null;
  const sendInvite = async (t) => {
    if (!t.email) return;
    setInviteState((s) => ({ ...s, [t.id]: "sending" }));
    try {
      const r = await fetch("/api/data?op=invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: t.name, email: t.email, role: t.role || "Team Member", ...(t.pages && t.pages.length ? { pages: t.pages } : {}) }) });
      const d = await r.json();
      if (!r.ok) { setInviteState((s) => ({ ...s, [t.id]: "err:" + (d.error || r.status) })); return; }
      setInviteState((s) => ({ ...s, [t.id]: d.sent ? "sent" : { link: d.link, sendError: d.sendError } }));
      refreshAccess();
    } catch (e) { setInviteState((s) => ({ ...s, [t.id]: "err:Could not reach the server" })); }
  };
  const revokeAccess = async (t) => {
    const u = accessFor(t);
    if (!u) return;
    if (!confirm(`Remove ${t.name}'s access to the app? Their login stops working immediately.`)) return;
    try {
      await fetch("/api/data?op=revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: u.id }) });
      setInviteState((s) => { const n = { ...s }; delete n[t.id]; return n; });
      refreshAccess();
    } catch (e) {}
  };
  const accessLabel = (t) => {
    const u = accessFor(t);
    if (!u || u.revoked) return { text: u && u.revoked ? "access revoked" : "no app access", color: c.sub };
    if (u.acceptedAt) return { text: "active — has own login", color: c.green };
    if (u.inviteExpired) return { text: "invite expired", color: c.red };
    return { text: "invited — waiting", color: c.clay };
  };
  // Per-person pages: which tabs this login sees (null = role default).
  const [pagesOpen, setPagesOpen] = useState(null); // member id with the picker expanded
  const [pagesSaving, setPagesSaving] = useState(false);
  const setPages = async (t, pages) => {
    const u = accessFor(t);
    if (!u || pagesSaving) return;
    setPagesSaving(true);
    try {
      await fetch("/api/data?op=set_pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: u.id, pages }) });
      await refreshAccess();
    } catch (e) {}
    setPagesSaving(false);
  };
  // Pages chosen before the person is invited live on the roster member and
  // ride along with the invite.
  const setMemberPages = (id, pages) => commit({ ...state, team: state.team.map((m) => m.id === id ? { ...m, pages } : m) });
  // Role edits reach the live login too, not just the roster.
  const syncRole = async (t, role) => {
    const u = accessFor(t);
    if (!u) return;
    try {
      await fetch("/api/data?op=set_role", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: u.id, role }) });
      refreshAccess();
    } catch (e) {}
  };

  const sorted = useMemo(() => {
    const arr = state.items.filter((it) => filter === "all" ? true : filter === "done" ? !isLive(it) : isLive(it));
    return arr.slice().sort((a, b) => {
      const ra = SEV[a.severity] ? SEV[a.severity].rank : 1, rb = SEV[b.severity] ? SEV[b.severity].rank : 1;
      if (ra !== rb) return ra - rb;
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    });
  }, [state.items, filter]);

  // Calendar: due dates plotted by day, sorted by urgency within each day.
  const pad2 = (n) => String(n).padStart(2, "0");
  const dueByDate = useMemo(() => {
    const m = {};
    state.items.forEach((it) => { if (it.dueDate && isLive(it)) { (m[it.dueDate] = m[it.dueDate] || []).push(it); } });
    Object.keys(m).forEach((k) => m[k].sort((a, b) => (SEV[a.severity] ? SEV[a.severity].rank : 1) - (SEV[b.severity] ? SEV[b.severity].rank : 1)));
    return m;
  }, [state.items]);
  const calCells = useMemo(() => {
    const startDow = new Date(calMonth.y, calMonth.m, 1).getDay();
    const daysIn = new Date(calMonth.y, calMonth.m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysIn; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [calMonth]);
  const shiftMonth = (delta) => setCalMonth((c) => { const d = new Date(c.y, c.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const todayObj = new Date(); const todayStr = todayObj.getFullYear() + "-" + pad2(todayObj.getMonth() + 1) + "-" + pad2(todayObj.getDate());
  const monthLabel = new Date(calMonth.y, calMonth.m, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  const liveCount = state.items.filter(isLive).length;
  const highCount = state.items.filter((it) => isLive(it) && it.severity === "high").length;

  // ── mutations ────────────────────────────────────────────────────────────
  const updateItem = (id, patch) => commit({ ...state, items: state.items.map((it) => it.id === id ? { ...it, ...patch } : it) });
  const removeItem = (id) => commit({ ...state, items: state.items.filter((it) => it.id !== id) });
  const clearResolved = () => commit({ ...state, items: state.items.filter(isLive) });
  const addManual = () => {
    if (!draft || !draft.title.trim()) { setDraft(null); return; }
    const it = { id: uid("man"), source: "manual", title: draft.title.trim(), detail: draft.detail.trim(), severity: draft.severity, assignees: draft.assigneeId ? [draft.assigneeId] : [], status: "open", createdAt: new Date().toISOString() };
    commit({ ...state, items: [it, ...state.items] }); setDraft(null);
  };
  const addMember = () => {
    if (!member.name.trim()) return;
    const t = { id: uid("tm"), name: member.name.trim(), email: member.email.trim(), role: member.role || "Team Member", color: AVATAR_COLORS[state.team.length % AVATAR_COLORS.length] };
    commit({ ...state, team: [...state.team, t] }); setMember({ name: "", email: "", role: "Team Member" });
  };
  const setRole = (id, role) => commit({ ...state, team: state.team.map((t) => t.id === id ? { ...t, role } : t) });
  const removeMember = (id) => commit({ ...state, team: state.team.filter((t) => t.id !== id), items: state.items.map((it) => it.assigneeId === id ? { ...it, assigneeId: null } : it) });
  const [editId, setEditId] = useState(null);
  const [editVals, setEditVals] = useState({ name: "", email: "" });
  const startEdit = (t) => { setEditId(t.id); setEditVals({ name: t.name, email: t.email || "" }); };
  const saveEdit = () => { if (!editVals.name.trim()) { setEditId(null); return; } commit({ ...state, team: state.team.map((t) => t.id === editId ? { ...t, name: editVals.name.trim(), email: editVals.email.trim() } : t) }); setEditId(null); };
  const toggleRecurring = (rid) => commit({ ...state, recurringChecked: { ...state.recurringChecked, [rid]: !state.recurringChecked[rid] } });

  // assignees: support multiple per task; migrate legacy single assigneeId.
  const getAssignees = (it) => (it.assignees && it.assignees.length ? it.assignees : (it.assigneeId ? [it.assigneeId] : []));
  const addAssignee = (id, memberId) => { if (!memberId) return; const it = state.items.find((x) => x.id === id); const cur = getAssignees(it); if (cur.includes(memberId)) return; updateItem(id, { assignees: [...cur, memberId], assigneeId: undefined }); };
  const dropAssignee = (id, memberId) => { const it = state.items.find((x) => x.id === id); updateItem(id, { assignees: getAssignees(it).filter((a) => a !== memberId), assigneeId: undefined }); };
  const setDue = (id, date) => updateItem(id, { dueDate: date || null });

  const notifyAll = async (it) => {
    const recips = getAssignees(it).map((aid) => memberById[aid]).filter((m) => m && m.email);
    if (!recips.length) return;
    setEmailState((s) => ({ ...s, [it.id]: "sending" }));
    let ok = 0, errMsg = null;
    for (const m of recips) {
      try {
        const d = await fetch("/api/data?op=notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: m.email, itemTitle: it.title, itemDetail: it.detail, productName: it.name, severity: it.severity, dueDate: it.dueDate }) }).then((r) => r.json());
        if (d.sent) ok += 1; else errMsg = d.error || "failed";
      } catch (e) { errMsg = String(e); }
    }
    if (ok && !errMsg) setEmailState((s) => ({ ...s, [it.id]: "sent" }));
    else if (ok) setEmailState((s) => ({ ...s, [it.id]: "err:sent " + ok + ", but: " + errMsg }));
    else setEmailState((s) => ({ ...s, [it.id]: "err:" + errMsg }));
  };

  // due-date display helper
  const dueInfo = (d) => {
    if (!d) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = new Date(d + "T00:00:00"); const days = Math.round((due - today) / 86400000);
    if (days < 0) return { text: "Overdue " + (-days) + "d", color: c.red };
    if (days === 0) return { text: "Due today", color: c.red };
    if (days <= 3) return { text: "Due in " + days + "d", color: c.clay };
    return { text: "Due in " + days + "d", color: c.sub };
  };

  const Avatar = ({ m, size = 24 }) => (
    <span title={m ? (m.name + (m.email ? " · " + m.email : "")) : "unassigned"} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: "50%", background: m ? m.color : "transparent", border: m ? "none" : `1px dashed ${c.line}`, color: "#fff", fontFamily: sans, fontSize: size * 0.4, flexShrink: 0 }}>
      {m ? initials(m.name) : ""}
    </span>
  );

  const recurringCats = useMemo(() => [...new Set((recurring || []).map((i) => i.category))], [recurring]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <div>
          <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 400, color: c.ink, margin: 0 }}>Action Items</h1>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: "rgba(111,102,87,0.6)" }}>Prioridades auto-generadas desde Márgenes — asigna a un miembro del equipo y notifícale por email.</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={undo} disabled={!past.length} style={{ ...btnGhost, opacity: past.length ? 1 : 0.4 }}>↶ Undo</button>
          <button onClick={redo} disabled={!future.length} style={{ ...btnGhost, opacity: future.length ? 1 : 0.4 }}>Redo ↷</button>
        </div>
      </div>

      {/* calendar — all due dates, color-coded by urgency, with assignee initials */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans }}>Due-date calendar</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => shiftMonth(-1)} style={btnGhost}>‹</button>
            <span style={{ fontFamily: serif, fontSize: 15, color: c.ink, minWidth: 150, textAlign: "center" }}>{monthLabel}</span>
            <button onClick={() => shiftMonth(1)} style={btnGhost}>›</button>
          </span>
          <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
            {["high", "med", "low"].map((k) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: SEV[k].color, display: "inline-block" }} /><span style={{ fontFamily: sans, fontSize: 8, color: c.sub, letterSpacing: 1 }}>{SEV[k].label}</span></span>)}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} style={{ fontFamily: sans, fontSize: 8, letterSpacing: 1, color: c.sub, textAlign: "center", padding: "2px 0" }}>{d}</div>)}
          {calCells.map((d, i) => {
            if (d == null) return <div key={i} style={{ minHeight: 64, background: "transparent" }} />;
            const ds = calMonth.y + "-" + pad2(calMonth.m + 1) + "-" + pad2(d);
            const items = dueByDate[ds] || [];
            const isToday = ds === todayStr;
            return (
              <div key={i} style={{ minHeight: 64, border: `1px solid ${isToday ? c.clay : c.line}`, background: isToday ? "#efe7da" : "#f3f0ea", borderRadius: 2, padding: 3, overflow: "hidden" }}>
                <div style={{ fontFamily: sans, fontSize: 9, color: isToday ? c.clay : c.sub, textAlign: "right" }}>{d}</div>
                {items.slice(0, 3).map((it) => {
                  const sv = SEV[it.severity] || SEV.med;
                  const aids = getAssignees(it); const am = aids.length ? memberById[aids[0]] : null; const extra = aids.length - 1;
                  return (
                    <div key={it.id} title={it.title + (am ? " · " + am.name : "")} style={{ background: sv.color, color: "#fff", borderRadius: 2, padding: "1px 3px", fontSize: 8, fontFamily: sans, display: "flex", alignItems: "center", gap: 3, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden" }}>
                      {am && <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 12, height: 12, borderRadius: "50%", background: "rgba(255,255,255,0.35)", fontSize: 7, flexShrink: 0 }}>{initials(am.name)}</span>}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{(it.title.length > 12 ? it.title.slice(0, 12) + "…" : it.title)}{extra > 0 ? " +" + extra : ""}</span>
                    </div>
                  );
                })}
                {items.length > 3 && <div style={{ fontFamily: sans, fontSize: 8, color: c.sub, marginTop: 2 }}>+{items.length - 3} more</div>}
              </div>
            );
          })}
        </div>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: "rgba(111,102,87,0.55)", marginTop: 6 }}>Set a due date on any item below and it appears here, colored by urgency with the assignee's initials.</div>
      </div>

      {/* summary + filters */}
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <span style={{ fontFamily: serif, fontSize: 20, color: highCount ? c.red : c.ink }}>{liveCount}</span>
        <span style={{ fontFamily: sans, fontSize: 10, color: c.sub, letterSpacing: 1 }}>OPEN{highCount ? ` · ${highCount} HIGH` : ""}</span>
        <span style={{ flex: 1 }} />
        {["live", "all", "done"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{ ...btnGhost, background: filter === f ? c.ink : "transparent", color: filter === f ? "#fff" : c.sub, borderColor: filter === f ? c.ink : c.line }}>{f}</button>
        ))}
        <button onClick={() => setDraft({ title: "", detail: "", severity: "med", assigneeId: "" })} style={{ ...btnGhost, color: c.ink, borderColor: c.clay }}>+ Add item</button>
        {state.items.some((it) => !isLive(it)) && <button onClick={clearResolved} style={btnGhost}>Clear done</button>}
      </div>

      {/* team dashboard — persists automatically; powers every assign menu */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans }}>Team · tag people on action items</span>
          <span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>{state.team.length} member{state.team.length === 1 ? "" : "s"} · saved</span>
        </div>
        {state.team.length === 0 && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.sub, marginBottom: 8 }}>No team members yet. Add someone below — they save automatically and appear in every item's assign menu.</div>}
        {state.team.map((t) => editId === t.id ? (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #00000008", flexWrap: "wrap" }}>
            <input style={{ ...input, width: 140 }} value={editVals.name} onChange={(e) => setEditVals({ ...editVals, name: e.target.value })} />
            <input style={{ ...input, width: 200 }} value={editVals.email} onChange={(e) => setEditVals({ ...editVals, email: e.target.value })} />
            <button onClick={saveEdit} style={{ ...btnGhost, color: c.ink, borderColor: c.clay }}>Save</button>
            <button onClick={() => setEditId(null)} style={btnGhost}>Cancel</button>
          </div>
        ) : (
          <div key={t.id} style={{ borderBottom: "1px solid #00000008" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", flexWrap: "wrap" }}>
            <Avatar m={t} size={26} />
            <span style={{ fontFamily: serif, fontSize: 14, color: c.ink, minWidth: 120 }}>{t.name}</span>
            <select value={t.role || "Team Member"} onChange={(e) => { setRole(t.id, e.target.value); if (canInvite) syncRole(t, e.target.value); }} title="Role — controls which tabs this person sees when they log in"
              style={{ background: "transparent", border: `1px solid ${c.line}`, borderRadius: 1, color: c.sub, fontFamily: sans, fontSize: 10, padding: "3px 6px", cursor: "pointer" }}>
              {TEAM_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <span style={{ fontFamily: sans, fontSize: 11, color: t.email ? c.sub : c.red, flex: 1, minWidth: 140 }}>{t.email || "no email — can't notify or invite"}</span>
            {canInvite && t.email && access && (() => { const a = accessLabel(t); const u = accessFor(t); const st = inviteState[t.id]; return (
              <>
                <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: a.color }}>{st === "sent" ? "invite emailed ✓" : a.text}</span>
                {(!u || u.revoked || !u.acceptedAt) && <button onClick={() => sendInvite(t)} disabled={st === "sending"} style={{ ...btnGhost, color: c.ink, borderColor: c.clay }}>{st === "sending" ? "Inviting…" : (u && !u.revoked && u.invitedAt) ? "Re-invite" : "Invite"}</button>}
                {!/^owner/i.test((u && !u.revoked && u.role) || t.role || "") && (() => { const pl = (u && !u.revoked) ? u.pages : t.pages; return (
                  <button onClick={() => setPagesOpen(pagesOpen === t.id ? null : t.id)} style={{ ...btnGhost, color: pagesOpen === t.id ? c.ink : c.sub, borderColor: (pl && pl.length) ? c.clay : c.line }} title="Choose exactly which pages this person sees">Pages{(pl && pl.length) ? " · " + pl.length : ""}</button>
                ); })()}
                {u && !u.revoked && <button onClick={() => revokeAccess(t)} style={{ ...btnGhost, color: c.red }}>Revoke</button>}
              </>
            ); })()}
            <button onClick={() => startEdit(t)} style={btnGhost}>Edit</button>
            <button onClick={() => removeMember(t.id)} style={btnGhost}>Remove</button>
          </div>
          {canInvite && pagesOpen === t.id && (() => {
            const u0 = accessFor(t);
            const u = (u0 && !u0.revoked) ? u0 : null; // live login vs pre-invite
            const role = (u && u.role) || t.role || "Team Member";
            if (/^owner/i.test(role)) return null;
            const stored = u ? u.pages : t.pages;
            const custom = !!(stored && stored.length);
            const effective = custom ? stored : (ROLE_DEFAULT_PAGES[role] || ROLE_DEFAULT_PAGES["Viewer"]);
            const apply = (pages) => u ? setPages(t, pages) : setMemberPages(t.id, pages);
            const toggle = (id) => {
              const next = effective.includes(id) ? effective.filter((x) => x !== id) : [...effective, id];
              if (!next.length) return; // a login always keeps at least one page
              apply(next);
            };
            return (
              <div style={{ padding: "2px 0 10px 36px" }}>
                <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, marginBottom: 6 }}>
                  {custom ? "Custom pages — only these tabs" : ("Role default (" + role + ") — tap to customize")}{pagesSaving ? " · saving…" : ""}
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                  {APP_PAGES.map((p) => {
                    const on = effective.includes(p.id);
                    return (
                      <button key={p.id} onClick={() => toggle(p.id)} disabled={pagesSaving}
                        style={{ border: `1px solid ${on ? c.ink : c.line}`, background: on ? c.ink : "transparent", color: on ? "#FFFFFF" : c.sub, borderRadius: 1, padding: "4px 10px", fontFamily: sans, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>
                        {p.label}
                      </button>
                    );
                  })}
                  {custom && <button onClick={() => apply(null)} disabled={pagesSaving} style={{ ...btnGhost, color: c.clay, borderColor: c.clay }}>Reset to role default</button>}
                </div>
                <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub, marginTop: 6 }}>
                  {u ? ("Applies the next time " + t.name.split(" ")[0] + " loads the app — no new invite needed.")
                     : ("Saved on the roster — applies automatically when you invite " + t.name.split(" ")[0] + ".")}
                </div>
              </div>
            );
          })()}
          {canInvite && inviteState[t.id] && typeof inviteState[t.id] === "object" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 0 8px 36px", flexWrap: "wrap" }}>
              <span style={{ fontFamily: sans, fontSize: 10.5, color: c.red }}>Email didn't send{inviteState[t.id].sendError ? " (" + inviteState[t.id].sendError + ")" : ""} — send them this private link instead:</span>
              <button onClick={() => { navigator.clipboard && navigator.clipboard.writeText(inviteState[t.id].link); }} style={{ ...btnGhost, color: c.ink, borderColor: c.clay }}>Copy invite link</button>
            </div>
          )}
          {canInvite && typeof inviteState[t.id] === "string" && inviteState[t.id].startsWith("err:") && (
            <div style={{ padding: "0 0 8px 36px", fontFamily: sans, fontSize: 10.5, color: c.red }}>{inviteState[t.id].slice(4)}</div>
          )}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 10, flexWrap: "wrap" }}>
          <input style={{ ...input, width: 140 }} placeholder="name" value={member.name} onChange={(e) => setMember({ ...member, name: e.target.value })} />
          <input style={{ ...input, width: 200 }} placeholder="email" value={member.email} onChange={(e) => setMember({ ...member, email: e.target.value })} />
          <button onClick={addMember} style={{ ...btnGhost, color: c.ink, borderColor: c.clay }}>+ Add member</button>
        </div>
      </div>

      {/* new manual item draft */}
      {draft && (
        <div style={{ ...card, borderLeft: `3px solid ${c.clay}` }}>
          <input style={{ ...input, width: "100%", marginBottom: 6 }} placeholder="What needs to happen?" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} autoFocus />
          <input style={{ ...input, width: "100%", marginBottom: 6 }} placeholder="Detail (optional)" value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select style={selStyle} value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
              <option value="high">HIGH</option><option value="med">MED</option><option value="low">LOW</option>
            </select>
            <select style={selStyle} value={draft.assigneeId} onChange={(e) => setDraft({ ...draft, assigneeId: e.target.value })}>
              <option value="">— assign —</option>
              {state.team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={addManual} style={{ ...btnGhost, color: c.ink, borderColor: c.clay }}>Save</button>
            <button onClick={() => setDraft(null)} style={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {/* the board */}
      {sorted.length === 0 && <div style={{ ...card, fontFamily: sans, fontSize: 12, color: c.green }}>No open action items. Nothing is quietly bleeding.</div>}
      {sorted.map((it) => {
        const sev = SEV[it.severity] || SEV.med;
        const assignees = getAssignees(it);
        const di = dueInfo(it.dueDate);
        const done = !isLive(it);
        return (
          <div key={it.id} style={{ ...card, borderLeft: `3px solid ${done ? c.line : sev.color}`, opacity: done ? 0.6 : 1, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontFamily: sans, fontSize: 8, letterSpacing: 1, color: "#fff", background: sev.color, padding: "1px 5px", borderRadius: 1 }}>{sev.label}</span>
                  <span style={{ fontFamily: sans, fontSize: 8, letterSpacing: 1, color: c.sub }}>{it.source === "margins" ? "AUTO · MARGINS" : "MANUAL"}</span>
                  {it.autoResolved && <span style={{ fontFamily: sans, fontSize: 8, letterSpacing: 1, color: c.green }}>AUTO-RESOLVED</span>}
                </div>
                <div style={{ fontFamily: serif, fontSize: 15, color: c.ink, textDecoration: done ? "line-through" : "none" }}>{it.title}</div>
                {it.detail && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.sub, marginTop: 2 }}>{it.detail}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  {assignees.map((aid) => { const am = memberById[aid]; if (!am) return null; return (
                    <span key={aid} title={am.email || "no email"} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#F0F0EE", border: `1px solid ${c.line}`, borderRadius: 13, padding: "2px 7px 2px 2px" }}>
                      <Avatar m={am} size={18} />
                      <span style={{ fontFamily: sans, fontSize: 10, color: c.ink }}>{am.name.split(" ")[0]}</span>
                      <button onClick={() => dropAssignee(it.id, aid)} title="remove" style={{ border: "none", background: "transparent", color: c.sub, cursor: "pointer", fontSize: 12, lineHeight: 1 }}>×</button>
                    </span>
                  ); })}
                  {di && <span style={{ fontFamily: sans, fontSize: 10, color: di.color, letterSpacing: 1 }}>● {di.text}</span>}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <select style={selStyle} value={it.severity} onChange={(e) => updateItem(it.id, { severity: e.target.value })}>
                  <option value="high">HIGH</option><option value="med">MED</option><option value="low">LOW</option>
                </select>
                <select style={selStyle} value={it.status === "resolved" ? "done" : it.status} onChange={(e) => updateItem(it.id, { status: e.target.value, autoResolved: false })}>
                  {STATUS.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                </select>
                <input type="date" value={it.dueDate || ""} onChange={(e) => setDue(it.id, e.target.value)} style={{ ...selStyle, color: it.dueDate ? c.ink : c.sub }} title="Due date" />
                <select style={selStyle} value="" onChange={(e) => { addAssignee(it.id, e.target.value); e.target.value = ""; }}>
                  <option value="">+ assign…</option>
                  {state.team.filter((t) => !assignees.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}{t.email ? "" : " (no email)"}</option>)}
                </select>
                {(() => {
                  const st = emailState[it.id];
                  const canSend = assignees.some((aid) => { const am = memberById[aid]; return am && am.email; });
                  const err = st && st.indexOf("err:") === 0;
                  return (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <button onClick={() => notifyAll(it)} disabled={!canSend || st === "sending"} title={canSend ? "Email all assignees" : "Assign a team member who has an email first"} style={{ ...btnGhost, color: st === "sent" ? c.green : (canSend ? c.clay : c.sub), borderColor: st === "sent" ? c.green : (canSend ? c.clay : c.line), opacity: (!canSend || st === "sending") ? 0.5 : 1 }}>{st === "sending" ? "Sending…" : st === "sent" ? "✓ Sent" : "✉ Email assignees"}</button>
                      {err && <span style={{ fontFamily: sans, fontSize: 9, color: c.red, maxWidth: 220 }}>{st.slice(4)}</span>}
                    </span>
                  );
                })()}
                {it.source === "manual" && <button onClick={() => removeItem(it.id)} style={{ ...btnGhost }}>Delete</button>}
              </div>
            </div>
          </div>
        );
      })}

      {/* recurring ops review (preserved from the old checklist) */}
      {recurring && recurring.length > 0 && (
        <div style={card}>
          <div onClick={() => setShowRecurring((v) => !v)} style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans }}>Bi-weekly ops review · {recurring.filter((i) => state.recurringChecked[i.id]).length}/{recurring.length}</span>
            <span style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>{showRecurring ? "▾" : "▸"}</span>
          </div>
          {showRecurring && recurringCats.map((cat) => (
            <div key={cat} style={{ marginTop: 10 }}>
              <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.clay, marginBottom: 4 }}>{cat}</div>
              {recurring.filter((i) => i.category === cat).map((item) => (
                <label key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "4px 0", cursor: "pointer" }}>
                  <input type="checkbox" checked={!!state.recurringChecked[item.id]} onChange={() => toggleRecurring(item.id)} style={{ marginTop: 3 }} />
                  <span style={{ fontFamily: serif, fontSize: 13, color: state.recurringChecked[item.id] ? c.sub : c.ink, textDecoration: state.recurringChecked[item.id] ? "line-through" : "none" }}>{item.label}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
