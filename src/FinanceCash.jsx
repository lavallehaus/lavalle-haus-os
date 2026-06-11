import { useMemo } from "react";

/* ============================================================================
   LAVALLE HAUS OS — FINANCE / CASH (Financial COO layer)
   Reads the COGS data you've already entered to show real gross margins per
   SKU and flag unprofitable / thin-margin products. The deeper metrics
   (CM2, net profit, cash runway, cash conversion cycle) need accounting +
   per-SKU sales mapping, so they're marked pending until those feeds connect.
       <FinanceCash products={...} weeks={...} cogs={...} />
   ========================================================================== */

const c = {
  bg: "#f7f4ef", panel: "#fffdf9", ink: "#2b2620", sub: "#6f6657",
  line: "#e4ddd0", lineSoft: "#efe9de", clay: "#a8643c", gold: "#b08d57",
  green: "#5c7a52", yellow: "#b78b2e", red: "#a8483a",
};
const serif = "'IM Fell English', Georgia, 'Times New Roman', serif";
const sans = "'IM Fell English', Georgia, serif";
const faintEs = { fontFamily: sans, fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 1, lineHeight: 1.3 };

const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? 0 : Number(v));
const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(num(n)).toLocaleString("en-US", { maximumFractionDigits: 0 });
const money2 = (n) => (n < 0 ? "-$" : "$") + Math.abs(num(n)).toFixed(2);
const pct = (n) => (n * 100).toFixed(0) + "%";
const mColor = (m) => (m >= 0.5 ? c.green : m >= 0.25 ? c.yellow : c.red);

// Minimal landed-cost calc, matching the COGS Builder engine.
const lineCost = (l) => num(l.qty) * num(l.unitCost);
const perUnit = (cost, basis, y) => (basis === "batch" ? cost / Math.max(y, 1) : cost);
function landedCost(p, rate) {
  const y = Math.max(num(p.batchYield), 1);
  const hidden = (k) => Array.isArray(p.hiddenSections) && p.hiddenSections.includes(k);
  const sum = (rows, isLabor) => (rows || []).reduce((s, l) => s + perUnit(isLabor ? num(l.hours) * num(rate) : lineCost(l), l.basis, y), 0);
  return (hidden("materials") ? 0 : sum(p.materials, false))
    + (hidden("packaging") ? 0 : sum(p.packaging, false))
    + (hidden("shipping") ? 0 : sum(p.shipping, false))
    + (hidden("labor") ? 0 : sum(p.labor, true));
}

const S = {
  wrap: { fontFamily: serif, color: c.ink, background: c.bg, padding: "26px 22px 60px", maxWidth: 1180, margin: "0 auto" },
  h1: { fontFamily: serif, fontSize: 30, fontWeight: 400, letterSpacing: 0.3, margin: 0 },
  sub: { color: c.sub, fontSize: 14.5, marginTop: 4, fontStyle: "italic" },
  sec: { fontSize: 19, fontWeight: 400, margin: "28px 0 12px", letterSpacing: 0.3, borderBottom: `1px solid ${c.line}`, paddingBottom: 8 },
  panel: { background: c.panel, border: `1px solid ${c.line}`, borderRadius: 4, padding: 18 },
  cap: { fontFamily: sans, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: c.sub },
  th: { fontFamily: sans, fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", color: c.sub, padding: "7px 8px", textAlign: "right", borderBottom: `1px solid ${c.line}`, whiteSpace: "nowrap" },
  thL: { textAlign: "left" },
  td: { fontSize: 13, padding: "7px 8px", textAlign: "right", borderBottom: `1px solid ${c.lineSoft}`, whiteSpace: "nowrap" },
  tdL: { textAlign: "left" },
};

const Metric = ({ label, labelEs, value, note, pending }) => (
  <div style={{ ...S.panel, padding: "14px 16px", opacity: pending ? 0.7 : 1 }}>
    <div style={S.cap}>{label}</div><div style={faintEs}>{labelEs}</div>
    <div style={{ fontSize: pending ? 13 : 24, marginTop: 6, color: pending ? c.sub : c.ink, fontStyle: pending ? "italic" : "normal" }}>{value}</div>
    {note && <div style={{ fontSize: 11.5, color: c.sub, marginTop: 3 }}>{note}</div>}
  </div>
);

export default function FinanceCash({ products = [], weeks = [], cogs = {}, pnl = {} }) {
  // Real numbers from the P&L tab's imported statements.
  const pnlStats = useMemo(() => {
    const tx = Array.isArray(pnl.transactions) ? pnl.transactions : [];
    if (!tx.length) return null;
    let income = 0, expense = 0, mIncome = 0, mExpense = 0;
    const months = new Set();
    const ym = new Date().toISOString().slice(0, 7);
    tx.forEach((t) => {
      const amt = num(t.amount);
      if (typeof t.date === "string" && t.date.length >= 7) months.add(t.date.slice(0, 7));
      const thisMonth = typeof t.date === "string" && t.date.startsWith(ym);
      if (t.type === "income") { income += amt; if (thisMonth) mIncome += amt; }
      else { expense += amt; if (thisMonth) mExpense += amt; }
    });
    const monthCount = Math.max(months.size, 1);
    return { net: income - expense, monthNet: mIncome - mExpense, avgBurn: expense / monthCount, count: tx.length, monthCount };
  }, [pnl]);

  const fin = useMemo(() => {
    const rate = num(cogs.laborRate) || 15;
    const rows = (cogs.products || []).map((p) => {
      const retail = num(p.retail);
      const landed = landedCost(p, rate);
      const margin = retail > 0 ? (retail - landed) / retail : 0;
      return { name: p.name || "Untitled", retail, landed, margin, has: retail > 0 };
    }).filter((r) => r.has).sort((a, b) => a.margin - b.margin);

    const avgMargin = rows.length ? rows.reduce((s, r) => s + r.margin, 0) / rows.length : 0;
    const unprofitable = rows.filter((r) => r.margin <= 0);
    const thin = rows.filter((r) => r.margin > 0 && r.margin < 0.25);

    const wk = weeks[0] || null, prev = weeks[1] || null;
    const revenue = wk ? num(wk.revenue) : 0;
    const revPrev = prev ? num(prev.revenue) : 0;
    const revDelta = revPrev > 0 ? (revenue - revPrev) / revPrev : null;
    const adSpend = wk ? num(wk.adSpend) : 0;
    const tacos = revenue > 0 ? adSpend / revenue : 0;

    const issues = [];
    unprofitable.forEach((r) => issues.push(`${r.name} sells below cost — ${pct(r.margin)} gross margin. Raise price or cut landed cost.`));
    thin.forEach((r) => issues.push(`${r.name} is thin at ${pct(r.margin)} gross margin — little room for ads or fees.`));
    if (tacos > 0.25) issues.push(`TACOS at ${pct(tacos)} is compressing margin — review underperforming campaigns.`);
    if (revDelta != null && revDelta < -0.15) issues.push(`Revenue down ${pct(Math.abs(revDelta))} week-over-week — check demand and stock.`);

    return { rows, avgMargin, unprofitable, thin, revenue, revDelta, adSpend, tacos, issues };
  }, [products, weeks, cogs]);

  const f = fin;

  return (
    <div style={S.wrap}>
      <div>
        <h1 style={S.h1}>Finance / Cash</h1><div style={faintEs}>Finanzas / Caja — capa financiera</div>
        <div style={S.sub}>Real gross margins from your COGS work, plus the cash metrics waiting on accounting.</div>
        <div style={faintEs}>Márgenes brutos reales de tu COGS, más las métricas de caja que esperan contabilidad.</div>
      </div>

      {/* HEADLINE METRICS */}
      <div style={S.sec}>Margins<div style={faintEs}>Márgenes</div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}>
        <Metric label="Avg gross margin" labelEs="Margen bruto prom." value={f.rows.length ? pct(f.avgMargin) : "no COGS yet"}
          note={f.rows.length ? `${f.rows.length} SKUs costed` : "build SKUs in COGS first"} pending={!f.rows.length} />
        <Metric label="Unprofitable SKUs" labelEs="SKUs no rentables" value={String(f.unprofitable.length)}
          note={f.unprofitable.length ? "selling at or below cost" : "none — good"} />
        <Metric label="Thin-margin SKUs" labelEs="SKUs de margen bajo" value={String(f.thin.length)} note="under 25% gross" />
        <Metric label="This week revenue" labelEs="Ingresos semana" value={f.revenue ? money(f.revenue) : "no week logged"}
          note={f.revDelta != null ? `${f.revDelta >= 0 ? "▲" : "▼"} ${pct(Math.abs(f.revDelta))} vs last week` : "log weekly numbers"} pending={!f.revenue} />
        <Metric label="TACOS" labelEs="TACOS" value={f.revenue ? pct(f.tacos) : "—"} note="ad spend ÷ revenue" pending={!f.revenue} />
      </div>

      {/* GROSS MARGIN BY SKU */}
      <div style={S.sec}>Gross Margin by SKU<div style={faintEs}>Margen bruto por SKU</div></div>
      {f.rows.length ? (
        <div style={{ overflowX: "auto", border: `1px solid ${c.lineSoft}`, borderRadius: 3 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
            <thead><tr>
              <th style={{ ...S.th, ...S.thL }}>Product<div style={faintEs}>Producto</div></th>
              <th style={S.th}>Retail<div style={faintEs}>Precio</div></th>
              <th style={S.th}>Landed cost<div style={faintEs}>Costo destino</div></th>
              <th style={S.th}>Gross margin<div style={faintEs}>Margen bruto</div></th>
            </tr></thead>
            <tbody>
              {f.rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...S.td, ...S.tdL }}>{r.name}</td>
                  <td style={S.td}>{money2(r.retail)}</td>
                  <td style={S.td}>{money2(r.landed)}</td>
                  <td style={{ ...S.td, color: mColor(r.margin) }}>{pct(r.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div style={{ ...S.panel, fontStyle: "italic", color: c.sub, fontSize: 13 }}>No costed products yet — add retail prices and cost lines in the COGS tab and they'll appear here. · Aún no hay productos con costo — agrégalos en la pestaña COGS.</div>}

      {/* DETECTED ISSUES */}
      <div style={S.sec}>Detected Issues<div style={faintEs}>Problemas detectados</div></div>
      <div style={S.panel}>
        {f.issues.length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {f.issues.map((t, i) => <li key={i} style={{ fontSize: 13.5, color: c.ink, marginBottom: 6, lineHeight: 1.4 }}>{t}</li>)}
          </ul>
        ) : <div style={{ fontSize: 13, color: c.sub, fontStyle: "italic" }}>No margin or cash-flow risks detected from current data. · Sin riesgos detectados.</div>}
      </div>

      {/* PENDING — accounting-dependent */}
      <div style={S.sec}>Cash &amp; Profit<div style={faintEs}>Caja y utilidad</div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}>
        <Metric label="CM1 (after COGS)" labelEs="CM1 (tras COGS)" value="pending" pending note="needs per-SKU weekly sales mapping" />
        <Metric label="CM2 (after ads/fees)" labelEs="CM2 (tras anuncios)" value="pending" pending note="needs sales mapping + ad/fee feeds" />
        {pnlStats ? (
          <Metric label="Net profit" labelEs="Utilidad neta" value={money(pnlStats.net)}
            note={`from P&L · ${pnlStats.count} transactions · this month ${money(pnlStats.monthNet)}`} />
        ) : (
          <Metric label="Net profit" labelEs="Utilidad neta" value="pending" pending note="import statements in the P&L tab" />
        )}
        <Metric label="Cash runway" labelEs="Pista de efectivo" value={pnlStats ? "add cash balance" : "connect accounting"} pending
          note={pnlStats ? `avg spend ${money(pnlStats.avgBurn)}/mo over ${pnlStats.monthCount} month${pnlStats.monthCount === 1 ? "" : "s"}` : "QuickBooks / Xero"} />
        <Metric label="Cash conversion cycle" labelEs="Ciclo de conversión" value="connect accounting" pending note="DIO + DSO − DPO" />
      </div>
      <div style={{ fontSize: 11.5, color: c.sub, fontStyle: "italic", marginTop: 10 }}>
        These fill in once you map weekly sales to SKUs and connect QuickBooks/Xero — then this becomes a full P&amp;L and cash view.
        <div style={faintEs}>Estas se completan al mapear ventas semanales a SKUs y conectar QuickBooks/Xero — entonces será un estado de resultados y caja completo.</div>
      </div>
    </div>
  );
}
