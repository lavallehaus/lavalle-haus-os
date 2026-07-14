import { useEffect, useMemo, useState } from "react";

// LAVALLE HAUS OS — Boards (Content → Boards)
// The Trello workspaces, brought home. Three businesses, each with its boards;
// lists as columns; cards with covers, neutral-palette labels, members, due
// dates, a completion circle, and a comments & activity thread with @tags.
// Tagged members get an email when their card changes or they're mentioned
// (delivery needs their email on the Team roster). Undo/Redo on every change.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", red: "#9b5e5e", green: "#5a7a5a" };
const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";

export const WORKSPACES = [
  { id: "lavalle-sisters", label: "Lavalle Sisters", tagline: "Sister founder business", boards: ["lavalle-sisters", "archives-lavalle-sisters", "master-projects"] },
  { id: "lavalle-haus", label: "Lavalle Haus", tagline: "Refillery Haus · operations · R&D", boards: ["refillery-haus", "rh-operations", "rd"] },
  { id: "the-fold", label: "The Fold", tagline: "The label", boards: ["the-fold", "the-fold-operations"] },
];

const uid = () => "bc" + Math.random().toString(36).slice(2, 9);
const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

// URLs pasted into Notes become tappable chips. Real <a> tags matter here:
// on the phone a genuine tap on a tiktok.com / drive.google.com link hands
// off to the TikTok / Google Drive app via universal links.
export const URL_RX = /https?:\/\/[^\s<>")\]]+/g;
export const linkMeta = (u) => {
  try {
    const h = new URL(u).hostname.replace(/^www\./, "");
    if (h.includes("tiktok.com")) return { icon: "♪", label: "TikTok" };
    if (h === "drive.google.com") return { icon: "▸", label: u.includes("/folders/") ? "Drive folder" : "Drive file" };
    if (h === "docs.google.com") return { icon: "▸", label: u.includes("/spreadsheets/") ? "Google Sheet" : "Google Doc" };
    if (h.includes("instagram.com")) return { icon: "◉", label: "Instagram" };
    if (h.includes("pinterest.")) return { icon: "◌", label: "Pinterest" };
    if (h.includes("thefoldlabel.com")) return { icon: "⌂", label: "The Fold site" };
    if (h.includes("refilleryhaus.com")) return { icon: "⌂", label: "Refillery site" };
    return { icon: "🔗", label: h };
  } catch { return { icon: "🔗", label: String(u).slice(0, 30) }; }
};
export function NotesLinks({ text }) {
  const urls = [...new Set(String(text || "").match(URL_RX) || [])];
  if (!urls.length) return null;
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6, marginBottom: 4 }}>
      {urls.map((u, i) => {
        const m = linkMeta(u);
        return (
          <a key={i} href={u} target="_blank" rel="noopener noreferrer" title={u}
            style={{ border: `1px solid ${c.line}`, borderRadius: 1, padding: "5px 11px", fontFamily: sans, fontSize: 10.5, letterSpacing: 0.5, color: c.ink, textDecoration: "none", background: c.bg, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: c.taupe }}>{m.icon}</span> {m.label} ↗
          </a>
        );
      })}
    </div>
  );
}

// The Row palette — neutral label colors only.
export const LABEL_PALETTE = [
  { c: "#E9E6DF", t: "#1A1A1A", name: "Ivory" },
  { c: "#E3DCCC", t: "#1A1A1A", name: "Sand" },
  { c: "#D9CFC1", t: "#1A1A1A", name: "Taupe" },
  { c: "#CDBBA7", t: "#1A1A1A", name: "Clay" },
  { c: "#C9C6B4", t: "#1A1A1A", name: "Olive" },
  { c: "#CBD1C5", t: "#1A1A1A", name: "Sage" },
  { c: "#C6CCCF", t: "#1A1A1A", name: "Slate" },
  { c: "#E2D4CD", t: "#1A1A1A", name: "Blush" },
  { c: "#8F8676", t: "#FFFFFF", name: "Deep taupe" },
  { c: "#1A1A1A", t: "#FFFFFF", name: "Ink" },
];
// legacy Trello color names → the neutral palette
const LEGACY_COLOR = { green: "#CBD1C5", yellow: "#E3DCCC", orange: "#CDBBA7", red: "#E2D4CD", purple: "#C6CCCF", blue: "#C6CCCF", sky: "#C6CCCF", lime: "#C9C6B4", pink: "#E2D4CD", black: "#8F8676" };
const normLabel = (lb) => {
  if (typeof lb === "string") return { n: lb, c: LEGACY_COLOR[lb.toLowerCase()] || "#E9E6DF" };
  return { n: lb.n || "", c: lb.c || "#E9E6DF" };
};
const labelText = (hex) => (hex === "#8F8676" || hex === "#1A1A1A" ? "#FFFFFF" : "#1A1A1A");

function fileToCover(file, cb) {
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 700 / img.width);
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      cb(cv.toDataURL("image/jpeg", 0.82));
    };
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}

export default function Boards({ data, onSave, team = [] }) {
  const [boards, setBoards] = useState(data || null);
  const [loading, setLoading] = useState(!data);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [ws, setWs] = useState(() => { try { return localStorage.getItem("lh_boards_ws") || "lavalle-haus"; } catch { return "lavalle-haus"; } });
  useEffect(() => { try { localStorage.setItem("lh_boards_ws", ws); } catch {} }, [ws]);
  const [open, setOpen] = useState(null);
  const [editCard, setEditCard] = useState(null);
  const [me, setMe] = useState(() => { try { return localStorage.getItem("lh_me") || ""; } catch { return ""; } });
  useEffect(() => { try { if (me) localStorage.setItem("lh_me", me); } catch {} }, [me]);

  // First run: seed from the Trello export; later runs merge covers/members once.
  useEffect(() => {
    (async () => {
      if (boards && boards._mediaV3) return;
      try {
        const seed = await fetch("/boards-seed.json").then((r) => r.json());
        if (!boards) {
          setBoards(seed);
          onSave && onSave(seed);
        } else {
          const next = { ...boards, _mediaV2: true, _mediaV3: true };
          for (const [key, sb] of Object.entries(seed)) {
            if (key.startsWith("_") || !next[key]) continue;
            const seedById = {};
            (sb.cards || []).forEach((sc) => { seedById[sc.id] = sc; });
            next[key] = { ...next[key], cards: next[key].cards.map((card) => {
              const sc = seedById[card.id];
              if (!sc) return card;
              return {
                ...card,
                // restore the real notes if ours still carry the [link] placeholders
                desc: sc.desc && (!card.desc || card.desc.includes("[link]")) ? sc.desc : card.desc,
                links: (card.links && card.links.length) ? card.links : (sc.links || []),
                attachments: (card.attachments && card.attachments.length) ? card.attachments : (sc.attachments || []),
                members: (card.members && card.members.length) ? card.members : (sc.members || []),
                cover: card.cover || sc.cover || null,
              };
            }) };
          }
          setBoards(next);
          onSave && onSave(next);
        }
      } catch (e) { if (!boards) setBoards({}); }
      setLoading(false);
    })();
  }, []);

  const commit = (next) => { setPast((p) => [...p.slice(-49), boards]); setFuture([]); setBoards(next); onSave && onSave(next); };
  const undo = () => { if (!past.length) return; const prev = past[past.length - 1]; setPast((p) => p.slice(0, -1)); setFuture((f) => [boards, ...f].slice(0, 50)); setBoards(prev); onSave && onSave(prev); };
  const redo = () => { if (!future.length) return; const nxt = future[0]; setFuture((f) => f.slice(1)); setPast((p) => [...p.slice(-49), boards]); setBoards(nxt); onSave && onSave(nxt); };

  const workspace = WORKSPACES.find((w) => w.id === ws) || WORKSPACES[0];
  const board = open && boards ? boards[open] : null;

  const memberPool = useMemo(() => {
    const set = new Set(team.map((t) => t.name).filter(Boolean));
    if (boards) Object.values(boards).forEach((b) => { if (b && b.cards) b.cards.forEach((x) => (x.members || []).forEach((m) => set.add(m))); });
    return [...set].sort();
  }, [boards, team]);

  // name → roster email (loose match: exact, or first names line up)
  const emailFor = (name) => {
    const n = (name || "").trim().toLowerCase();
    const hit = team.find((t) => t.email && (
      t.name.trim().toLowerCase() === n ||
      n.startsWith(t.name.trim().toLowerCase().split(" ")[0]) ||
      t.name.trim().toLowerCase().startsWith(n.split(" ")[0])
    ));
    return hit ? hit.email : null;
  };

  // email everyone tagged on the card (except whoever made the change)
  const notify = (card, summary, extraNames = []) => {
    const names = new Set([...(card.members || []), ...extraNames]);
    names.forEach((m) => {
      if (me && m.trim().toLowerCase().startsWith(me.trim().toLowerCase().split(" ")[0])) return;
      const to = emailFor(m);
      if (!to) return;
      fetch("/api/data?op=notify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject: "Board update — " + card.name, itemTitle: card.name, itemDetail: summary, assignedBy: me || "Lavalle Haus OS Boards" }),
      }).catch(() => {});
    });
  };

  if (loading || !boards) return <div style={{ fontFamily: sans, fontSize: 12, letterSpacing: 2, color: c.sub, textAlign: "center", padding: 50 }}>OPENING THE BOARDS…</div>;

  const boardsIndex = {};
  Object.entries(boards).forEach(([k, b]) => { if (!k.startsWith("_") && b && b.lists) boardsIndex[k] = { name: b.name, lists: b.lists }; });

  const editing = editCard && boards[editCard.boardKey]
    ? (editCard.isNew ? { id: null, listId: editCard.listId, name: "", desc: "", due: null, labels: [], members: [], cover: null, comments: [] } : boards[editCard.boardKey].cards.find((x) => x.id === editCard.cardId))
    : null;

  const patchBoard = (bk, patch, base) => commit({ ...(base || boards), [bk]: { ...(base || boards)[bk], ...patch } });

  const sysComment = (text) => ({ id: uid(), by: me || "Someone", text, at: new Date().toISOString(), sys: true });

  const saveCard = (vals, targetBoardKey) => {
    const srcKey = editCard.boardKey;
    const destKey = targetBoardKey || srcKey;
    const old = editCard.isNew ? null : boards[srcKey].cards.find((x) => x.id === editCard.cardId);
    // describe what changed, for activity + email
    const changes = [];
    if (old) {
      if (old.name !== vals.name) changes.push("renamed");
      if ((old.desc || "") !== (vals.desc || "")) changes.push("notes updated");
      if ((old.due || null) !== (vals.due || null)) changes.push("due date " + (vals.due ? new Date(vals.due).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "cleared"));
      if ((old.cover || null) !== (vals.cover || null)) changes.push(vals.cover ? "cover updated" : "cover removed");
      if (JSON.stringify(old.labels || []) !== JSON.stringify(vals.labels || [])) changes.push("tags updated");
      if (destKey !== srcKey) changes.push("moved to " + boardsIndex[destKey].name);
      else if (old.listId !== vals.listId) changes.push("moved to “" + (boardsIndex[destKey].lists.find((l) => l.id === vals.listId) || {}).name + "”");
      if ((old.done || false) !== (vals.done || false)) changes.push(vals.done ? "marked done" : "reopened");
      const added = (vals.members || []).filter((m) => !(old.members || []).includes(m));
      if (added.length) changes.push("tagged " + added.join(", "));
    }
    const summary = old ? (changes.length ? changes.join(" · ") : null) : "card created";
    const withActivity = summary ? [...(vals.comments || []), sysComment(summary)] : (vals.comments || []);
    const cardOut = editCard.isNew
      ? { id: uid(), ...vals, comments: withActivity }
      : { ...old, ...vals, comments: withActivity };

    if (destKey === srcKey) {
      patchBoard(srcKey, { cards: editCard.isNew ? [...boards[srcKey].cards, cardOut] : boards[srcKey].cards.map((x) => (x.id === editCard.cardId ? cardOut : x)) });
    } else {
      // cross-board move: remove from source, add to destination
      const next = { ...boards };
      next[srcKey] = { ...next[srcKey], cards: next[srcKey].cards.filter((x) => x.id !== editCard.cardId) };
      next[destKey] = { ...next[destKey], cards: [...next[destKey].cards, cardOut] };
      commit(next);
    }
    if (summary && (cardOut.members || []).length) notify(cardOut, summary);
    setEditCard(null);
  };

  const deleteCard = () => {
    const bk = editCard.boardKey;
    const card = boards[bk].cards.find((x) => x.id === editCard.cardId);
    patchBoard(bk, { cards: boards[bk].cards.filter((x) => x.id !== editCard.cardId) });
    if (card && (card.members || []).length) notify(card, "card removed from " + boards[bk].name);
    setEditCard(null);
  };

  const toggleDone = (bk, cardId) => {
    const card = boards[bk].cards.find((x) => x.id === cardId);
    const nowDone = !card.done;
    patchBoard(bk, { cards: boards[bk].cards.map((x) => (x.id === cardId ? { ...x, done: nowDone, comments: [...(x.comments || []), sysComment(nowDone ? "marked done" : "reopened")] } : x)) });
    if ((card.members || []).length) notify(card, nowDone ? "marked done — posted" : "reopened");
  };

  const addComment = (bk, cardId, text) => {
    const card = boards[bk].cards.find((x) => x.id === cardId);
    const entry = { id: uid(), by: me || "Someone", text, at: new Date().toISOString() };
    patchBoard(bk, { cards: boards[bk].cards.map((x) => (x.id === cardId ? { ...x, comments: [...(x.comments || []), entry] } : x)) });
    // @mentions: notify anyone named after an @
    const mentioned = memberPool.filter((m) => new RegExp("@" + m.split(" ")[0], "i").test(text));
    notify(card, (me || "Someone") + " commented: " + text.slice(0, 140), mentioned);
  };

  const renameList = (l) => {
    const name = prompt("Rename list", l.name);
    if (!name || !name.trim()) return;
    patchBoard(open, { lists: board.lists.map((x) => (x.id === l.id ? { ...x, name: name.trim() } : x)) });
  };
  const deleteList = (l) => {
    const n = board.cards.filter((x) => x.listId === l.id).length;
    if (!confirm(n ? `Delete the list "${l.name}" and its ${n} card${n === 1 ? "" : "s"}?` : `Delete the empty list "${l.name}"?`)) return;
    patchBoard(open, { lists: board.lists.filter((x) => x.id !== l.id), cards: board.cards.filter((x) => x.listId !== l.id) });
  };

  const ghost = { background: "transparent", border: `1px solid ${c.line}`, borderRadius: 1, color: c.sub, fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", padding: "7px 12px", cursor: "pointer" };

  return (
    <div>
      {/* undo / redo + who am I */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={undo} disabled={!past.length} style={{ ...ghost, color: past.length ? c.sub : c.line, cursor: past.length ? "pointer" : "default" }}>Undo</button>
        <button onClick={redo} disabled={!future.length} style={{ ...ghost, color: future.length ? c.sub : c.line, cursor: future.length ? "pointer" : "default" }}>Redo</button>
        <span style={{ fontFamily: sans, fontSize: 10, color: c.sub, opacity: 0.7 }}>{past.length ? `${past.length} change${past.length === 1 ? "" : "s"} this session` : "no changes yet"}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub }}>You are</span>
          <input list="lh-me-pool" value={me} onChange={(e) => setMe(e.target.value)} placeholder="your name"
            style={{ background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "6px 10px", fontFamily: sans, fontSize: 11.5, color: c.ink, outline: "none", width: 130 }} />
          <datalist id="lh-me-pool">{memberPool.map((m) => <option key={m} value={m} />)}</datalist>
        </div>
      </div>

      {/* workspace switcher */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {WORKSPACES.map((w) => (
          <button key={w.id} onClick={() => { setWs(w.id); setOpen(null); }}
            style={{ textAlign: "left", padding: "10px 18px", borderRadius: 1, cursor: "pointer", border: `1px solid ${w.id === ws ? c.ink : c.line}`, background: w.id === ws ? c.ink : "transparent" }}>
            <div style={{ fontFamily: sans, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", color: w.id === ws ? c.bg : c.ink }}>{w.label}</div>
            <div style={{ fontFamily: sans, fontSize: 10, color: w.id === ws ? "rgba(255,255,255,0.65)" : c.sub, marginTop: 1 }}>{w.tagline}</div>
          </button>
        ))}
      </div>

      {!board ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {[...workspace.boards, ...Object.keys(boards).filter((k) => !k.startsWith("_") && boards[k] && boards[k].ws === ws && !workspace.boards.includes(k))].map((key) => {
            const b = boards[key];
            if (!b || !b.lists) return null;
            const done = b.cards.filter((x) => x.done).length;
            return (
              <div key={key} onClick={() => setOpen(key)}
                style={{ position: "relative", textAlign: "left", background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: "18px 18px 14px", cursor: "pointer", minHeight: 92 }}>
                <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 4 }}>
                  <button title="Rename board" onClick={(e) => { e.stopPropagation(); const name = prompt("Rename board", b.name); if (name && name.trim()) commit({ ...boards, [key]: { ...b, name: name.trim() } }); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: c.sub, fontSize: 11, padding: 2 }}>✎</button>
                  <button title="Delete board" onClick={(e) => { e.stopPropagation(); if (!confirm(`Delete the board "${b.name}"${b.cards.length ? " and its " + b.cards.length + " cards" : ""}?`)) return; const next = { ...boards }; delete next[key]; commit(next); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: c.sub, fontSize: 12, padding: 2 }}>×</button>
                </div>
                <div style={{ fontFamily: sans, fontSize: 15, color: c.ink, paddingRight: 40 }}>{b.name}</div>
                <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: c.sub, marginTop: 8 }}>
                  {b.lists.length} lists · {b.cards.length} cards{done ? " · " + done + " done" : ""}
                </div>
              </div>
            );
          })}
          <button onClick={() => { const name = prompt("New board name"); if (!name || !name.trim()) return; const key = "b" + uid(); commit({ ...boards, [key]: { name: name.trim(), ws, lists: [{ id: uid(), name: "To do" }], cards: [] } }); }}
            style={{ background: "transparent", border: `1px dashed ${c.line}`, borderRadius: 1, minHeight: 92, cursor: "pointer", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: c.sub }}>
            + Board
          </button>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            <button onClick={() => setOpen(null)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, padding: 0 }}>← {workspace.label}</button>
            <div style={{ fontFamily: sans, fontSize: 20, fontWeight: 300, color: c.ink }}>{board.name}</div>
            <div style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>{board.cards.length} cards</div>
            <button onClick={() => { const name = prompt("New list name"); if (name && name.trim()) patchBoard(open, { lists: [...board.lists, { id: uid(), name: name.trim() }] }); }}
              style={{ ...ghost, marginLeft: "auto" }}>+ List</button>
          </div>
          <div style={{ display: "flex", gap: 12, overflowX: "auto", alignItems: "flex-start", paddingBottom: 16 }}>
            {board.lists.map((l) => {
              const cards = board.cards.filter((x) => x.listId === l.id);
              return (
                <div key={l.id} style={{ flex: "0 0 268px", background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: "12px 10px 10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 6px 8px" }}>
                    <div style={{ flex: 1, fontFamily: sans, fontSize: 10, letterSpacing: 1.8, textTransform: "uppercase", color: c.ink }}>
                      {l.name} <span style={{ color: c.sub }}>· {cards.length}</span>
                    </div>
                    <button onClick={() => renameList(l)} title="Rename list" style={{ background: "none", border: "none", cursor: "pointer", color: c.sub, fontSize: 11, padding: 2 }}>✎</button>
                    <button onClick={() => deleteList(l)} title="Delete list" style={{ background: "none", border: "none", cursor: "pointer", color: c.sub, fontSize: 12, padding: 2 }}>×</button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "calc(100vh - 330px)", overflowY: "auto" }}>
                    {cards.map((card) => (
                      <div key={card.id} onClick={() => setEditCard({ boardKey: open, cardId: card.id })}
                        style={{ flexShrink: 0, background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, cursor: "pointer", opacity: card.done ? 0.62 : 1, overflow: "hidden" }}>
                        {card.cover && <img src={card.cover} alt="" style={{ display: "block", width: "100%", height: "auto" }} />}
                        <div style={{ padding: "9px 11px" }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleDone(open, card.id); }}
                              title={card.done ? "Mark not done" : "Mark done — posted"}
                              style={{ flexShrink: 0, width: 16, height: 16, borderRadius: "50%", border: `1.5px solid ${card.done ? c.green : c.line}`, background: card.done ? c.green : "transparent", color: c.bg, fontSize: 10, lineHeight: 1, cursor: "pointer", padding: 0, marginTop: 1 }}>
                              {card.done ? "✓" : ""}
                            </button>
                            <div style={{ flex: 1, fontFamily: sans, fontSize: 12.5, lineHeight: 1.45, color: c.ink, textDecoration: card.done ? "line-through" : "none" }}>{card.name}</div>
                          </div>
                          {((card.labels && card.labels.length > 0) || card.due || (card.members && card.members.length > 0) || (card.comments && card.comments.filter((x) => !x.sys).length > 0)) && (
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 6, paddingLeft: 24 }}>
                              {(card.labels || []).slice(0, 4).map((lb, i) => { const L = normLabel(lb); return (
                                <span key={i} style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1, textTransform: "uppercase", color: labelText(L.c), background: L.c, borderRadius: 1, padding: "2px 7px" }}>{L.n}</span>
                              ); })}
                              {card.due && <span style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1, color: new Date(card.due) < new Date() && !card.done ? c.red : c.sub }}>{new Date(card.due).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                              {(card.comments || []).filter((x) => !x.sys).length > 0 && <span style={{ fontFamily: sans, fontSize: 9, color: c.sub }}>💬 {(card.comments || []).filter((x) => !x.sys).length}</span>}
                              {(card.links || []).length > 0 && <span style={{ fontFamily: sans, fontSize: 9, color: c.sub }}>🔗 {(card.links || []).length}</span>}
                              {(card.attachments || []).length > 1 && <span style={{ fontFamily: sans, fontSize: 9, color: c.sub }}>🖼 {(card.attachments || []).length}</span>}
                              {(card.members || []).map((m, i) => (
                                <span key={"m" + i} title={m} style={{ fontFamily: sans, fontSize: 8, letterSpacing: 0.5, width: 18, height: 18, borderRadius: "50%", border: `1px solid ${c.taupe}`, color: c.taupe, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(m)}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setEditCard({ boardKey: open, listId: l.id, isNew: true })}
                    style={{ width: "100%", marginTop: 8, background: "transparent", border: `1px dashed ${c.line}`, borderRadius: 1, color: c.sub, fontFamily: sans, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", padding: "8px 0", cursor: "pointer" }}>+ Card</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editing && (
        <CardSheet
          key={editCard.cardId || "new"}
          card={editing}
          boardKey={editCard.boardKey}
          boardsIndex={boardsIndex}
          isNew={!!editCard.isNew}
          memberPool={memberPool}
          me={me}
          onClose={() => setEditCard(null)}
          onSave={saveCard}
          onDelete={editCard.isNew ? null : deleteCard}
          onComment={(text) => addComment(editCard.boardKey, editCard.cardId, text)}
        />
      )}
    </div>
  );
}

function CardSheet({ card, boardKey, boardsIndex, isNew, memberPool, me, onClose, onSave, onDelete, onComment }) {
  const [name, setName] = useState(card.name);
  const [desc, setDesc] = useState(card.desc || "");
  const [due, setDue] = useState(card.due ? card.due.slice(0, 10) : "");
  const [labels, setLabels] = useState((card.labels || []).map(normLabel));
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState(LABEL_PALETTE[2].c);
  const [destBoard, setDestBoard] = useState(boardKey);
  const [listId, setListId] = useState(card.listId);
  const [members, setMembers] = useState(card.members || []);
  const [memberInput, setMemberInput] = useState("");
  const [cover, setCover] = useState(card.cover || null);
  const [done, setDone] = useState(!!card.done);
  const [commentText, setCommentText] = useState("");
  const [links, setLinks] = useState(card.links || []);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const attachments = card.attachments || [];
  const input = { width: "100%", boxSizing: "border-box", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "9px 12px", fontFamily: sans, fontSize: 13, color: c.ink, outline: "none" };
  const label = { fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, margin: "14px 0 4px" };
  const addMember = (m) => { const v = (m || "").trim(); if (!v || members.includes(v)) return; setMembers([...members, v]); setMemberInput(""); };
  const addLabel = () => { const n = labelName.trim(); if (!n) return; setLabels([...labels, { n, c: labelColor }]); setLabelName(""); };
  const destLists = (boardsIndex[destBoard] || {}).lists || [];
  const comments = (card.comments || []);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.35)", zIndex: 300, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(460px, 94vw)", height: "100%", background: c.card, borderLeft: `1px solid ${c.line}`, padding: "24px 26px", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontFamily: sans, fontSize: 18, fontWeight: 300, color: c.ink }}>{isNew ? "New card" : "Card"}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: c.sub, cursor: "pointer" }}>×</button>
        </div>

        <button onClick={() => setDone(!done)}
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, background: "transparent", border: `1px solid ${done ? c.green : c.line}`, borderRadius: 1, padding: "8px 12px", cursor: "pointer" }}>
          <span style={{ width: 15, height: 15, borderRadius: "50%", border: `1.5px solid ${done ? c.green : c.line}`, background: done ? c.green : "transparent", color: c.bg, fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{done ? "✓" : ""}</span>
          <span style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: done ? c.green : c.sub }}>{done ? "Done — posted" : "Mark as done"}</span>
        </button>

        <div style={label}>Cover photo</div>
        {cover && <img src={cover} alt="" style={{ display: "block", width: "100%", height: "auto", maxHeight: 320, objectFit: "contain", background: c.bg, borderRadius: 1, border: `1px solid ${c.line}`, marginBottom: 6 }} />}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <label style={{ border: `1px solid ${c.line}`, borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>
            Upload
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) fileToCover(f, setCover); }} />
          </label>
          {cover && <button onClick={() => setCover(null)} style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.red, cursor: "pointer" }}>Remove</button>}
        </div>

        {/* photo attachments — tap one to make it the cover */}
        {attachments.length > 0 && (
          <div>
            <div style={label}>Photos ({attachments.length}) — tap to set as cover</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
              {attachments.map((a, i) => (
                <img key={i} src={a} alt="" onClick={() => setCover(a)}
                  style={{ width: "100%", height: 64, objectFit: "cover", borderRadius: 1, cursor: "pointer", border: cover === a ? `2px solid ${c.ink}` : `1px solid ${c.line}` }} />
              ))}
            </div>
          </div>
        )}

        <div style={label}>Title</div>
        <input style={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus={isNew} />
        <div style={label}>Notes</div>
        <textarea style={{ ...input, resize: "vertical" }} rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <NotesLinks text={desc} />

        {/* links */}
        <div style={label}>Links</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          {links.map((L, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "6px 10px" }}>
              <a href={L.u} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontFamily: sans, fontSize: 12, color: c.taupe, textDecoration: "underline", textUnderlineOffset: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🔗 {L.n || L.u}</a>
              <button onClick={() => setLinks(links.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: c.sub, cursor: "pointer", padding: 0, fontSize: 12 }}>×</button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input style={{ ...input, flex: 1 }} placeholder="Link name" value={linkName} onChange={(e) => setLinkName(e.target.value)} />
          <input style={{ ...input, flex: 2 }} placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && linkUrl.trim()) { setLinks([...links, { n: linkName.trim() || linkUrl.trim(), u: linkUrl.trim() }]); setLinkName(""); setLinkUrl(""); } }} />
          <button onClick={() => { if (!linkUrl.trim()) return; setLinks([...links, { n: linkName.trim() || linkUrl.trim(), u: linkUrl.trim() }]); setLinkName(""); setLinkUrl(""); }}
            style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "0 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>Add</button>
        </div>

        {/* tags — neutral palette */}
        <div style={label}>Tags</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
          {labels.map((L, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: L.c, color: labelText(L.c), borderRadius: 1, padding: "4px 9px", fontFamily: sans, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase" }}>
              {L.n}
              <button onClick={() => setLabels(labels.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: labelText(L.c), cursor: "pointer", padding: 0, fontSize: 11 }}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
          {LABEL_PALETTE.map((p) => (
            <button key={p.c} onClick={() => setLabelColor(p.c)} title={p.name}
              style={{ width: 24, height: 18, background: p.c, borderRadius: 1, cursor: "pointer", border: labelColor === p.c ? `2px solid ${c.ink}` : `1px solid ${c.line}`, padding: 0 }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input style={{ ...input, flex: 1 }} placeholder="New tag name…" value={labelName}
            onChange={(e) => setLabelName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addLabel(); }} />
          <button onClick={addLabel} style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "0 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>Add</button>
        </div>

        {/* members */}
        <div style={label}>Team members</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
          {members.map((m) => (
            <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${c.line}`, borderRadius: 1, background: c.bg, padding: "4px 8px", fontFamily: sans, fontSize: 11, color: c.ink }}>
              <span style={{ width: 16, height: 16, borderRadius: "50%", border: `1px solid ${c.taupe}`, color: c.taupe, fontSize: 7.5, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(m)}</span>
              {m}
              <button onClick={() => setMembers(members.filter((x) => x !== m))} style={{ background: "none", border: "none", color: c.sub, cursor: "pointer", padding: 0, fontSize: 12 }}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input style={{ ...input, flex: 1 }} list="lh-member-pool" placeholder="Tag a person…" value={memberInput}
            onChange={(e) => setMemberInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addMember(memberInput); }} />
          <button onClick={() => addMember(memberInput)} style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "0 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>Add</button>
        </div>
        <datalist id="lh-member-pool">
          {memberPool.map((m) => <option key={m} value={m} />)}
        </datalist>

        {/* board + list (move across boards) */}
        <div style={label}>Board</div>
        <select style={input} value={destBoard} onChange={(e) => { const k = e.target.value; setDestBoard(k); const ls = (boardsIndex[k] || {}).lists || []; setListId(ls.length ? ls[0].id : null); }}>
          {Object.entries(boardsIndex).map(([k, b]) => <option key={k} value={k}>{b.name}</option>)}
        </select>
        <div style={label}>List</div>
        <select style={input} value={listId || ""} onChange={(e) => setListId(e.target.value)}>
          {destLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div style={label}>Due date</div>
        <input style={input} type="date" value={due} onChange={(e) => setDue(e.target.value)} />

        <button onClick={() => { if (!name.trim() || !listId) return; onSave({ name: name.trim(), desc, due: due ? due + "T12:00:00.000Z" : null, labels, listId, members, cover, done, links, attachments, comments: card.comments || [] }, destBoard); }}
          style={{ display: "block", width: "100%", marginTop: 20, padding: "12px 0", background: c.ink, color: c.bg, border: "none", borderRadius: 1, fontFamily: sans, fontSize: 10, letterSpacing: 3, textTransform: "uppercase", cursor: "pointer" }}>
          {isNew ? "Add card" : destBoard !== boardKey ? "Save & move board" : "Save"}
        </button>
        {onDelete && (
          <button onClick={() => { if (confirm("Delete this card?")) onDelete(); }}
            style={{ display: "block", width: "100%", marginTop: 8, padding: "10px 0", background: "transparent", color: c.red, border: `1px solid ${c.line}`, borderRadius: 1, fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>
            Delete card
          </button>
        )}

        {/* comments & activity */}
        {!isNew && (
          <div>
            <div style={{ ...label, marginTop: 22 }}>Comments & activity</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input style={{ ...input, flex: 1 }} placeholder={"Write a comment… tag with @name" + (me ? "" : " (set your name top right first)")} value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && commentText.trim()) { onComment(commentText.trim()); setCommentText(""); } }} />
              <button onClick={() => { if (commentText.trim()) { onComment(commentText.trim()); setCommentText(""); } }}
                style={{ border: "none", background: c.ink, color: c.bg, borderRadius: 1, padding: "0 14px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Post</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 260, overflowY: "auto" }}>
              {[...comments].reverse().map((cm) => (
                <div key={cm.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", opacity: cm.sys ? 0.7 : 1 }}>
                  <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", border: `1px solid ${c.taupe}`, color: c.taupe, fontSize: 8.5, display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>{initials(cm.by)}</span>
                  <div>
                    <div style={{ fontFamily: sans, fontSize: 12.5, lineHeight: 1.5, color: c.ink }}>
                      <span style={{ fontWeight: 500 }}>{cm.by}</span>{" "}
                      <span style={{ color: cm.sys ? c.sub : c.ink, fontStyle: cm.sys ? "italic" : "normal" }}>{cm.text}</span>
                    </div>
                    <div style={{ fontFamily: sans, fontSize: 9.5, color: c.sub, marginTop: 1 }}>{new Date(cm.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                  </div>
                </div>
              ))}
              {comments.length === 0 && <div style={{ fontFamily: sans, fontSize: 12, fontStyle: "italic", color: c.sub }}>No activity yet.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
