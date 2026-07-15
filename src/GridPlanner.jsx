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
// an item can carry its own hosted image (src) instead of a Drive file
const imgOf = (it, w) => it.src || thumb(it.driveId, w);
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

import { NotesLinks } from "./Boards.jsx";

export default function GridPlanner({ data, boards, onSave, onSaveBoards }) {
  const [state, setState] = useState(data || null);
  const [feedId, setFeedId] = useState(null);
  const [aspect, setAspect] = useState("3 / 4"); // Instagram's current portrait grid; toggle to 1:1
  const [openItem, setOpenItem] = useState(null); // cardId
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const [calMode, setCalMode] = useState("week"); // week | month
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [overDay, setOverDay] = useState(null); // date key a tile is being dragged over
  const [syncOpen, setSyncOpen] = useState(false);
  const [folderLink, setFolderLink] = useState("");
  const [syncMsg, setSyncMsg] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [tiktok, setTiktok] = useState(null); // owner-only: {sandbox, production} connection state
  const [ttMsg, setTtMsg] = useState(null);
  const [postingNow, setPostingNow] = useState(false);

  const [insta, setInsta] = useState(null); // owner-only: {connected, accounts}

  // Platform connection chips — status ops are owner-only, so the chips simply
  // stay hidden for staff. TikTok runs sandbox until the app audit is approved.
  useEffect(() => {
    fetch("/api/data?op=tiktok_status").then((r) => (r.ok ? r.json() : null)).then((d) => d && setTiktok(d)).catch(() => {});
    fetch("/api/data?op=instagram_status").then((r) => (r.ok ? r.json() : null)).then((d) => d && setInsta(d)).catch(() => {});
  }, []);
  const ttConnected = !!(tiktok && ((tiktok.sandbox && tiktok.sandbox.connected) || (tiktok.production && tiktok.production.connected)));
  const ttNames = tiktok
    ? [...((tiktok.production && tiktok.production.accounts) || []), ...((tiktok.sandbox && tiktok.sandbox.accounts) || [])].map((a) => a.display_name).filter(Boolean).join(", ")
    : "";
  const sendTestDraft = async () => {
    setTtMsg({ t: "Sending a draft to the TikTok inbox…" });
    try {
      const r = await fetch("/api/data?op=tiktok_test_post", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await r.json();
      if (d.data && d.data.publish_id) setTtMsg({ t: "Draft sent — open the TikTok app inbox on the connected account to see it." });
      else setTtMsg({ bad: true, t: "TikTok replied: " + JSON.stringify(d.error || d).slice(0, 180) });
    } catch (e) { setTtMsg({ bad: true, t: String(e).slice(0, 180) }); }
  };

  // First run: seed The Fold July from the repo, same pattern as the boards.
  // v2 adds verified pieces (cross-checked against thefoldlabel.com) + flags.
  useEffect(() => {
    (async () => {
      if (state && state._v2) return;
      try {
        const seed = await fetch("/grid-seed.json").then((r) => r.json());
        let next;
        if (state && state._v1) {
          const seedItem = {};
          seed.feeds.forEach((f) => (f.items || []).forEach((it) => { seedItem[it.cardId] = it; }));
          next = { ...state, _v2: true, feeds: (state.feeds || []).map((f) => ({ ...f, items: (f.items || []).map((it) => {
            const s = seedItem[it.cardId];
            return s ? { ...it, pieces: s.pieces || [], ...(s.flag ? { flag: s.flag } : {}) } : it;
          }) })) };
        } else {
          next = { _v1: true, _v2: true, feeds: seed.feeds };
        }
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
  // Resolve a tile's image: explicit src → the board card's cover → Drive thumb.
  // (Lets auto-built brand feeds show board cover photos without duplicating them.)
  const imgOf = (it, w) => it.src || (cardById[it.cardId] && cardById[it.cardId].cover) || thumb(it.driveId, w);

  // Auto-build one grid feed per brand from its board's cover photos, so every
  // connected account has a grid in the dropdown — not just The Fold.
  useEffect(() => {
    if (!boards || !state) return;
    const defs = [
      { id: "feed-lavalle-sisters", name: "Lavalle Sisters", account: "lavallesisters", boardKey: "lavalle-sisters" },
      { id: "feed-refillery-haus", name: "Lavalle Haus", account: "refilleryhaus", boardKey: "refillery-haus" },
    ];
    const existing = state.feeds || [];
    const additions = [];
    for (const def of defs) {
      if (existing.some((f) => f.boardKey === def.boardKey)) continue;
      const b = boards[def.boardKey];
      if (!b || !b.cards) continue;
      const items = b.cards
        .filter((cd) => cd.cover && !/^(links|hashtags|strategy)/i.test(cd.name || ""))
        .map((cd) => ({ cardId: cd.id, n: (String(cd.name || "").match(/post\s*(\d+)/i) || [])[1] || null }))
        .sort((a, z) => (Number(a.n) || 999) - (Number(z.n) || 999));
      if (items.length) additions.push({ ...def, items });
    }
    if (additions.length) save({ ...state, feeds: [...existing, ...additions] });
    /* eslint-disable-next-line */
  }, [boards, state && state.feeds && state.feeds.length]);

  const patchCard = (cardId, patch) => {
    if (!board || !onSaveBoards) return;
    const nextBoards = { ...boards, [feed.boardKey]: { ...board, cards: board.cards.map((x) => x.id === cardId ? { ...x, ...patch } : x) } };
    onSaveBoards(nextBoards);
  };

  const patchFeed = (patch) => {
    save({ ...state, feeds: feeds.map((f) => f.id === feed.id ? { ...f, ...patch } : f) });
  };

  const patchItem = (cardId, patch) => {
    patchFeed({ items: feed.items.map((x) => (x.cardId === cardId ? { ...x, ...patch } : x)) });
  };

  // Auto-publish helpers: pub.at is a real instant (ISO); inputs speak local time.
  const timeOf = (iso) => { if (!iso) return "10:00"; const d = new Date(iso); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  const combineAt = (dateStr, timeStr) => new Date(dateStr + "T" + (timeStr || "10:00")).toISOString();

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

  // ── schedule model ── card.due ("YYYY-MM-DD…") drives everything
  const keyOf = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const today = keyOf(new Date());
  const dueKey = (card) => (card && card.due ? String(card.due).slice(0, 10) : null);
  const withCards = items.map((it) => ({ it, card: cardById[it.cardId] || {} }));
  const byDay = {};
  withCards.forEach(({ it, card }) => { const k = dueKey(card); if (k) (byDay[k] = byDay[k] || []).push({ it, card }); });
  // Posts armed straight from the Boards tab (they may not live in any grid
  // feed) show on this calendar too — days can hold several posts.
  const feedCardIds = new Set(feeds.flatMap((f) => (f.items || []).map((x) => x.cardId)));
  const boardPubsByDay = {};
  Object.entries(boards || {}).forEach(([bk, b]) => {
    if (bk.startsWith("_") || !b || !b.cards) return;
    b.cards.forEach((cd) => {
      if (!cd.pub || !cd.pub.at || feedCardIds.has(cd.id)) return;
      if (!(cd.pub.status === "published" || (cd.pub.status === "scheduled" && cd.pub.auto))) return;
      const k = keyOf(new Date(cd.pub.at));
      (boardPubsByDay[k] = boardPubsByDay[k] || []).push({ card: cd, board: b.name });
    });
  });
  const pubTitle = (cd) => cd.name + " → @" + (cd.pub.account || "?") + " · " + new Date(cd.pub.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) + (cd.pub.status === "published" ? " · posted ✓" : "");
  const upNext = withCards
    .filter(({ card }) => dueKey(card) && !card.done)
    .sort((a, b) => (dueKey(a.card) < dueKey(b.card) ? -1 : 1));
  const unscheduled = withCards.filter(({ card }) => !dueKey(card) && !card.done).length;
  const dropOnDayKeepPub = (it, k) => {
    // dragging an armed post to a new day keeps its time-of-day
    if (it && it.pub && it.pub.status === "scheduled") patchItem(it.cardId, { pub: { ...it.pub, at: combineAt(k, timeOf(it.pub.at)) } });
  };
  const dropOnDay = (k) => {
    if (dragIdx == null) return;
    const it = items[dragIdx];
    if (it) { patchCard(it.cardId, { due: k }); dropOnDayKeepPub(it, k); }
    setDragIdx(null); setOverDay(null);
  };
  const dayCellDrag = (k) => ({
    onDragOver: (e) => { e.preventDefault(); setOverDay(k); },
    onDragLeave: () => setOverDay(null),
    onDrop: (e) => { e.preventDefault(); dropOnDay(k); },
  });
  const fmtDay = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };

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
          {insta && !insta.connected && (
            <button onClick={() => window.open("/api/instagram-auth", "_blank")} style={ghost} title="Link an Instagram business account">◉ Connect Instagram</button>
          )}
          {insta && insta.connected && (
            <>
              <span style={{ ...ghost, cursor: "default" }} title="Connected Instagram accounts">◉ IG ✓ · {insta.accounts.map((a) => a.username).filter(Boolean).join(", ") || insta.accounts.length}</span>
              <button onClick={() => window.open("/api/instagram-auth", "_blank")} style={ghost} title="Connect another Instagram account or re-link this one">↻</button>
            </>
          )}
          {tiktok && !ttConnected && (
            <button onClick={() => window.open("/api/tiktok-auth?sandbox=1", "_blank")} style={ghost} title="Link the TikTok account">♪ Connect TikTok</button>
          )}
          {ttConnected && (
            <>
              <button onClick={sendTestDraft} style={ghost} title={"Send a test draft to the connected TikTok inbox" + (ttNames ? " — connected: " + ttNames : "")}>♪ TikTok ✓{ttNames ? " · " + ttNames : ""} · Test draft</button>
              <button onClick={() => window.open("/api/tiktok-auth?sandbox=1", "_blank")} style={ghost} title="Connect another TikTok account or re-link this one">↻</button>
            </>
          )}
          <button onClick={() => setAspect(aspect === "1 / 1" ? "3 / 4" : "1 / 1")} style={ghost} title="Toggle tile shape">{aspect === "1 / 1" ? "◻ Square" : "▯ Portrait"}</button>
          <button onClick={() => { setSyncOpen(!syncOpen); setSyncMsg(null); setFolderLink(""); }} style={{ ...ghost, color: c.ink, borderColor: c.taupe }}>⟳ Sync from Drive</button>
        </div>
      </div>
      {ttMsg && <div style={{ fontFamily: sans, fontSize: 11, color: ttMsg.bad ? c.red : c.green, marginBottom: 12 }}>{ttMsg.t}</div>}

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
            {(() => { const avatar = feed.avatar || (feed.boardKey && feed.boardKey.startsWith("the-fold") ? "/fold-monogram.png" : null); return (
              <div style={{ width: 44, height: 44, borderRadius: "50%", border: `1px solid ${c.line}`, background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                {avatar
                  ? <img src={avatar} alt="" style={{ width: "62%", height: "62%", objectFit: "contain" }} />
                  : <span style={{ fontFamily: sans, fontSize: 12, letterSpacing: 1, color: c.taupe }}>{(feed.account || "?").slice(0, 2).toUpperCase()}</span>}
              </div>
            ); })()}
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
                  <img src={imgOf(it, 800)} alt={card.name || ""} loading="lazy" draggable={false}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: card.done ? "grayscale(0.15) brightness(0.92)" : "none" }} />
                  {icon && <span style={{ position: "absolute", top: 6, right: 7, color: "#FFFFFF", fontSize: 12, textShadow: "0 1px 4px rgba(0,0,0,0.55)" }}>{icon}</span>}
                  {card.done && <span style={{ position: "absolute", top: 6, left: 7, color: "#FFFFFF", fontSize: 11, textShadow: "0 1px 4px rgba(0,0,0,0.55)" }}>✓</span>}
                  <span style={{ position: "absolute", bottom: 6, left: 7, fontFamily: sans, fontSize: 9, letterSpacing: 0.5, color: "#FFFFFF", textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>{it.n}{it.flag ? " ⚠" : ""}</span>
                  {card.due && (
                    <span style={{ position: "absolute", bottom: 6, right: 7, fontFamily: sans, fontSize: 8.5, letterSpacing: 0.5, padding: "2px 5px", borderRadius: 1, background: "rgba(26,26,26,0.72)", color: it.pub && it.pub.status === "failed" ? "#e8b4b4" : overdue ? "#e8b4b4" : "#FFFFFF" }}
                      title={it.pub ? (it.pub.status === "scheduled" && it.pub.auto ? "Auto-publishes " + new Date(it.pub.at).toLocaleString() : it.pub.status === "failed" ? "Publish failed — open for details" : it.pub.status === "published" ? "Published automatically" : "") : ""}>
                      {it.pub && it.pub.status === "failed" ? "✗ " : it.pub && it.pub.auto && it.pub.status === "scheduled" ? "⏱ " : ""}{new Date(card.due).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub, padding: "10px 14px 12px" }}>
            Drag tiles to rearrange · drop one on a calendar day to schedule it · tap for details
          </div>
        </div>

        {/* ── the schedule ── what goes up next + the calendar, side by side with the feed */}
        <div style={{ flex: 1, minWidth: 300, maxWidth: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe }}>Posting schedule</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 0 }}>
              {["week", "month"].map((m) => (
                <button key={m} onClick={() => setCalMode(m)}
                  style={{ ...ghost, padding: "5px 12px", background: calMode === m ? c.ink : "transparent", color: calMode === m ? "#FFFFFF" : c.sub, borderColor: calMode === m ? c.ink : c.line }}>
                  {m === "week" ? "Week" : "Month"}
                </button>
              ))}
            </div>
          </div>

          {calMode === "week" ? (
            /* rolling 7 days at a glance */
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 16 }}>
              {Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); const k = keyOf(d); const posts = byDay[k] || []; return (
                <div key={k} {...dayCellDrag(k)}
                  style={{ background: k === today ? c.card : c.bg, border: `1px solid ${overDay === k && dragIdx != null ? c.ink : c.line}`, borderRadius: 1, padding: "7px 5px 6px", minHeight: 86, textAlign: "center" }}>
                  <div style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1.5, textTransform: "uppercase", color: k === today ? c.ink : c.sub }}>
                    {d.toLocaleDateString("en-US", { weekday: "short" })}
                  </div>
                  <div style={{ fontFamily: sans, fontSize: 12, color: k === today ? c.ink : c.sub, marginBottom: 5 }}>{d.getDate()}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
                    {posts.map(({ it, card }) => (
                      <div key={it.cardId} onClick={() => setOpenItem(it.cardId)} title={card.name} style={{ position: "relative", cursor: "pointer" }}>
                        <img src={imgOf(it, 200)} alt="" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 1, opacity: card.done ? 0.5 : 1, border: `1px solid ${c.line}`, display: "block" }} />
                        {it.n != null && <span style={{ position: "absolute", left: 1, bottom: 1, fontFamily: sans, fontSize: 7.5, color: "#FFF", background: "rgba(26,26,26,0.7)", borderRadius: 1, padding: "0 3px", lineHeight: 1.4 }}>#{it.n}</span>}
                      </div>
                    ))}
                    {(boardPubsByDay[k] || []).map(({ card: cd }, bi) => cd.cover ? (
                      <img key={"bp" + bi} src={cd.cover} alt="" title={pubTitle(cd)}
                        style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 1, border: `1.5px solid ${cd.pub.status === "published" ? c.green : c.taupe}` }} />
                    ) : (
                      <span key={"bp" + bi} title={pubTitle(cd)} style={{ fontFamily: sans, fontSize: 8, letterSpacing: 0.5, background: cd.pub.status === "published" ? c.green : c.taupe, color: "#FFF", borderRadius: 2, padding: "2px 4px", maxWidth: 44, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{cd.pub.account}</span>
                    ))}
                  </div>
                </div>
              ); })}
            </div>
          ) : (
            /* month preview */
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <button onClick={() => setCalMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} style={{ ...ghost, padding: "3px 10px" }}>←</button>
                <span style={{ fontFamily: sans, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", color: c.ink }}>
                  {new Date(calMonth.y, calMonth.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </span>
                <button onClick={() => setCalMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} style={{ ...ghost, padding: "3px 10px" }}>→</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w, i) => (
                  <div key={i} style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.sub, padding: "2px 4px 6px" }}>{w}</div>
                ))}
                {(() => {
                  const first = new Date(calMonth.y, calMonth.m, 1);
                  const days = new Date(calMonth.y, calMonth.m + 1, 0).getDate();
                  const cells = [];
                  const timeOf = (iso) => iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
                  // one Plann-style row: cover + #number + caption + time
                  const PostRow = ({ cover, num, name, time, tone, done, onClick, title }) => (
                    <div onClick={onClick} title={title}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 4px", borderRadius: 2, cursor: onClick ? "pointer" : "default", background: c.bg, border: `1px solid ${c.line}`, borderLeft: `3px solid ${tone}`, opacity: done ? 0.55 : 1 }}>
                      {cover ? <img src={cover} alt="" style={{ width: 30, height: 30, objectFit: "cover", borderRadius: 1, flexShrink: 0 }} />
                        : <span style={{ width: 30, height: 30, borderRadius: 1, background: c.card, flexShrink: 0 }} />}
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: "block", fontFamily: sans, fontSize: 10, color: c.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{num ? <b>#{num}</b> : ""} {name}</span>
                        {time && <span style={{ display: "block", fontFamily: sans, fontSize: 8.5, letterSpacing: 0.5, color: c.sub }}>{time}</span>}
                      </span>
                    </div>
                  );
                  for (let i = 0; i < first.getDay(); i++) cells.push(<div key={"pad" + i} />);
                  for (let d = 1; d <= days; d++) {
                    const k = keyOf(new Date(calMonth.y, calMonth.m, d));
                    const gridPosts = byDay[k] || [];
                    const bPosts = boardPubsByDay[k] || [];
                    const rows = [];
                    gridPosts.forEach(({ it, card }) => rows.push(
                      <PostRow key={it.cardId} cover={imgOf(it, 200)} num={it.n} name={(card.name || "").replace(/\[.*?\]/g, "").replace(/post\s*\d+/i, "").trim() || "Post"} time={timeOf(it.pub && it.pub.at)} tone={card.done ? c.green : c.taupe} done={card.done} onClick={() => setOpenItem(it.cardId)} title={card.name} />
                    ));
                    bPosts.forEach(({ card: cd }, bi) => rows.push(
                      <PostRow key={"bp" + bi} cover={cd.cover} num={(cd.name.match(/post\s*(\d+)/i) || [])[1]} name={"@" + (cd.pub.account || "?")} time={timeOf(cd.pub.at)} tone={cd.pub.status === "published" ? c.green : c.taupe} title={pubTitle(cd)} />
                    ));
                    cells.push(
                      <div key={k} {...dayCellDrag(k)}
                        style={{ background: k === today ? c.card : c.bg, border: `1px solid ${overDay === k && dragIdx != null ? c.ink : c.line}`, borderRadius: 3, minHeight: 96, padding: "5px 5px 6px", display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ fontFamily: sans, fontSize: 10, color: k === today ? c.ink : c.sub, fontWeight: k === today ? 600 : 400, textAlign: "right", paddingRight: 2 }}>{d}</div>
                        {rows.slice(0, 3)}
                        {rows.length > 3 && <div style={{ fontFamily: sans, fontSize: 9, color: c.sub, paddingLeft: 4 }}>+{rows.length - 3} more</div>}
                      </div>
                    );
                  }
                  return cells;
                })()}
              </div>
            </div>
          )}

          {/* up next — the queue in posting order */}
          <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 6 }}>
            Up next{unscheduled ? <span style={{ color: c.sub, textTransform: "none", letterSpacing: 0.5 }}> · {unscheduled} post{unscheduled === 1 ? "" : "s"} still need a date</span> : null}
          </div>
          {upNext.length === 0 ? (
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.sub }}>
              Nothing scheduled yet — drop a tile onto a calendar day, or tap a tile and pick a date.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {upNext.slice(0, 8).map(({ it, card }, idx) => {
                const k = dueKey(card);
                const overdue = k < today;
                const d = fmtDay(k);
                return (
                  <div key={it.cardId} onClick={() => setOpenItem(it.cardId)}
                    style={{ display: "flex", alignItems: "center", gap: 10, background: idx === 0 ? c.card : c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "7px 10px", cursor: "pointer" }}>
                    <img src={imgOf(it, 200)} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 1 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: sans, fontSize: 12.5, color: c.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.name || "Post " + it.n}</div>
                      <div style={{ fontFamily: sans, fontSize: 10, color: overdue ? c.red : c.sub }}>
                        {overdue ? "overdue — " : idx === 0 ? "next up — " : ""}{d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </div>
                    </div>
                    {it.flag && <span title={it.flag} style={{ fontSize: 11 }}>⚠</span>}
                    <span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>{formatIcon(formatOf(card.name))}</span>
                  </div>
                );
              })}
              {upNext.length > 8 && <div style={{ fontFamily: sans, fontSize: 10, color: c.sub, paddingLeft: 2 }}>+ {upNext.length - 8} more scheduled</div>}
            </div>
          )}
        </div>
      </div>

      {/* detail drawer — slides over so the calendar stays put */}
      {open && openCard && (
        <div onClick={() => setOpenItem(null)} style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.35)", zIndex: 300, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "94vw", height: "100%", overflowY: "auto", background: c.card, borderLeft: `1px solid ${c.line}`, padding: 18, boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontFamily: sans, fontSize: 15, color: c.ink }}>{openCard.name}</div>
              <button onClick={() => setOpenItem(null)} style={{ background: "none", border: "none", cursor: "pointer", color: c.sub, fontSize: 15 }}>×</button>
            </div>
            <img src={imgOf(open, 1600)} alt="" style={{ display: "block", width: "100%", height: "auto", maxHeight: 420, objectFit: "contain", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, margin: "12px 0" }} />

            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 4 }}>Hook</div>
            <input value={openCard.hook || ""} onChange={(e) => patchCard(open.cardId, { hook: e.target.value })} placeholder="The first line that stops the scroll…"
              style={{ width: "100%", boxSizing: "border-box", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "9px 12px", fontFamily: sans, fontSize: 12.5, color: c.ink, outline: "none", marginBottom: 10 }} />
            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 4 }}>Caption</div>
            <textarea rows={4} value={openCard.desc || ""} onChange={(e) => patchCard(open.cardId, { desc: e.target.value })}
              style={{ width: "100%", boxSizing: "border-box", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "9px 12px", fontFamily: sans, fontSize: 12.5, lineHeight: 1.5, color: c.ink, outline: "none", resize: "vertical", marginBottom: 4 }} />
            <div style={{ marginBottom: 10 }}><NotesLinks text={openCard.desc} /></div>

            {(open.pieces || []).length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 4 }}>Pieces in this post — verified on the site</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {open.pieces.map((p, i) => (
                    <a key={i} href={"https://thefoldlabel.com/products/" + p.h} target="_blank" rel="noopener noreferrer"
                      style={{ border: `1px solid ${c.line}`, borderRadius: 1, padding: "4px 10px", fontFamily: sans, fontSize: 10, letterSpacing: 0.5, color: c.ink, textDecoration: "none", background: c.bg }}>
                      {p.t} ↗
                    </a>
                  ))}
                </div>
              </div>
            )}
            {open.flag && (
              <div style={{ background: "#F7F0EE", border: `1px solid #E2D4CD`, borderRadius: 1, padding: "8px 11px", fontFamily: sans, fontSize: 11.5, lineHeight: 1.5, color: c.red, marginBottom: 10 }}>
                ⚠ {open.flag}
              </div>
            )}

            <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe, marginBottom: 4 }}>Schedule — @{feed.account}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <input type="date" value={openCard.due ? String(openCard.due).slice(0, 10) : ""}
                onChange={(e) => {
                  const v = e.target.value || null;
                  patchCard(open.cardId, { due: v });
                  if (open.pub && open.pub.status === "scheduled") patchItem(open.cardId, { pub: v ? { ...open.pub, at: combineAt(v, timeOf(open.pub.at)) } : null });
                }}
                style={{ boxSizing: "border-box", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "8px 11px", fontFamily: sans, fontSize: 12, color: c.ink, outline: "none" }} />
              <input type="time" value={open.pub && open.pub.at ? timeOf(open.pub.at) : "10:00"} disabled={!openCard.due}
                onChange={(e) => { if (openCard.due && open.pub && open.pub.status === "scheduled") patchItem(open.cardId, { pub: { ...open.pub, at: combineAt(String(openCard.due).slice(0, 10), e.target.value) } }); }}
                style={{ boxSizing: "border-box", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 1, padding: "8px 11px", fontFamily: sans, fontSize: 12, color: c.ink, outline: "none", opacity: openCard.due ? 1 : 0.4 }} />
            </div>

            {/* auto-publish: nothing goes out unless this is armed, per post */}
            {(!open.pub || open.pub.status === "scheduled") && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, cursor: openCard.due ? "pointer" : "default", opacity: openCard.due ? 1 : 0.45 }}>
                <input type="checkbox" checked={!!(open.pub && open.pub.auto)} disabled={!openCard.due}
                  onChange={(e) => {
                    if (!openCard.due) return;
                    patchItem(open.cardId, { pub: e.target.checked ? { at: combineAt(String(openCard.due).slice(0, 10), open.pub ? timeOf(open.pub.at) : "10:00"), auto: true, status: "scheduled" } : null });
                  }} />
                <span style={{ fontFamily: sans, fontSize: 12, color: c.ink }}>
                  Auto-publish to Instagram {open.pub && open.pub.auto && open.pub.at ? "— " + new Date(open.pub.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                </span>
              </label>
            )}
            {!openCard.due && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub, marginTop: 4 }}>Pick a date to enable auto-publish.</div>}
            {open.pub && open.pub.status === "published" && (
              <div style={{ fontFamily: sans, fontSize: 12, color: c.green, marginTop: 10 }}>✓ Posted to @{feed.account} · {new Date(open.pub.publishedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
            )}
            {open.pub && open.pub.status === "failed" && (
              <div style={{ background: "#F7F0EE", border: "1px solid #E2D4CD", borderRadius: 1, padding: "8px 11px", fontFamily: sans, fontSize: 11.5, lineHeight: 1.5, color: c.red, marginTop: 10 }}>
                ✗ Publish failed: {open.pub.error}
                <button onClick={() => patchItem(open.cardId, { pub: { at: open.pub.at, auto: open.pub.auto, status: "scheduled" } })} style={{ ...ghost, marginLeft: 8, padding: "3px 8px" }}>Retry</button>
              </div>
            )}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
              {(!open.pub || open.pub.status !== "published") && (
                <button disabled={postingNow}
                  onClick={async () => {
                    if (!window.confirm('Post "' + openCard.name + '" to @' + feed.account + " on Instagram right now?")) return;
                    setPostingNow(true);
                    const pub = { at: new Date().toISOString(), auto: false, status: "scheduled" };
                    try {
                      const r = await fetch("/api/data?op=publish_item", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedId: feed.id, cardId: open.cardId }) });
                      const d = await r.json();
                      const res = (d.items || [])[0];
                      if (res && res.ok) { patchItem(open.cardId, { pub: { ...pub, status: "published", mediaId: res.mediaId, publishedAt: res.publishedAt } }); patchCard(open.cardId, { done: true }); }
                      else patchItem(open.cardId, { pub: { ...pub, status: "failed", error: (res && res.error) || d.error || "no response for this post" } });
                    } catch (e) { patchItem(open.cardId, { pub: { ...pub, status: "failed", error: String(e).slice(0, 160) } }); }
                    setPostingNow(false);
                  }}
                  style={{ ...ghost, color: "#FFFFFF", background: c.ink, borderColor: c.ink, opacity: postingNow ? 0.5 : 1 }}>
                  {postingNow ? "Posting…" : "◉ Post now"}
                </button>
              )}
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
        </div>
      )}
    </div>
  );
}
