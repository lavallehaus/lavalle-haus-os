import { useState, useMemo, useEffect } from "react";

/* ============================================================================
   LAVALLE HAUS OS — REORDER LIST (Inventory → Reorder List)
   Channel-segmented reorder + stockout planning.

   MODEL
   • Amazon FBA and Shopify are separate physical stock pools (the app syncs
     each live, with 30-day velocity). B2B shares the self-fulfilled pool with
     Shopify; its velocity is entered per-SKU (no live feed).
   • PER-CHANNEL views (Amazon / Shopify / B2B) answer "where will I run out?"
     — stockout is channel-specific (FBA can be empty while Shopify is flush).
   • ALL CHANNELS view is the master production plan: total demand across every
     channel vs. total network inventory → one "make/buy this many" number.

   Per-SKU lead time, target cover, MOQ, supplier link and B2B velocity are
   editable and saved; global defaults sit at the top (Amazon carries an extra
   inbound-to-FBA buffer self-fulfilled channels don't). Full Undo/Redo. Each
   line sends to Action Items (inline undo). Packaging + raw materials feed the
   production plan and show in the All view.

   Live Amazon = live FBA counts + live velocity; the projection uses the same
   logic Seller Central does. Pulling SC's NATIVE restock numbers is a backend
   follow-up (Restock Recommendations report in amazon-sync.js).
   ========================================================================== */

const c = {
  bg: "#f7f4ef", panel: "#fffdf9", ink: "#1a1714", sub: "#8c7d6b",
  line: "#d8d1c4", lineSoft: "#ece7dd", clay: "#a07848", green: "#5a7a5a",
  red: "#9b5e5e", amber: "#b06a2e", slate: "#7a7a9a",
};
const serif = "'IM Fell English', Georgia, serif";
const mono = "monospace";
const faintEs = { fontFamily: serif, fontSize: 10.5, fontStyle: "italic", color: "rgba(140,125,107,0.7)", marginTop: 1 };

const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? 0 : Number(v));
const money = (n) => "$" + num(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

const S = {
  wrap: { fontFamily: serif, color: c.ink, maxWidth: 1100, margin: "0 auto" },
  h1: { fontSize: 27, fontWeight: 400, margin: 0 },
  sec: { fontSize: 17, fontWeight: 400, margin: "24px 0 10px", borderBottom: `1px solid ${c.line}`, paddingBottom: 7 },
  panel: { background: c.panel, border: `1px solid ${c.line}`, borderRadius: 3, padding: 14, marginBottom: 10 },
  cap: { fontFamily: mono, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase", color: c.sub },
  btn: { background: "transparent", border: `1px solid ${c.clay}`, color: c.clay, borderRadius: 2, padding: "5px 11px", cursor: "pointer", fontFamily: mono, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase" },
  ghost: { background: "transparent", border: `1px solid ${c.line}`, color: c.sub, borderRadius: 2, padding: "5px 11px", cursor: "pointer", fontFamily: mono, fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase" },
  input: { background: "#efece5", border: `1px solid ${c.line}`, color: c.ink, fontSize: 12, padding: "4px 7px", borderRadius: 1, fontFamily: mono, width: 64, boxSizing: "border-box" },
};

const STATUS = {
  now: { label: "REORDER NOW", color: c.red, rank: 0 },
  soon: { label: "REORDER SOON", color: c.amber, rank: 1 },
  overstock: { label: "OVERSTOCK · DELAY", color: c.slate, rank: 3 },
  healthy: { label: "HEALTHY", color: c.green, rank: 2 },
  dormant: { label: "NO SALES YET", color: c.sub, rank: 4 },
};

const CHANNELS = [
  { id: "all", label: "All Channels", es: "Todos los canales" },
  { id: "amazon", label: "Amazon (FBA)", es: "Amazon" },
  { id: "shopify", label: "Shopify", es: "Shopify" },
  { id: "b2b", label: "B2B / Wholesale", es: "B2B / Mayoreo" },
];

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtDate = (d) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");
const fmtTime = (s) => { if (!s) return null; try { return new Date(s).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" }); } catch { return null; } };

export default function ReorderList({
  products = [], packaging = [], materials = [], data = {},
  onSave, onAddAction, onRemoveAction,
  amazon = {}, shopify = {}, onAmazonSync, onShopifySync,
  restock = {}, onRestockSync,
}) {
  const DEF = { productionLeadDays: 21, amazonInboundDays: 14, targetWeeks: 8, safetyDays: 7, minSendIn: 12, ...(data.defaults || {}) };

  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [state, setState] = useState(() => ({ settings: data.settings || {}, defaults: DEF }));
  const [channel, setChannel] = useState("all");
  const [open, setOpen] = useState({});
  const [sent, setSent] = useState({});
  // Live elapsed timer while the Seller Central report generates.
  const [, setTick] = useState(0);
  useEffect(() => { if (restock.status !== "pending") return; const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, [restock.status]);
  const elapsedSec = restock.startedAt ? Math.floor((Date.now() - restock.startedAt) / 1000) : 0;
  const elapsedTxt = `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}`;

  const commit = (next) => { setPast((p) => [...p.slice(-49), state]); setFuture([]); setState(next); if (onSave) onSave(next); };
  const undo = () => { if (!past.length) return; const prev = past[past.length - 1]; setPast((p) => p.slice(0, -1)); setFuture((f) => [state, ...f].slice(0, 50)); setState(prev); if (onSave) onSave(prev); };
  const redo = () => { if (!future.length) return; const nxt = future[0]; setFuture((f) => f.slice(1)); setPast((p) => [...p.slice(-49), state]); setState(nxt); if (onSave) onSave(nxt); };

  const d = state.defaults;
  const setDefault = (k, v) => commit({ ...state, defaults: { ...state.defaults, [k]: num(v) } });
  const setSetting = (id, k, v) => commit({ ...state, settings: { ...state.settings, [id]: { ...(state.settings[id] || {}), [k]: v } } });

  const today = startOfToday();

  // ── Per-channel raw inputs for a product (or null if not on that channel) ──
  const amzInputs = (p) => {
    const live = amazon && amazon.items && amazon.items[p.id];
    const onAmazon = (p.channels || []).includes("Amazon") || !!live;
    if (!onAmazon) return null;
    const onHand = live ? num(live.fba) : num(p.available);
    const inbound = live ? num(live.inbound) : num(p.inbound);
    const sold30 = amazon && amazon.sold && amazon.sold[p.id] != null ? num(amazon.sold[p.id]) : num(p.unitsSold30);
    return { onHand, inbound, sold30, live: !!live };
  };
  const shopInputs = (p) => {
    if (!(p.channels || []).includes("Shopify")) return null;
    const qty = shopify && shopify.items && shopify.items[p.id] != null ? num(shopify.items[p.id]) : null;
    const sold = shopify && shopify.sold && shopify.sold[p.id] != null ? num(shopify.sold[p.id]) : null;
    return { onHand: qty == null ? 0 : qty, inbound: 0, sold30: sold == null ? 0 : sold, live: qty != null };
  };
  const b2bInputs = (p) => {
    if (!(p.channels || []).includes("B2B")) return null;
    const set = state.settings[p.id] || {};
    const shop = shopInputs(p); // B2B shares the self-fulfilled (Shopify) pool
    const onHand = shop ? shop.onHand : num(set.b2bOnHand);
    return { onHand, inbound: 0, sold30: num(set.b2bSold30), shared: !!shop };
  };

  // ── Generic projection ──
  const project = (onHand, inbound, sold30, leadDays, moq) => {
    const target = num(d.targetWeeks), safety = num(d.safetyDays);
    const perDay = sold30 / 30;
    const coverDays = perDay > 0 ? Math.round(onHand / perDay) : (onHand > 0 ? Infinity : 0);
    const coverWeeks = coverDays === Infinity ? Infinity : Math.round(coverDays / 7);
    const stockout = perDay > 0 ? addDays(today, onHand / perDay) : null;
    const reorderBy = stockout ? addDays(stockout, -(leadDays + safety)) : null;
    const orderUpTo = Math.ceil(target * 7 * perDay);
    let qty = Math.max(0, orderUpTo - (onHand + inbound));
    if (qty > 0 && moq) qty = Math.max(qty, moq);
    let status;
    if (perDay === 0 && onHand === 0 && inbound === 0) status = "dormant";
    else if (perDay === 0) status = onHand > 0 ? "overstock" : "dormant";
    else if (onHand + inbound > orderUpTo * 2) status = "overstock";
    else if (qty <= 0) status = "healthy";
    else if (reorderBy && reorderBy.getTime() <= today.getTime()) status = "now";
    else status = "soon";
    return { perDay, coverWeeks, stockout, reorderBy, qty, status, onHand, inbound };
  };

  // ── Build rows for the active channel ──
  const rows = useMemo(() => {
    const out = [];
    products.filter((p) => !p.isSample).forEach((p) => {
      const set = state.settings[p.id] || {};
      const moq = num(set.moq);
      const leadOverride = set.leadTimeDays != null && set.leadTimeDays !== "" ? num(set.leadTimeDays) : null;
      const prodLead = leadOverride != null ? leadOverride : num(d.productionLeadDays);
      const link = set.supplierLink || "";

      if (channel === "amazon") {
        const a = amzInputs(p); if (!a) return;
        const sc = restock && restock.items && restock.items[p.id];
        if (sc) {
          const days = sc.daysOfSupply;
          const cw = days != null ? Math.round(days / 7) : (a.sold30 > 0 ? Math.round((a.onHand / (a.sold30 / 30)) / 7) : Infinity);
          const stockout = days != null ? addDays(today, days) : null;
          const shipBy = sc.recommendedShipDate ? new Date(sc.recommendedShipDate) : null;
          // Amazon's ship-by date is when stock must LEAVE for FBA. To hit it,
          // production has to start prodLead days earlier.
          const startProdBy = shipBy ? addDays(shipBy, -prodLead) : null;
          let status;
          if (num(sc.recommendedQty) > 0) status = (days != null && days <= 21) ? "now" : "soon";
          else if (days != null && days > 120) status = "overstock";
          else status = "healthy";
          out.push({
            id: "amz:" + p.id, pid: p.id, name: p.name, link, native: true, alert: sc.alert,
            onHand: sc.available != null ? sc.available : a.onHand, inbound: sc.inbound != null ? sc.inbound : a.inbound,
            perDay: sc.sold30 != null ? sc.sold30 / 30 : a.sold30 / 30, coverWeeks: cw, stockout,
            reorderBy: shipBy, shipBy, startProdBy, recQty: num(sc.recommendedQty),
            qty: num(sc.recommendedQty), status,
          });
        } else {
          const pr = project(a.onHand, a.inbound, a.sold30, prodLead + num(d.amazonInboundDays), moq);
          if (pr.qty > 0) pr.qty = Math.max(pr.qty, num(d.minSendIn), moq); // never suggest a trivial FBA shipment
          out.push({ id: "amz:" + p.id, pid: p.id, name: p.name, link, live: a.live, estimate: true, ...pr });
        }
      } else if (channel === "shopify") {
        const s = shopInputs(p); if (!s) return;
        const pr = project(s.onHand, 0, s.sold30, prodLead, moq);
        out.push({ id: "shp:" + p.id, pid: p.id, name: p.name, link, live: s.live, ...pr });
      } else if (channel === "b2b") {
        const bv = b2bInputs(p); if (!bv) return;
        const pr = project(bv.onHand, 0, bv.sold30, prodLead, moq);
        out.push({ id: "b2b:" + p.id, pid: p.id, name: p.name, link, shared: bv.shared, ...pr });
      } else { // all — master production plan
        const a = amzInputs(p), s = shopInputs(p), bv = b2bInputs(p);
        if (!a && !s && !bv) return;
        const totalSold = (a ? a.sold30 : 0) + (s ? s.sold30 : 0) + (bv ? bv.sold30 : 0);
        const selfOnHand = s ? s.onHand : (bv ? bv.onHand : 0); // self pool counted once
        const totalOnHand = (a ? a.onHand : 0) + selfOnHand;
        const totalInbound = a ? a.inbound : 0;
        const lead = a ? prodLead + num(d.amazonInboundDays) : prodLead;
        const pr = project(totalOnHand, totalInbound, totalSold, lead, moq);
        const aNat = a && restock && restock.items && restock.items[p.id];
        out.push({
          id: "all:" + p.id, pid: p.id, name: p.name, link, ...pr,
          breakdown: [
            a ? `Amazon ${a.onHand}u · ${(a.sold30 / 30).toFixed(2)}/d${aNat && num(aNat.recommendedQty) > 0 ? ` · SC send-in ${num(aNat.recommendedQty)}` : ""}` : null,
            s ? `Shopify ${s.onHand}u · ${(s.sold30 / 30).toFixed(2)}/d` : null,
            bv ? (bv.sold30 ? `B2B ${(bv.sold30 / 30).toFixed(2)}/d` : "B2B (no velocity set)") : null,
          ].filter(Boolean),
        });
      }
    });
    return out.sort((a, b) => {
      const ra = STATUS[a.status].rank, rb = STATUS[b.status].rank;
      if (ra !== rb) return ra - rb;
      const ta = a.reorderBy ? a.reorderBy.getTime() : Infinity, tb = b.reorderBy ? b.reorderBy.getTime() : Infinity;
      return ta - tb;
    });
  }, [products, state, d, channel, amazon, shopify, restock]);

  const summary = useMemo(() => {
    const live = rows.filter((r) => r.status !== "dormant");
    const k = { now: 0, soon: 0, overstock: 0, healthy: 0 };
    let soonest = null;
    live.forEach((r) => { if (k[r.status] != null) k[r.status] += 1; if (r.stockout && (!soonest || r.stockout < soonest)) soonest = r.stockout; });
    return { ...k, soonest, total: live.length };
  }, [rows]);

  const pkgFlags = useMemo(() => packaging.filter((p) => num(p.reorderPoint) > 0 && num(p.onHand) <= num(p.reorderPoint))
    .map((p, i) => ({ id: "pkg:" + (p.id || i), name: p.component || "Packaging item", onHand: num(p.onHand), rp: num(p.reorderPoint), supplier: p.supplier || "", link: p.link || "", qty: num(p.moq) || Math.max(1, num(p.reorderPoint) * 2 - num(p.onHand)) })), [packaging]);
  const rawFlags = useMemo(() => materials.filter((m) => m.status === "out" || m.status === "reorder")
    .map((m) => ({ id: "raw:" + m.id, name: m.name, status: m.status, note: m.note || "", link: m.buyLink || "", cost: m.estCost })), [materials]);

  function send(row, item) {
    if (!onAddAction) return;
    const id = "ro_" + Date.now() + "_" + String(row.id).replace(/[^a-z0-9]/gi, "");
    onAddAction({ id, source: "coo", ...item, assigneeId: null, status: "open", createdAt: new Date().toISOString() });
    setSent((s) => ({ ...s, [row.id]: id }));
  }
  function unsend(row) { const id = sent[row.id]; if (id && onRemoveAction) onRemoveAction(id); setSent((s) => { const n = { ...s }; delete n[row.id]; return n; }); }

  const SendCell = ({ row, item }) => {
    if (!onAddAction) return null;
    return sent[row.id]
      ? <span style={{ fontFamily: mono, fontSize: 9.5, color: c.green }}>✓ sent · <button onClick={() => unsend(row)} style={{ background: "none", border: "none", color: c.clay, cursor: "pointer", fontFamily: mono, fontSize: 9.5, textDecoration: "underline", padding: 0 }}>undo</button></span>
      : <button onClick={() => send(row, item)} style={S.btn}>→ Action Item</button>;
  };
  const LinkBtn = ({ href }) => href ? <a href={href} target="_blank" rel="noreferrer" style={{ ...S.ghost, textDecoration: "none", display: "inline-block" }}>↗ Buy</a> : null;

  // Obvious freshness stamp — green if recent, amber/red as it ages.
  const Fresh = ({ at, pending }) => {
    if (pending) return <span style={{ color: c.clay }}>updating…</span>;
    if (!at) return <span style={{ color: c.red }}>never synced</span>;
    const ms = Date.now() - new Date(at).getTime();
    const color = ms < 24 * 3600000 ? c.green : ms < 72 * 3600000 ? c.amber : c.red;
    const txt = ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))}m ago` : ms < 86400000 ? `${Math.round(ms / 3600000)}h ago` : `${Math.round(ms / 86400000)}d ago`;
    return <span style={{ color }}>updated {txt}</span>;
  };

  const activeMeta = CHANNELS.find((x) => x.id === channel);
  const syncStamp = channel === "amazon" ? fmtTime(amazon && amazon.syncedAt) : channel === "shopify" ? fmtTime(shopify && shopify.syncedAt) : null;
  const syncFn = channel === "amazon" ? onAmazonSync : channel === "shopify" ? onShopifySync : null;
  const syncing = channel === "amazon" ? (amazon && amazon.syncing) : channel === "shopify" ? (shopify && shopify.syncing) : false;

  return (
    <div style={S.wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={S.h1}>Reorder List</h1>
          <div style={faintEs}>Lista de reorden — por canal y plan maestro</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={undo} disabled={!past.length} style={{ ...S.ghost, opacity: past.length ? 1 : 0.4, cursor: past.length ? "pointer" : "not-allowed" }}>↶ Undo</button>
          <button onClick={redo} disabled={!future.length} style={{ ...S.ghost, opacity: future.length ? 1 : 0.4, cursor: future.length ? "pointer" : "not-allowed" }}>↷ Redo</button>
        </div>
      </div>

      {/* Channel selector */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        {CHANNELS.map((ch) => (
          <button key={ch.id} onClick={() => setChannel(ch.id)}
            style={{ background: channel === ch.id ? c.ink : "transparent", color: channel === ch.id ? c.bg : c.sub, border: `1px solid ${channel === ch.id ? c.ink : c.line}`, borderRadius: 2, padding: "6px 13px", cursor: "pointer", fontFamily: mono, fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }}>
            {ch.label}
          </button>
        ))}
      </div>

      {/* Stockout summary banner */}
      <div style={{ ...S.panel, marginTop: 12, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, alignItems: "center", borderLeft: `3px solid ${summary.now ? c.red : summary.soon ? c.amber : c.green}` }}>
        <div>
          <div style={S.cap}>{activeMeta.label} · stockout summary</div>
          <div style={{ fontSize: 14, marginTop: 4 }}>
            <span style={{ color: c.red }}>{summary.now} reorder now</span> · <span style={{ color: c.amber }}>{summary.soon} soon</span> · <span style={{ color: c.slate }}>{summary.overstock} overstock</span> · <span style={{ color: c.green }}>{summary.healthy} healthy</span>
          </div>
          <div style={{ fontSize: 12, color: c.sub, marginTop: 3 }}>Soonest stockout: {summary.soonest ? fmtDate(summary.soonest) : "none projected"}{channel === "all" ? " · master plan = total demand vs total network stock" : ""}</div>
          <div style={{ fontSize: 11.5, marginTop: 4, fontFamily: mono, letterSpacing: 0.3 }}>
            {channel === "amazon" && <span style={{ color: c.sub }}>FBA counts <Fresh at={amazon && amazon.syncedAt} pending={amazon && amazon.syncing} /> · Seller Central <Fresh at={restock && restock.syncedAt} pending={restock.status === "pending"} /></span>}
            {channel === "shopify" && <span style={{ color: c.sub }}>Shopify <Fresh at={shopify && shopify.syncedAt} pending={shopify && shopify.syncing} /></span>}
            {channel === "all" && <span style={{ color: c.sub }}>FBA <Fresh at={amazon && amazon.syncedAt} pending={amazon && amazon.syncing} /> · Shopify <Fresh at={shopify && shopify.syncedAt} pending={shopify && shopify.syncing} /> · SC restock <Fresh at={restock && restock.syncedAt} pending={restock.status === "pending"} /></span>}
            {channel === "b2b" && <span style={{ color: c.sub }}>manually entered — no live feed</span>}
          </div>
        </div>
        {channel === "b2b" ? <div style={{ ...faintEs, maxWidth: 260 }}>B2B has no live feed — enter monthly velocity per SKU in ⚙. Shares Shopify's self-fulfilled stock.</div>
          : channel === "amazon" ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
              {onAmazonSync && <button onClick={onAmazonSync} disabled={syncing} style={{ ...S.ghost, opacity: syncing ? 0.5 : 1 }}>{syncing ? "syncing… (~15s)" : "⟳ FBA counts"}{syncStamp ? ` · ${syncStamp}` : ""}</button>}
              {onRestockSync && <button onClick={() => onRestockSync(restock.status === "ready")} disabled={restock.status === "pending"} style={{ ...S.btn, opacity: restock.status === "pending" ? 0.7 : 1 }}>{restock.status === "pending" ? `updating… ${elapsedTxt}` : restock.status === "timeout" ? "↻ keep waiting" : restock.status === "ready" ? "↻ Refresh SC" : (restock.syncedAt ? "↻ Refresh SC" : "⤓ Pull SC now")}</button>}
            </div>
          )
          : syncFn ? <button onClick={syncFn} disabled={syncing} style={{ ...S.ghost, opacity: syncing ? 0.5 : 1 }}>{syncing ? "syncing…" : "⟳ resync"}{syncStamp ? ` · ${syncStamp}` : ""}</button> : null}
      </div>
      {channel === "amazon" && restock.status === "pending" && <div style={{ fontSize: 11.5, color: c.sub, marginTop: -4, marginBottom: 10 }}>Asking Amazon to generate the restock report — usually 1–3 minutes. Elapsed {elapsedTxt}. You can keep working; it fills in when ready.</div>}
      {channel === "amazon" && restock.status === "timeout" && <div style={{ fontSize: 11.5, color: c.amber, marginTop: -4, marginBottom: 10 }}>Amazon is still generating the report (these can take a few minutes). Click "↻ keep waiting" to resume — it picks up the same report, not a new one.</div>}
      {channel === "amazon" && restock.status === "error" && <div style={{ fontSize: 11.5, color: c.red, marginTop: -4, marginBottom: 10 }}>Seller Central restock: {restock.error}</div>}

      {/* Defaults */}
      <div style={{ ...S.panel, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <span style={S.cap}>Defaults</span>
        <label style={{ fontSize: 12 }}>Production lead (days) <input style={S.input} type="number" value={d.productionLeadDays} onChange={(e) => setDefault("productionLeadDays", e.target.value)} /></label>
        <label style={{ fontSize: 12 }}>Amazon receive + distribute (days) <input style={S.input} type="number" value={d.amazonInboundDays} onChange={(e) => setDefault("amazonInboundDays", e.target.value)} /></label>
        <label style={{ fontSize: 12 }}>Target cover (weeks) <input style={S.input} type="number" value={d.targetWeeks} onChange={(e) => setDefault("targetWeeks", e.target.value)} /></label>
        <label style={{ fontSize: 12 }}>Safety (days) <input style={S.input} type="number" value={d.safetyDays} onChange={(e) => setDefault("safetyDays", e.target.value)} /></label>
        <label style={{ fontSize: 12 }}>Min FBA send-in (units) <input style={S.input} type="number" value={d.minSendIn} onChange={(e) => setDefault("minSendIn", e.target.value)} /></label>
        <div style={{ ...faintEs, flexBasis: "100%" }}>Amazon SKUs lead = production + ship-to-FBA + Amazon's receive/distribute time (shipments often route through multiple FCs — allow ~2 weeks). Estimated send-in never drops below the min above; Amazon's own pull ignores it. · El lead de Amazon suma producción + envío + recepción/distribución (~2 semanas). La estimación nunca baja del mínimo.</div>
      </div>

      {/* Rows */}
      {rows.filter((r) => r.status !== "dormant").length === 0 && <div style={{ ...S.panel, fontFamily: mono, fontSize: 12, color: c.green }}>Nothing to reorder on this channel. · Nada que reordenar en este canal.</div>}
      {rows.filter((r) => r.status !== "dormant").map((r) => {
        const st = STATUS[r.status];
        const item = {
          title: channel === "amazon" ? `Send ${r.qty} units to FBA — ${r.name}` : channel === "all" ? `Produce / buy ${r.qty} units — ${r.name}` : `Reorder ${r.qty} units — ${r.name} (${activeMeta.label})`,
          detail: `On hand ${r.onHand}${r.inbound ? " +" + r.inbound + " inbound" : ""}, selling ${(r.perDay * 30).toFixed(0)}/mo (~${r.coverWeeks === Infinity ? "∞" : r.coverWeeks}w). ${r.status === "now" ? "Order now" : "Order by " + fmtDate(r.reorderBy)}.${r.native ? ` Amazon recommends sending in ${r.recQty} units${r.shipBy ? ", ship to FBA by " + fmtDate(r.shipBy) : ""}${r.startProdBy ? ", start production by " + fmtDate(r.startProdBy) : ""}${r.alert ? " (" + r.alert + ")" : ""}.` : ""}`,
          name: r.name, severity: r.status === "now" ? "high" : "med",
        };
        return (
          <div key={r.id} style={{ ...S.panel, borderLeft: `3px solid ${st.color}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 190 }}>
                <span style={{ fontFamily: mono, fontSize: 8, letterSpacing: 1, color: "#fff", background: st.color, padding: "1px 6px", borderRadius: 2 }}>{st.label}</span>
                {r.live && <span style={{ marginLeft: 6, fontFamily: mono, fontSize: 8, letterSpacing: 1, color: c.green }}>● LIVE</span>}
                {r.native && <span style={{ marginLeft: 6, fontFamily: mono, fontSize: 8, letterSpacing: 1, color: c.clay }}>● SELLER CENTRAL</span>}
                <div style={{ fontSize: 15, marginTop: 4 }}>{r.name}</div>
                {r.native && r.alert && <div style={{ fontSize: 11, color: c.clay, marginTop: 2 }}>Amazon: {r.alert}</div>}
                {r.breakdown && <div style={{ fontSize: 11, color: c.sub, marginTop: 3 }}>{r.breakdown.join("  ·  ")}</div>}
                {r.shared && <div style={faintEs}>shares Shopify self-fulfilled stock</div>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(86px, 1fr))", gap: 10, flex: 2, minWidth: 270 }}>
                <div><div style={S.cap}>On hand</div><div style={{ fontSize: 14 }}>{r.onHand}{r.inbound ? ` +${r.inbound}` : ""}</div></div>
                <div><div style={S.cap}>Velocity</div><div style={{ fontSize: 14 }}>{r.perDay > 0 ? `${r.perDay.toFixed(2)}/day` : "—"}</div></div>
                <div><div style={S.cap}>Cover</div><div style={{ fontSize: 14 }}>{r.coverWeeks === Infinity ? "∞" : r.coverWeeks + "w"}</div></div>
                <div><div style={S.cap}>Stockout</div><div style={{ fontSize: 14 }}>{fmtDate(r.stockout)}</div></div>
                <div><div style={S.cap}>Order by</div><div style={{ fontSize: 14, color: r.status === "now" ? c.red : c.ink }}>{r.status === "now" ? "now" : fmtDate(r.reorderBy)}</div></div>
                <div><div style={S.cap}>{channel === "all" ? "Make / buy" : channel === "amazon" ? "Send to FBA" : "Reorder qty"}</div><div style={{ fontSize: 16, color: c.clay }}>{r.qty > 0 ? r.qty : "—"}</div></div>
              </div>
            </div>
            {r.native && (
              <div style={{ marginTop: 8, padding: "8px 11px", background: "#a0784812", border: `1px solid ${c.line}`, borderRadius: 2, fontSize: 12.5 }}>
                {num(r.recQty) > 0
                  ? <span><b style={{ color: c.clay }}>Amazon recommends sending in {r.recQty} units</b>{r.shipBy ? ` — ship to FBA by ${fmtDate(r.shipBy)}` : ""}{r.startProdBy ? `, so start production by ${fmtDate(r.startProdBy)}` : ""}.</span>
                  : <span style={{ color: c.sub }}>Amazon isn't recommending a replenishment right now.</span>}
              </div>
            )}
            {channel === "amazon" && !r.native && (
              <div style={{ marginTop: 6, fontSize: 11, color: c.sub, fontStyle: "italic" }}>Estimated from live counts — pull Seller Central (top right) for Amazon's own recommended send-in qty. Order-by already allows production + ship-to-FBA + Amazon receive/distribute + safety.</div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))} style={S.ghost}>⚙ {open[r.id] ? "close" : "settings"}</button>
              <LinkBtn href={r.link} />
              {r.qty > 0 && <SendCell row={r} item={item} />}
            </div>
            {open[r.id] && (
              <div style={{ display: "flex", gap: 14, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.lineSoft}`, flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ fontSize: 11.5, color: c.sub }}>Lead days <input style={S.input} type="number" placeholder={String(d.productionLeadDays)} value={(state.settings[r.pid] || {}).leadTimeDays ?? ""} onChange={(e) => setSetting(r.pid, "leadTimeDays", e.target.value)} /></label>
                <label style={{ fontSize: 11.5, color: c.sub }}>Target wks <input style={S.input} type="number" placeholder={String(d.targetWeeks)} value={(state.settings[r.pid] || {}).targetWeeks ?? ""} onChange={(e) => setSetting(r.pid, "targetWeeks", e.target.value)} /></label>
                <label style={{ fontSize: 11.5, color: c.sub }}>MOQ <input style={S.input} type="number" value={(state.settings[r.pid] || {}).moq ?? ""} onChange={(e) => setSetting(r.pid, "moq", e.target.value)} /></label>
                <label style={{ fontSize: 11.5, color: c.sub }}>B2B units/mo <input style={S.input} type="number" value={(state.settings[r.pid] || {}).b2bSold30 ?? ""} onChange={(e) => setSetting(r.pid, "b2bSold30", e.target.value)} /></label>
                <label style={{ fontSize: 11.5, color: c.sub }}>Supplier link <input style={{ ...S.input, width: 220 }} type="url" placeholder="https://…" value={(state.settings[r.pid] || {}).supplierLink ?? ""} onChange={(e) => setSetting(r.pid, "supplierLink", e.target.value)} /></label>
              </div>
            )}
          </div>
        );
      })}

      {/* Packaging + raw materials feed production — shown in All view */}
      {channel === "all" && (
        <>
          <div style={S.sec}>Packaging Below Reorder Point<div style={faintEs}>Empaque bajo el punto de reorden</div></div>
          {pkgFlags.length === 0 ? <div style={{ ...S.panel, fontFamily: mono, fontSize: 12, color: c.sub }}>None below reorder point.</div>
            : pkgFlags.map((p) => (
              <div key={p.id} style={{ ...S.panel, borderLeft: `3px solid ${c.amber}`, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 180 }}><div style={{ fontSize: 14 }}>{p.name}</div><div style={{ fontSize: 11.5, color: c.sub }}>{p.onHand} on hand · reorder pt {p.rp}{p.supplier ? ` · ${p.supplier}` : ""}</div></div>
                <div style={{ fontSize: 13, color: c.clay }}>order {p.qty}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}><LinkBtn href={p.link} /><SendCell row={p} item={{ title: `Reorder packaging — ${p.name}`, detail: `${p.onHand} on hand, reorder point ${p.rp}. Suggested order ${p.qty}.`, name: p.name, severity: "med" }} /></div>
              </div>
            ))}
          <div style={S.sec}>Raw Materials Flagged<div style={faintEs}>Materias primas marcadas</div></div>
          {rawFlags.length === 0 ? <div style={{ ...S.panel, fontFamily: mono, fontSize: 12, color: c.sub }}>None flagged.</div>
            : rawFlags.map((m) => (
              <div key={m.id} style={{ ...S.panel, borderLeft: `3px solid ${m.status === "out" ? c.red : c.amber}`, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 180 }}><span style={{ fontFamily: mono, fontSize: 8, letterSpacing: 1, color: "#fff", background: m.status === "out" ? c.red : c.amber, padding: "1px 6px", borderRadius: 2 }}>{m.status === "out" ? "OUT" : "REORDER"}</span><div style={{ fontSize: 14, marginTop: 4 }}>{m.name}</div>{m.note && <div style={{ fontSize: 11.5, color: c.sub }}>{m.note}</div>}</div>
                {m.cost != null && m.cost !== "" && <div style={{ fontSize: 12, color: c.sub }}>~{money(m.cost)}</div>}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}><LinkBtn href={m.link} /><SendCell row={m} item={{ title: `Reorder material — ${m.name}`, detail: `${m.status === "out" ? "Out of stock" : "Flagged for reorder"}.${m.note ? " " + m.note : ""}`, name: m.name, severity: m.status === "out" ? "high" : "med" }} /></div>
              </div>
            ))}
        </>
      )}

      <div style={{ ...faintEs, marginTop: 18 }}>
        Per-channel = where you run out (channel stock vs channel velocity). All = total demand vs total network stock → one make/buy number. Amazon lead = production + inbound-to-FBA. Reorder-by = stockout − lead − safety.
      </div>
    </div>
  );
}
