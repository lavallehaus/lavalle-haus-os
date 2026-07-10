import { useEffect, useMemo, useState } from "react";

// LAVALLE HAUS OS — Grid planner (Content → Grid)
// A Plann-style feed preview: the 3-across Instagram grid, assembled
// automatically from a board list (order + captions + schedule) and a shared
// Drive folder (the real photos, matched to "Post N" cards by number).
// Drag tiles to replan the feed; click one to schedule it or mark it posted.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", red: "#9b5e5e", green: "#5a7a5a" };
const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const serif = "Georgia, 'Times New Roman', serif";

const thumb = (id, w) => `https://drive.google.com/thumbnail?id=${id}&sz=w${w || 800}`;
const folderIdFrom = (link) => {
  const m = (link || "").match(/folders\/([a-zA-Z0-9_-]{10,})/) || (link || "").match(/^([a-zA-Z0-9_-]{10,})$/);
  return m ? m[1] : null;
};
const postNum = (name) => {
  const m = /^post\s*(\d+)\b/i.exec((name || "").trim());
  return m ? parseInt(m[1], 10) : null;
};
const formatOf = (name) => {
  const m = /\[(.+?)\]/.exec(name || "");
  return m ? m[1] : "";
};
const formatIcon = (fmt) => /reel/i.test(fmt) ? "▶" : /carousel/i.test(fmt) ? "⧉" : "";

const ghost = { border: `1px solid ${c.line}`, background: "transparent", borderRadius: 1, padding: "7px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, cursor: "pointer" };

export default function GridPlanner({ data, boards, onSave, onSaveBoards }) {
  const [state, setState] = useState(data || null);
  const [feedId, setFeedId] = useState(null);
  const [aspect, setAspect] = useState("3 / 4"); // Instagram's current portrait grid; toggle to 1:1
  const [openItem, setOpenItem] = useState(null); // cardId
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [folderLink, setFolderLink] = useState("");
  const [syncMsg, setSyncMsg] = useState(null);
  const [syncing, setSyncing] = useState(false);

  // First run: seed The Fold July from the repo, same pattern as the boards.
  useEffect(() => {
    (async () => {
      if (state && state._v1) return;
      try {
        const seed = await fetch("/grid-seed.json").then((r) => r.json());
        const next = { _v1: true, feeds: (state && state.feeds) || seed.feeds };
        setState(next);
        onSave && onSave(next);
      } catch (e) {}
    })();
    /* eslint-disable-next-line */
  }, []);

  const save = (next) => { setState(next); onSave && onSave(next); };

  const feeds = (state && state.feeds) || [];
  const feed = feeds.find((f) => f.id === feedId) || feeds[0] || null;
  const board = feed && boards ? boards[feed.boardKey] : null;
  const cardById = useMemo(() => {
    const m = {};
    if (board && board.cards) board.cards.forEach((x) => { m[x.id] = x; });
    return m;
  }, [board]);

  const patchCard = (cardId, patch) => {
    if (!board || !onSaveBoards) return;
    const nextBoards = { ...boards, [feed.boardKey]: { ...board, cards: board.cards.map((x) => x.id === cardId ? { ...x, ...patch } : x) } };
    onSaveBoards(nextBoards);
  };

  const patchFeed = (patch) => {
    save({ ...state, feeds: feeds.map((f) => f.id === feed.id ? { ...f, ...patch } : f) });
  };

  const reorder = (from, to) => {
    if (from === to || from == null || to == null) return;
    const items = [...feed.items];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    patchFeed({ items });
  };

  // Sync: list the Drive folder server-side, match files "N.*" to cards "Post N".
  const runSync = async () => {
    const folderId = folderIdFrom(folderLink) || feed.folderId;
    if (!folderId) { setSyncMsg({ t: "Paste the Drive folder link first.", bad: true }); return; }
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await fetch("/api/data?op=drive_list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId }) });
      const d = await r.json();
      if (!r.ok) {
        setSyncMsg({ t: d.error === "google_not_connected" ? "Google Drive isn't connected yet — open /api/google-auth once to connect, then sync again." : ("Sync failed: " + (d.error || r.status)), bad: true });
        setSyncing(false); return;
      }
      const files = d.files || [];
      if (!files.length) {
        setSyncMsg({ t: "Google returned no images for that folder. If the folder definitely has photos, reconnect Drive at /api/google-auth (read access was added recently) and try again.", bad: true });
        setSyncing(false); return;
      }
      const byNum = {};
      files.forEach((f) => { const m = /^(\d+)\./.exec(f.name || ""); if (m) byNum[parseInt(m[1], 10)] = f.id; });
      const items = [];
      (board.cards || []).forEach((card) => {
        if (card.listId !== feed.listId) return;
        const n = postNum(card.name);
        if (n == null || !byNum[n]) return;
        items.push({ cardId: card.id, n, driveId: byNum[n] });
      });
      items.sort((a, b) => b.n - a.n);
      const matched = items.length;
      const unmatchedFiles = Object.keys(byNum).length - matched;
      patchFeed({ items, folderId, syncedAt: new Date().toISOString() });
      setSyncMsg({ t: `Synced — ${matched} posts matched${unmatchedFiles > 0 ? ", " + unmatchedFiles + " photos in the folder have no matching card yet" : ""}.` });
      setSyncOpen(false);
    } catch (e) {
      setSyncMsg({ t: "Could not reach the server.", bad: true });
    }
    setSyncing(false);
  };

  if (!feed) return <div style={{ fontFamily: sans, fontSize: 12, letterSpacing: 2, color: c.sub, textAlign: "center", padding: 50 }}>PREPARING THE GRID…</div>;

  const items = feed.items || [];
  const open = openItem ? items.find((x) => x.cardId === openItem) : null;
  const openCard = open ? cardById[open.cardId] : null;

  return (
    <div>
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {feeds.length > 1 ? (
          <select value={feed.id} onChange={(e) => setFeedId(e.target.value)}
            style={{ background: "transparent", border: `1px solid ${c.line}`, borderRadius: 1, color: c.ink, fontFamily: sans, fontSize: 11, padding: "6px 9px", cursor: "pointer" }}>
            {feeds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        ) : (
          <span style={{ fontFamily: sans, fontSize: 13, color: c.ink }}>{feed.name}</span>
        )}
        <span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>@{feed.account} · {items.length} posts</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={() => setAspect(aspect === "1 / 1" ? "3 / 4" : "1 / 1")} style={ghost} title="Toggle tile shape">{aspect === "1 / 1" ? "◻ Square" : "▯ Portrait"}</button>
          <button onClick={() => { setSyncOpen(!syncOpen); setSyncMsg(null); setFolderLink(""); }} style={{ ...ghost, color: c.ink, borderColor: c.taupe }}>⟳ Sync from Drive</button>
        </div>
      </div>

      {syncOpen && (
        <div style={{ background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: 14, marginBottom: 16 }}>
          <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 6 }}>Sync photos from a Drive folder</div>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.sub, marginBottom: 8 }}>
            Name the photos 1, 2, 3… to match the "Post 1, Post 2…" cards on {board ? board.name : "the board"} — the grid pulls each card's photo automatically.
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input value={folderLink} onChange={(e) => setFolderLink(e.target.value)} placeholder={"https://drive.google.com/drive/folders/… (blank = current folder)"}
              style={{ flex: 1, minWidth: 260, boxSizing: "border-box", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "8px 11px", fontFamily: sans, fontSize: 12, color: c.ink, outline: "none" }} />
            <button onClick={runSync} disabled={syncing} style={{ ...ghost, color: c.ink, borderColor: c.taupe }}>{syncing ? "Syncing…" : "Sync"}</button>
          </div>
        </div>
      )}
      {syncMsg && <div style={{ fontFamily: sans, fontSize: 11, color: syncMsg.bad ? c.red : c.green, marginBottom: 12 }}>{syncMsg.t}</div>}

      <div style={{ display: "flex", gap: 26, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* the phone */}
        <div style={{ width: 400, maxWidth: "100%", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 2, overflow: "hidden", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 14px 12px" }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", border: `1px solid ${c.taupe}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: sans, fontSize: 12, letterSpacing: 1, color: c.taupe }}>TF</div>
            <div>
              <div style={{ fontFamily: sans, fontSize: 13, color: c.ink }}>{feed.account}</div>
              <div style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>{items.filter((x) => (cardById[x.cardId] || {}).done).length} posted · {items.filter((x) => !(cardById[x.cardId] || {}).done).length} planned</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2, background: c.bg }}>
            {items.map((it, i) => {
              const card = cardById[it.cardId] || {};
              const fmt = formatOf(card.name);
              const icon = formatIcon(fmt);
              const overdue = card.due && !card.done && new Date(card.due) < new Date();
              return (
                <div key={it.cardId}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
                  onDragLeave={() => setOverIdx(null)}
                  onDrop={(e) => { e.preventDefault(); reorder(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
                  onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                  onClick={() => setOpenItem(it.cardId)}
                  style={{ position: "relative", aspectRatio: aspect, cursor: "grab", outline: overIdx === i && dragIdx !== null && dragIdx !== i ? `2px solid ${c.ink}` : "none", outlineOffset: -2, opacity: dragIdx === i ? 0.4 : 1 }}>
                  <img src={thumb(it.driveId, 800)} alt={card.name || ""} loading="lazy" draggable={false}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: card.done ? "grayscale(0.15) brightness(0.92)" : "none" }} />
                  {icon && <span style={{ position: "absolute", top: 6, right: 7, color: "#FFFFFF", fontSize: 12, textShadow: "0 1px 4px rgba(0,0,0,0.55)" }}>{icon}</span>}
                  {card.done && <span style={{ position: "absolute", top: 6, left: 7, color: "#FFFFFF", fontSize: 11, textShadow: "0 1px 4px rgba(0,0,0,0.55)" }}>✓</span>}
                  <span style={{ position: "absolute", bottom: 6, left: 7, fontFamily: sans, fontSize: 9, letterSpacing: 0.5, color: "#FFFFFF", textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>{it.n}</span>
                  {card.due && (
                    <span style={{ position: "absolute", bottom: 6, right: 7, fontFamily: sans, fontSize: 8.5, letterSpacing: 0.5, padding: "2px 5px", borderRadius: 1, background: "rgba(26,26,26,0.72)", color: overdue ? "#e8b4b4" : "#FFFFFF" }}>
                      {new Date(card.due).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub, padding: "10px 14px 12px" }}>
            Drag tiles to replan the feed · tap one to schedule it
          </div>
        </div>

        {/* detail sheet */}
        {open && openCard ? (
          <div style={{ flex: 1, minWidth: 280, maxWidth: 460, background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontFamily: sans, fontSize: 15, color: c.ink }}>{openCard.name}</div>
              <button onClick={() => setOpenItem(null)} style={{ background: "none", border: "none", cursor: "pointer", color: c.sub, fontSize: 15 }}>×</button>
            </div>
            <img src={thumb(open.driveId, 1600)} alt="" style={{ display: "block", width: "100%", height: "auto", maxHeight: 420, objectFit: "contain", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, margin: "12px 0" }} />
            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 4 }}>Schedule</div>
            <input type="date" value={openCard.due ? String(openCard.due).slice(0, 10) : ""} onChange={(e) => patchCard(open.cardId, { due: e.target.value || null })}
              style={{ boxSizing: "border-box", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "8px 11px", fontFamily: sans, fontSize: 12, color: c.ink, outline: "none" }} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
              <button onClick={() => patchCard(open.cardId, { done: !openCard.done })} style={{ ...ghost, color: openCard.done ? c.sub : c.green, borderColor: openCard.done ? c.line : c.green }}>
                {openCard.done ? "Mark not posted" : "✓ Mark posted"}
              </button>
              <a href={`https://drive.google.com/file/d/${open.driveId}/view`} target="_blank" rel="noopener noreferrer" style={{ ...ghost, textDecoration: "none", display: "inline-block" }}>Open photo in Drive</a>
            </div>
            {formatOf(openCard.name) && <div style={{ fontFamily: sans, fontSize: 10, color: c.sub, marginTop: 12 }}>Format: {formatOf(openCard.name)}</div>}
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub, marginTop: 10 }}>
              Dates and posted-marks save straight onto the board card — the Boards view stays in step.
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, minWidth: 240, fontFamily: serif, fontStyle: "italic", fontSize: 12.5, color: c.sub, lineHeight: 1.7, paddingTop: 8 }}>
            This is the feed as it will look on Instagram — newest post top-left, pulled from “{board ? board.name : ""}” in board order, with the real photos from your Drive folder.
            <br /><br />Tap a tile to give it a date or mark it posted. Drag tiles to try a different arrangement — the plan saves automatically for everyone.
          </div>
        )}
      </div>
    </div>
  );
}
