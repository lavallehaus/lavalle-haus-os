import { useState, useMemo, useEffect } from "react";

// LAVALLE HAUS OS — Margins (CM1 / CM2 per SKU). Sales sub-tab.
// CM1 = price − true COGS.   CM2 = CM1 − (referral % + returns % + FBA fee + ad/unit).
// Everything auto-sources, with manual override on every field:
//   • COGS   ← COGS Builder breakdown (falls back to Profit Matrix landed cost)
//   • FBA fee ← Profit Matrix (fbaFee + storage)
//   • Ad/unit ← real campaign spend once each campaign is mapped to a SKU
//               (a SKU is auto-suggested from the campaign name; editable)
// Undo/Redo on every edit.

const c = {
  bg: "#f7f4ef", ink: "#1a1714", sub: "#8c7d6b", line: "#c8c2b8",
  green: "#5a7a5a", clay: "#a07848", red: "#9b5e5e", card: "#efece5",
};
const serif = "'IM Fell English', Georgia, serif";
const sans = "monospace";
const card = { background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: 14, marginBottom: 12 };
const btnGhost = { padding: "5px 12px", fontSize: 10, fontFamily: sans, letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: `1px solid ${c.line}`, background: "transparent", color: c.sub, textTransform: "uppercase" };
const cellInput = { background: "#e5e1da", border: `1px solid ${c.line}`, color: c.ink, fontSize: 12, padding: "4px 6px", borderRadius: 1, boxSizing: "border-box", width: 64, fontFamily: sans, textAlign: "right" };
const selStyle = { background: "#e5e1da", border: `1px solid ${c.line}`, color: c.ink, fontSize: 11, padding: "4px 6px", borderRadius: 1, fontFamily: sans };

const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const money = (v) => (v == null ? "—" : `$${Number(v).toFixed(2)}`);
const pct = (v) => (v == null ? "—" : `${Number(v).toFixed(0)}%`);

function cogsPerUnit(p, laborRate) {
  const y = Math.max(num(p.batchYield), 1);
  const per = (cost, basis) => (basis === "unit" ? cost : cost / y);
  const sumMat = (rows) => (rows || []).reduce((s, l) => s + per(num(l.qty) * num(l.unitCost), l.basis), 0);
  const sumLab = (rows) => (rows || []).reduce((s, l) => s + per(num(l.hours) * num(laborRate), l.basis), 0);
  return sumMat(p.materials) + sumMat(p.packaging) + sumMat(p.shipping) + sumLab(p.labor);
}
const marginColor = (p) => (p == null ? c.sub : p < 0 ? c.red : p < 20 ? c.clay : c.green);
const SPEND_30 = 30 / 7;

// Auto-suggest which SKU a campaign promotes, from its name.
const STOP = new Set(["match", "broad", "exact", "phrase", "discovery", "expansion", "high", "intent", "search", "volume", "targeting", "product", "h10", "campaign", "sponsored", "auto", "manual", "keyword", "keywords", "ads", "amazon", "the", "and", "for", "launch", "new", "test", "low", "brand", "defense", "competitor", "set", "vessel", "candle"]);
const toks = (str) => (str || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
function suggestProductId(campName, prods) {
  const ct = toks(campName);
  if (!ct.length) return "";
  let best = "", bestScore = 0;
  prods.forEach((p) => {
    const pt = toks(p.name);
    const lname = (p.name || "").toLowerCase();
    let score = 0;
    ct.forEach((w) => { if (pt.includes(w)) score += 1; else if (lname.includes(w)) score += 0.5; });
    if (score > bestScore) { bestScore = score; best = p.id; }
  });
  return bestScore > 0 ? best : "";
}

export default function Margins({ cogs = {}, products = [], campaigns = [], profitMatrix = {}, data = {}, onSave }) {
  const laborRate = num(cogs.laborRate);
  const cogsProducts = cogs.products || [];
  const pmById = useMemo(() => {
    const m = {};
    (profitMatrix.products || []).forEach((p) => {
      m[p.id] = { fba: num(p.fbaFee) + num(p.storage), landed: num(p.cogs) + num(p.packaging) + num(p.freight), retail: num(p.retail) };
    });
    return m;
  }, [profitMatrix]);

  const [state, setState] = useState(() => ({
    referralPct: data.referralPct != null ? data.referralPct : 15,
    returnsPct: data.returnsPct != null ? data.returnsPct : 2,
    bySku: data.bySku || {},
    adMap: data.adMap || {},
    amazonFba: data.amazonFba || {},
    fbaUpdatedAt: data.fbaUpdatedAt || null,
  }));
  const [feeFetch, setFeeFetch] = useState({ loading: false, error: null });
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  function commit(next) { setPast((p) => [...p.slice(-49), state]); setFuture([]); setState(next); }
  function undo() { if (!past.length) return; const prev = past[past.length - 1]; setPast((p) => p.slice(0, -1)); setFuture((f) => [state, ...f]); setState(prev); }
  function redo() { if (!future.length) return; const nx = future[0]; setFuture((f) => f.slice(1)); setPast((p) => [...p, state]); setState(nx); }
  const setGlobal = (field, val) => commit({ ...state, [field]: val });
  const setSku = (id, field, val) => commit({ ...state, bySku: { ...state.bySku, [id]: { ...(state.bySku[id] || {}), [field]: val } } });
  const setAdMap = (campId, productId) => commit({ ...state, adMap: { ...state.adMap, [campId]: productId } });

  async function fetchFbaFees() {
    const items = (products || [])
      .filter((p) => (p.sku || p.asin) && !p.isSample)
      .map((p) => { const r = (rows || []).find((x) => x.id === p.id); return { id: p.id, asin: p.asin, sku: p.sku, price: r ? r.price : num(p.price) }; });
    if (!items.length) { setFeeFetch({ loading: false, error: "No SKUs/ASINs to look up." }); return; }
    setFeeFetch({ loading: true, error: null });
    try {
      const d = await fetch("/api/amazon-sync?op=fees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) }).then((r) => r.json());
      if (d.error) { setFeeFetch({ loading: false, error: d.error }); return; }
      const map = { ...state.amazonFba };
      const filled = [], failed = [];
      (d.items || []).forEach((it) => { if (it.fbaFee != null) { map[it.id] = it.fbaFee; filled.push(it); } else { failed.push(it); } });
      setState((prev) => ({ ...prev, amazonFba: map, fbaUpdatedAt: d.updatedAt }));
      const nameOf = (id) => { const r = (rows || []).find((x) => x.id === id); return r ? r.name : ("#" + id); };
      if (filled.length && !failed.length) { setFeeFetch({ loading: false, error: null }); }
      else if (!filled.length && !failed.length) { setFeeFetch({ loading: false, error: "No SKUs returned." }); }
      else {
        const why = (it) => it.error ? it.error : (it.status && it.status !== "Success" ? it.status : (it.feeTypes && it.feeTypes.length ? ("only " + it.feeTypes.join("/")) : (it.debug ? ("raw: " + it.debug) : "no fee")));
        const list = failed.map((it) => nameOf(it.id) + " — " + why(it)).join(" · ");
        setFeeFetch({ loading: false, error: (filled.length ? ("Filled " + filled.length + ". ") : "") + "Couldn't price: " + list });
      }
    } catch (e) {
      setFeeFetch({ loading: false, error: String(e) });
    }
  }

  const amazonTargets = useMemo(() => products.filter((p) => (p.channels || []).includes("Amazon") || p.asin), [products]);

  // effective campaign→SKU: explicit choice wins, else name-based suggestion
  const effMap = useMemo(() => {
    const out = {};
    (campaigns || []).forEach((cm) => {
      const explicit = state.adMap[cm.id];
      out[cm.id] = (explicit !== undefined && explicit !== "") ? explicit : suggestProductId(cm.name, amazonTargets);
    });
    return out;
  }, [campaigns, state.adMap, amazonTargets]);

  const adByProduct = useMemo(() => {
    const out = {};
    (campaigns || []).forEach((cm) => {
      const pid = effMap[cm.id];
      if (pid == null || pid === "") return;
      out[pid] = (out[pid] || 0) + num(cm.spend7d) * SPEND_30;
    });
    return out;
  }, [campaigns, effMap]);

  const cogsById = useMemo(() => { const m = {}; cogsProducts.forEach((p) => { m[p.id] = p; }); return m; }, [cogsProducts]);
  const rows = useMemo(() => {
    // Spine = the live product list (always present); enrich with cost data.
    const spine = (products || []).filter((p) => !p.isSample && (num(p.price) > 0 || cogsById[p.id] || pmById[p.id] || p.asin));
    return spine.map((prod) => {
      const p = cogsById[prod.id] || {};
      const pm = pmById[prod.id] || {};
      const price = num(p.retail) > 0 ? num(p.retail) : (num(prod.price) > 0 ? num(prod.price) : num(pm.retail));
      const builderCogs = cogsById[prod.id] ? cogsPerUnit(p, laborRate) : 0;
      const cogsU = builderCogs > 0 ? builderCogs : (pm.landed || 0);
      const cogsSrc = builderCogs > 0 ? "builder" : (pm.landed > 0 ? "matrix" : null);
      const cm1 = price - cogsU;
      const cm1pct = price > 0 ? (cm1 / price) * 100 : null;
      const sk = state.bySku[prod.id] || {};
      const referral = price * (num(state.referralPct) / 100);
      const returns = price * (num(state.returnsPct) / 100);
      const overrideFba = sk.fbaFee !== undefined && sk.fbaFee !== "";
      const amzFba = state.amazonFba[prod.id];
      const amzSet = amzFba != null && amzFba !== "";
      const autoFba = amzSet ? num(amzFba) : (pm.fba != null ? pm.fba : null);
      const fbaAutoSrc = amzSet ? "amazon" : (pm.fba != null && pm.fba > 0 ? "matrix" : null);
      const fbaFee = overrideFba ? num(sk.fbaFee) : (autoFba != null && autoFba > 0 ? autoFba : null);
      const fbaIsAuto = !overrideFba && autoFba != null && autoFba > 0;
      const units = num(prod.unitsSold30);
      const mappedSpend = adByProduct[prod.id] || 0;
      const computedAd = units > 0 ? mappedSpend / units : null;
      const overrideAd = sk.adPerUnit !== undefined && sk.adPerUnit !== "";
      const ad = overrideAd ? num(sk.adPerUnit) : (computedAd != null ? computedAd : 0);
      const adIsAuto = !overrideAd && computedAd != null && mappedSpend > 0;
      const fbaSet = fbaFee != null;
      const cm2 = fbaSet ? cm1 - referral - returns - fbaFee - ad : null;
      const cm2pct = cm2 != null && price > 0 ? (cm2 / price) * 100 : null;
      return { id: prod.id, name: prod.name, price, cogsU, cogsSrc, cm1, cm1pct, referral, returns, fbaFee, autoFba, fbaIsAuto, fbaAutoSrc, ad, adIsAuto, computedAd, mappedSpend, cm2, cm2pct, units, hasCogs: cogsU > 0 };
    }).sort((a, b) => {
      const am = a.cm2pct != null ? a.cm2pct : (a.cm1pct != null ? a.cm1pct : 999);
      const bm = b.cm2pct != null ? b.cm2pct : (b.cm1pct != null ? b.cm1pct : 999);
      return am - bm;
    });
  }, [cogsById, laborRate, state, products, adByProduct, pmById]);

  const summary = useMemo(() => {
    let wRev = 0, wCm1 = 0, wCm2 = 0, cm2KnownRev = 0;
    const totUnits = rows.reduce((s, r) => s + r.units, 0);
    rows.forEach((r) => {
      const w = totUnits > 0 ? r.units : 1;
      wRev += r.price * w; wCm1 += r.cm1 * w;
      if (r.cm2 != null) { wCm2 += r.cm2 * w; cm2KnownRev += r.price * w; }
    });
    return { cm1Pct: wRev > 0 ? (wCm1 / wRev) * 100 : null, cm2Pct: cm2KnownRev > 0 ? (wCm2 / cm2KnownRev) * 100 : null };
  }, [rows]);

  const persistKey = JSON.stringify({ s: state, sum: summary });
  useEffect(() => { if (onSave) onSave({ referralPct: state.referralPct, returnsPct: state.returnsPct, bySku: state.bySku, adMap: state.adMap, amazonFba: state.amazonFba, fbaUpdatedAt: state.fbaUpdatedAt, summary }); /* eslint-disable-next-line */ }, [persistKey]);

  const losers = rows.filter((r) => r.cm2 != null && r.cm2 < 0);
  const thin = rows.filter((r) => r.cm2 != null && r.cm2 >= 0 && r.cm2pct < 15);
  const missingCogs = rows.filter((r) => !r.hasCogs);
  const missingFba = rows.filter((r) => r.fbaFee == null);
  const adNoSales = rows.filter((r) => r.units === 0 && r.mappedSpend > 0);
  const totalCampaignSpend30 = (campaigns || []).reduce((s, cm) => s + num(cm.spend7d) * SPEND_30, 0);
  const unmappedSpend30 = (campaigns || []).reduce((s, cm) => s + (effMap[cm.id] ? 0 : num(cm.spend7d) * SPEND_30), 0);

  const th = { fontFamily: sans, fontSize: 8.5, letterSpacing: 1, textTransform: "uppercase", color: c.sub, padding: "6px 8px", textAlign: "right", borderBottom: `1px solid ${c.line}`, whiteSpace: "nowrap" };
  const td = { fontFamily: sans, fontSize: 12, color: c.ink, padding: "7px 8px", textAlign: "right", borderBottom: "1px solid #00000008", whiteSpace: "nowrap" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <div>
          <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 400, color: c.ink, margin: 0 }}>Margins · CM1 / CM2</h1>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: "rgba(111,102,87,0.6)" }}>COGS, comisiones FBA y anuncios se jalan automáticamente — ajusta cualquier celda si hace falta.</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={undo} disabled={!past.length} style={{ ...btnGhost, opacity: past.length ? 1 : 0.4 }}>↶ Undo</button>
          <button onClick={redo} disabled={!future.length} style={{ ...btnGhost, opacity: future.length ? 1 : 0.4 }}>Redo ↷</button>
        </div>
      </div>

      <div style={{ ...card, display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans }}>Amazon assumptions</span>
        <label style={{ fontFamily: sans, fontSize: 11, color: c.ink }}>Referral %
          <input style={{ ...cellInput, width: 52, marginLeft: 6 }} value={state.referralPct} onChange={(e) => setGlobal("referralPct", e.target.value.replace(/[^0-9.]/g, ""))} /></label>
        <label style={{ fontFamily: sans, fontSize: 11, color: c.ink }}>Returns %
          <input style={{ ...cellInput, width: 52, marginLeft: 6 }} value={state.returnsPct} onChange={(e) => setGlobal("returnsPct", e.target.value.replace(/[^0-9.]/g, ""))} /></label>
        <button onClick={fetchFbaFees} disabled={feeFetch.loading} style={{ ...btnGhost, color: c.ink, borderColor: c.clay, opacity: feeFetch.loading ? 0.5 : 1 }}>{feeFetch.loading ? "Asking Amazon…" : "↻ Pull FBA fees from Amazon"}</button>
        {state.fbaUpdatedAt && !feeFetch.loading && <span style={{ fontFamily: sans, fontSize: 9, color: c.green, letterSpacing: 1 }}>● updated {new Date(state.fbaUpdatedAt).toLocaleTimeString()}</span>}
        {feeFetch.error && <span style={{ fontFamily: sans, fontSize: 10, color: c.red }}>{feeFetch.error}</span>}
        <span style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: "rgba(111,102,87,0.55)" }}>FBA fee: live from Amazon by ASIN (falls back to Profit Matrix) · ad/unit from mapped campaigns</span>
      </div>

      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 820 }}>
          <thead><tr>
            <th style={{ ...th, textAlign: "left" }}>Product</th>
            <th style={th}>Price</th><th style={th}>COGS</th>
            <th style={th}>CM1 $</th><th style={th}>CM1 %</th>
            <th style={th}>FBA fee</th><th style={th}>Ad/unit</th>
            <th style={th}>CM2 $</th><th style={th}>CM2 %</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, textAlign: "left" }}>
                  <span style={{ fontFamily: serif, fontSize: 14 }}>{r.name}</span>
                  {!r.hasCogs && <span style={{ color: c.clay, fontSize: 9, marginLeft: 6 }}>add COGS</span>}
                  {r.cogsSrc === "matrix" && <span style={{ color: c.sub, fontSize: 8, marginLeft: 6 }}>(matrix)</span>}
                </td>
                <td style={td}>{money(r.price)}</td>
                <td style={{ ...td, color: c.sub }}>{r.hasCogs ? money(r.cogsU) : "—"}</td>
                <td style={{ ...td, color: marginColor(r.cm1pct) }}>{money(r.cm1)}</td>
                <td style={{ ...td, color: marginColor(r.cm1pct), fontWeight: "bold" }}>{pct(r.cm1pct)}</td>
                <td style={td}>
                  <input style={cellInput} value={(state.bySku[r.id] || {}).fbaFee ?? ""} placeholder={r.autoFba != null && r.autoFba > 0 ? r.autoFba.toFixed(2) : "—"} onChange={(e) => setSku(r.id, "fbaFee", e.target.value.replace(/[^0-9.]/g, ""))} />
                  {r.fbaIsAuto && <div style={{ fontSize: 8, color: c.green, fontFamily: sans }}>auto ${r.autoFba.toFixed(2)} · {r.fbaAutoSrc === "amazon" ? "Amazon" : "matrix"}</div>}
                </td>
                <td style={td}>
                  <input style={cellInput} value={(state.bySku[r.id] || {}).adPerUnit ?? ""} placeholder={r.computedAd != null ? r.computedAd.toFixed(2) : (r.mappedSpend > 0 ? "0 units" : "0")} onChange={(e) => setSku(r.id, "adPerUnit", e.target.value.replace(/[^0-9.]/g, ""))} />
                  {r.adIsAuto && <div style={{ fontSize: 8, color: c.green, fontFamily: sans }}>auto ${r.computedAd.toFixed(2)}</div>}
                </td>
                <td style={{ ...td, color: marginColor(r.cm2pct) }}>{money(r.cm2)}</td>
                <td style={{ ...td, color: marginColor(r.cm2pct), fontWeight: "bold" }}>{pct(r.cm2pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={card}>
        <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans, marginBottom: 4 }}>Ad allocation · auto-suggested from campaign name</div>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: "rgba(111,102,87,0.55)", marginBottom: 8 }}>
          Each campaign is matched to a likely SKU by name — confirm or change it. Its spend (7-day → 30-day basis) divides across that SKU's units sold for a real ad/unit.
        </div>
        {(campaigns || []).map((cm) => {
          const explicit = state.adMap[cm.id] !== undefined && state.adMap[cm.id] !== "";
          const isSuggested = !explicit && effMap[cm.id];
          return (
            <div key={cm.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: "1px solid #00000008", flexWrap: "wrap" }}>
              <span style={{ fontFamily: serif, fontSize: 13, color: c.ink, flex: 1, minWidth: 180 }}>{cm.name}</span>
              <span style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>${(num(cm.spend7d) * SPEND_30).toFixed(0)}/mo</span>
              <select style={selStyle} value={effMap[cm.id] || ""} onChange={(e) => setAdMap(cm.id, e.target.value)}>
                <option value="">— unassigned —</option>
                {amazonTargets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {isSuggested && <span style={{ fontFamily: sans, fontSize: 8, color: c.clay, letterSpacing: 1 }}>SUGGESTED</span>}
            </div>
          );
        })}
        {unmappedSpend30 > 0 && <div style={{ fontFamily: sans, fontSize: 11, color: c.clay, marginTop: 8 }}>${unmappedSpend30.toFixed(0)}/mo of ad spend is unassigned — those SKUs' CM2 understates the true cost until mapped.</div>}
        {totalCampaignSpend30 > 0 && <div style={{ fontFamily: sans, fontSize: 10, color: c.sub, marginTop: 4 }}>Total live ad spend ≈ ${totalCampaignSpend30.toFixed(0)}/mo across {campaigns.length} campaigns.</div>}
      </div>

      <div style={{ ...card, borderLeft: `3px solid ${losers.length ? c.red : c.green}` }}>
        <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans, marginBottom: 8 }}>The Bezos lens · what's really left</div>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: 8 }}>
          <div><div style={{ fontFamily: sans, fontSize: 9, color: c.sub, letterSpacing: 1 }}>PORTFOLIO CM1</div><div style={{ fontFamily: serif, fontSize: 24, color: marginColor(summary.cm1Pct) }}>{pct(summary.cm1Pct)}</div></div>
          <div><div style={{ fontFamily: sans, fontSize: 9, color: c.sub, letterSpacing: 1 }}>PORTFOLIO CM2</div><div style={{ fontFamily: serif, fontSize: 24, color: marginColor(summary.cm2Pct) }}>{pct(summary.cm2Pct)}</div></div>
        </div>
        {losers.length > 0 && <div style={{ fontFamily: sans, fontSize: 12, color: c.red, marginBottom: 4 }}>⚠ Losing money after Amazon's cut: {losers.map((r) => r.name).join(", ")} — every unit sold deepens the loss.</div>}
        {adNoSales.length > 0 && <div style={{ fontFamily: sans, fontSize: 12, color: c.red, marginBottom: 4 }}>⚠ Ad spend with 0 units sold (30d): {adNoSales.map((r) => r.name).join(", ")} — pure loss.</div>}
        {thin.length > 0 && <div style={{ fontFamily: sans, fontSize: 12, color: c.clay, marginBottom: 4 }}>Thin (&lt;15% CM2): {thin.map((r) => r.name).join(", ")}.</div>}
        {missingCogs.length > 0 && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub }}>No COGS yet (in COGS or Profit Matrix tab): {missingCogs.map((r) => r.name).join(", ")}.</div>}
        {missingFba.length > 0 && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub }}>No FBA fee yet (set it in Profit Matrix, or type here): {missingFba.map((r) => r.name).join(", ")}.</div>}
        {!losers.length && !thin.length && !missingFba.length && !adNoSales.length && <div style={{ fontFamily: sans, fontSize: 12, color: c.green }}>Every SKU clears a healthy CM2. Nothing is quietly bleeding.</div>}
      </div>
    </div>
  );
}
