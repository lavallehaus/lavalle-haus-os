import { useState, useMemo } from "react";

/* ============================================================================
   LAVALLE HAUS OS — COGS BUILDER  (true cost-per-unit, the Bezos lens)
   Lives as a sub-tab under "Sales". One editable cost breakdown per product:
   Materials/Ingredients · Packaging · Shipping/Freight · Labor (time → $).
   Rolls up to a true per-unit COGS, splits by category, and works backwards
   from retail price to margin + max allowable COGS.

       <CogsBuilder data={data} onSave={(payload)=>persist(payload)} />
   data   = { products:[...], laborRate:Number }
   onSave = called with { products, laborRate }.
   ========================================================================== */

const c = {
  bg:"#f7f4ef", panel:"#fffdf9", ink:"#2b2620", sub:"#6f6657",
  line:"#e4ddd0", lineSoft:"#efe9de", sage:"#6b7257", clay:"#a8643c", gold:"#b08d57",
  green:"#5c7a52", yellow:"#b78b2e", red:"#a8483a",
};
const serif = "'IM Fell English', Georgia, 'Times New Roman', serif";
const sans  = "'IM Fell English', Georgia, serif";
const faintEs = { fontFamily:sans, fontSize:10.5, fontStyle:"italic", color:"rgba(111,102,87,0.6)", marginTop:1, lineHeight:1.3, fontWeight:400, letterSpacing:0, textTransform:"none" };

const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? 0 : Number(v));
const money2 = (n) => (n < 0 ? "-$" : "$") + Math.abs(num(n)).toFixed(2);
const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(num(n)).toLocaleString("en-US", { maximumFractionDigits: 0 });
const pct = (n) => (n * 100).toFixed(1) + "%";

const LABOR_RATE_DEFAULT = 15; // $/hour

/* ---- SEED: real products, with the Apple candle fully broken out -------- */
const uid = (p) => p + Math.random().toString(36).slice(2, 7);
const mat = (name, nameEs, qty, unitCost, basis = "batch") => ({ id: uid("m"), name, nameEs, qty, unitCost, basis });
const lab = (name, nameEs, hours, basis = "batch") => ({ id: uid("l"), name, nameEs, hours, basis });

const SEED_COGS = [
  { id: 4, name: "Small Apple Vanilla Candle", nameEs: "Vela manzana vainilla chica", sku: "RH-CANDLE-SM-AP", retail: 18, batchYield: 42,
    materials: [
      mat("Apples (cut & baked)", "manzanas (cortadas y horneadas)", 42, 0.5, "batch"),
      mat("Candle wax", "cera para vela", 42, 0.9, "batch"),
      mat("Rose petals + white flower", "pétalos de rosa + flor blanca", 1, 18, "batch"),
      mat("Wick + fragrance", "pabilo + fragancia", 1, 0.45, "unit"),
    ],
    packaging: [
      mat("Small candle box", "caja chica de vela", 1, 0.55, "unit"),
      mat("Plastic seal wrap", "plástico para sellar", 1, 0.12, "unit"),
      mat("Outer bag", "bolsa exterior", 1, 0.08, "unit"),
      mat("Big box (per 6) + paper tape", "caja grande (por 6) + tape de papel", 1, 1.2, "batch"),
    ],
    shipping: [
      mat("Inbound freight per unit", "flete de entrada por unidad", 1, 0.7, "unit"),
    ],
    labor: [
      lab("Cut apples + oven", "cortar manzanas + horno", 6),
      lab("Wrap & clean cut apple", "poner en plástico manzana cortada y limpiar", 2),
      lab("Apple front & back (glue, cut borders)", "frente y reverso manzana (pegar, cortar bordes)", 1),
      lab("Rose petals bag; cut white flower", "pétalos en bolsa; cortar flor blanca", 1),
      lab("Wax to make candle", "wax para hacer vela", 8),
      lab("Pour wax on top", "poner wax encima", 8),
      lab("Small candle box w/ dough bowl inside", "caja vela chica con dough bowl adentro", 0.5),
      lab("Plastic-seal box with candle", "poner plástico a caja con vela para sellarla", 0.5),
      lab("Bag the sealed box", "poner bolsa a caja con vela sellada", 0.5),
      lab("Assemble into small individual box", "poner en caja individual pequeña para armarla", 3),
      lab("Pack 6 boxes into big box", "poner 6 cajas individuales en caja grande", 3),
      lab("Paper tape for big box", "tape de papel para caja grande", 1),
    ],
  },
  { id: 5, name: "Large Apple Vanilla Candle", nameEs: "Vela manzana vainilla grande", sku: "RH-CANDLE-LG-AP", retail: 32, batchYield: 30,
    materials: [ mat("Base materials (est.)", "materiales base (est.)", 1, 5.8, "unit") ],
    packaging: [ mat("Box + seal + bag", "caja + sello + bolsa", 1, 1.1, "unit") ],
    shipping: [ mat("Inbound freight per unit", "flete por unidad", 1, 1.1, "unit") ],
    labor: [ lab("Production (fill in steps)", "producción (llenar pasos)", 0) ],
  },
  { id: 1, name: "SeaShell Vessel Candle", nameEs: "Vela vasija concha", sku: "RH-SeaShell-9633", retail: 48, batchYield: 50,
    materials: [ mat("Base materials (est.)", "materiales base (est.)", 1, 8.5, "unit") ],
    packaging: [ mat("Packaging (est.)", "empaque (est.)", 1, 2.0, "unit") ],
    shipping: [ mat("Inbound freight per unit", "flete por unidad", 1, 1.5, "unit") ],
    labor: [ lab("Production (fill in steps)", "producción (llenar pasos)", 0) ],
  },
  { id: 2, name: "Beeswax Candle Sand 16oz", nameEs: "Vela cera de abeja arena 16oz", sku: "RH-Sandwax-AC-16c", retail: 22, batchYield: 60,
    materials: [ mat("Base materials (est.)", "materiales base (est.)", 1, 3.7, "unit") ],
    packaging: [ mat("Packaging (est.)", "empaque (est.)", 1, 1.0, "unit") ],
    shipping: [ mat("Inbound freight per unit", "flete por unidad", 1, 0.8, "unit") ],
    labor: [ lab("Production (fill in steps)", "producción (llenar pasos)", 0) ],
  },
  { id: 3, name: "Beeswax Candle Sand 32oz", nameEs: "Vela cera de abeja arena 32oz", sku: "RH-Sandwax-AC-32c", retail: 34, batchYield: 40,
    materials: [ mat("Base materials (est.)", "materiales base (est.)", 1, 6.1, "unit") ],
    packaging: [ mat("Packaging (est.)", "empaque (est.)", 1, 1.2, "unit") ],
    shipping: [ mat("Inbound freight per unit", "flete por unidad", 1, 1.2, "unit") ],
    labor: [ lab("Production (fill in steps)", "producción (llenar pasos)", 0) ],
  },
  { id: 8, name: "Vanilla Cashmere Sugar Scrub", nameEs: "Exfoliante azúcar vainilla cashmere", sku: "LH-SCRUB-VC", retail: 24, batchYield: 50,
    materials: [ mat("Sugar + oils + fragrance (est.)", "azúcar + aceites + fragancia (est.)", 1, 4.2, "unit") ],
    packaging: [ mat("Jar + lid + label (est.)", "frasco + tapa + etiqueta (est.)", 1, 1.2, "unit") ],
    shipping: [ mat("Inbound freight per unit", "flete por unidad", 1, 0.6, "unit") ],
    labor: [ lab("Production (fill in steps)", "producción (llenar pasos)", 0) ],
  },
  { id: 7, name: "Dough Bowl Vessel Candle", nameEs: "Vela vasija dough bowl", sku: "RH-DoughBowl", retail: 58, batchYield: 24,
    materials: [ mat("Base materials (est.)", "materiales base (est.)", 1, 10.0, "unit") ],
    packaging: [ mat("Packaging (est.)", "empaque (est.)", 1, 2.5, "unit") ],
    shipping: [ mat("Inbound freight per unit", "flete por unidad", 1, 2.0, "unit") ],
    labor: [ lab("Production (fill in steps)", "producción (llenar pasos)", 0) ],
  },
];

/* ---- MATH --------------------------------------------------------------- */
const lineCost = (l) => num(l.qty) * num(l.unitCost);
const perUnit = (cost, basis, yield_) => (basis === "unit" ? cost : cost / Math.max(num(yield_), 1));

function productEconomics(p, rate) {
  const y = Math.max(num(p.batchYield), 1);
  const sumSection = (rows, isLabor) =>
    (rows || []).reduce((s, l) => {
      const cost = isLabor ? num(l.hours) * num(rate) : lineCost(l);
      return s + perUnit(cost, l.basis, y);
    }, 0);
  const materials = sumSection(p.materials, false);
  const packaging = sumSection(p.packaging, false);
  const shipping  = sumSection(p.shipping, false);
  const labor     = sumSection(p.labor, true);
  const total = materials + packaging + shipping + labor;
  const totalHours = (p.labor || []).reduce((s, l) => s + perUnit(num(l.hours), l.basis, y), 0);
  const retail = num(p.retail);
  const margin = retail > 0 ? (retail - total) / retail : 0;
  return { materials, packaging, shipping, labor, total, totalHours, retail, margin };
}

/* ---- PRIMITIVES --------------------------------------------------------- */
const Inp = ({ value, onChange, w = 78, type = "number", placeholder, align = "right" }) => (
  <input type={type} value={value === null || value === undefined ? "" : value} placeholder={placeholder}onChange={(e) => onChange(e.target.value)}
    style={{ width: w, fontFamily: sans, fontSize: 13, textAlign: align, padding: "5px 7px", border: `1px solid ${c.line}`, borderRadius: 2, background: c.panel, color: c.ink, boxSizing: "border-box" }} />
);
const UOM_OPTIONS = ["lb", "oz", "unit", "inch", "ml", "gram", "kg"];
const selStyle = { fontFamily: sans, fontSize: 11.5, cursor: "pointer", padding: "4px 7px", borderRadius: 2, border: `1px solid ${c.line}`, background: c.panel, color: c.sub, whiteSpace: "nowrap" };
const UomSelect = ({ value, onChange }) => (
  <select value={value || "unit"} onChange={(e) => onChange(e.target.value)} style={{ ...selStyle, width: 72 }}>
    {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
  </select>
);
const BasisSelect = ({ value, onChange, yield_ }) => (
  <select value={value || "unit"} onChange={(e) => onChange(e.target.value)} title="how this cost is allocated" style={{ ...selStyle, width: 128 }}>
    <option value="unit">per unit</option>
    <option value="batch">{`per batch (÷${yield_})`}</option>
  </select>
);

/* ---- CHANNEL ECONOMICS (Phase 2: true landed cost → per-channel) -------- */
const CHAN_DEFAULTS = {
  amazon:  { referralPct: 15, fbaFee: 0, storagePerUnit: 0 },
  shopify: { processingPct: 2.9, processingFixed: 0.3, outboundShip: 0 },
  b2b:     { wholesalePrice: 0, commissionPct: 0, freightPerUnit: 0, ordersPerAccount: 4, reorderCommissionPct: 0 },
};
const chan = (p) => ({
  amazon:  { ...CHAN_DEFAULTS.amazon,  ...((p.channels || {}).amazon  || {}) },
  shopify: { ...CHAN_DEFAULTS.shopify, ...((p.channels || {}).shopify || {}) },
  b2b:     { ...CHAN_DEFAULTS.b2b,     ...((p.channels || {}).b2b     || {}) },
});
function channelEconomics(p, landed) {
  const cset = chan(p), retail = num(p.retail), az = cset.amazon, sh = cset.shopify, b2 = cset.b2b;
  const azCogs = landed + num(az.fbaFee) + num(az.storagePerUnit);
  const azFee  = retail * num(az.referralPct) / 100;
  const azNet  = retail - azCogs - azFee;
  const shCogs = landed + num(sh.outboundShip);
  const shFee  = retail * num(sh.processingPct) / 100 + num(sh.processingFixed);
  const shNet  = retail - shCogs - shFee;
  const whole  = num(b2.wholesalePrice);
  const b2Cogs = landed + num(b2.freightPerUnit);
  const b2Fee  = whole * num(b2.commissionPct) / 100;
  const b2Net  = whole - b2Cogs - b2Fee;
  return {
    az: { cogs: azCogs, fee: azFee, allIn: azCogs + azFee, net: azNet, margin: retail > 0 ? azNet / retail : 0, beRoas: azNet > 0 ? retail / azNet : 0 },
    sh: { cogs: shCogs, fee: shFee, allIn: shCogs + shFee, net: shNet, margin: retail > 0 ? shNet / retail : 0, beRoas: shNet > 0 ? retail / shNet : 0 },
    b2b: { price: whole, cogs: b2Cogs, fee: b2Fee, allIn: b2Cogs + b2Fee, net: b2Net, margin: whole > 0 ? b2Net / whole : 0 },
  };
}
const roasFmt = (r) => (r && isFinite(r) && r > 0 ? r.toFixed(2) + "×" : "—");
const acosFmt = (a) => (isFinite(a) ? (a * 100).toFixed(1) + "%" : "—");
const mColor = (m) => (m >= 0.5 ? c.green : m >= 0.3 ? c.yellow : c.red);
const KV = ({ label, value, strong }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "2px 0", fontSize: 13 }}>
    <span style={{ color: c.sub }}>{label}</span>
    <span style={{ color: strong ? c.ink : c.sub, fontWeight: strong ? 600 : 400, whiteSpace: "nowrap" }}>{value}</span>
  </div>
);
const Waterfall = ({ title, price, rows }) => {
  if (!(price > 0)) return null;
  const costSum = rows.slice(0, -1).reduce((s, r) => s + num(r.v), 0);
  const net = price - costSum;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 14 }}>{title}</div>
        <div style={{ fontSize: 12, color: c.sub }}>price {money2(price)} · precio</div>
      </div>
      <div style={{ display: "flex", height: 22, borderRadius: 3, overflow: "hidden", marginTop: 6, border: `1px solid ${c.lineSoft}` }}>
        {rows.map((r, i) => { const w = Math.max(0, (num(r.v) / price) * 100); return w > 0 ? <div key={i} title={`${r.label}: ${money2(r.v)}`} style={{ width: `${w}%`, background: r.color }} /> : null; })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 7 }}>
        {rows.map((r, i) => (
          <span key={i} style={{ fontSize: 11.5, color: c.sub, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, background: r.color, borderRadius: 2, display: "inline-block" }} />{r.label} {money2(r.v)}
          </span>
        ))}
        {net < 0 && <span style={{ fontSize: 11.5, color: c.red }}>over price by {money2(-net)} · sobre el precio</span>}
      </div>
    </div>
  );
};

/* ============================================================================
   MAIN
   ========================================================================== */
const S = {
  wrap: { fontFamily: serif, color: c.ink, background: c.bg, padding: "26px 22px 60px", maxWidth: 1180, margin: "0 auto" }, h1: { fontFamily: serif, fontSize: 30, fontWeight: 400, letterSpacing: 0.3, margin: 0 },
  sub: { color: c.sub, fontSize: 14.5, marginTop: 4, fontStyle: "italic" },
  panel: { background: c.panel, border: `1px solid ${c.line}`, borderRadius: 4, padding: 18 },
  sec: { fontSize: 19, fontWeight: 400, margin: "26px 0 12px", letterSpacing: 0.3, borderBottom: `1px solid ${c.line}`, paddingBottom: 8 },
  cap: { fontFamily: sans, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: c.sub },
  th: { fontFamily: sans, fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: c.sub, padding: "7px 8px", textAlign: "right", borderBottom: `1px solid ${c.line}`, whiteSpace: "nowrap" },
  thL: { textAlign: "left" },
  td: { fontSize: 13, padding: "7px 8px", textAlign: "right", borderBottom: `1px solid ${c.lineSoft}`, whiteSpace: "nowrap", verticalAlign: "top" },
  tdL: { textAlign: "left" },
};

/* Section is defined at MODULE scope (not inside CogsBuilder) so React keeps the
   same component identity across renders — inputs no longer lose focus on each
   keystroke, and the page no longer jumps when deleting. */
function Section({ title, titleEs, section, isLabor, product, rate, editLine, addLine, delLine }) {
  const rows = product[section] || [];
  const y = Math.max(num(product.batchYield), 1);
  const subtotal = rows.reduce((s, l) => { const cost = isLabor ? num(l.hours) * num(rate) : lineCost(l); return s + perUnit(cost, l.basis, y); }, 0);
  const colCount = isLabor ? 5 : 7;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div><div style={{ fontSize: 16 }}>{title}</div><div style={faintEs}>{titleEs}</div></div>
        <div style={{ textAlign: "right" }}><span style={S.cap}>{isLabor ? "Labor / unit · mano de obra/u" : "Cost / unit · costo/u"}</span><div style={{ fontSize: 17 }}>{money2(subtotal)}</div></div>
      </div>
      <div style={{ overflowX: "auto", marginTop: 8, border: `1px solid ${c.lineSoft}`, borderRadius: 3 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: isLabor ? 480 : 620 }}>
          <thead><tr>
            <th style={{ ...S.th, ...S.thL }}>Item / Step<div style={faintEs}>Ítem / Paso</div></th>
            {isLabor
              ? <th style={S.th}>Hours<div style={faintEs}>Horas</div></th>
              : <><th style={S.th}>Qty<div style={faintEs}>Cant.</div></th><th style={S.th}>UoM<div style={faintEs}>Unidad</div></th><th style={S.th}>Unit $<div style={faintEs}>$ unidad</div></th></>}
            <th style={S.th}>Basis<div style={faintEs}>Base</div></th>
            <th style={S.th}>= /unit<div style={faintEs}>/unidad</div></th>
            <th style={S.th}></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={colCount} style={{ ...S.td, ...S.tdL, color: c.sub, fontStyle: "italic" }}>No lines yet — add one below. · Sin líneas aún — agrega una abajo.</td></tr>}
            {rows.map((l) => {
              const cost = isLabor ? num(l.hours) * num(rate) : lineCost(l);
              const pu = perUnit(cost, l.basis, y);
              return (
                <tr key={l.id}>
                  <td style={{ ...S.td, ...S.tdL, whiteSpace: "normal", minWidth: 190 }}>
                    <input value={l.name || ""} placeholder="English name" onChange={(e) => editLine(section, l.id, { name: e.target.value })}
                      style={{ width: "100%", boxSizing: "border-box", fontFamily: sans, fontSize: 13, padding: "5px 7px", border: `1px solid ${c.line}`, borderRadius: 2, background: c.panel, color: c.ink }} />
                    <input value={l.nameEs || ""} placeholder="nombre en español" onChange={(e) => editLine(section, l.id, { nameEs: e.target.value })}
                      style={{ width: "100%", boxSizing: "border-box", marginTop: 4, fontFamily: sans, fontSize: 11.5, fontStyle: "italic", padding: "4px 7px", border: `1px solid ${c.lineSoft}`, borderRadius: 2, background: c.panel, color: "rgba(111,102,87,0.85)" }} />
                  </td>
                  {isLabor
                    ? <td style={S.td}><Inp value={l.hours} onChange={(v) => editLine(section, l.id, { hours: v })} w={66} /></td>
                    : <><td style={S.td}><Inp value={l.qty} onChange={(v) => editLine(section, l.id, { qty: v })} w={58} /></td>
                       <td style={S.td}><UomSelect value={l.uom} onChange={(v) => editLine(section, l.id, { uom: v })} /></td>
                       <td style={S.td}><Inp value={l.unitCost} onChange={(v) => editLine(section, l.id, { unitCost: v })} w={70} /></td></>}
                  <td style={S.td}><BasisSelect value={l.basis} onChange={(v) => editLine(section, l.id, { basis: v })} yield_={y} /></td>
                  <td style={{ ...S.td, color: c.ink }}>{money2(pu)}</td><td style={S.td}><button onClick={() => delLine(section, l.id)} style={{ cursor: "pointer", border: "none", background: "transparent", color: c.sub, fontSize: 16 }}>×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button onClick={() => addLine(section)} style={{ marginTop: 8, fontFamily: sans, fontSize: 12.5, cursor: "pointer", padding: "5px 12px", borderRadius: 2, border: `1px solid ${c.line}`, background: "transparent", color: c.clay }}>
        + Add {isLabor ? "step" : "line"} · agregar {isLabor ? "paso" : "línea"}
      </button>
    </div>
  );
}

export default function CogsBuilder({ data, onSave }) {
  const [prods, setProds] = useState(() => (data && data.products && data.products.length ? data.products : SEED_COGS).map((p) => ({ ...p })));
  const [rate, setRate] = useState(() => (data && data.laborRate != null ? data.laborRate : LABOR_RATE_DEFAULT));
  const [active, setActive] = useState(() => (data && data.products && data.products[0] ? data.products[0].id : SEED_COGS[0].id));
  const [dirty, setDirty] = useState(false);

  const product = prods.find((p) => p.id === active) || prods[0];
  const econ = useMemo(() => (product ? productEconomics(product, rate) : null), [product, rate, prods]);
  const chEcon = useMemo(() => channelEconomics(product || {}, econ ? econ.total : 0), [product, prods, econ]);

  const touch = () => setDirty(true);
  const setProd = (id, patch) => { setProds((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p))); touch(); };
  const setLine = (section, lineId, patch) =>
    setProds((prev) => prev.map((p) => p.id !== active ? p : { ...p, [section]: p[section].map((l) => (l.id === lineId ? { ...l, ...patch } : l)) })) && touch();
  const editLine = (section, lineId, patch) => { setProds((prev) => prev.map((p) => p.id !== active ? p : { ...p, [section]: (p[section] || []).map((l) => (l.id === lineId ? { ...l, ...patch } : l)) })); touch(); };
  const addLine = (section) => { setProds((prev) => prev.map((p) => { if (p.id !== active) return p; const blank = section === "labor" ? { id: uid("l"), name: "", nameEs: "", hours: 0, basis: "batch" } : { id: uid("m"), name: "", nameEs: "", qty: 1, unitCost: 0, uom: "unit", basis: section === "materials" ? "batch" : "unit" }; return { ...p, [section]: [...(p[section] || []), blank] }; })); touch(); };
  const delLine = (section, lineId) => { setProds((prev) => prev.map((p) => p.id !== active ? p : { ...p, [section]: (p[section] || []).filter((l) => l.id !== lineId) })); touch(); };
  const setChan = (chKey, patch) => { setProds((prev) => prev.map((p) => { if (p.id !== active) return p; const cur = chan(p); return { ...p, channels: { ...cur, [chKey]: { ...cur[chKey], ...patch } } }; })); touch(); };

  const addProduct = () => {
    const id = prods.reduce((mx, p) => Math.max(mx, Number(p.id) || 0), 0) + 1;
    const np = { id, name: "New product", nameEs: "Producto nuevo", sku: "", retail: 0, batchYield: 1, materials: [], packaging: [], shipping: [], labor: [] };
    setProds((prev) => [...prev, np]); setActive(id); touch();
  };
  const delProduct = () => { if (prods.length <= 1) return; const next = prods.filter((p) => p.id !== active); setProds(next); setActive(next[0].id); touch(); };
  const save = () => { onSave?.({ products: prods, laborRate: rate }); setDirty(false); };

  if (!product) return null;
  const cset = chan(product);
  const tgtPct = num(product.targetMarginAfterAds != null ? product.targetMarginAfterAds : 15);
  const tf = tgtPct / 100;
  const azMaxAd = chEcon.az.net - tf * econ.retail;
  const shMaxAd = chEcon.sh.net - tf * econ.retail;
  const azTgtAcos = econ.retail > 0 ? azMaxAd / econ.retail : 0;
  const shTgtAcos = econ.retail > 0 ? shMaxAd / econ.retail : 0;
  const azTgtRoas = azMaxAd > 0 ? econ.retail / azMaxAd : 0;
  const shTgtRoas = shMaxAd > 0 ? econ.retail / shMaxAd : 0;
  const b2bPrice = num(cset.b2b.wholesalePrice);
  const bestCh = (() => {
    const cands = [];
    if (econ.retail > 0) cands.push(["az", chEcon.az.net], ["sh", chEcon.sh.net]);
    if (b2bPrice > 0) cands.push(["b2b", chEcon.b2b.net]);
    return cands.length ? cands.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null;
  })();
  const b2bOrders = Math.max(num(cset.b2b.ordersPerAccount), 1);
  const b2bReorderComm = num(cset.b2b.reorderCommissionPct) / 100;
  const b2bContribFirst = chEcon.b2b.net; // first order (uses first-order commission from B2B card)
  const b2bContribReorder = b2bPrice - econ.total - num(cset.b2b.freightPerUnit) - b2bPrice * b2bReorderComm;
  const b2bLtvContrib = b2bContribFirst + (b2bOrders - 1) * b2bContribReorder;
  const b2bBeRoasFirst = b2bContribFirst > 0 ? b2bPrice / b2bContribFirst : 0;
  const b2bBeRoasLtv = b2bLtvContrib > 0 ? b2bPrice / b2bLtvContrib : 0;
  const maxCogs = econ.retail; // price carries the cost; max allowable shown vs target margins below
  const marginColor = econ.margin >= 0.5 ? c.green : econ.margin >= 0.3 ? c.yellow : c.red;

  return (
    <div style={S.wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={S.h1}>COGS Builder</h1><div style={faintEs}>Constructor de costos</div>
          <div style={S.sub}>Every ingredient, box, and minute of labor — the true cost of one unit.</div>
          <div style={faintEs}>Cada ingrediente, caja y minuto de mano de obra — el costo real de una unidad.</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>Labor rate $/hr · tarifa/hora</span><Inp value={rate} onChange={(v) => { setRate(v); touch(); }} w={84} /></label>
          <button onClick={save} style={{ fontFamily: sans, fontSize: 13, cursor: "pointer", padding: "9px 20px", borderRadius: 2, border: `1px solid ${c.ink}`, background: dirty ? c.ink : c.sub, color: c.bg }}>{dirty ? "Save · guardar" : "Saved · guardado"}</button>
        </div>
      </div>

      {/* PRODUCT SELECTOR (third-level tabs) */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 18 }}>
        {prods.map((p) => { const on = p.id === active;
          return <button key={p.id} onClick={() => setActive(p.id)} style={{ fontFamily: sans, fontSize: 13, cursor: "pointer", padding: "7px 13px", borderRadius: 2, border: `1px solid ${on ? c.gold : c.line}`, background: on ? c.gold : "transparent", color: on ? "#fff" : c.sub, whiteSpace: "nowrap" }}>{p.name}</button>; })}
        <button onClick={addProduct} style={{ fontFamily: sans, fontSize: 13, cursor: "pointer", padding: "7px 13px", borderRadius: 2, border: `1px dashed ${c.line}`, background: "transparent", color: c.clay }}>+ Product · producto</button>
      </div>

      {/* PRODUCT HEADER + IDENTITY */}
      <div style={{ ...S.panel, marginTop: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>Product name · nombre</span>
            <input value={product.name} onChange={(e) => setProd(product.id, { name: e.target.value })} style={{ fontFamily: sans, fontSize: 14, padding: "6px 8px", border: `1px solid ${c.line}`, borderRadius: 2, background: c.panel, color: c.ink }} /></label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>SKU</span>
            <input value={product.sku || ""} onChange={(e) => setProd(product.id, { sku: e.target.value })} style={{ fontFamily: sans, fontSize: 14, padding: "6px 8px", border: `1px solid ${c.line}`, borderRadius: 2, background: c.panel, color: c.ink }} /></label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>Retail price · precio</span><Inp value={product.retail} onChange={(v) => setProd(product.id, { retail: v })} w="100%" /></label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>Batch yield (units) · rinde lote</span><Inp value={product.batchYield} onChange={(v) => setProd(product.id, { batchYield: v })} w="100%" /></label>
        </div>
        <div style={{ fontSize: 12, color: c.sub, fontStyle: "italic", marginTop: 10 }}>
          "Per batch" lines are divided by the batch yield to get per-unit cost. Set the yield to how many finished units one production run makes.
          <div style={faintEs}>Las líneas "por lote" se dividen entre el rinde del lote para obtener el costo por unidad. Fija el rinde según cuántas unidades terminadas produce una corrida.</div>
        </div>
      </div>

      {/* THE FOUR EDITABLE SECTIONS */}
      <Section title="Materials / Ingredients" titleEs="Materiales / Ingredientes" section="materials" isLabor={false} product={product} rate={rate} editLine={editLine} addLine={addLine} delLine={delLine} />
      <Section title="Packaging" titleEs="Empaque" section="packaging" isLabor={false} product={product} rate={rate} editLine={editLine} addLine={addLine} delLine={delLine} />
      <Section title="Inbound Freight & Labels" titleEs="Flete de entrada y etiquetas" section="shipping" isLabor={false} product={product} rate={rate} editLine={editLine} addLine={addLine} delLine={delLine} />
      <Section title="Labor — production steps" titleEs="Mano de obra — pasos de producción" section="labor" isLabor={true} product={product} rate={rate} editLine={editLine} addLine={addLine} delLine={delLine} />

      {/* TRUE COST ROLL-UP (the Bezos lens) */}
      <div style={S.sec}>True Landed Cost Per Unit<div style={faintEs}>Costo real en destino por unidad</div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12 }}>
        {[
          { l: "Materials", le: "Materiales", v: econ.materials },
          { l: "Packaging", le: "Empaque", v: econ.packaging },
          { l: "Inbound", le: "Entrada", v: econ.shipping },
          { l: "Labor", le: "Mano de obra", v: econ.labor, note: `${econ.totalHours.toFixed(2)} hrs/unit @ ${money2(rate)}/hr` },
        ].map((x) => (
          <div key={x.l} style={{ ...S.panel, padding: "14px 16px" }}>
            <div style={S.cap}>{x.l}</div><div style={faintEs}>{x.le}</div>
            <div style={{ fontSize: 22, marginTop: 6 }}>{money2(x.v)}</div>
            {x.note && <div style={{ fontSize: 11, color: c.sub, marginTop: 3 }}>{x.note}</div>}
          </div>
        ))}
      </div>

      <div style={{ ...S.panel, marginTop: 12, borderLeft: `3px solid ${c.gold}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
          <div><div style={S.cap}>True landed cost / unit · costo en destino/u</div><div style={{ fontSize: 30 }}>{money2(econ.total)}</div></div>
          <div style={{ textAlign: "right" }}>
            <div style={S.cap}>At {money2(econ.retail)} retail · margin · margen</div>
            <div style={{ fontSize: 26, color: marginColor }}>{econ.retail > 0 ? pct(econ.margin) : "—"}</div>
            <div style={{ fontSize: 12, color: c.sub }}>{econ.retail > 0 ? `keeps ${money2(econ.retail - econ.total)}/unit · retiene/u` : "set a retail price"}</div>
          </div>
        </div>
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
          <div style={S.cap}>Working backwards — max COGS the price can carry · COGS máximo que soporta el precio</div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 8 }}>{[0.5, 0.6, 0.7].map((m) => { const maxc = econ.retail * (1 - m); const ok = econ.total <= maxc;
              return (
                <div key={m} style={{ fontSize: 13 }}>
                  <span style={{ color: c.sub }}>{Math.round(m * 100)}% margin → </span>
                  <b style={{ color: ok ? c.green : c.red }}>{money2(maxc)}</b>
                  <span style={{ color: c.sub }}> {ok ? "✓ within" : "✗ over"}</span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: c.sub, fontStyle: "italic", marginTop: 8 }}>
            Bezos lens: price is fixed by the market, so the cost target works backwards from it. If your true cost is above the bar, the fix is lower COGS or faster labor — not a higher price.
            <div style={faintEs}>Lente Bezos: el precio lo fija el mercado, así que la meta de costo se calcula hacia atrás desde él. Si tu costo real supera la línea, la solución es bajar COGS o agilizar la mano de obra — no subir el precio.</div>
          </div>
        </div>
        {prods.length > 1 && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${c.line}`, textAlign: "right" }}>
            <button onClick={delProduct} style={{ fontFamily: sans, fontSize: 12.5, cursor: "pointer", padding: "6px 14px", borderRadius: 2, border: `1px solid ${c.red}`, background: "transparent", color: c.red }}>Delete this product · eliminar</button>
          </div>
        )}
      </div>

      {/* CHANNEL ECONOMICS (Phase 2/3) — built on top of true landed cost */}
      <div style={S.sec}>Channel Economics — Amazon · Shopify · B2B<div style={faintEs}>Economía por canal — Amazon · Shopify · B2B</div></div>
      <div style={{ fontSize: 12, color: c.sub, fontStyle: "italic", marginBottom: 12 }}>
        Starts from your true landed cost ({money2(econ.total)}/unit), then layers each channel's real fees on top. Amazon &amp; Shopify sell at retail; B2B sells at your wholesale price. Defaults are estimates — edit them to match reality.
        <div style={faintEs}>Parte de tu costo real en destino ({money2(econ.total)}/u), luego suma las comisiones de cada canal. Amazon y Shopify venden a precio de venta; B2B vende a tu precio de mayoreo. Los valores por defecto son estimados — edítalos según la realidad.</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px,1fr))", gap: 14 }}>

        {/* AMAZON */}
        <div style={{ ...S.panel, borderTop: `3px solid ${bestCh === "az" ? c.gold : c.line}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
            <div style={{ fontSize: 16 }}>Amazon (FBA)</div>
            {bestCh === "az" && <span style={{ fontFamily: sans, fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: c.gold }}>keeps most · retiene más</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px,1fr))", gap: 10, marginTop: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>Referral %</span><Inp value={cset.amazon.referralPct} onChange={(v) => setChan("amazon", { referralPct: v })} w="100%" /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>FBA fee $/u</span><Inp value={cset.amazon.fbaFee} onChange={(v) => setChan("amazon", { fbaFee: v })} w="100%" /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>FBA storage $/u</span><Inp value={cset.amazon.storagePerUnit} onChange={(v) => setChan("amazon", { storagePerUnit: v })} w="100%" /></label>
          </div>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${c.lineSoft}` }}>
            <KV label="Landed cost · costo en destino" value={money2(econ.total)} />
            <KV label="+ FBA fee + storage · FBA + almacén" value={money2(chEcon.az.cogs - econ.total)} />
            <KV label={`+ Referral fee (${num(cset.amazon.referralPct)}%) · comisión`} value={money2(chEcon.az.fee)} />
          </div>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
            <div><div style={S.cap}>All-in cost / unit · costo total/u</div><div style={{ fontSize: 28 }}>{money2(chEcon.az.allIn)}</div></div>
            <div style={{ textAlign: "right" }}><div style={S.cap}>Net @ {money2(econ.retail)} · margen</div><div style={{ fontSize: 16 }}>{money2(chEcon.az.net)} · <span style={{ color: mColor(chEcon.az.margin) }}>{econ.retail > 0 ? pct(chEcon.az.margin) : "—"}</span></div></div>
          </div>
        </div>

        {/* SHOPIFY */}
        <div style={{ ...S.panel, borderTop: `3px solid ${bestCh === "sh" ? c.gold : c.line}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
            <div style={{ fontSize: 16 }}>Shopify (D2C)</div>
            {bestCh === "sh" && <span style={{ fontFamily: sans, fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: c.gold }}>keeps most · retiene más</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px,1fr))", gap: 10, marginTop: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>Processing %</span><Inp value={cset.shopify.processingPct} onChange={(v) => setChan("shopify", { processingPct: v })} w="100%" /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>Processing $ fixed</span><Inp value={cset.shopify.processingFixed} onChange={(v) => setChan("shopify", { processingFixed: v })} w="100%" /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>Outbound ship $/u</span><Inp value={cset.shopify.outboundShip} onChange={(v) => setChan("shopify", { outboundShip: v })} w="100%" /></label>
          </div>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${c.lineSoft}` }}>
            <KV label="Landed cost · costo en destino" value={money2(econ.total)} />
            <KV label="+ Outbound shipping · flete salida" value={money2(chEcon.sh.cogs - econ.total)} />
            <KV label={`+ Processing (${num(cset.shopify.processingPct)}% + ${money2(cset.shopify.processingFixed)}) · proc.`} value={money2(chEcon.sh.fee)} />
          </div>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
            <div><div style={S.cap}>All-in cost / unit · costo total/u</div><div style={{ fontSize: 28 }}>{money2(chEcon.sh.allIn)}</div></div>
            <div style={{ textAlign: "right" }}><div style={S.cap}>Net @ {money2(econ.retail)} · margen</div><div style={{ fontSize: 16 }}>{money2(chEcon.sh.net)} · <span style={{ color: mColor(chEcon.sh.margin) }}>{econ.retail > 0 ? pct(chEcon.sh.margin) : "—"}</span></div></div>
          </div>
        </div>

        {/* B2B / WHOLESALE */}
        <div style={{ ...S.panel, borderTop: `3px solid ${bestCh === "b2b" ? c.gold : c.line}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
            <div style={{ fontSize: 16 }}>B2B / Wholesale</div>
            {bestCh === "b2b" && <span style={{ fontFamily: sans, fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: c.gold }}>keeps most · retiene más</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px,1fr))", gap: 10, marginTop: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>Wholesale $/u</span><Inp value={cset.b2b.wholesalePrice} onChange={(v) => setChan("b2b", { wholesalePrice: v })} w="100%" /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>Commission %</span><Inp value={cset.b2b.commissionPct} onChange={(v) => setChan("b2b", { commissionPct: v })} w="100%" /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>Freight $/u</span><Inp value={cset.b2b.freightPerUnit} onChange={(v) => setChan("b2b", { freightPerUnit: v })} w="100%" /></label>
          </div>
          {b2bPrice > 0 ? (
            <>
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${c.lineSoft}` }}>
                <KV label="Landed cost · costo en destino" value={money2(econ.total)} />
                <KV label="+ Freight to buyer · flete al comprador" value={money2(chEcon.b2b.cogs - econ.total)} />
                <KV label={`+ Commission (${num(cset.b2b.commissionPct)}%) · comisión`} value={money2(chEcon.b2b.fee)} />
              </div>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${c.line}`, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
                <div><div style={S.cap}>All-in cost / unit · costo total/u</div><div style={{ fontSize: 28 }}>{money2(chEcon.b2b.allIn)}</div></div>
                <div style={{ textAlign: "right" }}><div style={S.cap}>Net @ {money2(b2bPrice)} · margen</div><div style={{ fontSize: 16 }}>{money2(chEcon.b2b.net)} · <span style={{ color: mColor(chEcon.b2b.margin) }}>{pct(chEcon.b2b.margin)}</span></div></div>
              </div>
            </>
          ) : (
            <div style={{ marginTop: 12, fontSize: 12, color: c.sub, fontStyle: "italic" }}>
              Enter a wholesale price to see B2B economics — typically about half of retail.
              <div style={faintEs}>Ingresa un precio de mayoreo para ver la economía B2B — normalmente cerca de la mitad del precio de venta.</div>
            </div>
          )}
        </div>

      </div>
      <div style={{ fontSize: 11.5, color: c.sub, fontStyle: "italic", marginTop: 10 }}>
        Same product, same landed cost — the gap between the margins is pure channel economics: Amazon's referral + FBA, Shopify's processing + shipping, and B2B's lower wholesale price. Margin waterfall, inventory carrying cost, and the launch simulator come next.
        <div style={faintEs}>Mismo producto, mismo costo en destino — la diferencia entre los márgenes es pura economía de canal: comisión + FBA de Amazon, procesamiento + envío de Shopify, y el precio de mayoreo más bajo de B2B. Cascada de márgenes, costo de mantener inventario y el simulador de lanzamiento vienen después.</div>
      </div>

      {/* MARGIN WATERFALL (Phase 3) — where each dollar of price goes */}
      <div style={S.sec}>Margin Waterfall — where each dollar of price goes<div style={faintEs}>Cascada de márgenes — a dónde va cada dólar del precio</div></div>
      <div style={S.panel}>
        <Waterfall title="Amazon (FBA)" price={econ.retail} rows={[
          { label: "Landed", v: econ.total, color: c.clay },
          { label: "FBA + storage", v: chEcon.az.cogs - econ.total, color: c.gold },
          { label: "Referral", v: chEcon.az.fee, color: "#cbbfa6" },
          { label: "Net", v: chEcon.az.net, color: mColor(chEcon.az.margin) },
        ]} />
        <Waterfall title="Shopify (D2C)" price={econ.retail} rows={[
          { label: "Landed", v: econ.total, color: c.clay },
          { label: "Shipping", v: chEcon.sh.cogs - econ.total, color: c.gold },
          { label: "Processing", v: chEcon.sh.fee, color: "#cbbfa6" },
          { label: "Net", v: chEcon.sh.net, color: mColor(chEcon.sh.margin) },
        ]} />
        {b2bPrice > 0 && <Waterfall title="B2B / Wholesale" price={b2bPrice} rows={[
          { label: "Landed", v: econ.total, color: c.clay },
          { label: "Freight", v: chEcon.b2b.cogs - econ.total, color: c.gold },
          { label: "Commission", v: chEcon.b2b.fee, color: "#cbbfa6" },
          { label: "Net", v: chEcon.b2b.net, color: mColor(chEcon.b2b.margin) },
        ]} />}
        {!(econ.retail > 0) && <div style={{ fontSize: 12, color: c.sub, fontStyle: "italic" }}>Set a retail price to see the waterfall. · Fija un precio de venta para ver la cascada.</div>}
        <div style={{ fontSize: 11.5, color: c.sub, fontStyle: "italic", marginTop: 12 }}>
          Each bar is one unit's price, broken into where the money goes. The green slice on the right is what you keep — the shorter it is, the more the channel is eating.
          <div style={faintEs}>Cada barra es el precio de una unidad, dividido en a dónde va el dinero. La franja verde de la derecha es lo que retienes — entre más corta, más se lleva el canal.</div>
        </div>
      </div>

      {/* AD HEADROOM (Phase 3) — break-even & target ROAS */}<div style={S.sec}>Ad Headroom — break-even & target ROAS<div style={faintEs}>Margen para anuncios — equilibrio y ROAS meta</div></div>
      <div style={S.panel}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>Keep this net margin after ads · margen tras anuncios</span><Inp value={tgtPct} onChange={(v) => setProd(product.id, { targetMarginAfterAds: v })} w={90} /></label>
          <div style={{ flex: 1, minWidth: 220, fontSize: 11.5, color: c.sub, fontStyle: "italic" }}>
            Break-even ROAS is where ad spend swallows all your contribution. To still keep the margin above, your real ROAS must beat the Min ROAS below.
            <div style={faintEs}>El ROAS de equilibrio es donde el gasto en anuncios se come toda tu contribución. Para conservar el margen de arriba, tu ROAS real debe superar el ROAS mínimo de abajo.</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))", gap: 16, marginTop: 14 }}>
          {[
            { name: "Amazon (FBA)", net: chEcon.az.net, margin: chEcon.az.margin, beRoas: chEcon.az.beRoas, tAcos: azTgtAcos, tRoas: azTgtRoas },
            { name: "Shopify (D2C)", net: chEcon.sh.net, margin: chEcon.sh.margin, beRoas: chEcon.sh.beRoas, tAcos: shTgtAcos, tRoas: shTgtRoas },
          ].map((x) => (
            <div key={x.name}>
              <div style={{ fontSize: 15, marginBottom: 8 }}>{x.name}</div>
              <KV label="Contribution / unit (pre-ads) · contribución/u" value={money2(x.net)} strong />
              <KV label="Break-even ACOS · ACOS equilibrio" value={econ.retail > 0 ? acosFmt(x.margin) : "—"} />
              <KV label="Break-even ROAS · ROAS equilibrio" value={roasFmt(x.beRoas)} />
              <div style={{ borderTop: `1px solid ${c.lineSoft}`, marginTop: 8, paddingTop: 8 }}>
                <KV label={`Max ACOS to keep ${tgtPct}% · ACOS máx`} value={x.tAcos > 0 ? acosFmt(x.tAcos) : "can't · imposible"} />
                <KV label={`Min ROAS to keep ${tgtPct}% · ROAS mín`} value={roasFmt(x.tRoas)} strong />
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: c.sub, fontStyle: "italic", marginTop: 12 }}>
          Example: a 2.50× break-even ROAS means every $1 of ad spend must bring back $2.50 in sales just to not lose money on that unit.
          <div style={faintEs}>Ejemplo: un ROAS de equilibrio de 2.50× significa que cada $1 de gasto en anuncios debe traer $2.50 en ventas solo para no perder dinero en esa unidad.</div>
        </div>
      </div>

      {/* B2B / FAIRE AD HEADROOM (Phase 3) — account-LTV break-even */}
      <div style={S.sec}>B2B / Faire Ad Headroom — account-lifetime break-even<div style={faintEs}>Margen para anuncios B2B / Faire — equilibrio por vida de la cuenta</div></div>
      <div style={S.panel}>
        {b2bPrice > 0 ? (
          <>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>Orders per account (lifetime) · órdenes por cuenta</span><Inp value={cset.b2b.ordersPerAccount} onChange={(v) => setChan("b2b", { ordersPerAccount: v })} w={90} /></label>
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}><span style={S.cap}>Reorder commission % · comisión recompra</span><Inp value={cset.b2b.reorderCommissionPct} onChange={(v) => setChan("b2b", { reorderCommissionPct: v })} w={90} /></label>
              <div style={{ flex: 1, minWidth: 220, fontSize: 11.5, color: c.sub, fontStyle: "italic" }}>
                Faire usually charges more on the first order and less on reorders — set the first-order rate in the B2B card above, and the reorder rate here.
                <div style={faintEs}>Faire suele cobrar más en la primera orden y menos en recompras — fija la tasa de la primera orden en la tarjeta B2B de arriba, y la de recompra aquí.</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))", gap: 16, marginTop: 14 }}>
              <div>
                <div style={{ fontSize: 15, marginBottom: 8 }}>Contribution per account · contribución</div>
                <KV label="First-order contribution · 1ª orden" value={money2(b2bContribFirst)} strong />
                <KV label="Each reorder · cada recompra" value={money2(b2bContribReorder)} />
                <KV label={`Lifetime over ${b2bOrders} orders · de por vida`} value={money2(b2bLtvContrib)} strong />
              </div>
              <div>
                <div style={{ fontSize: 15, marginBottom: 8 }}>Break-even ROAS · ROAS equilibrio</div>
                <KV label="First order only (worst case) · solo 1ª orden" value={roasFmt(b2bBeRoasFirst)} />
                <KV label="Across account lifetime (real bar) · vida de cuenta" value={roasFmt(b2bBeRoasLtv)} strong />
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: c.sub, fontStyle: "italic", marginTop: 12 }}>
              {b2bLtvContrib > 0
                ? <>Read it this way: a Faire ad only needs to report a first-order ROAS above {roasFmt(b2bBeRoasLtv)} for the account to pay off over its lifetime — even though a single order in isolation would need {roasFmt(b2bBeRoasFirst)}. The more a retailer reorders, the lower that bar drops.</>
                : <>At these numbers each order loses money even across the account's lifetime, so ads can't fix it — the wholesale price, commission, or landed cost has to change first.</>}
              <div style={faintEs}>{b2bLtvContrib > 0
                ? `Léelo así: un anuncio de Faire solo necesita un ROAS de primera orden por encima de ${roasFmt(b2bBeRoasLtv)} para que la cuenta rinda en su vida — aunque una sola orden aislada necesitaría ${roasFmt(b2bBeRoasFirst)}. Mientras más recompre el minorista, más baja esa barra.`
                : "Con estos números cada orden pierde dinero incluso en la vida de la cuenta, así que los anuncios no lo arreglan — primero debe cambiar el precio de mayoreo, la comisión o el costo en destino."}</div>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: c.sub, fontStyle: "italic" }}>
            Set a wholesale price in the B2B card above to model Faire ad headroom.
            <div style={faintEs}>Ingresa un precio de mayoreo en la tarjeta B2B de arriba para modelar el margen de anuncios de Faire.</div>
          </div>
        )}
      </div>

      {/* BOTTOM LINE — true all-in cost per unit, by channel (ALWAYS LAST) */}
      <div style={{ ...S.panel, marginTop: 14, borderLeft: `3px solid ${c.gold}` }}>
        <div style={S.cap}>Bottom line — true all-in cost per unit, by channel</div>
        <div style={faintEs}>Costo total real por unidad, por canal</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 16, marginTop: 10 }}>
          {[
            { key: "az", l: "Amazon (FBA)", allIn: chEcon.az.allIn, net: chEcon.az.net, m: chEcon.az.margin, price: econ.retail, show: econ.retail > 0 },
            { key: "sh", l: "Shopify (D2C)", allIn: chEcon.sh.allIn, net: chEcon.sh.net, m: chEcon.sh.margin, price: econ.retail, show: econ.retail > 0 },
            { key: "b2b", l: "B2B / Wholesale", allIn: chEcon.b2b.allIn, net: chEcon.b2b.net, m: chEcon.b2b.margin, price: b2bPrice, show: b2bPrice > 0 },
          ].map((x) => (
            <div key={x.key}>
              <div style={{ display: "flex", gap: 7, alignItems: "baseline" }}><span style={{ fontFamily: sans, fontSize: 12.5, color: c.sub }}>{x.l}</span>{bestCh === x.key && <span style={{ fontFamily: sans, fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", color: c.gold }}>✦ keeps most · retiene más</span>}</div>
              <div style={{ fontSize: 32, marginTop: 2 }}>{money2(x.allIn)}</div>
              <div style={{ fontSize: 12.5, color: c.sub, marginTop: 2 }}>{x.show ? <>leaves {money2(x.net)} net · <span style={{ color: mColor(x.m) }}>{pct(x.m)}</span> margin at {money2(x.price)} · deja neto</> : "set a price · define un precio"}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
