import { useState } from "react";

// LAVALLE HAUS OS — Listing Creator (Tier 2, all single-product families)
// Schema-driven: asks Amazon for the real product-type schema and builds the
// form from it. Family presets (Vessels / Body & Bath / Perfume) set the search
// keyword, brand, and surface family-specific compliance hints. Optional
// Variation mode creates a parent + size/scent children. Successful creates log
// to the shared Listing change log via onCommit.

const c = {
  bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD",
  green: "#5a7a5a", clay: "#8F8676", red: "#9b5e5e", card: "#F4F4F3",
};
const serif = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const card = { background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: 14, marginBottom: 12 };
const inputS = { background: "#F0F0EE", border: `1px solid ${c.line}`, color: c.ink, fontSize: 13, padding: "8px 10px", borderRadius: 1, boxSizing: "border-box", width: "100%", fontFamily: serif };
const labelS = { fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans, marginBottom: 4, display: "block" };
const btnDark = { padding: "8px 18px", fontSize: 10, fontFamily: sans, letterSpacing: 2, cursor: "pointer", borderRadius: 1, border: "1px solid #1A1A1A", background: "#1A1A1A", color: "#FFFFFF", textTransform: "uppercase" };
const btnGhost = { padding: "6px 14px", fontSize: 10, fontFamily: sans, letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: `1px solid ${c.line}`, background: "transparent", color: c.sub, textTransform: "uppercase" };

const MP = "ATVPDKIKX0DER";
const BRAND_DEFAULT = "Lavalle Haus";
const SPECIAL = ["bullet_point", "main_product_image_locator", "other_product_image_locator", "purchasable_offer", "list_price", "fulfillment_availability", "variation_theme"];

const FAMILIES = [
  { id: "vessel", label: "Candle Vessel", keyword: "candle holder", hint: null },
  { id: "body", label: "Body & Bath Care", keyword: "body lotion", hint: "Topical product: Amazon often requires ingredients/safety fields (they'll appear below if so), and FBA may need an SDS or exemption sheet uploaded in Seller Central — that's separate from this form." },
  { id: "perfume", label: "Perfume", keyword: "perfume", hint: "Alcohol-based fragrance is usually classified hazmat — you'll likely need to upload an SDS in Seller Central before FBA will accept it." },
  { id: "other", label: "Other", keyword: "", hint: null },
];

export default function VesselCreator({ onCommit }) {
  const [family, setFamily] = useState(null);
  const [keywords, setKeywords] = useState("");
  const [search, setSearch] = useState({ loading: false, types: [], error: null });
  const [productType, setProductType] = useState("");
  const [schema, setSchema] = useState({ loading: false, fields: [], required: [], error: null });
  const [step, setStep] = useState(1);

  // shared product content
  const [sku, setSku] = useState("");
  const [vals, setVals] = useState({});
  const [bullets, setBullets] = useState([""]);
  const [images, setImages] = useState([""]);
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");

  // variation mode
  const [variation, setVariation] = useState(false);
  const [theme, setTheme] = useState("");
  const [children, setChildren] = useState([{ sku: "", value: "", price: "", qty: "", image: "" }]);

  const [result, setResult] = useState({ phase: "idle", data: null });

  function pickFamily(f) {
    setFamily(f);
    setKeywords(f.keyword);
    setVals({ brand: BRAND_DEFAULT, condition_type: "new_new", country_of_origin: "US" });
    setStep(2);
  }

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
    fetch(`/api/amazon-sync?op=producttype&action=schema&productType=${encodeURIComponent(pt)}`).then(r => r.json()).then(d => {
      if (d.fields) { setSchema({ loading: false, fields: d.fields, required: d.required || [], error: null }); setStep(3); }
      else setSchema({ loading: false, fields: [], required: [], error: d.error || "Could not load schema" });
    }).catch(e => setSchema({ loading: false, fields: [], required: [], error: String(e) }));
  }

  const genericFields = schema.fields.filter(f => !SPECIAL.includes(f.name));
  const fieldByName = (n) => schema.fields.find(f => f.name === n);
  const has = (n) => schema.fields.some(f => f.name === n);
  const themeField = fieldByName("variation_theme");

  // attribute name the variant value maps into, inferred from theme
  function varyingAttr() {
    const t = (theme || "").toUpperCase();
    if (t.includes("SIZE")) return "size_name";
    if (t.includes("SCENT")) return "scent_name";
    if (t.includes("COLOR") || t.includes("COLOUR")) return "color_name";
    return "size_name";
  }

  function sharedAttrs() {
    const a = {};
    const loc = (v, localizable) => localizable ? [{ value: v, marketplace_id: MP, language_tag: "en_US" }] : [{ value: v, marketplace_id: MP }];
    for (const f of genericFields) { const v = vals[f.name]; if (v !== undefined && v !== "") a[f.name] = loc(v, f.localizable); }
    if (has("bullet_point")) { const bl = bullets.filter(x => x && x.trim()); if (bl.length) a.bullet_point = bl.map(x => ({ value: x, marketplace_id: MP, language_tag: "en_US" })); }
    const imgs = images.map(x => x.trim()).filter(Boolean);
    if (imgs.length && has("main_product_image_locator")) a.main_product_image_locator = [{ media_location: imgs[0], marketplace_id: MP }];
    if (imgs.length > 1 && has("other_product_image_locator")) a.other_product_image_locator = imgs.slice(1, 9).map((u, i) => ({ media_location: u, variant: `PT0${i + 1}`, marketplace_id: MP }));
    return a;
  }

  function singleAttrs() {
    const a = sharedAttrs();
    if (price && has("purchasable_offer")) a.purchasable_offer = [{ marketplace_id: MP, currency: "USD", our_price: [{ schedule: [{ value_with_tax: Number(price) }] }] }];
    if (qty && has("fulfillment_availability")) a.fulfillment_availability = [{ fulfillment_channel_code: "DEFAULT", quantity: Number(qty) }];
    return a;
  }

  function parentAttrs() {
    const a = sharedAttrs();
    a.parentage_level = [{ marketplace_id: MP, value: "parent" }];
    a.variation_theme = [{ marketplace_id: MP, name: theme }];
    return a;
  }
  function childAttrs(ch) {
    const a = sharedAttrs();
    a.parentage_level = [{ marketplace_id: MP, value: "child" }];
    a.child_parent_sku_relationship = [{ marketplace_id: MP, child_relationship_type: "variation", parent_sku: sku.trim() }];
    a.variation_theme = [{ marketplace_id: MP, name: theme }];
    a[varyingAttr()] = [{ value: ch.value, marketplace_id: MP, language_tag: "en_US" }];
    if (ch.price && has("purchasable_offer")) a.purchasable_offer = [{ marketplace_id: MP, currency: "USD", our_price: [{ schedule: [{ value_with_tax: Number(ch.price) }] }] }];
    if (ch.qty && has("fulfillment_availability")) a.fulfillment_availability = [{ fulfillment_channel_code: "DEFAULT", quantity: Number(ch.qty) }];
    if (ch.image && ch.image.trim() && has("main_product_image_locator")) a.main_product_image_locator = [{ media_location: ch.image.trim(), marketplace_id: MP }];
    return a;
  }

  async function putOne(theSku, attributes) {
    const d = await fetch("/api/amazon-sync?op=createlisting", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku: theSku, productType, attributes }),
    }).then(r => r.json());
    return d;
  }

  async function create() {
    if (!sku.trim()) { setResult({ phase: "error", data: "Enter a SKU first" }); return; }
    setResult({ phase: "saving", data: null });
    try {
      if (!variation) {
        const d = await putOne(sku.trim(), singleAttrs());
        if (d.error) { setResult({ phase: "error", data: d.error }); return; }
        const hasErr = (d.issues || []).some(i => i.severity === "ERROR");
        setResult({ phase: hasErr ? "issues" : "done", data: { results: [{ sku: sku.trim(), role: "listing", ...d }] } });
        if (!hasErr && onCommit) onCommit({ sku: sku.trim(), newName: null, logRecord: logRec(sku.trim(), d, "NEW LISTING") });
        return;
      }
      // variation: parent first, then children
      const results = [];
      const parent = await putOne(sku.trim(), parentAttrs());
      results.push({ sku: sku.trim(), role: "parent", ...parent });
      const goodChildren = children.filter(ch => ch.sku.trim() && ch.value.trim());
      for (const ch of goodChildren) {
        const d = await putOne(ch.sku.trim(), childAttrs(ch));
        results.push({ sku: ch.sku.trim(), role: `child · ${ch.value}`, ...d });
        await new Promise(r => setTimeout(r, 400));
      }
      const anyErr = results.some(r => r.error || (r.issues || []).some(i => i.severity === "ERROR"));
      setResult({ phase: anyErr ? "issues" : "done", data: { results } });
      if (onCommit) {
        const okCount = results.filter(r => !r.error && !(r.issues || []).some(i => i.severity === "ERROR")).length;
        if (okCount) onCommit({ sku: sku.trim(), newName: null, logRecord: logRec(sku.trim(), { status: "ACCEPTED" }, `VARIATION FAMILY · ${okCount}/${results.length} ok`) });
      }
    } catch (e) { setResult({ phase: "error", data: String(e) }); }
  }

  function logRec(theSku, d, fieldLabel) {
    return { id: `${Date.now()}`, ts: new Date().toISOString(), sku: theSku, productName: vals.item_name || theSku, fields: [fieldLabel], status: d.status || "ACCEPTED", note: `Created via Listing Creator${family ? ` · ${family.label}` : ""}` };
  }

  const missingRequired = schema.required.filter(n => {
    if (n === "bullet_point") return !bullets.some(b => b.trim());
    if (n === "main_product_image_locator") return !images.some(i => i.trim());
    if (n === "purchasable_offer" || n === "list_price") return !variation && !price;
    if (n === "fulfillment_availability") return !variation && !qty;
    if (n === "variation_theme") return variation && !theme;
    return !(vals[n] && String(vals[n]).trim());
  });
  const sevColor = (s) => (s === "ERROR" ? c.red : s === "WARNING" ? c.clay : c.green);

  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 400, color: c.ink, margin: 0 }}>Create Listing{family ? ` · ${family.label}` : ""}</h1>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: "rgba(111,102,87,0.6)" }}>Crear listado — el formulario se arma desde el esquema real de Amazon para la categoría que elijas.</div>
      </div>

      <div style={{ display: "flex", gap: 14, margin: "8px 0 12px", flexWrap: "wrap" }}>
        {[[1, "FAMILY"], [2, "PRODUCT TYPE"], [3, "DETAILS"]].map(([n, l]) => (
          <span key={n} style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1, color: step >= n ? c.ink : c.sub, borderBottom: step === n ? `2px solid ${c.clay}` : "none", paddingBottom: 2 }}>{n}. {l}</span>
        ))}
      </div>

      {step === 1 && (
        <div style={card}>
          <label style={labelS}>What are you listing?</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {FAMILIES.map(f => (
              <button key={f.id} onClick={() => pickFamily(f)} style={{ ...btnGhost, padding: "10px 18px", fontSize: 11, color: c.ink, borderColor: c.line }}>{f.label}</button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={card}>
          {family && family.hint && (
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.clay, marginBottom: 10, borderLeft: `2px solid ${c.clay}`, paddingLeft: 10 }}>{family.hint}</div>
          )}
          <label style={labelS}>Find the Amazon product type</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input style={{ ...inputS, width: 280 }} value={keywords} onChange={e => setKeywords(e.target.value)} onKeyDown={e => { if (e.key === "Enter") runSearch(); }} placeholder="e.g. body wash, sugar scrub, perfume, candle holder" />
            <button onClick={runSearch} style={btnDark}>Search</button>
            <button onClick={() => setStep(1)} style={btnGhost}>‹ Family</button>
          </div>
          {search.loading && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub, marginTop: 8 }}>Asking Amazon…</div>}
          {search.error && <div style={{ fontFamily: sans, fontSize: 11, color: c.red, marginTop: 8 }}>{search.error}</div>}
          {search.types.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: "rgba(111,102,87,0.55)", marginBottom: 6 }}>Pick the closest match — Amazon's real categories:</div>
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
              <span onClick={() => setStep(2)} style={{ color: c.clay, cursor: "pointer", marginLeft: 10, fontSize: 10 }}>change</span></div>
            <div style={{ marginTop: 10 }}>
              <label style={labelS}>{variation ? "Parent SKU" : "Your SKU"} (you choose this) *</label>
              <input style={{ ...inputS, maxWidth: 320, fontFamily: sans }} value={sku} onChange={e => setSku(e.target.value)} placeholder="e.g. LH-SCRUB-SUGAR" />
            </div>
            {has("variation_theme") && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontFamily: sans, fontSize: 11, color: c.ink, cursor: "pointer" }}>
                <input type="checkbox" checked={variation} onChange={e => setVariation(e.target.checked)} />
                This product comes in multiple sizes or scents (create a variation family)
              </label>
            )}
            {variation && (
              <div style={{ marginTop: 10 }}>
                <label style={labelS}>✱ Variation theme</label>
                {themeField && themeField.enum ? (
                  <select style={{ ...inputS, maxWidth: 320, fontFamily: sans, fontSize: 12 }} value={theme} onChange={e => setTheme(e.target.value)}>
                    <option value="">— select —</option>
                    {themeField.enum.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : (
                  <input style={{ ...inputS, maxWidth: 320, fontFamily: sans }} value={theme} onChange={e => setTheme(e.target.value)} placeholder="e.g. SIZE_NAME" />
                )}
              </div>
            )}
          </div>

          <div style={card}>
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans, marginBottom: 10 }}>
              {variation ? "Shared details · apply to the whole family · " : "Listing details · "}✱ = Amazon requires it
            </div>

            {has("item_name") && (<Field f={fieldByName("item_name")}><input style={inputS} value={vals.item_name || ""} onChange={e => setVals({ ...vals, item_name: e.target.value })} /></Field>)}
            {has("brand") && (<Field f={fieldByName("brand")}><input style={inputS} value={vals.brand || ""} onChange={e => setVals({ ...vals, brand: e.target.value })} /></Field>)}

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

            {has("product_description") && (<Field f={fieldByName("product_description")}><textarea style={{ ...inputS, minHeight: 80, resize: "vertical" }} value={vals.product_description || ""} onChange={e => setVals({ ...vals, product_description: e.target.value })} /></Field>)}

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

            {has("main_product_image_locator") && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelS}>{schema.required.includes("main_product_image_locator") ? "✱ " : ""}Image URLs (first = main){variation ? " · shared across variants unless a variant sets its own" : ""}</label>
                <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10, color: "rgba(111,102,87,0.55)", marginBottom: 6 }}>Paste public image links — your Shopify product images work (right-click → copy image address).</div>
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

            {/* single-product price/qty */}
            {!variation && (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {has("purchasable_offer") && (<div style={{ marginBottom: 14, maxWidth: 160 }}><label style={labelS}>{schema.required.includes("purchasable_offer") ? "✱ " : ""}Price (USD)</label><input style={{ ...inputS, fontFamily: sans }} value={price} onChange={e => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} /></div>)}
                {has("fulfillment_availability") && (<div style={{ marginBottom: 14, maxWidth: 160 }}><label style={labelS}>{schema.required.includes("fulfillment_availability") ? "✱ " : ""}Quantity</label><input style={{ ...inputS, fontFamily: sans }} value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9]/g, ""))} /></div>)}
              </div>
            )}
          </div>

          {/* variation children table */}
          {variation && (
            <div style={card}>
              <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans, marginBottom: 8 }}>Variants · each becomes a buyable child</div>
              {children.map((ch, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <input style={{ ...inputS, width: 150, fontFamily: sans, fontSize: 11 }} value={ch.sku} onChange={e => { const n = [...children]; n[i] = { ...ch, sku: e.target.value }; setChildren(n); }} placeholder="child SKU" />
                  <input style={{ ...inputS, width: 110 }} value={ch.value} onChange={e => { const n = [...children]; n[i] = { ...ch, value: e.target.value }; setChildren(n); }} placeholder={theme.toUpperCase().includes("SCENT") ? "scent" : "size e.g. 8 oz"} />
                  <input style={{ ...inputS, width: 80, fontFamily: sans }} value={ch.price} onChange={e => { const n = [...children]; n[i] = { ...ch, price: e.target.value.replace(/[^0-9.]/g, "") }; setChildren(n); }} placeholder="price" />
                  <input style={{ ...inputS, width: 70, fontFamily: sans }} value={ch.qty} onChange={e => { const n = [...children]; n[i] = { ...ch, qty: e.target.value.replace(/[^0-9]/g, "") }; setChildren(n); }} placeholder="qty" />
                  <input style={{ ...inputS, width: 150, fontFamily: sans, fontSize: 11 }} value={ch.image} onChange={e => { const n = [...children]; n[i] = { ...ch, image: e.target.value }; setChildren(n); }} placeholder="image URL (optional)" />
                  <span onClick={() => setChildren(children.filter((_, j) => j !== i))} style={{ color: c.red, cursor: "pointer" }}>✕</span>
                </div>
              ))}
              <button onClick={() => setChildren([...children, { sku: "", value: "", price: "", qty: "", image: "" }])} style={btnGhost}>＋ Add variant</button>
            </div>
          )}

          <div style={card}>
            {missingRequired.length > 0 && (<div style={{ fontFamily: sans, fontSize: 11, color: c.clay, marginBottom: 8 }}>Still required by Amazon: {missingRequired.map(n => (fieldByName(n)?.title) || n).join(", ")}</div>)}
            <button onClick={create} disabled={result.phase === "saving" || !sku.trim()} style={{ ...btnDark, opacity: result.phase === "saving" || !sku.trim() ? 0.4 : 1 }}>
              {result.phase === "saving" ? "Creating on Amazon…" : variation ? "Create variation family" : "Create listing"}
            </button>
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10, color: "rgba(111,102,87,0.55)", marginTop: 8 }}>
              Submitting validates against this exact schema and reports what (if anything) Amazon still needs — nothing here is binding or charged.
              <br/>Enviar valida contra el esquema real y reporta qué falta — nada es vinculante ni se cobra.
            </div>

            {result.phase !== "idle" && result.phase !== "saving" && result.data && result.data.results && (
              <div style={{ marginTop: 10 }}>
                {result.data.results.map((r, i) => {
                  const errs = r.error ? [{ severity: "ERROR", message: r.error }] : (r.issues || []);
                  const ok = !errs.some(e => e.severity === "ERROR");
                  return (
                    <div key={i} style={{ padding: 8, marginBottom: 6, border: `1px solid ${ok ? c.green : c.clay}`, borderRadius: 1, background: ok ? "#e9eee9" : "transparent" }}>
                      <div style={{ fontFamily: sans, fontSize: 11, color: ok ? c.green : c.clay }}>{ok ? "✓" : "✎"} {r.role} · {r.sku}{ok ? ` — accepted` : " — needs:"}</div>
                      {errs.map((e, j) => <div key={j} style={{ fontFamily: sans, fontSize: 10, color: sevColor(e.severity), marginTop: 2 }}>· [{e.severity}] {e.message}{e.attributeNames && e.attributeNames.length ? ` (${e.attributeNames.join(", ")})` : ""}</div>)}
                    </div>
                  );
                })}
              </div>
            )}
            {result.phase === "error" && <div style={{ marginTop: 10, fontFamily: sans, fontSize: 11, color: c.red }}>✗ {String(result.data)}</div>}
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
