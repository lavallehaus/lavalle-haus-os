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

export default function AmazonProfit({ products = [] }) {
  const [daily, setDaily] = useState({ loading: true, days: [], error: null });
  const [fin, setFin] = useState({ loading: true, data: null, error: null });
  const [ord, setOrd] = useState({ loading: true, orders: [], vineByDate: {}, vineUnitsByDate: {}, error: null });
  const [showLog, setShowLog] = useState(false);
  const [showRecon, setShowRecon] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);

  // ── Period explorer state ──
  const dkey = (d) => d.toISOString().slice(0, 10);
  const NOW = new Date();
  const [periodMode, setPeriodMode] = useState("30D");
  const [pStart, setPStart] = useState(dkey(new Date(Date.now() - 30 * 86400000)));
  const [pEnd, setPEnd] = useState(dkey(NOW));
  const [pDaily, setPDaily] = useState({ loading: false, days: [], error: null });
  const [pOrd, setPOrd] = useState({ loading: false, orders: [], vineByDate: {}, vineUnitsByDate: {}, vineValue: 0, error: null });
  const [showPLog, setShowPLog] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [netSeries, setNetSeries] = useState({ loading: true, months: [], truncated: false, error: null });
  const [netGran, setNetGran] = useState("MONTH");
  const [hoverNet, setHoverNet] = useState(null);
  const [chartSlide, setChartSlide] = useState(0); // 0 = growth, 1 = net
  const [sns, setSns] = useState({ phase: "idle", headers: [], rows: [], error: null });
  const [showSnsRaw, setShowSnsRaw] = useState(false);

  async function loadSns() {
    setSns({ phase: "creating", headers: [], rows: [], error: null });
    try {
      const cr = await fetch("/api/amazon-sync?op=sns&action=create").then(r => r.json());
      if (!cr.reportId) throw new Error(cr.error || "Could not request the report");
      setSns(s => ({ ...s, phase: "polling" }));
      let docId = null;
      for (let i = 0; i < 30; i++) {
        await new Promise(res => setTimeout(res, 4000));
        const st = await fetch(`/api/amazon-sync?op=sns&action=status&reportId=${encodeURIComponent(cr.reportId)}`).then(r => r.json());
        if (st.processingStatus === "DONE" && st.reportDocumentId) { docId = st.reportDocumentId; break; }
        if (st.processingStatus === "FATAL" || st.processingStatus === "CANCELLED") throw new Error(`Amazon could not generate the report (${st.processingStatus})`);
      }
      if (!docId) throw new Error("Report is taking longer than 2 minutes — try again shortly");
      setSns(s => ({ ...s, phase: "downloading" }));
      const doc = await fetch(`/api/amazon-sync?op=sns&action=download&documentId=${encodeURIComponent(docId)}`).then(r => r.json());
      if (!doc.headers) throw new Error(doc.error || "Could not read the report");
      setSns({ phase: "ready", headers: doc.headers, rows: doc.rows || [], error: null });
    } catch (e) {
      setSns({ phase: "error", headers: [], rows: [], error: String(e).slice(0, 300) });
    }
  }

  function rangeFor(mode) {
    const t = new Date();
    const y = t.getFullYear(), m = t.getMonth();
    if (mode === "7D") return [dkey(new Date(Date.now() - 7 * 86400000)), dkey(t)];
    if (mode === "30D") return [dkey(new Date(Date.now() - 30 * 86400000)), dkey(t)];
    if (mode === "90D") return [dkey(new Date(Date.now() - 90 * 86400000)), dkey(t)];
    if (mode === "THIS MONTH") return [dkey(new Date(Date.UTC(y, m, 1))), dkey(t)];
    if (mode === "LAST MONTH") return [dkey(new Date(Date.UTC(y, m - 1, 1))), dkey(new Date(Date.UTC(y, m, 0)))];
    if (mode === "YTD") return [`${y}-01-01`, dkey(t)];
    return [pStart, pEnd];
  }

  function loadPeriod(start, end) {
    const spanDays = Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000));
    const gran = spanDays > 95 ? "Month" : "Day";
    setPDaily(s => ({ ...s, loading: true, error: null }));
    setPOrd(s => ({ ...s, loading: true, error: null }));
    fetch(`/api/amazon-sync?op=daily&start=${start}&end=${end}&granularity=${gran}`).then(r => r.json()).then(d => {
      if (d.days) setPDaily({ loading: false, days: d.days, error: null });
      else setPDaily({ loading: false, days: [], error: d.error || "Not connected" });
    }).catch(e => setPDaily({ loading: false, days: [], error: String(e) }));
    fetch(`/api/amazon-sync?op=orders&start=${start}&end=${end}`).then(r => r.json()).then(d => {
      if (d.orders) setPOrd({ loading: false, orders: d.orders, vineByDate: d.vineByDate || {}, vineUnitsByDate: d.vineUnitsByDate || {}, vineValue: d.vineValue || 0, error: null });
      else setPOrd({ loading: false, orders: [], vineByDate: {}, vineUnitsByDate: {}, vineValue: 0, error: d.error || "Not connected" });
    }).catch(e => setPOrd({ loading: false, orders: [], vineByDate: {}, vineUnitsByDate: {}, vineValue: 0, error: String(e) }));
  }

  function pickPeriod(mode) {
    setPeriodMode(mode);
    if (mode !== "CUSTOM" && mode !== "DAY") {
      const [s, e] = rangeFor(mode);
      setPStart(s); setPEnd(e);
      loadPeriod(s, e);
    }
    if (mode === "DAY") { /* waits for date pick */ }
  }
  useEffect(() => { loadPeriod(pStart, pEnd); }, []);

  async function load() {
    setDaily(s => ({ ...s, loading: true, error: null }));
    setFin(s => ({ ...s, loading: true, error: null }));
    fetch("/api/amazon-sync?op=daily").then(r => r.json()).then(d => {
      setFetchedAt(new Date());
      if (d.days) setDaily({ loading: false, days: d.days, error: null });
      else setDaily({ loading: false, days: [], error: d.error || d.reason || "Not connected" });
    }).catch(e => setDaily({ loading: false, days: [], error: String(e) }));
    setNetSeries(s => ({ ...s, loading: true, error: null }));
    fetch("/api/amazon-sync?op=netseries").then(r => r.json()).then(d => {
      if (d.months) setNetSeries({ loading: false, months: d.months, truncated: !!d.truncated, error: null });
      else setNetSeries({ loading: false, months: [], truncated: false, error: d.error || "Not connected" });
    }).catch(e => setNetSeries({ loading: false, months: [], truncated: false, error: String(e) }));
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
        <div style={{ textAlign: "right" }}>
          <button onClick={() => { load(); loadPeriod(pStart, pEnd); }} style={{ background: "transparent", border: `1px solid ${c.line}`, color: c.sub, borderRadius: 1, padding: "5px 14px", cursor: "pointer", fontSize: 10, fontFamily: sans, letterSpacing: 1 }}>REFRESH</button>
          <div style={{ fontSize: 9, fontFamily: sans, letterSpacing: 1, color: fetchedAt ? c.green : c.sub, marginTop: 4 }}>
            {fetchedAt ? `● DATA AS OF ${fetchedAt.toLocaleTimeString()}` : "○ FETCHING…"}
          </div>
          <div style={{ fontSize: 9, fontStyle: "italic", color: "rgba(111,102,87,0.55)", fontFamily: serif }}>{fetchedAt ? "datos en vivo de Amazon" : ""}</div>
        </div>
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

      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setChartSlide(0)} disabled={chartSlide === 0} style={{ background: "transparent", border: "none", color: chartSlide === 0 ? c.line : c.ink, fontSize: 18, cursor: chartSlide === 0 ? "default" : "pointer", padding: "0 4px" }}>‹</button>
          {["GROWTH CURVE", "NET PROFIT CURVE"].map((l, i) => (
            <button key={l} onClick={() => setChartSlide(i)} style={{ padding: "4px 12px", fontSize: 9, fontFamily: sans, letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: `1px solid ${chartSlide === i ? "#1a1714" : c.line}`, background: chartSlide === i ? "#1a1714" : "transparent", color: chartSlide === i ? "#f7f4ef" : c.sub }}>{l}</button>
          ))}
          <button onClick={() => setChartSlide(1)} disabled={chartSlide === 1} style={{ background: "transparent", border: "none", color: chartSlide === 1 ? c.line : c.ink, fontSize: 18, cursor: chartSlide === 1 ? "default" : "pointer", padding: "0 4px" }}>›</button>
        </div>
        <div style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", width: "200%", transform: chartSlide === 1 ? "translateX(-50%)" : "translateX(0)", transition: "transform 0.35s ease" }}>
            <div style={{ width: "50%", boxSizing: "border-box", paddingRight: 4 }}>
      {(() => {
        // ── PERIOD EXPLORER ──
        const pvbd = pOrd.vineByDate || {};
        const pDays = (pDaily.days || []).map(d => ({ ...d, real: Math.max(0, d.sales - (pvbd[d.date] || 0)) }));
        const totAmz = pDays.reduce((s, d) => s + d.sales, 0);
        const totReal = pDays.reduce((s, d) => s + d.real, 0);
        const totUnits = pDays.reduce((s, d) => s + d.units, 0);
        const totOrders = pDays.reduce((s, d) => s + d.orders, 0);
        const pReal = pOrd.orders.filter(o => o.kind === "real");
        const pVine = pOrd.orders.filter(o => o.kind === "vine");
        const pVineUnits = pVine.reduce((s, o) => s + (o.units || 0), 0);

        // Smooth area curve (Catmull-Rom → bezier)
        const W = 640, H = 170, PAD = 8;
        const maxV = Math.max(1, ...pDays.map(d => d.real));
        const pts = pDays.map((d, i) => [
          PAD + (pDays.length === 1 ? (W - 2 * PAD) / 2 : (i / (pDays.length - 1)) * (W - 2 * PAD)),
          H - PAD - (d.real / maxV) * (H - 2 * PAD - 14),
        ]);
        let path = "";
        if (pts.length === 1) path = `M ${pts[0][0]} ${pts[0][1]} L ${pts[0][0] + 1} ${pts[0][1]}`;
        else if (pts.length > 1) {
          path = `M ${pts[0][0]} ${pts[0][1]}`;
          for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
            const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
            const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
            path += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
          }
        }
        const area = pts.length > 1 ? `${path} L ${pts[pts.length - 1][0]} ${H - PAD} L ${pts[0][0]} ${H - PAD} Z` : "";
        const peak = pDays.reduce((best, d) => (d.real > (best ? best.real : -1) ? d : best), null);
        const tickEvery = Math.max(1, Math.ceil(pDays.length / 6));
        const KIND_STYLE = { real: { color: c.green, label: "SALE" }, vine: { color: c.clay, label: "VINE / $0" }, pending: { color: c.sub, label: "PENDING" }, canceled: { color: c.red, label: "CANCELED" } };

        return (
          <div style={{ ...card, marginTop: 12 }}>
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans }}>Period explorer · growth curve</div>
            <div style={{ fontSize: 10, fontStyle: "italic", color: "rgba(111,102,87,0.55)", fontFamily: serif, marginBottom: 8 }}>Explora cualquier día, mes, año o periodo — curva de crecimiento con ingreso real (sin Vine)</div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {["7D", "30D", "90D", "THIS MONTH", "LAST MONTH", "YTD", "DAY", "CUSTOM"].map(m => (
                <button key={m} onClick={() => pickPeriod(m)} style={{ padding: "4px 12px", fontSize: 9, fontFamily: sans, letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: `1px solid ${periodMode === m ? "#1a1714" : c.line}`, background: periodMode === m ? "#1a1714" : "transparent", color: periodMode === m ? "#f7f4ef" : c.sub }}>{m}</button>
              ))}
            </div>
            {(periodMode === "CUSTOM" || periodMode === "DAY") && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                <input type="date" value={pStart} onChange={e => { setPStart(e.target.value); if (periodMode === "DAY") setPEnd(e.target.value); }}
                  style={{ background: "#e5e1da", border: `1px solid ${c.line}`, color: c.ink, fontSize: 11, padding: "4px 6px", borderRadius: 1 }} />
                {periodMode === "CUSTOM" && <span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>to</span>}
                {periodMode === "CUSTOM" && <input type="date" value={pEnd} onChange={e => setPEnd(e.target.value)}
                  style={{ background: "#e5e1da", border: `1px solid ${c.line}`, color: c.ink, fontSize: 11, padding: "4px 6px", borderRadius: 1 }} />}
                <button onClick={() => loadPeriod(pStart, periodMode === "DAY" ? pStart : pEnd)} style={{ padding: "4px 14px", fontSize: 9, fontFamily: sans, letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: "1px solid #1a1714", background: "#1a1714", color: "#f7f4ef" }}>APPLY</button>
              </div>
            )}

            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 8 }}>
              <div><span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>REVENUE </span><span style={{ fontFamily: serif, fontSize: 22, color: c.ink }}>{money(totReal)}</span>{totAmz - totReal > 0.005 && <span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}> (Amazon: {money(totAmz)})</span>}</div>
              <div><span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>UNITS </span><span style={{ fontFamily: serif, fontSize: 22, color: c.ink }}>{totUnits}</span></div>
              <div><span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>ORDERS </span><span style={{ fontFamily: serif, fontSize: 22, color: c.ink }}>{totOrders}</span></div>
              {pVine.length > 0 && <div><span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>VINE </span><span style={{ fontFamily: serif, fontSize: 22, color: c.clay }}>{pVineUnits}u</span></div>}
            </div>

            {pDaily.loading && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>Drawing the curve…</div>}
            {pDaily.error && <div style={{ fontFamily: sans, fontSize: 11, color: c.red }}>{String(pDaily.error)}</div>}
            {!pDaily.loading && pDays.length > 0 && (
              <div>
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = ((e.clientX - rect.left) / rect.width) * W;
                    if (pDays.length < 1) return;
                    const idx = pDays.length === 1 ? 0 : Math.round(((x - PAD) / (W - 2 * PAD)) * (pDays.length - 1));
                    setHoverIdx(Math.max(0, Math.min(pDays.length - 1, idx)));
                  }}
                  onMouseLeave={() => setHoverIdx(null)}>
                  {area && <path d={area} fill="#5a7a5a1f" />}
                  <path d={path} fill="none" stroke={c.green} strokeWidth="2" />
                  {hoverIdx !== null && pts[hoverIdx] && (
                    <g>
                      <line x1={pts[hoverIdx][0]} y1={PAD} x2={pts[hoverIdx][0]} y2={H - PAD} stroke={c.clay} strokeWidth="1" strokeDasharray="3,3" />
                      <circle cx={pts[hoverIdx][0]} cy={pts[hoverIdx][1]} r="4" fill={c.clay} />
                      <text x={Math.min(W - 90, Math.max(90, pts[hoverIdx][0]))} y={14} textAnchor="middle" fontSize="11" fontFamily="monospace" fill={c.ink}>
                        {pDays[hoverIdx].date.slice(5)} · {money(pDays[hoverIdx].real)}{pDays[hoverIdx].sales - pDays[hoverIdx].real > 0.005 ? ` (Amazon: ${money(pDays[hoverIdx].sales)})` : ""}
                      </text>
                    </g>
                  )}
                  {hoverIdx === null && peak && pts.length > 1 && (() => {
                    const pi = pDays.indexOf(peak);
                    return <g>
                      <circle cx={pts[pi][0]} cy={pts[pi][1]} r="3" fill={c.green} />
                      <text x={Math.min(W - 70, Math.max(40, pts[pi][0]))} y={Math.max(12, pts[pi][1] - 8)} textAnchor="middle" fontSize="10" fontFamily="monospace" fill={c.sub}>{money(peak.real)}</text>
                    </g>;
                  })()}
                  <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={c.line} strokeWidth="1" />
                </svg>
                <div style={{ minHeight: 18, fontFamily: sans, fontSize: 11, color: hoverIdx !== null ? c.ink : c.sub, marginTop: 4 }}>
                  {hoverIdx !== null && pDays[hoverIdx] ? (
                    <span>
                      <span style={{ color: c.clay }}>▸ {pDays[hoverIdx].date}</span>
                      {" · "}{money(pDays[hoverIdx].real)} real revenue
                      {pDays[hoverIdx].sales - pDays[hoverIdx].real > 0.005 ? ` (Amazon: ${money(pDays[hoverIdx].sales)})` : ""}
                      {" · "}{pDays[hoverIdx].units} units · {pDays[hoverIdx].orders} orders
                    </span>
                  ) : (
                    <span style={{ fontStyle: "italic", fontFamily: serif, color: "rgba(111,102,87,0.55)" }}>Hover the curve for any point's date and revenue — pasa el mouse sobre la curva para ver fecha e ingreso de cada punto</span>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: sans, fontSize: 9, color: c.sub }}>
                  {pDays.filter((_, i) => i % tickEvery === 0 || i === pDays.length - 1).map((d, i) => <span key={i}>{d.date.slice(5)}</span>)}
                </div>
              </div>
            )}

            <div onClick={() => setShowPLog(!showPLog)} style={{ cursor: "pointer", fontSize: 10, fontFamily: sans, letterSpacing: 1, color: c.green, marginTop: 10 }}>
              {showPLog ? "▾" : "▸"} ORDERS IN THIS PERIOD · {pOrd.orders.length}
            </div>
            {showPLog && (
              <div style={{ marginTop: 6, borderLeft: `2px solid ${c.line}`, paddingLeft: 10, maxHeight: 360, overflowY: "auto" }}>
                {pOrd.orders.map((o, i) => {
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
                {pOrd.orders.length === 0 && !pOrd.loading && <div style={{ fontSize: 11, fontStyle: "italic", color: c.sub }}>No orders in this period.</div>}
              </div>
            )}
          </div>
        );
      })()}

            </div>
            <div style={{ width: "50%", boxSizing: "border-box", paddingLeft: 4 }}>
      {(() => {
        // ── NET PROFIT CURVE · SETTLED ──
        const ms = netSeries.months || [];
        const qKey = (m) => `${m.slice(0, 4)}-Q${Math.ceil(Number(m.slice(5, 7)) / 3)}`;
        const agg = {};
        for (const row of ms) {
          const k = netGran === "MONTH" ? row.month : netGran === "QUARTER" ? qKey(row.month) : row.month.slice(0, 4);
          if (!agg[k]) agg[k] = { label: k, gross: 0, fees: 0, refunds: 0, net: 0 };
          agg[k].gross += row.gross; agg[k].fees += row.fees; agg[k].refunds += row.refunds; agg[k].net += row.net;
        }
        const buckets = Object.values(agg).sort((a, b) => (a.label < b.label ? -1 : 1));
        const W = 640, H = 170, PAD = 8;
        const vals = buckets.map(bk => bk.net);
        const maxV = Math.max(1, ...vals);
        const minV = Math.min(0, ...vals);
        const span = Math.max(1, maxV - minV);
        const yOf = (v) => H - PAD - ((v - minV) / span) * (H - 2 * PAD - 14);
        const pts = buckets.map((bk, i) => [
          PAD + (buckets.length === 1 ? (W - 2 * PAD) / 2 : (i / (buckets.length - 1)) * (W - 2 * PAD)),
          yOf(bk.net),
        ]);
        let npath = "";
        if (pts.length === 1) npath = `M ${pts[0][0]} ${pts[0][1]} L ${pts[0][0] + 1} ${pts[0][1]}`;
        else if (pts.length > 1) {
          npath = `M ${pts[0][0]} ${pts[0][1]}`;
          for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
            const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
            const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
            npath += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
          }
        }
        const zeroY = yOf(0);
        const curKey = netGran === "MONTH" ? new Date().toISOString().slice(0, 7) : netGran === "QUARTER" ? qKey(new Date().toISOString().slice(0, 7)) : new Date().toISOString().slice(0, 4);
        return (
          <div style={{ ...card, marginTop: 12, borderLeft: `3px solid ${c.green}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans }}>Net profit curve · settled money</div>
                <div style={{ fontSize: 10, fontStyle: "italic", color: "rgba(111,102,87,0.55)", fontFamily: serif }}>Curva de utilidad neta — dinero liquidado por fecha de registro</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {["MONTH", "QUARTER", "YEAR"].map(g => (
                  <button key={g} onClick={() => { setNetGran(g); setHoverNet(null); }} style={{ padding: "4px 12px", fontSize: 9, fontFamily: sans, letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: `1px solid ${netGran === g ? "#1a1714" : c.line}`, background: netGran === g ? "#1a1714" : "transparent", color: netGran === g ? "#f7f4ef" : c.sub }}>{g}</button>
                ))}
              </div>
            </div>
            {netSeries.loading && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub, marginTop: 8 }}>Loading settlement history…</div>}
            {netSeries.error && <div style={{ fontFamily: sans, fontSize: 11, color: c.red, marginTop: 8 }}>{String(netSeries.error)}</div>}
            {!netSeries.loading && buckets.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = ((e.clientX - rect.left) / rect.width) * W;
                    const idx = buckets.length === 1 ? 0 : Math.round(((x - PAD) / (W - 2 * PAD)) * (buckets.length - 1));
                    setHoverNet(Math.max(0, Math.min(buckets.length - 1, idx)));
                  }}
                  onMouseLeave={() => setHoverNet(null)}>
                  <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke={c.line} strokeWidth="1" strokeDasharray="2,3" />
                  <path d={npath} fill="none" stroke={c.green} strokeWidth="2" />
                  {pts.map((p, i) => (
                    <circle key={i} cx={p[0]} cy={p[1]} r={hoverNet === i ? 4.5 : 3} fill={buckets[i].net >= 0 ? c.green : c.red} />
                  ))}
                  {hoverNet !== null && pts[hoverNet] && (
                    <g>
                      <line x1={pts[hoverNet][0]} y1={PAD} x2={pts[hoverNet][0]} y2={H - PAD} stroke={c.clay} strokeWidth="1" strokeDasharray="3,3" />
                      <text x={Math.min(W - 110, Math.max(110, pts[hoverNet][0]))} y={14} textAnchor="middle" fontSize="11" fontFamily="monospace" fill={c.ink}>
                        {buckets[hoverNet].label} · net {money(buckets[hoverNet].net)}
                      </text>
                    </g>
                  )}
                </svg>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: sans, fontSize: 9, color: c.sub }}>
                  {buckets.map((bk, i) => <span key={i} style={{ color: bk.label === curKey ? c.clay : c.sub }}>{bk.label.slice(2)}</span>)}
                </div>
                <div style={{ minHeight: 18, fontFamily: sans, fontSize: 11, color: hoverNet !== null ? c.ink : c.sub, marginTop: 4 }}>
                  {hoverNet !== null && buckets[hoverNet] ? (
                    <span>
                      <span style={{ color: c.clay }}>▸ {buckets[hoverNet].label}</span>
                      {" · net "}<span style={{ color: buckets[hoverNet].net >= 0 ? c.green : c.red }}>{money(buckets[hoverNet].net)}</span>
                      {" — "}{money(buckets[hoverNet].gross)} gross · ({money(buckets[hoverNet].fees)}) fees · ({money(buckets[hoverNet].refunds)}) refunds
                      {buckets[hoverNet].label === curKey ? " · current period, still settling" : ""}
                    </span>
                  ) : (
                    <span style={{ fontStyle: "italic", fontFamily: serif, color: "rgba(111,102,87,0.55)" }}>Hover for any period's net, gross, fees, and refunds — pasa el mouse para el neto, bruto, comisiones y reembolsos de cada periodo</span>
                  )}
                </div>
                <div style={{ fontSize: 10, fontStyle: "italic", color: "rgba(111,102,87,0.55)", fontFamily: serif, marginTop: 4 }}>
                  Settled by Amazon posting date over the trailing 12 months. The current {netGran.toLowerCase()} (amber) is incomplete until Amazon finishes posting its fees.{netSeries.truncated ? " History was truncated at Amazon's page limit — older months may be partial." : ""}
                </div>
              </div>
            )}
          </div>
        );
      })()}

            </div>
          </div>
        </div>
      </div>

      {(() => {
        // ── SUBSCRIBE & SAVE · ACTIVE SUBSCRIPTIONS ──
        const hSku = sns.headers.find(h => h.toLowerCase() === "sku") || sns.headers.find(h => h.toLowerCase().includes("sku"));
        const hState = sns.headers.find(h => h.toLowerCase().includes("state"));
        const numericCols = sns.headers.filter(h => {
          const lk = h.toLowerCase();
          return (lk.includes("unit") || lk.includes("scheduled") || lk.includes("subscription") || lk.includes("week")) && sns.rows.some(r => r[h] !== "" && !isNaN(Number(r[h])));
        });
        const bySku = {};
        for (const r of sns.rows) {
          const sku = hSku ? r[hSku] : "?";
          if (!sku) continue;
          if (!bySku[sku]) bySku[sku] = { sku, state: hState ? r[hState] : "", total: 0, rows: 0 };
          bySku[sku].rows += 1;
          for (const col of numericCols) {
            const v = Number(r[col]);
            if (!isNaN(v)) bySku[sku].total += v;
          }
        }
        const skuRows = Object.values(bySku).sort((a, b) => b.total - a.total);
        const nameFor = (sku) => {
          const p = products.find(pp => (pp.sku || "").trim().toLowerCase() === (sku || "").trim().toLowerCase());
          return p ? p.name : null;
        };
        return (
          <div style={{ ...card, marginTop: 12, borderLeft: `3px solid ${c.clay}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans }}>Subscribe & Save · active subscriptions</div>
                <div style={{ fontSize: 10, fontStyle: "italic", color: "rgba(111,102,87,0.55)", fontFamily: serif }}>Suscripciones activas por producto — unidades programadas en las próximas semanas, del reporte S&S de Amazon</div>
              </div>
              <button onClick={loadSns} disabled={sns.phase === "creating" || sns.phase === "polling" || sns.phase === "downloading"}
                style={{ background: "transparent", border: `1px solid ${c.clay}`, color: c.clay, borderRadius: 1, padding: "5px 14px", cursor: "pointer", fontSize: 10, fontFamily: sans, letterSpacing: 1 }}>
                {sns.phase === "idle" || sns.phase === "error" || sns.phase === "ready" ? "LOAD SUBSCRIPTIONS" : sns.phase === "creating" ? "REQUESTING…" : sns.phase === "polling" ? "AMAZON IS GENERATING…" : "DOWNLOADING…"}
              </button>
            </div>
            {sns.phase === "idle" && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub, marginTop: 8 }}>Amazon generates this report on request — it usually takes 15–60 seconds.</div>}
            {sns.phase === "polling" && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub, marginTop: 8 }}>Waiting on Amazon — this page will update itself…</div>}
            {sns.phase === "error" && <div style={{ fontFamily: sans, fontSize: 11, color: c.red, marginTop: 8 }}>{sns.error}</div>}
            {sns.phase === "ready" && skuRows.length === 0 && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub, marginTop: 8 }}>No active Subscribe & Save offers found in the report.</div>}
            {sns.phase === "ready" && skuRows.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {skuRows.map((s, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: "1px solid #00000008", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontFamily: serif, fontSize: 14, color: c.ink }}>{nameFor(s.sku) || s.sku}</span>
                      {nameFor(s.sku) && <span style={{ fontFamily: sans, fontSize: 9, color: c.sub, marginLeft: 8 }}>{s.sku}</span>}
                    </div>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      {s.state && <span style={{ fontSize: 9, letterSpacing: 1, fontFamily: sans, color: s.state.toUpperCase().includes("ACTIVE") ? c.green : c.sub, border: `1px solid ${c.line}`, borderRadius: 1, padding: "1px 6px" }}>{s.state.toUpperCase()}</span>}
                      <span style={{ fontFamily: sans, fontSize: 11, color: c.ink }}>{s.total} units scheduled</span>
                    </div>
                  </div>
                ))}
                <div onClick={() => setShowSnsRaw(!showSnsRaw)} style={{ cursor: "pointer", fontSize: 10, fontFamily: sans, letterSpacing: 1, color: c.clay, marginTop: 8 }}>
                  {showSnsRaw ? "▾" : "▸"} RAW REPORT · {sns.rows.length} rows
                </div>
                {showSnsRaw && (
                  <div style={{ overflowX: "auto", marginTop: 6 }}>
                    <table style={{ borderCollapse: "collapse", fontFamily: sans, fontSize: 10, color: c.sub }}>
                      <thead><tr>{sns.headers.map((h, i) => <th key={i} style={{ textAlign: "left", padding: "3px 10px 3px 0", borderBottom: `1px solid ${c.line}`, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
                      <tbody>{sns.rows.slice(0, 60).map((r, i) => (
                        <tr key={i}>{sns.headers.map((h, j) => <td key={j} style={{ padding: "2px 10px 2px 0", whiteSpace: "nowrap", borderBottom: "1px solid #00000008" }}>{r[h]}</td>)}</tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

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
