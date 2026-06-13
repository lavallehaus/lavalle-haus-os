import { useState, useEffect } from "react";

// LAVALLE HAUS OS — Listing Manager (edit & fix existing Amazon listings)
// Loads a listing's live content + Amazon's own issue messages, lets you edit
// the editable fields (title, bullets, description, price) and pushes changes
// back through the Listings Items API. Session-level Undo/Redo per house rule.

const c = {
  bg: "#f7f4ef", ink: "#1a1714", sub: "#8c7d6b", line: "#c8c2b8",
  green: "#5a7a5a", clay: "#a07848", red: "#9b5e5e", card: "#efece5",
};
const serif = "'IM Fell English', Georgia, serif";
const sans = "monospace";
const card = { background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: 14, marginBottom: 12 };
const inputS = { background: "#e5e1da", border: `1px solid ${c.line}`, color: c.ink, fontSize: 13, padding: "8px 10px", borderRadius: 1, boxSizing: "border-box", width: "100%", fontFamily: serif };
const labelS = { fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans, marginBottom: 4, display: "block" };
const btnDark = { padding: "8px 18px", fontSize: 10, fontFamily: sans, letterSpacing: 2, cursor: "pointer", borderRadius: 1, border: "1px solid #1a1714", background: "#1a1714", color: "#f7f4ef", textTransform: "uppercase" };
const btnGhost = { padding: "6px 14px", fontSize: 10, fontFamily: sans, letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: `1px solid ${c.line}`, background: "transparent", color: c.sub, textTransform: "uppercase" };

export default function Listings({ products = [] }) {
  const [skuList, setSkuList] = useState({ loading: true, skus: [], error: null });
  const [sku, setSku] = useState("");
  const [manualSku, setManualSku] = useState("");
  const [listing, setListing] = useState(null); // loaded snapshot from Amazon
  const [draft, setDraft] = useState(null); // editable working copy
  const [loadState, setLoadState] = useState({ loading: false, error: null });
  const [save, setSave] = useState({ phase: "idle", result: null });
  // Undo/Redo over the draft
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);

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

  function edit(next) {
    setPast((p) => [...p.slice(-49), draft]);
    setFuture([]);
    setDraft(next);
  }
  function undo() {
    if (!past.length) return;
    setFuture((f) => [draft, ...f]);
    setDraft(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }
  function redo() {
    if (!future.length) return;
    setPast((p) => [...p, draft]);
    setDraft(future[0]);
    setFuture((f) => f.slice(1));
  }

  // what actually changed vs the loaded snapshot — only those get sent
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
      setSave({ phase: "done", result: d });
      // reload after a beat so the displayed snapshot reflects Amazon
      setTimeout(() => loadListing(listing.sku), 1500);
    } catch (e) {
      setSave({ phase: "error", result: String(e) });
    }
  }

  const sevColor = (s) => (s === "ERROR" ? c.red : s === "WARNING" ? c.clay : c.sub);

  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 400, color: c.ink, margin: 0 }}>Listing Manager</h1>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: "rgba(111,102,87,0.6)" }}>Edita y arregla listados existentes — título, viñetas, descripción y precio, directo a Amazon</div>
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
          {/* status + issues */}
          <div style={{ ...card, borderLeft: `3px solid ${listing.issues.some((i) => i.severity === "ERROR") ? c.red : c.green}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>
                STATUS <span style={{ color: c.ink }}>{listing.status || "—"}</span>
                {listing.asin && <span> · ASIN {listing.asin}</span>}
                {listing.productType && <span> · {listing.productType}</span>}
              </div>
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

          {/* editor */}
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
              {draft.bullets.length < 5 && (
                <button onClick={() => edit({ ...draft, bullets: [...draft.bullets, ""] })} style={btnGhost}>＋ Add bullet</button>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelS}>Description</label>
              <textarea style={{ ...inputS, minHeight: 90, resize: "vertical" }} value={draft.description} onChange={(e) => edit({ ...draft, description: e.target.value })} />
            </div>

            <div style={{ marginBottom: 12, maxWidth: 200 }}>
              <label style={labelS}>Price (USD)</label>
              <input style={{ ...inputS, fontFamily: sans }} value={draft.price} onChange={(e) => edit({ ...draft, price: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="—" />
            </div>

            {/* change summary + push */}
            <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: 10 }}>
              {changeKeys.length === 0 ? (
                <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: "rgba(111,102,87,0.55)" }}>No changes yet — edit a field above. Sin cambios aún.</div>
              ) : (
                <div style={{ fontFamily: sans, fontSize: 11, color: c.clay, marginBottom: 8 }}>
                  About to update: {changeKeys.map((k) => k === "itemName" ? "title" : k).join(", ")}
                </div>
              )}
              <button onClick={pushChanges} disabled={!changeKeys.length || save.phase === "saving"} style={{ ...btnDark, opacity: changeKeys.length && save.phase !== "saving" ? 1 : 0.4 }}>
                {save.phase === "saving" ? "Pushing to Amazon…" : "Push changes to Amazon"}
              </button>

              {save.phase === "done" && save.result && (
                <div style={{ marginTop: 10, fontFamily: sans, fontSize: 11, color: (save.result.issues || []).some((i) => i.severity === "ERROR") ? c.clay : c.green }}>
                  {save.result.status === "ACCEPTED" || !(save.result.issues || []).length
                    ? "✓ Amazon accepted the change. It can take a few minutes to appear live. Reloading…"
                    : "Amazon received it with notes:"}
                  {(save.result.issues || []).map((iss, i) => (
                    <div key={i} style={{ color: sevColor(iss.severity), marginTop: 4 }}>· [{iss.severity}] {iss.message}</div>
                  ))}
                </div>
              )}
              {save.phase === "error" && (
                <div style={{ marginTop: 10, fontFamily: sans, fontSize: 11, color: c.red }}>✗ {String(save.result)}</div>
              )}
            </div>
          </div>

          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: "rgba(111,102,87,0.55)" }}>
            Only fields you actually change are sent — everything else is left untouched. Some categories restrict certain fields; if Amazon rejects one, its note appears above.
            <br/>Solo se envían los campos que cambias — lo demás queda intacto. Si Amazon rechaza algo, su nota aparece arriba.
          </div>
        </div>
      )}
    </div>
  );
}
