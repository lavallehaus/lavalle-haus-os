import { useState, useMemo, useEffect, useRef } from "react";
import { buildMarginsModel, num, SPEND_30 } from "./marginsCore.js";

// LAVALLE HAUS OS — Margins (CM1 / CM2 per SKU). Sales sub-tab.
// CM1 = price − true COGS.   CM2 = CM1 − (referral % + returns % + FBA fee + ad/unit).
// Everything auto-sources, with manual override on every field:
//   • COGS   ← COGS Builder breakdown (falls back to Profit Matrix landed cost)
//   • FBA fee ← Profit Matrix (fbaFee + storage)
//   • Ad/unit ← real campaign spend once each campaign is mapped to a SKU
//               (a SKU is auto-suggested from the campaign name; editable)
// Undo/Redo on every edit.

const c = {
  bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD",
  green: "#5a7a5a", clay: "#8F8676", red: "#9b5e5e", card: "#F4F4F3",
};
const serif = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";
const card = { background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: 14, marginBottom: 12 };
const btnGhost = { padding: "5px 12px", fontSize: 10, fontFamily: sans, letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: `1px solid ${c.line}`, background: "transparent", color: c.sub, textTransform: "uppercase" };
const cellInput = { background: "#F0F0EE", border: `1px solid ${c.line}`, color: c.ink, fontSize: 12, padding: "4px 6px", borderRadius: 1, boxSizing: "border-box", width: 64, fontFamily: sans, textAlign: "right" };
const selStyle = { background: "#F0F0EE", border: `1px solid ${c.line}`, color: c.ink, fontSize: 11, padding: "4px 6px", borderRadius: 1, fontFamily: sans };

const money = (v) => (v == null ? "—" : `$${Number(v).toFixed(2)}`);
const pct = (v) => (v == null ? "—" : `${Number(v).toFixed(0)}%`);

const marginColor = (p) => (p == null ? c.sub : p < 0 ? c.red : p < 20 ? c.clay : c.green);


export default function Margins({ cogs = {}, products = [], campaigns = [], profitMatrix = {}, data = {}, onSave, onFbaFees }) {
  const [state, setState] = useState(() => ({
    referralPct: data.referralPct != null ? data.referralPct : 15,
    returnsPct: data.returnsPct != null ? data.returnsPct : 2,
    bySku: data.bySku || {},
    adMap: data.adMap || {},
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

  // Single source of truth: the shared core builds rows/flags/summary/ad-mapping.
  // The Action Items board uses the same core, so it never needs this tab open.
  const model = useMemo(() => buildMarginsModel({ cogs, products, campaigns, profitMatrix, settings: { ...state, amazonFba: data.amazonFba || {} } }), [cogs, products, campaigns, profitMatrix, state, data.amazonFba]);
  const { rows, flags, summary, effMap, adByProduct, amazonTargets, totalCampaignSpend30, unmappedSpend30 } = model;

  async function fetchFbaFees() {
    const items = (products || [])
      .filter((p) => (p.sku || p.asin) && !p.isSample)
      .map((p) => { const r = (rows || []).find((x) => x.id === p.id); return { id: p.id, asin: p.asin, sku: p.sku, price: r ? r.price : num(p.price) }; });
    if (!items.length) { setFeeFetch({ loading: false, error: "No SKUs/ASINs to look up." }); return; }
    setFeeFetch({ loading: true, error: null });
    try {
      const d = await fetch("/api/amazon-sync?op=fees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) }).then((r) => r.json());
      if (d.error) { setFeeFetch({ loading: false, error: d.error }); return; }
      const map = { ...(data.amazonFba || {}) };
      const filled = [], failed = [];
      (d.items || []).forEach((it) => { if (it.fbaFee != null) { map[it.id] = it.fbaFee; filled.push(it); } else { failed.push(it); } });
      if (onFbaFees) onFbaFees(map, d.updatedAt);
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

  // Auto-pull on open if fees haven't been fetched yet — no button needed.
  const fbaAutoRef = useRef(false);
  useEffect(() => {
    if (fbaAutoRef.current) return;
    fbaAutoRef.current = true;
    if (Object.keys(data.amazonFba || {}).length === 0) fetchFbaFees();
    /* eslint-disable-next-line */
  }, []);

  const persistKey = JSON.stringify({ s: state, sum: summary, fl: flags });
  useEffect(() => { if (onSave) onSave({ referralPct: state.referralPct, returnsPct: state.returnsPct, bySku: state.bySku, adMap: state.adMap, amazonFba: data.amazonFba || {}, fbaUpdatedAt: data.fbaUpdatedAt || null, summary, flags }); /* eslint-disable-next-line */ }, [persistKey]);

  const unpriced = rows.filter((r) => r.price <= 0);
  const losers = rows.filter((r) => r.price > 0 && r.cm2 != null && r.cm2 < 0);
  const thin = rows.filter((r) => r.cm2 != null && r.cm2 >= 0 && r.cm2pct < 15);
  const missingCogs = rows.filter((r) => !r.hasCogs);
  const missingFba = rows.filter((r) => r.fbaFee == null);
  const adNoSales = rows.filter((r) => r.units === 0 && r.mappedSpend > 0);

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
        <span style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: "rgba(111,102,87,0.7)" }}>FBA fees auto-sync from Amazon{data.fbaUpdatedAt ? " · last " + new Date(data.fbaUpdatedAt).toLocaleDateString() : " · syncing on load"}</span>
        <button onClick={fetchFbaFees} disabled={feeFetch.loading} style={{ ...btnGhost, fontSize: 9, padding: "3px 8px" }}>{feeFetch.loading ? "syncing…" : "↻ refresh"}</button>
        {feeFetch.error && <span style={{ fontFamily: sans, fontSize: 10, color: c.red }}>{feeFetch.error}</span>}
        <span style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: "rgba(111,102,87,0.55)" }}>ad/unit from mapped campaigns</span>
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
        {unpriced.length > 0 && <div style={{ fontFamily: sans, fontSize: 12, color: c.clay, marginBottom: 4 }}>Set a price: {unpriced.map((r) => r.name).join(", ")} — no retail price yet, so margin can't be read (not a real loss).</div>}
        {thin.length > 0 && <div style={{ fontFamily: sans, fontSize: 12, color: c.clay, marginBottom: 4 }}>Thin (&lt;15% CM2): {thin.map((r) => r.name).join(", ")}.</div>}
        {missingCogs.length > 0 && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub }}>No COGS yet (in COGS or Profit Matrix tab): {missingCogs.map((r) => r.name).join(", ")}.</div>}
        {missingFba.length > 0 && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: c.sub }}>No FBA fee yet (set it in Profit Matrix, or type here): {missingFba.map((r) => r.name).join(", ")}.</div>}
        {!losers.length && !thin.length && !missingFba.length && !adNoSales.length && !unpriced.length && <div style={{ fontFamily: sans, fontSize: 12, color: c.green }}>Every SKU clears a healthy CM2. Nothing is quietly bleeding.</div>}
      </div>
    </div>
  );
}
