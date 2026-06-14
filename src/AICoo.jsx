import { useMemo, useState } from "react";
import { buildMarginsModel } from "./marginsCore.js";

/* ============================================================================
   LAVALLE HAUS OS — AI COO
   The synthesis layer that sits on top of every tab. It reads the data you
   already track (inventory, ads, weekly numbers, COGS, bank) and produces:
     1) a COO Scorecard (0–100 across six categories),
     2) a Monday Weekly Brief with REAL CM1/CM2 + channel profitability,
     3) a graded Decision Engine — every recommendation carries Impact,
        Effort, Confidence and Time-to-result, sorted so the highest-leverage
        move (high impact / low effort) rises to the top, and
     4) a one-tap "Send to Action Items" on every card, with inline undo.

   The Brief is a derived, read-only view — it holds no editable data of its
   own, so it carries no global edit history; its only mutation (sending a
   card to the Action Items board) is reversible inline, and the board itself
   has full Undo/Redo.

     <AICoo products={...} campaigns={...} weeks={...} materials={...}
            cogs={...} profitMatrix={...} marginsSettings={...}
            bankCash={...} actionsBoard={...}
            onAddAction={fn} onRemoveAction={fn} />
   ========================================================================== */

const c = {
  bg: "#f7f4ef", panel: "#fffdf9", ink: "#2b2620", sub: "#6f6657",
  line: "#e4ddd0", lineSoft: "#efe9de", sage: "#6b7257", clay: "#a8643c", gold: "#b08d57",
  green: "#5c7a52", yellow: "#b78b2e", red: "#a8483a",
};
const serif = "'IM Fell English', Georgia, 'Times New Roman', serif";
const sans = "'IM Fell English', Georgia, serif";
const mono = "monospace";
const faintEs = { fontFamily: sans, fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 1, lineHeight: 1.3 };

const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? 0 : Number(v));
const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(num(n)).toLocaleString("en-US", { maximumFractionDigits: 0 });
const money2 = (n) => (n < 0 ? "-$" : "$") + Math.abs(num(n)).toFixed(2);
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

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
  cap: { fontFamily: mono, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: c.sub },
};

function currentMonday() {
  const t = new Date(); const day = t.getDay(); const diff = (day === 0 ? -6 : 1) - day;
  const m = new Date(t); m.setDate(t.getDate() + diff);
  return m.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function confColor(n) { return n >= 85 ? c.green : n >= 70 ? c.gold : c.sub; }
function scoreColor(n) { return n == null ? c.sub : n >= 75 ? c.green : n >= 55 ? c.gold : n >= 40 ? c.clay : c.red; }
function sevFromImpact(impact, flagSev) {
  if (flagSev === "high" || impact >= 5) return "high";
  if (flagSev === "low" || impact <= 2) return "low";
  return "med";
}

// Small dot meter for Impact / Effort.
const Dots = ({ n, max = 5, color }) => (
  <span style={{ letterSpacing: 1 }}>
    {Array.from({ length: max }).map((_, i) => (
      <span key={i} style={{ color: i < n ? color : "rgba(111,102,87,0.25)" }}>●</span>
    ))}
  </span>
);

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

// Donut-ish score badge.
const ScoreBadge = ({ score }) => {
  const col = scoreColor(score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 78, height: 78, borderRadius: "50%", border: `3px solid ${col}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <div style={{ fontSize: 26, color: col, lineHeight: 1 }}>{score == null ? "—" : score}</div>
        <div style={{ fontSize: 8, color: c.sub, fontFamily: mono, letterSpacing: 1 }}>/ 100</div>
      </div>
    </div>
  );
};

export default function AICoo({
  products = [], campaigns = [], weeks = [], materials = [], cogs = {},
  profitMatrix = {}, marginsSettings = {}, bankCash = null, actionsBoard = {},
  onAddAction, onRemoveAction,
}) {
  // local map: cardId -> action-item id (so a sent card shows "Undo")
  const [sent, setSent] = useState({});

  const model = useMemo(
    () => buildMarginsModel({ cogs, products, campaigns, profitMatrix, settings: marginsSettings }),
    [cogs, products, campaigns, profitMatrix, marginsSettings]
  );

  const brief = useMemo(() => {
    const wk = weeks[0] || null, prev = weeks[1] || null;
    const revenue = wk ? num(wk.revenue) : 0;
    const revPrev = prev ? num(prev.revenue) : 0;
    const revDelta = revPrev > 0 ? (revenue - revPrev) / revPrev : null;
    const adSpend = wk ? num(wk.adSpend) : 0;
    const tacos = revenue > 0 ? adSpend / revenue : 0;

    const counts = { out: 0, low: 0, slow: 0, inbound: 0, ok: 0 };
    const active = products.filter((p) => !p.isSample);
    active.forEach((p) => { counts[invStatus(p)] = (counts[invStatus(p)] || 0) + 1; });
    const lowOrOut = active.filter((p) => ["out", "low"].includes(invStatus(p)));
    const slow = active.filter((p) => invStatus(p) === "slow");
    const inbound = active.filter((p) => invStatus(p) === "inbound");
    const sellersOut = active.filter((p) => invStatus(p) === "out" && num(p.unitsSold30) > 0);

    const spend7 = campaigns.reduce((s, x) => s + num(x.spend7d), 0);
    const sales7 = campaigns.reduce((s, x) => s + num(x.sales7d), 0);
    const blendedRoas = spend7 > 0 ? sales7 / spend7 : 0;
    const bleeders = campaigns.filter((x) => x.status === "pause" || (num(x.spend7d) >= 15 && num(x.sales7d) === 0));
    const bestCamp = campaigns.slice().sort((a, b) => num(b.roas) - num(a.roas))[0];

    // ── Real CM1/CM2 + channel profitability (from marginsCore) ──
    const summary = model.summary || {};
    const rowById = {}; (model.rows || []).forEach((r) => { rowById[r.id] = r; });
    const chanAgg = (chan) => {
      let wRev = 0, wCm = 0, known = 0;
      active.forEach((p) => {
        if (!(p.channels || []).includes(chan)) return;
        const r = rowById[p.id]; if (!r) return;
        const u = r.units > 0 ? r.units : 1;
        const cm = r.cm2 != null ? r.cm2 : r.cm1;
        if (cm == null) return;
        wRev += r.price * u; wCm += cm * u; known += r.price * u;
      });
      return known > 0 ? (wCm / known) * 100 : null;
    };
    const amazonCm = chanAgg("Amazon");
    const shopifyCm = chanAgg("Shopify");

    // ── Decision cards (each carries impact / effort / time / confidence) ──
    const cards = [];
    const haveAdwasteFlag = (model.flags || []).some((f) => String(f.key || "").indexOf("adwaste:") === 0);

    // From the margins flag engine (real per-unit money math).
    (model.flags || []).forEach((f) => {
      const t = String(f.key || "");
      if (t.indexOf("cm2neg:") === 0) cards.push({ id: "flag:" + f.key, name: f.name, obs: f.title + ".", cause: f.detail, rec: "Fix the margin: review ad mapping/spend and FBA, or raise price, on " + f.name + ".", outcome: "Stop the per-unit loss on every sale.", conf: 88, impact: 5, effort: 2, time: "≤1 wk", flagSev: "high" });
      else if (t.indexOf("adwaste:") === 0) cards.push({ id: "flag:" + f.key, name: f.name, obs: f.title + ".", cause: f.detail, rec: "Pause the spend behind " + f.name + " and retarget to a converting term.", outcome: "Recover that ad budget immediately.", conf: 92, impact: 4, effort: 1, time: "≤1 wk", flagSev: "high" });
      else if (t.indexOf("thin:") === 0) cards.push({ id: "flag:" + f.key, name: f.name, obs: f.title + ".", cause: f.detail, rec: "Lift price or trim cost on " + f.name + " before scaling its ads.", outcome: "Build a real cushion before a cost rise turns it negative.", conf: 75, impact: 3, effort: 2, time: "1–4 wks", flagSev: "med" });
      else if (t.indexOf("price:") === 0) cards.push({ id: "flag:" + f.key, name: f.name, obs: f.title + ".", cause: f.detail, rec: "Set a retail price for " + f.name + " so margin can be tracked.", outcome: "Unlock margin visibility for this SKU.", conf: 80, impact: 3, effort: 1, time: "≤1 wk", flagSev: "med" });
      else if (t.indexOf("cogs:") === 0) cards.push({ id: "flag:" + f.key, name: f.name, obs: f.title + ".", cause: f.detail, rec: "Enter COGS for " + f.name + " in the COGS Builder and save.", outcome: "Make the margin figure real instead of overstated.", conf: 95, impact: 2, effort: 1, time: "≤1 wk", flagSev: "low" });
    });

    // Operational ad bleeders not already represented by a margins flag.
    if (!haveAdwasteFlag) bleeders.forEach((x) => cards.push({
      id: "camp:" + x.id, name: x.name,
      obs: `${x.name}: ${money2(x.spend7d)} spent, ${num(x.sales7d) ? money2(x.sales7d) + " in sales" : "zero sales"} over 7 days.`,
      cause: "Ad spend without conversions — targeting or listing mismatch.",
      rec: `Pause "${x.name}" now and shift budget to your best-ROAS campaign.`,
      outcome: `Stop ~${money(num(x.spend7d) * 4)}/mo of wasted spend.`, conf: 90, impact: 4, effort: 1, time: "≤1 wk", flagSev: "high",
    }));

    // Stockouts / low stock of SKUs that actually sell.
    sellersOut.forEach((p) => cards.push({
      id: "out:" + p.id, name: p.name,
      obs: `${p.name}: out of stock${num(p.inbound) ? `, ${p.inbound} inbound` : ", nothing inbound"} — was selling ${num(p.unitsSold30)}/mo.`,
      cause: "Sales velocity outran available stock.",
      rec: num(p.inbound) ? "Time a restock campaign to the inbound arrival." : "Place a reorder today to stop lost sales and rank slippage.",
      outcome: "Protect ranking and recover lost sales.", conf: 82, impact: 5, effort: 2, time: "1–4 wks", flagSev: "high",
    }));
    lowOrOut.filter((p) => invStatus(p) === "low").forEach((p) => cards.push({
      id: "low:" + p.id, name: p.name,
      obs: `${p.name}: ${weeksCover(p.available, p.unitsSold30)} weeks of cover at ${num(p.unitsSold30)}/mo${num(p.inbound) ? `, ${p.inbound} inbound` : ""}.`,
      cause: "Stock is running down faster than it's being replaced.",
      rec: "Schedule a reorder now so it lands before stockout.",
      outcome: "Avoid a stockout and the ranking reset that follows.", conf: 78, impact: 4, effort: 2, time: "1–4 wks", flagSev: "med",
    }));

    // Overstock / slow movers tying up cash.
    slow.forEach((p) => cards.push({
      id: "slow:" + p.id, name: p.name,
      obs: `${p.name}: ~${weeksCover(p.available, p.unitsSold30)} weeks of cover at ${num(p.unitsSold30)} units/mo.`,
      cause: "Overstock — demand is below the quantity on hand.",
      rec: "Pause ads on this SKU and run a promo or bundle to free trapped cash.",
      outcome: `Recover cash tied up in ${num(p.available)} units.`, conf: 80, impact: 3, effort: 3, time: "1–3 mo", flagSev: "med",
    }));

    // Scale a profitable, budget-constrained winner.
    if (bestCamp && num(bestCamp.roas) >= 2) cards.push({
      id: "scale:" + bestCamp.id, name: bestCamp.name,
      obs: `${bestCamp.name}: ROAS ${num(bestCamp.roas).toFixed(2)}× on ${money2(bestCamp.budget)}/day.`,
      cause: "A profitable, budget-constrained winner.",
      rec: "Raise the daily budget in steps (e.g. +50%) and watch ROAS hold.",
      outcome: "More profitable sales at a similar ROAS.", conf: 76, impact: 4, effort: 2, time: "1–4 wks", flagSev: "med",
    });

    // Launch prep for inbound restocks.
    inbound.filter((p) => num(p.inbound) > 0).forEach((p) => cards.push({
      id: "inbound:" + p.id, name: p.name,
      obs: `${p.name}: ${p.inbound} units inbound to FBA.`,
      cause: "Fresh stock landing — a launch/restock window.",
      rec: "Line up keyword + ad campaigns timed to arrival so day-one velocity builds rank.",
      outcome: "Faster ramp and better organic rank on restock.", conf: 72, impact: 4, effort: 3, time: "1–4 wks", flagSev: "med",
    }));

    // Priority score: leverage = impact × confidence ÷ effort.
    cards.forEach((card) => {
      card.priority = (card.impact * (card.conf / 100)) / Math.max(card.effort, 1);
      card.quickWin = card.impact >= 4 && card.effort <= 2;
      card.sev = sevFromImpact(card.impact, card.flagSev);
    });
    cards.sort((a, b) => b.priority - a.priority);

    // Risks (top 3) and opportunities (top 3).
    const risks = [];
    (model.flags || []).filter((f) => f.severity === "high").forEach((f) => risks.push(f.title + "."));
    if (!haveAdwasteFlag && bleeders.length) risks.push(`${bleeders.length} ad campaign${bleeders.length > 1 ? "s" : ""} spending with little or no return.`);
    sellersOut.forEach((p) => risks.push(`${p.name} is out of stock — was selling ${num(p.unitsSold30)}/mo.`));
    if (slow.length) risks.push(`${slow.length} SKU${slow.length > 1 ? "s" : ""} overstocked — cash sitting in slow inventory.`);
    if (tacos > 0.25) risks.push(`TACOS at ${(tacos * 100).toFixed(0)}% — ad spend is eating a large share of revenue.`);

    const opps = [];
    if (bestCamp && num(bestCamp.roas) >= 2) opps.push(`Scale "${bestCamp.name}" — ROAS ${num(bestCamp.roas).toFixed(2)}× has room to grow.`);
    inbound.filter((p) => num(p.inbound) > 0).forEach((p) => opps.push(`${p.name} restock inbound (${p.inbound} units) — line up launch campaigns.`));
    lowOrOut.filter((p) => num(p.unitsSold30) >= 8).forEach((p) => opps.push(`${p.name} is a fast seller running low — secure stock to protect momentum.`));
    if (shopifyCm != null && amazonCm != null && shopifyCm > amazonCm + 5) opps.push(`Shopify carries the richer margin (${shopifyCm.toFixed(0)}% vs ${amazonCm.toFixed(0)}% CM2) — push more demand there.`);

    return {
      wk, revenue, revDelta, adSpend, tacos, counts, active, spend7, sales7, blendedRoas, bleeders,
      summary, amazonCm, shopifyCm, cards, risks: risks.slice(0, 3), opps: opps.slice(0, 3),
    };
  }, [products, campaigns, weeks, model]);

  // ── COO Scorecard (0–100 across six categories) ──
  const scorecard = useMemo(() => {
    const b = brief;
    const cm2 = b.summary.cm2Pct != null ? b.summary.cm2Pct : b.summary.cm1Pct;
    const negCount = (model.rows || []).filter((r) => r.cm2 != null && r.cm2 < 0).length;
    const pricedActive = b.active.filter((p) => num(p.price) > 0);

    let financial = null;
    if (cm2 != null) {
      financial = cm2 >= 25 ? 92 : cm2 >= 15 ? 72 : cm2 >= 5 ? 52 : cm2 >= 0 ? 38 : 18;
      financial = clamp(financial - Math.min(negCount * 8, 30));
    }

    let inventory = null;
    if (b.active.length) {
      let s = 82;
      b.active.forEach((p) => {
        const st = invStatus(p);
        if (st === "out" && num(p.unitsSold30) > 0) s -= 18;
        else if (st === "low") s -= 10;
        else if (st === "slow") s -= 6;
        else if (st === "ok") s += 2;
      });
      inventory = clamp(s);
    }

    let advertising = null;
    if (b.spend7 > 0) {
      let s = b.blendedRoas >= 3 ? 90 : b.blendedRoas >= 2 ? 72 : b.blendedRoas >= 1.5 ? 55 : b.blendedRoas >= 1 ? 40 : 22;
      advertising = clamp(s - Math.min(b.bleeders.length * 12, 36));
    }

    let growth = null;
    if (b.wk) growth = b.revDelta == null ? 50 : clamp(b.revDelta >= 0.15 ? 90 : b.revDelta >= 0.05 ? 75 : b.revDelta >= -0.05 ? 58 : b.revDelta >= -0.15 ? 42 : 25);

    let operations = null; // data completeness — can the COO see the business?
    if (pricedActive.length) {
      const withCogs = (model.rows || []).filter((r) => r.hasCogs).length;
      operations = clamp(35 + (withCogs / pricedActive.length) * 60);
    }

    let execution = null;
    const items = (actionsBoard && actionsBoard.items) || [];
    const live = items.filter((it) => it.status !== "done" && it.status !== "resolved");
    if (live.length) {
      const high = live.filter((it) => it.severity === "high");
      if (!high.length) execution = 80;
      else {
        const assigned = high.filter((it) => it.assigneeId || (it.assignees && it.assignees.length)).length;
        execution = clamp(40 + (assigned / high.length) * 55);
      }
    }

    const cats = [
      { key: "Financial Health", es: "Salud financiera", v: financial },
      { key: "Inventory Health", es: "Salud de inventario", v: inventory },
      { key: "Advertising Health", es: "Salud de anuncios", v: advertising },
      { key: "Growth Health", es: "Salud de crecimiento", v: growth },
      { key: "Operations Health", es: "Salud operativa", v: operations },
      { key: "Team Execution", es: "Ejecución del equipo", v: execution },
    ];
    const known = cats.filter((x) => x.v != null);
    const overall = known.length ? clamp(known.reduce((s, x) => s + x.v, 0) / known.length) : null;
    return { cats, overall };
  }, [brief, model, actionsBoard]);

  const b = brief;
  const invSummary = `${b.counts.out} out · ${b.counts.low} low · ${b.counts.slow} slow · ${b.counts.ok} healthy`;
  const cm1 = b.summary.cm1Pct, cm2 = b.summary.cm2Pct;

  // Cash line: real if a bank balance has synced; otherwise point to the home tab.
  const cashVal = bankCash && bankCash.total != null ? money(bankCash.total) : "connect bank";
  const cashNote = bankCash && bankCash.total != null
    ? `synced ${bankCash.updatedAt ? new Date(bankCash.updatedAt).toLocaleDateString() : ""} · runway lives in Sales → Cash Runway`
    : "Plaid / Cash Runway tab — pending";

  function sendCard(card) {
    if (!onAddAction) return;
    const id = "coo_" + Date.now() + "_" + String(card.id).replace(/[^a-z0-9]/gi, "");
    onAddAction({
      id, source: "coo", title: card.rec,
      detail: card.obs + " — " + card.cause,
      name: card.name || "", severity: card.sev || "med",
      assigneeId: null, status: "open", createdAt: new Date().toISOString(),
    });
    setSent((s) => ({ ...s, [card.id]: id }));
  }
  function undoCard(card) {
    const id = sent[card.id];
    if (id && onRemoveAction) onRemoveAction(id);
    setSent((s) => { const n = { ...s }; delete n[card.id]; return n; });
  }

  return (
    <div style={S.wrap}>
      <div>
        <h1 style={S.h1}>AI COO — Weekly Brief</h1><div style={faintEs}>Director de operaciones AI — resumen semanal</div>
        <div style={S.sub}>Week of {currentMonday()} — what matters, and the highest-impact moves.</div>
        <div style={faintEs}>Semana del {currentMonday()} — lo que importa y las acciones de mayor impacto.</div>
      </div>

      {/* COO SCORECARD */}
      <div style={{ ...S.panel, marginTop: 16, display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ textAlign: "center" }}>
          <div style={S.cap}>Business Score</div><div style={faintEs}>Puntaje del negocio</div>
          <div style={{ marginTop: 8 }}><ScoreBadge score={scorecard.overall} /></div>
        </div>
        <div style={{ flex: 1, minWidth: 280, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 10 }}>
          {scorecard.cats.map((cat) => (
            <div key={cat.key}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: c.ink }}>
                <span>{cat.key}</span>
                <span style={{ color: scoreColor(cat.v), fontFamily: mono }}>{cat.v == null ? "—" : cat.v}</span>
              </div>
              <div style={faintEs}>{cat.es}</div>
              <div style={{ height: 5, background: c.lineSoft, borderRadius: 3, marginTop: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${cat.v == null ? 0 : cat.v}%`, background: scoreColor(cat.v) }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* WEEKLY BRIEF METRICS */}
      <div style={S.sec}>The Numbers<div style={faintEs}>Los números</div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}>
        <Metric label="Revenue" labelEs="Ingresos"
          value={b.wk ? money(b.revenue) : "no week logged"} pending={!b.wk}
          note={b.revDelta != null ? `${b.revDelta >= 0 ? "▲" : "▼"} ${Math.abs(b.revDelta * 100).toFixed(0)}% vs last week` : "log weekly numbers to compare"} />
        <Metric label="Contribution CM1" labelEs="Contribución CM1"
          value={cm1 != null ? `${cm1.toFixed(0)}%` : "needs COGS"} pending={cm1 == null}
          note="after product cost · per-SKU from COGS Builder" />
        <Metric label="Contribution CM2" labelEs="Contribución CM2"
          value={cm2 != null ? `${cm2.toFixed(0)}%` : "needs fees"} pending={cm2 == null}
          note="after fees, returns, fulfillment & ads" />
        <Metric label="Cash Position" labelEs="Posición de caja" value={cashVal} pending={!(bankCash && bankCash.total != null)} note={cashNote} />
        <Metric label="Inventory Health" labelEs="Salud de inventario" value={invSummary} note={`${b.active.length} SKUs tracked`} />
        <Metric label="Advertising Health" labelEs="Salud de anuncios"
          value={b.spend7 > 0 ? `${b.blendedRoas.toFixed(2)}× ROAS` : "no ad data"} pending={b.spend7 === 0}
          note={b.spend7 > 0 ? `${money(b.spend7)} spend / ${money(b.sales7)} sales (7d)` : "Amazon/Meta/Google — pending live feeds"} />
      </div>

      {/* CHANNEL PROFITABILITY */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 12, marginTop: 12 }}>
        <Metric label="Amazon CM2" labelEs="CM2 Amazon" value={b.amazonCm != null ? `${b.amazonCm.toFixed(0)}%` : "needs COGS/fees"} pending={b.amazonCm == null} note="units-weighted, Amazon SKUs" />
        <Metric label="Shopify CM2" labelEs="CM2 Shopify" value={b.shopifyCm != null ? `${b.shopifyCm.toFixed(0)}%` : "needs COGS/fees"} pending={b.shopifyCm == null} note="units-weighted, Shopify SKUs" />
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

      {/* TOP 5 PRIORITIES */}
      <div style={S.sec}>Top 5 Priorities This Week<div style={faintEs}>5 prioridades de la semana</div></div>
      <div style={S.panel}>
        {b.cards.length ? (
          <ol style={{ margin: 0, paddingLeft: 22 }}>
            {b.cards.slice(0, 5).map((card) => (
              <li key={card.id} style={{ fontSize: 14, color: c.ink, marginBottom: 8, lineHeight: 1.45 }}>
                {card.rec}
                {card.quickWin && <span style={{ marginLeft: 8, fontFamily: mono, fontSize: 9, letterSpacing: 1, color: c.green, border: `1px solid ${c.green}`, borderRadius: 2, padding: "1px 5px" }}>QUICK WIN</span>}
              </li>
            ))}
          </ol>
        ) : <div style={{ fontSize: 13, color: c.sub, fontStyle: "italic" }}>No urgent actions detected from current data. · Sin acciones urgentes según los datos actuales.</div>}
      </div>

      {/* DECISION ENGINE */}
      <div style={S.sec}>Decision Engine — graded & prioritized<div style={faintEs}>Motor de decisiones — calificado y priorizado</div></div>
      <div style={{ fontSize: 12, color: c.sub, fontStyle: "italic", marginBottom: 12 }}>
        Every recommendation: Observation → Root Cause → Recommendation → Expected Outcome, graded by Impact · Effort · Time · Confidence, sorted highest-leverage first.
        <div style={faintEs}>Cada recomendación calificada por Impacto · Esfuerzo · Tiempo · Confianza, ordenada por mayor apalancamiento.</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px,1fr))", gap: 14 }}>
        {b.cards.length ? b.cards.map((card) => {
          const wasSent = sent[card.id];
          return (
            <div key={card.id} style={{ ...S.panel, borderLeft: `3px solid ${card.sev === "high" ? c.red : card.sev === "low" ? c.line : c.gold}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={S.cap}>Observation · observación</span>
                {card.quickWin && <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: 1, color: c.green }}>QUICK WIN</span>}
              </div>
              <div style={{ fontSize: 14, marginTop: 4, lineHeight: 1.4 }}>{card.obs}</div>
              <div style={{ marginTop: 10 }}><span style={S.cap}>Root cause · causa</span><div style={{ fontSize: 13, marginTop: 2 }}>{card.cause}</div></div>
              <div style={{ marginTop: 10 }}><span style={S.cap}>Recommendation · recomendación</span><div style={{ fontSize: 13, marginTop: 2 }}>{card.rec}</div></div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.lineSoft}` }}>
                <span style={S.cap}>Expected outcome · resultado</span><div style={{ fontSize: 13, marginTop: 2, color: c.green }}>{card.outcome}</div>
              </div>

              {/* grading row */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 12, paddingTop: 10, borderTop: `1px solid ${c.lineSoft}`, fontFamily: mono, fontSize: 10.5, color: c.sub, alignItems: "center" }}>
                <span>IMPACT <Dots n={card.impact} color={c.clay} /></span>
                <span>EFFORT <Dots n={card.effort} color={c.sub} /></span>
                <span>TIME <span style={{ color: c.ink }}>{card.time}</span></span>
                <span style={{ color: confColor(card.conf) }}>{card.conf}% CONF</span>
              </div>

              {/* send to action items */}
              {onAddAction && (
                <div style={{ marginTop: 10 }}>
                  {wasSent ? (
                    <span style={{ fontFamily: mono, fontSize: 10.5, color: c.green }}>
                      ✓ Sent to Action Items ·
                      <button onClick={() => undoCard(card)} style={{ marginLeft: 6, background: "none", border: "none", color: c.clay, cursor: "pointer", fontFamily: mono, fontSize: 10.5, textDecoration: "underline", padding: 0 }}>Undo</button>
                    </span>
                  ) : (
                    <button onClick={() => sendCard(card)} style={{ background: "transparent", border: `1px solid ${c.clay}`, color: c.clay, borderRadius: 2, padding: "5px 12px", cursor: "pointer", fontFamily: mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }}>
                      → Send to Action Items
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        }) : <div style={{ fontSize: 13, color: c.sub, fontStyle: "italic" }}>No decisions surfaced from current data. · Sin decisiones según los datos actuales.</div>}
      </div>

      {/* DATA SOURCES */}
      <div style={{ ...S.panel, marginTop: 22 }}>
        <div style={S.cap}>Data feeds</div><div style={faintEs}>Fuentes de datos</div>
        <div style={{ fontSize: 12.5, color: c.ink, marginTop: 8, lineHeight: 1.5 }}>
          <b style={{ color: c.green }}>Live now:</b> Inventory, Amazon ad campaigns, Weekly Numbers, COGS &amp; Margins (CM1/CM2){bankCash && bankCash.total != null ? ", Bank cash" : ""}.
        </div>
        <div style={{ fontSize: 12.5, color: c.sub, marginTop: 4, lineHeight: 1.5 }}>
          <b>Pending integration:</b> Shopify SP-API (sessions/Buy Box), Meta &amp; Google Ads, Klaviyo{bankCash && bankCash.total != null ? "" : ", bank balances (Plaid)"}. Each one you connect deepens this brief automatically.
        </div>
        <div style={faintEs}>Cada integración que conectes profundiza este resumen automáticamente.</div>
      </div>
    </div>
  );
}
