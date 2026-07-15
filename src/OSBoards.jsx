import { useEffect, useState } from "react";

// LAVALLE HAUS OS — the OS boards, under the Business Brain.
// Every section of the operating system laid out like the content boards:
// photo tiles that jump straight to Sales, Ads, Inventory, Growth… with the
// same 👥 access chips (wired to the per-person page permissions) and a
// Recently viewed strip.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", red: "#9b5e5e", green: "#5a7a5a" };
const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";

const CAPTIONS = {
  profit: "Profit matrix · pricing · finances",
  ads: "Amazon PPC · Meta · Google · B2B",
  inventory: "FBA · products · packaging · reorders",
  growth: "Wholesale · creative · email · numbers",
  content: "Boards · schedule · analytics",
  roadmap: "Phases · milestones",
  materials: "Suppliers · price per oz",
  ai: "AI COO · advisor",
};
const FALLBACK_BG = {
  profit: "linear-gradient(150deg,#EDE9E2,#CDBBA7)",
  ads: "linear-gradient(150deg,#E3DCCC,#B9A98F)",
  inventory: "linear-gradient(150deg,#D9DED2,#AEB8A4)",
  growth: "linear-gradient(150deg,#D6DBDE,#A9B5BC)",
  content: "linear-gradient(150deg,#EDE4E0,#C9AFa4)",
  roadmap: "linear-gradient(150deg,#E8E4DC,#BFB6A6)",
  materials: "linear-gradient(150deg,#E4E0D5,#B5AC97)",
  ai: "linear-gradient(150deg,#E0DDE4,#A8A3B5)",
};

function fileToBg(file, cb) {
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 1200 / img.width);
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      cb(cv.toDataURL("image/jpeg", 0.72));
    };
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}

export default function OSBoards({ nav, tiles = {}, onSaveTile, iAmOwner, roleTabs = {}, goTo }) {
  const [users, setUsers] = useState(null);
  const [accessMenu, setAccessMenu] = useState(null);
  const [recents, setRecents] = useState(() => { try { return JSON.parse(localStorage.getItem("lh_recent_tabs") || "[]"); } catch { return []; } });
  useEffect(() => {
    if (!iAmOwner) return;
    fetch("/api/data?op=users").then((r) => (r.ok ? r.json() : null)).then((d) => d && setUsers((d.users || []).filter((u) => !u.revoked))).catch(() => {});
  }, [iAmOwner]);
  useEffect(() => {
    const onFocus = () => { try { setRecents(JSON.parse(localStorage.getItem("lh_recent_tabs") || "[]")); } catch {} };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const effective = (u) => (Array.isArray(u.pages) && u.pages.length ? u.pages : (roleTabs[u.role] || []));
  const togglePage = async (u, tabId) => {
    const cur = effective(u);
    const next = cur.includes(tabId) ? cur.filter((x) => x !== tabId) : [...cur, tabId];
    setUsers(users.map((x) => (x.id === u.id ? { ...x, pages: next } : x)));
    try { await fetch("/api/data?op=set_pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: u.id, pages: next }) }); } catch {}
  };

  const items = nav.filter((n) => n.id !== "brain");
  const bgOf = (id) => (tiles[id] && tiles[id].bg ? (tiles[id].bg.startsWith("linear-gradient") || tiles[id].bg.startsWith("#") ? { background: tiles[id].bg } : { backgroundImage: `url(${tiles[id].bg})`, backgroundSize: "cover", backgroundPosition: "center" }) : { background: FALLBACK_BG[id] || FALLBACK_BG.roadmap });
  const label = { fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe };
  const recentTabs = recents.filter((id) => items.some((n) => n.id === id)).slice(0, 6);

  return (
    <div style={{ padding: "26px 24px 30px", maxWidth: 1180, margin: "0 auto" }}>
      {recentTabs.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ ...label, marginBottom: 8 }}>🕐 Recently viewed</div>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
            {recentTabs.map((id) => {
              const n = items.find((x) => x.id === id);
              return (
                <div key={id} onClick={() => goTo({ tab: id })} style={{ flex: "0 0 172px", borderRadius: 8, border: `1px solid ${c.line}`, background: c.bg, cursor: "pointer", overflow: "hidden" }}>
                  <div style={{ height: 58, ...bgOf(id) }} />
                  <div style={{ padding: "8px 12px", fontFamily: sans, fontSize: 12, color: c.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ ...label, marginBottom: 8 }}>The operating system</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
        {items.map((n) => {
          const withAccess = users ? users.filter((u) => effective(u).includes(n.id)) : null;
          return (
            <div key={n.id} onClick={() => goTo({ tab: n.id })}
              style={{ position: "relative", background: c.bg, border: `1px solid ${c.line}`, borderRadius: 8, cursor: "pointer", boxShadow: "0 1px 3px rgba(26,26,26,0.05)", zIndex: accessMenu === n.id ? 90 : "auto" }}>
              <div style={{ height: 84, position: "relative", borderRadius: "7px 7px 0 0", overflow: "hidden", ...bgOf(n.id) }}>
                {iAmOwner && (
                  <label onClick={(e) => e.stopPropagation()} title="Change this tile's photo"
                    style={{ position: "absolute", top: 8, right: 8, background: "rgba(255,255,255,0.85)", borderRadius: 5, cursor: "pointer", color: c.sub, fontSize: 11, padding: "3px 7px" }}>
                    ✎
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) fileToBg(f, (u) => onSaveTile(n.id, u)); }} />
                  </label>
                )}
              </div>
              <div style={{ padding: "10px 14px 12px" }}>
                <div style={{ fontFamily: sans, fontSize: 14.5, color: c.ink }}>{n.label}</div>
                <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: c.sub, marginTop: 5 }}>{CAPTIONS[n.id] || ""}</div>
                {iAmOwner && (
                  <div style={{ position: "relative", marginTop: 8 }}>
                    <button onClick={(e) => { e.stopPropagation(); setAccessMenu(accessMenu === n.id ? null : n.id); }}
                      title="Who can open this section"
                      style={{ background: "transparent", border: `1px solid ${c.line}`, borderRadius: 6, padding: "3px 9px", fontFamily: sans, fontSize: 9, letterSpacing: 1.2, textTransform: "uppercase", color: c.sub, cursor: "pointer" }}>
                      👥 {withAccess ? withAccess.length + " member" + (withAccess.length === 1 ? "" : "s") : "…"}
                    </button>
                    {accessMenu === n.id && (
                      <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 95, background: "#FFFFFF", border: `1px solid ${c.line}`, borderRadius: 8, boxShadow: "0 10px 30px rgba(26,26,26,0.14)", padding: 12, width: 230 }}>
                        <div style={{ ...label, marginBottom: 6 }}>Who can open {n.label}</div>
                        {(users || []).map((u) => (
                          <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", cursor: "pointer" }}>
                            <input type="checkbox" checked={effective(u).includes(n.id)} onChange={() => togglePage(u, n.id)} />
                            <span style={{ fontFamily: sans, fontSize: 12, color: c.ink, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
                            <span style={{ fontFamily: sans, fontSize: 9, color: c.sub }}>{u.role.split(" ")[0]}</span>
                          </label>
                        ))}
                        {!users || !users.length ? <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 11, color: c.sub }}>Invite people on the Team roster first.</div> : (
                          <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 10, color: c.sub, marginTop: 6 }}>Unticking hides this whole tab from them — same setting as the roster's Pages picker. You always see everything.</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
