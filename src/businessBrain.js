// LAVALLE HAUS OS — Business Brain model
// One config object drives both the Business Brain landing page and Command
// View. Everything is computed from the same live state the dashboard uses, so
// the brain is a *view* of the business — never a second copy of the data.
// The node structure is config-driven so future business types (Chief
// Commerce / Chief Construction) can supply their own nodes.

const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const money = (v) => "$" + Math.round(Math.abs(num(v))).toLocaleString("en-US");

function pctChange(cur, prev) {
  if (prev == null || cur == null || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}
function changeLabel(pct) {
  if (pct == null) return null;
  return (pct >= 0 ? "+" : "") + pct + "%";
}
function periodRev(feed, key, metric = "net") {
  if (!feed || !feed.periods || !feed.periods[key]) return null;
  return num(feed.periods[key][metric]);
}

// ── Business Health ──────────────────────────────────────────────────────────
// A deterministic 0–100 score from real operating signals. Not a vanity
// metric: every deduction maps to something the user can open and fix.
export function buildHealth({ highFlags = 0, medFlags = 0, criticalStock = 0, pausedCampaigns = 0, runwayWeeks = null, accountHealth = null, wowPct = null }) {
  let score = 96;
  const notes = [];
  const dock = (pts, note) => { score -= pts; notes.push({ pts, note }); };
  if (highFlags) dock(Math.min(24, highFlags * 8), highFlags + " high-severity margin/ad flag" + (highFlags > 1 ? "s" : ""));
  if (medFlags) dock(Math.min(8, medFlags * 2), medFlags + " medium flag" + (medFlags > 1 ? "s" : ""));
  if (criticalStock) dock(Math.min(20, criticalStock * 5), criticalStock + " product" + (criticalStock > 1 ? "s" : "") + " out of stock or low");
  if (pausedCampaigns) dock(Math.min(12, pausedCampaigns * 6), pausedCampaigns + " campaign" + (pausedCampaigns > 1 ? "s" : "") + " flagged to pause");
  if (runwayWeeks != null && runwayWeeks < 8) dock(12, "Cash runway under 8 weeks");
  if (accountHealth && /risk|critical/i.test(accountHealth.status || "")) dock(accountHealth.status === "Critical" ? 18 : 10, "Amazon account health: " + accountHealth.status);
  if (wowPct != null && wowPct < -20) dock(6, "Sales down " + Math.abs(wowPct) + "% week over week");
  score = Math.max(35, Math.min(98, Math.round(score)));
  const status = score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 55 ? "Needs Attention" : "At Risk";
  return { score, status, notes };
}

// ── One taxonomy ─────────────────────────────────────────────────────────────
// Every brain bubble lives in exactly one app tab; a staff member sees a
// bubble iff they can see its tab, and (via dbState.driveMap) each tab can
// point at its Drive folder — bubbles ↔ tabs ↔ Drive, one mental model.
export const BUBBLE_TAB = {
  revenue: "profit",
  finance: "profit",
  marketing: "ads",
  inventory: "inventory",
  operations: "growth",
  projects: "roadmap",
  growth: "growth",
};

// ── The Brain ────────────────────────────────────────────────────────────────
// ctx is assembled in App.jsx from live state. Products arrive with a
// precomputed `_status` (the same stockStatus the Inventory tab shows).
// ctx.lensTabs (array of tab ids) applies a person's lens: only bubbles,
// insights, priorities and health signals from those tabs — so a staff
// member gets their own health percentage from just the world they run.
export function buildBrainModel(ctx) {
  const {
    businessName = "Lavalle Haus",
    products = [], campaigns = [], flags = [],
    shopifySales = null, amazonSales = null,
    bankCash = null, pnl = {}, actionsBoard = {},
    wholesale = [], accountHealth = null, cashRunwayWeeks = null,
    marginsSummary = null, metaAds = [], lensTabs = null,
  } = ctx;
  const see = (tab) => !lensTabs || lensTabs.includes(tab);

  const sellable = products.filter((p) => !p.isSample);
  const stockRisks = sellable.filter((p) => ["out", "low", "reorder"].includes(p._status));
  const inbound = sellable.filter((p) => p._status === "inbound");
  const paused = campaigns.filter((c) => c.status === "pause");
  const highFlags = flags.filter((f) => f.severity === "high");
  const medFlags = flags.filter((f) => f.severity === "med");

  const shopNow = periodRev(shopifySales, "thisWeek");
  const shopPrev = periodRev(shopifySales, "lastWeek");
  const amzNow = periodRev(amazonSales, "thisWeek");
  const amzPrev = periodRev(amazonSales, "lastWeek");
  const rev28 = (periodRev(shopifySales, "last4") || 0) + (periodRev(amazonSales, "last4") || 0);
  const revNow = (shopNow != null || amzNow != null) ? (shopNow || 0) + (amzNow || 0) : null;
  const revPrev = (shopPrev != null || amzPrev != null) ? (shopPrev || 0) + (amzPrev || 0) : null;
  const wowPct = pctChange(revNow, revPrev);
  // gross vs net over the trailing 28 days, across both channels
  const sum2 = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0));
  const gross28 = sum2(periodRev(shopifySales, "last4", "gross"), periodRev(amazonSales, "last4", "gross"));
  const net28 = sum2(periodRev(shopifySales, "last4", "net"), periodRev(amazonSales, "last4", "net"));

  const adSpend30 = campaigns.reduce((s, c) => s + num(c.spend7d) * (30 / 7), 0);
  const bestCampaign = campaigns.filter((c) => num(c.roas) > 0).sort((a, b) => num(b.roas) - num(a.roas))[0] || null;
  // blended efficiency across every campaign: the two numbers a CEO checks first
  const spend7 = campaigns.reduce((s, c) => s + num(c.spend7d), 0);
  const adSales7 = campaigns.reduce((s, c) => s + num(c.sales7d), 0);
  const buys7 = campaigns.reduce((s, c) => s + num(c.purchases), 0);
  const blendedRoas = spend7 > 0 ? adSales7 / spend7 : null;
  const blendedCpa = buys7 > 0 ? spend7 / buys7 : null;
  const cm2Pct = marginsSummary && marginsSummary.cm2Pct != null ? marginsSummary.cm2Pct : null;
  const cm1Pct = marginsSummary && marginsSummary.cm1Pct != null ? marginsSummary.cm1Pct : null;
  // Meta (from the Meta Ads tracker) + the all-channel blend
  const metaSpend = metaAds.reduce((s, a) => s + num(a.spend), 0);
  const metaRev = metaAds.reduce((s, a) => s + num(a.revenue), 0);
  const metaBuys = metaAds.reduce((s, a) => s + num(a.purchases), 0);
  const metaRoas = metaSpend > 0 ? metaRev / metaSpend : null;
  const metaCpa = metaBuys > 0 ? metaSpend / metaBuys : null;
  const allSpend = adSpend30 + metaSpend;
  const allAdRev = adSales7 * (30 / 7) + metaRev;
  const allRoas = allSpend > 0 && (blendedRoas != null || metaRoas != null) ? allAdRev / allSpend : null;
  // Wholesale: what's actually secured vs in the pipeline
  const wsActive = wholesale.filter((a) => a.status === "active").length;
  const wsLeads = wholesale.filter((a) => a.status === "lead").length;
  const wsOpp = wholesale.reduce((s, a) => s + num(a.oppValue), 0);

  const items = (actionsBoard.items || []).filter((it) => it.status !== "done" && it.status !== "resolved");
  const team = actionsBoard.team || [];
  const memberName = (id) => { const m = team.find((t) => t.id === id); return m ? m.name : null; };

  // A person's percentage only docks for signals inside their lens.
  const health = buildHealth({
    highFlags: see("profit") ? highFlags.length : 0,
    medFlags: see("profit") ? medFlags.length : 0,
    criticalStock: see("inventory") ? stockRisks.length : 0,
    pausedCampaigns: see("ads") ? paused.length : 0,
    runwayWeeks: see("profit") ? cashRunwayWeeks : null,
    accountHealth: see("profit") ? accountHealth : null,
    wowPct: see("profit") ? wowPct : null,
  });

  // ── Insights (right panel + Command View) — interpretation, not raw data ──
  const insights = [];
  if (accountHealth && /risk|critical|review/i.test(accountHealth.status || "")) {
    insights.push({ id: "amz-health", tone: "risk", title: "Amazon Account Health: " + accountHealth.status, body: "Review Seller Central account status before increasing ad spend.", nav: { tab: "profit", sub: "amazondaily" } });
  }
  highFlags.slice(0, 2).forEach((f) => insights.push({ id: f.key, tone: "risk", title: f.title, body: f.detail, nav: { tab: "growth", sub: "checklist" } }));
  if (stockRisks.length) {
    const worst = stockRisks[0];
    insights.push({ id: "stock", tone: "risk", title: stockRisks.length + " inventory risk" + (stockRisks.length > 1 ? "s" : "") + " detected", body: worst.name + (stockRisks.length > 1 ? " and " + (stockRisks.length - 1) + " more need" : " needs") + " a reorder decision.", nav: { tab: "inventory", sub: "reorder" } });
  }
  if (paused.length) {
    insights.push({ id: "paused", tone: "risk", title: paused.length + " campaign" + (paused.length > 1 ? "s" : "") + " bleeding spend", body: paused[0].recommendation || "Pause recommended — no sales against spend.", nav: { tab: "ads", sub: "ppc" } });
  }
  if (bestCampaign) {
    insights.push({ id: "best", tone: "good", title: "Best ad: ROAS " + num(bestCampaign.roas).toFixed(2), body: bestCampaign.name + " — " + (bestCampaign.recommendation || "performing above target."), nav: { tab: "ads", sub: "ppc" } });
  }
  if (wowPct != null) {
    insights.push({ id: "wow", tone: wowPct >= 0 ? "good" : "risk", title: "Sales " + (wowPct >= 0 ? "up " : "down ") + Math.abs(wowPct) + "% this week", body: "This week " + money(revNow) + " vs " + money(revPrev) + " last week across Shopify + Amazon.", nav: { tab: "profit", sub: "matrix" } });
  }
  if (items.length) {
    const it = items[0];
    insights.push({ id: "priority", tone: "info", title: "Top priority: " + it.title, body: (it.assigneeId && memberName(it.assigneeId) ? "Assigned to " + memberName(it.assigneeId) + ". " : "") + (it.detail || ""), nav: { tab: "growth", sub: "checklist" } });
  }
  const opportunities = insights.filter((i) => i.tone === "good").length;
  const risks = insights.filter((i) => i.tone === "risk").length;

  // ── Weekly priorities (homepage tasks with owners) ──
  const priorities = items.slice(0, 5).map((it) => ({
    id: it.id, title: it.title, detail: it.detail || "",
    owner: memberName(it.assigneeId) || (it.assignees && it.assignees.length ? memberName(it.assignees[0]) : null),
    due: it.dueDate || null, severity: it.severity || "med", status: it.status || "open",
  }));

  // ── Nodes — the connected business system ──
  const invValue = null; // reserved for when inventory valuation is wired
  const cash = bankCash && bankCash.total != null ? bankCash.total : null;

  const nodes = [
    {
      id: "revenue", label: "Revenue",
      purpose: {
        q: "Are we selling?",
        body: "Net sales this week with the change vs last week. Inside: Shopify and Amazon this week, plus gross and net for the trailing 28 days. Gross is before discounts and refunds; net is what the orders were really worth.",
        qEs: "¿Estamos vendiendo?",
        bodyEs: "Ventas netas de la semana y su cambio contra la anterior; adentro, Shopify, Amazon y el bruto/neto de los últimos 28 días.",
      },
      value: revNow != null ? money(revNow) + " wk" : (rev28 ? money(rev28) + " /28d" : "—"),
      status: wowPct == null ? "steady" : wowPct >= 0 ? "improving" : "declining",
      change: changeLabel(wowPct),
      nav: { tab: "profit", sub: "matrix" },
      rotate: [
        { key: "shopify", label: "Shopify", value: shopNow != null ? money(shopNow) + " wk" : "Syncing…", metric: null },
        { key: "amazon", label: "Amazon", value: amzNow != null ? money(amzNow) + " wk" : "Syncing…", metric: null },
        { key: "wholesale", label: "Wholesale", value: wsActive ? wsActive + " active" : "Building", metric: wsOpp ? money(wsOpp) + " opportunity" : null },
        { key: "tiktokshop", label: "TikTok Shop", value: "Connect", metric: null },
        { key: "all", label: "All channels", value: revNow != null ? money(revNow) + " wk" : (rev28 ? money(rev28) + " /28d" : "—"), metric: changeLabel(wowPct) },
      ],
      summary: {
        what: revNow != null ? "This week " + money(revNow) + " across channels (Shopify " + (shopNow != null ? money(shopNow) : "—") + ", Amazon " + (amzNow != null ? money(amzNow) : "—") + ")." : "Live sales feeds connect here as Shopify and Amazon sync.",
        why: wowPct != null ? "Week-over-week " + (wowPct >= 0 ? "growth" : "decline") + " of " + Math.abs(wowPct) + "% vs " + money(revPrev) + " last week." : "Trailing 28 days: " + money(rev28) + ".",
        next: wowPct != null && wowPct < 0 ? "Open the Profit Matrix to see which channel or product drove the dip." : "Keep the winning channel funded; review the Profit Matrix weekly.",
      },
      children: [
        { id: "rev-shopify", label: "Shopify", value: shopNow != null ? money(shopNow) + " wk" : "—", nav: { tab: "profit", sub: "matrix" } },
        { id: "rev-amazon", label: "Amazon", value: amzNow != null ? money(amzNow) + " wk" : "—", nav: { tab: "profit", sub: "amazondaily" } },
        { id: "rev-gross", label: "Gross · 28d", value: gross28 != null ? money(gross28) : "Syncing…", nav: { tab: "profit", sub: "matrix" } },
        { id: "rev-net", label: "Net · 28d", value: net28 != null ? money(net28) : "Syncing…", nav: { tab: "profit", sub: "matrix" } },
      ],
    },
    {
      id: "marketing", label: "Marketing",
      purpose: {
        q: "Is our ad spend efficient?",
        body: "Total monthly ad spend with the two numbers that matter: blended ROAS (sales returned per $1 of ads — under 1 means ads lose money) and CPA (what one order costs us in ads). If ROAS shows red, a weak campaign is dragging the blend down.",
        qEs: "¿El gasto en anuncios es eficiente?",
        bodyEs: "Gasto publicitario mensual con ROAS combinado (ventas por cada $1 de anuncios) y CPA (costo por pedido).",
      },
      value: adSpend30 ? money(adSpend30) + " /mo" : "—",
      status: paused.length ? "declining" : (blendedRoas != null && blendedRoas >= 2 ? "improving" : "steady"),
      change: blendedRoas != null ? "ROAS " + blendedRoas.toFixed(2) + (blendedCpa != null ? " · CPA " + money(blendedCpa) : "") : (paused.length ? paused.length + " to pause" : null),
      nav: { tab: "ads", sub: "ppc" },
      rotate: [
        { key: "amazon", label: "Amazon Ads", value: adSpend30 ? money(adSpend30) + " /mo" : "—", metric: blendedRoas != null ? "ROAS " + blendedRoas.toFixed(2) + (blendedCpa != null ? " · CPA " + money(blendedCpa) : "") : null, tone: blendedRoas != null && blendedRoas < 1.5 ? "risk" : null },
        { key: "meta", label: "Meta Ads", value: metaSpend ? money(metaSpend) + " tracked" : "Connect", metric: metaRoas != null ? "ROAS " + metaRoas.toFixed(2) + (metaCpa != null ? " · CPA " + money(metaCpa) : "") : null, tone: metaRoas != null && metaRoas < 1.5 ? "risk" : null },
        { key: "tiktok", label: "TikTok Ads", value: "Connect", metric: null },
        { key: "all", label: "All channels", value: allSpend ? money(allSpend) + " /mo" : "—", metric: allRoas != null ? "ROAS " + allRoas.toFixed(2) : null, tone: allRoas != null && allRoas < 1.5 ? "risk" : null },
      ],
      summary: {
        what: campaigns.length + " Amazon campaigns, ~" + money(adSpend30) + "/month in spend" + (blendedRoas != null ? " · blended ROAS " + blendedRoas.toFixed(2) : "") + (blendedCpa != null ? " · cost per order " + money(blendedCpa) + "." : "."),
        why: paused.length ? paused.length + " campaign" + (paused.length > 1 ? "s have" : " has") + " spend with no sales — pure loss until paused." : bestCampaign ? "Top ROAS " + num(bestCampaign.roas).toFixed(2) + " (" + bestCampaign.name + ")." : "No standout performance signals this week.",
        next: paused.length ? "Pause the flagged campaign" + (paused.length > 1 ? "s" : "") + " and move budget to the top performer." : "Scale the best performer gently; keep TACOS under 30%.",
      },
      children: [
        { id: "mkt-roas", label: "Blended ROAS", value: blendedRoas != null ? blendedRoas.toFixed(2) : "—", tone: blendedRoas != null && blendedRoas < 1.5 ? "risk" : null, nav: { tab: "ads", sub: "ppc" } },
        { id: "mkt-cpa", label: "Cost per order (CPA)", value: blendedCpa != null ? money(blendedCpa) : "—", nav: { tab: "ads", sub: "ppc" } },
        { id: "mkt-ppc", label: "Amazon PPC", value: campaigns.length + " campaigns" + (paused.length ? " · " + paused.length + " to pause" : ""), tone: paused.length ? "risk" : null, nav: { tab: "ads", sub: "ppc" } },
        { id: "mkt-meta", label: "Meta Ads", value: metaSpend ? money(metaSpend) + (metaRoas != null ? " · ROAS " + metaRoas.toFixed(2) : "") : "Connect", tone: metaRoas != null && metaRoas < 1 ? "risk" : null, nav: { tab: "ads", sub: "meta" } },
        { id: "mkt-tiktok", label: "TikTok Ads", value: "Connect", nav: { tab: "ads", sub: "meta" } },
      ],
    },
    {
      id: "inventory", label: "Inventory",
      purpose: {
        q: "Can we fulfill?",
        body: "Every sellable product and its stock condition. Products at risk are out, low, or past their reorder point — each one is revenue we cannot capture until restocked.",
        qEs: "¿Podemos surtir?",
        bodyEs: "Cada producto y su inventario; los que están en riesgo son ventas que no podemos capturar hasta resurtir.",
      },
      value: sellable.length + " SKUs",
      status: stockRisks.length ? "declining" : "steady",
      change: stockRisks.length ? stockRisks.length + " at risk" : inbound.length ? inbound.length + " inbound" : null,
      nav: { tab: "inventory", sub: "fba" },
      summary: {
        what: sellable.length + " products tracked · " + stockRisks.length + " at risk · " + inbound.length + " inbound.",
        why: stockRisks.length ? stockRisks.map((p) => p.name).slice(0, 3).join(", ") + (stockRisks.length > 3 ? "…" : "") + " below safe supply." : "Stock levels are within safe ranges.",
        next: stockRisks.length ? "Open the Reorder List — it already computes what to order and when." : "Nothing urgent. Reorder List updates as live FBA data syncs.",
      },
      children: stockRisks.slice(0, 3).map((p) => ({ id: "inv-" + p.id, label: p.name, value: (p._status || "").toUpperCase(), tone: "risk", nav: { tab: "inventory", sub: "reorder" } }))
        .concat(sellable.filter((p) => p._status === "ok").slice(0, Math.max(0, 3 - stockRisks.length)).map((p) => ({ id: "inv-" + p.id, label: p.name, value: "Healthy", nav: { tab: "inventory", sub: "fba" } }))),
    },
    {
      id: "finance", label: "Profit & Cash",
      purpose: {
        q: "Do we keep any of it?",
        body: "Revenue is money in — this bubble is what survives. Gross margin is what's left after product cost only; net margin is what's left after fees, ads AND product cost; margin flags are products leaking money; cash is what's actually in the bank.",
        qEs: "¿Nos queda algo?",
        bodyEs: "El margen combinado después de comisiones, anuncios y costo del producto, los productos que pierden dinero, y el efectivo en el banco.",
      },
      value: cm2Pct != null ? Math.round(cm2Pct) + "% margin" : (cash ? money(cash) + " cash" : "—"),
      status: (cm2Pct != null && cm2Pct < 15) || (cashRunwayWeeks != null && cashRunwayWeeks < 8) || highFlags.length ? "declining" : "steady",
      change: cash ? money(cash) + " cash" : (highFlags.length ? highFlags.length + " margin flags" : null),
      nav: { tab: "profit", sub: "finances" },
      rotate: [
        { key: "gross", label: "Gross margin", value: cm1Pct != null ? Math.round(cm1Pct) + "%" : "Enter COGS", metric: "after product cost" },
        { key: "net", label: "Net margin", value: cm2Pct != null ? Math.round(cm2Pct) + "%" : "Enter COGS", metric: "after fees + ads", tone: cm2Pct != null && cm2Pct < 15 ? "risk" : null },
        { key: "flags", label: "Margin flags", value: highFlags.length ? highFlags.length + " to fix" : "None", metric: null, tone: highFlags.length ? "risk" : null },
        { key: "cash", label: "Cash", value: cash ? money(cash) : "Connect bank", metric: cashRunwayWeeks != null ? Math.round(cashRunwayWeeks) + " wk runway" : null },
      ],
      summary: {
        what: (cm2Pct != null ? "Blended margin after Amazon fees and ads (CM2) is " + Math.round(cm2Pct) + "%. " : "Margin computes as COGS are entered in the COGS Builder. ") + (cash ? "Cash position " + money(cash) + (cashRunwayWeeks != null ? " · ~" + Math.round(cashRunwayWeeks) + " weeks of runway." : ".") : "Bank not connected — cash position unknown."),
        why: highFlags.length ? highFlags.length + " product" + (highFlags.length > 1 ? "s are" : " is") + " losing money or bleeding ad spend — profit leaks before cash ever lands." : (cm2Pct != null && cm2Pct < 15 ? "Under 15% blended margin leaves no cushion after operating costs." : "Revenue means nothing until it survives fees, ads and COGS."),
        next: highFlags.length ? "Open Margins — fix the flagged products first; they are the fastest profit recovery." : (cash ? "Review Cash Runway before approving inventory purchases or ad increases." : "Connect the bank (Plaid) in Finances so cash and runway track automatically."),
      },
      children: [
        { id: "fin-gross", label: "Gross margin — after product cost", value: cm1Pct != null ? Math.round(cm1Pct) + "%" : "Enter COGS", nav: { tab: "profit", sub: "margins" } },
        { id: "fin-net", label: "Net margin — after fees + ads", value: cm2Pct != null ? Math.round(cm2Pct) + "%" : "Enter COGS", tone: cm2Pct != null && cm2Pct < 15 ? "risk" : null, nav: { tab: "profit", sub: "margins" } },
        { id: "fin-flags", label: "Margin flags", value: highFlags.length ? highFlags.length + " to fix" : "None", tone: highFlags.length ? "risk" : null, nav: { tab: "growth", sub: "checklist" } },
        { id: "fin-cash", label: "Cash position", value: cash ? money(cash) : "Connect bank", nav: { tab: "profit", sub: "finance" } },
        { id: "fin-pnl", label: "P&L", value: null, nav: { tab: "profit", sub: "finances" } },
      ],
    },
    {
      id: "operations", label: "Operations",
      purpose: {
        q: "Is the team executing?",
        body: "Open action items across the company, who owns them, and how many are high urgency. If this bubble is red, decisions are sitting unmade.",
        qEs: "¿El equipo está ejecutando?",
        bodyEs: "Tareas abiertas, responsables y cuántas son urgentes.",
      },
      value: items.length + " open task" + (items.length === 1 ? "" : "s"),
      status: items.filter((i) => i.severity === "high").length ? "declining" : "steady",
      change: items.filter((i) => i.severity === "high").length ? items.filter((i) => i.severity === "high").length + " high urgency" : null,
      nav: { tab: "growth", sub: "checklist" },
      summary: {
        what: items.length + " open action item" + (items.length === 1 ? "" : "s") + (team.length ? " across a team of " + team.length + "." : "."),
        why: items.filter((i) => i.severity === "high").length ? items.filter((i) => i.severity === "high").length + " high-urgency item" + (items.filter((i) => i.severity === "high").length > 1 ? "s" : "") + " open." : "Work is assigned and moving.",
        next: "Assign owners and due dates on the Action Items board — reminders email automatically.",
      },
      children: [
        { id: "ops-tasks", label: "Open tasks", value: items.length + (items.filter((i) => i.severity === "high").length ? " · " + items.filter((i) => i.severity === "high").length + " high" : ""), tone: items.filter((i) => i.severity === "high").length ? "risk" : null, nav: { tab: "growth", sub: "checklist" } },
        { id: "ops-team", label: "Team", value: team.length ? team.length + " members" : "Add members", nav: { tab: "growth", sub: "checklist" } },
        { id: "ops-suppliers", label: "Suppliers", value: null, nav: { tab: "materials", sub: "suppliers" } },
        { id: "ops-fba", label: "FBA Shipments", value: inbound.length ? inbound.length + " inbound" : null, nav: { tab: "inventory", sub: "inbound" } },
      ],
    },
    {
      id: "projects", label: "Launches",
      purpose: {
        q: "What's coming?",
        body: "Products in the launch pipeline. Launches commit inventory and cash weeks before they return revenue, so they belong in every review.",
        qEs: "¿Qué viene?",
        bodyEs: "Productos por lanzar; comprometen inventario y efectivo antes de generar ingresos.",
      },
      value: inbound.length ? inbound.length + " in pipeline" : "—",
      status: "steady",
      change: null,
      nav: { tab: "roadmap" },
      summary: {
        what: inbound.length ? "Launch pipeline: " + inbound.map((p) => p.name).slice(0, 3).join(", ") + "." : "The roadmap holds the launch plan by month.",
        why: "Launches commit inventory and cash weeks before they return revenue — they belong in every executive review.",
        next: "Check the Roadmap tab for this month's commitments.",
      },
      children: inbound.slice(0, 3).map((p) => ({ id: "prj-" + p.id, label: p.name, value: "Inbound", nav: { tab: "roadmap" } })),
    },
    {
      id: "growth", label: "Wholesale",
      purpose: {
        q: "Is the B2B engine building?",
        body: "Wholesale accounts and the 239-store outreach with its three-email cadence. Every account won is repeat revenue with zero ad spend.",
        qEs: "¿Crece el canal mayorista?",
        bodyEs: "Cuentas de mayoreo y la gestión de 239 tiendas; cada cuenta es ingreso recurrente sin gasto publicitario.",
      },
      value: wsActive ? wsActive + " active account" + (wsActive === 1 ? "" : "s") : "0 secured",
      status: wsActive ? "improving" : "steady",
      change: wsLeads ? wsLeads + " lead" + (wsLeads === 1 ? "" : "s") + (wsOpp ? " · " + money(wsOpp) + " opp" : "") : (wsOpp ? money(wsOpp) + " opportunity" : null),
      nav: { tab: "growth", sub: "wholesale" },
      summary: {
        what: wsActive ? wsActive + " account" + (wsActive === 1 ? "" : "s") + " actively secured" + (wsLeads ? ", " + wsLeads + " lead" + (wsLeads === 1 ? "" : "s") + " in the pipeline" : "") + (wsOpp ? " · " + money(wsOpp) + " in opportunity value" : "") + ". The 239-store outreach is underway." : "No accounts secured yet. The B2B engine: 239 stores mapped for outreach, three-email cadence per store" + (wsLeads ? " · " + wsLeads + " lead" + (wsLeads === 1 ? "" : "s") + " working" : "") + ".",
        why: "Wholesale accounts compound — each one is repeat revenue with zero ad spend.",
        next: "Work the Outreach Timeline — the follow-up emails win the accounts.",
      },
      children: [
        { id: "gr-accounts", label: "Accounts secured", value: wsActive ? wsActive + " active" + (wsLeads ? " · " + wsLeads + " leads" : "") : "None yet", nav: { tab: "growth", sub: "wholesale" } },
        { id: "gr-outreach", label: "Retail Outreach", value: "239 stores", nav: { tab: "growth", sub: "wholesale" } },
        { id: "gr-timeline", label: "Outreach Timeline", value: "3-email cadence", nav: { tab: "growth", sub: "wholesale" } },
      ],
    },
  ];

  const lensInsights = insights.filter((i) => !i.nav || see(i.nav.tab));
  const lensNodes = nodes.filter((n) => see(BUBBLE_TAB[n.id] || "brain"));
  const lensPriorities = see("growth") ? priorities : [];

  return {
    businessType: "commerce",
    businessName,
    healthScore: health.score,
    status: health.status,
    healthNotes: health.notes,
    opportunities: lensInsights.filter((i) => i.tone === "good").length,
    risks: lensInsights.filter((i) => i.tone === "risk").length,
    insights: lensInsights.slice(0, 5),
    priorities: lensPriorities,
    nodes: lensNodes,
    lensed: !!lensTabs,
  };
}

// What the central score means — shown in the Executive Brief dropdown.
export const HEALTH_PURPOSE = {
  q: "How is the company, in one number?",
  body: "A 0-100 score computed from real operating signals: margin and ad-waste flags, stockouts, campaigns bleeding spend, cash runway, Amazon account health, and the week-over-week sales trend. Every point lost maps to something specific you can open and fix.",
  qEs: "¿Cómo está la empresa, en un número?",
  bodyEs: "Un puntaje de 0 a 100 calculado con señales reales: márgenes, inventario, anuncios, efectivo y la tendencia de ventas. Cada punto perdido corresponde a algo concreto por arreglar.",
};

// Ask-Chief starter questions, contextual per node (spec: Command View).
export const ASK_SUGGESTIONS = {
  default: ["What should I prioritize today?", "Why did profit change this week?", "Which marketing channel performed best?"],
  inventory: ["Should I reorder Bath Salts?", "What product is closest to stockout?", "How much cash will this purchase require?"],
  marketing: ["Which ad should I scale?", "Which audience is strongest?", "Why did ROAS change?"],
  finance: ["Why did profit change?", "What expenses increased?", "What is hurting cash flow?"],
  revenue: ["Which channel grew this week?", "Which product is creating margin pressure?"],
};
