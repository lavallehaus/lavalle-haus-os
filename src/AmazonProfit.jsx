import { useState, useEffect } from "react";

// LAVALLE HAUS OS — Amazon Daily Profitability
// The daily Seller Central check, in-house: per-day revenue/units/orders from
// the Sales API plus a 30-day fee/refund/net breakdown from the Finances API.
// Read-only — no Redis writes.

const c = {
  bg: "#f7f4ef", ink: "#1a1714", sub: "#8c7d6b", line: "#c8c2b8",
  green: "#5a7a5a", clay: "#a07848", red: "#9b5e5e", card: "#efece5",
};
const serif = "'IM Fell English', Georgia, serif";
const sans = "monospace";

const money = (v) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// Friendlier names for Amazon fee types
const FEE_LABEL = {
  FBAPerUnitFulfillmentFee: "FBA fulfillment",
  Commission: "Referral fee",
  FBAStorageFee: "FBA storage",
  RefundCommission: "Refund admin fee",
  DigitalServicesFee: "Digital services",
};

export default function AmazonProfit() {
  const [daily, setDaily] = useState({ loading: true, days: [], error: null });
  const [fin, setFin] = useState({ loading: true, data: null, error: null });
  const [ord, setOrd] = useState({ loading: true, orders: [], vineByDate: {}, vineUnitsByDate: {}, error: null });
  const [showLog, setShowLog] = useState(false);
  const [showRecon, setShowRecon] = useState(false);

  async function load() {
    setDaily(s => ({ ...s, loading: true, error: null }));
    setFin(s => ({ ...s, loading: true, error: null }));
    fetch("/api/amazon-sync?op=daily").then(r => r.json()).then(d => {
      if (d.days) setDaily({ loading: false, days: d.days, error: null });
      else setDaily({ loading: false, days: [], error: d.error || d.reason || "Not connected" });
    }).catch(e => setDaily({ loading: false, days: [], error: String(e) }));
    setOrd(s => ({ ...s, loading: true, error: null }));
    fetch("/api/amazon-sync?op=orders").then(r => r.json()).then(d => {
      if (d.orders) setOrd({ loading: false, orders: d.orders, vineByDate: d.vineByDate || {}, vineUnitsByDate: d.vineUnitsByDate || {}, error: null });
      else setOrd({ loading: false, orders: [], vineByDate: {}, vineUnitsByDate: {}, error: d.error || d.reason || "Not connected" });
    }).catch(e => setOrd({ loading: false, orders: [], vineByDate: {}, vineUnitsByDate: {}, error: String(e) }));
    fetch("/api/amazon-sync?op=finances").then(r => r.json()).then(d => {
      if (d.gross !== undefined) setFin({ loading: false, data: d, error: null });
      else setFin({ loading: false, data: null, error: d.error || d.reason || "Not connected" });
    }).catch(e => setFin({ loading: false, data: null, error: String(e) }));
  }
  useEffect(() => { load(); }, []);

  const days = daily.days || [];
  const byDate = {};
  days.forEach(d => { byDate[d.date] = d; });
  const todayKey = new Date().toISOString().slice(0, 10);
  const yKey = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const today = byDate[todayKey] || { sales: 0, units: 0, orders: 0 };
  const yest = byDate[yKey] || { sales: 0, units: 0, orders: 0 };
  const last7 = days.filter(d => d.date > new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
  const totals7 = { sales: sum(last7, d => d.sales), units: sum(last7, d => d.units), orders: sum(last7, d => d.orders) };
  const totals30 = { sales: sum(days, d => d.sales), units: sum(days, d => d.units), orders: sum(days, d => d.orders) };
  const last14 = days.slice(-14);
  const maxSales = Math.max(1, ...last14.map(d => d.sales));

  // Vine reconciliation: Amazon-attributed list value of $0 claims, per window.
  const vbd = ord.vineByDate || {};
  const vud = ord.vineUnitsByDate || {};
  const sumMap = (m, fromKey) => Object.keys(m).filter(k => k >= fromKey).reduce((s, k) => s + m[k], 0);
  const k7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const k30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const vAdj = {
    today: { v: vbd[todayKey] || 0, u: vud[todayKey] || 0 },
    yest: { v: vbd[yKey] || 0, u: vud[yKey] || 0 },
    d7: { v: sumMap(vbd, k7), u: sumMap(vud, k7) },
    d30: { v: sumMap(vbd, k30), u: sumMap(vud, k30) },
  };
  const real = (metric, adj) => Math.max(0, metric - adj);

  const card = { background: c.card, border: `1px solid ${c.line}`, borderRadius: 2, padding: "14px 16px" };

  function Stat({ label, labelEs, value, paren, sub }) {
    return (
      <div style={{ ...card, flex: "1 1 150px", minWidth: 150 }}>
        <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans }}>{label}</div>
        <div style={{ fontSize: 10, fontStyle: "italic", color: "rgba(111,102,87,0.55)", fontFamily: serif }}>{labelEs}</div>
        <div style={{ fontFamily: serif, fontSize: 24, color: c.ink, marginTop: 4 }}>
          {value}
          {paren && <span style={{ fontFamily: sans, fontSize: 11, color: c.sub, marginLeft: 6 }}>(Amazon: {paren})</span>}
        </div>
        {sub && <div style={{ fontSize: 10, fontFamily: sans, color: c.sub, marginTop: 2 }}>{sub}</div>}
      </div>
    );
  }

  const f = fin.data;
  const feeRows = f ? Object.entries(f.feesByType || {}).map(([t, v]) => [FEE_LABEL[t] || t, Math.abs(v)]).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div>
          <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 400, color: c.ink, margin: 0 }}>Amazon Daily</h1>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: "rgba(111,102,87,0.6)" }}>Ventas y utilidad diaria de Amazon — datos en vivo de SP-API</div>
        </div>
        <button onClick={load} style={{ background: "transparent", border: `1px solid ${c.line}`, color: c.sub, borderRadius: 1, padding: "5px 14px", cursor: "pointer", fontSize: 10, fontFamily: sans, letterSpacing: 1 }}>REFRESH</button>
      </div>

      {daily.error && <div style={{ ...card, borderLeft: `3px solid ${c.red}`, marginTop: 10 }}><span style={{ fontFamily: sans, fontSize: 11, color: c.red }}>{String(daily.error)}</span></div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <Stat label="Today" labelEs="Hoy" value={money(real(today.sales, vAdj.today.v))} paren={vAdj.today.v > 0 ? money(today.sales) : null} sub={`${real(today.units, vAdj.today.u)} units · ${today.orders} orders${vAdj.today.u ? ` · ${vAdj.today.u} vine` : ""}`} />
        <Stat label="Yesterday" labelEs="Ayer" value={money(real(yest.sales, vAdj.yest.v))} paren={vAdj.yest.v > 0 ? money(yest.sales) : null} sub={`${real(yest.units, vAdj.yest.u)} units · ${yest.orders} orders${vAdj.yest.u ? ` · ${vAdj.yest.u} vine` : ""}`} />
        <Stat label="Last 7 days" labelEs="Últimos 7 días" value={money(real(totals7.sales, vAdj.d7.v))} paren={vAdj.d7.v > 0 ? money(totals7.sales) : null} sub={`${real(totals7.units, vAdj.d7.u)} units · ${totals7.orders} orders${vAdj.d7.u ? ` · ${vAdj.d7.u} vine` : ""}`} />
        <Stat label="Last 30 days" labelEs="Últimos 30 días" value={money(real(totals30.sales, vAdj.d30.v))} paren={vAdj.d30.v > 0 ? money(totals30.sales) : null} sub={`${real(totals30.units, vAdj.d30.u)} units · ${totals30.orders} orders${vAdj.d30.u ? ` · ${vAdj.d30.u} vine` : ""}`} />
      </div>

      {vAdj.d30.v > 0 && (
        <div style={{ ...card, marginTop: 12, borderLeft: `3px solid ${c.clay}` }}>
          <div onClick={() => setShowRecon(!showRecon)} style={{ cursor: "pointer", fontSize: 10, fontFamily: sans, letterSpacing: 1, color: c.clay }}>
            {showRecon ? "▾" : "▸"} RECONCILIATION — why our number differs from Amazon's dashboard
          </div>
          <div style={{ fontSize: 10, fontStyle: "italic", color: "rgba(111,102,87,0.55)", fontFamily: serif, marginTop: 2 }}>Reconciliación — por qué nuestro número difiere del tablero de Amazon</div>
          {showRecon && (
            <div style={{ marginTop: 8, fontFamily: sans, fontSize: 12, color: c.sub }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}><span>Amazon dashboard, last 30 days (ordered product sales)</span><span style={{ color: c.ink }}>{money(totals30.sales)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderTop: "1px solid #00000008" }}><span>− Vine claims at attributed list value ({vAdj.d30.u} units, $0 actually paid)</span><span style={{ color: c.clay }}>({money(vAdj.d30.v)})</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderTop: `1px solid ${c.line}`, fontWeight: 700 }}><span style={{ color: c.ink }}>= Actual product sales</span><span style={{ color: c.green }}>{money(real(totals30.sales, vAdj.d30.v))}</span></div>
              <div style={{ fontSize: 10, fontStyle: "italic", color: "rgba(111,102,87,0.55)", fontFamily: serif, marginTop: 6 }}>
                Amazon's dashboard records Vine claims at full list price; the 100% rebate only appears at transaction level. Both numbers are shown so this system always reconciles to what Amazon displays. The same adjustment applies to each card above.
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ ...card, marginTop: 12 }}>
        <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans, marginBottom: 8 }}>Daily revenue · last 14 days</div>
        {daily.loading && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>Loading…</div>}
        {last14.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
            <span style={{ width: 74, fontFamily: sans, fontSize: 10, color: c.sub }}>{d.date.slice(5)}</span>
            <div style={{ flex: 1, height: 10, background: "#e5e1da", borderRadius: 1 }}>
              <div style={{ width: `${(d.sales / maxSales) * 100}%`, height: "100%", background: c.green, borderRadius: 1 }} />
            </div>
            <span style={{ width: 90, textAlign: "right", fontFamily: sans, fontSize: 11, color: c.ink }}>{money(d.sales)}</span>
            <span style={{ width: 50, textAlign: "right", fontFamily: sans, fontSize: 10, color: c.sub }}>{d.units}u</span>
          </div>
        ))}
      </div>

      {(() => {
        const orders = ord.orders || [];
        const real = orders.filter(o => o.kind === "real");
        const vine = orders.filter(o => o.kind === "vine");
        const pending = orders.filter(o => o.kind === "pending");
        const realRev = real.reduce((s, o) => s + (o.total || 0), 0);
        const vineUnits = vine.reduce((s, o) => s + (o.units || 0), 0);
        const KIND_STYLE = {
          real: { color: c.green, label: "SALE" },
          vine: { color: c.clay, label: "VINE / $0" },
          pending: { color: c.sub, label: "PENDING" },
          canceled: { color: c.red, label: "CANCELED" },
        };
        return (
          <div style={{ ...card, marginTop: 12 }}>
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans }}>Order ledger · last 30 days</div>
            <div style={{ fontSize: 10, fontStyle: "italic", color: "rgba(111,102,87,0.55)", fontFamily: serif, marginBottom: 8 }}>Registro de pedidos — las reclamaciones Vine se separan de las ventas reales</div>
            {ord.error && <span style={{ fontFamily: sans, fontSize: 11, color: c.red }}>{String(ord.error)}</span>}
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 8 }}>
              <div><span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>REAL ORDERS </span><span style={{ fontFamily: serif, fontSize: 20, color: c.ink }}>{real.length}</span><span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}> · {money(realRev)} incl. tax/ship</span></div>
              <div><span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>VINE / $0 </span><span style={{ fontFamily: serif, fontSize: 20, color: c.clay }}>{vine.length}</span><span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}> · {vineUnits} units given</span></div>
              {pending.length > 0 && <div><span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>PENDING </span><span style={{ fontFamily: serif, fontSize: 20, color: c.sub }}>{pending.length}</span></div>}
            </div>
            <div onClick={() => setShowLog(!showLog)} style={{ cursor: "pointer", fontSize: 10, fontFamily: sans, letterSpacing: 1, color: c.green }}>
              {showLog ? "▾" : "▸"} EVERY ORDER · {orders.length}
            </div>
            {showLog && (
              <div style={{ marginTop: 6, borderLeft: `2px solid ${c.line}`, paddingLeft: 10, maxHeight: 420, overflowY: "auto" }}>
                {orders.map((o, i) => {
                  const ks = KIND_STYLE[o.kind] || KIND_STYLE.real;
                  return (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontFamily: sans, fontSize: 11, color: c.sub, padding: "3px 0", borderBottom: "1px solid #00000008", flexWrap: "wrap" }}>
                      <span style={{ whiteSpace: "nowrap" }}>{(o.date || "").slice(0, 10)}</span>
                      <span style={{ flex: 1, minWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.id}</span>
                      <span style={{ fontSize: 9, letterSpacing: 1, color: ks.color, border: `1px solid ${ks.color}40`, borderRadius: 1, padding: "1px 6px" }}>{ks.label}</span>
                      <span style={{ width: 36, textAlign: "right" }}>{o.units}u</span>
                      <span style={{ width: 110, textAlign: "right", color: o.kind === "vine" ? c.clay : c.ink }}>{o.kind === "vine" && o.attributed ? `$0 (${money(o.attributed)} list)` : o.total === null ? "—" : money(o.total)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      <div style={{ ...card, marginTop: 12, borderLeft: `3px solid ${c.green}` }}>
        <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans }}>True profit · last 30 days settled</div>
        <div style={{ fontSize: 10, fontStyle: "italic", color: "rgba(111,102,87,0.55)", fontFamily: serif, marginBottom: 8 }}>Utilidad real — ingresos menos comisiones y reembolsos, de la API de Finanzas</div>
        {fin.loading && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>Loading settlement data…</div>}
        {fin.error && <span style={{ fontFamily: sans, fontSize: 11, color: c.red }}>{String(fin.error)}</span>}
        {f && (
          <div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 10 }}>
              <div><span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>GROSS </span><span style={{ fontFamily: serif, fontSize: 20, color: c.ink }}>{money(f.gross)}</span></div>
              <div><span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>FEES </span><span style={{ fontFamily: serif, fontSize: 20, color: c.clay }}>({money(f.totalFees)})</span></div>
              <div><span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>REFUNDS </span><span style={{ fontFamily: serif, fontSize: 20, color: c.red }}>({money(f.refunds)})</span></div>
              <div><span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>NET </span><span style={{ fontFamily: serif, fontSize: 22, color: f.net >= 0 ? c.green : c.red }}>{money(f.net)}</span></div>
            </div>
            {feeRows.map(([t, v], i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontFamily: sans, fontSize: 11, color: c.sub, padding: "2px 0", borderTop: "1px solid #00000008" }}>
                <span>{t}</span><span>({money(v)})</span>
              </div>
            ))}
            <div style={{ fontSize: 10, fontStyle: "italic", color: "rgba(111,102,87,0.55)", fontFamily: serif, marginTop: 8 }}>
              Settled events only — Amazon posts financial events with a delay, so the newest day or two may not be reflected yet.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
