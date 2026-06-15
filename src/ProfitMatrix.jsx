import { useState, useMemo, Fragment } from "react";

/* ============================================================================
   LAVALLE HAUS OS — PROFIT MATRIX  (channel P&L edition)
   Weekly founder operating system & decision cockpit.

       <ProfitMatrix data={data} onSave={(payload) => persist(payload)} />

   data   = { products:[...], opex:[...], profitAdjustments:{...} }
   onSave = called with { products, opex, adjustments }. Wire it to POST your
            full Redis object back to api/data.js.

   CHANNEL MODEL (per your operations):
   - Amazon  : FBA inventory pool, Amazon referral + FBA fees, Amazon PPC.
   - Shopify : own on-hand inventory, Shopify processing + shipping, Meta/PPC,
               plus UGC/influencer marketing (gifting + agencies) as OPEX.
   - B2B     : Atlas CONSIGNMENT inventory (still your asset until sold),
               3% Atlas commission per sale, $1,700/quarter placement fee (OPEX).

   Headline tiles are CLICKABLE -> line-by-line attribution + editable cells for
   the bi-monthly audit, with a manual reconciliation field per metric.
   ========================================================================== */

const c = {
  bg:"#f7f4ef", panel:"#fffdf9", ink:"#2b2620", sub:"#6f6657",
  line:"#e4ddd0", lineSoft:"#efe9de", sage:"#6b7257", clay:"#a8643c", gold:"#b08d57",
  green:"#5c7a52", yellow:"#b78b2e", red:"#a8483a",
};
const serif = "'IM Fell English', Georgia, 'Times New Roman', serif";
const sans  = "'IM Fell English', Georgia, serif";
const faintEs = { fontFamily:sans, fontSize:10.5, fontStyle:"italic", color:"rgba(111,102,87,0.6)", marginTop:1, lineHeight:1.3, fontWeight:400, letterSpacing:0, textTransform:"none" };

const FEES = { amazonReferralPct:0.15, shopifyProcessingPct:0.029, shopifyProcessingFlat:0.3, returnsPct:0.02 };
const B2B = { atlasCommissionPct:0.03, atlasPlacementPerQuarter:1700 };
const ATLAS_WEEKLY = +(B2B.atlasPlacementPerQuarter / 13).toFixed(2); // $130.77/wk

/* ---- SEED PRODUCTS (real SKUs; channel-split inventory) ----------------- */
const SEED_PRODUCTS = [
  { id:1, name:"SeaShell Vessel Candle", sku:"RH-SeaShell-9633", asin:"B0GR8452CL",
    channels:["amazon","shopify","b2b"], retail:48, wholesale:24, cogs:8.5, packaging:2.0, freight:1.5,
    shipShopify:5.0, fbaFee:5.5, storage:0.4, ad:{amazon:6,shopify:4},
    units:{amazon:2,shopify:3,b2b:1}, prev:{amazon:1,shopify:2,b2b:0},
    inv:{amazon:30,shopify:8,b2b:5}, inbound:200, leadWeeks:4, reorderLink:"https://refilleryhaus.myshopify.com" },
  { id:2, name:"Beeswax Candle Sand 16oz", sku:"RH-Sandwax-AC-16c", asin:"B0GR1NWNG8",
    channels:["amazon","shopify"], retail:22, wholesale:11, cogs:3.7, packaging:1.0, freight:0.8,
    shipShopify:4.0, fbaFee:4.2, storage:0.25, ad:{amazon:3,shopify:2},
    units:{amazon:4,shopify:2,b2b:0}, prev:{amazon:5,shopify:2,b2b:0},
    inv:{amazon:40,shopify:20,b2b:0}, inbound:0, leadWeeks:3, reorderLink:"" },
  { id:3, name:"Beeswax Candle Sand 32oz", sku:"RH-Sandwax-AC-32c", asin:"B0GR1KQ253",
    channels:["amazon"], retail:34, wholesale:17, cogs:6.1, packaging:1.2, freight:1.2,
    shipShopify:6.0, fbaFee:5.8, storage:0.4, ad:{amazon:4,shopify:0},
    units:{amazon:3,shopify:0,b2b:0}, prev:{amazon:2,shopify:0,b2b:0},
    inv:{amazon:30,shopify:0,b2b:0}, inbound:0, leadWeeks:3, reorderLink:"" },
  { id:4, name:"Small Apple Vanilla Candle", sku:"RH-CANDLE-SM-AP", asin:"B0FVGM15JB",
    channels:["amazon","shopify","b2b"], retail:18, wholesale:9, cogs:2.9, packaging:0.9, freight:0.7,
    shipShopify:4.0, fbaFee:3.9, storage:0.2, ad:{amazon:4,shopify:2},
    units:{amazon:3,shopify:1,b2b:0}, prev:{amazon:4,shopify:1,b2b:0},
    inv:{amazon:15,shopify:10,b2b:0}, inbound:0, leadWeeks:3, reorderLink:"" },
  { id:5, name:"Large Apple Vanilla Candle", sku:"RH-CANDLE-LG-AP", asin:"B0FVGM15J7",
    channels:["amazon","shopify"], retail:32, wholesale:16, cogs:5.8, packaging:1.1, freight:1.1,
    shipShopify:5.5, fbaFee:5.5, storage:0.35, ad:{amazon:7,shopify:3},
    units:{amazon:1,shopify:1,b2b:0}, prev:{amazon:2,shopify:1,b2b:0},
    inv:{amazon:10,shopify:8,b2b:0}, inbound:0, leadWeeks:3, reorderLink:"" },
  { id:8, name:"Vanilla Cashmere Sugar Scrub", sku:"LH-SCRUB-VC", asin:"TBD",
    channels:["shopify","b2b"], retail:24, wholesale:12, cogs:4.2, packaging:1.2, freight:0.6,
    shipShopify:4.0, fbaFee:0, storage:0, ad:{amazon:0,shopify:3},
    units:{amazon:0,shopify:4,b2b:1}, prev:{amazon:0,shopify:2,b2b:0},
    inv:{amazon:0,shopify:40,b2b:10}, inbound:0, leadWeeks:4, reorderLink:"" },
  { id:7, name:"Dough Bowl Vessel Candle", sku:"RH-DoughBowl", asin:"TBD",
    channels:["shopify","b2b"], retail:58, wholesale:29, cogs:10.0, packaging:2.5, freight:2.0,
    shipShopify:7.0, fbaFee:0, storage:0, ad:{amazon:0,shopify:5},
    units:{amazon:0,shopify:2,b2b:0}, prev:{amazon:0,shopify:1,b2b:0},
    inv:{amazon:0,shopify:18,b2b:4}, inbound:0, leadWeeks:4, reorderLink:"" },
];

/* ---- SEED CHANNEL MARKETING / OPERATING EXPENSES (weekly, editable) -----
   Derived loosely from the marketing ledger. These are NON per-unit costs —
   product PPC lives in each product's ad/unit. EDIT THESE to your actuals.   */
const SEED_OPEX = [
  { id:"o1", label:"UGC / influencer product gifting", category:"UGC", channel:"shopify", weekly:25 },
  { id:"o2", label:"Influencer agencies (Memmermedia, Courtney Social)", category:"Influencer", channel:"shopify", weekly:150 },
  { id:"o3", label:"Content / video production (Giggster, studio)", category:"Content", channel:"shopify", weekly:75 },
  { id:"o4", label:"Amazon promotions / FBA gifting", category:"Promo", channel:"amazon", weekly:20 },
  { id:"o5", label:"Atlas placement fee ($1,700 / quarter)", category:"Placement", channel:"b2b", weekly:ATLAS_WEEKLY },
];
const OPEX_CATS = ["UGC","Influencer","Content","Promo","Placement","Other"];
const OPEX_CAT_ES = { UGC:"Contenido de creadores", Influencer:"Influencers", Content:"Contenido", Promo:"Promoción", Placement:"Colocación", Other:"Otro" };
const TEAM = [
  { name:"Kiabeth", email:"kiabethmgmt@gmail.com" },
  { name:"Tommy", email:"tommylavalleesp@gmail.com" },
  { name:"Kiaredza", email:"kiaredza@gmail.com" },
];

const CHANNELS = [
  { id:"shopify", label:"Shopify" }, { id:"amazon", label:"Amazon" },
  { id:"b2b", label:"B2B / Wholesale" }, { id:"all", label:"All Channels" },
];
const PERIODS = [
  { id:"current", label:"This Week", mult:1 }, { id:"previous", label:"Last Week", mult:1 },
  { id:"last4", label:"Last 4 Weeks", mult:4 }, { id:"qtd", label:"Quarter to Date", mult:13 },
  { id:"ytd", label:"Year to Date", mult:52 },
];
const periodMult = (per) => (per === "previous" ? 1 : (PERIODS.find((x) => x.id === per)?.mult ?? 1));

/* ---- MATH --------------------------------------------------------------- */
const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? 0 : Number(v));
const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const money2 = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toFixed(2);
const pct = (n) => (n * 100).toFixed(1) + "%";
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const unitCost = (p) => num(p.cogs) + num(p.packaging) + num(p.freight);

function unitEconomics(p, ch) {
  const landed = unitCost(p);
  if (ch === "amazon") {
    const price = num(p.retail);
    const fees = price * FEES.amazonReferralPct + num(p.fbaFee) + num(p.storage);
    const returns = price * FEES.returnsPct;
    return { price, landed, fees, ship:0, returns, commission:0, cm: price - landed - fees - returns, ad: num(p.ad?.amazon) };
  }
  if (ch === "shopify") {
    const price = num(p.retail);
    const fees = price * FEES.shopifyProcessingPct + FEES.shopifyProcessingFlat;
    const returns = price * FEES.returnsPct;
    return { price, landed, fees, ship: num(p.shipShopify), returns, commission:0, cm: price - landed - fees - num(p.shipShopify) - returns, ad: num(p.ad?.shopify) };
  }
  // b2b — Atlas takes 3% commission per sale
  const price = num(p.wholesale);
  const commission = price * B2B.atlasCommissionPct;
  return { price, landed, fees:commission, ship:0, returns:0, commission, cm: price - landed - commission, ad:0 };
}

const unitsFor = (p, ch, per) => {
  const src = per === "previous" ? p.prev : p.units;
  const m = periodMult(per);
  if (ch === "all") return ["amazon","shopify","b2b"].reduce((s, k) => s + num(src?.[k]), 0) * m;
  return num(src?.[ch]) * m;
};
const invFor = (p, ch) => {
  const i = p.inv || {};
  if (ch === "all") return num(i.amazon) + num(i.shopify) + num(i.b2b);
  return num(i[ch]);
};

function metrics(p, ch, per) {
  const chans = ch === "all" ? ["amazon","shopify","b2b"] : [ch];
  let revenue=0, gross=0, net=0, adSpend=0, units=0, cmW=0, commission=0;
  chans.forEach((k) => {
    if (!p.channels.includes(k)) return;
    const u = unitsFor(p, k, per), e = unitEconomics(p, k);
    revenue += e.price*u; gross += (e.price-e.landed)*u; net += e.cm*u;
    adSpend += e.ad*u; units += u; cmW += e.cm*u; commission += e.commission*u;
  });
  const netAfterAds = net - adSpend;
  const profitPerUnit = units ? netAfterAds/units : 0;
  const cmPerUnit = units ? cmW/units : 0;
  const avgPrice = units ? revenue/units : 0;
  const cmPct = avgPrice ? cmPerUnit/avgPrice : 0;
  const netMargin = revenue ? netAfterAds/revenue : 0;
  const grossMargin = revenue ? gross/revenue : 0;
  const breakevenRoas = cmPerUnit > 0 ? avgPrice/cmPerUnit : Infinity;
  const adPerUnit = units ? adSpend/units : 0;
  const roas = adPerUnit > 0 ? avgPrice/adPerUnit : null;
  const inv = invFor(p, ch);
  const velocity = unitsFor(p, ch, "current") || 0.0001;
  const weeksRemaining = inv / velocity;
  const invValue = inv * unitCost(p);
  const stockout = new Date(Date.now() + weeksRemaining*7*86400000);
  const reorderPoint = Math.ceil(velocity * (num(p.leadWeeks)+2));
  const reorderQty = Math.max(reorderPoint, Math.ceil(velocity*8));
  const cashForReorder = reorderQty * unitCost(p);
  return { revenue, gross, net, netAfterAds, adSpend, units, commission, profitPerUnit, cmPerUnit,
    cmPct, netMargin, grossMargin, breakevenRoas, roas, maxCPA:cmPerUnit, velocity,
    inv, weeksRemaining, invValue, stockout, reorderPoint, reorderQty, cashForReorder };
}

const opexTotal = (opex, ch, per) =>
  opex.filter((o) => ch === "all" || o.channel === ch).reduce((s, o) => s + num(o.weekly), 0) * periodMult(per);

function scoreOf(m) {
  const marginScore = clamp(m.netMargin/0.35, 0, 1);
  const cmScore = clamp(m.cmPct/0.55, 0, 1);
  const velocityScore = m.weeksRemaining<2?0.35:m.weeksRemaining<=10?1:m.weeksRemaining<=16?0.7:0.4;
  const roasScore = m.roas==null?0.6:m.breakevenRoas===Infinity?0:clamp(m.roas/(m.breakevenRoas*1.8),0,1);
  const profitScore = clamp(m.netAfterAds/30,-1,1)*0.5+0.5;
  return Math.round(clamp(marginScore*0.28+cmScore*0.22+velocityScore*0.18+roasScore*0.2+profitScore*0.12,0,1)*100);
}
function decide(m, sc) {
  if (m.units === 0) return { tag:"Watch", color:c.sub, why:"No sales this period — not enough signal to act." };
  if (m.netAfterAds <= 0 && m.weeksRemaining > 12) return { tag:"Eliminate", color:c.red, why:`Losing ${money2(Math.abs(m.profitPerUnit))}/unit after ads with ${m.weeksRemaining.toFixed(0)}+ weeks of stock tied up. Stop reordering.` };
  if (m.netAfterAds <= 0) return { tag:"Fix", color:c.red, why:`Unprofitable after ads (${money2(m.profitPerUnit)}/unit). Cut ad spend or raise price — break-even ROAS is ${m.breakevenRoas===Infinity?"—":m.breakevenRoas.toFixed(1)+"x"}.` };
  if (m.roas != null && m.roas < m.breakevenRoas) return { tag:"Fix", color:c.yellow, why:`ROAS ${m.roas.toFixed(1)}x below break-even ${m.breakevenRoas.toFixed(1)}x — ads erode the margin.` };
  if (sc >= 72 && m.weeksRemaining > 3) return { tag:"Scale", color:c.green, why:`${pct(m.netMargin)} net margin${m.roas?`, ${m.roas.toFixed(1)}x ROAS`:""}, healthy stock. Push more spend & inventory.` };
  if (m.netMargin >= 0.2) return { tag:"Maintain", color:c.sage, why:`Solid ${pct(m.netMargin)} net margin. Keep steady, protect the stock.` };
  return { tag:"Watch", color:c.gold, why:`Thin ${pct(m.netMargin)} net margin. Small cost or price moves swing this either way.` };
}

function crossWhy(p, period) {
  const vals = [{ id:"shopify", n:"Shopify" }, { id:"amazon", n:"Amazon" }, { id:"b2b", n:"B2B" },
  ].filter(x=>p.channels.includes(x.id)).map(x=>{ const m=metrics(p,x.id,period); return { ...x, v:m.netAfterAds, u:m.units, pu:m.profitPerUnit }; });
  if (vals.length<=1) { const only=vals[0];
    return { en:`sold only on ${only?only.n:"no channel"} — there's no cross-channel comparison until it's listed elsewhere.`,
      es:`se vende solo en ${only?only.n:"ningún canal"} — no hay comparación entre canales hasta listarlo en otro lugar.` };
  }
  const best=vals.reduce((a,b)=>b.v>a.v?b:a), weak=vals.reduce((a,b)=>b.v<a.v?b:a);
  let drvEn, drvEs;
  if (best.u > weak.u*1.4) { drvEn=`${best.n} simply sells more units (${best.u.toFixed(0)} vs ${weak.u.toFixed(0)}/wk)`; drvEs=`${best.n} vende más unidades (${best.u.toFixed(0)} vs ${weak.u.toFixed(0)}/sem)`; }
  else if (best.pu > weak.pu*1.1) { drvEn=`${best.n} keeps more per unit (${money2(best.pu)} vs ${money2(weak.pu)})`; drvEs=`${best.n} retiene más por unidad (${money2(best.pu)} vs ${money2(weak.pu)})`; }
  else { drvEn=`${best.n} wins on the mix of volume and per-unit profit`; drvEs=`${best.n} gana por la mezcla de volumen y ganancia por unidad`; }
  const fee = (id)=> id==="b2b" ? { en:"B2B is wholesale (~half retail) minus the 3% Atlas commission", es:"B2B es mayoreo (~mitad del precio) menos la comisión Atlas del 3%" }
    : id==="amazon" ? { en:"Amazon carries FBA + a 15% referral fee", es:"Amazon carga FBA + 15% de comisión de referencia" }
    : { en:"Shopify carries shipping on every order", es:"Shopify carga el envío en cada pedido" };
  const wf=fee(weak.id);
  return { en:`best on ${best.n} (${money(best.v)}/wk), weakest ${weak.n} (${money(weak.v)}/wk) — ${drvEn}; ${wf.en}.`,
    es:`mejor en ${best.n} (${money(best.v)}/sem), más débil ${weak.n} (${money(weak.v)}/sem) — ${drvEs}; ${wf.es}.` };
}

function normalize(list) {
  return (list && list.length ? list : SEED_PRODUCTS).map((p) => {
    const channels = p.channels || ["amazon","shopify"];
    const inv = p.inv && typeof p.inv === "object" ? { ...p.inv }
      : (() => { const o = { amazon:0, shopify:0, b2b:0 }; o[channels[0]] = num(p.inventory ?? p.inventoryOnHand ?? 0); return o; })();
    return { ...p, channels, inv,
      ad: p.ad && typeof p.ad === "object" ? { ...p.ad } : { amazon:p.adSpend||0, shopify:p.adSpend||0 },
      units: p.units && typeof p.units === "object" ? { ...p.units } : { amazon:p.unitsSold||0, shopify:0, b2b:0 },
      prev: p.prev ? { ...p.prev } : { amazon:0, shopify:0, b2b:0 },
      retail:p.retail??p.price??0, wholesale:p.wholesale??(p.retail??p.price??0)/2,
      packaging:p.packaging??0, freight:p.freight??0, shipShopify:p.shipShopify??p.shipping??0,
      fbaFee:p.fbaFee??0, storage:p.storage??0, inbound:p.inbound??0, leadWeeks:p.leadWeeks??3,
      dates: (p.dates && typeof p.dates==="object") ? { ...p.dates } : { amazon:p.date||"", shopify:p.date||"", b2b:p.date||"" } };
  });
}

/* ---- PRIMITIVES --------------------------------------------------------- */
const Dot = ({ level }) => <span style={{ display:"inline-block", width:9, height:9, borderRadius:9, background: level==="green"?c.green:level==="yellow"?c.yellow:c.red, marginRight:7, verticalAlign:"middle" }} />;
function Delta({ now, prev }) {
  if (prev === 0 && now === 0) return <span style={{ color:c.sub, fontSize:12 }}>—</span>;
  const d = prev === 0 ? 1 : (now-prev)/Math.abs(prev); const up = now >= prev;
  return <span style={{ fontSize:12, color: up?c.green:c.red }}>{up?"▲":"▼"} {Math.abs(d*100).toFixed(0)}% wow</span>;
}
const Tag = ({ text, color }) => <span style={{ fontFamily:sans, fontSize:11.5, letterSpacing:0.4, textTransform:"uppercase", color, border:`1px solid ${color}`, borderRadius:2, padding:"2px 8px", whiteSpace:"nowrap" }}>{text}</span>;
const Edit = ({ value, onChange, disabled, w=74 }) => <input type="number" value={value} disabled={disabled} onChange={(e)=>onChange(e.target.value)} style={{ width:w, fontFamily:sans, fontSize:13, textAlign:"right", padding:"4px 6px", border:`1px solid ${disabled?c.lineSoft:c.line}`, borderRadius:2, background:disabled?c.bg:c.panel, color:disabled?c.sub:c.ink }} />;

/* ---- AUDIT DRAWERS ------------------------------------------------------ */
const CFG = {
  revenue: { title:"Revenue", cols:["units","price"], line:(e,u)=>e.price*u },
  gross:   { title:"Gross Profit", cols:["units","price","cogs","packaging","freight"], line:(e,u)=>(e.price-e.landed)*u },
  net:     { title:"Net Profit (before ads & marketing)", cols:["units","price","cogs","feesRO","shipRO"], line:(e,u)=>e.cm*u },
  netAfterAds: { title:"Net Profit After Ads & Marketing", cols:["units","netRO","ad"], line:(e,u)=>e.cm*u-e.ad*u, opexSign:-1 },
  marketing: { title:"Weekly Marketing", cols:["units","ad"], line:(e,u)=>e.ad*u, opexSign:+1 },
};
const COL = { units:"Units/wk", price:"Price", cogs:"COGS", packaging:"Pkg", freight:"Freight", feesRO:"Fees", shipRO:"Ship", netRO:"Net/unit", ad:"Ad/unit" };

function AuditDrawer({ metric, channel, products, setField, reassignChannel, opexAmt, adj, setAdj, onSave, onReset, dirty, manualEntries, manualSum, onManualAdd, onManualEdit, onManualDel, onNewProduct }) {
  const cfg = CFG[metric];
  const lines = [];
  products.forEach((p) => {
    const chans = channel==="all" ? p.channels : (p.channels.includes(channel)?[channel]:[]);
    chans.forEach((ch) => { const e = unitEconomics(p, ch); const u = num(p.units?.[ch]); lines.push({ p, ch, e, u, val: cfg.line(e,u) }); });
  });
  const lineSum = lines.reduce((s,l)=>s+l.val,0);
  const opexPart = cfg.opexSign ? cfg.opexSign*opexAmt : 0;
  const total = lineSum + opexPart + num(manualSum) + num(adj);

  const th = { fontFamily:sans, fontSize:10.5, letterSpacing:0.5, textTransform:"uppercase", color:c.sub, padding:"7px 8px", textAlign:"right", borderBottom:`1px solid ${c.line}`, whiteSpace:"nowrap" };
  const td = { fontSize:13, padding:"7px 8px", textAlign:"right", borderBottom:`1px solid ${c.lineSoft}`, whiteSpace:"nowrap" };
  const cell = (l, col) => {
    const { p, ch, e } = l;
    switch (col) {
      case "units": return <Edit value={p.units?.[ch]??0} onChange={(v)=>setField(p.id,"units",v,ch)} w={60} />;
      case "price": return <Edit value={ch==="b2b"?p.wholesale:p.retail} onChange={(v)=>setField(p.id, ch==="b2b"?"wholesale":"retail", v)} />;
      case "cogs": return <Edit value={p.cogs} onChange={(v)=>setField(p.id,"cogs",v)} w={60} />;
      case "packaging": return <Edit value={p.packaging} onChange={(v)=>setField(p.id,"packaging",v)} w={54} />;
      case "freight": return <Edit value={p.freight} onChange={(v)=>setField(p.id,"freight",v)} w={54} />;
      case "ad": return <Edit value={p.ad?.[ch]??0} onChange={(v)=>setField(p.id,"ad",v,ch)} w={60} />;
      case "feesRO": return <span style={{ color:c.sub }}>{money2(e.fees)}</span>;
      case "shipRO": return <span style={{ color:c.sub }}>{money2(e.ship)}</span>;
      case "netRO": return <span style={{ color:c.sub }}>{money2(e.cm)}</span>;
      default: return null;
    }
  };
  return (
    <div style={{ background:c.panel, border:`1px solid ${c.gold}`, borderRadius:4, padding:18, marginTop:12 }}>
      <DrawerHead title={cfg.title} channel={channel} total={total} />
      <div style={{ overflowX:"auto", marginTop:12 }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:560 }}>
          <thead><tr>
            <th style={{ ...th, textAlign:"left" }}>Sale date<div style={faintEs}>Fecha de venta</div></th><th style={{ ...th, textAlign:"left" }}>Product</th><th style={th}>Channel</th>
            {cfg.cols.map((col)=><th key={col} style={th}>{COL[col]}</th>)}
            <th style={th}>=</th>
          </tr></thead>
          <tbody>
            {lines.map((l)=>(
              <tr key={l.p.id+"-"+l.ch}>
                <td style={{ ...td, textAlign:"left" }}><input type="date" value={l.p.dates?.[l.ch]||""} onChange={(ev)=>setField(l.p.id,"dates",ev.target.value,l.ch)} style={{ fontFamily:sans, fontSize:12.5, padding:"4px 6px", border:`1px solid ${c.line}`, borderRadius:2, background:c.panel, color:c.ink }} /></td>
                <td style={{ ...td, textAlign:"left" }}>{l.p.name}</td>
                <td style={{ ...td, textAlign:"left", color:c.sub }}>{l.ch==="b2b"?"B2B":l.ch[0].toUpperCase()+l.ch.slice(1)}</td>
                {cfg.cols.map((col)=><td key={col} style={td}>{cell(l,col)}</td>)}
                <td style={{ ...td, color:l.val>=0?c.ink:c.red }}>{money(l.val)}</td>
              </tr>
            ))}
            {cfg.opexSign && (
              <tr><td colSpan={cfg.cols.length+3} style={{ ...td, textAlign:"left", fontStyle:"italic", color:c.sub }}>
                {cfg.opexSign>0?"+":"−"} Channel marketing / OPEX (UGC, influencer, Atlas — edit below)</td>
                <td style={{ ...td, color:c.sub }}>{money(opexPart)}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <ManualEntries channel={channel} entries={manualEntries||[]} products={products} onAdd={onManualAdd} onEdit={onManualEdit} onDel={onManualDel} onNewProduct={onNewProduct} />
      <DrawerFoot adj={adj} setAdj={setAdj} onSave={onSave} onReset={onReset} dirty={dirty} />
    </div>
  );
}

function InventoryDrawer({ channel, products, setField, reassignChannel, adj, setAdj, onSave, onReset, dirty, manualEntries, manualSum, onManualAdd, onManualEdit, onManualDel, onNewProduct }) {
  const chans = channel==="all" ? ["amazon","shopify","b2b"] : [channel];
  const lines = [];
  products.forEach((p) => chans.forEach((ch) => {
    if (!p.channels.includes(ch)) return;
    const qty = num(p.inv?.[ch]); const val = qty*unitCost(p);
    if (channel!=="all" || qty>0) lines.push({ p, ch, qty, val });
  }));
  const total = lines.reduce((s,l)=>s+l.val,0) + num(manualSum) + num(adj);
  const poolName = { amazon:"Amazon FBA stock", shopify:"Shopify on-hand", b2b:"Atlas consignment", all:"all stock pools" }[channel];
  const th = { fontFamily:sans, fontSize:10.5, letterSpacing:0.5, textTransform:"uppercase", color:c.sub, padding:"7px 8px", textAlign:"right", borderBottom:`1px solid ${c.line}`, whiteSpace:"nowrap" };
  const td = { fontSize:13, padding:"7px 8px", textAlign:"right", borderBottom:`1px solid ${c.lineSoft}`, whiteSpace:"nowrap" };
  return (
    <div style={{ background:c.panel, border:`1px solid ${c.gold}`, borderRadius:4, padding:18, marginTop:12 }}>
      <DrawerHead title={`Inventory Value — ${poolName}`} channel={channel} total={total} note="Inventory is routed by channel: FBA / Shopify on-hand / Atlas consignment. Value = on-hand units × landed cost." />
      <div style={{ overflowX:"auto", marginTop:12 }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:520 }}>
          <thead><tr>
            <th style={{ ...th, textAlign:"left" }}>Product</th><th style={th}>Pool</th>
            <th style={th}>On-hand</th><th style={th}>Landed/unit</th><th style={th}>= Value</th>
          </tr></thead>
          <tbody>
            {lines.map((l)=>(
              <tr key={l.p.id+"-"+l.ch}>
                <td style={{ ...td, textAlign:"left" }}>{l.p.name}{l.ch==="amazon"&&num(l.p.inbound)?<span style={{ color:c.clay, fontSize:11 }}> +{num(l.p.inbound)} inbound</span>:null}</td>
                <td style={{ ...td, textAlign:"left", color:c.sub, textTransform:"capitalize" }}>{l.ch==="b2b"?"Atlas":l.ch}</td>
                <td style={td}><Edit value={l.p.inv?.[l.ch]??0} onChange={(v)=>setField(l.p.id,"inv",v,l.ch)} w={62} /></td>
                <td style={{ ...td, color:c.sub }}>{money2(unitCost(l.p))}</td>
                <td style={td}>{money(l.val)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ManualEntries channel={channel} entries={manualEntries||[]} products={products} onAdd={onManualAdd} onEdit={onManualEdit} onDel={onManualDel} onNewProduct={onNewProduct} />
      <DrawerFoot adj={adj} setAdj={setAdj} onSave={onSave} onReset={onReset} dirty={dirty} adjLabel="Manual adjustment (shrinkage, in-transit)" />
    </div>
  );
}

const DrawerHead = ({ title, channel, total, note }) => (
  <div>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", flexWrap:"wrap", gap:8 }}>
      <div style={{ fontSize:18 }}>{title}</div>
      <div style={{ textAlign:"right" }}>
        <div style={{ fontSize:11, fontFamily:sans, letterSpacing:0.6, textTransform:"uppercase", color:c.sub }}>Weekly total · {CHANNELS.find(x=>x.id===channel)?.label}</div>
        <div style={{ fontSize:22 }}>{money(total)}</div>
      </div>
    </div>
    <div style={{ fontSize:12, color:c.sub, fontStyle:"italic", marginTop:2 }}>{note || "Weekly per-line detail. Edit any value to audit; it recomputes across the tab."}</div>
  </div>
);
const DrawerFoot = ({ adj, setAdj, onSave, onReset, dirty, adjLabel }) => (
  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12, marginTop:14, paddingTop:12, borderTop:`1px solid ${c.line}` }}>
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <span style={{ fontFamily:sans, fontSize:11, letterSpacing:0.5, textTransform:"uppercase", color:c.sub }}>{adjLabel || "Manual audit adjustment (±)"}</span>
      <Edit value={adj} onChange={setAdj} w={90} />
    </div>
    <div style={{ display:"flex", gap:8 }}>
      <button onClick={onReset} style={{ fontFamily:sans, fontSize:13, cursor:"pointer", padding:"7px 16px", borderRadius:2, border:`1px solid ${c.line}`, background:"transparent", color:c.sub }}>Reset</button>
      <button onClick={onSave} style={{ fontFamily:sans, fontSize:13, cursor:"pointer", padding:"7px 18px", borderRadius:2, border:`1px solid ${c.ink}`, background:dirty?c.ink:c.sub, color:c.bg }}>{dirty?"Save audit":"Saved"}</button>
    </div>
  </div>
);

const manualLineValue = (e) => num(e.price) * num(e.qty == null || e.qty === "" ? 1 : e.qty);

function ManualEntries({ channel, entries, products, onAdd, onEdit, onDel, onNewProduct }) {
  const include = (e) => channel === "all" || e.channel === "all" || e.channel === channel;
  const shown = entries.filter(include);
  const base = { fontFamily:sans, fontSize:13, padding:"5px 8px", border:`1px solid ${c.line}`, borderRadius:2, background:c.panel, color:c.ink };
  const sel = { ...base, fontSize:12.5 };
  const cap = { fontFamily:sans, fontSize:9.5, letterSpacing:0.5, textTransform:"uppercase", color:c.sub, marginBottom:3 };
  const priceFor = (p, ch) => (p ? (ch === "b2b" ? num(p.wholesale) : num(p.retail)) : 0);
  const fld = (label, node) => <label style={{ display:"flex", flexDirection:"column" }}><span style={cap}>{label}</span>{node}</label>;
  return (
    <div style={{ marginTop:14, paddingTop:12, borderTop:`1px solid ${c.lineSoft}` }}>
      <div style={{ fontFamily:sans, fontSize:11, letterSpacing:0.6, textTransform:"uppercase", color:c.sub, marginBottom:10 }}>Manual entries — extra sales lines or a custom one-off</div>
      {shown.map((e) => {
        const pid = e.productId ?? "custom";
        const prod = products.find((p) => String(p.id) === String(pid));
        const isCustom = pid === "custom";
        const val = manualLineValue(e);return (
          <div key={e.id} style={{ display:"flex", gap:8, alignItems:"flex-end", marginBottom:8, flexWrap:"wrap" }}>
            {fld("Product", (
              <div style={{ display:"flex", flexDirection:"column", gap:4, minWidth:185 }}>
                <select value={pid} style={sel}
                  onChange={(ev)=>{ const v=ev.target.value;
                    if (v==="__new") { onNewProduct && onNewProduct(); return; }
                    if (v==="custom" || v==="") onEdit(e.id,{ productId:v });
                    else { const p=products.find((x)=>String(x.id)===v); onEdit(e.id,{ productId:v, price:priceFor(p,e.channel), qty:num(e.qty)||1 }); } }}>
                  <option value="">Select product…</option>
                  <option value="custom">Custom line</option>
                  {products.map((p)=><option key={p.id} value={String(p.id)}>{p.name}</option>)}
                  <option value="__new">+ New product…</option>
                </select>
                {isCustom && <input value={e.label||""} placeholder="Description" onChange={(ev)=>onEdit(e.id,{ label:ev.target.value })} style={{ ...base, minWidth:185 }} />}
              </div>
            ))}
            {fld("Channel", (
              <select value={e.channel} style={sel}
                onChange={(ev)=>{ const ch=ev.target.value; const patch={ channel:ch }; if (!isCustom && pid!=="" && prod) patch.price=priceFor(prod,ch); onEdit(e.id,patch); }}>
                {CHANNELS.map((x)=><option key={x.id} value={x.id}>{x.id==="all"?"All":x.label}</option>)}
              </select>
            ))}
            {fld("Sale date · fecha", <input type="date" value={e.date||""} onChange={(ev)=>onEdit(e.id,{ date:ev.target.value })} style={{ ...base, width:140 }} />)}
            {fld("Units/wk", <input type="number" value={e.qty??1} onChange={(ev)=>onEdit(e.id,{ qty:ev.target.value })} style={{ ...base, width:72, textAlign:"right" }} />)}
            {fld("Price", <input type="number" value={e.price??0} onChange={(ev)=>onEdit(e.id,{ price:ev.target.value })} style={{ ...base, width:80, textAlign:"right" }} />)}
            {fld("=", <span style={{ fontSize:13.5, minWidth:62, textAlign:"right", display:"inline-block", color:val>=0?c.ink:c.red, padding:"5px 0" }}>{money(val)}</span>)}
            <button onClick={()=>onDel(e.id)} style={{ cursor:"pointer", border:"none", background:"transparent", color:c.sub, fontSize:16, padding:"0 0 5px" }}>×</button>
          </div>
        );
      })}
      <button onClick={onAdd} style={{ fontFamily:sans, fontSize:12.5, cursor:"pointer", padding:"5px 12px", borderRadius:2, border:`1px solid ${c.line}`, background:"transparent", color:c.clay }}>+ Add manual entry</button>
    </div>
  );
}

/* ---- ADD / EDIT PRODUCT FORM -------------------------------------------- */
function ProductForm({ draft, setDraft, onSave, onCancel, onDelete }) {
  const isNew = draft.id === "new";
  const up = (f, v) => setDraft({ ...draft, [f]: v });
  const upCh = (g, ch, v) => setDraft({ ...draft, [g]: { ...draft[g], [ch]: v } });
  const toggleCh = (ch) => up("channels", draft.channels.includes(ch) ? draft.channels.filter((x) => x !== ch) : [...draft.channels, ch]);
  const inp = { fontFamily:sans, fontSize:13.5, padding:"6px 8px", border:`1px solid ${c.line}`, borderRadius:2, background:c.panel, color:c.ink, width:"100%", boxSizing:"border-box" };
  const lbl = (t) => <span style={{ fontFamily:sans, fontSize:10.5, letterSpacing:0.5, textTransform:"uppercase", color:c.sub }}>{t}</span>;
  // function (not nested component) so inputs keep focus across re-renders
  const field = (label, f, type = "number", placeholder) => (
    <label style={{ display:"flex", flexDirection:"column", gap:3 }}>{lbl(label)}
      <input type={type} placeholder={placeholder} value={draft[f] ?? (type === "number" ? 0 : "")} onChange={(e) => up(f, e.target.value)} style={inp} /></label>
  );
  const chField = (label, g, ch) => (
    <label style={{ display:"flex", flexDirection:"column", gap:3 }}>{lbl(label)}
      <input type="number" value={draft[g]?.[ch] ?? 0} onChange={(e) => upCh(g, ch, e.target.value)} style={inp} /></label>
  );
  const grid = { display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(130px,1fr))", gap:12 };
  const pool = { amazon:"FBA", shopify:"on-hand", b2b:"Atlas" };
  return (
    <div style={{ background:c.panel, border:`1px solid ${c.gold}`, borderRadius:4, padding:18, marginBottom:14 }}>
      <div style={{ fontSize:18, marginBottom:12 }}>{isNew ? "Add product" : "Edit product"}</div>
      <div style={grid}>
        {field("Product name","name","text","e.g. Bath Salts Unscented")}
        {field("SKU","sku","text","LH-BATH-SALT-UN")}
        {field("ASIN","asin","text","TBD")}
        {field("Reorder link","reorderLink","text","https://…")}
        <label style={{ display:"flex", flexDirection:"column", gap:3 }}>{lbl("Sale date")}
          <input type="date" value={draft.dates?.[(draft.channels&&draft.channels[0])||"amazon"]||""} onChange={(e)=>up("dates", Object.fromEntries((draft.channels&&draft.channels.length?draft.channels:["amazon","shopify","b2b"]).map((ch)=>[ch,e.target.value])))} style={inp} /></label>
      </div>
      <div style={{ marginTop:14 }}>{lbl("Channels")}</div>
      <div style={{ display:"flex", gap:8, marginTop:6, flexWrap:"wrap" }}>
        {["shopify","amazon","b2b"].map((ch) => { const on = draft.channels.includes(ch);
          return <button key={ch} onClick={() => toggleCh(ch)} style={{ fontFamily:sans, fontSize:13, cursor:"pointer", padding:"6px 16px", borderRadius:2, border:`1px solid ${on?c.ink:c.line}`, background:on?c.ink:"transparent", color:on?c.bg:c.ink }}>{ch==="b2b"?"B2B":ch[0].toUpperCase()+ch.slice(1)}</button>; })}
      </div>
      <div style={{ marginTop:16, marginBottom:6 }}>{lbl("Pricing & landed cost")}</div>
      <div style={grid}>
        {field("Retail price","retail")}{field("Wholesale price","wholesale")}{field("COGS","cogs")}{field("Packaging","packaging")}{field("Freight","freight")}
      </div>
      <div style={{ marginTop:16, marginBottom:6 }}>{lbl("Channel fees & logistics")}</div>
      <div style={grid}>
        {field("Shopify ship/unit","shipShopify")}{field("Amazon FBA fee","fbaFee")}{field("Amazon storage","storage")}{field("Lead time (weeks)","leadWeeks")}{field("FBA inbound units","inbound")}
      </div>
      {draft.channels.length > 0 && <div style={{ marginTop:16, marginBottom:6 }}>{lbl("Weekly units, ad spend & inventory by channel")}</div>}
      {draft.channels.map((ch) => (
        <div key={ch} style={{ border:`1px solid ${c.lineSoft}`, borderRadius:3, padding:12, marginBottom:8 }}>
          <div style={{ fontSize:13, textTransform:"capitalize", marginBottom:8 }}>{ch==="b2b"?"B2B / Atlas":ch}</div>
          <div style={grid}>
            {chField("Units this wk","units",ch)}
            {chField("Units last wk","prev",ch)}
            {ch !== "b2b" && chField("Ad spend / unit","ad",ch)}
            {chField(`Inventory (${pool[ch]})`,"inv",ch)}
          </div>
        </div>
      ))}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:14, paddingTop:12, borderTop:`1px solid ${c.line}` }}>
        <div>{!isNew && <button onClick={onDelete} style={{ fontFamily:sans, fontSize:13, cursor:"pointer", padding:"7px 14px", borderRadius:2, border:`1px solid ${c.red}`, background:"transparent", color:c.red }}>Delete</button>}</div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onCancel} style={{ fontFamily:sans, fontSize:13, cursor:"pointer", padding:"7px 16px", borderRadius:2, border:`1px solid ${c.line}`, background:"transparent", color:c.sub }}>Cancel</button>
          <button onClick={onSave} style={{ fontFamily:sans, fontSize:13, cursor:"pointer", padding:"7px 20px", borderRadius:2, border:`1px solid ${c.ink}`, background:c.ink, color:c.bg }}>{isNew?"Add product":"Save"}</button>
        </div>
      </div>
    </div>
  );
}

/* ---- KEEP-OR-CUT SCORECARD (the Bezos test) ----------------------------- */
function KeepScorecard({ product:p, period, defaultChannel, keepData, onField, onClose }) {
  const chans = p.channels;
  const [scCh, setScCh] = useState(chans.includes(defaultChannel) ? defaultChannel : chans[0]);
  const ch = chans.includes(scCh) ? scCh : chans[0];
  const chLabel = (x) => x==="amazon" ? "Amazon FBA" : x==="b2b" ? "B2B / Atlas" : "Shopify";
  const m = metrics(p, ch, period);
  const kd = { margin:40, profit:50, cap:"", ansMargin:null, ansVol:null, ansRoas:null, override:"auto", ...((keepData||{})[ch]||{}) };
  const set = (f,v) => onField(ch, f, v);
  const e = unitEconomics(p, ch);
  const tMargin = num(kd.margin)/100;
  const targetProfit = num(kd.profit);
  const targetLanded = e.price*(1-tMargin) - e.fees - e.ship - e.returns;
  const targetCOGS = targetLanded - num(p.packaging) - num(p.freight);
  const reqUnits = m.profitPerUnit > 0 ? Math.ceil(targetProfit/m.profitPerUnit) : Infinity;
  const reqRevenue = reqUnits === Infinity ? Infinity : reqUnits*e.price;
  const capSet = kd.cap !== "" && kd.cap != null;
  const capExceeded = capSet && reqRevenue !== Infinity && reqRevenue > num(kd.cap);
  const hasAds = m.roas != null;
  const marginMet = m.netMargin >= tMargin;
  const profitMet = m.netAfterAds >= targetProfit;
  const roasMet = !hasAds || m.roas >= m.breakevenRoas;
  const conds = [{ field:"ansMargin", met:marginMet }, { field:"ansVol", met:profitMet }, ...(hasAds?[{ field:"ansRoas", met:roasMet }]:[])];
  const eff = conds.map((cd)=>kd[cd.field] ?? (cd.met ? "yes" : null));
  const verdict = (kd.override && kd.override !== "auto") ? kd.override
    : eff.some(v=>v==null) ? "undecided" : eff.includes("no") ? "cut" : eff.includes("maybe") ? "maybe" : "keep";
  const vMeta = { keep:{t:"Keep — clears the bar",col:c.green}, maybe:{t:"Maybe — conditional",col:c.gold}, cut:{t:"Cut — fails the bar",col:c.red}, undecided:{t:"Undecided — answer the open questions",col:c.sub} }[verdict];
  const inp = { fontFamily:sans, fontSize:13, padding:"5px 8px", border:`1px solid ${c.line}`, borderRadius:2, background:c.panel, color:c.ink, width:84, textAlign:"right" };
  const cap = { fontFamily:sans, fontSize:10.5, letterSpacing:0.5, textTransform:"uppercase", color:c.sub };
  const ynm = (field) => (
    <div style={{ display:"flex", gap:6, flexShrink:0 }}>
      {["yes","maybe","no"].map((opt)=>{ const on=kd[field]===opt; const col=opt==="yes"?c.green:opt==="maybe"?c.gold:c.red;
        return <button key={opt} onClick={()=>set(field, on?null:opt)} style={{ fontFamily:sans, fontSize:12, cursor:"pointer", padding:"4px 13px", borderRadius:2, textTransform:"capitalize", border:`1px solid ${on?col:c.line}`, background:on?col:"transparent", color:on?"#fff":c.sub }}>{opt}</button>; })}
    </div>
  );
  const cond = (n, title, met, body, bodyEs, field) => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:14, padding:"12px 0", borderBottom:`1px solid ${c.lineSoft}`, flexWrap:"wrap" }}>
      <div style={{ flex:1, minWidth:250 }}>
        <div style={{ fontSize:14 }}>{n} · {title}{met && <span style={{ fontFamily:sans, fontSize:10, letterSpacing:0.4, textTransform:"uppercase", color:c.green, border:`1px solid ${c.green}`, borderRadius:2, padding:"1px 6px", marginLeft:8 }}>Clears now</span>}</div>
        <div style={{ fontSize:12.5, color:c.sub, marginTop:2, lineHeight:1.45 }}>{body}</div>
        <div style={{ fontSize:11, color:"rgba(111,102,87,0.65)", fontStyle:"italic", marginTop:3, lineHeight:1.4 }}>{bodyEs}</div>
      </div>
      {ynm(field)}
    </div>
  );
  return (
    <div style={{ background:c.panel, border:`1px solid ${c.gold}`, borderRadius:4, padding:18, marginTop:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", flexWrap:"wrap", gap:8 }}>
        <div><div style={{ fontSize:18 }}>Keep-or-cut standard — {p.name}</div>
          <div style={{ fontSize:12.5, color:c.sub, fontStyle:"italic" }}>The bar: what has to be true for this to earn its place on each channel? Answer each, then set the call.</div>
          <div style={faintEs}>El estándar: ¿qué debe ser cierto para que gane su lugar en cada canal? Responde cada uno y fija la decisión.</div>
          {(p.dates?.[ch]) && <div style={{ fontSize:11.5, color:c.sub, marginTop:3 }}>Sale date · <i>fecha de venta</i> ({chLabel(ch)}): {p.dates[ch]}</div>}</div>
        <button onClick={onClose} style={{ cursor:"pointer", border:"none", background:"transparent", color:c.sub, fontSize:18 }}>×</button>
      </div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginTop:14 }}>
        <span style={{ fontFamily:sans, fontSize:10.5, letterSpacing:0.5, textTransform:"uppercase", color:c.sub, marginRight:4 }}>Set bar for · <i>fijar para</i></span>
        {chans.map((x)=>{ const on=x===ch; return <button key={x} onClick={()=>setScCh(x)} style={{ fontFamily:sans, fontSize:12.5, cursor:"pointer", padding:"5px 13px", borderRadius:2, border:`1px solid ${on?c.gold:c.line}`, background:on?c.gold:"transparent", color:on?"#fff":c.sub }}>{chLabel(x)}</button>; })}
      </div>
      <div style={{ display:"flex", gap:18, flexWrap:"wrap", marginTop:12, marginBottom:4 }}>
        <label style={{ display:"flex", flexDirection:"column", gap:3 }}><span style={cap}>Target net margin %</span><input type="number" value={kd.margin} onChange={(ev)=>set("margin",ev.target.value)} style={inp} /></label>
        <label style={{ display:"flex", flexDirection:"column", gap:3 }}><span style={cap}>Target weekly profit $</span><input type="number" value={kd.profit} onChange={(ev)=>set("profit",ev.target.value)} style={inp} /></label>
        <label style={{ display:"flex", flexDirection:"column", gap:3 }}><span style={cap}>Weekly revenue cap $</span><input type="number" value={kd.cap} onChange={(ev)=>set("cap",ev.target.value)} placeholder="none" style={inp} /></label>
      </div>

      <div style={{ marginTop:10, marginBottom:6 }}><span style={cap}>Per channel — weekly</span><div style={faintEs}>Por canal — semanal</div></div>
      <div style={{ overflowX:"auto", border:`1px solid ${c.lineSoft}`, borderRadius:3 }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:440 }}>
          <thead><tr>
            {["Channel/Canal","Units/wk · Unid.","Profit/unit · Gan./u","Weekly · Semanal","Margin · Margen"].map((h,i)=>(
              <th key={i} style={{ fontFamily:sans, fontSize:10, letterSpacing:0.4, textTransform:"uppercase", color:c.sub, textAlign:i===0?"left":"right", padding:"6px 8px", borderBottom:`1px solid ${c.line}`, whiteSpace:"nowrap" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {p.channels.map((ch2)=>{ const mm=metrics(p,ch2,"current"); const lbl=ch2==="amazon"?"Amazon FBA":ch2==="b2b"?"B2B / Atlas":"Shopify"; const selRow=ch2===ch;
              const tdc={ fontSize:13, padding:"6px 8px", textAlign:"right", borderBottom:`1px solid ${c.lineSoft}`, whiteSpace:"nowrap", background:selRow?"rgba(176,141,87,0.10)":"transparent" };
              return (<tr key={ch2} onClick={()=>setScCh(ch2)} style={{ cursor:"pointer" }}>
                <td style={{ ...tdc, textAlign:"left" }}>{lbl}</td>
                <td style={tdc}>{mm.units.toFixed(0)}</td>
                <td style={{ ...tdc, color:mm.profitPerUnit>=0?c.ink:c.red }}>{money2(mm.profitPerUnit)}</td>
                <td style={{ ...tdc, color:mm.netAfterAds>=0?c.ink:c.red }}>{money(mm.netAfterAds)}</td>
                <td style={tdc}>{pct(mm.netMargin)}</td>
              </tr>); })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize:11.5, color:c.sub, fontStyle:"italic", marginTop:6 }}>The bar below is set for <b style={{ color:c.ink }}>{chLabel(ch)}</b> only — tap another channel row above to set its own targets. A product can be Keep on one channel and Cut on another.</div>
      <div style={faintEs}>El estándar de abajo es solo para <b>{chLabel(ch)}</b> — toca otra fila de canal arriba para fijar sus propios objetivos. Un producto puede ser Conservar en un canal y Cortar en otro.</div>

      {cond(1, `Hit ${num(kd.margin)}% net margin`, marginMet,
        marginMet
          ? `Already at ${pct(m.netMargin)} — above the ${num(kd.margin)}% bar at ${money2(num(p.cogs))} COGS. Mark Maybe/No only if it won't hold at scale.`
          : (targetCOGS >= 0
            ? `Now ${pct(m.netMargin)} at ${money2(num(p.cogs))} COGS. To reach ${num(kd.margin)}% at a ${money2(e.price)} price, COGS must drop to ≤ ${money2(targetCOGS)}. Can we get COGS there?`
            : `At a ${money2(e.price)} price you can't reach ${num(kd.margin)}% on COGS alone — it needs a price increase. Can we raise price or cut cost enough?`),
        marginMet
          ? `Ya en ${pct(m.netMargin)} — por encima del objetivo de ${num(kd.margin)}% con COGS de ${money2(num(p.cogs))}. Marca Quizá/No solo si no se sostiene al escalar.`
          : (targetCOGS >= 0
            ? `Ahora ${pct(m.netMargin)} con COGS de ${money2(num(p.cogs))}. Para llegar a ${num(kd.margin)}% a un precio de ${money2(e.price)}, el COGS debe bajar a ≤ ${money2(targetCOGS)}. ¿Podemos lograrlo?`: `A un precio de ${money2(e.price)} no se alcanza ${num(kd.margin)}% solo con COGS — requiere subir el precio. ¿Podemos subir el precio o bajar el costo lo suficiente?`),
        "ansMargin")}
      {cond(2, `Clear ${money(targetProfit)}/week in profit`, profitMet,
        profitMet
          ? `Already clearing ${money(m.netAfterAds)}/wk — above the ${money(targetProfit)} bar at ${m.units.toFixed(0)} units. Mark Maybe/No only if it can't hold.`
          : (m.profitPerUnit > 0
            ? `At ${money2(m.profitPerUnit)} profit/unit you'd need ~${reqUnits} units/wk (now ${m.units.toFixed(0)}). Revenue at that volume ≈ ${money(reqRevenue)}.${capExceeded?` That exceeds your ${money(num(kd.cap))} cap — volume alone won't get there.`:""} Can we reach that volume?`
            : `Loses ${money2(Math.abs(m.profitPerUnit))}/unit today — more volume means bigger losses, not profit. Margin has to be fixed first. Can we?`),
        profitMet
          ? `Ya genera ${money(m.netAfterAds)}/sem — por encima del objetivo de ${money(targetProfit)} con ${m.units.toFixed(0)} unidades. Marca Quizá/No solo si no se sostiene.`
          : (m.profitPerUnit > 0
            ? `A ${money2(m.profitPerUnit)} de ganancia/unidad necesitarías ~${reqUnits} unidades/sem (ahora ${m.units.toFixed(0)}). Ingreso a ese volumen ≈ ${money(reqRevenue)}.${capExceeded?` Eso supera tu tope de ${money(num(kd.cap))} — el volumen por sí solo no alcanza.`:""} ¿Podemos alcanzar ese volumen?`
            : `Pierde ${money2(Math.abs(m.profitPerUnit))}/unidad hoy — más volumen significa más pérdidas, no ganancia. Primero hay que arreglar el margen. ¿Podemos?`),
        "ansVol")}
      {hasAds && cond(3, `Hold ROAS above break-even at scale`, roasMet,
        roasMet
          ? `Already ${m.roas.toFixed(1)}x vs ${m.breakevenRoas===Infinity?"—":m.breakevenRoas.toFixed(1)+"x"} break-even — clears it. Mark Maybe/No only if ads can't hold as spend grows.`
          : `Break-even ROAS is ${m.breakevenRoas===Infinity?"—":m.breakevenRoas.toFixed(1)+"x"}; you're at ${m.roas.toFixed(1)}x — below it. Can ads get above break-even?`,
        roasMet
          ? `Ya en ${m.roas.toFixed(1)}x vs equilibrio de ${m.breakevenRoas===Infinity?"—":m.breakevenRoas.toFixed(1)+"x"} — lo cumple. Marca Quizá/No solo si los anuncios no se sostienen al aumentar el gasto.`
          : `El ROAS de equilibrio es ${m.breakevenRoas===Infinity?"—":m.breakevenRoas.toFixed(1)+"x"}; estás en ${m.roas.toFixed(1)}x — por debajo. ¿Pueden los anuncios superar el punto de equilibrio?`,
        "ansRoas")}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12, marginTop:14, paddingTop:12, borderTop:`1px solid ${c.line}` }}>
        <div><span style={cap}>Verdict</span><div style={{ fontSize:16, color:vMeta.col }}>{vMeta.t}</div></div>
        <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
          <span style={cap}>Override the call</span>
          <div style={{ display:"flex", gap:6 }}>
            {[["auto","Auto"],["keep","Keep"],["maybe","Maybe"],["cut","Cut"]].map(([v,t])=>{ const on=(kd.override||"auto")===v;
              return <button key={v} onClick={()=>set("override",v)} style={{ fontFamily:sans, fontSize:12, cursor:"pointer", padding:"4px 13px", borderRadius:2, border:`1px solid ${on?c.ink:c.line}`, background:on?c.ink:"transparent", color:on?c.bg:c.sub }}>{t}</button>; })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   MAIN
   ========================================================================== */
export default function ProfitMatrix({ data, onSave, liveSales }) {
  const [eprods, setEprods] = useState(() => normalize(data && data.products));
  const [opex, setOpex] = useState(() => (data && data.opex && data.opex.length ? data.opex : SEED_OPEX).map((o)=>({ ...o })));
  const [adj, setAdjState] = useState(() => ({ revenue:0, gross:0, net:0, netAfterAds:0, marketing:0, inventory:0, ...(data && data.profitAdjustments) }));
  const [manual, setManual] = useState(() => ({ revenue:[], gross:[], net:[], netAfterAds:[], marketing:[], inventory:[], ...(data && data.profitManual) }));
  const [assignees, setAssignees] = useState(() => ({ ...(data && data.assignees) }));
  const setAssignee = (key, patch) => { setAssignees((a)=>({ ...a, [key]:{ ...(a[key]||{}), ...patch } })); setDirty(true); };
  const [channel, setChannel] = useState("all");
  const [period, setPeriod] = useState("current");
  const [salesMetric, setSalesMetric] = useState("net"); // net | gross — drives the live Sales-by-Period chart
  const [open, setOpen] = useState(null);
  const [auditMetric, setAuditMetric] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState(null);
  const [quickName, setQuickName] = useState("");
  const [keep, setKeep] = useState(() => ({ ...(data && data.keep) }));
  const [keepProduct, setKeepProduct] = useState(null);
  const [crossOpen, setCrossOpen] = useState(null);

  const KD_DEFAULT = { margin:40, profit:50, cap:"", ansMargin:null, ansVol:null, ansRoas:null, override:"auto" };
  const kdOf = (pid, ch) => ({ ...KD_DEFAULT, ...((keep[pid]||{})[ch]||{}) });
  const effStatus = (pid, m, ch) => {
    if (!ch || ch === "all") return null;
    const kd = kdOf(pid, ch);
    if (kd.override && kd.override !== "auto") return kd.override;
    const tM = num(kd.margin)/100;
    const eff = [
      kd.ansMargin ?? (m.netMargin >= tM ? "yes" : null),
      kd.ansVol ?? (m.netAfterAds >= num(kd.profit) ? "yes" : null),
      ...(m.roas!=null ? [ kd.ansRoas ?? (m.roas >= m.breakevenRoas ? "yes" : null) ] : []),
    ];
    if (eff.some(v=>v==null)) return null;
    if (eff.includes("no")) return "cut";
    if (eff.includes("maybe")) return "maybe";
    return "keep";
  };
  const setKeepField = (pid, ch, f, v) => { setKeep((k)=>{ const prod={ ...(k[pid]||{}) }; const cur={ ...KD_DEFAULT, ...(prod[ch]||{}) }; prod[ch]={ ...cur, [f]:v }; return { ...k, [pid]:prod }; }); setDirty(true); };

  const setField = (id, field, value, ch) => { setEprods((prev)=>prev.map((p)=>p.id!==id?p:(ch?{...p,[field]:{...p[field],[ch]:value}}:{...p,[field]:value}))); setDirty(true); };
  const reassignChannel = (id, fromCh, toCh) => {
    if (fromCh === toCh) return;
    setEprods((prev)=>prev.map((p)=>{
      if (p.id !== id || p.channels.includes(toCh)) return p;
      const move = (o) => { const n = { ...(o||{}) }; n[toCh] = n[fromCh]; n[fromCh] = 0; return n; };
      return { ...p, channels: p.channels.map((ch)=>ch===fromCh?toCh:ch), units:move(p.units), prev:move(p.prev), ad:move(p.ad), inv:move(p.inv) };
    }));
    setDirty(true);
  };
  const setAdj = (metric, value) => { setAdjState((a)=>({ ...a, [metric]:value })); setDirty(true); };
  const editOpex = (id, field, value) => { setOpex((prev)=>prev.map((o)=>o.id!==id?o:{...o,[field]:value})); setDirty(true); };
  const addOpex = () => { setOpex((prev)=>[...prev, { id:"o"+Date.now(), label:"New expense", category:"Other", channel:"shopify", weekly:0, date:"" }]); setDirty(true); };
  const delOpex = (id) => { setOpex((prev)=>prev.filter((o)=>o.id!==id)); setDirty(true); };
  const save = () => { onSave?.({ products:eprods, opex, adjustments:adj, manual, keep, assignees }); setDirty(false); };
  const reset = () => { setEprods(normalize(data&&data.products)); setOpex((data&&data.opex&&data.opex.length?data.opex:SEED_OPEX).map((o)=>({...o}))); setAdjState({ revenue:0,gross:0,net:0,netAfterAds:0,marketing:0,inventory:0 }); setManual({ revenue:[],gross:[],net:[],netAfterAds:[],marketing:[],inventory:[] }); setKeep({ ...(data&&data.keep) }); setAssignees({ ...(data&&data.assignees) }); setDirty(false); };
  const addManual = (metric) => { const ch = channel==="all"?"all":channel; setManual((m)=>({ ...m, [metric]:[...(m[metric]||[]), { id:"m"+Date.now(), productId:"", channel:ch, price:0, qty:1, label:"", amount:0, date:"" }] })); setDirty(true); };
  const editManual = (metric,id,patch) => { setManual((m)=>({ ...m, [metric]:(m[metric]||[]).map((e)=>e.id===id?{...e,...patch}:e) })); setDirty(true); };
  const delManual = (metric,id) => { setManual((m)=>({ ...m, [metric]:(m[metric]||[]).filter((e)=>e.id!==id) })); setDirty(true); };
  const incl = (entryCh, ch) => ch==="all" || entryCh==="all" || entryCh===ch;
  const manualSum = (metric, ch) => (manual[metric]||[]).filter((e)=>incl(e.channel,ch)).reduce((s,e)=>s+manualLineValue(e),0);

  const blankProduct = () => ({ id:"new", name:"", sku:"", asin:"", channels:["shopify"], retail:0, wholesale:0, cogs:0, packaging:0, freight:0, shipShopify:0, fbaFee:0, storage:0, ad:{amazon:0,shopify:0}, units:{amazon:0,shopify:0,b2b:0}, prev:{amazon:0,shopify:0,b2b:0}, inv:{amazon:0,shopify:0,b2b:0}, inbound:0, leadWeeks:3, reorderLink:"", dates:{amazon:"",shopify:"",b2b:""} });
  const openAdd = () => setDraft(blankProduct());
  const openEdit = (p) => setDraft({ ...p, ad:{...p.ad}, units:{...p.units}, prev:{...p.prev}, inv:{...(p.inv||{})} });
  const saveProduct = () => {
    const isNew = draft.id === "new";
    const clean = { ...draft, name: (draft.name||"").trim() || "Untitled product" };
    if (isNew) { const id = eprods.reduce((mx,p)=>Math.max(mx, Number(p.id)||0), 0) + 1; setEprods((prev)=>[...prev, { ...clean, id }]); }
    else setEprods((prev)=>prev.map((p)=>p.id===draft.id?clean:p));
    setDirty(true); setDraft(null);
  };
  const deleteProduct = () => { setEprods((prev)=>prev.filter((p)=>p.id!==draft.id)); setDirty(true); setDraft(null); };
  const quickAdd = () => {
    const name = (quickName||"").trim(); if (!name) return;
    const id = eprods.reduce((mx,p)=>Math.max(mx, Number(p.id)||0),0)+1;
    const ch = channel === "all" ? "shopify" : channel;
    const np = { ...blankProduct(), id, name, channels:[ch] };
    setEprods((prev)=>[...prev, np]); setDirty(true); setQuickName(""); setDraft({ ...np });
  };

  const rows = useMemo(() => eprods.filter((p)=>channel==="all"||p.channels.includes(channel))
    .map((p)=>{ const m=metrics(p,channel,period); const sc=scoreOf(m); return { p,m,sc,d:decide(m,sc),status:effStatus(p.id,m,channel) }; })
    .sort((a,b)=>b.m.netAfterAds-a.m.netAfterAds), [eprods, channel, period, keep]);

  const opexAmt = useMemo(()=>opexTotal(opex, channel, period), [opex, channel, period]);
  const opexWeekly = useMemo(()=>opexTotal(opex, channel, "current"), [opex, channel]);

  const ex = useMemo(() => {
    const sum = (f) => rows.reduce((s,r)=>s+f(r),0);
    const revenue=sum(r=>r.m.revenue), gross=sum(r=>r.m.gross), net=sum(r=>r.m.net),
      productAd=sum(r=>r.m.adSpend), commission=sum(r=>r.m.commission), invValue=sum(r=>r.m.invValue);
    const marketing = productAd + opexAmt;
    const netAfterAds = net - marketing;
    const active=[...rows].filter(r=>r.m.units>0);
    const used=new Set();
    const take=(pool)=>{ const r=pool.find(x=>x&&!used.has(x.p.id)); if(r)used.add(r.p.id); return r; };
    const bestPool=[...active].filter(r=>r.status!=="cut").sort((a,b)=>b.m.netAfterAds-a.m.netAfterAds);
    const best=take(bestPool.length?bestPool:[...active].sort((a,b)=>b.m.netAfterAds-a.m.netAfterAds));
    const cuts=active.filter(r=>r.status==="cut");
    const notKeep=active.filter(r=>r.status!=="keep");
    const worstPool=[...(cuts.length?cuts:(notKeep.length?notKeep:active))].sort((a,b)=>a.m.netAfterAds-b.m.netAfterAds);
    const worst=take(worstPool);
    const oppPool=[...rows].filter(r=>r.m.netAfterAds>0&&r.sc>=60&&r.status!=="cut").sort((a,b)=>(b.sc-b.m.adSpend)-(a.sc-a.m.adSpend));
    const opp=take(oppPool);
    const riskPool=[...rows].sort((a,b)=>{ const ra=a.m.netAfterAds>0?a.m.weeksRemaining:-100+a.m.netAfterAds; const rb=b.m.netAfterAds>0?b.m.weeksRemaining:-100+b.m.netAfterAds; return ra-rb; });
    const worstAlsoRisk = !!(worst && riskPool[0] && worst.p.id===riskPool[0].p.id);
    const risk=take(riskPool);
    return { revenue, gross, net, productAd, opex:opexAmt, marketing, commission, netAfterAds, invValue, best, worst, opp, risk, worstAlsoRisk };
  }, [rows, opexAmt]);

  const wow = useMemo(() => {
    const f=(per)=>{ const r=eprods.filter(p=>channel==="all"||p.channels.includes(channel)).reduce((s,p)=>s+metrics(p,channel,per).netAfterAds,0); return r-opexTotal(opex,channel,per); };
    return { cur:f("current"), prv:f("previous") };
  }, [eprods, opex, channel]);

  // Live per-period sales from the real Shopify/Amazon feeds (passed in as
  // liveSales). Falls back to the seeded model only when a channel has no feed.
  const PERIOD_KEY = { current: "thisWeek", previous: "lastWeek", last4: "last4", qtd: "qtd", ytd: "ytd" };
  const liveRev = (ch, per) => {
    const key = PERIOD_KEY[per]; if (!key) return null;
    const pick = (feed) => (feed && feed.periods && feed.periods[key] ? num(feed.periods[key][salesMetric]) : null);
    if (ch === "shopify") return pick(liveSales && liveSales.shopify);
    if (ch === "amazon") return pick(liveSales && liveSales.amazon);
    if (ch === "all") {
      const s = pick(liveSales && liveSales.shopify), a = pick(liveSales && liveSales.amazon);
      if (s == null && a == null) return null;
      return (s || 0) + (a || 0);
    }
    return null; // b2b: no live feed
  };
  const liveOn = liveRev(channel, "current") != null || liveRev(channel, "ytd") != null;
  const livePartial = channel === "all" && !(liveSales && liveSales.amazon); // Shopify live but Amazon not wired yet
  const shopifyLimited = !!(liveSales && liveSales.shopify && liveSales.shopify.periods && liveSales.shopify.periods.limited);

  const series = useMemo(() => {
    const seedRev = (per) => eprods.filter(p => channel === "all" || p.channels.includes(channel)).reduce((s, p) => s + metrics(p, channel, per).revenue, 0);
    const rev = (per) => { const lv = liveRev(channel, per); return lv != null ? lv : seedRev(per); };
    const order = [
      { id: "ytd", label: "Year", labelEs: "Año" },
      { id: "qtd", label: "Quarter", labelEs: "Trim." },
      { id: "last4", label: "4 Weeks", labelEs: "4 sem" },
      { id: "previous", label: "Last Wk", labelEs: "Sem. pas." },
      { id: "current", label: "This Wk", labelEs: "Esta sem." },
    ];
    // rate = actual sales for the window (period totals), not a weekly run-rate
    const pts = order.map(o => { const total = rev(o.id); return { ...o, total, rate: total }; });
    const cur = rev("current"), prev = rev("previous");
    const wowPct = prev > 0 ? (cur - prev) / prev : (cur > 0 ? 1 : 0);
    return { pts, cur, prev, wowPct, live: liveOn };
  }, [eprods, channel, salesMetric, liveSales]);

  const recs = useMemo(() => {
    const out=[];
    const chLab = channel==="all"?"each channel":channel==="b2b"?"B2B":channel==="amazon"?"Amazon":"Shopify";
    const chLabEs = channel==="all"?"cada canal":channel==="b2b"?"B2B":channel==="amazon"?"Amazon":"Shopify";
    rows.forEach(({p,m,sc,d})=>{
      if(d.tag==="Scale"){
        const newAd = m.adSpend>0?money(m.adSpend*1.2):"a small test budget";
        out.push({ k:"scale", pid:p.id, icon:"↑", color:c.green, title:`Scale ${p.name}`,
          action:`Raise ${chLab} ad spend ~20%${m.adSpend>0?` (≈ ${newAd}/wk)`:""} and pre-buy ~${m.reorderQty} more units so growth doesn't cause a stockout.`,
          actionEs:`Sube el gasto en anuncios de ${chLabEs} ~20%${m.adSpend>0?` (≈ ${newAd}/sem)`:""} y compra por adelantado ~${m.reorderQty} unidades más para que el crecimiento no cause un quiebre de stock.`,
          achieves:`Captures more of your most profitable volume while margin (${pct(m.netMargin)}) and ROAS (${m.roas?m.roas.toFixed(1)+"x":"n/a"}) are strong.`,
          achievesEs:`Captura más del volumen más rentable mientras el margen (${pct(m.netMargin)}) y el ROAS (${m.roas?m.roas.toFixed(1)+"x":"n/d"}) están fuertes.` });
      }
      if(d.tag==="Eliminate") out.push({ k:"kill", pid:p.id, icon:"✕", color:c.red, title:`Stop reordering ${p.name}`,
        action:`Stop placing new orders for ${p.name}, set its ads to $0, and sell through the ${money(m.invValue)} already in stock.`,
        actionEs:`Deja de hacer pedidos nuevos de ${p.name}, pon sus anuncios en $0 y vende el inventario de ${money(m.invValue)} que ya tienes.`,
        achieves:`Frees up cash from a unit losing ${money2(Math.abs(m.profitPerUnit))} each instead of sinking more into it.`,
        achievesEs:`Libera efectivo de una unidad que pierde ${money2(Math.abs(m.profitPerUnit))} cada una en vez de seguir invirtiendo.` });
      if(d.tag==="Fix"){
        const roasIssue = m.roas!=null && m.roas<m.breakevenRoas;
        out.push({ k:"fix", pid:p.id, icon:"!", color:c.yellow, title:`Fix ${p.name}`,
          action: roasIssue
            ? `Cut ${chLab} ad spend (now ${money(m.adSpend)}/wk) until ROAS clears ${m.breakevenRoas===Infinity?"break-even":m.breakevenRoas.toFixed(1)+"x"} — or raise price. Don't add inventory yet.`
            : `Raise price or lower COGS on ${p.name} until each unit profits (it's at ${pct(m.netMargin)} net margin now). Hold ad spend flat until then.`,
          actionEs: roasIssue
            ? `Reduce el gasto en anuncios de ${chLabEs} (ahora ${money(m.adSpend)}/sem) hasta que el ROAS supere ${m.breakevenRoas===Infinity?"el equilibrio":m.breakevenRoas.toFixed(1)+"x"} — o sube el precio. No agregues inventario aún.`
            : `Sube el precio o baja el COGS de ${p.name} hasta que cada unidad gane (está en ${pct(m.netMargin)} de margen). Mantén el gasto en anuncios igual mientras tanto.`,
          achieves: roasIssue ? `Stops ads from eating the margin before you put more money behind it.` : `Makes each unit profitable first, so scaling later adds profit instead of losses.`,
          achievesEs: roasIssue ? `Evita que los anuncios se coman el margen antes de invertir más.` : `Hace que cada unidad sea rentable primero, para que escalar luego sume ganancia en vez de pérdidas.` });
      }
      if(m.netAfterAds>0&&m.weeksRemaining<num(p.leadWeeks)+1) out.push({ k:"reorder", pid:p.id, icon:"⟳", color:c.clay, title:`Reorder ${p.name}`,
        action:`Place a reorder of ~${m.reorderQty} units of ${p.name} now (≈ ${money(m.cashForReorder)}) — only ~${m.weeksRemaining.toFixed(1)} wks of ${chLab} stock left against a ${num(p.leadWeeks)}-wk lead time.`,actionEs:`Haz un pedido de ~${m.reorderQty} unidades de ${p.name} ahora (≈ ${money(m.cashForReorder)}) — quedan solo ~${m.weeksRemaining.toFixed(1)} sem de stock de ${chLabEs} contra ${num(p.leadWeeks)} sem de espera.`,
        achieves:`Prevents a stockout that would lose sales${channel==="amazon"||channel==="all"?" and hurt Amazon ranking":""}.`,
        achievesEs:`Evita un quiebre de stock que perdería ventas${channel==="amazon"||channel==="all"?" y dañaría el posicionamiento en Amazon":""}.` });
    });
    const rank={reorder:0,kill:1,fix:2,scale:3};
    out.forEach((o)=>{ o.key=o.k+":"+o.pid; });
    return out.sort((a,b)=>rank[a.k]-rank[b.k]).slice(0,8);
  }, [rows, channel]);

  const ledger = useMemo(() => {
    const sales = [];
    eprods.forEach((p)=>{
      (p.channels||[]).forEach((ch)=>{
        if (!(channel==="all"||ch===channel)) return;
        const mm = metrics(p, ch, period);
        if (mm.revenue<=0) return;
        sales.push({ pid:p.id, ch, name:p.name, date:p.dates?.[ch]||"", amount:mm.revenue });
      });
    });
    sales.sort((a,b)=>{ if(!a.date&&!b.date)return 0; if(!a.date)return 1; if(!b.date)return -1; return a.date<b.date?-1:1; });
    return { sales, revenue: sales.reduce((s,x)=>s+x.amount,0) };
  }, [eprods, channel, period]);

  const S = {
    wrap:{ fontFamily:serif, color:c.ink, background:c.bg, padding:"26px 22px 60px", maxWidth:1180, margin:"0 auto" },
    h1:{ fontFamily:serif, fontSize:30, fontWeight:400, letterSpacing:0.3, margin:0 },
    sub:{ color:c.sub, fontSize:14.5, marginTop:4, fontStyle:"italic" },
    label:{ fontFamily:sans, fontSize:11, letterSpacing:1.3, textTransform:"uppercase", color:c.sub },
    panel:{ background:c.panel, border:`1px solid ${c.line}`, borderRadius:4, padding:18 },
    sec:{ fontSize:19, fontWeight:400, margin:"34px 0 14px", letterSpacing:0.3, borderBottom:`1px solid ${c.line}`, paddingBottom:8 },
    th:{ fontFamily:sans, fontSize:10.5, letterSpacing:0.6, textTransform:"uppercase", color:c.sub, textAlign:"right", padding:"9px 10px", borderBottom:`1px solid ${c.line}`, whiteSpace:"nowrap" },
    thL:{ textAlign:"left" },
    td:{ fontSize:13.5, padding:"11px 10px", borderBottom:`1px solid ${c.lineSoft}`, textAlign:"right", whiteSpace:"nowrap" },
    tdL:{ textAlign:"left" },
  };
  const tBtn=(a)=>({ fontFamily:sans, fontSize:13.5, letterSpacing:0.3, cursor:"pointer", padding:"8px 16px", borderRadius:2, border:`1px solid ${a?c.ink:c.line}`, background:a?c.ink:"transparent", color:a?c.bg:c.ink });
  const pBtn=(a)=>({ fontFamily:sans, fontSize:12, cursor:"pointer", padding:"5px 11px", borderRadius:2, border:"none", background:"transparent", color:a?c.ink:c.sub, borderBottom:`2px solid ${a?c.gold:"transparent"}` });
  const sel={ fontFamily:sans, fontSize:12.5, padding:"4px 6px", border:`1px solid ${c.line}`, borderRadius:2, background:c.panel, color:c.ink };

  const marginLevel = ex.revenue ? (ex.netAfterAds/ex.revenue>=0.2?"green":ex.netAfterAds/ex.revenue>=0.08?"yellow":"red") : "red";
  const tacos = ex.revenue ? ex.marketing/ex.revenue : 0;
  const tacosLevel = tacos<=0.15?"green":tacos<=0.28?"yellow":"red";

  const KPI = ({ k, label, labelEs, value, level, note, big }) => {
    const active = auditMetric===k, clickable=!!k;
    return (
      <div onClick={clickable?()=>setAuditMetric(active?null:k):undefined}
        style={{ ...S.panel, padding:"14px 16px", cursor:clickable?"pointer":"default", borderColor:active?c.gold:c.line }}>
        <div style={S.label}>{level&&<Dot level={level} />}{label}
          {clickable&&<span style={{ float:"right", fontSize:10, color:active?c.gold:c.sub, letterSpacing:0.5 }}>{active?"▲ audit":"▾ audit"}</span>}</div>
        {labelEs&&<div style={faintEs}>{labelEs}</div>}
        <div style={{ fontSize:big?26:22, marginTop:6, lineHeight:1.1 }}>{value}</div>
        {note&&<div style={{ fontSize:12, color:c.sub, marginTop:4 }}>{note}</div>}
      </div>
    );
  };
  // Dashboard tiles: use live sales for the SELECTED period/channel when available.
  // Revenue is live; profit tiles scale to live sales at the modeled margin (until
  // per-product live units land), so the period buttons move real numbers.
  const liveSelRev = liveRev(channel, period);
  const liveScale = (liveSelRev != null && ex.revenue > 0) ? (liveSelRev / ex.revenue) : null;
  const dv = {
    revenue: liveSelRev != null ? liveSelRev : ex.revenue + num(adj.revenue) + manualSum("revenue", channel),
    gross: liveScale != null ? Math.round(ex.gross * liveScale) : ex.gross + num(adj.gross) + manualSum("gross", channel),
    net: liveScale != null ? Math.round(ex.net * liveScale) : ex.net + num(adj.net) + manualSum("net", channel),
    netAfterAds: liveScale != null ? Math.round(ex.netAfterAds * liveScale) : ex.netAfterAds + num(adj.netAfterAds) + manualSum("netAfterAds", channel),
    marketing: ex.marketing + num(adj.marketing) + manualSum("marketing", channel), inventory: ex.invValue + num(adj.inventory) + manualSum("inventory", channel) };
  const dvLive = liveSelRev != null;

  const drawer = () => {
    if (!auditMetric) return null;
    const common = { channel, products:eprods, setField, reassignChannel, adj:adj[auditMetric], setAdj:(v)=>setAdj(auditMetric,v), onSave:save, onReset:reset, dirty,
      manualEntries: manual[auditMetric]||[], manualSum: manualSum(auditMetric, channel),
      onManualAdd: ()=>addManual(auditMetric), onManualEdit:(id,patch)=>editManual(auditMetric,id,patch), onManualDel:(id)=>delManual(auditMetric,id), onNewProduct: openAdd };
    if (auditMetric==="inventory") return <InventoryDrawer {...common} />;
    return <AuditDrawer metric={auditMetric} opexAmt={opexWeekly} {...common} />;
  };

  return (
    <div style={S.wrap}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", flexWrap:"wrap", gap:12 }}>
        <div><h1 style={S.h1}>Profit Matrix</h1><div style={faintEs}>Matriz de ganancia</div><div style={S.sub}>What made money, what leaked cash, and what to do this week.</div><div style={faintEs}>Qué generó dinero, dónde se fugó efectivo y qué hacer esta semana.</div></div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>{PERIODS.map(pr=><button key={pr.id} style={pBtn(period===pr.id)} onClick={()=>setPeriod(pr.id)}>{pr.label}</button>)}</div>
      </div>
      <div style={{ display:"flex", gap:8, marginTop:18, flexWrap:"wrap" }}>{CHANNELS.map(ch=><button key={ch.id} style={tBtn(channel===ch.id)} onClick={()=>setChannel(ch.id)}>{ch.label}</button>)}</div>

      <div style={{ display:"flex", gap:8, marginTop:14, alignItems:"center", flexWrap:"wrap" }}>
        <input value={quickName} onChange={(e)=>setQuickName(e.target.value)} onKeyDown={(e)=>{ if(e.key==="Enter") quickAdd(); }}
          placeholder="Add a product to the analysis…"
          style={{ fontFamily:sans, fontSize:13.5, padding:"8px 12px", border:`1px solid ${c.line}`, borderRadius:2, background:c.panel, color:c.ink, flex:1, minWidth:200, maxWidth:360 }} />
        <button onClick={quickAdd} style={{ fontFamily:sans, fontSize:13, cursor:"pointer", padding:"8px 18px", borderRadius:2, border:`1px solid ${c.ink}`, background:c.ink, color:c.bg }}>Add</button>
        <span style={{ fontSize:12, color:c.sub, fontStyle:"italic" }}>creates it on the {channel==="all"?"Shopify":CHANNELS.find(x=>x.id===channel)?.label} tab — fill in details next</span>
      </div>

      <div style={S.sec}>Sales by Period <span style={{ fontSize:12, color:c.sub, fontStyle:"italic" }}>— actual {salesMetric==="net"?"net":"gross"} sales per window</span><div style={faintEs}>Ventas por período — ventas {salesMetric==="net"?"netas":"brutas"} reales por ventana</div></div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
        <button style={pBtn(salesMetric==="net")} onClick={()=>setSalesMetric("net")}>Net Sales</button>
        <button style={pBtn(salesMetric==="gross")} onClick={()=>setSalesMetric("gross")}>Gross Sales</button>
      </div>
      {(() => {
        const pts = series.pts; const W=600, H=190, padL=14, padR=14, padT=26, padB=34;
        const innerW=W-padL-padR, innerH=H-padT-padB;
        const max=Math.max(...pts.map(p=>p.rate),1);
        const slot=innerW/pts.length, bw=Math.min(64, slot*0.5);
        const xOf=(i)=>padL+(i+0.5)*slot; const yOf=(r)=>padT+innerH-(r/max)*innerH;
        const wp=series.wowPct;
        const trendEn = wp>0.03?`up ${pct(Math.abs(wp))} from last week`:wp<-0.03?`down ${pct(Math.abs(wp))} from last week`:"about flat vs last week";
        const trendEs = wp>0.03?`subió ${pct(Math.abs(wp))} vs la semana pasada`:wp<-0.03?`bajó ${pct(Math.abs(wp))} vs la semana pasada`:"casi sin cambio vs la semana pasada";
        const word = wp>0.03?"growing":wp<-0.03?"declining":"steady";
        const wordEs = wp>0.03?"creciendo":wp<-0.03?"cayendo":"estable";
        return (
        <div style={{ ...S.panel }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth:760, display:"block", margin:"0 auto" }}>
            <line x1={padL} y1={padT+innerH} x2={W-padR} y2={padT+innerH} stroke={c.line} strokeWidth="1" />
            <polyline fill="none" stroke={c.clay} strokeWidth="1.5" strokeDasharray="3 3" points={pts.map((p,i)=>`${xOf(i)},${yOf(p.rate)}`).join(" ")} />
            {pts.map((p,i)=>{ const isNow=p.id==="current"; const bh=(p.rate/max)*innerH; const y=padT+innerH-bh;
              return (<g key={p.id}>
                <rect x={xOf(i)-bw/2} y={y} width={bw} height={Math.max(bh,1)} rx="2" fill={isNow?c.gold:c.sage} opacity={isNow?1:0.8} />
                <text x={xOf(i)} y={y-7} textAnchor="middle" fontFamily={sans} fontSize="11" fill={c.ink}>{money(p.rate)}</text>
                <text x={xOf(i)} y={padT+innerH+15} textAnchor="middle" fontFamily={sans} fontSize="10.5" fill={c.sub}>{p.label}</text>
                <text x={xOf(i)} y={padT+innerH+28} textAnchor="middle" fontFamily={sans} fontSize="9" fontStyle="italic" fill="rgba(111,102,87,0.6)">{p.labelEs}</text>
              </g>);
            })}
          </svg>
          <div style={{ fontSize:13.5, lineHeight:1.5, marginTop:10, color:c.ink }}>{salesMetric==="net"?"Net":"Gross"} sales this week: <b>{money(series.cur)}</b>, <b style={{ color:word==="declining"?c.red:word==="growing"?c.green:c.sub }}>{trendEn}</b> ({money(series.prev)} last week). Bars show actual sales in each window.{series.live?"":" Showing the seeded estimate — connect live sales to replace it."}{livePartial?" Amazon live sales are coming next — this currently reflects Shopify only.":""}{shopifyLimited && (channel==="shopify"||channel==="all")?" ⚠ Quarter & Year reflect only Shopify's last ~60 days — grant read_all_orders for full history.":""}</div>
          <div style={{ ...faintEs, fontSize:11.5 }}>Ventas {salesMetric==="net"?"netas":"brutas"} de esta semana: {money(series.cur)}, {trendEs} ({money(series.prev)} la semana pasada). Las barras muestran ventas reales por ventana.{livePartial?" Las ventas en vivo de Amazon vienen pronto — esto refleja solo Shopify.":""}</div>
        </div>);
      })()}

      <div style={S.sec}>Executive Dashboard <span style={{ fontSize:12, color:c.sub, fontStyle:"italic" }}>— {dvLive?"revenue is live; profit is modeled margin on live sales":"tap any tile to audit its line items"}</span><div style={faintEs}>Panel ejecutivo — {dvLive?"el ingreso es real; la ganancia es margen modelado sobre ventas reales":"toca cualquier tarjeta para auditar sus partidas"}</div></div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(165px, 1fr))", gap:12 }}>
        <KPI k="revenue" label="Revenue" labelEs="Ingreso" value={money(dv.revenue)} big />
        <KPI k="gross" label="Gross Profit" labelEs="Ganancia bruta" value={money(dv.gross)} note={dv.revenue?pct(dv.gross/dv.revenue)+" margin":""} />
        <KPI k="net" label="Net Profit" labelEs="Ganancia neta" value={money(dv.net)} note="before ads & marketing" />
        <KPI k="netAfterAds" label="Net After Ads" labelEs="Neto tras anuncios" level={marginLevel} value={money(dv.netAfterAds)} note={<Delta now={wow.cur} prev={wow.prv} />} big />
        <KPI k="marketing" label="Weekly Marketing" labelEs="Marketing semanal" level={tacosLevel} value={money(dv.marketing)} note={"TACOS "+pct(tacos)} />
        <KPI k="inventory" label="Inventory Value" labelEs="Valor de inventario" value={money(dv.inventory)} note={channel==="all"?"all stock pools":channel==="b2b"?"Atlas consignment":channel==="amazon"?"FBA stock":"Shopify on-hand"} />
      </div>

      {drawer()}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(230px, 1fr))", gap:12, marginTop:12 }}>
        <Callout level="green" label="Best Product" labelEs="Mejor producto" name={ex.best?.p.name} sub={ex.best&&`${money(ex.best.m.netAfterAds)} profit · ${pct(ex.best.m.netMargin)} margin`} status={ex.best?effStatus(ex.best.p.id,ex.best.m,channel):null} onClick={ex.best?()=>setKeepProduct(ex.best.p.id):undefined} />
        <Callout level="red" label={ex.worstAlsoRisk?"Worst · Biggest Risk":"Worst Product"} labelEs={ex.worstAlsoRisk?"Peor · Mayor riesgo":"Peor producto"} name={ex.worst?.p.name} sub={ex.worst&&(()=>{ const t=num(kdOf(ex.worst.p.id,channel==='all'?ex.worst.p.channels[0]:channel).profit); const u=ex.worst.m.profitPerUnit>0?Math.ceil(t/ex.worst.m.profitPerUnit):null; const base=`${money(ex.worst.m.netAfterAds)} profit · ${u?`~${u} units/wk clears ${money(t)}`:"loses money/unit — fix margin first"}`; return ex.worstAlsoRisk?`${base} · ${ex.worst.m.weeksRemaining.toFixed(1)} wks stock`:base; })()} status={ex.worst?effStatus(ex.worst.p.id,ex.worst.m,channel):null} onClick={ex.worst?()=>setKeepProduct(ex.worst.p.id):undefined} />
        <Callout level="yellow" label="Biggest Opportunity" labelEs="Mayor oportunidad" name={ex.opp?.p.name} sub={ex.opp&&`score ${ex.opp.sc}/100 · room to scale`} status={ex.opp?effStatus(ex.opp.p.id,ex.opp.m,channel):null} onClick={ex.opp?()=>setKeepProduct(ex.opp.p.id):undefined} />
        <Callout level="red" label={ex.worstAlsoRisk?"Next at Risk":"Biggest Risk"} labelEs={ex.worstAlsoRisk?"Siguiente en riesgo":"Mayor riesgo"} name={ex.risk?.p.name} sub={ex.risk&&(ex.risk.m.netAfterAds<=0?"losing money on hand":`~${ex.risk.m.weeksRemaining.toFixed(1)} wks of stock`)} status={ex.risk?effStatus(ex.risk.p.id,ex.risk.m,channel):null} onClick={ex.risk?()=>setKeepProduct(ex.risk.p.id):undefined} />
      </div>
      {keepProduct!=null && (()=>{ const kp=eprods.find((x)=>x.id===keepProduct); if(!kp) return null; return <KeepScorecard product={kp} period={period} defaultChannel={channel} keepData={keep[kp.id]||{}} onField={(ch,f,v)=>setKeepField(kp.id,ch,f,v)} onClose={()=>setKeepProduct(null)} />; })()}

      <div style={S.sec}>This Week's Actions<div style={faintEs}>Acciones de esta semana</div></div>
      <div style={S.panel}>
        {recs.length===0&&<div style={{ color:c.sub }}>No urgent actions for the selected channel.<div style={faintEs}>No hay acciones urgentes para el canal seleccionado.</div></div>}
        {recs.map((r,i)=>{
          const as = assignees[r.key]||{};
          const subj = `Lavalle Haus — ${r.title}`;
          const body = `${r.action}\n\nWhy this matters: ${r.achieves}\n\n— Lavalle Haus OS`;
          const mailto = as.email ? `mailto:${as.email}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}` : null;
          const ain = { fontFamily:sans, fontSize:12.5, padding:"4px 7px", border:`1px solid ${c.line}`, borderRadius:2, background:c.panel, color:c.ink };
          return (
          <div key={r.key||i} style={{ display:"flex", gap:12, alignItems:"flex-start", padding:"13px 0", borderBottom:i<recs.length-1?`1px solid ${c.lineSoft}`:"none" }}>
            <span style={{ color:r.color, fontFamily:sans, fontWeight:700, width:18, textAlign:"center", flexShrink:0, paddingTop:2 }}>{r.icon}</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14.5, lineHeight:1.45 }}>{r.action}</div>
              <div style={{ ...faintEs, fontSize:11.5 }}>{r.actionEs}</div>
              <div style={{ fontSize:12.5, color:c.sage, marginTop:5, fontStyle:"italic" }}>Achieves: {r.achieves}</div>
              <div style={{ ...faintEs, fontSize:11 }}>Logra: {r.achievesEs}</div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginTop:9 }}>
                <span style={{ fontFamily:sans, fontSize:9.5, letterSpacing:0.5, textTransform:"uppercase", color:c.sub }}>Assign · <i>asignar</i></span>
                <select value={as.custom?"custom":(as.email||"")} onChange={(ev)=>{ const v=ev.target.value; if(v===""){ setAssignee(r.key,{ name:"", email:"", custom:false }); } else if(v==="custom"){ setAssignee(r.key,{ custom:true }); } else { const t=TEAM.find((t)=>t.email===v); setAssignee(r.key,{ name:t?t.name:"", email:v, custom:false }); } }} style={{ ...ain, width:175 }}>
                  <option value="">Unassigned · sin asignar</option>
                  {TEAM.map((t)=><option key={t.email} value={t.email}>{t.name}</option>)}
                  <option value="custom">+ Add manually · agregar</option>
                </select>
                {as.custom && <input value={as.name||""} placeholder="Name · nombre" onChange={(ev)=>setAssignee(r.key,{ name:ev.target.value })} style={{ ...ain, width:120 }} />}
                {as.custom && <input value={as.email||""} type="email" placeholder="email@…" onChange={(ev)=>setAssignee(r.key,{ email:ev.target.value })} style={{ ...ain, width:160 }} />}
                <a href={mailto||undefined} onClick={(ev)=>{ if(!mailto){ ev.preventDefault(); } }}
                  style={{ fontFamily:sans, fontSize:12, textDecoration:"none", padding:"5px 12px", borderRadius:2, border:`1px solid ${mailto?c.ink:c.line}`, background:mailto?c.ink:"transparent", color:mailto?c.bg:c.sub, cursor:mailto?"pointer":"not-allowed", whiteSpace:"nowrap" }}>✉ Send · enviar</a>
              </div>
            </div>
          </div>);
        })}
        <div style={{ fontSize:11.5, color:c.sub, fontStyle:"italic", marginTop:12, lineHeight:1.6 }}>Add a name + email, then tap Send to open a pre-filled email assigning that task. <span style={faintEs}>Agrega nombre + correo y toca Enviar para abrir un correo prellenado asignando esa tarea.</span></div>
      </div>

      {/* PRODUCT MATRIX */}
      <div style={{ ...S.sec, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span>Product Profit Matrix<div style={faintEs}>Matriz de ganancia por producto</div></span>
        <button onClick={openAdd} style={{ fontFamily:sans, fontSize:12.5, cursor:"pointer", padding:"6px 14px", borderRadius:2, border:`1px solid ${c.ink}`, background:c.ink, color:c.bg }}>+ Add product</button>
      </div>
      {draft && <ProductForm draft={draft} setDraft={setDraft} onSave={saveProduct} onCancel={()=>setDraft(null)} onDelete={deleteProduct} />}
      <div style={{ ...S.panel, padding:0, overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:920 }}>
          <thead><tr>
            <th style={{ ...S.th, ...S.thL }}>Product<div style={faintEs}>Producto</div></th><th style={S.th}>Units<div style={faintEs}>Unidades</div></th><th style={S.th}>Revenue<div style={faintEs}>Ingreso</div></th>
            <th style={S.th}>CM / Unit<div style={faintEs}>MC / unidad</div></th><th style={S.th}>Net Margin<div style={faintEs}>Margen neto</div></th><th style={S.th}>Profit / Unit<div style={faintEs}>Ganancia / unidad</div></th>
            <th style={S.th}>Wk Profit<div style={faintEs}>Ganancia sem.</div></th><th style={S.th}>B/E ROAS<div style={faintEs}>ROAS equil.</div></th><th style={S.th}>ROAS</th>
            <th style={S.th}>Score<div style={faintEs}>Puntaje</div></th><th style={{ ...S.th, ...S.thL }}>Decision<div style={faintEs}>Decisión</div></th>
          </tr></thead>
          <tbody>
            {rows.map(({p,m,sc,d,status})=>(
              <Fragment key={p.id}>
                <tr style={{ cursor:"pointer", background:open===p.id?c.bg:"transparent" }} onClick={()=>setOpen(open===p.id?null:p.id)}>
                  <td style={{ ...S.td, ...S.tdL }}>
                    <div style={{ fontSize:14 }}>{p.name}</div>
                    <div style={{ fontSize:11, color:c.sub, fontFamily:sans }}>{p.sku}{p.reorderLink?" · ":""}{p.reorderLink&&<a href={p.reorderLink} target="_blank" rel="noreferrer" onClick={(e)=>e.stopPropagation()} style={{ color:c.clay }}>reorder ↗</a>} · <a onClick={(e)=>{e.stopPropagation();openEdit(p);}} style={{ color:c.clay, cursor:"pointer" }}>edit</a></div>
                  </td>
                  <td style={S.td}>{m.units.toFixed(0)}</td>
                  <td style={S.td}>{money(m.revenue)}</td>
                  <td style={S.td}>{money2(m.cmPerUnit)}<span style={{ color:c.sub, fontSize:11 }}> {pct(m.cmPct)}</span></td>
                  <td style={{ ...S.td, color:m.netMargin>=0.2?c.green:m.netMargin>0?c.ink:c.red }}>{pct(m.netMargin)}</td>
                  <td style={{ ...S.td, color:m.profitPerUnit>=0?c.ink:c.red }}>{money2(m.profitPerUnit)}</td>
                  <td style={{ ...S.td, color:m.netAfterAds>=0?c.ink:c.red }}>{money(m.netAfterAds)}</td>
                  <td style={S.td}>{m.breakevenRoas===Infinity?"—":m.breakevenRoas.toFixed(1)+"x"}</td>
                  <td style={{ ...S.td, color:m.roas==null?c.sub:m.roas>=m.breakevenRoas?c.green:c.red }}>{m.roas==null?"—":m.roas.toFixed(1)+"x"}</td><td style={S.td}><span style={{ fontFamily:sans, fontSize:13 }}>{sc}</span>
                    <span style={{ display:"inline-block", width:38, height:4, background:c.lineSoft, borderRadius:4, marginLeft:6, verticalAlign:"middle", position:"relative" }}>
                      <span style={{ position:"absolute", left:0, top:0, height:4, borderRadius:4, width:sc+"%", background:sc>=70?c.green:sc>=45?c.gold:c.red }} /></span></td>
                  <td style={{ ...S.td, ...S.tdL }}><Tag text={d.tag} color={d.color} />{status&&<span style={{ marginLeft:6, fontFamily:sans, fontSize:10.5, letterSpacing:0.4, textTransform:"uppercase", color:status==="keep"?c.green:status==="maybe"?c.gold:c.red }}>· {status}</span>}</td>
                </tr>
                {open===p.id&&(
                  <tr><td colSpan={11} style={{ background:c.bg, padding:"14px 16px", borderBottom:`1px solid ${c.line}` }}>
                    <div style={{ fontSize:13.5, fontStyle:"italic", marginBottom:10 }}>{d.why}</div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px,1fr))", gap:10, fontSize:12.5 }}>
                      <D k="Retail / Wholesale" v={`${money2(num(p.retail))} / ${money2(num(p.wholesale))}`} />
                      <D k="Landed unit cost" v={money2(unitCost(p))} sub="COGS + pkg + freight" />
                      <D k="Gross margin" v={pct(m.grossMargin)} />
                      <D k="Max CPA (break-even)" v={money2(m.maxCPA)} />
                      {channel==="b2b"&&<D k="Atlas commission (3%)" v={money2(num(p.wholesale)*B2B.atlasCommissionPct)+"/unit"} />}
                      <D k={`${channel==="all"?"Total":channel==="b2b"?"Atlas":channel} stock`} v={`${m.inv}${channel==="amazon"&&num(p.inbound)?` (+${num(p.inbound)} inbound)`:""}`} />
                      <D k="Weeks remaining" v={m.weeksRemaining.toFixed(1)} level={m.weeksRemaining<num(p.leadWeeks)+1?"red":m.weeksRemaining<8?"yellow":"green"} />
                      <D k="Est. stockout" v={m.velocity>0.001?m.stockout.toLocaleDateString("en-US",{month:"short",day:"numeric"}):"—"} />
                      <D k="Reorder point" v={`${m.reorderPoint} units`} />
                      <D k="Cash to reorder" v={money(m.cashForReorder)} sub={`~${m.reorderQty} units`} />
                      <D k="Inventory value" v={money(m.invValue)} />
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* PROFIT LEDGER (sales + all expenses + net profit, one table) */}
      {(() => {
        const totalRevenue = ex.revenue;
        const productCosts = ex.revenue - ex.net;
        const adSpend = ex.productAd;
        const mktTotal = ex.opex;
        const net = ex.netAfterAds;
        const chName = (ch)=> ch==="b2b"?"B2B":ch[0].toUpperCase()+ch.slice(1);
        const dInp = { fontFamily:sans, fontSize:12.5, padding:"4px 6px", border:`1px solid ${c.line}`, borderRadius:2, background:c.panel, color:c.ink };
        const grpTd = { ...S.td, ...S.tdL, fontFamily:sans, fontSize:11, letterSpacing:0.8, textTransform:"uppercase", color:c.sub, background:c.bg, paddingTop:12, paddingBottom:8 };
        const lblTd = { ...S.td, ...S.tdL, fontFamily:sans };
        return (<>
          <div style={S.sec}>Profit Ledger <span style={{ fontSize:12, color:c.sub, fontStyle:"italic" }}>— sales, every expense &amp; net profit in one table</span><div style={faintEs}>Libro de ganancias — ventas, cada gasto y la ganancia neta en una tabla</div></div>
          <div style={{ ...S.panel, padding:0, overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", minWidth:700 }}>
              <thead><tr>
                <th style={{ ...S.th, ...S.thL }}>Date<div style={faintEs}>Fecha</div></th>
                <th style={{ ...S.th, ...S.thL }}>Entry<div style={faintEs}>Entrada</div></th>
                <th style={{ ...S.th, ...S.thL }}>Type<div style={faintEs}>Tipo</div></th>
                <th style={{ ...S.th, ...S.thL }}>Channel<div style={faintEs}>Canal</div></th>
                <th style={S.th}>Amount<div style={faintEs}>Monto</div></th>
                <th style={S.th}></th>
              </tr></thead>
              <tbody>
                <tr><td colSpan={6} style={grpTd}>Sales · Ventas</td></tr>
                {ledger.sales.length===0 && <tr><td colSpan={6} style={{ ...S.td, ...S.tdL, color:c.sub }}>No sales for this channel/period.</td></tr>}
                {ledger.sales.map((x,i)=>(
                  <tr key={"s"+i}>
                    <td style={{ ...S.td, ...S.tdL }}><input type="date" value={x.date} onChange={(e)=>setField(x.pid,"dates",e.target.value,x.ch)} style={dInp} /></td>
                    <td style={{ ...S.td, ...S.tdL }}>{x.name}</td>
                    <td style={{ ...S.td, ...S.tdL }}><Tag text="Sale · venta" color={c.sage} /></td>
                    <td style={{ ...S.td, ...S.tdL, color:c.sub }}>{chName(x.ch)}</td>
                    <td style={{ ...S.td, color:c.ink }}>+{money(x.amount)}</td>
                    <td style={S.td}></td>
                  </tr>
                ))}
                <tr><td colSpan={4} style={lblTd}>Total revenue · <i>ingreso total</i></td><td style={{ ...S.td, fontFamily:sans }}>{money(totalRevenue)}</td><td style={S.td}></td></tr>

                <tr><td colSpan={6} style={grpTd}>Costs &amp; Expenses · Costos y gastos</td></tr>
                <tr><td style={{ ...S.td, ...S.tdL, color:c.sub }}>—</td><td style={{ ...S.td, ...S.tdL }}>Product costs — COGS, fees, shipping, returns<div style={faintEs}>Costos de producto — COGS, tarifas, envío, devoluciones</div></td><td style={{ ...S.td, ...S.tdL }}><Tag text="Cost · costo" color={c.clay} /></td><td style={{ ...S.td, ...S.tdL, color:c.sub }}>—</td><td style={{ ...S.td, color:c.red }}>−{money(productCosts)}</td><td style={S.td}></td></tr>
                <tr><td style={{ ...S.td, ...S.tdL, color:c.sub }}>—</td><td style={{ ...S.td, ...S.tdL }}>Per-product ad spend (Amazon PPC / Meta)<div style={faintEs}>Gasto en anuncios por producto</div></td><td style={{ ...S.td, ...S.tdL }}><Tag text="Cost · costo" color={c.clay} /></td><td style={{ ...S.td, ...S.tdL, color:c.sub }}>—</td><td style={{ ...S.td, color:c.red }}>−{money(adSpend)}</td><td style={S.td}></td></tr>
                {opex.map((o)=>(
                  <tr key={o.id}>
                    <td style={{ ...S.td, ...S.tdL }}><input type="date" value={o.date||""} onChange={(e)=>editOpex(o.id,"date",e.target.value)} style={dInp} /></td>
                    <td style={{ ...S.td, ...S.tdL, whiteSpace:"normal", minWidth:230 }}>
                      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        <input value={o.label} onChange={(e)=>editOpex(o.id,"label",e.target.value)} style={{ ...sel, width:"100%", boxSizing:"border-box" }} />
                        <select value={o.category} onChange={(e)=>editOpex(o.id,"category",e.target.value)} style={{ ...sel, width:"100%", boxSizing:"border-box" }}>{OPEX_CATS.map(x=><option key={x} value={x}>{`${x} · ${OPEX_CAT_ES[x]}`}</option>)}</select>
                      </div>
                    </td>
                    <td style={{ ...S.td, ...S.tdL }}><Tag text="Expense · gasto" color={c.clay} /></td>
                    <td style={{ ...S.td, ...S.tdL }}><select value={o.channel} onChange={(e)=>editOpex(o.id,"channel",e.target.value)} style={sel} disabled={o.locked}>{CHANNELS.filter(x=>x.id!=="all").map(x=><option key={x.id} value={x.id}>{x.label}{x.id==="b2b"?" · Mayoreo":""}</option>)}</select></td>
                    <td style={{ ...S.td, color:c.red }}><span style={{ display:"inline-flex", alignItems:"center", justifyContent:"flex-end", gap:2 }}>−<Edit value={o.weekly} onChange={(v)=>editOpex(o.id,"weekly",v)} disabled={o.locked} w={72} /></span></td>
                    <td style={S.td}>{!o.locked&&<button onClick={()=>delOpex(o.id)} style={{ cursor:"pointer", border:"none", background:"transparent", color:c.sub, fontSize:16 }}>×</button>}</td>
                  </tr>
                ))}
                <tr><td colSpan={6} style={{ ...S.td, ...S.tdL }}><button onClick={addOpex} style={{ fontFamily:sans, fontSize:12.5, cursor:"pointer", padding:"5px 12px", borderRadius:2, border:`1px solid ${c.line}`, background:"transparent", color:c.clay }}>+ Add expense · agregar gasto</button></td></tr>
                <tr><td colSpan={4} style={lblTd}>Total costs &amp; expenses · <i>costos y gastos totales</i></td><td style={{ ...S.td, fontFamily:sans, color:c.red }}>−{money(productCosts+adSpend+mktTotal)}</td><td style={S.td}></td></tr>

                <tr><td colSpan={4} style={{ ...S.td, ...S.tdL, fontFamily:sans, fontSize:15, borderTop:`2px solid ${c.ink}` }}>Net Profit · <i>ganancia neta</i></td><td style={{ ...S.td, fontFamily:sans, fontSize:15, borderTop:`2px solid ${c.ink}`, color:net>=0?c.green:c.red }}>{net>=0?money(net):"−"+money(Math.abs(net))}</td><td style={{ ...S.td, borderTop:`2px solid ${c.ink}` }}></td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ fontSize:12, color:c.sub, fontStyle:"italic", marginTop:8, lineHeight:1.6 }}>
            Net Profit = revenue − product costs (COGS, fees, shipping) − ad spend − marketing/channel expenses, matching the Net After Ads tile. Atlas B2B adds {money(B2B.atlasPlacementPerQuarter)}/quarter placement plus {pct(B2B.atlasCommissionPct)} commission per B2B sale. Edit sales in the matrix above; edit expenses inline here. <span style={faintEs}>Ganancia neta = ingreso − costos de producto − anuncios − gastos de marketing/canal.</span>
          </div>
        </>);
      })()}

      {/* CROSS-CHANNEL */}
      <div style={S.sec}>Cross-Channel Comparison<div style={faintEs}>Comparación entre canales</div></div>
      <div style={{ ...S.panel, padding:0, overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:640 }}>
          <thead><tr><th style={{ ...S.th, ...S.thL }}>Product<div style={faintEs}>Producto</div></th><th style={S.th}>Shopify Profit<div style={faintEs}>Ganancia Shopify</div></th><th style={S.th}>Amazon Profit<div style={faintEs}>Ganancia Amazon</div></th><th style={S.th}>B2B Profit<div style={faintEs}>Ganancia B2B</div></th><th style={{ ...S.th, ...S.thL }}>Best Channel<div style={faintEs}>Mejor canal</div></th><th style={{ ...S.th, ...S.thL }}>Weakest Channel<div style={faintEs}>Canal más débil</div></th></tr></thead>
          <tbody>
            {eprods.map((p)=>{
              const sh=metrics(p,"shopify",period).netAfterAds, am=metrics(p,"amazon",period).netAfterAds, bb=metrics(p,"b2b",period).netAfterAds;
              const vals=[{n:"Shopify",v:sh,on:p.channels.includes("shopify")},{n:"Amazon",v:am,on:p.channels.includes("amazon")},{n:"B2B",v:bb,on:p.channels.includes("b2b")}].filter(x=>x.on);
              const best=vals.length?vals.reduce((a,b)=>b.v>a.v?b:a):{n:"—"};
              const weak=vals.length?vals.reduce((a,b)=>b.v<a.v?b:a):{n:"—"};
              const cell=(v,on)=><td style={{ ...S.td, color:!on?c.sub:v>=0?c.ink:c.red }}>{on?money(v):"—"}</td>;
              const isOpen=crossOpen===p.id; const w=crossWhy(p,period);
              return (<Fragment key={p.id}>
                <tr onClick={()=>setCrossOpen(isOpen?null:p.id)} style={{ cursor:"pointer", background:isOpen?c.bg:"transparent" }}>
                  <td style={{ ...S.td, ...S.tdL }}>{p.name} <span style={{ fontFamily:sans, fontSize:10.5, color:c.clay, whiteSpace:"nowrap" }}>{isOpen?"▴":"▾"} why · por qué</span></td>
                  {cell(sh,p.channels.includes("shopify"))}{cell(am,p.channels.includes("amazon"))}{cell(bb,p.channels.includes("b2b"))}
                  <td style={{ ...S.td, ...S.tdL }}>{vals.length?<Tag text={best.n} color={c.sage} />:"—"}</td>
                  <td style={{ ...S.td, ...S.tdL }}>{vals.length>1 ? <Tag text={weak.n} color={c.red} /> : <span style={{ color:c.sub, fontStyle:"italic", fontSize:12 }}>only channel · único canal</span>}</td>
                </tr>
                {isOpen && <tr><td colSpan={6} style={{ background:c.bg, padding:"4px 16px 14px", borderBottom:`1px solid ${c.line}` }}>
                  <div style={{ fontSize:13, lineHeight:1.55, color:c.ink }}><b style={{ fontFamily:serif }}>{p.name}</b> — {w.en}</div>
                  <div style={{ ...faintEs, fontSize:11.5 }}>{p.name} — {w.es}</div>
                </td></tr>}
              </Fragment>);
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop:26, fontSize:12, color:c.sub, fontStyle:"italic", lineHeight:1.6 }}>
        Inventory is now channel-routed (Amazon FBA / Shopify on-hand / Atlas consignment), so Inventory Value changes with the channel toggle. Tap any dashboard tile to audit and edit its line items; the manual adjustment field reconciles to bank/payout actuals. Save audit writes products + expenses + adjustments back via onSave. Seeded figures are placeholders from the marketing ledger — verify against your books.
      </div>
    </div>
  );
}

function Callout({ level, label, labelEs, name, sub, status, onClick }) {
  const sb = status ? { keep:{ t:"Keep", col:c.green }, maybe:{ t:"Maybe", col:c.gold }, cut:{ t:"Cut", col:c.red } }[status] : null;
  return (<div onClick={onClick} style={{ background:c.panel, border:`1px solid ${status?sb.col:c.line}`, borderRadius:4, padding:18, cursor:onClick?"pointer":"default" }}>
    <div style={{ fontFamily:sans, fontSize:11, letterSpacing:1.3, textTransform:"uppercase", color:c.sub }}><Dot level={level} />{label}{onClick&&<span style={{ float:"right", fontSize:10, color:c.sub, letterSpacing:0.5 }}>▾ review</span>}</div>
    {labelEs&&<div style={faintEs}>{labelEs}</div>}
    <div style={{ fontSize:16, marginTop:5 }}>{name||"—"}</div>
    {sub&&<div style={{ fontSize:12.5, color:c.sub }}>{sub}</div>}
    {sb&&<div style={{ marginTop:7 }}><span style={{ fontFamily:sans, fontSize:10.5, letterSpacing:0.5, textTransform:"uppercase", color:sb.col, border:`1px solid ${sb.col}`, borderRadius:2, padding:"1px 7px" }}>Marked: {sb.t}</span></div>}
  </div>);
}
function D({ k, v, sub, level }) {
  return (<div>
    <div style={{ fontFamily:sans, fontSize:10.5, letterSpacing:0.5, textTransform:"uppercase", color:c.sub }}>{level&&<Dot level={level} />}{k}</div>
    <div style={{ fontSize:15, marginTop:2 }}>{v}</div>{sub&&<div style={{ fontSize:11, color:c.sub }}>{sub}</div>}
  </div>);
}
