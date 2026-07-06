import { useEffect, useMemo, useState } from "react";

// LAVALLE HAUS OS — Boards (Content → Boards)
// The Trello workspaces, brought home. Three businesses, each with its boards;
// lists as columns, cards with labels and due dates. Seeded once from the
// Trello export (public/boards-seed.json) and then owned by the app: every
// change persists to the shared database through onSave.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", red: "#9b5e5e" };
const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";

export const WORKSPACES = [
  { id: "lavalle-sisters", label: "Lavalle Sisters", tagline: "Sister founder business", boards: ["lavalle-sisters", "archives-lavalle-sisters", "master-projects"] },
  { id: "lavalle-haus", label: "Lavalle Haus", tagline: "Refillery Haus · operations · R&D", boards: ["refillery-haus", "rh-operations", "rd"] },
  { id: "the-fold", label: "The Fold", tagline: "The label", boards: ["the-fold", "the-fold-operations"] },
];

const uid = () => "bc" + Math.random().toString(36).slice(2, 9);

export default function Boards({ data, onSave }) {
  const [boards, setBoards] = useState(data || null);
  const [loading, setLoading] = useState(!data);
  const [ws, setWs] = useState(() => { try { return localStorage.getItem("lh_boards_ws") || "lavalle-haus"; } catch { return "lavalle-haus"; } });
  useEffect(() => { try { localStorage.setItem("lh_boards_ws", ws); } catch {} }, [ws]);
  const [open, setOpen] = useState(null);   // board key
  const [editCard, setEditCard] = useState(null); // {boardKey, cardId} | {boardKey, listId, isNew}

  // First run: seed from the Trello export, then the database owns it.
  useEffect(() => {
    if (boards) return;
    (async () => {
      try {
        const seed = await fetch("/boards-seed.json").then((r) => r.json());
        setBoards(seed);
        onSave && onSave(seed);
      } catch (e) { setBoards({}); }
      setLoading(false);
    })();
  }, []);

  const commit = (next) => { setBoards(next); onSave && onSave(next); };
  const workspace = WORKSPACES.find((w) => w.id === ws) || WORKSPACES[0];
  const board = open && boards ? boards[open] : null;

  if (loading || !boards) return <div style={{ fontFamily: sans, fontSize: 12, letterSpacing: 2, color: c.sub, textAlign: "center", padding: 50 }}>OPENING THE BOARDS…</div>;

  // ── card edit sheet ──
  const editing = editCard && boards[editCard.boardKey]
    ? (editCard.isNew ? { id: null, listId: editCard.listId, name: "", desc: "", due: null, labels: [] } : boards[editCard.boardKey].cards.find((x) => x.id === editCard.cardId))
    : null;

  const saveCard = (vals) => {
    const bk = editCard.boardKey;
    const b = boards[bk];
    let cards;
    if (editCard.isNew) cards = [...b.cards, { id: uid(), listId: editCard.listId, ...vals }];
    else cards = b.cards.map((x) => (x.id === editCard.cardId ? { ...x, ...vals } : x));
    commit({ ...boards, [bk]: { ...b, cards } });
    setEditCard(null);
  };
  const deleteCard = () => {
    const bk = editCard.boardKey;
    const b = boards[bk];
    commit({ ...boards, [bk]: { ...b, cards: b.cards.filter((x) => x.id !== editCard.cardId) } });
    setEditCard(null);
  };

  return (
    <div>
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
        /* boards grid for the workspace */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {workspace.boards.map((key) => {
            const b = boards[key];
            if (!b) return null;
            return (
              <button key={key} onClick={() => setOpen(key)}
                style={{ textAlign: "left", background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: "18px 18px 14px", cursor: "pointer", minHeight: 92 }}>
                <div style={{ fontFamily: sans, fontSize: 15, color: c.ink }}>{b.name}</div>
                <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: c.sub, marginTop: 8 }}>
                  {b.lists.length} lists · {b.cards.length} cards
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        /* open board: lists as columns */
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
            <button onClick={() => setOpen(null)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: sans, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, padding: 0 }}>← {workspace.label}</button>
            <div style={{ fontFamily: sans, fontSize: 20, fontWeight: 300, color: c.ink }}>{board.name}</div>
            <div style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>{board.cards.length} cards</div>
            <button onClick={() => { const name = prompt("New list name"); if (name && name.trim()) commit({ ...boards, [open]: { ...board, lists: [...board.lists, { id: uid(), name: name.trim() }] } }); }}
              style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${c.line}`, borderRadius: 1, color: c.sub, fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", padding: "7px 12px", cursor: "pointer" }}>+ List</button>
          </div>
          <div style={{ display: "flex", gap: 12, overflowX: "auto", alignItems: "flex-start", paddingBottom: 16 }}>
            {board.lists.map((l) => {
              const cards = board.cards.filter((x) => x.listId === l.id);
              return (
                <div key={l.id} style={{ flex: "0 0 264px", background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: "12px 10px 10px" }}>
                  <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1.8, textTransform: "uppercase", color: c.ink, padding: "0 6px 8px" }}>
                    {l.name} <span style={{ color: c.sub }}>· {cards.length}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "56vh", overflowY: "auto" }}>
                    {cards.map((card) => (
                      <button key={card.id} onClick={() => setEditCard({ boardKey: open, cardId: card.id })}
                        style={{ textAlign: "left", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "9px 11px", cursor: "pointer" }}>
                        <div style={{ fontFamily: sans, fontSize: 12.5, lineHeight: 1.45, color: c.ink }}>{card.name}</div>
                        {(card.labels && card.labels.length > 0 || card.due) && (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                            {(card.labels || []).slice(0, 4).map((lb, i) => (
                              <span key={i} style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1, textTransform: "uppercase", color: c.taupe, border: `1px solid ${c.line}`, borderRadius: 1, padding: "2px 6px" }}>{lb}</span>
                            ))}
                            {card.due && <span style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1, color: new Date(card.due) < new Date() ? c.red : c.sub, padding: "2px 0" }}>{new Date(card.due).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                          </div>
                        )}
                      </button>
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

      {/* card sheet */}
      {editing && (
        <CardSheet
          key={editCard.cardId || "new"}
          card={editing}
          lists={boards[editCard.boardKey].lists}
          isNew={!!editCard.isNew}
          onClose={() => setEditCard(null)}
          onSave={saveCard}
          onDelete={editCard.isNew ? null : deleteCard}
        />
      )}
    </div>
  );
}

function CardSheet({ card, lists, isNew, onClose, onSave, onDelete }) {
  const [name, setName] = useState(card.name);
  const [desc, setDesc] = useState(card.desc || "");
  const [due, setDue] = useState(card.due ? card.due.slice(0, 10) : "");
  const [labels, setLabels] = useState((card.labels || []).join(", "));
  const [listId, setListId] = useState(card.listId);
  const input = { width: "100%", boxSizing: "border-box", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "9px 12px", fontFamily: sans, fontSize: 13, color: c.ink, outline: "none" };
  const label = { fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, margin: "14px 0 4px" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.35)", zIndex: 300, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(430px, 94vw)", height: "100%", background: c.card, borderLeft: `1px solid ${c.line}`, padding: "24px 26px", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontFamily: sans, fontSize: 18, fontWeight: 300, color: c.ink }}>{isNew ? "New card" : "Card"}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: c.sub, cursor: "pointer" }}>×</button>
        </div>
        <div style={label}>Title</div>
        <input style={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus={isNew} />
        <div style={label}>Notes</div>
        <textarea style={{ ...input, resize: "vertical" }} rows={5} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <div style={label}>List</div>
        <select style={input} value={listId} onChange={(e) => setListId(e.target.value)}>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div style={label}>Due date</div>
        <input style={input} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <div style={label}>Labels (comma separated)</div>
        <input style={input} value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="Q3, July, Arrived" />
        <button onClick={() => { if (!name.trim()) return; onSave({ name: name.trim(), desc, due: due ? due + "T12:00:00.000Z" : null, labels: labels.split(",").map((x) => x.trim()).filter(Boolean), listId }); }}
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
