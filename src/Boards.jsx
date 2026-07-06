import { useEffect, useMemo, useState } from "react";

// LAVALLE HAUS OS — Boards (Content → Boards)
// The Trello workspaces, brought home. Three businesses, each with its boards;
// lists as columns, cards with covers, labels, members, due dates and a
// completion circle (so everyone can see a post went out). Undo/Redo on every
// change. Seeded once from the Trello export, then owned by the shared
// database through onSave.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", red: "#9b5e5e", green: "#5a7a5a" };
const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";

export const WORKSPACES = [
  { id: "lavalle-sisters", label: "Lavalle Sisters", tagline: "Sister founder business", boards: ["lavalle-sisters", "archives-lavalle-sisters", "master-projects"] },
  { id: "lavalle-haus", label: "Lavalle Haus", tagline: "Refillery Haus · operations · R&D", boards: ["refillery-haus", "rh-operations", "rd"] },
  { id: "the-fold", label: "The Fold", tagline: "The label", boards: ["the-fold", "the-fold-operations"] },
];

const uid = () => "bc" + Math.random().toString(36).slice(2, 9);

// Trello label colors, translated into the house palette (quiet tints).
const LABEL_TINT = { green: "#E7EDE4", yellow: "#F3EEDC", orange: "#F2E7DA", red: "#F0E0DD", purple: "#EAE4EE", blue: "#E0E8EE", sky: "#E2ECF0", lime: "#EAF0DF", pink: "#F2E4E9", black: "#E4E4E2" };
const labelTint = (name) => LABEL_TINT[(name || "").toLowerCase()] || "transparent";

const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

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

export default function Boards({ data, onSave, teamNames = [] }) {
  const [boards, setBoards] = useState(data || null);
  const [loading, setLoading] = useState(!data);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [ws, setWs] = useState(() => { try { return localStorage.getItem("lh_boards_ws") || "lavalle-haus"; } catch { return "lavalle-haus"; } });
  useEffect(() => { try { localStorage.setItem("lh_boards_ws", ws); } catch {} }, [ws]);
  const [open, setOpen] = useState(null);
  const [editCard, setEditCard] = useState(null);

  // First run: seed from the Trello export, then the database owns it.
  // If the saved data predates the covers/members import (_mediaV2), merge
  // those in once without touching any edits made since.
  useEffect(() => {
    (async () => {
      if (boards && boards._mediaV2) return;
      try {
        const seed = await fetch("/boards-seed.json").then((r) => r.json());
        if (!boards) {
          setBoards(seed);
          onSave && onSave(seed);
        } else {
          const next = { ...boards, _mediaV2: true };
          for (const [key, sb] of Object.entries(seed)) {
            if (key.startsWith("_") || !next[key]) continue;
            const seedById = {};
            (sb.cards || []).forEach((sc) => { seedById[sc.id] = sc; });
            next[key] = { ...next[key], cards: next[key].cards.map((card) => {
              const sc = seedById[card.id];
              if (!sc) return card;
              return { ...card, members: (card.members && card.members.length) ? card.members : (sc.members || []), cover: card.cover || sc.cover || null };
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

  // every name we know: the app's team roster + anyone already on a card
  const memberPool = useMemo(() => {
    const set = new Set(teamNames.filter(Boolean));
    if (boards) Object.values(boards).forEach((b) => (b.cards || []).forEach((x) => (x.members || []).forEach((m) => set.add(m))));
    return [...set].sort();
  }, [boards, teamNames]);

  if (loading || !boards) return <div style={{ fontFamily: sans, fontSize: 12, letterSpacing: 2, color: c.sub, textAlign: "center", padding: 50 }}>OPENING THE BOARDS…</div>;

  const editing = editCard && boards[editCard.boardKey]
    ? (editCard.isNew ? { id: null, listId: editCard.listId, name: "", desc: "", due: null, labels: [], members: [], cover: null } : boards[editCard.boardKey].cards.find((x) => x.id === editCard.cardId))
    : null;

  const patchBoard = (bk, patch) => commit({ ...boards, [bk]: { ...boards[bk], ...patch } });

  const saveCard = (vals) => {
    const bk = editCard.boardKey;
    const b = boards[bk];
    const cards = editCard.isNew
      ? [...b.cards, { id: uid(), ...vals }]
      : b.cards.map((x) => (x.id === editCard.cardId ? { ...x, ...vals } : x));
    patchBoard(bk, { cards });
    setEditCard(null);
  };
  const deleteCard = () => {
    const bk = editCard.boardKey;
    patchBoard(bk, { cards: boards[bk].cards.filter((x) => x.id !== editCard.cardId) });
    setEditCard(null);
  };
  const toggleDone = (bk, cardId) => {
    patchBoard(bk, { cards: boards[bk].cards.map((x) => (x.id === cardId ? { ...x, done: !x.done } : x)) });
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
      {/* undo / redo — same ritual as every page */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button onClick={undo} disabled={!past.length} style={{ ...ghost, color: past.length ? c.sub : c.line, cursor: past.length ? "pointer" : "default" }}>Undo</button>
        <button onClick={redo} disabled={!future.length} style={{ ...ghost, color: future.length ? c.sub : c.line, cursor: future.length ? "pointer" : "default" }}>Redo</button>
        <span style={{ fontFamily: sans, fontSize: 10, color: c.sub, opacity: 0.7 }}>{past.length ? `${past.length} change${past.length === 1 ? "" : "s"} this session` : "no changes yet"}</span>
      </div>

      {/* workspace switcher — the three businesses */}
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
          {workspace.boards.map((key) => {
            const b = boards[key];
            if (!b) return null;
            const done = b.cards.filter((x) => x.done).length;
            return (
              <button key={key} onClick={() => setOpen(key)}
                style={{ textAlign: "left", background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: "18px 18px 14px", cursor: "pointer", minHeight: 92 }}>
                <div style={{ fontFamily: sans, fontSize: 15, color: c.ink }}>{b.name}</div>
                <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: c.sub, marginTop: 8 }}>
                  {b.lists.length} lists · {b.cards.length} cards{done ? " · " + done + " done" : ""}
                </div>
              </button>
            );
          })}
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
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "56vh", overflowY: "auto" }}>
                    {cards.map((card) => (
                      <div key={card.id} onClick={() => setEditCard({ boardKey: open, cardId: card.id })}
                        style={{ flexShrink: 0, background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, cursor: "pointer", opacity: card.done ? 0.62 : 1, overflow: "hidden" }}>
                        {card.cover && <img src={card.cover} alt="" style={{ display: "block", width: "100%", height: 110, objectFit: "cover" }} />}
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
                          {((card.labels && card.labels.length > 0) || card.due || (card.members && card.members.length > 0)) && (
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 6, paddingLeft: 24 }}>
                              {(card.labels || []).slice(0, 4).map((lb, i) => (
                                <span key={i} style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1, textTransform: "uppercase", color: c.ink, background: labelTint(lb), border: `1px solid ${c.line}`, borderRadius: 1, padding: "2px 6px" }}>{lb}</span>
                              ))}
                              {card.due && <span style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1, color: new Date(card.due) < new Date() && !card.done ? c.red : c.sub }}>{new Date(card.due).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
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
          lists={boards[editCard.boardKey].lists}
          isNew={!!editCard.isNew}
          memberPool={memberPool}
          onClose={() => setEditCard(null)}
          onSave={saveCard}
          onDelete={editCard.isNew ? null : deleteCard}
        />
      )}
    </div>
  );
}

function CardSheet({ card, lists, isNew, memberPool, onClose, onSave, onDelete }) {
  const [name, setName] = useState(card.name);
  const [desc, setDesc] = useState(card.desc || "");
  const [due, setDue] = useState(card.due ? card.due.slice(0, 10) : "");
  const [labels, setLabels] = useState((card.labels || []).join(", "));
  const [listId, setListId] = useState(card.listId);
  const [members, setMembers] = useState(card.members || []);
  const [memberInput, setMemberInput] = useState("");
  const [cover, setCover] = useState(card.cover || null);
  const [done, setDone] = useState(!!card.done);
  const input = { width: "100%", boxSizing: "border-box", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "9px 12px", fontFamily: sans, fontSize: 13, color: c.ink, outline: "none" };
  const label = { fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, margin: "14px 0 4px" };
  const addMember = (m) => { const v = (m || "").trim(); if (!v || members.includes(v)) return; setMembers([...members, v]); setMemberInput(""); };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.35)", zIndex: 300, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(430px, 94vw)", height: "100%", background: c.card, borderLeft: `1px solid ${c.line}`, padding: "24px 26px", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontFamily: sans, fontSize: 18, fontWeight: 300, color: c.ink }}>{isNew ? "New card" : "Card"}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: c.sub, cursor: "pointer" }}>×</button>
        </div>

        {/* done — posted */}
        <button onClick={() => setDone(!done)}
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, background: "transparent", border: `1px solid ${done ? c.green : c.line}`, borderRadius: 1, padding: "8px 12px", cursor: "pointer" }}>
          <span style={{ width: 15, height: 15, borderRadius: "50%", border: `1.5px solid ${done ? c.green : c.line}`, background: done ? c.green : "transparent", color: c.bg, fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{done ? "✓" : ""}</span>
          <span style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: done ? c.green : c.sub }}>{done ? "Done — posted" : "Mark as done"}</span>
        </button>

        {/* cover */}
        <div style={label}>Cover photo</div>
        {cover && <img src={cover} alt="" style={{ display: "block", width: "100%", height: 140, objectFit: "cover", borderRadius: 1, border: `1px solid ${c.line}`, marginBottom: 6 }} />}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <label style={{ border: `1px solid ${c.line}`, borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>
            Upload
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) fileToCover(f, setCover); }} />
          </label>
          {cover && <button onClick={() => setCover(null)} style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.red, cursor: "pointer" }}>Remove</button>}
        </div>

        <div style={label}>Title</div>
        <input style={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus={isNew} />
        <div style={label}>Notes</div>
        <textarea style={{ ...input, resize: "vertical" }} rows={5} value={desc} onChange={(e) => setDesc(e.target.value)} />

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
          <input style={{ ...input, flex: 1 }} list="lh-member-pool" placeholder="Add a person…" value={memberInput}
            onChange={(e) => setMemberInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addMember(memberInput); }} />
          <button onClick={() => addMember(memberInput)} style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "0 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>Add</button>
        </div>
        <datalist id="lh-member-pool">
          {memberPool.map((m) => <option key={m} value={m} />)}
        </datalist>

        <div style={label}>List</div>
        <select style={input} value={listId} onChange={(e) => setListId(e.target.value)}>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div style={label}>Due date</div>
        <input style={input} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <div style={label}>Tags (comma separated)</div>
        <input style={input} value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="Q3, July, Arrived" />

        <button onClick={() => { if (!name.trim()) return; onSave({ name: name.trim(), desc, due: due ? due + "T12:00:00.000Z" : null, labels: labels.split(",").map((x) => x.trim()).filter(Boolean), listId, members, cover, done }); }}
          style={{ display: "block", width: "100%", marginTop: 20, padding: "12px 0", background: c.ink, color: c.bg, border: "none", borderRadius: 1, fontFamily: sans, fontSize: 10, letterSpacing: 3, textTransform: "uppercase", cursor: "pointer" }}>
          {isNew ? "Add card" : "Save"}
        </button>
        {onDelete && (
          <button onClick={() => { if (confirm("Delete this card?")) onDelete(); }}
            style={{ display: "block", width: "100%", marginTop: 8, padding: "10px 0", background: "transparent", color: c.red, border: `1px solid ${c.line}`, borderRadius: 1, fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>
            Delete card
          </button>
        )}
      </div>
    </div>
  );
}
