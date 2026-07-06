import { useState, useEffect } from "react";

// LAVALLE HAUS OS — Listing Manager (edit & fix existing Amazon listings)
// Loads a listing's live content + Amazon's own issue messages, lets you edit
// the editable fields (title, bullets, description, price) and pushes changes
// back through the Listings Items API. On accept it also updates the app's own
// stored product name (so the two stores stay in sync) and writes a dated entry
// to a persistent change log grouped by week/day. Session Undo/Redo on the draft.

const c = {
  bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD",
  green: "#5a7a5a", clay: "#8F8676", red: "#9b5e5e", card: "#F4F4F3",
};
const serif = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const card = { background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: 14, marginBottom: 12 };
const inputS = { background: "#F0F0EE", border: `1px solid ${c.line}`, color: c.ink, fontSize: 13, padding: "8px 10px", borderRadius: 1, boxSizing: "border-box", width: "100%", fontFamily: serif };
const labelS = { fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans, marginBottom: 4, display: "block" };
const btnDark = { padding: "8px 18px", fontSize: 10, fontFamily: sans, letterSpacing: 2, cursor: "pointer", borderRadius: 1, border: "1px solid #1A1A1A", background: "#1A1A1A", color: "#FFFFFF", textTransform: "uppercase" };
const btnGhost = { padding: "6px 14px", fontSize: 10, fontFamily: sans, letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: `1px solid ${c.line}`, background: "transparent", color: c.sub, textTransform: "uppercase" };

const FIELD_LABEL = { itemName: "title", bullets: "bullets", description: "description", price: "price" };

function mondayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}
function prettyWeek(mondayStr) {
  const start = new Date(mondayStr + "T00:00:00");
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const f = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `Week of ${f(start)} – ${f(end)}`;
}
function prettyDay(dayStr) {
  return new Date(dayStr + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default function Listings({ products = [], dbState = {}, onCommit }) {
  const [skuList, setSkuList] = useState({ loading: true, skus: [], error: null });
  const [sku, setSku] = useState("");
  const [manualSku, setManualSku] = useState("");
  const [listing, setListing] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loadState, setLoadState] = useState({ loading: false, error: null });
  const [save, setSave] = useState({ phase: "idle", result: null });
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [collapsedWeeks, setCollapsedWeeks] = useState({});

  const log = dbState.listingLog || [];

  useEffect(() => {
    fetch("/api/amazon-sync?op=listing&action=skus").then((r) => r.json()).then((d) => {
      if (d.skus) setSkuList({ loading: false, skus: d.skus, error: null });
      else setSkuList({ loading: false, skus: [], error: d.error || "Could not load SKUs" });
    }).catch((e) => setSkuList({ loading: false, skus: [], error: String(e) }));
  }, []);

  function loadListing(targetSku) {
    if (!targetSku) return;
    setLoadState({ loading: true, error: null });
    setListing(null); setDraft(null); setSave({ phase: "idle", result: null });
    setPast([]); setFuture([]);
    fetch(`/api/amazon-sync?op=listing&action=get&sku=${encodeURIComponent(targetSku)}`).then((r) => r.json()).then((d) => {
      if (d.sku) {
        setListing(d);
        setDraft({ itemName: d.itemName || "", bullets: (d.bullets || []).length ? d.bullets : [""], description: d.description || "", price: d.price ?? "" });
        setLoadState({ loading: false, error: null });
      } else {
        setLoadState({ loading: false, error: d.error || "Listing not found" });
      }
    }).catch((e) => setLoadState({ loading: false, error: String(e) }));
  }

  function edit(next) { setPast((p) => [...p.slice(-49), draft]); setFuture([]); setDraft(next); }
  function undo() { if (!past.length) return; setFuture((f) => [draft, ...f]); setDraft(past[past.length - 1]); setPast((p) => p.slice(0, -1)); }
  function redo() { if (!future.length) return; setPast((p) => [...p, draft]); setDraft(future[0]); setFuture((f) => f.slice(1)); }

  function changedFields() {
    if (!listing || !draft) return {};
    const out = { sku: listing.sku, productType: listing.productType };
    if (draft.itemName !== (listing.itemName || "")) out.itemName = draft.itemName;
    const origB = JSON.stringify((listing.bullets || []).filter(Boolean));
    const draftB = (draft.bullets || []).filter((x) => x && x.trim());
    if (JSON.stringify(draftB) !== origB) out.bullets = draftB;
    if (draft.description !== (listing.description || "")) out.description = draft.description;
    if (String(draft.price) !== String(listing.price ?? "")) out.price = draft.price;
    return out;
  }
  const changes = changedFields();
  const changeKeys = Object.keys(changes).filter((k) => k !== "sku" && k !== "productType");

  async function pushChanges() {
    if (!changeKeys.length) return;
    setSave({ phase: "saving", result: null });
    try {
      const d = await fetch("/api/amazon-sync?op=listing&action=patch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      }).then((r) => r.json());
      if (d.error) { setSave({ phase: "error", result: d.error }); return; }

      const hasErr = (d.issues || []).some((i) => i.severity === "ERROR");
      const status = d.error ? "ERROR" : hasErr ? "ISSUES" : (d.status || "ACCEPTED");
      const newName = changeKeys.includes("itemName") ? draft.itemName : null;
      const logRecord = {
        id: `${Date.now()}`,
        ts: new Date().toISOString(),
        sku: listing.sku,
        productName: newName || listing.itemName || listing.sku,
        fields: changeKeys.map((k) => FIELD_LABEL[k] || k),
        status,
        note: (d.issues || []).map((i) => i.message).join(" · ").slice(0, 240) || null,
      };
      if (onCommit) onCommit({ sku: listing.sku, newName, logRecord });

      setSave({ phase: "done", result: d });
      setTimeout(() => loadListing(listing.sku), 4000);
    } catch (e) {
      setSave({ phase: "error", result: String(e) });
    }
  }

  const sevColor = (s) => (s === "ERROR" ? c.red : s === "WARNING" || s === "ISSUES" ? c.clay : c.green);

  // ── group the change log by week → day (most recent first) ──
  const byWeek = {};
  for (const e of log) {
    const day = (e.ts || "").slice(0, 10);
    if (!day) continue;
    const wk = mondayOf(day);
    (byWeek[wk] = byWeek[wk] || {});
    (byWeek[wk][day] = byWeek[wk][day] || []).push(e);
  }
  const weeks = Object.keys(byWeek).sort().reverse();

  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 400, color: c.ink, margin: 0 }}>Listing Manager</h1>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: "rgba(111,102,87,0.6)" }}>Edita y arregla listados existentes — los cambios se sincronizan con la app y quedan registrados por fecha</div>
      </div>

      <div style={card}>
        <label style={labelS}>Choose a listing to edit</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={sku} onChange={(e) => { setSku(e.target.value); loadListing(e.target.value); }}
            style={{ ...inputS, width: "auto", minWidth: 260, fontFamily: sans, fontSize: 12 }}>
            <option value="">{skuList.loading ? "Loading your SKUs…" : "— select a SKU —"}</option>
            {skuList.skus.map((s) => <option key={s.sku} value={s.sku}>{s.name ? `${s.name} · ${s.sku}` : s.sku}</option>)}
          </select>
          <span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>or</span>
          <input value={manualSku} onChange={(e) => setManualSku(e.target.value)} placeholder="type a SKU (e.g. RH-SeaShell-9633)"
            style={{ ...inputS, width: 240, fontFamily: sans, fontSize: 12 }} />
          <button onClick={() => { setSku(""); loadListing(manualSku.trim()); }} style={btnGhost}>Load</button>
        </div>
        {skuList.error && <div style={{ fontFamily: sans, fontSize: 11, color: c.red, marginTop: 8 }}>{skuList.error}</div>}
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10, color: "rgba(111,102,87,0.55)", marginTop: 8 }}>
          The dropdown lists your FBA SKUs; for a listing with no offer (like SeaShell) type its SKU directly.
          <br/>El menú lista tus SKUs de FBA; para un listado sin oferta escribe el SKU directamente.
        </div>
      </div>

      {loadState.loading && <div style={{ fontFamily: sans, fontSize: 12, color: c.sub }}>Loading listing from Amazon…</div>}
      {loadState.error && <div style={{ ...card, borderLeft: `3px solid ${c.red}`, fontFamily: sans, fontSize: 12, color: c.red }}>{loadState.error}</div>}

      {listing && draft && (
        <div>
          <div style={{ ...card, borderLeft: `3px solid ${listing.issues.some((i) => i.severity === "ERROR") ? c.red : c.green}` }}>
            <div style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>
              STATUS <span style={{ color: c.ink }}>{listing.status || "—"}</span>
              {listing.asin && <span> · ASIN {listing.asin}</span>}
              {listing.productType && <span> · {listing.productType}</span>}
            </div>
            {listing.issues.length === 0 ? (
              <div style={{ fontFamily: sans, fontSize: 11, color: c.green, marginTop: 6 }}>✓ No issues reported by Amazon.</div>
            ) : (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans, marginBottom: 4 }}>Amazon's issues · fix these to go live</div>
                {listing.issues.map((iss, i) => (
                  <div key={i} style={{ borderLeft: `2px solid ${sevColor(iss.severity)}`, paddingLeft: 8, marginBottom: 6 }}>
                    <span style={{ fontFamily: sans, fontSize: 9, color: sevColor(iss.severity), letterSpacing: 1 }}>{iss.severity}</span>
                    <div style={{ fontFamily: serif, fontSize: 13, color: c.ink }}>{iss.message}</div>
                    {iss.attributeNames && iss.attributeNames.length > 0 && <div style={{ fontFamily: sans, fontSize: 9, color: c.sub }}>fields: {iss.attributeNames.join(", ")}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans }}>Edit fields</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={undo} disabled={!past.length} style={{ ...btnGhost, opacity: past.length ? 1 : 0.35 }}>↶ UNDO</button>
                <button onClick={redo} disabled={!future.length} style={{ ...btnGhost, opacity: future.length ? 1 : 0.35 }}>↷ REDO</button>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelS}>Product title</label>
              <input style={inputS} value={draft.itemName} onChange={(e) => edit({ ...draft, itemName: e.target.value })} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelS}>Bullet points</label>
              {draft.bullets.map((b, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "flex-start" }}>
                  <textarea style={{ ...inputS, minHeight: 44, resize: "vertical" }} value={b}
                    onChange={(e) => { const nb = [...draft.bullets]; nb[i] = e.target.value; edit({ ...draft, bullets: nb }); }} />
                  <span onClick={() => edit({ ...draft, bullets: draft.bullets.filter((_, j) => j !== i) })}
                    style={{ color: c.red, cursor: "pointer", fontSize: 14, paddingTop: 8 }}>✕</span>
                </div>
              ))}
              {draft.bullets.length < 5 && <button onClick={() => edit({ ...draft, bullets: [...draft.bullets, ""] })} style={btnGhost}>＋ Add bullet</button>}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelS}>Description</label>
              <textarea style={{ ...inputS, minHeight: 90, resize: "vertical" }} value={draft.description} onChange={(e) => edit({ ...draft, description: e.target.value })} />
            </div>

            <div style={{ marginBottom: 12, maxWidth: 200 }}>
              <label style={labelS}>Price (USD)</label>
              <input style={{ ...inputS, fontFamily: sans }} value={draft.price} onChange={(e) => edit({ ...draft, price: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="—" />
            </div>

            <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: 10 }}>
              {changeKeys.length === 0 ? (
                <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: "rgba(111,102,87,0.55)" }}>No changes yet — edit a field above. Sin cambios aún.</div>
              ) : (
                <div style={{ fontFamily: sans, fontSize: 11, color: c.clay, marginBottom: 8 }}>About to update: {changeKeys.map((k) => FIELD_LABEL[k] || k).join(", ")}</div>
              )}
              <button onClick={pushChanges} disabled={!changeKeys.length || save.phase === "saving"} style={{ ...btnDark, opacity: changeKeys.length && save.phase !== "saving" ? 1 : 0.4 }}>
                {save.phase === "saving" ? "Pushing to Amazon…" : "Push changes to Amazon"}
              </button>

              {save.phase === "done" && (
                <div style={{ marginTop: 10, padding: 10, background: "#e9eee9", border: `1px solid ${c.green}`, borderRadius: 1 }}>
                  <div style={{ fontFamily: sans, fontSize: 11, color: c.green }}>
                    ✓ Amazon accepted the change, and the app is already updated.
                  </div>
                  <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub, marginTop: 4 }}>
                    Accepted ≠ live yet: Amazon reviews edits and the change goes live on the listing automatically once approved — usually a few minutes, sometimes longer. It's logged below so you can track it.
                    <br/>Aceptado ≠ en vivo aún: Amazon revisa los cambios y se publican automáticamente una vez aprobados — normalmente unos minutos. Queda registrado abajo.
                  </div>
                  {(save.result.issues || []).map((iss, i) => (
                    <div key={i} style={{ fontFamily: sans, fontSize: 11, color: sevColor(iss.severity), marginTop: 4 }}>· [{iss.severity}] {iss.message}</div>
                  ))}
                </div>
              )}
              {save.phase === "error" && <div style={{ marginTop: 10, fontFamily: sans, fontSize: 11, color: c.red }}>✗ {String(save.result)}</div>}
            </div>
          </div>
        </div>
      )}

      {/* ── CHANGE LOG ── */}
      <div style={{ ...card, borderLeft: `3px solid ${c.clay}` }}>
        <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans }}>Change log</div>
        <div style={{ fontSize: 10, fontStyle: "italic", color: "rgba(111,102,87,0.55)", fontFamily: serif, marginBottom: 8 }}>
          Registro de cambios por semana y día — revisa aquí si un cambio de hace días no se reflejó y hay que reenviarlo
        </div>
        {weeks.length === 0 && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>No changes logged yet. Pushed edits will appear here, newest first.</div>}
        {weeks.map((wk) => {
          const collapsed = collapsedWeeks[wk];
          const days = Object.keys(byWeek[wk]).sort().reverse();
          const count = days.reduce((s, d) => s + byWeek[wk][d].length, 0);
          return (
            <div key={wk} style={{ marginTop: 10 }}>
              <div onClick={() => setCollapsedWeeks({ ...collapsedWeeks, [wk]: !collapsed })}
                style={{ cursor: "pointer", fontFamily: sans, fontSize: 11, letterSpacing: 1, color: c.ink, borderBottom: `1px solid ${c.line}`, paddingBottom: 4 }}>
                {collapsed ? "▸" : "▾"} {prettyWeek(wk)} <span style={{ color: c.sub }}>· {count} change{count !== 1 ? "s" : ""}</span>
              </div>
              {!collapsed && days.map((day) => (
                <div key={day} style={{ marginTop: 6 }}>
                  <div style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1, color: c.sub, textTransform: "uppercase", margin: "4px 0" }}>{prettyDay(day)}</div>
                  {byWeek[wk][day].sort((a, b) => (a.ts < b.ts ? 1 : -1)).map((e) => (
                    <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "5px 0", borderBottom: "1px solid #00000008", flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                        <span style={{ fontFamily: serif, fontSize: 13, color: c.ink }}>{e.productName}</span>
                        <span style={{ fontFamily: sans, fontSize: 9, color: c.sub, marginLeft: 8 }}>{new Date(e.ts).toLocaleTimeString()} · {e.fields.join(", ")}</span>
                        {e.note && <div style={{ fontFamily: sans, fontSize: 9, color: c.clay, marginTop: 2 }}>{e.note}</div>}
                      </div>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <span style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1, color: sevColor(e.status), border: `1px solid ${sevColor(e.status)}40`, borderRadius: 1, padding: "1px 6px" }}>{e.status}</span>
                        <span onClick={() => { setSku(""); setManualSku(e.sku); loadListing(e.sku); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                          style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1, color: c.clay, cursor: "pointer" }}>↻ RE-OPEN</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
