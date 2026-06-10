import { useMemo } from "react";

/* ============================================================================
   LAVALLE HAUS OS — AI COO
   The synthesis layer that sits on top of every tab. It reads the data you
   already track (inventory, ads, weekly numbers, COGS) and produces:
     1) a Monday Weekly Brief, and
     2) Decision Engine cards (Observation → Root Cause → Recommendation →
        Expected Outcome → Confidence).
   As live integrations (Shopify, Meta, Google, Klaviyo, QuickBooks, SP-API)
   come online, each new feed makes the brief smarter — sections marked
   "pending" below are the ones waiting on those connections.

       <AICoo products={...} campaigns={...} weeks={...} materials={...} cogs={...} />
   ========================================================================== */

const c = {
  bg: "#f7f4ef", panel: "#fffdf9", ink: "#2b2620", sub: "#6f6657",
  line: "#e4ddd0", lineSoft: "#efe9de", sage: "#6b7257", clay: "#a8643c", gold: "#b08d57",
  green: "#5c7a52", yellow: "#b78b2e", red: "#a8483a",
};
const serif = "'IM Fell English', Georgia, 'Times New Roman', serif";
const sans = "'IM Fell English', Georgia, serif";
const faintEs = { fontFamily: sans, fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 1, lineHeight: 1.3 };

const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? 0 : Number(v));
const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(num(n)).toLocaleString("en-US", { maximumFractionDigits: 0 });
const money2 = (n) => (n < 0 ? "-$" : "$") + Math.abs(num(n)).toFixed(2);

const weeksCover = (available, sold30) => { if (num(sold30) === 0) return num(available) > 0 ? 99 : 0; return Math.round((num(available) / num(sold30)) * 4.3); };
const invStatus = (p) => {
  if (p.status === "inbound") return "inbound";
  if (num(p.available) === 0) return "out";
  const w = weeksCover(p.available, p.unitsSold30);
  if (w < 6) return "low";
  if (w > 50 && num(p.unitsSold30) < 3) return "slow";
  return "ok";
};

const S = {
  wrap: { fontFamily: serif, color: c.ink, background: c.bg, padding: "26px 22px 60px", maxWidth: 1180, margin: "0 auto" },
  h1: { fontFamily: serif, fontSize: 30, fontWeight: 400, letterSpacing: 0.3, margin: 0 },
  sub: { color: c.sub, fontSize: 14.5, marginTop: 4, fontStyle: "italic" },
  sec: { fontSize: 19, fontWeight: 400, margin: "28px 0 12px", letterSpacing: 0.3, borderBottom: `1px solid ${c.line}`, paddingBottom: 8 },
  panel: { background: c.panel, border: `1px solid ${c.line}`, borderRadius: 4, padding: 18 },
  cap: { fontFamily: sans, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: c.sub },
};

function currentMonday() {
  const t = new Date(); const day = t.getDay(); const diff = (day === 0 ? -6 : 1) - day;
  const m = new Date(t); m.setDate(t.getDate() + diff);
  return m.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function confColor(n) { return n >= 85 ? c.green : n >= 70 ? c.gold : c.sub; }

const Metric = ({ label, labelEs, value, note, pending }) => (
  <div style={{ ...S.panel, padding: "14px 16px", opacity: pending ? 0.7 : 1 }}>
    <div style={S.cap}>{label}</div><div style={faintEs}>{labelEs}</div>
    <div style={{ fontSize: pending ? 14 : 24, marginTop: 6, color: pending ? c.sub : c.ink, fontStyle: pending ? "italic" : "normal" }}>{value}</div>
    {note && <div style={{ fontSize: 11.5, color: c.sub, marginTop: 3 }}>{note}</div>}
  </div>
);

const Bullets = ({ items, color }) => (
  items.length ? (
    <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
      {items.map((t, i) => <li key={i} style={{ fontSize: 13.5, color: c.ink, marginBottom: 5, lineHeight: 1.4 }}><span style={{ color: color || c.ink }}>{t}</span></li>)}
    </ul>
  ) : <div style={{ fontSize: 12.5, color: c.sub, fontStyle: "italic", marginTop: 6 }}>Nothing flagged this week. · Nada marcado esta semana.</div>
);

export default function AICoo({ products = [], campaigns = [], weeks = [], materials = [], cogs = {} }) {
  const brief = useMemo(() => {
    const wk = weeks[0] || null, prev = weeks[1] || null;
    const revenue = wk ? num(wk.revenue) : 0;
    const revPrev = prev ? num(prev.revenue) : 0;
    const revDelta = revPrev > 0 ? (revenue - revPrev) / revPrev : null;
    const adSpend = wk ? num(wk.adSpend) : 0;
    const tacos = revenue > 0 ? adSpend / revenue : 0;

    const counts = { out: 0, low: 0, slow: 0, inbound: 0, ok: 0 };
    products.forEach((p) => { counts[invStatus(p)] = (counts[invStatus(p)] || 0) + 1; });
    const lowOrOut = products.filter((p) => ["out", "low"].includes(invStatus(p)));
    const slow = products.filter((p) => invStatus(p) === "slow");
    const inbound = products.filter((p) => invStatus(p) === "inbound");

    const spend7 = campaigns.reduce((s, x) => s + num(x.spend7d), 0);
    const sales7 = campaigns.reduce((s, x) => s + num(x.sales7d), 0);
    const blendedRoas = spend7 > 0 ? sales7 / spend7 : 0;
    const bleeders = campaigns.filter((x) => x.status === "pause" || (num(x.spend7d) >= 15 && num(x.sales7d) === 0));
    const bestCamp = campaigns.slice().sort((a, b) => num(b.roas) - num(a.roas))[0];

    // ── Decision Engine cards ──
    const cards = [];
    bleeders.forEach((x) => cards.push({
      obs: `${x.name}: ${money2(x.spend7d)} spent, ${num(x.sales7d) ? money2(x.sales7d) + " in sales" : "zero sales"} over 7 days.`,
      cause: "Ad spend without conversions — targeting or listing mismatch.",
      rec: `Pause "${x.name}" now and shift budget to your best ROAS campaign.`,
      outcome: `Stop ~${money(num(x.spend7d) * 4)}/mo of wasted spend.`, conf: 90,
    }));
    slow.forEach((p) => cards.push({
      obs: `${p.name}: ~${weeksCover(p.available, p.unitsSold30)} weeks of cover at ${num(p.unitsSold30)} units/mo.`,
      cause: "Overstock — demand is below the quantity on hand.",
      rec: "Pause ads on this SKU and run a promo or liquidation to free trapped cash.",
      outcome: `Recover cash tied up in ${num(p.available)} units.`, conf: 80,
    }));
    lowOrOut.forEach((p) => { const st = invStatus(p);
      cards.push({
        obs: `${p.name}: ${st === "out" ? "out of stock" : weeksCover(p.available, p.unitsSold30) + " weeks of cover"}${num(p.inbound) ? `, ${p.inbound} inbound` : ""}.`,
        cause: st === "out" ? "Sold through or launch pending." : "Sales velocity is outpacing stock.",
        rec: num(p.inbound) ? "Prep launch/restock campaigns timed to the inbound arrival." : "Place a reorder now to avoid a stockout and rank loss.",
        outcome: "Avoid lost sales and ranking slippage.", conf: st === "out" ? 85 : 75,
      });
    });
    if (bestCamp && num(bestCamp.roas) >= 2) cards.push({
      obs: `${bestCamp.name}: ROAS ${num(bestCamp.roas).toFixed(2)}× on ${money2(bestCamp.budget)}/day.`,
      cause: "A profitable, budget-constrained winner.",
      rec: "Raise the daily budget in steps (e.g. +50%) and watch ROAS hold.",
      outcome: "More profitable sales at a similar ROAS.", conf: 78,
    });

    const risks = [];
    if (bleeders.length) risks.push(`${bleeders.length} ad campaign${bleeders.length > 1 ? "s" : ""} spending with little or no return.`);
    products.filter((p) => invStatus(p) === "out" && !num(p.inbound)).forEach((p) => risks.push(`${p.name} is out of stock with nothing inbound.`));if (slow.length) risks.push(`${slow.length} SKU${slow.length > 1 ? "s are" : " is"} overstocked — cash sitting in slow inventory.`);
    if (tacos > 0.25) risks.push(`TACOS at ${(tacos * 100).toFixed(0)}% — ad spend is eating a large share of revenue.`);

    const opps = [];
    if (bestCamp && num(bestCamp.roas) >= 2) opps.push(`Scale "${bestCamp.name}" — ROAS ${num(bestCamp.roas).toFixed(2)}× has room to grow.`);
    inbound.forEach((p) => opps.push(`${p.name} restock inbound${num(p.inbound) ? ` (${p.inbound} units)` : ""} — line up launch campaigns.`));
    lowOrOut.filter((p) => num(p.unitsSold30) >= 8).forEach((p) => opps.push(`${p.name} is a fast seller running low — secure stock to protect momentum.`));

    const actions = cards.slice(0, 5).map((x) => x.rec);

    return { wk, revenue, revDelta, adSpend, tacos, counts, spend7, sales7, blendedRoas, cards: cards.slice(0, 6), risks, opps, actions };
  }, [products, campaigns, weeks]);

  const b = brief;
  const invSummary = `${b.counts.out} out · ${b.counts.low} low · ${b.counts.slow} slow · ${b.counts.ok} healthy`;

  return (
    <div style={S.wrap}>
      <div>
        <h1 style={S.h1}>AI COO — Weekly Brief</h1><div style={faintEs}>Director de operaciones AI — resumen semanal</div>
        <div style={S.sub}>Week of {currentMonday()} — what matters, and the highest-impact moves.</div>
        <div style={faintEs}>Semana del {currentMonday()} — lo que importa y las acciones de mayor impacto.</div>
      </div>

      {/* THE FIVE QUESTIONS */}
      <div style={{ ...S.panel, marginTop: 16, borderLeft: `3px solid ${c.gold}` }}>
        <div style={S.cap}>This system exists to answer · este sistema responde</div>
        <div style={{ fontSize: 13.5, color: c.ink, marginTop: 6, lineHeight: 1.5 }}>
          What should I do this week? · Which SKU should be reordered? · Which ad should be paused? · Which channel is most profitable? · Where is cash being trapped?
        </div>
      </div>

      {/* WEEKLY BRIEF METRICS */}
      <div style={S.sec}>The Numbers<div style={faintEs}>Los números</div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}>
        <Metric label="Revenue" labelEs="Ingresos"
          value={b.wk ? money(b.revenue) : "no week logged"} pending={!b.wk}
          note={b.revDelta != null ? `${b.revDelta >= 0 ? "▲" : "▼"} ${Math.abs(b.revDelta * 100).toFixed(0)}% vs last week` : "log weekly numbers to compare"} />
        <Metric label="Contribution (rough)" labelEs="Contribución (aprox.)"
          value={b.wk ? money(b.revenue - b.adSpend) : "—"} pending={!b.wk}
          note="revenue − ad spend · full profit needs per-SKU COGS mapping" />
        <Metric label="Cash Position" labelEs="Posición de caja" value="connect accounting" pending
          note="QuickBooks / Xero — pending" />
        <Metric label="Inventory Health" labelEs="Salud de inventario" value={invSummary}
          note={`${products.length} SKUs tracked`} />
        <Metric label="Advertising Health" labelEs="Salud de anuncios"
          value={b.spend7 > 0 ? `${b.blendedRoas.toFixed(2)}× ROAS` : "no ad data"} pending={b.spend7 === 0}
          note={b.spend7 > 0 ? `${money(b.spend7)} spend / ${money(b.sales7)} sales (7d)` : "Amazon/Meta/Google — pending live feeds"} />
      </div>

      {/* RISKS + OPPORTUNITIES */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px,1fr))", gap: 14, marginTop: 16 }}>
        <div style={S.panel}>
          <div style={{ fontSize: 16 }}>Top Risks</div><div style={faintEs}>Riesgos principales</div>
          <Bullets items={b.risks} color={c.red} />
        </div>
        <div style={S.panel}>
          <div style={{ fontSize: 16 }}>Top Opportunities</div><div style={faintEs}>Oportunidades principales</div>
          <Bullets items={b.opps} color={c.green} />
        </div>
      </div>

      {/* TOP 5 ACTIONS */}
      <div style={S.sec}>Top 5 Action Items<div style={faintEs}>5 acciones principales</div></div>
      <div style={S.panel}>
        {b.actions.length ? (
          <ol style={{ margin: 0, paddingLeft: 22 }}>
            {b.actions.map((a, i) => <li key={i} style={{ fontSize: 14, color: c.ink, marginBottom: 8, lineHeight: 1.45 }}>{a}</li>)}
          </ol>
        ) : <div style={{ fontSize: 13, color: c.sub, fontStyle: "italic" }}>No urgent actions detected from current data. · Sin acciones urgentes según los datos actuales.</div>}
      </div>

      {/* DECISION ENGINE */}
      <div style={S.sec}>Decision Engine<div style={faintEs}>Motor de decisiones</div></div>
      <div style={{ fontSize: 12, color: c.sub, fontStyle: "italic", marginBottom: 12 }}>
        Every recommendation as: Observation → Root Cause → Recommendation → Expected Outcome → Confidence.
        <div style={faintEs}>Cada recomendación: Observación → Causa raíz → Recomendación → Resultado esperado → Confianza.</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px,1fr))", gap: 14 }}>
        {b.cards.length ? b.cards.map((card, i) => (
          <div key={i} style={S.panel}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span style={S.cap}>Observation · observación</span>
              <span style={{ fontFamily: sans, fontSize: 12, color: confColor(card.conf) }}>{card.conf}% confidence</span>
            </div>
            <div style={{ fontSize: 14, marginTop: 4, lineHeight: 1.4 }}>{card.obs}</div>
            <div style={{ marginTop: 10 }}><span style={S.cap}>Root cause · causa</span><div style={{ fontSize: 13, marginTop: 2 }}>{card.cause}</div></div>
            <div style={{ marginTop: 10 }}><span style={S.cap}>Recommendation · recomendación</span><div style={{ fontSize: 13, marginTop: 2 }}>{card.rec}</div></div>
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.lineSoft}` }}>
              <span style={S.cap}>Expected outcome · resultado</span><div style={{ fontSize: 13, marginTop: 2, color: c.green }}>{card.outcome}</div>
            </div>
          </div>
        )) : <div style={{ fontSize: 13, color: c.sub, fontStyle: "italic" }}>No decisions surfaced from current data. · Sin decisiones según los datos actuales.</div>}
      </div>

      {/* DATA SOURCES */}
      <div style={{ ...S.panel, marginTop: 22 }}>
        <div style={S.cap}>Data feeds</div><div style={faintEs}>Fuentes de datos</div>
        <div style={{ fontSize: 12.5, color: c.ink, marginTop: 8, lineHeight: 1.5 }}>
          <b style={{ color: c.green }}>Live now:</b> Inventory, Amazon ad campaigns, Weekly Numbers, COGS.
        </div>
        <div style={{ fontSize: 12.5, color: c.sub, marginTop: 4, lineHeight: 1.5 }}>
          <b>Pending integration:</b> Shopify, Amazon SP-API (live sales/sessions/Buy Box), Meta Ads, Google Ads, Klaviyo, QuickBooks/Xero. Each one you connect deepens this brief automatically.
        </div>
        <div style={faintEs}>Cada integración que conectes profundiza este resumen automáticamente.</div>
      </div>
    </div>
  );
}
