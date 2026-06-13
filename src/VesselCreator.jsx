import { useState } from "react";

// LAVALLE HAUS OS — Family B: Candle Vessel Listing Creator
// Tailored creator for the home-décor / candle-holder family (glass vessel,
// dough bowl, seashell). It asks Amazon for the REAL product-type schema and
// builds the form from that — required fields are grounded in truth, not guessed.
// Images are taken as URLs (your Shopify product images work directly). On a
// successful create it logs to the shared Listing change log via onCommit.

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

const MARKETPLACE = "ATVPDKIKX0DER";
const BRAND_DEFAULT = "Refillery Haus";
// fields we render with dedicated UI rather than the generic text box
const SPECIAL = ["bullet_point", "main_product_image_locator", "other_product_image_locator", "purchasable_offer", "list_price", "fulfillment_availability"];

export default function VesselCreator({ onCommit }) {
  const [step, setStep] = useState(1);
  const [keywords, setKeywords] = useState("candle holder");
  const [search, setSearch] = useState({ loading: false, types: [], error: null });
  const [productType, setProductType] = useState("");
  const [schema, setSchema] = useState({ loading: false, fields: [], required: [], error: null });
  const [sku, setSku] = useState("");
  const [vals, setVals] = useState({});           // name -> string (generic + enum)
  const [bullets, setBullets] = useState([""]);
  const [images, setImages] = useState([""]);      // first = main
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [result, setResult] = useState({ phase: "idle", data: null });

  function runSearch() {
    setSearch({ loading: true, types: [], error: null });
    fetch(`/api/amazon-sync?op=producttype&action=search&keywords=${encodeURIComponent(keywords)}`).then(r => r.json()).then(d => {
      if (d.types) setSearch({ loading: false, types: d.types, error: null });
      else setSearch({ loading: false, types: [], error: d.error || "No product types found" });
    }).catch(e => setSearch({ loading: false, types: [], error: String(e) }));
  }

  function pickType(pt) {
    setProductType(pt);
    setSchema({ loading: true, fields: [], required: [], error: null });
    setVals({ brand: BRAND_DEFAULT, condition_type: "new_new", country_of_origin: "US" });
    fetch(`/api/amazon-sync?op=producttype&action=schema&productType=${encodeURIComponent(pt)}`).then(r => r.json()).then(d => {
      if (d.fields) { setSchema({ loading: false, fields: d.fields, required: d.required || [], error: null }); setStep(3); }
      else setSchema({ loading: false, fields: [], required: [], error: d.error || "Could not load schema" });
    }).catch(e => setSchema({ loading: false, fields: [], required: [], error: String(e) }));
  }

  // generic fields = everything except the special-cased ones
  const genericFields = schema.fields.filter(f => !SPECIAL.includes(f.name));
  const fieldByName = (n) => schema.fields.find(f => f.name === n);
  const has = (n) => schema.fields.some(f => f.name === n);

  function buildAttributes() {
    const a = {};
    const loc = (v, localizable) => localizable
      ? [{ value: v, marketplace_id: MARKETPLACE, language_tag: "en_US" }]
      : [{ value: v, marketplace_id: MARKETPLACE }];
    for (const f of genericFields) {
      const v = vals[f.name];
      if (v !== undefined && v !== "") a[f.name] = loc(v, f.localizable);
    }
    if (has("bullet_point")) {
      const bl = bullets.filter(x => x && x.trim());
      if (bl.length) a.bullet_point = bl.map(x => ({ value: x, marketplace_id: MARKETPLACE, language_tag: "en_US" }));
    }
    const imgs = images.map(x => x.trim()).filter(Boolean);
    if (imgs.length && has("main_product_image_locator")) a.main_product_image_locator = [{ media_location: imgs[0], marketplace_id: MARKETPLACE }];
    if (imgs.length > 1 && has("other_product_image_locator")) a.other_product_image_locator = imgs.slice(1, 9).map((u, i) => ({ media_location: u, variant: `PT0${i + 1}`, marketplace_id: MARKETPLACE }));
    if (price && has("purchasable_offer")) {
      a.purchasable_offer = [{ marketplace_id: MARKETPLACE, currency: "USD", our_price: [{ schedule: [{ value_with_tax: Number(price) }] }] }];
    }
    if (qty && has("fulfillment_availability")) {
      a.fulfillment_availability = [{ fulfillment_channel_code: "DEFAULT", quantity: Number(qty) }];
    }
    return a;
  }

  const missingRequired = schema.required.filter(n => {
    if (n === "bullet_point") return !bullets.some(b => b.trim());
    if (n === "main_product_image_locator") return !images.some(i => i.trim());
    if (n === "purchasable_offer" || n === "list_price") return !price;
    if (n === "fulfillment_availability") return !qty;
    return !(vals[n] && String(vals[n]).trim());
  });

  async function create() {
    if (!sku.trim()) { setResult({ phase: "error", data: "Enter a SKU first" }); return; }
    setResult({ phase: "saving", data: null });
    try {
      const attributes = buildAttributes();
      const d = await fetch("/api/amazon-sync?op=createlisting", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: sku.trim(), productType, attributes }),
      }).then(r => r.json());
      if (d.error) { setResult({ phase: "error", data: d.error }); return; }
      const hasErr = (d.issues || []).some(i => i.severity === "ERROR");
      setResult({ phase: hasErr ? "issues" : "done", data: d });
      if (!hasErr && onCommit) {
        onCommit({ sku: sku.trim(), newName: null, logRecord: {
          id: `${Date.now()}`, ts: new Date().toISOString(), sku: sku.trim(),
          productName: vals.item_name || sku.trim(), fields: ["NEW LISTING"],
          status: d.status || "ACCEPTED", note: "Created via Vessel Creator",
        }});
      }
    } catch (e) { setResult({ phase: "error", data: String(e) }); }
  }

  const sevColor = (s) => (s === "ERROR" ? c.red : s === "WARNING" ? c.clay : c.green);

  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 400, color: c.ink, margin: 0 }}>Create Listing · Candle Vessels</h1>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: "rgba(111,102,87,0.6)" }}>Crear listado — vasijas (vidrio, dough bowl, seashell). El formulario se arma desde el esquema real de Amazon.</div>
      </div>

      <div style={{ display: "flex", gap: 14, margin: "8px 0 12px", flexWrap: "wrap" }}>
        {[[1, "PRODUCT TYPE"], [2, "PICK"], [3, "DETAILS"]].map(([n, l]) => (
          <span key={n} style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1, color: step >= n ? c.ink : c.sub, borderBottom: step === n ? `2px solid ${c.clay}` : "none", paddingBottom: 2 }}>{n}. {l}</span>
        ))}
      </div>

      {step <= 2 && (
        <div style={card}>
          <label style={labelS}>Find the Amazon product type for your vessel</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input style={{ ...inputS, width: 280, fontFamily: serif }} value={keywords} onChange={e => setKeywords(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") runSearch(); }} placeholder="e.g. candle holder, decorative bowl" />
            <button onClick={runSearch} style={btnDark}>Search</button>
          </div>
          {search.loading && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub, marginTop: 8 }}>Asking Amazon…</div>}
          {search.error && <div style={{ fontFamily: sans, fontSize: 11, color: c.red, marginTop: 8 }}>{search.error}</div>}
          {search.types.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: "rgba(111,102,87,0.55)", marginBottom: 6 }}>Pick the closest match — these are Amazon's real categories:</div>
              {search.types.map(t => (
                <div key={t.name} onClick={() => pickType(t.name)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #00000008", cursor: "pointer" }}>
                  <span style={{ fontFamily: serif, fontSize: 14, color: c.ink }}>{t.displayName}</span>
                  <span style={{ fontFamily: sans, fontSize: 9, color: c.sub }}>{t.name} ›</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {schema.loading && <div style={{ fontFamily: sans, fontSize: 12, color: c.sub }}>Loading Amazon's requirements for {productType}…</div>}
      {schema.error && <div style={{ ...card, borderLeft: `3px solid ${c.red}`, fontFamily: sans, fontSize: 12, color: c.red }}>{schema.error}</div>}

      {step === 3 && schema.fields.length > 0 && (
        <div>
          <div style={{ ...card, borderLeft: `3px solid ${c.clay}` }}>
            <div style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>PRODUCT TYPE <span style={{ color: c.ink }}>{productType}</span>
              <span onClick={() => setStep(1)} style={{ color: c.clay, cursor: "pointer", marginLeft: 10, fontSize: 10 }}>change</span></div>
            <div style={{ marginTop: 10 }}>
              <label style={labelS}>Your SKU (you choose this) *</label>
              <input style={{ ...inputS, maxWidth: 320, fontFamily: sans }} value={sku} onChange={e => setSku(e.target.value)} placeholder="e.g. LH-VESSEL-GLASS" />
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans, marginBottom: 10 }}>Listing details · ✱ = Amazon requires it</div>

            {has("item_name") && (
              <Field f={fieldByName("item_name")}><input style={inputS} value={vals.item_name || ""} onChange={e => setVals({ ...vals, item_name: e.target.value })} /></Field>
            )}
            {has("brand") && (
              <Field f={fieldByName("brand")}><input style={inputS} value={vals.brand || ""} onChange={e => setVals({ ...vals, brand: e.target.value })} /></Field>
            )}

            {/* bullets */}
            {has("bullet_point") && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelS}>{schema.required.includes("bullet_point") ? "✱ " : ""}Bullet points</label>
                {bullets.map((b, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <textarea style={{ ...inputS, minHeight: 40, resize: "vertical" }} value={b} onChange={e => { const nb = [...bullets]; nb[i] = e.target.value; setBullets(nb); }} />
                    <span onClick={() => setBullets(bullets.filter((_, j) => j !== i))} style={{ color: c.red, cursor: "pointer", paddingTop: 8 }}>✕</span>
                  </div>
                ))}
                {bullets.length < 5 && <button onClick={() => setBullets([...bullets, ""])} style={btnGhost}>＋ Add bullet</button>}
              </div>
            )}

            {has("product_description") && (
              <Field f={fieldByName("product_description")}><textarea style={{ ...inputS, minHeight: 80, resize: "vertical" }} value={vals.product_description || ""} onChange={e => setVals({ ...vals, product_description: e.target.value })} /></Field>
            )}

            {/* generic remaining fields (enums + text) */}
            {genericFields.filter(f => !["item_name", "brand", "product_description"].includes(f.name)).map(f => (
              <Field key={f.name} f={f}>
                {f.enum ? (
                  <select style={{ ...inputS, fontFamily: sans, fontSize: 12 }} value={vals[f.name] || ""} onChange={e => setVals({ ...vals, [f.name]: e.target.value })}>
                    <option value="">— select —</option>
                    {f.enum.map((opt, i) => <option key={opt} value={opt}>{(f.enumNames && f.enumNames[i]) || opt}</option>)}
                  </select>
                ) : (
                  <input style={inputS} value={vals[f.name] || ""} onChange={e => setVals({ ...vals, [f.name]: e.target.value })} maxLength={f.maxLength || undefined} />
                )}
              </Field>
            ))}

            {/* images */}
            {has("main_product_image_locator") && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelS}>{schema.required.includes("main_product_image_locator") ? "✱ " : ""}Image URLs (first = main)</label>
                <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10, color: "rgba(111,102,87,0.55)", marginBottom: 6 }}>Paste public image links — your Shopify product images work directly (right-click → copy image address).</div>
                {images.map((u, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                    <input style={{ ...inputS, fontFamily: sans, fontSize: 11 }} value={u} onChange={e => { const ni = [...images]; ni[i] = e.target.value; setImages(ni); }} placeholder={i === 0 ? "main image URL" : "additional image URL"} />
                    {u.trim() && <img src={u} alt="" style={{ width: 34, height: 34, objectFit: "cover", border: `1px solid ${c.line}` }} onError={(e) => { e.target.style.display = "none"; }} />}
                    <span onClick={() => setImages(images.filter((_, j) => j !== i))} style={{ color: c.red, cursor: "pointer" }}>✕</span>
                  </div>
                ))}
                {images.length < 7 && <button onClick={() => setImages([...images, ""])} style={btnGhost}>＋ Add image</button>}
              </div>
            )}

            {/* price + qty */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {has("purchasable_offer") && (
                <div style={{ marginBottom: 14, maxWidth: 160 }}>
                  <label style={labelS}>{schema.required.includes("purchasable_offer") ? "✱ " : ""}Price (USD)</label>
                  <input style={{ ...inputS, fontFamily: sans }} value={price} onChange={e => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} />
                </div>
              )}
              {has("fulfillment_availability") && (
                <div style={{ marginBottom: 14, maxWidth: 160 }}>
                  <label style={labelS}>{schema.required.includes("fulfillment_availability") ? "✱ " : ""}Quantity</label>
                  <input style={{ ...inputS, fontFamily: sans }} value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9]/g, ""))} placeholder="FBM stock" />
                </div>
              )}
            </div>

            <div style={{ borderTop: `1px solid ${c.line}`, paddingTop: 10 }}>
              {missingRequired.length > 0 && (
                <div style={{ fontFamily: sans, fontSize: 11, color: c.clay, marginBottom: 8 }}>Still required by Amazon: {missingRequired.map(n => (fieldByName(n)?.title) || n).join(", ")}</div>
              )}
              <button onClick={create} disabled={result.phase === "saving" || !sku.trim()} style={{ ...btnDark, opacity: result.phase === "saving" || !sku.trim() ? 0.4 : 1 }}>
                {result.phase === "saving" ? "Creating on Amazon…" : "Create listing"}
              </button>
              <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10, color: "rgba(111,102,87,0.55)", marginTop: 8 }}>
                Submitting sends the listing to Amazon. It validates against this exact schema and tells us instantly what (if anything) it still needs — nothing here is binding or charged.
                <br/>Enviar manda el listado a Amazon, que lo valida y dice al instante qué falta — nada aquí es vinculante ni se cobra.
              </div>

              {result.phase === "done" && (
                <div style={{ marginTop: 10, padding: 10, background: "#e9eee9", border: `1px solid ${c.green}`, borderRadius: 1, fontFamily: sans, fontSize: 11, color: c.green }}>
                  ✓ Amazon accepted the new listing ({result.data.status}). It's logged in the Listing Manager's change log and will appear in your catalog shortly.
                </div>
              )}
              {result.phase === "issues" && (
                <div style={{ marginTop: 10, padding: 10, border: `1px solid ${c.clay}`, borderRadius: 1 }}>
                  <div style={{ fontFamily: sans, fontSize: 11, color: c.clay }}>Amazon needs a few corrections before it goes live:</div>
                  {result.data.issues.map((iss, i) => (
                    <div key={i} style={{ fontFamily: sans, fontSize: 11, color: sevColor(iss.severity), marginTop: 4 }}>· [{iss.severity}] {iss.message}{iss.attributeNames && iss.attributeNames.length ? ` (${iss.attributeNames.join(", ")})` : ""}</div>
                  ))}
                </div>
              )}
              {result.phase === "error" && <div style={{ marginTop: 10, fontFamily: sans, fontSize: 11, color: c.red }}>✗ {String(result.data)}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function Field({ f, children }) {
    return (
      <div style={{ marginBottom: 14 }}>
        <label style={labelS}>{f.required ? "✱ " : ""}{f.title}{f.maxLength ? ` · max ${f.maxLength}` : ""}</label>
        {f.description && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10, color: "rgba(111,102,87,0.55)", marginBottom: 4 }}>{f.description}</div>}
        {children}
      </div>
    );
  }
}
