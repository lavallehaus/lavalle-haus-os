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

// ── The Brain ────────────────────────────────────────────────────────────────
// ctx is assembled in App.jsx from live state. Products arrive with a
// precomputed `_status` (the same stockStatus the Inventory tab shows).
export function buildBrainModel(ctx) {
  const {
    businessName = "Lavalle Haus",
    products = [], campaigns = [], flags = [],
    shopifySales = null, amazonSales = null,
    bankCash = null, pnl = {}, actionsBoard = {},
    wholesale = [], accountHealth = null, cashRunwayWeeks = null,
  } = ctx;

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

  const adSpend30 = campaigns.reduce((s, c) => s + num(c.spend7d) * (30 / 7), 0);
  const bestCampaign = campaigns.filter((c) => num(c.roas) > 0).sort((a, b) => num(b.roas) - num(a.roas))[0] || null;

  const items = (actionsBoard.items || []).filter((it) => it.status !== "done" && it.status !== "resolved");
  const team = actionsBoard.team || [];
  const memberName = (id) => { const m = team.find((t) => t.id === id); return m ? m.name : null; };

  const health = buildHealth({
    highFlags: highFlags.length, medFlags: medFlags.length,
    criticalStock: stockRisks.length, pausedCampaigns: paused.length,
    runwayWeeks: cashRunwayWeeks, accountHealth, wowPct,
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
      value: revNow != null ? money(revNow) + " wk" : (rev28 ? money(rev28) + " /28d" : "—"),
      status: wowPct == null ? "steady" : wowPct >= 0 ? "improving" : "declining",
      change: changeLabel(wowPct),
      nav: { tab: "profit", sub: "matrix" },
      summary: {
        what: revNow != null ? "This week " + money(revNow) + " across channels (Shopify " + (shopNow != null ? money(shopNow) : "—") + ", Amazon " + (amzNow != null ? money(amzNow) : "—") + ")." : "Live sales feeds connect here as Shopify and Amazon sync.",
        why: wowPct != null ? "Week-over-week " + (wowPct >= 0 ? "growth" : "decline") + " of " + Math.abs(wowPct) + "% vs " + money(revPrev) + " last week." : "Trailing 28 days: " + money(rev28) + ".",
        next: wowPct != null && wowPct < 0 ? "Open the Profit Matrix to see which channel or product drove the dip." : "Keep the winning channel funded; review the Profit Matrix weekly.",
      },
      children: [
        { id: "rev-shopify", label: "Shopify", value: shopNow != null ? money(shopNow) + " wk" : "—", nav: { tab: "profit", sub: "matrix" } },
        { id: "rev-amazon", label: "Amazon", value: amzNow != null ? money(amzNow) + " wk" : "—", nav: { tab: "profit", sub: "amazondaily" } },
        { id: "rev-wholesale", label: "Wholesale", value: wholesale.length ? wholesale.length + " accounts" : "—", nav: { tab: "growth", sub: "wholesale" } },
      ],
    },
    {
      id: "marketing", label: "Marketing",
      value: adSpend30 ? money(adSpend30) + " /mo" : "—",
      status: paused.length ? "declining" : bestCampaign ? "improving" : "steady",
      change: paused.length ? paused.length + " to pause" : null,
      nav: { tab: "ads", sub: "ppc" },
      summary: {
        what: campaigns.length + " Amazon campaigns, ~" + money(adSpend30) + "/month in spend.",
        why: paused.length ? paused.length + " campaign" + (paused.length > 1 ? "s have" : " has") + " spend with no sales — pure loss until paused." : bestCampaign ? "Top ROAS " + num(bestCampaign.roas).toFixed(2) + " (" + bestCampaign.name + ")." : "No standout performance signals this week.",
        next: paused.length ? "Pause the flagged campaign" + (paused.length > 1 ? "s" : "") + " and move budget to the top performer." : "Scale the best performer gently; keep TACOS under 30%.",
      },
      children: [
        { id: "mkt-ppc", label: "Amazon PPC", value: campaigns.length + " campaigns", nav: { tab: "ads", sub: "ppc" } },
        { id: "mkt-meta", label: "Meta / Shopify", value: null, nav: { tab: "ads", sub: "meta" } },
        { id: "mkt-email", label: "Email / Klaviyo", value: null, nav: { tab: "growth", sub: "email" } },
      ],
    },
    {
      id: "inventory", label: "Inventory",
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
      id: "finance", label: "Finance",
      value: cash != null ? money(cash) : "—",
      status: cashRunwayWeeks != null && cashRunwayWeeks < 8 ? "declining" : "steady",
      change: cashRunwayWeeks != null ? Math.round(cashRunwayWeeks) + " wk runway" : null,
      nav: { tab: "profit", sub: "finances" },
      summary: {
        what: cash != null ? "Cash position " + money(cash) + (cashRunwayWeeks != null ? " · ~" + Math.round(cashRunwayWeeks) + " weeks of runway." : ".") : "Connect the bank (Plaid) to track cash position and runway automatically.",
        why: cashRunwayWeeks != null && cashRunwayWeeks < 8 ? "Runway under 8 weeks deserves an owner-level decision on spend." : "P&L and cash runway live in Finances.",
        next: "Review Cash Runway before approving inventory purchases or ad increases.",
      },
      children: [
        { id: "fin-cash", label: "Cash Flow", value: cash != null ? money(cash) : "—", nav: { tab: "profit", sub: "finance" } },
        { id: "fin-pnl", label: "P&L", value: null, nav: { tab: "profit", sub: "finances" } },
        { id: "fin-margins", label: "Margins", value: highFlags.length ? highFlags.length + " flags" : "OK", tone: highFlags.length ? "risk" : null, nav: { tab: "profit", sub: "margins" } },
      ],
    },
    {
      id: "operations", label: "Operations",
      value: team.length ? team.length + " team" : "—",
      status: "steady",
      change: null,
      nav: { tab: "growth", sub: "checklist" },
      summary: {
        what: items.length + " open action item" + (items.length === 1 ? "" : "s") + (team.length ? " across a team of " + team.length + "." : "."),
        why: items.filter((i) => i.severity === "high").length ? items.filter((i) => i.severity === "high").length + " high-urgency item" + (items.filter((i) => i.severity === "high").length > 1 ? "s" : "") + " open." : "Work is assigned and moving.",
        next: "Assign owners and due dates on the Action Items board — reminders email automatically.",
      },
      children: [
        { id: "ops-team", label: "Team", value: team.length ? team.length + " members" : "Add members", nav: { tab: "growth", sub: "checklist" } },
        { id: "ops-suppliers", label: "Suppliers", value: null, nav: { tab: "materials", sub: "suppliers" } },
        { id: "ops-fba", label: "FBA Shipments", value: inbound.length ? inbound.length + " inbound" : null, nav: { tab: "inventory", sub: "inbound" } },
      ],
    },
    {
      id: "projects", label: "Projects",
      value: inbound.length ? inbound.length + " launching" : "—",
      status: "steady",
      change: null,
      nav: { tab: "roadmap" },
      summary: {
        what: inbound.length ? "Launch pipeline: " + inbound.map((p) => p.name).slice(0, 3).join(", ") + "." : "The roadmap holds the launch plan by month.",
        why: "Upcoming launches drive inventory and cash decisions weeks ahead of revenue.",
        next: "Check the Roadmap tab for this month's commitments.",
      },
      children: inbound.slice(0, 3).map((p) => ({ id: "prj-" + p.id, label: p.name, value: "Inbound", nav: { tab: "roadmap" } })),
    },
    {
      id: "growth", label: "Growth",
      value: wholesale.length ? wholesale.length + " accounts" : "—",
      status: "steady",
      change: null,
      nav: { tab: "growth", sub: "wholesale" },
      summary: {
        what: "Wholesale, retail expansion, creators and email retention all live under Growth.",
        why: "B2B accounts compound: each one is repeat revenue without ad spend.",
        next: "Work the wholesale outreach timeline — follow-ups win the accounts.",
      },
      children: [
        { id: "gr-wholesale", label: "Wholesale", value: wholesale.length ? wholesale.length + " accounts" : null, nav: { tab: "growth", sub: "wholesale" } },
        { id: "gr-retail", label: "Retail", value: null, nav: { tab: "growth", sub: "retail" } },
        { id: "gr-creators", label: "Creators", value: null, nav: { tab: "growth", sub: "creators" } },
      ],
    },
  ];

  return {
    businessType: "commerce",
    businessName,
    healthScore: health.score,
    status: health.status,
    healthNotes: health.notes,
    opportunities,
    risks,
    insights: insights.slice(0, 5),
    priorities,
    nodes,
  };
}

// Ask-Chief starter questions, contextual per node (spec: Command View).
export const ASK_SUGGESTIONS = {
  default: ["What should I prioritize today?", "Why did profit change this week?", "Which marketing channel performed best?"],
  inventory: ["Should I reorder Bath Salts?", "What product is closest to stockout?", "How much cash will this purchase require?"],
  marketing: ["Which ad should I scale?", "Which audience is strongest?", "Why did ROAS change?"],
  finance: ["Why did profit change?", "What expenses increased?", "What is hurting cash flow?"],
  revenue: ["Which channel grew this week?", "Which product is creating margin pressure?"],
};
