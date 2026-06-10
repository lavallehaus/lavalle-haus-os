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
  <input type={type} value={value === null || value === undefined ? "" : value} placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
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

/* ============================================================================
   MAIN
   ========================================================================== */const S = {
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
                  <td style={{ ...S.td, color: c.ink }}>{money2(pu)}</td>
                  <td style={S.td}><button onClick={() => delLine(section, l.id)} style={{ cursor: "pointer", border: "none", background: "transparent", color: c.sub, fontSize: 16 }}>×</button></td>
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

  const touch = () => setDirty(true);
  const setProd = (id, patch) => { setProds((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p))); touch(); };
  const setLine = (section, lineId, patch) =>
    setProds((prev) => prev.map((p) => p.id !== active ? p : { ...p, [section]: p[section].map((l) => (l.id === lineId ? { ...l, ...patch } : l)) })) && touch();
  const editLine = (section, lineId, patch) => { setProds((prev) => prev.map((p) => p.id !== active ? p : { ...p, [section]: (p[section] || []).map((l) => (l.id === lineId ? { ...l, ...patch } : l)) })); touch(); };
  const addLine = (section) => { setProds((prev) => prev.map((p) => { if (p.id !== active) return p; const blank = section === "labor" ? { id: uid("l"), name: "", nameEs: "", hours: 0, basis: "batch" } : { id: uid("m"), name: "", nameEs: "", qty: 1, unitCost: 0, uom: "unit", basis: section === "materials" ? "batch" : "unit" }; return { ...p, [section]: [...(p[section] || []), blank] }; })); touch(); };
  const delLine = (section, lineId) => { setProds((prev) => prev.map((p) => p.id !== active ? p : { ...p, [section]: (p[section] || []).filter((l) => l.id !== lineId) })); touch(); };

  const addProduct = () => {
    const id = prods.reduce((mx, p) => Math.max(mx, Number(p.id) || 0), 0) + 1;
    const np = { id, name: "New product", nameEs: "Producto nuevo", sku: "", retail: 0, batchYield: 1, materials: [], packaging: [], shipping: [], labor: [] };
    setProds((prev) => [...prev, np]); setActive(id); touch();
  };
  const delProduct = () => { if (prods.length <= 1) return; const next = prods.filter((p) => p.id !== active); setProds(next); setActive(next[0].id); touch(); };
  const save = () => { onSave?.({ products: prods, laborRate: rate }); setDirty(false); };

  if (!product) return null;
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
      <Section title="Shipping / Freight" titleEs="Envío / Flete" section="shipping" isLabor={false} product={product} rate={rate} editLine={editLine} addLine={addLine} delLine={delLine} />
      <Section title="Labor — production steps" titleEs="Mano de obra — pasos de producción" section="labor" isLabor={true} product={product} rate={rate} editLine={editLine} addLine={addLine} delLine={delLine} />

      {/* TRUE COST ROLL-UP (the Bezos lens) */}
      <div style={S.sec}>True Cost Per Unit<div style={faintEs}>Costo real por unidad</div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12 }}>
        {[
          { l: "Materials", le: "Materiales", v: econ.materials },
          { l: "Packaging", le: "Empaque", v: econ.packaging },
          { l: "Shipping", le: "Envío", v: econ.shipping },{ l: "Labor", le: "Mano de obra", v: econ.labor, note: `${econ.totalHours.toFixed(2)} hrs/unit @ ${money2(rate)}/hr` },
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
          <div><div style={S.cap}>Total COGS / unit · costo total/u</div><div style={{ fontSize: 30 }}>{money2(econ.total)}</div></div>
          <div style={{ textAlign: "right" }}>
            <div style={S.cap}>At {money2(econ.retail)} retail · margin · margen</div>
            <div style={{ fontSize: 26, color: marginColor }}>{econ.retail > 0 ? pct(econ.margin) : "—"}</div>
            <div style={{ fontSize: 12, color: c.sub }}>{econ.retail > 0 ? `keeps ${money2(econ.retail - econ.total)}/unit · retiene/u` : "set a retail price"}</div>
          </div>
        </div>
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
          <div style={S.cap}>Working backwards — max COGS the price can carry · COGS máximo que soporta el precio</div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 8 }}>
            {[0.5, 0.6, 0.7].map((m) => { const maxc = econ.retail * (1 - m); const ok = econ.total <= maxc;
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
    </div>
  );
}
