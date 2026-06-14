import { useState, useEffect, useCallback, useRef } from "react";
import ProfitMatrix from "./ProfitMatrix.jsx";
import CogsBuilder from "./CogsBuilder.jsx";
import AICoo from "./AICoo.jsx";
import FinanceCash from "./FinanceCash.jsx";
import Wholesale from "./Wholesale.jsx";
import PnL from "./PnL.jsx";
import GoogleAds from "./GoogleAds.jsx";
import MetaAds from "./MetaAds.jsx";
import EmailRetention from "./EmailRetention.jsx";
import FbaShipments from "./FbaShipments.jsx";
import AmazonProfit from "./AmazonProfit.jsx";
import Pricing from "./Pricing.jsx";
import Listings from "./Listings.jsx";
import VesselCreator from "./VesselCreator.jsx";
import Bank from "./Bank.jsx";
import Margins from "./Margins.jsx";
import ActionsBoard from "./ActionsBoard.jsx";
import Tracker from "./Tracker.jsx";
import AmazonKeywords from "./AmazonKeywords.jsx";
import { buildMarginsModel } from "./marginsCore.js";

// ── APP LOCK: every /api call carries the session token; any 401 locks the UI ─
const _nativeFetch = window.fetch.bind(window);
window.fetch = async (url, opts = {}) => {
  if (typeof url === "string" && url.startsWith("/api/")) {
    opts = { ...opts, headers: { ...(opts.headers || {}), "x-app-token": localStorage.getItem("lh_token") || "" } };
  }
  const r = await _nativeFetch(url, opts);
  if (r.status === 401 && typeof url === "string" && url.startsWith("/api/") && !url.includes("op=login")) {
    window.dispatchEvent(new Event("lh-locked"));
  }
  return r;
};

// ── DATABASE via Vercel API ───────────────────────────────────────────────────
async function dbLoad() {
try {
const res = await fetch("/api/data");
const data = await res.json();
console.log("Loaded from DB:", data);
return data;
} catch(e) {
console.warn("dbLoad failed:", e);
return null;
}
}

async function dbSave(record) {
try {
await fetch("/api/data", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(record),
});
console.log("Saved to DB");
} catch(e) {
console.warn("dbSave failed:", e);
}
}

const FONT_LINK = "https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&display=swap";

// ── DATA ─────────────────────────────────────────────────────────────────────

const CHANNELS = ["Amazon", "Shopify", "Amazon + Shopify", "Coming Soon"];

const INITIAL_PRODUCTS = [
// ── AMAZON ──
{ id: 1, name: "SeaShell Vessel Candle", sku: "RH-SeaShell-9633", asin: "B0GR8452CL", available: 0, inbound: 200, unitsSold30: 0, price: 0, channels: ["Amazon"], status: "inbound", notes: "200 units incoming — launch campaigns on arrival" },
{ id: 2, name: "Beeswax Candle Sand 16oz", sku: "RH-Sandwax-AC-16c", asin: "B0GR1NWNG8", available: 30, inbound: 0, unitsSold30: 8, price: 26, channels: ["Amazon"], status: "ok", notes: "Main revenue driver. Phrase Match & H10 campaigns performing." },
{ id: 3, name: "Beeswax Candle Sand 32oz", sku: "RH-Sandwax-AC-32c", asin: "B0GR1KQ253", available: 30, inbound: 0, unitsSold30: 1, price: 46, channels: ["Amazon"], status: "slow", notes: "129 weeks supply. Very slow mover — pause ads, evaluate." },
{ id: 4, name: "Mini Spiced Apple Botanical Candle", sku: "RH-CANDLE-SM-AP", asin: "B0FVGM15JB", available: 55, inbound: 0, unitsSold30: 16, price: 18.99, channels: ["Amazon", "Shopify"], status: "ok", notes: "Best seller by units. Keep campaigns healthy." },
{ id: 5, name: "Large Spiced Apple Botanical Candle", sku: "RH-CANDLE-LG-AP", asin: "B0FVGM15J7", available: 34, inbound: 0, unitsSold30: 8, price: 59, channels: ["Amazon", "Shopify"], status: "ok", notes: "Good velocity. Monitor stock — 18 weeks supply." },
{ id: 6, name: "Bath Salts Unscented", sku: "LH-BATH-SALT-UN", asin: "", available: 0, inbound: 0, unitsSold30: 0, price: 0, channels: ["Amazon"], status: "inbound", notes: "Upcoming Amazon launch. ASIN TBD." },
// ── SHOPIFY ONLY ──
{ id: 7, name: "Dough Bowl Vessel Candle", sku: "LH-VESSEL-DOUGH", asin: "", available: 0, inbound: 0, unitsSold30: 0, price: 0, channels: ["Shopify"], status: "ok", notes: "Shopify only. Add stock levels and pricing." },
{ id: 8, name: "Sugar Scrub", sku: "LH-SCRUB-SUGAR", asin: "", available: 0, inbound: 0, unitsSold30: 0, price: 38, channels: ["Shopify"], status: "ok", notes: "Shopify only. Manufacturing in Spain. Amazon launch in 3-4 months." },
// ── COMING SOON ──
{ id: 9, name: "Lavender Body Oil", sku: "LH-OIL-LAV", asin: "", available: 0, inbound: 0, unitsSold30: 0, price: 0, channels: ["Shopify"], status: "inbound", notes: "Shopify first. Plan Amazon launch — update channel when live." },
{ id: 10, name: "Moroccan Soap", sku: "LH-SOAP-MOR", asin: "", available: 0, inbound: 0, unitsSold30: 0, price: 0, channels: ["Shopify"], status: "inbound", notes: "Shopify only for now." },

{ id: 11, name: "Sugar Scrub Sample", sku: "LH-SCRUB-SUGAR-SMP", asin: "", available: 0, inbound: 0, unitsSold30: 0, price: 0, channels: ["B2B"], status: "ok", isSample: true, notes: "Tester — sample size of Vanilla Cashmere Sugar Scrub." },
{ id: 12, name: "Small Apple Candle Sample", sku: "LH-CANDLE-SM-AP-SMP", asin: "", available: 0, inbound: 0, unitsSold30: 0, price: 0, channels: ["B2B"], status: "ok", isSample: true, notes: "Tester — sample size of Mini Spiced Apple candle." },
];

const INITIAL_CAMPAIGNS = [
{ id: 1, name: "Sand Wax – Phrase Match Discovery", budget: 3, spend7d: 11.86, sales7d: 26, purchases: 1, roas: 2.19, status: "keep", recommendation: "Keep running — ROAS 2.19 is profitable. Watch weekly." },
{ id: 2, name: "Sand Wax – H10 High Search Volume", budget: 5, spend7d: 10.40, sales7d: 26, purchases: 1, roas: 2.50, status: "keep", recommendation: "Best performer. ROAS 2.50. Increase budget to $8/day." },
{ id: 3, name: "Sand Wax – Broad Match Expansion", budget: 5, spend7d: 62.97, sales7d: 0, purchases: 0, roas: 0, status: "pause", recommendation: "PAUSE NOW. $63 spent, zero sales. Bleeding money." },
{ id: 4, name: "Sand Wax – Exact Match High Intent", budget: 5, spend7d: 0, sales7d: 0, purchases: 0, roas: 0, status: "monitor", recommendation: "No data yet. Give 2 more weeks before evaluating." },
{ id: 5, name: "Sand Wax – Product Targeting", budget: 5, spend7d: 2.88, sales7d: 0, purchases: 0, roas: 0, status: "watch", recommendation: "Low spend, no sales yet. Set $3 spend limit before pausing." },
];

const MATERIALS = [
{ id: 1, name: "Cling wrap", status: "out", note: "OUT — order immediately", buyLink: "", estCost: null, priority: 1 },
{ id: 2, name: "Paraffin 1301/1407", status: "reorder", note: "Flagged for reorder", buyLink: "", estCost: null, priority: 2 },
{ id: 3, name: "Wicks", status: "reorder", note: "Flagged for reorder", buyLink: "", estCost: null, priority: 2 },
{ id: 4, name: "Mesh bags SS", status: "reorder", note: "Flagged for reorder", buyLink: "", estCost: null, priority: 3 },
{ id: 5, name: "Spiced Apple EO scents", status: "reorder", note: "Flagged for reorder", buyLink: "", estCost: null, priority: 2 },
{ id: 6, name: "EO Balsam Fir", status: "reorder", note: "Flagged for reorder", buyLink: "", estCost: null, priority: 3 },
{ id: 7, name: "Jojoba", status: "reorder", note: "Flagged for reorder", buyLink: "", estCost: null, priority: 3 },
{ id: 8, name: "Sticker rolls", status: "ok", note: "", buyLink: "", estCost: null, priority: 4 },
{ id: 9, name: "Parchment paper", status: "ok", note: "", buyLink: "", estCost: null, priority: 4 },
{ id: 10, name: "Cinnamon sticks", status: "ok", note: "", buyLink: "", estCost: null, priority: 4 },
{ id: 11, name: "Apple Honey fragrance", status: "ok", note: "", buyLink: "", estCost: null, priority: 4 },
];

const WEEKLY_BUDGET = 250;

const CHECKLIST_ITEMS = [
{ id: 1, category: "Inventory", task: "Check FBA stock levels for each SKU", detail: "Flag anything under 6 weeks of supply" },
{ id: 2, category: "Inventory", task: "Review inbound shipments", detail: "Confirm seashell vessels ETA and update tracker" },
{ id: 3, category: "Inventory", task: "Update raw materials reorder list", detail: "Check with partner on what needs ordering" },
{ id: 4, category: "Ads", task: "Check TACOS for each campaign", detail: "Target under 30%. Pause anything over 100% with no sales." },
{ id: 5, category: "Ads", task: "Review clicks but no sales targets", detail: "Cut any keyword that spent $3+ with zero purchases" },
{ id: 6, category: "Ads", task: "Check ROAS on active campaigns", detail: "Target above 2.5. Increase budget on anything above 3.0." },
{ id: 7, category: "Ads", task: "Review organic vs paid sales split", detail: "Goal: grow organic % month over month" },
{ id: 8, category: "Sales", task: "Compare units sold vs prior 2 weeks", detail: "Flag any SKU down more than 20%" },
{ id: 9, category: "Sales", task: "Check Shopify sales", detail: "Currently $600-1k/mo. Note any spikes tied to promotions." },
{ id: 10, category: "Growth", task: "Review Brand Analytics search terms", detail: "Look for new keywords customers are finding you with" },
{ id: 11, category: "Growth", task: "Check storefront performance", detail: "Any visits? Update seasonal imagery if needed." },
{ id: 12, category: "Growth", task: "Scrub + body care launch prep", detail: "Track manufacturing progress. Target Amazon launch in 3-4 months." },
];

const ROADMAP = [
{ month: "June 2026", items: ["Pause Broad Match campaign", "Ship 200 SeaShell Vessels to FBA", "Launch SeaShell + Sand Wax bundle campaign", "Take over operations from agency"] },
{ month: "July 2026", items: ["Optimize campaigns based on first 30 days of data", "Build negative keyword list from wasted spend", "Add more scent variants to Sand Wax if velocity improves", "Set up Make/Zapier for automated inventory sync"] },
{ month: "August 2026", items: ["Review body scrub manufacturing status", "Begin keyword research for scrub launch", "Build out Amazon storefront with full brand story", "Test Sponsored Brand video ads"] },
{ month: "Sep–Oct 2026", items: ["Launch body scrub on Amazon", "Cross-sell scrub + candle bundles", "Launch body oil, body lotion", "Begin Q4 holiday inventory planning"] },
];

const INITIAL_PROFIT = [
{ id: 1, name: "Beeswax Candle Sand 16oz", price: 26.00, referralPct: 15, evComPct: 3, fbaFulfillment: 4.15, fbaStorage: 0.50, shipping: null, cogs: null, adSpend: null, accountantNote: "" },
{ id: 2, name: "Beeswax Candle Sand 32oz", price: 46.00, referralPct: 15, evComPct: 3, fbaFulfillment: 5.20, fbaStorage: 0.80, shipping: null, cogs: null, adSpend: null, accountantNote: "" },
{ id: 3, name: "Small Apple Vanilla Candle", price: 18.99, referralPct: 15, evComPct: 3, fbaFulfillment: 3.50, fbaStorage: 0.30, shipping: null, cogs: null, adSpend: null, accountantNote: "" },
{ id: 4, name: "Large Apple Vanilla Candle", price: 59.00, referralPct: 15, evComPct: 3, fbaFulfillment: 6.50, fbaStorage: 1.00, shipping: null, cogs: null, adSpend: null, accountantNote: "" },
{ id: 6, name: "SeaShell Vessel Candle", price: null, referralPct: 15, evComPct: 3, fbaFulfillment: null, fbaStorage: null, shipping: null, cogs: null, adSpend: null, accountantNote: "Price TBD — set before launch" },
{ id: 7, name: "Sugar Scrub 8oz Tin (UPCOMING)", price: 38.00, referralPct: 15, evComPct: 3, fbaFulfillment: 4.15, fbaStorage: 0.50, shipping: null, cogs: 15.00, adSpend: null, accountantNote: "COGS $15/unit first run. Spain shipping cost TBD — add per-unit freight cost." },
{ id: 8, name: "Sugar Scrub 16oz Pouch (UPCOMING)", price: 49.00, referralPct: 15, evComPct: 3, fbaFulfillment: 4.72, fbaStorage: 0.72, shipping: null, cogs: null, adSpend: null, accountantNote: "Spain shipping cost TBD" },
{ id: 9, name: "Sugar Scrub 32oz Pouch (UPCOMING)", price: 89.60, referralPct: 15, evComPct: 3, fbaFulfillment: 6.20, fbaStorage: 1.10, shipping: null, cogs: null, adSpend: null, accountantNote: "Spain shipping cost TBD" },
];

const PRICE_PER_OZ = [
{ id: 1, category: "Candles", name: "Beeswax Candle Sand 16oz", asin: "B0GR1NWNG8", price: 26.00, oz: 16, yours: true },
{ id: 2, category: "Candles", name: "Beeswax Candle Sand 32oz", asin: "B0GR1KQ253", price: 46.00, oz: 32, yours: true },
{ id: 3, category: "Candles", name: "Small Apple Vanilla", asin: "B0FVGM15JB", price: 18.99, oz: null, yours: true },
{ id: 4, category: "Candles", name: "Large Apple Vanilla", asin: "B0FVGM15J7", price: 59.00, oz: null, yours: true },
{ id: 5, category: "Body Scrub (Upcoming)", name: "Sugar Scrub 8oz Tin", asin: "—", price: 38.00, oz: 8, yours: true },
{ id: 6, category: "Body Scrub (Upcoming)", name: "Sugar Scrub 16oz Pouch", asin: "—", price: 49.00, oz: 16, yours: true },
{ id: 7, category: "Body Scrub (Upcoming)", name: "Sugar Scrub 32oz Pouch", asin: "—", price: 89.60, oz: 32, yours: true },
{ id: 8, category: "Body Scrub (Competitor)", name: "Competitor A (16oz)", asin: "B00HSIPHD2", price: 37.95, oz: 16, yours: false },
{ id: 9, category: "Body Scrub (Competitor)", name: "Competitor B (8oz)", asin: "B07H52SVM7", price: 40.00, oz: 8.8, yours: false },
{ id: 10, category: "Body Scrub (Competitor)", name: "Competitor C (16oz)", asin: "B07JH3FLHM", price: 28.95, oz: 16, yours: false },
{ id: 11, category: "Body Scrub (Competitor)", name: "Competitor D (16oz)", asin: "B07M5PKHWX", price: 28.95, oz: 16, yours: false },
];

// ── HELPERS ──────────────────────────────────────────────────────────────────

function weeksOfSupply(available, sold30) {
if (sold30 === 0) return available > 0 ? 99 : 0;
return Math.round((available / sold30) * 4.3);
}

// Live Shopify on-hand for a product (or null if not synced)
function shopifyQty(p, shopify) {
if (shopify && shopify.items && shopify.items[p.id] !== undefined) return shopify.items[p.id];
return null;
}
// Live Shopify units sold in last 30d (or null if not synced)
function shopifySold(p, shopify) {
if (shopify && shopify.sold && shopify.sold[p.id] !== undefined) return shopify.sold[p.id];
return null;
}
// Live Amazon FBA info for a product (or null if not synced)
function amazonInfo(p, amazon) {
if (amazon && amazon.items && amazon.items[p.id]) return amazon.items[p.id];
return null;
}
// True total on-hand: live FBA (or manual fallback) + live Shopify
function effectiveStock(p, shopify, amazon) {
const az = amazonInfo(p, amazon);
const base = az ? (+az.fba || 0) : (+p.available || 0); // live FBA replaces manual when present
const sq = shopifyQty(p, shopify);
if (sq === null) return base;
if (az || (p.channels || []).includes("Amazon")) return base + sq;
return sq; // Shopify-only: the live count is the truth
}
// True 30-day units sold: live Amazon (or manual fallback) + live Shopify orders
function effectiveSold(p, shopify, amazon) {
const az = amazon && amazon.sold && amazon.sold[p.id] !== undefined ? +amazon.sold[p.id] : null;
const base = az !== null ? az : (+p.unitsSold30 || 0);
const ss = shopifySold(p, shopify);
if (ss === null) return base;
return base + ss;
}

function stockStatus(p, shopify, amazon) {
if (p.status === "inbound") return "inbound";
const stock = effectiveStock(p, shopify, amazon);
const sold = effectiveSold(p, shopify, amazon);
const min = +p.minStock || 0;
if (stock <= 0) return "out";
if (min > 0 && stock <= min) return "reorder";
const w = weeksOfSupply(stock, sold);
if (w < 6) return "low";
if (w > 50 && sold < 3) return "slow";
return "ok";
}

const STATUS_STYLE = {
out: { color: "#9b5e5e", bg: "#9b5e5e14", label: "OUT OF STOCK" },
reorder: { color: "#b06a2e", bg: "#b06a2e14", label: "REORDER NOW" },
inbound: { color: "#a07848", bg: "#a0784814", label: "INBOUND" },
low: { color: "#a07848", bg: "#a0784814", label: "LOW STOCK" },
slow: { color: "#7a7a9a", bg: "#7a7a9a14", label: "SLOW MOVER" },
ok: { color: "#5a7a5a", bg: "#5a7a5a14", label: "HEALTHY" },
};const CAMP_STYLE = {
pause: { color: "#9b5e5e", label: "PAUSE" },
keep: { color: "#5a7a5a", label: "KEEP" },
watch: { color: "#a07848", label: "WATCH" },
monitor: { color: "#7a7a9a", label: "MONITOR" },
};

function fmt(n, prefix = "$") {
if (n === null || n === undefined || n === "") return "—";
return `${prefix}${parseFloat(n).toFixed(2)}`;
}

// ── COMPONENTS ───────────────────────────────────────────────────────────────

function Tag({ color, label }) {
return <span style={{ fontSize: 10, fontFamily: "monospace", letterSpacing: 1, padding: "2px 8px", borderRadius: 1, background: color + "22", color, border: `1px solid ${color}44` }}>{label}</span>;
}

function Card({ children, style = {} }) {
return <div style={{ background: "#edeae4", border: "1px solid #3a3020", borderRadius: 1, padding: "18px 20px", ...style }}>{children}</div>;
}

function SectionTitle({ children }) {
return <div style={{ fontSize: 9, letterSpacing: 4, color: "#b0a89a", textTransform: "uppercase", marginBottom: 20, fontFamily: "monospace", fontWeight: 400 }}>{children}</div>;
}

function NumInput({ value, onChange, prefix = "$", placeholder = "Enter" }) {
return (
<input
value={value === null || value === undefined ? "" : value}
onChange={e => onChange(e.target.value === "" ? null : e.target.value)}
placeholder={placeholder}
style={{ width: 72, background: "#e5e1da", border: "1px solid #4a3f2a", borderRadius: 1, padding: "3px 6px", color: "#1a1714", fontSize: 12, textAlign: "center", fontFamily: "monospace" }}
/>
);
}

// ── TAB: INVENTORY ────────────────────────────────────────────────────────────

function InventoryTab({ products, setProducts, dbState, setDbState, shopify, onShopifySync, amazon, onAmazonSync }) {
const [editing, setEditing] = useState(null);
const [draft, setDraft] = useState({});
const [past, setPast] = useState([]);
const [future, setFuture] = useState([]);
const [channelFilter, setChannelFilter] = useState("All");
const [openVariants, setOpenVariants] = useState(null);
const [openSamples, setOpenSamples] = useState(null);

function deleteProduct(id) {
if (!window.confirm("Remove this product from the list? UNDO can restore it this session.")) return;
setPast(p => [...p, products].slice(-50));
setFuture([]);
const updated = products.filter(p => p.id !== id);
const tomb = Array.from(new Set([...(dbState.deletedProducts || []), id]));
setProducts(updated);
setDbState((prev) => { const full = { ...prev, products: updated, deletedProducts: tomb }; dbSave(full); return full; });
setEditing(null);
}

function persistProducts(updated) {
setProducts(updated);
setDbState((prev) => { const full = { ...prev, products: updated }; dbSave(full); return full; });
}

// One-click minimums: 6 weeks of cover at current velocity (live Shopify +
// manual Amazon sold/30d). Only fills blanks — never overwrites a min you set.
function suggestMins() {
setPast(p => [...p, products].slice(-50));
setFuture([]);
persistProducts(products.map(p => {
if (p.isSample) return p;
if (+p.minStock > 0) return p;
const sold = effectiveSold(p, shopify, amazon);
if (!sold) return p;
return { ...p, minStock: Math.ceil(sold * (6 / 4.3)) };
}));
}

function undo() {
if (!past.length) return;
const prev = past[past.length - 1];
setFuture(f => [...f, products].slice(-50));
setPast(p => p.slice(0, -1));
persistProducts(prev);
}

function redo() {
if (!future.length) return;
const nxt = future[future.length - 1];
setPast(p => [...p, products].slice(-50));
setFuture(f => f.slice(0, -1));
persistProducts(nxt);
}

function startEdit(p) {
setEditing(p.id);
setDraft({ name: p.name, available: p.available, inbound: p.inbound, unitsSold30: p.unitsSold30, minStock: p.minStock || 0, isSample: !!p.isSample, notes: p.notes, reorderLink: p.reorderLink || "", channels: p.channels || ["Amazon"] });
}

function saveEdit(id) {
setPast(p => [...p, products].slice(-50));
setFuture([]);
const updated = products.map(p => p.id !== id ? p : {
...p,
name: (draft.name || "").trim() || p.name,
isSample: !!draft.isSample,
available: +draft.available || 0,
inbound: +draft.inbound || 0,
unitsSold30: +draft.unitsSold30 || 0,
minStock: +draft.minStock || 0,
notes: draft.notes,
reorderLink: draft.reorderLink || "",
channels: draft.channels,
});
persistProducts(updated);
setEditing(null);
}

function toggleChannel(ch) {
setDraft(d => {
const has = d.channels.includes(ch);
const next = has ? d.channels.filter(c => c !== ch) : [...d.channels, ch];
return { ...d, channels: next.length ? next : [ch] };
});
}

const order = { out: 0, reorder: 1, low: 2, inbound: 3, slow: 4, ok: 5 };
const visible = products.filter(p => channelFilter === "All" ? true : (p.channels || ["Amazon"]).includes(channelFilter));
const sorted = [...visible].sort((a, b) => (order[stockStatus(a, shopify, amazon)] ?? 6) - (order[stockStatus(b, shopify, amazon)] ?? 6));
const reorderList = products.filter(p => { const s = stockStatus(p, shopify, amazon); return s === "out" || s === "reorder"; });
// Samples nest under their parent product as a concealed dropdown; samples
// without a living parent fall to a small section at the end.
const mainList = sorted.filter(p => !p.isSample);
const allSamples = products.filter(p => p.isSample);
const kidsOf = (id) => allSamples.filter(s => s.parentId === id);
const orphanSamples = allSamples.filter(s => !s.parentId || !products.some(pp => pp.id === s.parentId && !pp.isSample));
const displayList = [];
for (const p of mainList) {
displayList.push(p);
const kids = kidsOf(p.id);
if (kids.length) {
displayList.push({ id: "__st" + p.id, __sampleToggle: true, parentId: p.id, count: kids.length });
if (openSamples === p.id) kids.forEach(k => displayList.push({ ...k, __nested: true }));
}
}
if (orphanSamples.length) {
displayList.push({ id: "__samplehdr", __sampleHeader: true });
orphanSamples.forEach(s => displayList.push(s));
}

return (
<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
<SectionTitle>Amazon FBA Inventory</SectionTitle>
<div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
<button onClick={undo} disabled={!past.length} style={{ background: "transparent", border: "1px solid #c8c2b8", color: past.length ? "#8c7d6b" : "#c8c2b8", borderRadius: 1, padding: "4px 14px", cursor: past.length ? "pointer" : "default", fontSize: 10, fontFamily: "monospace", letterSpacing: 1 }}>UNDO</button>
<button onClick={redo} disabled={!future.length} style={{ background: "transparent", border: "1px solid #c8c2b8", color: future.length ? "#8c7d6b" : "#c8c2b8", borderRadius: 1, padding: "4px 14px", cursor: future.length ? "pointer" : "default", fontSize: 10, fontFamily: "monospace", letterSpacing: 1 }}>REDO</button>
<span style={{ fontSize: 10, color: "#b0a89a", fontFamily: "monospace" }}>{past.length ? `${past.length} change${past.length === 1 ? "" : "s"} this session` : "no changes yet"}</span>
<button onClick={suggestMins} title="Sets Min Stock to 6 weeks of cover at current sales velocity. Only fills blanks — your own minimums are never overwritten. Undo reverses it."
style={{ marginLeft: "auto", background: "transparent", border: "1px solid #a07848", color: "#a07848", borderRadius: 1, padding: "4px 14px", cursor: "pointer", fontSize: 10, fontFamily: "monospace", letterSpacing: 1 }}>SUGGEST MINS</button>
</div>
<Card style={{ borderLeft: `3px solid ${shopify && shopify.connected ? "#5a7a5a" : "#a07848"}`, padding: "12px 16px" }}>
{shopify && shopify.connected ? (
<>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
<div>
<span style={{ fontSize: 10, fontFamily: "monospace", letterSpacing: 2, color: "#5a7a5a" }}>● SHOPIFY CONNECTED · LIVE STOCK</span>
{shopify.syncedAt && <span style={{ fontSize: 10, fontFamily: "monospace", color: "#a09488", marginLeft: 10 }}>synced {new Date(shopify.syncedAt).toLocaleTimeString()}</span>}
<div style={{ fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 2, fontFamily: "'IM Fell English', Georgia, serif" }}>Shopify conectado — inventario en vivo en cada producto</div>
</div>
<button onClick={() => { onShopifySync(); if (onAmazonSync) onAmazonSync(); }} disabled={shopify.syncing || (amazon && amazon.syncing)} style={{ background: "#e5e1da", border: "1px solid #4a3f2a", color: "#5a7a5a", borderRadius: 1, padding: "5px 14px", cursor: (shopify.syncing || (amazon && amazon.syncing)) ? "default" : "pointer", fontSize: 10, fontFamily: "monospace", letterSpacing: 1 }}>{(shopify.syncing || (amazon && amazon.syncing)) ? "SYNCING…" : "SYNC NOW"}</button>
</div>
<div style={{ marginTop: 6, fontSize: 10, fontFamily: "monospace", letterSpacing: 2, color: amazon && amazon.connected ? "#5a7a5a" : "#a07848" }}>
{amazon && amazon.connected ? "● AMAZON SP-API · LIVE FBA" : "○ AMAZON SP-API NOT CONNECTED"}
{amazon && amazon.syncedAt ? <span style={{ letterSpacing: 0, color: "#8c7d6b" }}> · synced {new Date(amazon.syncedAt).toLocaleTimeString()}</span> : null}
</div>
{amazon && amazon.unmatchedSkus && amazon.unmatchedSkus.length > 0 && (
<div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid #0000000d" }}>
<div style={{ fontSize: 9, fontFamily: "monospace", letterSpacing: 2, color: "#a07848", marginBottom: 4 }}>⚠ AMAZON SKUS NOT YET MAPPED</div>
{amazon.unmatchedSkus.map((u, i) => (
<div key={"az" + i} style={{ fontSize: 11, color: "#8c7d6b", fontFamily: "monospace" }}>· {u.sku} — {u.qty} units</div>
))}
</div>
)}
{((shopify.unmatched && shopify.unmatched.length > 0) || (shopify.soldUnmatched && shopify.soldUnmatched.length > 0)) && (
<div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #0000000d" }}>
<div style={{ fontSize: 9, fontFamily: "monospace", letterSpacing: 2, color: "#a07848", marginBottom: 4 }}>⚠ SHOPIFY PRODUCTS NOT YET MAPPED TO THIS APP</div>
{(shopify.unmatched || []).map((u, i) => (
<div key={"u" + i} style={{ fontSize: 11, color: "#8c7d6b", fontFamily: "monospace" }}>· {u.title} — {u.qty} in stock</div>
))}
{(shopify.soldUnmatched || []).map((u, i) => (
<div key={"s" + i} style={{ fontSize: 11, color: "#8c7d6b", fontFamily: "monospace" }}>· {u.title} — {u.qty} sold/30d</div>
))}
<div style={{ fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 4, fontFamily: "'IM Fell English', Georgia, serif" }}>Estos títulos de Shopify aún no están enlazados a un producto del app — compártelos con Claude para mapearlos.</div>
</div>
)}
</>
) : (
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
<div>
<span style={{ fontSize: 10, fontFamily: "monospace", letterSpacing: 2, color: "#a07848" }}>○ SHOPIFY NOT CONNECTED</span>
<div style={{ fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 2, fontFamily: "'IM Fell English', Georgia, serif" }}>Conecta Shopify para ver el inventario en vivo de tu tienda</div>
</div>
<a href="/api/shopify-auth" style={{ background: "#1a1714", color: "#f7f4ef", borderRadius: 1, padding: "6px 16px", fontSize: 10, fontFamily: "monospace", letterSpacing: 1, textDecoration: "none" }}>CONNECT SHOPIFY</a>
</div>
)}
</Card>
<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
{["All", "Amazon", "Shopify", "B2B"].map(ch => (
<button key={ch} onClick={() => setChannelFilter(ch)} style={{ padding: "5px 16px", fontSize: 10, fontFamily: "monospace", letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: `1px solid ${channelFilter === ch ? "#1a1714" : "#c8c2b8"}`, background: channelFilter === ch ? "#1a1714" : "transparent", color: channelFilter === ch ? "#f7f4ef" : "#8c7d6b" }}>{ch.toUpperCase()}</button>
))}
</div>
{reorderList.length > 0 && (
<Card style={{ borderLeft: "3px solid #b06a2e", background: "#b06a2e10" }}>
<div style={{ fontSize: 10, fontFamily: "monospace", letterSpacing: 2, color: "#b06a2e" }}>⚠ REORDER NEEDED · {reorderList.length}</div>
<div style={{ fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 2, marginBottom: 10, fontFamily: "'IM Fell English', Georgia, serif" }}>Productos agotados o en/bajo su umbral mínimo</div>
<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
{reorderList.map(p => {
const stock = effectiveStock(p, shopify, amazon);
const min = +p.minStock || 0;
const need = min > 0 ? Math.max(min * 2 - stock, min) : null;
return (
<div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: "1px solid #0000000d", paddingTop: 6 }}>
<div style={{ fontSize: 13, color: "#1a1714", fontFamily: "'IM Fell English', Georgia, serif" }}>{p.name}
<span style={{ fontSize: 10, color: "#a09488", fontFamily: "monospace", marginLeft: 8 }}>{stock} on hand{min > 0 ? ` · min ${min}` : " · set a min in Edit"}{need ? ` · suggest +${need}` : ""}</span>
</div>
{p.reorderLink && p.reorderLink.trim() !== "" ? (
<a href={p.reorderLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontFamily: "monospace", letterSpacing: 1, color: "#b06a2e", textDecoration: "none", border: "1px solid #b06a2e40", borderRadius: 1, padding: "3px 10px" }}>↗ REORDER</a>
) : (
<span style={{ fontSize: 9, color: "#a09488", fontFamily: "monospace" }}>add link in Edit</span>
)}
</div>
);
})}
</div>
</Card>
)}
{displayList.map(p => {
if (p.__sampleToggle) return (
<div key={p.id} onClick={() => setOpenSamples(openSamples === p.parentId ? null : p.parentId)}
style={{ cursor: "pointer", marginLeft: 24, marginTop: -4, fontSize: 10, fontFamily: "monospace", letterSpacing: 1, color: "#a09488" }}>
{openSamples === p.parentId ? "▾" : "▸"} {p.count} SAMPLE{p.count === 1 ? "" : "S"} / TESTER{p.count === 1 ? "" : "S"}
</div>
);
if (p.__sampleHeader) return (
<div key="__samplehdr" style={{ marginTop: 16, paddingTop: 10, borderTop: "1px solid #ddd8d0" }}>
<div style={{ fontSize: 9, letterSpacing: 4, color: "#b0a89a", textTransform: "uppercase", fontFamily: "monospace" }}>Samples / Testers</div>
<div style={{ fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 2, fontFamily: "'IM Fell English', Georgia, serif" }}>Muestras sin producto padre asignado</div>
</div>
);
const st = stockStatus(p, shopify, amazon);
const { color, bg, label } = STATUS_STYLE[st];
const weeks = weeksOfSupply(effectiveStock(p, shopify, amazon), effectiveSold(p, shopify, amazon));
const isEditing = editing === p.id;
return (
<Card key={p.id} style={{ borderLeft: `3px solid ${color}`, background: bg, marginLeft: p.__nested ? 24 : 0 }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
<div style={{ flex: 1, minWidth: 200 }}>
<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
<span style={{ fontFamily: "'IM Fell English', Georgia, serif", fontSize: 15, color: "#1a1714" }}>{p.name}</span>
<Tag color={color} label={label} />
</div>
<div style={{ fontSize: 11, color: "#a09488", fontFamily: "monospace", marginBottom: 6 }}>{p.sku}{p.asin ? ` · ${p.asin}` : ""}</div>
<div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
{(p.channels || ["Amazon"]).map(ch => (
<span key={ch} style={{ fontSize: 9, fontFamily: "monospace", letterSpacing: 1.5, padding: "2px 8px", background: ch === "Amazon" ? "#a0784814" : ch === "Shopify" ? "#5a7a5a14" : "#7a7a9a14", color: ch === "Amazon" ? "#a07848" : ch === "Shopify" ? "#5a7a5a" : "#7a7a9a", border: `1px solid ${ch === "Amazon" ? "#a0784830" : ch === "Shopify" ? "#5a7a5a30" : "#7a7a9a30"}` }}>
{ch.toUpperCase()}
</span>
))}
</div>
{p.notes && <div style={{ fontSize: 12, color: "#8c7d6b", fontStyle: "italic", marginBottom: 8 }}>{p.notes}</div>}
{p.reorderLink && p.reorderLink.trim() !== "" && <a href={p.reorderLink} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginBottom: 8, fontSize: 10, fontFamily: "monospace", letterSpacing: 1, color: "#5a7a5a", textDecoration: "none", border: "1px solid #5a7a5a40", borderRadius: 1, padding: "3px 10px" }}>↗ REORDER</a>}
{(() => {
const sv = shopify && shopify.variantDetail && shopify.variantDetail[p.id] && shopify.variantDetail[p.id].length > 0 ? shopify.variantDetail[p.id] : null;
const ak = amazon && amazon.skuDetail && amazon.skuDetail[p.id] && amazon.skuDetail[p.id].length > 0 ? amazon.skuDetail[p.id] : null;
if (!sv && !ak) return null;
const count = (sv ? sv.length : 0) + (ak ? ak.length : 0);
return (
<div style={{ marginBottom: 8 }}>
<div onClick={() => setOpenVariants(openVariants === p.id ? null : p.id)} style={{ cursor: "pointer", fontSize: 10, fontFamily: "monospace", letterSpacing: 1, color: "#5a7a5a", display: "inline-block" }}>
{openVariants === p.id ? "▾" : "▸"} {count} LIVE DETAIL{count === 1 ? "" : "S"}
</div>
{openVariants === p.id && (
<div style={{ marginTop: 6, borderLeft: "2px solid #5a7a5a40", paddingLeft: 10 }}>
{sv && sv.map((v, i) => (
<div key={"s" + i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, fontFamily: "monospace", color: "#8c7d6b", padding: "2px 0", borderBottom: "1px solid #00000008" }}>
<span>SHOPIFY · {v.name}</span>
<span>{v.qty} in stock{v.sold ? ` · ${v.sold} sold/30d` : ""}{v.ugc ? ` · ${v.ugc} ugc` : ""}</span>
</div>
))}
{ak && ak.map((v, i) => (
<div key={"a" + i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, fontFamily: "monospace", color: "#8c7d6b", padding: "2px 0", borderBottom: "1px solid #00000008" }}>
<span>FBA · {v.sku}</span>
<span>{v.fba} in FBA{v.inbound ? ` · ${v.inbound} inbound` : ""}{v.sold ? ` · ${v.sold} sold/30d` : ""}</span>
</div>
))}
</div>
)}
</div>
);
})()}
<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
<div style={{ flex: 1, height: 4, background: "#e5e1da", borderRadius: 1 }}>
<div style={{ width: `${Math.min((weeks / 26) * 100, 100)}%`, height: "100%", background: color, borderRadius: 1 }} />
</div>
<span style={{ fontSize: 12, color, fontFamily: "monospace", minWidth: 40 }}>{weeks === 0 ? "—" : weeks > 99 ? "99+w" : `${weeks}w`}</span>
</div>
</div>
<div>
{isEditing ? (
<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
<div>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Product Name</div>
<input value={draft.name || ""} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
style={{ width: "100%", boxSizing: "border-box", background: "#e5e1da", border: "1px solid #4a3f2a", borderRadius: 1, padding: "5px 8px", color: "#1a1714", fontSize: 13, fontFamily: "'IM Fell English', Georgia, serif" }} />
</div>
<div style={{ display: "flex", gap: 8 }}>
{[["available", "On Hand"], ["inbound", "Inbound"], ["unitsSold30", "Sold/30d"], ["minStock", "Min Stock"]].map(([f, l]) => (
<div key={f}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{l}</div>
<input value={draft[f]} onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
style={{ width: 56, background: "#e5e1da", border: "1px solid #4a3f2a", borderRadius: 1, padding: "4px 6px", color: "#1a1714", fontSize: 13, textAlign: "center", fontFamily: "monospace" }} />
</div>
))}
</div>
<textarea value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} rows={2}
style={{ width: "100%", background: "#e5e1da", border: "1px solid #4a3f2a", borderRadius: 1, padding: "6px 8px", color: "#8c7d6b", fontSize: 11, fontFamily: "monospace", resize: "none" }} />
<div>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Reorder Link (supplier / Amazon URL)</div>
<input value={draft.reorderLink || ""} onChange={e => setDraft(d => ({ ...d, reorderLink: e.target.value }))} placeholder="https://..."
style={{ width: "100%", boxSizing: "border-box", background: "#e5e1da", border: "1px solid #4a3f2a", borderRadius: 1, padding: "5px 8px", color: "#1a1714", fontSize: 11, fontFamily: "monospace" }} />
</div>
<div style={{ marginBottom: 4 }}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace", marginBottom: 6 }}>Sold On</div>
<div style={{ display: "flex", gap: 8 }}>
{["Amazon", "Shopify", "B2B"].map(ch => (
<div key={ch} onClick={() => toggleChannel(ch)} style={{ cursor: "pointer", padding: "4px 12px", fontSize: 10, fontFamily: "monospace", letterSpacing: 1, border: `1px solid ${draft.channels && draft.channels.includes(ch) ? (ch === "Amazon" ? "#a07848" : "#5a7a5a") : "#c8c2b8"}`, color: draft.channels && draft.channels.includes(ch) ? (ch === "Amazon" ? "#a07848" : "#5a7a5a") : "#a09488", background: draft.channels && draft.channels.includes(ch) ? (ch === "Amazon" ? "#a0784814" : "#5a7a5a14") : "transparent" }}>
{ch}
</div>
))}
</div>
</div>
<div onClick={() => setDraft(d => ({ ...d, isSample: !d.isSample }))} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
<span style={{ width: 11, height: 11, border: "1px solid #4a3f2a", background: draft.isSample ? "#a07848" : "transparent", display: "inline-block" }} />
<span style={{ fontSize: 9, fontFamily: "monospace", letterSpacing: 1, color: "#8c7d6b" }}>SAMPLE / TESTER — concealed under its parent product</span>
</div>
<div style={{ display: "flex", gap: 6 }}>
<button onClick={() => saveEdit(p.id)} style={{ flex: 1, background: "#1a1714", color: "#f7f4ef", border: "none", borderRadius: 1, padding: "6px 0", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Save</button>
<button onClick={() => setEditing(null)} style={{ flex: 1, background: "#e5e1da", color: "#9c8d7b", border: "1px solid #4a3f2a", borderRadius: 1, padding: "6px 0", cursor: "pointer", fontSize: 12 }}>Cancel</button>
<button onClick={() => deleteProduct(p.id)} style={{ background: "transparent", color: "#9b5e5e", border: "1px solid #9b5e5e40", borderRadius: 1, padding: "6px 12px", cursor: "pointer", fontSize: 11 }}>Delete</button>
</div>
</div>
) : (
<div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{[...(amazonInfo(p, amazon) ? [["FBA", amazonInfo(p, amazon).fba], ["Inbound", amazonInfo(p, amazon).inbound]] : [["On Hand", p.available], ["Inbound", p.inbound]]), ["Sold/30d", effectiveSold(p, shopify, amazon)], ["Min", p.minStock || 0], ...(shopify && shopify.items && shopify.items[p.id] !== undefined ? [["Shopify", shopify.items[p.id]]] : []), ...(shopify && shopify.ugc && shopify.ugc[p.id] ? [["UGC/Mktg", shopify.ugc[p.id]]] : [])].map(([l, v]) => (
<div key={l} style={{ textAlign: "center" }}>
<div style={{ fontSize: 18, fontWeight: 700, color: "#1a1714", fontFamily: "monospace" }}>{v}</div>
<div style={{ fontSize: 9, color: "#a09488", letterSpacing: 0.5, textTransform: "uppercase" }}>{l}</div>
</div>
))}
<button onClick={() => startEdit(p)} style={{ background: "#e5e1da", border: "1px solid #4a3f2a", color: "#9c8d7b", borderRadius: 1, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>Edit</button>
</div>
)}
</div>
</div>
</Card>
);
})}
</div>
);
}

// ── TAB: ADS ─────────────────────────────────────────────────────────────────

function AdsTab({ campaigns }) {
const totalSpend = campaigns.reduce((s, c) => s + c.spend7d, 0);
const totalSales = campaigns.reduce((s, c) => s + c.sales7d, 0);
const overallTacos = totalSales > 0 ? ((totalSpend / totalSales) * 100).toFixed(0) : "—";

return (
<div>
<SectionTitle>Campaign Performance · Last 7 Days</SectionTitle>
<div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
{[
{ label: "Total Ad Spend", value: `$${totalSpend.toFixed(2)}`, color: "#a07848" },
{ label: "Total Ad Sales", value: `$${totalSales.toFixed(2)}`, color: "#5a7a5a" },
{ label: "Overall TACOS", value: `${overallTacos}%`, color: overallTacos > 30 ? "#9b5e5e" : "#5a7a5a" },
].map(s => (
<Card key={s.label} style={{ flex: 1, minWidth: 120, textAlign: "center", padding: "14px 10px" }}>
<div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
<div style={{ fontSize: 10, color: "#a09488", letterSpacing: 1, textTransform: "uppercase", marginTop: 4 }}>{s.label}</div>
</Card>
))}
</div>
<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
{campaigns.map(c => {
const { color, label } = CAMP_STYLE[c.status];
return (
<Card key={c.id} style={{ borderLeft: `3px solid ${color}` }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
<div style={{ flex: 1 }}>
<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
<span style={{ fontFamily: "monospace", fontSize: 13, color: "#1a1714" }}>{c.name}</span>
<Tag color={color} label={label} />
</div>
<div style={{ fontSize: 12, color: "#8c7d6b", fontStyle: "italic" }}>{c.recommendation}</div>
</div>
<div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
{[["Budget", `$${c.budget}/d`], ["Spend 7d", `$${c.spend7d}`], ["Sales 7d", `$${c.sales7d}`], ["ROAS", c.roas || "—"]].map(([l, v]) => (
<div key={l} style={{ textAlign: "center" }}>
<div style={{ fontSize: 15, fontWeight: 700, color: "#1a1714", fontFamily: "monospace" }}>{v}</div>
<div style={{ fontSize: 9, color: "#a09488", letterSpacing: 0.5, textTransform: "uppercase" }}>{l}</div>
</div>
))}
</div>
</div>
</Card>
);
})}
</div>
<Card style={{ marginTop: 16, borderLeft: "3px solid #8b8bff" }}>
<div style={{ fontSize: 12, color: "#7a7a9a", fontFamily: "monospace", marginBottom: 8 }}>IMMEDIATE ACTION</div>
<div style={{ fontSize: 13, color: "#5a5550", lineHeight: 1.6 }}>
Pause "Broad Match Expansion" today — $62.97 spent this week with zero purchases. Reallocate that $5/day to H10 High Search Volume (ROAS 2.50).
</div>
</Card>
</div>
);
}

// ── TAB: PROFIT MATRIX ────────────────────────────────────────────────────────

function ProfitTab() {
const [rows, setRows] = useState(INITIAL_PROFIT);
const [editing, setEditing] = useState(null);

function update(id, field, val) {
setRows(prev => prev.map(r => r.id !== id ? r : { ...r, [field]: val }));
}

function calcProfit(r) {
if (!r.price || !r.cogs) return null;
const price = parseFloat(r.price);
const referral = price * (r.referralPct / 100);
const evCom = price * (r.evComPct / 100);
const fba = parseFloat(r.fbaFulfillment || 0);
const storage = parseFloat(r.fbaStorage || 0);
const ship = parseFloat(r.shipping || 0);
const cogs = parseFloat(r.cogs || 0);
const ads = parseFloat(r.adSpend || 0);
const totalFees = referral + evCom + fba + storage + ship;
const profit = price - totalFees - cogs - ads;
const margin = ((profit / price) * 100).toFixed(1);
return { profit: profit.toFixed(2), margin, totalFees: totalFees.toFixed(2) };
}

const upcoming = rows.filter(r => r.name.includes("UPCOMING"));
const current = rows.filter(r => !r.name.includes("UPCOMING"));

return (
<div>
<SectionTitle>Profit Matrix · For Accountant Review</SectionTitle>
<Card style={{ borderLeft: "3px solid #f5a623", marginBottom: 20 }}>
<div style={{ fontSize: 12, color: "#a07848", fontFamily: "monospace", marginBottom: 6 }}>ACCOUNTANT NOTE</div><div style={{ fontSize: 13, color: "#5a5550", lineHeight: 1.6 }}>
Amazon fees (15% referral + 3% EV commission) and FBA fulfillment/storage are pre-filled based on Amazon's fee schedule. Please fill in: <strong style={{ color: "#1a1714" }}>COGS per unit, per-unit shipping cost, and estimated ad spend per unit</strong> for each product. Scrub products need Spain freight cost divided by units per shipment.
</div>
</Card>

{[{ label: "Current Products", data: current }, { label: "Upcoming Products", data: upcoming }].map(section => (
<div key={section.label} style={{ marginBottom: 24 }}>
<div style={{ fontSize: 11, color: "#9c8d7b", letterSpacing: 2, textTransform: "uppercase", fontFamily: "monospace", marginBottom: 12 }}>{section.label}</div>
<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
{section.data.map(r => {
const calc = calcProfit(r);
const isEditing = editing === r.id;
return (
<Card key={r.id} style={{ borderLeft: `3px solid ${calc ? (parseFloat(calc.margin) > 20 ? "#5a7a5a" : "#a07848") : "#c8c2b8"}` }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
<div style={{ flex: 1, minWidth: 160 }}>
<div style={{ fontSize: 14, color: "#1a1714", fontFamily: "'IM Fell English', Georgia, serif", marginBottom: 4 }}>{r.name.replace(" (UPCOMING)", "")}</div>
{r.accountantNote && <div style={{ fontSize: 11, color: "#a07848", fontStyle: "italic", marginBottom: 6 }}>{r.accountantNote}</div>}
<div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
{[
["List Price", fmt(r.price)],
["Amazon Fees", calc ? fmt(calc.totalFees) : "—"],
["COGS", fmt(r.cogs)],
["Shipping", fmt(r.shipping)],
["Ad Spend", fmt(r.adSpend)],
].map(([l, v]) => (
<div key={l} style={{ textAlign: "center" }}>
<div style={{ fontSize: 13, color: v === "—" ? "#c8c2b8" : "#1a1714", fontFamily: "monospace" }}>{v}</div>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div>
</div>
))}
{calc && (
<>
<div style={{ textAlign: "center" }}>
<div style={{ fontSize: 13, color: parseFloat(calc.profit) > 0 ? "#5a7a5a" : "#9b5e5e", fontFamily: "monospace", fontWeight: 700 }}>{fmt(calc.profit)}</div>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 0.5 }}>Est. Profit</div>
</div>
<div style={{ textAlign: "center" }}>
<div style={{ fontSize: 13, color: parseFloat(calc.margin) > 20 ? "#5a7a5a" : "#a07848", fontFamily: "monospace", fontWeight: 700 }}>{calc.margin}%</div>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 0.5 }}>Margin</div>
</div></>
)}
</div>
</div>
<div>
{isEditing ? (
<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
{[["price", "List Price"], ["cogs", "COGS/unit"], ["shipping", "Ship/unit"], ["adSpend", "Ad/unit"]].map(([f, l]) => (
<div key={f}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{l}</div>
<NumInput value={r[f]} onChange={val => update(r.id, f, val)} />
</div>
))}
</div>
<input value={r.accountantNote} onChange={e => update(r.id, "accountantNote", e.target.value)} placeholder="Notes..."
style={{ width: "100%", background: "#e5e1da", border: "1px solid #4a3f2a", borderRadius: 1, padding: "5px 8px", color: "#8c7d6b", fontSize: 11, fontFamily: "monospace" }} />
<button onClick={() => setEditing(null)} style={{ background: "#1a1714", color: "#f7f4ef", border: "none", borderRadius: 1, padding: "6px 0", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Done</button>
</div>
) : (
<button onClick={() => setEditing(r.id)} style={{ background: "#e5e1da", border: "1px solid #4a3f2a", color: "#9c8d7b", borderRadius: 1, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>
{r.cogs ? "Edit" : "Fill In"}
</button>
)}
</div>
</div>
</Card>
);
})}
</div>
</div>
))}
</div>
);
}

// ── TAB: PRICE PER OZ ────────────────────────────────────────────────────────

function PriceOzTab() {
const [rows, setRows] = useState(PRICE_PER_OZ);
const categories = [...new Set(rows.map(r => r.category))];

function pricePerOz(r) {
if (!r.oz || !r.price) return null;
return (r.price / r.oz).toFixed(2);
}

return (
<div>
<SectionTitle>Price Per Oz · Positioning Analysis</SectionTitle>
<Card style={{ borderLeft: "3px solid #8b8bff", marginBottom: 20 }}>
<div style={{ fontSize: 12, color: "#7a7a9a", fontFamily: "monospace", marginBottom: 6 }}>WHY THIS MATTERS</div>
<div style={{ fontSize: 13, color: "#5a5550", lineHeight: 1.6 }}>
Your Sugar Scrub 8oz Tin at $38 = <strong style={{ color: "#1a1714" }}>$4.75/oz</strong> — premium positioning vs competitors at $1.81–$2.37/oz. This is defensible if your branding and ingredients story is strong. The 32oz pouch at $89.60 = $2.80/oz is more competitive.
</div>
</Card>
{categories.map(cat => (
<div key={cat} style={{ marginBottom: 20 }}>
<div style={{ fontSize: 11, color: "#9c8d7b", letterSpacing: 2, textTransform: "uppercase", fontFamily: "monospace", marginBottom: 10 }}>{cat}</div>
<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
{rows.filter(r => r.category === cat).sort((a, b) => (pricePerOz(b) || 0) - (pricePerOz(a) || 0)).map(r => {
const ppoz = pricePerOz(r);
const color = r.yours ? "#8c7d6b" : "#a09488";
return (
<div key={r.id} style={{ background: "#edeae4", border: `1px solid ${r.yours ? "#c8c2b8" : "#e5e1da"}`, borderLeft: `3px solid ${r.yours ? "#8c7d6b" : "#d4cfc7"}`, borderRadius: 1, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
<div>
<div style={{ fontSize: 13, color: r.yours ? "#1a1714" : "#9c8d7b", fontFamily: "'IM Fell English', Georgia, serif" }}>
{r.name} {r.yours && <span style={{ fontSize: 10, color: "#8c7d6b", fontFamily: "monospace" }}>YOU</span>}
</div>
<div style={{ fontSize: 10, color: "#a09488", fontFamily: "monospace", marginTop: 2 }}>{r.asin}</div>
</div>
<div style={{ display: "flex", gap: 16, alignItems: "center" }}>
<div style={{ textAlign: "center" }}>
<div style={{ fontSize: 14, color: "#1a1714", fontFamily: "monospace" }}>{fmt(r.price)}</div>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 0.5 }}>Price</div>
</div>
<div style={{ textAlign: "center" }}>
<div style={{ fontSize: 14, color: "#5a5550", fontFamily: "monospace" }}>{r.oz ? `${r.oz}oz` : "—"}</div>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 0.5 }}>Size</div>
</div>
<div style={{ textAlign: "center", minWidth: 60 }}>
<div style={{ fontSize: 16, fontWeight: 700, color: ppoz ? color : "#c8c2b8", fontFamily: "monospace" }}>{ppoz ? `$${ppoz}` : "—"}</div>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 0.5 }}>/oz</div>
</div>
</div>
</div>
);
})}
</div>
</div>
))}
</div>
);
}

// ── TAB: WEEKLY SNAPSHOT ──────────────────────────────────────────────────────

const BLANK_WEEK = { date: "", units: "", revenue: "", adSpend: "", adSales: "", organicSales: "", sessions: "", notes: "" };

function WeeklyTab({ weeks, setWeeks, dbState, setDbState }) {
const [adding, setAdding] = useState(false);
const [draft, setDraft] = useState(BLANK_WEEK);

function saveWeek() {
if (!draft.date) return;
setWeeks(prev => {
const updated = [{ ...draft, id: Date.now() }, ...prev];
setDbState((prev) => { const full = { ...prev, weekly: updated }; dbSave(full); return full; });
return updated;
});
setDraft(BLANK_WEEK);
setAdding(false);
}

function tacos(w) {
if (!w.adSpend || !w.revenue) return null;
return ((parseFloat(w.adSpend) / parseFloat(w.revenue)) * 100).toFixed(0);
}

return (
<div>
<SectionTitle>Weekly Numbers · Enter Each Monday</SectionTitle>
<Card style={{ borderLeft: "3px solid #a89060", marginBottom: 20 }}>
<div style={{ fontSize: 12, color: "#8c7d6b", fontFamily: "monospace", marginBottom: 6 }}>HOW TO USE</div>
<div style={{ fontSize: 13, color: "#5a5550", lineHeight: 1.6 }}>
Every Monday, pull your weekly numbers from Amazon Seller Central → Reports → Business Reports. Takes 5 minutes. Paste in below to track trends over time.
</div>
</Card>

{adding ? (
<Card style={{ borderLeft: "3px solid #30d158", marginBottom: 16 }}>
<div style={{ fontSize: 12, color: "#5a7a5a", fontFamily: "monospace", marginBottom: 12 }}>NEW WEEK ENTRY</div>
<div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
{[["date","Week of (date)","text"], ["units","Units Sold","number"], ["revenue","Total Revenue $","number"], ["adSpend","Ad Spend $","number"], ["adSales","Ad Sales $","number"], ["organicSales","Organic Sales $","number"], ["sessions","Sessions","number"]].map(([f, l, t]) => (
<div key={f}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{l}</div>
<input type={t} value={draft[f]} onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
style={{ width: t === "text" ? 110 : 80, background: "#e5e1da", border: "1px solid #4a3f2a", borderRadius: 1, padding: "4px 8px", color: "#1a1714", fontSize: 12, fontFamily: "monospace" }} />
</div>
))}
</div>
<input value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Notes (promotions, stockouts, anything unusual)..."
style={{ width: "100%", background: "#e5e1da", border: "1px solid #4a3f2a", borderRadius: 1, padding: "6px 10px", color: "#8c7d6b", fontSize: 12, fontFamily: "monospace", marginBottom: 10 }} />
<div style={{ display: "flex", gap: 8 }}>
<button onClick={saveWeek} style={{ background: "#1a1714", color: "#f7f4ef", border: "none", borderRadius: 1, padding: "7px 20px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Save Week</button>
<button onClick={() => setAdding(false)} style={{ background: "#e5e1da", color: "#9c8d7b", border: "1px solid #4a3f2a", borderRadius: 1, padding: "7px 16px", cursor: "pointer", fontSize: 12 }}>Cancel</button>
</div>
</Card>) : (
<button onClick={() => setAdding(true)} style={{ background: "#e5e1da", border: "1px dashed #4a3f2a", color: "#9c8d7b", borderRadius: 1, padding: "10px 20px", cursor: "pointer", fontSize: 12, fontFamily: "monospace", letterSpacing: 1, marginBottom: 16, width: "100%" }}>
+ ADD THIS WEEK'S NUMBERS
</button>
)}

{weeks.length === 0 && !adding && (
<Card style={{ textAlign: "center", padding: "32px 20px" }}>
<div style={{ fontSize: 13, color: "#c8c2b8", fontFamily: "monospace" }}>No weekly data yet. Add your first entry above.</div></Card>
)}

<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
{weeks.map((w, i) => {
const t = tacos(w);
const prevWeek = weeks[i + 1];
const revChange = prevWeek && w.revenue && prevWeek.revenue
? (((parseFloat(w.revenue) - parseFloat(prevWeek.revenue)) / parseFloat(prevWeek.revenue)) * 100).toFixed(0)
: null;
return (
<Card key={w.id} style={{ borderLeft: `3px solid ${i === 0 ? "#8c7d6b" : "#d4cfc7"}` }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
<div>
<div style={{ fontSize: 13, color: "#1a1714", fontFamily: "monospace", marginBottom: 4 }}>Week of {w.date}</div>
{w.notes && <div style={{ fontSize: 11, color: "#8c7d6b", fontStyle: "italic" }}>{w.notes}</div>}
</div>
<div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
{[
["Revenue", w.revenue ? `$${w.revenue}` : "—", revChange ? (revChange > 0 ? "#5a7a5a" : "#9b5e5e") : "#1a1714"],
["Units", w.units || "—", "#1a1714"],
["Ad Spend", w.adSpend ? `$${w.adSpend}` : "—", "#a07848"],
["TACOS", t ? `${t}%` : "—", t ? (t < 30 ? "#5a7a5a" : t < 60 ? "#a07848" : "#9b5e5e") : "#1a1714"],
["Sessions", w.sessions || "—", "#7a7a9a"],
].map(([l, v, c]) => (
<div key={l} style={{ textAlign: "center" }}>
<div style={{ fontSize: 15, fontWeight: 700, color: c, fontFamily: "monospace" }}>{v}</div>
{l === "Revenue" && revChange && <div style={{ fontSize: 9, color: parseFloat(revChange) > 0 ? "#5a7a5a" : "#9b5e5e" }}>{revChange > 0 ? "+" : ""}{revChange}% vs prior</div>}
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div>
</div>
))}
</div>
</div>
</Card>
);
})}
</div>
</div>
);
}

// ── TAB: CHECKLIST ────────────────────────────────────────────────────────────

function ChecklistTab() {
const [checked, setChecked] = useState({});
const [lastRun, setLastRun] = useState(null);
const categories = [...new Set(CHECKLIST_ITEMS.map(i => i.category))];
const allDone = CHECKLIST_ITEMS.every(i => checked[i.id]);

function toggle(id) { setChecked(p => ({ ...p, [id]: !p[id] })); }
function reset() { setChecked({}); setLastRun(new Date().toLocaleDateString()); }

return (
<div>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
<SectionTitle>Bi-Weekly Review Checklist</SectionTitle>
<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
{lastRun && <span style={{ fontSize: 11, color: "#a09488", fontFamily: "monospace" }}>Last: {lastRun}</span>}
<button onClick={reset} style={{ background: "#e5e1da", border: "1px solid #4a3f2a", color: "#9c8d7b", borderRadius: 1, padding: "5px 12px", cursor: "pointer", fontSize: 11 }}>Reset</button>
</div>
</div>
{allDone && <Card style={{ borderLeft: "3px solid #30d158", marginBottom: 16 }}><div style={{ color: "#5a7a5a", fontFamily: "monospace", fontSize: 13 }}>All done! Come back in 2 weeks.</div></Card>}
{categories.map(cat => (
<div key={cat} style={{ marginBottom: 20 }}>
<div style={{ fontSize: 11, color: "#9c8d7b", letterSpacing: 2, textTransform: "uppercase", fontFamily: "monospace", marginBottom: 10, paddingLeft: 4 }}>{cat}</div>
<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
{CHECKLIST_ITEMS.filter(i => i.category === cat).map(item => (
<div key={item.id} onClick={() => toggle(item.id)} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: checked[item.id] ? "#eae8e3" : "#edeae4", border: `1px solid ${checked[item.id] ? "#30d15840" : "#d4cfc7"}`, borderRadius: 1, padding: "12px 14px", cursor: "pointer" }}>
<div style={{ width: 18, height: 18, borderRadius: 1, border: `1px solid ${checked[item.id] ? "#1a1714" : "#c8c2b8"}`, background: checked[item.id] ? "#1a1714" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
{checked[item.id] && <span style={{ color: "#f7f4ef", fontSize: 11, fontWeight: 400 }}>✓</span>}
</div>
<div>
<div style={{ fontSize: 13, color: checked[item.id] ? "#a09488" : "#1a1714", textDecoration: checked[item.id] ? "line-through" : "none", fontFamily: "'IM Fell English', Georgia, serif" }}>{item.task}</div>
<div style={{ fontSize: 11, color: "#a09488", marginTop: 3 }}>{item.detail}</div>
</div>
</div>
))}
</div>
</div>
))}
</div>
);
}

// ── TAB: MATERIALS ────────────────────────────────────────────────────────────

function MaterialsTab({ materials, setMaterials, dbState, setDbState }) {
const [editId, setEditId] = useState(null);
const [draft, setDraft] = useState({});
const [past, setPast] = useState([]);
const [future, setFuture] = useState([]);

const urgentItems = materials.filter(m => m.status === "out" || m.status === "reorder");
const allocatedTotal = urgentItems.reduce((s, m) => s + (parseFloat(m.estCost) || 0), 0);
const remaining = WEEKLY_BUDGET - allocatedTotal;

function persistMaterials(updated) {
setMaterials(updated);
setDbState((prev) => { const full = { ...prev, materials: updated }; dbSave(full); return full; });
}

function recordHistory() {
setPast(p => [...p, materials].slice(-50));
setFuture([]);
}

function undo() {
if (!past.length) return;
const prev = past[past.length - 1];
setFuture(f => [...f, materials].slice(-50));
setPast(p => p.slice(0, -1));
persistMaterials(prev);
}

function redo() {
if (!future.length) return;
const nxt = future[future.length - 1];
setPast(p => [...p, materials].slice(-50));
setFuture(f => f.slice(0, -1));
persistMaterials(nxt);
}

function toggleStatus(id) {
recordHistory();
persistMaterials(materials.map(m => m.id !== id ? m : {
...m, status: m.status === "ok" ? "reorder" : m.status === "reorder" ? "out" : "ok"
}));
}

function startEdit(m) {
setEditId(m.id);
setDraft({ buyLink: m.buyLink || "", estCost: m.estCost || "", note: m.note || "" });
}

function saveEdit(id) {
recordHistory();
persistMaterials(materials.map(m => m.id !== id ? m : {
...m,
buyLink: draft.buyLink,
estCost: draft.estCost === "" ? null : parseFloat(draft.estCost),
note: draft.note,
}));
setEditId(null);
}

const sorted = [...materials].sort((a, b) => (a.priority || 9) - (b.priority || 9));

return (
<div>
<SectionTitle>Raw Materials · Reorder Status</SectionTitle>
<div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
<button onClick={undo} disabled={!past.length} style={{ background: "transparent", border: "1px solid #c8c2b8", color: past.length ? "#8c7d6b" : "#c8c2b8", borderRadius: 1, padding: "4px 14px", cursor: past.length ? "pointer" : "default", fontSize: 10, fontFamily: "monospace", letterSpacing: 1 }}>UNDO</button>
<button onClick={redo} disabled={!future.length} style={{ background: "transparent", border: "1px solid #c8c2b8", color: future.length ? "#8c7d6b" : "#c8c2b8", borderRadius: 1, padding: "4px 14px", cursor: future.length ? "pointer" : "default", fontSize: 10, fontFamily: "monospace", letterSpacing: 1 }}>REDO</button>
<span style={{ fontSize: 10, color: "#b0a89a", fontFamily: "monospace" }}>{past.length ? `${past.length} change${past.length === 1 ? "" : "s"} this session` : "no changes yet"}</span>
</div>

<Card style={{ marginBottom: 20, borderLeft: "2px solid #a07848" }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
<div>
<div style={{ fontSize: 9, letterSpacing: 3, color: "#a09488", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>Weekly Materials Budget</div>
<div style={{ fontSize: 11, color: "#9c8d7b", fontFamily: "monospace" }}>
Enter estimated cost per item to track against your $250 weekly budget
</div>
</div>
<div style={{ display: "flex", gap: 20 }}>{[
{ label: "Budget", value: `$${WEEKLY_BUDGET}`, color: "#9c8d7b" },
{ label: "Allocated", value: `$${allocatedTotal.toFixed(2)}`, color: "#a07848" },
{ label: "Remaining", value: `$${remaining.toFixed(2)}`, color: remaining < 0 ? "#9b5e5e" : "#5a7a5a" },
].map(s => (
<div key={s.label} style={{ textAlign: "center" }}>
<div style={{ fontSize: 18, fontWeight: 400, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
<div style={{ fontSize: 9, color: "#b0a89a", letterSpacing: 2, textTransform: "uppercase" }}>{s.label}</div>
</div>
))}
</div>
</div>
<div style={{ marginTop: 14, height: 3, background: "#e5e1da" }}>
<div style={{ width: `${Math.min((allocatedTotal / WEEKLY_BUDGET) * 100, 100)}%`, height: "100%", background: remaining < 0 ? "#9b5e5e" : "#a07848", transition: "width 0.4s" }} />
</div>
</Card>

<div style={{ fontSize: 11, color: "#b0a89a", fontFamily: "monospace", marginBottom: 16, letterSpacing: 0.5 }}>
Click <strong style={{ color: "#9c8d7b" }}>Edit</strong> on any item to add a purchase link and estimated cost. Tap status badge to cycle: OK → REORDER → OUT.
</div>

<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
{sorted.map(m => {
const color = m.status === "out" ? "#9b5e5e" : m.status === "reorder" ? "#a07848" : "#5a7a5a";
const label = m.status === "out" ? "OUT" : m.status === "reorder" ? "REORDER" : "OK";
const isEditing = editId === m.id;
const hasLink = m.buyLink && m.buyLink.trim() !== "";

return (
<div key={m.id} style={{ background: "#f0ede8", border: "1px solid #ddd8d0", borderLeft: `2px solid ${color}`, padding: "14px 16px" }}>
{isEditing ? (
<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
<div style={{ fontSize: 13, color: "#1a1714", fontFamily: "'IM Fell English', Georgia, serif", marginBottom: 4 }}>{m.name}</div>
<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
<div style={{ flex: 2, minWidth: 200 }}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace", marginBottom: 4 }}>Purchase URL</div>
<input value={draft.buyLink} onChange={e => setDraft(d => ({ ...d, buyLink: e.target.value }))} placeholder="https://amazon.com/dp/..."
style={{ width: "100%", background: "#e5e1da", border: "1px solid #c8c2b8", padding: "6px 10px", color: "#1a1714", fontSize: 12, fontFamily: "monospace", outline: "none" }} />
</div>
<div style={{ minWidth: 100 }}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace", marginBottom: 4 }}>Est. Cost ($)</div>
<input value={draft.estCost} onChange={e => setDraft(d => ({ ...d, estCost: e.target.value }))} placeholder="0.00" type="number"
style={{ width: "100%", background: "#e5e1da", border: "1px solid #c8c2b8", padding: "6px 10px", color: "#1a1714", fontSize: 12, fontFamily: "monospace", outline: "none" }} />
</div>
<div style={{ flex: 2, minWidth: 160 }}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace", marginBottom: 4 }}>Notes</div>
<input value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} placeholder="Supplier name, qty needed..."
style={{ width: "100%", background: "#e5e1da", border: "1px solid #c8c2b8", padding: "6px 10px", color: "#1a1714", fontSize: 12, fontFamily: "monospace", outline: "none" }} />
</div>
</div>
<div style={{ display: "flex", gap: 8 }}>
<button onClick={() => saveEdit(m.id)} style={{ background: "#1a1714", color: "#f7f4ef", border: "none", padding: "6px 18px", cursor: "pointer", fontSize: 11, fontFamily: "monospace", letterSpacing: 1 }}>SAVE</button>
<button onClick={() => setEditId(null)} style={{ background: "transparent", color: "#a09488", border: "1px solid #c8c2b8", padding: "6px 14px", cursor: "pointer", fontSize: 11, fontFamily: "monospace", letterSpacing: 1 }}>CANCEL</button>
</div>
</div>
) : (
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
<div style={{ flex: 1 }}><div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3, flexWrap: "wrap" }}>
{hasLink ? (
<a href={m.buyLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: "#1a1714", fontFamily: "'IM Fell English', Georgia, serif", textDecoration: "underline", textDecorationColor: "#c8c2b8", textUnderlineOffset: 3 }}>{m.name}</a>
) : (
<span style={{ fontSize: 14, color: "#1a1714", fontFamily: "'IM Fell English', Georgia, serif" }}>{m.name}</span>
)}
{hasLink && <a href={m.buyLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#5a7a5a", fontFamily: "monospace", letterSpacing: 1, textDecoration: "none", border: "1px solid #5a7a5a40", borderRadius: 1, padding: "2px 8px" }}>↗ OPEN LINK</a>}
</div>
{m.note && <div style={{ fontSize: 11, color: "#9c8d7b", fontStyle: "italic" }}>{m.note}</div>}
</div>
<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
{m.estCost && (
<div style={{ textAlign: "center" }}>
<div style={{ fontSize: 14, color: "#a07848", fontFamily: "monospace" }}>${parseFloat(m.estCost).toFixed(2)}</div>
<div style={{ fontSize: 9, color: "#b0a89a", textTransform: "uppercase", letterSpacing: 1 }}>Est.</div>
</div>
)}
<div onClick={() => toggleStatus(m.id)} style={{ cursor: "pointer" }}>
<Tag color={color} label={label} />
</div>
<button onClick={() => startEdit(m)} style={{ background: "transparent", color: "#a09488", border: "1px solid #c8c2b8", padding: "4px 12px", cursor: "pointer", fontSize: 10, fontFamily: "monospace", letterSpacing: 1 }}>EDIT</button>
</div>
</div>
)}
</div>
);
})}
</div>

<button onClick={() => {
const newId = Math.max(...materials.map(m => m.id)) + 1;
const newMaterial = { id: newId, name: "New Material", status: "reorder", note: "", buyLink: "", estCost: null, priority: 4 };
recordHistory();
persistMaterials([...materials, newMaterial]);
setEditId(newId);
setDraft({ buyLink: "", estCost: "", note: "" });
}} style={{ marginTop: 14, width: "100%", background: "transparent", border: "1px dashed #c8c2b8", color: "#a09488", padding: "10px 0", cursor: "pointer", fontSize: 10, fontFamily: "monospace", letterSpacing: 2 }}>
+ ADD MATERIAL
</button>
</div>
);
}

// ── TAB: ROADMAP ──────────────────────────────────────────────────────────────

function RoadmapTab() {
return (
<div>
<SectionTitle>Lavalle Haus Growth Roadmap</SectionTitle>
<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
{ROADMAP.map((r, i) => (
<Card key={i} style={{ borderLeft: `3px solid ${i === 0 ? "#a07848" : "#c8c2b8"}` }}>
<div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
<div style={{ minWidth: 80 }}>
<div style={{ fontSize: 11, fontFamily: "monospace", color: i === 0 ? "#a07848" : "#9c8d7b", letterSpacing: 1 }}>{r.month}</div>
{i === 0 && <div style={{ fontSize: 9, color: "#a07848", fontFamily: "monospace", marginTop: 2 }}>NOW</div>}
</div>
<div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
{r.items.map((item, j) => (
<div key={j} style={{ fontSize: 13, color: i === 0 ? "#1a1714" : "#9c8d7b", paddingLeft: 12, borderLeft: `1px solid ${i === 0 ? "#c8c2b8" : "#e5e1da"}`, fontFamily: "'IM Fell English', Georgia, serif" }}>{item}</div>
))}
</div>
</div>
</Card>
))}
</div>
</div>
);
}

// ── TAB: AI ADVISOR ───────────────────────────────────────────────────────────

function AITab({ products, campaigns }) {
const [q, setQ] = useState("");
const [history, setHistory] = useState([]);
const [loading, setLoading] = useState(false);

const suggestions = [
"What should I do with my ad spend this week?",
"Which products are at risk of stocking out?",
"When should I launch seashell vessel campaigns?",
"How do I reduce TACOS below 30%?",
"How should I price my scrub vs competitors?",
];

async function ask(question) {
if (!question.trim()) return;
const userMsg = { role: "user", content: question };setHistory(h => [...h, userMsg]);
setQ("");
setLoading(true);

const invCtx = products.map(p => {
const w = weeksOfSupply(p.available, p.unitsSold30);
return `${p.name}: ${p.available} on hand, ${p.inbound} inbound, ${p.unitsSold30} sold/30d, ${w > 99 ? "99+" : w}w supply`;
}).join("\n");

const adCtx = campaigns.map(c =>
`${c.name}: $${c.spend7d} spent, $${c.sales7d} sales, ROAS ${c.roas || 0}, status: ${c.status}`
).join("\n");

const sys = `You are the AI business advisor for Lavalle Haus, a botanical candle brand.
BRAND: Clean eco-friendly botanical candles. Amazon FBA + Shopify. ~$880/mo Amazon revenue.
SITUATION: Just took over from agency. Budget constrained. $30/day ad budget.
UPCOMING: 200 SeaShell Vessels inbound. Body scrub (Spain manufacturing, $15 COGS first run) launching in 3-4 months. Also body oil, body lotion, body wash coming.
INVENTORY:\n${invCtx}
CAMPAIGNS:\n${adCtx}
KEY ISSUES: Broad Match campaign burning $63/week with zero sales. Sand Wax 32oz barely moving. Sugar scrub priced at $38 (8oz tin) = $4.75/oz — premium vs market.
Be direct, specific, actionable. No fluff.`;

try {
const res = await fetch("/api/categorize", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
model: "claude-sonnet-4-20250514",
max_tokens: 1000,
system: sys,
messages: [...history, userMsg].map(m => ({ role: m.role, content: m.content })),
}),
});
const data = await res.json();
setHistory(h => [...h, { role: "assistant", content: data.content?.[0]?.text || "No response." }]);
} catch {
setHistory(h => [...h, { role: "assistant", content: "Connection error. Try again." }]);
}
setLoading(false);
}

return (
<div style={{ display: "flex", flexDirection: "column" }}>
<SectionTitle>AI Business Advisor · Knows Your Business</SectionTitle>
{history.length === 0 && (
<div style={{ marginBottom: 20 }}>
<div style={{ fontSize: 12, color: "#a09488", marginBottom: 10 }}>Suggested questions:</div>
<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
{suggestions.map(s => (
<button key={s} onClick={() => ask(s)} style={{ background: "#e5e1da", border: "1px solid #4a3f2a", color: "#8c7d6b", borderRadius: 1, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontFamily: "'IM Fell English', Georgia, serif" }}>{s}</button>
))}
</div>
</div>
)}
<div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, maxHeight: 420, overflowY: "auto" }}>
{history.map((m, i) => (
<div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
<div style={{ maxWidth: "82%", background: m.role === "user" ? "#d4cfc7" : "#eae8e3", border: `1px solid #c8c2b8`, borderRadius: 1, padding: "10px 14px", fontSize: 13, color: m.role === "user" ? "#1a1714" : "#3a4a3a", lineHeight: 1.65, fontFamily: m.role === "user" ? "'IM Fell English', Georgia, serif" : "monospace", whiteSpace: "pre-wrap" }}>
{m.content}
</div>
</div>
))}
{loading && <div style={{ display: "flex", justifyContent: "flex-start" }}><div style={{ background: "#eae8e3", border: "1px solid #2a4a2a", borderRadius: 1, padding: "10px 14px", fontSize: 13, color: "#7a9a7a", fontFamily: "monospace" }}>Thinking...</div></div>}
</div>
<div style={{ display: "flex", gap: 10 }}>
<input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && ask(q)} placeholder="Ask anything about your business..."
style={{ flex: 1, background: "#edeae4", border: "1px solid #4a3f2a", borderRadius: 1, padding: "10px 14px", color: "#1a1714", fontSize: 13, fontFamily: "'IM Fell English', Georgia, serif", outline: "none" }} />
<button onClick={() => ask(q)} disabled={loading} style={{ background: loading ? "#d4cfc7" : "#8c7d6b", color: loading ? "#a09488" : "#0a0a06", border: "none", borderRadius: 1, padding: "10px 20px", cursor: loading ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700 }}>Ask</button>
</div>
</div>
);
}

// ── TAB: KEYWORDS ─────────────────────────────────────────────────────────────

const INITIAL_KEYWORDS = [
{ id: 1, product: "Beeswax Candle Sand 16oz", keyword: "beeswax candle sand", matchType: "phrase", spend: 11.86, clicks: 24, orders: 1, acos: 45, status: "keep", notes: "Main converting keyword. Watch ACOS." },
{ id: 2, product: "Beeswax Candle Sand 16oz", keyword: "sand wax candle", matchType: "exact", spend: 10.40, clicks: 18, orders: 1, acos: 40, status: "keep", notes: "High intent. Keep bidding." },
{ id: 3, product: "Beeswax Candle Sand 16oz", keyword: "candle wax sand art", matchType: "broad", spend: 62.97, clicks: 89, orders: 0, acos: null, status: "pause", notes: "PAUSE — $63 spent, zero orders." },
{ id: 4, product: "Small Apple Vanilla Candle", keyword: "apple vanilla candle", matchType: "phrase", spend: 8.20, clicks: 31, orders: 2, acos: 22, status: "keep", notes: "Best performing keyword. ACOS 22%." },
{ id: 5, product: "Small Apple Vanilla Candle", keyword: "spiced apple candle", matchType: "exact", spend: 4.10, clicks: 12, orders: 1, acos: 29, status: "keep", notes: "Profitable. Monitor." },
];

const KW_STATUS = {
keep: { color: "#5a7a5a", label: "KEEP" },
pause: { color: "#9b5e5e", label: "PAUSE" },
test: { color: "#7a7a9a", label: "TEST" },
watch: { color: "#a07848", label: "WATCH" },
};

const MATCH_COLORS = {
exact: "#5a7a5a",
phrase: "#a07848",
broad: "#9b5e5e",
};

function KeywordsTab({ products, dbState, setDbState }) {
const [keywords, setKeywords] = useState(() => (dbState && dbState.keywords && dbState.keywords.length ? dbState.keywords : INITIAL_KEYWORDS));
const [filter, setFilter] = useState("all");
const [adding, setAdding] = useState(false);
const [editId, setEditId] = useState(null);
const [draft, setDraft] = useState({});
const [aiProduct, setAiProduct] = useState("");
const [aiResults, setAiResults] = useState([]);
const [aiLoading, setAiLoading] = useState(false);

const kwFirst = useRef(true);
useEffect(() => {
if (kwFirst.current) { kwFirst.current = false; return; }
setDbState((prev) => { const full = { ...prev, keywords }; dbSave(full); return full; });
}, [keywords]);

const productNames = [...new Set(products.filter(p => p.channels?.includes("Amazon")).map(p => p.name))];const filtered = filter === "all" ? keywords : keywords.filter(k => k.status === filter);

const BLANK = { product: productNames[0] || "", keyword: "", matchType: "exact", spend: "", clicks: "", orders: "", acos: "", status: "test", notes: "" };

function saveNew() {
if (!draft.keyword) return;
setKeywords(prev => [{ ...draft, id: Date.now(), spend: +draft.spend || 0, clicks: +draft.clicks || 0, orders: +draft.orders || 0, acos: draft.acos ? +draft.acos : null }, ...prev]);
setDraft(BLANK);
setAdding(false);
}

function saveEdit(id) {
setKeywords(prev => prev.map(k => k.id !== id ? k : { ...k, ...draft, spend: +draft.spend || 0, clicks: +draft.clicks || 0, orders: +draft.orders || 0, acos: draft.acos ? +draft.acos : null }));
setEditId(null);
}

function startEdit(k) {
setEditId(k.id);
setDraft({ ...k });
}

async function generateKeywords() {
if (!aiProduct) return;
setAiLoading(true);
setAiResults([]);
try {
const res = await fetch("/api/categorize", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({
model: "claude-sonnet-4-20250514",
max_tokens: 1000,
system: `You are an Amazon PPC keyword research expert. Generate high-converting keywords for Amazon ads. Return ONLY a JSON array, no markdown, no explanation. Each item: { "keyword": string, "matchType": "exact"|"phrase"|"broad", "intent": "high"|"medium"|"low", "notes": string }`,
messages: [{ role: "user", content: `Generate 12 Amazon PPC keywords for this product: "${aiProduct}". Focus on buyer intent keywords. Mix of exact, phrase, and broad match. Include long-tail keywords that convert well.` }],
}),
});
const data = await res.json();const text = data.content?.[0]?.text || "[]";
const clean = text.replace(/```json|```/g, "").trim();
const parsed = JSON.parse(clean);
setAiResults(parsed);
} catch (e) {
setAiResults([{ keyword: "Error generating keywords", matchType: "exact", intent: "high", notes: "Try again" }]);
}
setAiLoading(false);
}

function addAiKeyword(kw) {
setKeywords(prev => [{
id: Date.now(),
product: aiProduct,
keyword: kw.keyword,
matchType: kw.matchType,
spend: 0, clicks: 0, orders: 0, acos: null,
status: "test",
notes: kw.notes,
}, ...prev]);
}

const totalSpend = keywords.reduce((s, k) => s + (k.spend || 0), 0);
const totalOrders = keywords.reduce((s, k) => s + (k.orders || 0), 0);
const pauseCount = keywords.filter(k => k.status === "pause").length;

return (
<div>
<SectionTitle>Keyword Tracker · Amazon PPC</SectionTitle>
<AmazonKeywords products={products} onTrack={(kw) => setKeywords(prev => [{ id: Date.now() + Math.floor(Math.random() * 999), product: kw.product || productNames[0] || "", keyword: kw.keyword, matchType: kw.matchType || "exact", spend: 0, clicks: 0, orders: 0, acos: null, status: "test", notes: kw.notes || "" }, ...prev])} />

{/* Summary */}
<div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
{[
{ label: "Keywords", value: keywords.length, color: "#8c7d6b" },
{ label: "Total Spend", value: `$${totalSpend.toFixed(2)}`, color: "#a07848" },
{ label: "Total Orders", value: totalOrders, color: "#5a7a5a" },
{ label: "Pause Now", value: pauseCount, color: pauseCount > 0 ? "#9b5e5e" : "#5a7a5a" },
].map(s => (
<Card key={s.label} style={{ flex: 1, minWidth: 100, textAlign: "center", padding: "12px 10px" }}>
<div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
<div style={{ fontSize: 9, color: "#a09488", letterSpacing: 1, textTransform: "uppercase", marginTop: 3 }}>{s.label}</div>
</Card>
))}
</div>

{/* Filter */}
<div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
{["all", "keep", "pause", "test", "watch"].map(f => (
<button key={f} onClick={() => setFilter(f)} style={{ background: filter === f ? "#1a1714" : "#e5e1da", color: filter === f ? "#f7f4ef" : "#9c8d7b", border: "1px solid #4a3f2a", borderRadius: 1, padding: "4px 12px", cursor: "pointer", fontSize: 10, fontFamily: "monospace", letterSpacing: 1, textTransform: "uppercase" }}>
{f}
</button>
))}
<button onClick={() => { setAdding(true); setDraft(BLANK); }} style={{ marginLeft: "auto", background: "#e5e1da", border: "1px dashed #4a3f2a", color: "#9c8d7b", borderRadius: 1, padding: "4px 16px", cursor: "pointer", fontSize: 10, fontFamily: "monospace", letterSpacing: 1 }}>
+ ADD KEYWORD
</button>
</div>

{/* Add form */}
{adding && (
<Card style={{ borderLeft: "3px solid #30d158", marginBottom: 16 }}>
<div style={{ fontSize: 11, color: "#5a7a5a", fontFamily: "monospace", marginBottom: 12 }}>NEW KEYWORD</div>
<div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
<div style={{ flex: 2, minWidth: 160 }}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Product</div>
<select value={draft.product} onChange={e => setDraft(d => ({ ...d, product: e.target.value }))}
style={{ width: "100%", background: "#e5e1da", border: "1px solid #4a3f2a", padding: "5px 8px", color: "#1a1714", fontSize: 12, fontFamily: "monospace" }}>
{productNames.map(p => <option key={p}>{p}</option>)}
</select>
</div>
<div style={{ flex: 3, minWidth: 180 }}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Keyword</div>
<input value={draft.keyword} onChange={e => setDraft(d => ({ ...d, keyword: e.target.value }))} placeholder="beeswax candle sand"
style={{ width: "100%", background: "#e5e1da", border: "1px solid #4a3f2a", padding: "5px 8px", color: "#1a1714", fontSize: 12, fontFamily: "monospace" }} />
</div>
<div>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Match</div>
<select value={draft.matchType} onChange={e => setDraft(d => ({ ...d, matchType: e.target.value }))}
style={{ background: "#e5e1da", border: "1px solid #4a3f2a", padding: "5px 8px", color: "#1a1714", fontSize: 12, fontFamily: "monospace" }}>
{["exact", "phrase", "broad"].map(m => <option key={m}>{m}</option>)}
</select>
</div>
<div>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Status</div>
<select value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}
style={{ background: "#e5e1da", border: "1px solid #4a3f2a", padding: "5px 8px", color: "#1a1714", fontSize: 12, fontFamily: "monospace" }}>
{["keep", "pause", "test", "watch"].map(s => <option key={s}>{s}</option>)}
</select>
</div>
</div>
<div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
{[["spend", "Spend $"], ["clicks", "Clicks"], ["orders", "Orders"], ["acos", "ACOS %"]].map(([f, l]) => (
<div key={f}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>{l}</div>
<input value={draft[f]} onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))} placeholder="0"
style={{ width: 70, background: "#e5e1da", border: "1px solid #4a3f2a", padding: "5px 8px", color: "#1a1714", fontSize: 12, fontFamily: "monospace", textAlign: "center" }} />
</div>
))}
</div>
<input value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Notes..."
style={{ width: "100%", background: "#e5e1da", border: "1px solid #4a3f2a", padding: "5px 8px", color: "#8c7d6b", fontSize: 11, fontFamily: "monospace", marginBottom: 10 }} />
<div style={{ display: "flex", gap: 8 }}>
<button onClick={saveNew} style={{ background: "#1a1714", color: "#f7f4ef", border: "none", padding: "6px 20px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Save</button>
<button onClick={() => setAdding(false)} style={{ background: "#e5e1da", color: "#9c8d7b", border: "1px solid #4a3f2a", padding: "6px 16px", cursor: "pointer", fontSize: 12 }}>Cancel</button>
</div>
</Card>
)}

{/* Keyword list */}
<div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
{filtered.map(k => {
const { color, label } = KW_STATUS[k.status] || KW_STATUS.test;
const isEditing = editId === k.id;
return (
<Card key={k.id} style={{ borderLeft: `3px solid ${color}` }}>
{isEditing ? (
<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
<div style={{ flex: 3, minWidth: 180 }}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Keyword</div>
<input value={draft.keyword} onChange={e => setDraft(d => ({ ...d, keyword: e.target.value }))}
style={{ width: "100%", background: "#e5e1da", border: "1px solid #4a3f2a", padding: "5px 8px", color: "#1a1714", fontSize: 12, fontFamily: "monospace" }} />
</div>
<div>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Match</div>
<select value={draft.matchType} onChange={e => setDraft(d => ({ ...d, matchType: e.target.value }))}
style={{ background: "#e5e1da", border: "1px solid #4a3f2a", padding: "5px 8px", color: "#1a1714", fontSize: 12, fontFamily: "monospace" }}>
{["exact", "phrase", "broad"].map(m => <option key={m}>{m}</option>)}
</select>
</div>
<div>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Status</div>
<select value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}
style={{ background: "#e5e1da", border: "1px solid #4a3f2a", padding: "5px 8px", color: "#1a1714", fontSize: 12, fontFamily: "monospace" }}>
{["keep", "pause", "test", "watch"].map(s => <option key={s}>{s}</option>)}
</select>
</div>
{[["spend", "Spend"], ["clicks", "Clicks"], ["orders", "Orders"], ["acos", "ACOS%"]].map(([f, l]) => (
<div key={f}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>{l}</div>
<input value={draft[f]} onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
style={{ width: 60, background: "#e5e1da", border: "1px solid #4a3f2a", padding: "5px 6px", color: "#1a1714", fontSize: 12, fontFamily: "monospace", textAlign: "center" }} />
</div>
))}
</div>
<input value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Notes..."
style={{ width: "100%", background: "#e5e1da", border: "1px solid #4a3f2a", padding: "5px 8px", color: "#8c7d6b", fontSize: 11, fontFamily: "monospace" }} />
<div style={{ display: "flex", gap: 8 }}>
<button onClick={() => saveEdit(k.id)} style={{ background: "#1a1714", color: "#f7f4ef", border: "none", padding: "5px 18px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>Save</button>
<button onClick={() => setEditId(null)} style={{ background: "#e5e1da", color: "#9c8d7b", border: "1px solid #4a3f2a", padding: "5px 14px", cursor: "pointer", fontSize: 11 }}>Cancel</button>
</div></div>
) : (
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
<div style={{ flex: 1 }}>
<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
<span style={{ fontFamily: "monospace", fontSize: 13, color: "#1a1714", fontWeight: 700 }}>{k.keyword}</span>
<span style={{ fontSize: 9, fontFamily: "monospace", padding: "2px 7px", background: MATCH_COLORS[k.matchType] + "22", color: MATCH_COLORS[k.matchType], border: `1px solid ${MATCH_COLORS[k.matchType]}44`, letterSpacing: 1 }}>{k.matchType.toUpperCase()}</span>
<Tag color={color} label={label} />
</div>
<div style={{ fontSize: 10, color: "#a09488", fontFamily: "monospace", marginBottom: 4 }}>{k.product}</div>
{k.notes && <div style={{ fontSize: 11, color: "#8c7d6b", fontStyle: "italic" }}>{k.notes}</div>}
</div>
<div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>{[
["Spend", k.spend ? `$${k.spend.toFixed(2)}` : "—", "#a07848"],
["Clicks", k.clicks || "—", "#1a1714"],
["Orders", k.orders || "—", "#5a7a5a"],
["ACOS", k.acos ? `${k.acos}%` : "—", k.acos ? (k.acos < 30 ? "#5a7a5a" : k.acos < 60 ? "#a07848" : "#9b5e5e") : "#a09488"],
].map(([l, v, c]) => (
<div key={l} style={{ textAlign: "center" }}>
<div style={{ fontSize: 14, fontWeight: 700, color: c, fontFamily: "monospace" }}>{v}</div>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div>
</div>
))}
<button onClick={() => startEdit(k)} style={{ background: "#e5e1da", border: "1px solid #4a3f2a", color: "#9c8d7b", borderRadius: 1, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>Edit</button>
</div>
</div>
)}
</Card>
);
})}
</div>

{/* AI Keyword Research */}
<div style={{ borderTop: "1px solid #d4cfc7", paddingTop: 24 }}>
<SectionTitle>AI Keyword Research · Generate New Keywords</SectionTitle>
<Card style={{ borderLeft: "3px solid #8b8bff", marginBottom: 16 }}>
<div style={{ fontSize: 12, color: "#7a7a9a", fontFamily: "monospace", marginBottom: 6 }}>HOW TO USE</div>
<div style={{ fontSize: 13, color: "#5a5550", lineHeight: 1.6 }}>
Select a product and click Generate — AI will suggest 12 high-intent keywords based on your product type and category. Click any keyword to add it to your tracker.
</div>
</Card>
<div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
<select value={aiProduct} onChange={e => setAiProduct(e.target.value)}
style={{ flex: 1, minWidth: 200, background: "#e5e1da", border: "1px solid #4a3f2a", padding: "8px 12px", color: "#1a1714", fontSize: 13, fontFamily: "'IM Fell English', Georgia, serif" }}>
<option value="">Select a product...</option>
{productNames.map(p => <option key={p}>{p}</option>)}
</select>
<button onClick={generateKeywords} disabled={!aiProduct || aiLoading}
style={{ background: aiLoading || !aiProduct ? "#d4cfc7" : "#8c7d6b", color: aiLoading || !aiProduct ? "#a09488" : "#0a0a06", border: "none", padding: "8px 24px", cursor: !aiProduct || aiLoading ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, fontFamily: "monospace" }}>
{aiLoading ? "Generating..." : "Generate Keywords"}
</button>
</div>
{aiResults.length > 0 && (
<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
<div style={{ fontSize: 9, color: "#a09488", fontFamily: "monospace", letterSpacing: 2, marginBottom: 4 }}>CLICK TO ADD TO TRACKER</div>
{aiResults.map((kw, i) => (
<div key={i} onClick={() => addAiKeyword(kw)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#edeae4", border: "1px solid #d4cfc7", borderLeft: `3px solid ${MATCH_COLORS[kw.matchType] || "#8c7d6b"}`, padding: "10px 14px", cursor: "pointer", gap: 12 }}
onMouseEnter={e => e.currentTarget.style.background = "#e5e1da"}
onMouseLeave={e => e.currentTarget.style.background = "#edeae4"}>
<div>
<div style={{ fontSize: 13, color: "#1a1714", fontFamily: "monospace", marginBottom: 2 }}>{kw.keyword}</div>
<div style={{ fontSize: 11, color: "#8c7d6b", fontStyle: "italic" }}>{kw.notes}</div>
</div>
<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
<span style={{ fontSize: 9, fontFamily: "monospace", padding: "2px 7px", background: MATCH_COLORS[kw.matchType] + "22", color: MATCH_COLORS[kw.matchType], border: `1px solid ${MATCH_COLORS[kw.matchType]}44`, letterSpacing: 1 }}>{kw.matchType?.toUpperCase()}</span>
<span style={{ fontSize: 9, fontFamily: "monospace", padding: "2px 7px", background: kw.intent === "high" ? "#5a7a5a22" : "#a0784822", color: kw.intent === "high" ? "#5a7a5a" : "#a07848", border: `1px solid ${kw.intent === "high" ? "#5a7a5a44" : "#a0784844"}`, letterSpacing: 1 }}>{kw.intent?.toUpperCase()} INTENT</span>
<span style={{ fontSize: 11, color: "#5a7a5a", fontFamily: "monospace" }}>+ ADD</span>
</div>
</div>
))}
</div>
)}
</div>
</div>
);
}

// ── PHASE-1 PLACEHOLDER ───────────────────────────────────────────────────────
// Sections that have a permanent home now and get built out in a later phase.
function ComingSoon({ title, titleEs, lines }) {
return (
<div>
<SectionTitle>{title}</SectionTitle>
{titleEs && <div style={{ fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: -14, marginBottom: 18, fontFamily: "'IM Fell English', Georgia, serif" }}>{titleEs}</div>}
<Card style={{ borderLeft: "3px solid #a89060" }}>
<div style={{ fontSize: 9, color: "#a07848", fontFamily: "monospace", letterSpacing: 2, marginBottom: 8 }}>SCAFFOLDED · NEXT PHASE</div>
<div style={{ fontSize: 13, color: "#5a5550", lineHeight: 1.6 }}>
This section now has its permanent home. We'll build it out in an upcoming phase so no data lives in two places.
<div style={{ fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 3, fontFamily: "'IM Fell English', Georgia, serif" }}>Esta sección ya tiene su hogar permanente. La construiremos en una fase próxima para que ningún dato viva en dos lugares.</div>
</div>
{lines && (
<div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
<div style={{ fontSize: 9, color: "#a09488", fontFamily: "monospace", letterSpacing: 2 }}>WILL TRACK</div>
{lines.map((l, i) => (
<div key={i} style={{ fontSize: 12, color: "#8c7d6b", fontFamily: "monospace", paddingLeft: 12, borderLeft: "1px solid #d4cfc7" }}>{l}</div>
))}
</div>
)}
</Card>
</div>
);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

function LoginScreen() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!pw || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/data?op=login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const d = await r.json();
      if (r.ok && d.token) {
        localStorage.setItem("lh_token", d.token);
        window.location.reload();
      } else {
        setErr("Wrong password — contraseña incorrecta");
        setBusy(false);
      }
    } catch (e) {
      setErr("Could not reach the server — no se pudo conectar");
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f7f4ef", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IM Fell English', Georgia, serif" }}>
      <div style={{ background: "#efece5", border: "1px solid #c8c2b8", borderRadius: 1, padding: "40px 44px", textAlign: "center", maxWidth: 340, width: "90%" }}>
        <div style={{ fontSize: 10, letterSpacing: 5, color: "#9c8d7b", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 3 }}>Lavalle Haus</div>
        <div style={{ fontSize: 20, letterSpacing: 2, fontWeight: 300, textTransform: "uppercase", color: "#1a1714" }}>Operating System</div>
        <div style={{ fontSize: 11, fontStyle: "italic", color: "#8c7d6b", marginTop: 6, marginBottom: 22 }}>Private — enter the house password<br/>Privado — ingresa la contraseña de la casa</div>
        <input
          type="password"
          value={pw}
          autoFocus
          onChange={e => setPw(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          placeholder="Password"
          style={{ width: "100%", boxSizing: "border-box", background: "#f7f4ef", border: "1px solid #c8c2b8", borderRadius: 1, padding: "10px 12px", fontSize: 14, color: "#1a1714", textAlign: "center", letterSpacing: 2, outline: "none" }}
        />
        <button onClick={submit} disabled={busy}
          style={{ width: "100%", marginTop: 10, padding: "10px 0", background: "#1a1714", color: "#f7f4ef", border: "none", borderRadius: 1, fontSize: 10, letterSpacing: 3, fontFamily: "monospace", cursor: "pointer", textTransform: "uppercase" }}>
          {busy ? "Unlocking…" : "Enter"}
        </button>
        {err && <div style={{ marginTop: 12, fontSize: 11, color: "#9b5e5e", fontFamily: "monospace" }}>{err}</div>}
      </div>
    </div>
  );
}

function PrivacyModal({ onClose }) {
  const wrap = { position: "fixed", inset: 0, background: "rgba(26,23,20,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 };
  const card = { background: "#f7f4ef", border: "1px solid #c8c2b8", borderRadius: 2, maxWidth: 680, maxHeight: "85vh", overflowY: "auto", padding: "28px 32px", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" };
  const h = { fontFamily: "'IM Fell English', Georgia, serif", color: "#1a1714" };
  const p = { fontFamily: "Georgia, serif", fontSize: 13, lineHeight: 1.6, color: "#3a342d", margin: "8px 0" };
  const hd = { fontFamily: "monospace", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#a07848", marginTop: 18 };
  return (
    <div style={wrap} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ ...h, fontSize: 26, fontWeight: 400, margin: 0 }}>Privacy Policy</h1>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, color: "#8c7d6b", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#8c7d6b", letterSpacing: 1, marginBottom: 6 }}>Lavalle Haus · Last updated {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</div>
        <p style={p}>Lavalle Haus (“we,” “us”) operates a small candle and body-care business. This policy explains what information we handle and how we protect it.</p>
        <div style={hd}>What we collect</div>
        <p style={p}>Our internal operating system stores business data — products, inventory, sales, advertising, supplier and team records. When you connect an account (such as a bank via Plaid, Amazon Selling Partner, or Shopify), we store the access tokens needed to read that data on your behalf. We do not collect personal information from the public through this tool.</p>
        <div style={hd}>How it’s stored & secured</div>
        <p style={p}>Data is stored in an encrypted, access-controlled database (Upstash Redis) and served over encrypted connections (TLS) through our hosting provider (Vercel). Access is limited to a small number of authorized team members, protected by a passcode and two-factor authentication on the underlying accounts. Account credentials and bank connections are handled server-side and, in the case of banking, by Plaid — we never see or store your online banking username or password.</p>
        <div style={hd}>Third-party services</div>
        <p style={p}>We rely on reputable providers to operate: Plaid (bank connections), Amazon and Shopify (commerce data), Resend (email notifications), and Upstash/Vercel (storage and hosting). Each processes data only as needed to provide its service.</p>
        <div style={hd}>How we use it</div>
        <p style={p}>Information is used solely to run and improve our own operations — tracking margins, inventory, and tasks, and notifying team members. We do not sell personal data, and we do not share it except as required to provide the services above or to comply with the law.</p>
        <div style={hd}>Retention</div>
        <p style={p}>We keep business records for as long as they’re useful to operations and review them periodically, removing what we no longer need. You may request deletion of data we hold about you.</p>
        <div style={hd}>Contact</div>
        <p style={p}>Questions about this policy or your data can be directed to the business owner at the contact address listed on our store.</p>
      </div>
    </div>
  );
}

export default function App() {
const [tab, setTab] = useState(() => { try { return localStorage.getItem("lh_tab") || "profit"; } catch { return "profit"; } });
const [sub, setSub] = useState(() => { try { return JSON.parse(localStorage.getItem("lh_sub") || "{}"); } catch { return {}; } });
useEffect(() => { try { localStorage.setItem("lh_tab", tab); localStorage.setItem("lh_sub", JSON.stringify(sub)); } catch {} }, [tab, sub]);
const [products, setProducts] = useState(INITIAL_PRODUCTS);
const [materials, setMaterials] = useState(MATERIALS);
const [weeks, setWeeks] = useState([]);
const [campaigns] = useState(INITIAL_CAMPAIGNS);
const [dbState, setDbState] = useState({ products: INITIAL_PRODUCTS, materials: MATERIALS, weekly: [], profitMatrix: {}, cogs: {}, keywords: INITIAL_KEYWORDS, wholesale: [], pnl: {}, googleAds: [], metaAds: [], emailRetention: [], deletedProducts: [] });
const [loaded, setLoaded] = useState(false);
const [showPrivacy, setShowPrivacy] = useState(false);
const [shopify, setShopify] = useState({ connected: false, items: {}, sold: {}, ugc: {}, variantDetail: {}, unmatched: [], soldUnmatched: [], syncedAt: null, syncing: false });

async function shopifySync() {
setShopify(s => ({ ...s, syncing: true }));
try {
const res = await fetch("/api/shopify-sync", { method: "POST" });
const d = await res.json();
if (d && d.connected && !d.error) {
const items = {};
(d.items || []).forEach(it => { items[it.productId] = it.qty; });
const sold = {};
(d.sold || []).forEach(it => { sold[it.productId] = it.qty; });
const ugc = {};
(d.ugcSold || []).forEach(it => { ugc[it.productId] = it.qty; });
setShopify({ connected: true, items, sold, ugc, variantDetail: d.variantDetail || {}, unmatched: d.unmatched || [], soldUnmatched: d.soldUnmatched || [], syncedAt: d.syncedAt, syncing: false });
} else if (d && d.connected && d.error) {
console.warn("Shopify sync error:", d.error);
setShopify(s => ({ ...s, connected: true, syncing: false }));
} else {
setShopify({ connected: false, items: {}, sold: {}, ugc: {}, variantDetail: {}, unmatched: [], soldUnmatched: [], syncedAt: null, syncing: false });
}
} catch(e) {
console.warn("shopify sync failed:", e);
setShopify(s => ({ ...s, syncing: false }));
}
}

const [amazon, setAmazon] = useState({ connected: false, items: {}, sold: {}, skuDetail: {}, unmatchedSkus: [], syncedAt: null, syncing: false });

async function amazonSync() {
setAmazon(s => ({ ...s, syncing: true }));
try {
const r = await fetch("/api/amazon-sync", { method: "POST" });
const d = await r.json();
if (d && d.connected && d.items) {
const items = {};
(d.items || []).forEach(it => { items[it.productId] = { fba: it.fba, inbound: it.inbound }; });
const sold = {};
(d.sold || []).forEach(it => { sold[it.productId] = it.qty; });
setAmazon({ connected: true, items, sold, skuDetail: d.skuDetail || {}, unmatchedSkus: d.unmatchedSkus || [], syncedAt: d.syncedAt, syncing: false });
} else {
setAmazon({ connected: false, items: {}, sold: {}, skuDetail: {}, unmatchedSkus: [], syncedAt: null, syncing: false });
}
} catch (e) {
setAmazon(s => ({ ...s, syncing: false }));
}
}

// ── AUTO-FETCH SHOPIFY + AMAZON ON LOAD ──
useEffect(() => { shopifySync(); amazonSync(); }, []);

// ── APP LOCK state: any API 401 anywhere flips this and shows the login ──
const [locked, setLocked] = useState(false);
useEffect(() => {
  const onLock = () => setLocked(true);
  window.addEventListener("lh-locked", onLock);
  return () => window.removeEventListener("lh-locked", onLock);
}, []);

// ── SELF-MAINTAINING CHANNEL TAGS ──
// If the live sync returns a Shopify count for a product, that product is by
// definition sold on Shopify — tag it automatically and persist, so channel
// chips never need manual upkeep. (Add-only: tags are never auto-removed.)
useEffect(() => {
if (!loaded) return;
let changed = false;
const updated = products.map(p => {
if (p.isSample) return p;
let chans = p.channels || ["Amazon"];
let touched = false;
if (shopify.connected && shopify.items && shopify.items[p.id] !== undefined && !chans.includes("Shopify")) {
chans = [...chans, "Shopify"]; touched = true;
}
if (amazon.connected && amazon.items && amazon.items[p.id] !== undefined && !chans.includes("Amazon")) {
chans = [...chans, "Amazon"]; touched = true;
}
if (!touched) return p;
changed = true;
return { ...p, channels: chans };
});
if (changed) {
setProducts(updated);
setDbState((prev) => { const full = { ...prev, products: updated }; dbSave(full); return full; });
}
}, [loaded, shopify.items, amazon.items]);

// ── AUTO FBA FEES ── pull live FBA fees from Amazon in the background when they
// are missing or older than 7 days, so the Margins + Action Items stay current
// without anyone pressing a button. Runs at most once per session.
const feesAutoRef = useRef(false);
useEffect(() => {
  if (!loaded || feesAutoRef.current) return;
  const m = dbState.margins || {};
  const fba = m.amazonFba || {};
  const stale = !m.fbaUpdatedAt || (Date.now() - new Date(m.fbaUpdatedAt).getTime()) > 7 * 86400000;
  if (Object.keys(fba).length > 0 && !stale) { feesAutoRef.current = true; return; }
  const items = (products || []).filter((p) => (p.sku || p.asin) && !p.isSample).map((p) => ({ id: p.id, asin: p.asin, sku: p.sku, price: Number(p.price) || 0 }));
  if (!items.length) return;
  feesAutoRef.current = true;
  (async () => {
    try {
      const d = await fetch("/api/amazon-sync?op=fees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) }).then((r) => r.json());
      if (d && d.items) {
        const map = { ...fba }; let got = 0;
        d.items.forEach((it) => { if (it.fbaFee != null) { map[it.id] = it.fbaFee; got += 1; } });
        if (got) setDbState((prev) => { const next = { ...prev, margins: { ...(prev.margins || {}), amazonFba: map, fbaUpdatedAt: d.updatedAt } }; dbSave(next); return next; });
      }
    } catch (e) {}
  })();
}, [loaded, dbState, products]);

useEffect(() => {
const link = document.createElement("link");
link.rel = "stylesheet"; link.href = FONT_LINK;
document.head.appendChild(link);
}, []);

// ── LOAD FROM DB ON STARTUP ──
useEffect(() => {
dbLoad().then(d => {
if (d) {
// Merge: saved products win, but newly seeded products (by id) are appended
// so app updates can introduce products without wiping user data.
let mergedProducts = d.products && d.products.length > 0 ? d.products : INITIAL_PRODUCTS;
let productsChanged = false;
// Deleted products never re-seed. ids 13/14 are retired by the app itself.
const RETIRED_IDS = [13, 14];
const tombstone = Array.from(new Set([...(d.deletedProducts || []), ...RETIRED_IDS]));
if (tombstone.length !== (d.deletedProducts || []).length) productsChanged = true;
const deletedSet = new Set(tombstone);
if (d.products && d.products.length > 0) {
const have = new Set(d.products.map(p => p.id));
const missing = INITIAL_PRODUCTS.filter(p => !have.has(p.id) && !deletedSet.has(p.id));
if (missing.length) { mergedProducts = [...d.products, ...missing]; productsChanged = true; }
}
const beforeRetire = mergedProducts.length;
mergedProducts = mergedProducts.filter(p => !deletedSet.has(p.id));
if (mergedProducts.length !== beforeRetire) productsChanged = true;
// Samples are testers: nested under their parent product.
const SAMPLE_PARENT = { 11: 8, 12: 4 };
mergedProducts = mergedProducts.map(p => {
const parent = SAMPLE_PARENT[p.id];
if (!parent) return p;
if (p.isSample && p.parentId === parent) return p;
productsChanged = true;
return { ...p, isSample: true, parentId: parent, channels: p.channels && p.channels.length ? p.channels : ["B2B"] };
});
// One-time reconciliation: exact Shopify store titles + Shopify channel for the apple candles.
const NAME_FIX = { 4: "Mini Spiced Apple Botanical Candle", 5: "Large Spiced Apple Botanical Candle" };
mergedProducts = mergedProducts.map(p => {
const fix = NAME_FIX[p.id];
if (!fix) return p;
const chans = p.channels || ["Amazon"];
const needName = p.name !== fix;
const needChan = !chans.includes("Shopify");
if (!needName && !needChan) return p;
productsChanged = true;
return { ...p, name: fix, channels: needChan ? [...chans, "Shopify"] : chans };
});
if (mergedProducts.length > 0) setProducts(mergedProducts);
if (d.materials && d.materials.length > 0) setMaterials(d.materials);
if (d.weekly && d.weekly.length > 0) setWeeks(d.weekly);
const nextDb = {
...d,
products: mergedProducts,
materials: d.materials && d.materials.length > 0 ? d.materials : MATERIALS,
weekly: d.weekly || [],
profitMatrix: d.profitMatrix || {},
cogs: d.cogs || {},
keywords: d.keywords && d.keywords.length ? d.keywords : INITIAL_KEYWORDS,
wholesale: d.wholesale || [],
pnl: d.pnl || {},
googleAds: d.googleAds || [],
metaAds: d.metaAds || [],
emailRetention: d.emailRetention || [],
deletedProducts: tombstone,
};
setDbState(nextDb);
if (productsChanged) dbSave(nextDb);
}
setLoaded(true);
});
}, []);

const criticalCount = products.filter(p => ["out", "low"].includes(stockStatus(p))).length;
const pauseCount = campaigns.filter(c => c.status === "pause").length;
const _storedActions = (dbState.actionsBoard && dbState.actionsBoard.items) || [];
const _marginFlags = buildMarginsModel({ cogs: dbState.cogs || {}, products, campaigns, profitMatrix: dbState.profitMatrix || {}, settings: dbState.margins || {} }).flags;
const _liveActions = _storedActions.filter(a => a.status !== "done" && a.status !== "resolved");
const openHighActions = _liveActions.length ? _liveActions.filter(a => a.severity === "high").length : _marginFlags.filter(f => f.severity === "high").length;

// ── 7-TAB OPERATING SYSTEM NAV (each metric has one permanent home) ──
const NAV = [
{ id: "profit", label: "Sales", labelEs: "Ventas", subs: [
{ id: "matrix", label: "Profit Matrix" },{ id: "amazondaily", label: "Amazon Daily" },{ id: "pricing", label: "Pricing" },{ id: "cogs", label: "COGS" },{ id: "margins", label: "Margins" },
{ id: "finances", label: "Finances" },
{ id: "finance", label: "Cash Runway" },
] },
{ id: "ads", label: "Ads", labelEs: "Anuncios", alert: pauseCount ? `${pauseCount}!` : null, subs: [
{ id: "ppc", label: "Amazon PPC" },
{ id: "keywords", label: "Keyword Library" },
{ id: "meta", label: "Meta / Shopify" },
{ id: "google", label: "Google Ads" },
{ id: "b2b", label: "B2B Ads" },
] },
{ id: "inventory", label: "Inventory", labelEs: "Inventario", alert: criticalCount || null, subs: [
{ id: "fba", label: "FBA Inventory" },
{ id: "products", label: "Products" },
{ id: "packaging", label: "Packaging" },
{ id: "raw", label: "Raw Materials" },
{ id: "inbound", label: "FBA Shipments" },
{ id: "listings", label: "Listing Manager" },
{ id: "createlisting", label: "Create Listing" },
{ id: "reorder", label: "Reorder List" },
] },
{ id: "growth", label: "Growth", labelEs: "Crecimiento", alert: openHighActions || null, subs: [
{ id: "competitors", label: "Competitor Intel" },
{ id: "creators", label: "Influencer / Creator" },
{ id: "retail", label: "Retail Expansion" },
{ id: "email", label: "Email / Retention" },
{ id: "weeklynums", label: "Weekly Numbers" },
{ id: "checklist", label: "Action Items" },
{ id: "wholesale", label: "Wholesale Accounts" },
] },
{ id: "roadmap", label: "Roadmap", labelEs: "Hoja de ruta" },
{ id: "materials", label: "Materials", labelEs: "Materiales", subs: [
{ id: "suppliers", label: "Supplier Database" },
{ id: "priceoz", label: "Price / Oz" },
] },
{ id: "ai", label: "✦ AI", labelEs: "Asesor AI", subs: [{ id: "coo", label: "AI COO" }, { id: "advisor", label: "Advisor" }] },
];

const activeNav = NAV.find(n => n.id === tab) || NAV[0];
const activeSub = activeNav.subs ? (sub[tab] || activeNav.subs[0].id) : null;
const setSubFor = (id) => setSub(s => ({ ...s, [tab]: id }));

if (!loaded) {
return (
<div style={{ minHeight: "100vh", background: "#f7f4ef", display: "flex", alignItems: "center", justifyContent: "center" }}>
<div style={{ fontFamily: "monospace", fontSize: 12, color: "#a09488", letterSpacing: 3 }}>LOADING...</div>
</div>
);
}

const profitNode = (
<ProfitMatrix
data={dbState.profitMatrix || {}}
onSave={(pm) => {
setDbState((prev) => { const next = { ...prev, profitMatrix: { products: pm.products, opex: pm.opex, keep: pm.keep, assignees: pm.assignees, profitAdjustments: pm.adjustments, profitManual: pm.manual } }; dbSave(next); return next; });
}}
/>
);

function renderBody() {
if (tab === "profit") {
if (activeSub === "amazondaily") return <AmazonProfit products={products} />;
if (activeSub === "pricing") return <Pricing products={products} />;
if (activeSub === "cogs") return <CogsBuilder data={dbState.cogs || {}} onSave={(cg) => { setDbState((prev) => { const next = { ...prev, cogs: { products: cg.products, laborRate: cg.laborRate } }; dbSave(next); return next; }); }} />;
if (activeSub === "margins") return <Margins cogs={dbState.cogs || {}} products={products} campaigns={campaigns} profitMatrix={dbState.profitMatrix || {}} data={dbState.margins || {}} onSave={(m) => { setDbState((prev) => { const next = { ...prev, margins: m }; dbSave(next); return next; }); }} onFbaFees={(map, updatedAt) => { setDbState((prev) => { const next = { ...prev, margins: { ...(prev.margins || {}), amazonFba: { ...((prev.margins || {}).amazonFba || {}), ...map }, fbaUpdatedAt: updatedAt } }; dbSave(next); return next; }); }} />;
if (activeSub === "finances" || activeSub === "bank" || activeSub === "pnl") return (
<div>
<Bank pnl={dbState.pnl || {}} onSavePnl={(pp) => { setDbState((prev) => { const full = { ...prev, pnl: pp }; dbSave(full); return full; }); }} onSaveCash={(total, updatedAt) => { setDbState((prev) => { const full = { ...prev, bankCash: { total, updatedAt } }; dbSave(full); return full; }); }} />
<div style={{ height: 28 }} />
<PnL data={dbState.pnl || {}} onSave={(pl) => { setDbState((prev) => { const next = { ...prev, pnl: pl }; dbSave(next); return next; }); }} />
</div>
);
if (activeSub === "finance") return <FinanceCash products={products} weeks={weeks} cogs={dbState.cogs || {}} pnl={dbState.pnl || {}} bankCash={dbState.bankCash || null} margins={dbState.margins || null} />;
return profitNode;
}
if (tab === "roadmap") return <RoadmapTab />;
if (tab === "ai") {
if (activeSub === "advisor") return <AITab products={products} campaigns={campaigns} />;
return <AICoo products={products} campaigns={campaigns} weeks={weeks} materials={materials} cogs={dbState.cogs || {}} />;
}
if (tab === "ads") {
if (activeSub === "ppc") return <AdsTab campaigns={campaigns} />;
if (activeSub === "keywords") return <KeywordsTab products={products} dbState={dbState} setDbState={setDbState} />;
if (activeSub === "meta") return <MetaAds data={dbState.metaAds || []} onSave={(r) => { setDbState((prev) => { const next = { ...prev, metaAds: r }; dbSave(next); return next; }); }} />;
if (activeSub === "google") return <GoogleAds data={dbState.googleAds || []} onSave={(r) => { setDbState((prev) => { const next = { ...prev, googleAds: r }; dbSave(next); return next; }); }} />;
if (activeSub === "b2b") return <Tracker title="B2B Ads" intro="Wholesale & retail campaigns — Faire, outreach, accounts." columns={[{ key: "channel", label: "Channel", type: "text" }, { key: "campaign", label: "Campaign", type: "text" }, { key: "spend", label: "Spend", type: "number" }, { key: "leads", label: "Leads", type: "number" }, { key: "accounts", label: "Accounts", type: "number" }, { key: "orders", label: "Orders", type: "number" }, { key: "revenue", label: "Revenue", type: "number" }]} data={dbState.b2bAds || []} onSave={(r) => setDbState((prev) => { const next = { ...prev, b2bAds: r }; dbSave(next); return next; })} addLabel="+ Add campaign" />;
}
if (tab === "inventory") {
if (activeSub === "fba") return <InventoryTab products={products} setProducts={setProducts} dbState={dbState} setDbState={setDbState} shopify={shopify} onShopifySync={shopifySync} amazon={amazon} onAmazonSync={amazonSync} />;
if (activeSub === "raw") return <MaterialsTab materials={materials} setMaterials={setMaterials} dbState={dbState} setDbState={setDbState} />;
if (activeSub === "products") return <ComingSoon title="Products — Finished Sellable Goods" titleEs="Productos — Bienes terminados" lines={["Quantity on hand · Inventory value · Location (Amazon / Shopify / Atlas / Wholesale / Warehouse)", "Incoming qty · ETA · Weeks of supply · Reorder point"]} />;
if (activeSub === "packaging") return <Tracker title="Packaging Components" intro="Pouches, jars, bottles, labels, pumps — stock, MOQ, lead time." columns={[{ key: "component", label: "Component", type: "text" }, { key: "type", label: "Type", type: "select", options: ["Pouch", "Jar", "Bottle", "Box", "Label", "Pump", "Lid", "Carton", "Other"] }, { key: "onHand", label: "On hand", type: "number" }, { key: "moq", label: "MOQ", type: "number" }, { key: "leadTime", label: "Lead time", type: "text" }, { key: "supplier", label: "Supplier", type: "text" }, { key: "reorderPoint", label: "Reorder pt", type: "number" }, { key: "link", label: "Buy link", type: "url" }]} data={dbState.packagingItems || []} onSave={(r) => setDbState((prev) => { const next = { ...prev, packagingItems: r }; dbSave(next); return next; })} addLabel="+ Add component" />;
if (activeSub === "inbound") return <FbaShipments />;
const onListingCommit = (ev) => {
  let updated = products;
  if (ev.newName && ev.sku) {
    updated = products.map(p => (p.sku || "").trim().toLowerCase() === ev.sku.trim().toLowerCase() ? { ...p, name: ev.newName } : p);
    setProducts(updated);
  }
  const listingLog = [ev.logRecord, ...((dbState.listingLog) || [])].slice(0, 500);
  setDbState((prev) => { const full = { ...prev, products: updated, listingLog }; dbSave(full); return full; });
};
if (activeSub === "listings") return <Listings products={products} dbState={dbState} onCommit={onListingCommit} />;
if (activeSub === "createlisting") return <VesselCreator onCommit={onListingCommit} />;
if (activeSub === "reorder") return <ComingSoon title="Reorder List — Auto-generated" titleEs="Lista de reorden — automática" lines={["Pulls from FBA · Products · Packaging · Raw Materials", "Item · Current qty · Reorder point · Suggested order qty"]} />;
}
if (tab === "growth") {
if (activeSub === "competitors") return <Tracker title="Competitor Intelligence" intro="Track rival launches, promos, pricing and packaging moves." columns={[{ key: "brand", label: "Brand", type: "text" }, { key: "update", label: "Update", type: "text" }, { key: "type", label: "Type", type: "select", options: ["Launch", "Promo", "Pricing", "Packaging", "Other"] }, { key: "date", label: "Date", type: "text" }, { key: "link", label: "Link", type: "url" }, { key: "notes", label: "Notes", type: "text" }]} data={dbState.competitors || []} onSave={(r) => setDbState((prev) => { const next = { ...prev, competitors: r }; dbSave(next); return next; })} addLabel="+ Add note" />;
if (activeSub === "creators") return <Tracker title="Influencer / Creator Program" intro="Creators, deliverables, cost and the revenue they drive." columns={[{ key: "creator", label: "Creator", type: "text" }, { key: "handle", label: "Handle", type: "text" }, { key: "deliverables", label: "Deliverables", type: "text" }, { key: "cost", label: "Cost", type: "number" }, { key: "status", label: "Status", type: "select", options: ["Pitched", "Confirmed", "Live", "Paid", "Done"] }, { key: "revenue", label: "Revenue", type: "number" }, { key: "notes", label: "Notes", type: "text" }]} data={dbState.creators || []} onSave={(r) => setDbState((prev) => { const next = { ...prev, creators: r }; dbSave(next); return next; })} addLabel="+ Add creator" />;
if (activeSub === "retail") return <Tracker title="Retail Expansion" intro="Atlas, Faire, spa accounts and independent retailers." columns={[{ key: "account", label: "Account", type: "text" }, { key: "type", label: "Type", type: "select", options: ["Atlas", "Faire", "Spa", "Retailer", "Other"] }, { key: "location", label: "Location", type: "text" }, { key: "status", label: "Status", type: "select", options: ["Prospect", "Pitched", "Open", "Active", "Paused"] }, { key: "notes", label: "Notes", type: "text" }]} data={dbState.retail || []} onSave={(r) => setDbState((prev) => { const next = { ...prev, retail: r }; dbSave(next); return next; })} addLabel="+ Add account" />;
if (activeSub === "email") return <EmailRetention data={dbState.emailRetention || []} onSave={(r) => { setDbState((prev) => { const next = { ...prev, emailRetention: r }; dbSave(next); return next; }); }} />;
if (activeSub === "weeklynums") return <WeeklyTab weeks={weeks} setWeeks={setWeeks} dbState={dbState} setDbState={setDbState} />;
if (activeSub === "checklist") return <ActionsBoard data={dbState.actionsBoard || {}} flags={_marginFlags} recurring={CHECKLIST_ITEMS} onSave={(payload) => { setDbState((prev) => { const next = { ...prev, actionsBoard: payload }; dbSave(next); return next; }); }} />;
if (activeSub === "wholesale") return <Wholesale data={dbState.wholesale || []} onSave={(w) => { setDbState((prev) => { const next = { ...prev, wholesale: w }; dbSave(next); return next; }); }} />;
}
if (tab === "materials") {
if (activeSub === "priceoz") return <PriceOzTab />;
if (activeSub === "suppliers") return <Tracker title="Supplier Database" intro="Every supplier — contact, MOQ, lead time, cost, reorder link." columns={[{ key: "name", label: "Supplier", type: "text" }, { key: "category", label: "Category", type: "text" }, { key: "contact", label: "Contact", type: "text" }, { key: "moq", label: "MOQ", type: "number" }, { key: "leadTime", label: "Lead time", type: "text" }, { key: "cost", label: "Cost", type: "number" }, { key: "link", label: "Link", type: "url" }, { key: "notes", label: "Notes", type: "text" }]} data={dbState.suppliers || []} onSave={(r) => setDbState((prev) => { const next = { ...prev, suppliers: r }; dbSave(next); return next; })} addLabel="+ Add supplier" />;
}
return null;
}

if (locked) return <LoginScreen />;

return (
<div style={{ minHeight: "100vh", background: "#f7f4ef", color: "#1a1714", fontFamily: "'IM Fell English', Georgia, serif" }}>
<div style={{ background: "#ede9e3", borderBottom: "1px solid #3a3020", padding: "18px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
<div>
<div style={{ fontSize: 10, letterSpacing: 5, color: "#9c8d7b", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 3 }}>Lavalle Haus</div>
<div style={{ fontSize: 20, letterSpacing: 2, fontWeight: 300, textTransform: "uppercase" }}>Operating System</div>
</div>
<div style={{ display: "flex", gap: 8 }}>
{[
{ label: "SKUs", value: products.length, color: "#8c7d6b" },
{ label: "Alerts", value: criticalCount + pauseCount + openHighActions, color: criticalCount + pauseCount + openHighActions > 0 ? "#9b5e5e" : "#5a7a5a" },
{ label: "Campaigns", value: campaigns.length, color: "#7a7a9a" },
].map(s => (
<div key={s.label} style={{ textAlign: "center", padding: "7px 12px", background: "#edeae4", borderRadius: 1, border: "1px solid #3a3020" }}>
<div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
<div style={{ fontSize: 9, color: "#a09488", letterSpacing: 1, textTransform: "uppercase" }}>{s.label}</div>
</div>
))}
<button onClick={() => { localStorage.removeItem("lh_token"); window.location.reload(); }}
  title="Lock the app — cerrar con llave"
  style={{ padding: "7px 12px", background: "transparent", border: "1px solid #c8c2b8", borderRadius: 1, color: "#8c7d6b", fontSize: 9, letterSpacing: 2, fontFamily: "monospace", cursor: "pointer", textTransform: "uppercase" }}>
  ⏻ Lock
</button>
</div>
</div>

{/* TOP NAV — 7 permanent homes */}
<div style={{ background: "#ede9e3", borderBottom: "1px solid #3a3020", padding: "0 24px", display: "flex", gap: 0, overflowX: "auto" }}>
{NAV.map(n => (
<button key={n.id} onClick={() => setTab(n.id)} style={{ background: "none", border: "none", borderBottom: tab === n.id ? "2px solid #a89060" : "2px solid transparent", color: tab === n.id ? "#1a1714" : "#a09488", padding: "11px 14px", cursor: "pointer", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", fontFamily: "monospace", marginBottom: -1, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
{n.label}
{n.alert && <span style={{ fontSize: 9, background: "#9b5e5e", color: "#fff", borderRadius: 1, padding: "1px 5px" }}>{n.alert}</span>}
</button>
))}
</div>

{/* SUB NAV — appears for tabs that have sections */}
{activeNav.subs && (
<div style={{ background: "#f2efe9", borderBottom: "1px solid #d4cfc7", padding: "0 24px", display: "flex", gap: 0, overflowX: "auto" }}>
{activeNav.subs.map(s => (
<button key={s.id} onClick={() => setSubFor(s.id)} style={{ background: "none", border: "none", borderBottom: activeSub === s.id ? "2px solid #a89060" : "2px solid transparent", color: activeSub === s.id ? "#1a1714" : "#a09488", padding: "9px 13px", cursor: "pointer", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontFamily: "monospace", marginBottom: -1, whiteSpace: "nowrap" }}>
{s.label}
</button>
))}
</div>
)}

<div style={tab === "profit" ? {} : { padding: "22px 24px", maxWidth: 960, margin: "0 auto" }}>
{renderBody()}
</div>
<div style={{ borderTop: "1px solid #d4cfc7", padding: "14px 24px", display: "flex", justifyContent: "center", gap: 12, fontFamily: "monospace", fontSize: 10, letterSpacing: 1, color: "#a09488" }}>
<span>© {new Date().getFullYear()} Lavalle Haus</span>
<span>·</span>
<button onClick={() => setShowPrivacy(true)} style={{ background: "none", border: "none", color: "#a07848", cursor: "pointer", fontFamily: "monospace", fontSize: 10, letterSpacing: 1, textDecoration: "underline", padding: 0 }}>Privacy Policy</button>
</div>
{showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
</div>
);
}
