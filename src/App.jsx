import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import ReorderList from "./ReorderList.jsx";
import { buildMarginsModel } from "./marginsCore.js";
import BusinessBrain from "./BusinessBrain.jsx";
import CommandView from "./CommandView.jsx";
import CommandDashboard from "./CommandDashboard.jsx";
import ContentScheduler from "./ContentScheduler.jsx";
import ContentAnalytics from "./ContentAnalytics.jsx";
import OSBoards from "./OSBoards.jsx";
import Boards from "./Boards.jsx";
import OpsCalendar from "./OpsCalendar.jsx";
import GridPlanner from "./GridPlanner.jsx";
import BrandGrids from "./BrandGrids.jsx";
import { buildBrainModel, BUBBLE_TAB } from "./businessBrain.js";

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

const FONT_LINK = "https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500&display=swap";

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
inbound: { color: "#8F8676", bg: "#8F867614", label: "INBOUND" },
low: { color: "#8F8676", bg: "#8F867614", label: "LOW STOCK" },
slow: { color: "#7a7a9a", bg: "#7a7a9a14", label: "SLOW MOVER" },
ok: { color: "#5a7a5a", bg: "#5a7a5a14", label: "HEALTHY" },
};const CAMP_STYLE = {
pause: { color: "#9b5e5e", label: "PAUSE" },
keep: { color: "#5a7a5a", label: "KEEP" },
watch: { color: "#8F8676", label: "WATCH" },
monitor: { color: "#7a7a9a", label: "MONITOR" },
};

function fmt(n, prefix = "$") {
if (n === null || n === undefined || n === "") return "—";
return `${prefix}${parseFloat(n).toFixed(2)}`;
}

// ── COMPONENTS ───────────────────────────────────────────────────────────────

function Tag({ color, label }) {
return <span style={{ fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1, padding: "2px 8px", borderRadius: 1, background: color + "22", color, border: `1px solid ${color}44` }}>{label}</span>;
}

function Card({ children, style = {} }) {
return <div style={{ background: "#F4F4F3", border: "1px solid #E0E0DD", borderRadius: 1, padding: "18px 20px", ...style }}>{children}</div>;
}

function SectionTitle({ children }) {
return <div style={{ fontSize: 9, letterSpacing: 4, color: "#b0a89a", textTransform: "uppercase", marginBottom: 20, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontWeight: 400 }}>{children}</div>;
}

function NumInput({ value, onChange, prefix = "$", placeholder = "Enter" }) {
return (
<input
value={value === null || value === undefined ? "" : value}
onChange={e => onChange(e.target.value === "" ? null : e.target.value)}
placeholder={placeholder}
style={{ width: 72, background: "#F0F0EE", border: "1px solid #D6D6D2", borderRadius: 1, padding: "3px 6px", color: "#1A1A1A", fontSize: 12, textAlign: "center", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}
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
<button onClick={undo} disabled={!past.length} style={{ background: "transparent", border: "1px solid #E0E0DD", color: past.length ? "#71716C" : "#E0E0DD", borderRadius: 1, padding: "4px 14px", cursor: past.length ? "pointer" : "default", fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1 }}>UNDO</button>
<button onClick={redo} disabled={!future.length} style={{ background: "transparent", border: "1px solid #E0E0DD", color: future.length ? "#71716C" : "#E0E0DD", borderRadius: 1, padding: "4px 14px", cursor: future.length ? "pointer" : "default", fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1 }}>REDO</button>
<span style={{ fontSize: 10, color: "#b0a89a", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{past.length ? `${past.length} change${past.length === 1 ? "" : "s"} this session` : "no changes yet"}</span>
<button onClick={suggestMins} title="Sets Min Stock to 6 weeks of cover at current sales velocity. Only fills blanks — your own minimums are never overwritten. Undo reverses it."
style={{ marginLeft: "auto", background: "transparent", border: "1px solid #8F8676", color: "#8F8676", borderRadius: 1, padding: "4px 14px", cursor: "pointer", fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1 }}>SUGGEST MINS</button>
</div>
<Card style={{ borderLeft: `3px solid ${shopify && shopify.connected ? "#5a7a5a" : "#8F8676"}`, padding: "12px 16px" }}>
{shopify && shopify.connected ? (
<>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
<div>
<span style={{ fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 2, color: "#5a7a5a" }}>● SHOPIFY CONNECTED · LIVE STOCK</span>
{shopify.syncedAt && <span style={{ fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", color: "#9A9A95", marginLeft: 10 }}>synced {new Date(shopify.syncedAt).toLocaleTimeString()}</span>}
<div style={{ fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 2, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>Shopify conectado — inventario en vivo en cada producto</div>
</div>
<button onClick={() => { onShopifySync(); if (onAmazonSync) onAmazonSync(); }} disabled={shopify.syncing || (amazon && amazon.syncing)} style={{ background: "#F0F0EE", border: "1px solid #D6D6D2", color: "#5a7a5a", borderRadius: 1, padding: "5px 14px", cursor: (shopify.syncing || (amazon && amazon.syncing)) ? "default" : "pointer", fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1 }}>{(shopify.syncing || (amazon && amazon.syncing)) ? "SYNCING…" : "SYNC NOW"}</button>
</div>
<div style={{ marginTop: 6, fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 2, color: amazon && amazon.connected ? "#5a7a5a" : "#8F8676" }}>
{amazon && amazon.connected ? "● AMAZON SP-API · LIVE FBA" : "○ AMAZON SP-API NOT CONNECTED"}
{amazon && amazon.syncedAt ? <span style={{ letterSpacing: 0, color: "#71716C" }}> · synced {new Date(amazon.syncedAt).toLocaleTimeString()}</span> : null}
</div>
{amazon && amazon.unmatchedSkus && amazon.unmatchedSkus.length > 0 && (
<div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid #0000000d" }}>
<div style={{ fontSize: 9, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 2, color: "#8F8676", marginBottom: 4 }}>⚠ AMAZON SKUS NOT YET MAPPED</div>
{amazon.unmatchedSkus.map((u, i) => (
<div key={"az" + i} style={{ fontSize: 11, color: "#71716C", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>· {u.sku} — {u.qty} units</div>
))}
</div>
)}
{((shopify.unmatched && shopify.unmatched.length > 0) || (shopify.soldUnmatched && shopify.soldUnmatched.length > 0)) && (
<div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #0000000d" }}>
<div style={{ fontSize: 9, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 2, color: "#8F8676", marginBottom: 4 }}>⚠ SHOPIFY PRODUCTS NOT YET MAPPED TO THIS APP</div>
{(shopify.unmatched || []).map((u, i) => (
<div key={"u" + i} style={{ fontSize: 11, color: "#71716C", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>· {u.title} — {u.qty} in stock</div>
))}
{(shopify.soldUnmatched || []).map((u, i) => (
<div key={"s" + i} style={{ fontSize: 11, color: "#71716C", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>· {u.title} — {u.qty} sold/30d</div>
))}
<div style={{ fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 4, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>Estos títulos de Shopify aún no están enlazados a un producto del app — compártelos con Claude para mapearlos.</div>
</div>
)}
</>
) : (
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
<div>
<span style={{ fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 2, color: "#8F8676" }}>○ SHOPIFY NOT CONNECTED</span>
<div style={{ fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 2, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>Conecta Shopify para ver el inventario en vivo de tu tienda</div>
</div>
<a href="/api/shopify-auth" style={{ background: "#1A1A1A", color: "#FFFFFF", borderRadius: 1, padding: "6px 16px", fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1, textDecoration: "none" }}>CONNECT SHOPIFY</a>
</div>
)}
</Card>
<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
{["All", "Amazon", "Shopify", "B2B"].map(ch => (
<button key={ch} onClick={() => setChannelFilter(ch)} style={{ padding: "5px 16px", fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: `1px solid ${channelFilter === ch ? "#1A1A1A" : "#E0E0DD"}`, background: channelFilter === ch ? "#1A1A1A" : "transparent", color: channelFilter === ch ? "#FFFFFF" : "#71716C" }}>{ch.toUpperCase()}</button>
))}
</div>
{reorderList.length > 0 && (
<Card style={{ borderLeft: "3px solid #b06a2e", background: "#b06a2e10" }}>
<div style={{ fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 2, color: "#b06a2e" }}>⚠ REORDER NEEDED · {reorderList.length}</div>
<div style={{ fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 2, marginBottom: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>Productos agotados o en/bajo su umbral mínimo</div>
<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
{reorderList.map(p => {
const stock = effectiveStock(p, shopify, amazon);
const min = +p.minStock || 0;
const need = min > 0 ? Math.max(min * 2 - stock, min) : null;
return (
<div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: "1px solid #0000000d", paddingTop: 6 }}>
<div style={{ fontSize: 13, color: "#1A1A1A", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{p.name}
<span style={{ fontSize: 10, color: "#9A9A95", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginLeft: 8 }}>{stock} on hand{min > 0 ? ` · min ${min}` : " · set a min in Edit"}{need ? ` · suggest +${need}` : ""}</span>
</div>
{p.reorderLink && p.reorderLink.trim() !== "" ? (
<a href={p.reorderLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1, color: "#b06a2e", textDecoration: "none", border: "1px solid #b06a2e40", borderRadius: 1, padding: "3px 10px" }}>↗ REORDER</a>
) : (
<span style={{ fontSize: 9, color: "#9A9A95", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>add link in Edit</span>
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
style={{ cursor: "pointer", marginLeft: 24, marginTop: -4, fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1, color: "#9A9A95" }}>
{openSamples === p.parentId ? "▾" : "▸"} {p.count} SAMPLE{p.count === 1 ? "" : "S"} / TESTER{p.count === 1 ? "" : "S"}
</div>
);
if (p.__sampleHeader) return (
<div key="__samplehdr" style={{ marginTop: 16, paddingTop: 10, borderTop: "1px solid #ddd8d0" }}>
<div style={{ fontSize: 9, letterSpacing: 4, color: "#b0a89a", textTransform: "uppercase", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>Samples / Testers</div>
<div style={{ fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 2, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>Muestras sin producto padre asignado</div>
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
<span style={{ fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 15, color: "#1A1A1A" }}>{p.name}</span>
<Tag color={color} label={label} />
</div>
<div style={{ fontSize: 11, color: "#9A9A95", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 6 }}>{p.sku}{p.asin ? ` · ${p.asin}` : ""}</div>
<div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
{(p.channels || ["Amazon"]).map(ch => (
<span key={ch} style={{ fontSize: 9, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1.5, padding: "2px 8px", background: ch === "Amazon" ? "#8F867614" : ch === "Shopify" ? "#5a7a5a14" : "#7a7a9a14", color: ch === "Amazon" ? "#8F8676" : ch === "Shopify" ? "#5a7a5a" : "#7a7a9a", border: `1px solid ${ch === "Amazon" ? "#8F867630" : ch === "Shopify" ? "#5a7a5a30" : "#7a7a9a30"}` }}>
{ch.toUpperCase()}
</span>
))}
</div>
{p.notes && <div style={{ fontSize: 12, color: "#71716C", fontStyle: "italic", marginBottom: 8 }}>{p.notes}</div>}
{p.reorderLink && p.reorderLink.trim() !== "" && <a href={p.reorderLink} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginBottom: 8, fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1, color: "#5a7a5a", textDecoration: "none", border: "1px solid #5a7a5a40", borderRadius: 1, padding: "3px 10px" }}>↗ REORDER</a>}
{(() => {
const sv = shopify && shopify.variantDetail && shopify.variantDetail[p.id] && shopify.variantDetail[p.id].length > 0 ? shopify.variantDetail[p.id] : null;
const ak = amazon && amazon.skuDetail && amazon.skuDetail[p.id] && amazon.skuDetail[p.id].length > 0 ? amazon.skuDetail[p.id] : null;
if (!sv && !ak) return null;
const count = (sv ? sv.length : 0) + (ak ? ak.length : 0);
return (
<div style={{ marginBottom: 8 }}>
<div onClick={() => setOpenVariants(openVariants === p.id ? null : p.id)} style={{ cursor: "pointer", fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1, color: "#5a7a5a", display: "inline-block" }}>
{openVariants === p.id ? "▾" : "▸"} {count} LIVE DETAIL{count === 1 ? "" : "S"}
</div>
{openVariants === p.id && (
<div style={{ marginTop: 6, borderLeft: "2px solid #5a7a5a40", paddingLeft: 10 }}>
{sv && sv.map((v, i) => (
<div key={"s" + i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", color: "#71716C", padding: "2px 0", borderBottom: "1px solid #00000008" }}>
<span>SHOPIFY · {v.name}</span>
<span>{v.qty} in stock{v.sold ? ` · ${v.sold} sold/30d` : ""}{v.ugc ? ` · ${v.ugc} ugc` : ""}</span>
</div>
))}
{ak && ak.map((v, i) => (
<div key={"a" + i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", color: "#71716C", padding: "2px 0", borderBottom: "1px solid #00000008" }}>
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
<div style={{ flex: 1, height: 4, background: "#F0F0EE", borderRadius: 1 }}>
<div style={{ width: `${Math.min((weeks / 26) * 100, 100)}%`, height: "100%", background: color, borderRadius: 1 }} />
</div>
<span style={{ fontSize: 12, color, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", minWidth: 40 }}>{weeks === 0 ? "—" : weeks > 99 ? "99+w" : `${weeks}w`}</span>
</div>
</div>
<div>
{isEditing ? (
<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
<div>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Product Name</div>
<input value={draft.name || ""} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
style={{ width: "100%", boxSizing: "border-box", background: "#F0F0EE", border: "1px solid #D6D6D2", borderRadius: 1, padding: "5px 8px", color: "#1A1A1A", fontSize: 13, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }} />
</div>
<div style={{ display: "flex", gap: 8 }}>
{[["available", "On Hand"], ["inbound", "Inbound to FBA"], ["unitsSold30", "Sold last 30d"], ["minStock", "Reorder at"]].map(([f, l]) => (
<div key={f}>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{l}</div>
<input value={draft[f]} onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
style={{ width: 56, background: "#F0F0EE", border: "1px solid #D6D6D2", borderRadius: 1, padding: "4px 6px", color: "#1A1A1A", fontSize: 13, textAlign: "center", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }} />
</div>
))}
</div>
<textarea value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} rows={2}
style={{ width: "100%", background: "#F0F0EE", border: "1px solid #D6D6D2", borderRadius: 1, padding: "6px 8px", color: "#71716C", fontSize: 11, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", resize: "none" }} />
<div>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Reorder Link (supplier / Amazon URL)</div>
<input value={draft.reorderLink || ""} onChange={e => setDraft(d => ({ ...d, reorderLink: e.target.value }))} placeholder="https://..."
style={{ width: "100%", boxSizing: "border-box", background: "#F0F0EE", border: "1px solid #D6D6D2", borderRadius: 1, padding: "5px 8px", color: "#1A1A1A", fontSize: 11, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }} />
</div>
<div style={{ marginBottom: 4 }}>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 6 }}>Sold On</div>
<div style={{ display: "flex", gap: 8 }}>
{["Amazon", "Shopify", "B2B"].map(ch => (
<div key={ch} onClick={() => toggleChannel(ch)} style={{ cursor: "pointer", padding: "4px 12px", fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1, border: `1px solid ${draft.channels && draft.channels.includes(ch) ? (ch === "Amazon" ? "#8F8676" : "#5a7a5a") : "#E0E0DD"}`, color: draft.channels && draft.channels.includes(ch) ? (ch === "Amazon" ? "#8F8676" : "#5a7a5a") : "#9A9A95", background: draft.channels && draft.channels.includes(ch) ? (ch === "Amazon" ? "#8F867614" : "#5a7a5a14") : "transparent" }}>
{ch}
</div>
))}
</div>
</div>
<div onClick={() => setDraft(d => ({ ...d, isSample: !d.isSample }))} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
<span style={{ width: 11, height: 11, border: "1px solid #D6D6D2", background: draft.isSample ? "#8F8676" : "transparent", display: "inline-block" }} />
<span style={{ fontSize: 9, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1, color: "#71716C" }}>SAMPLE / TESTER — concealed under its parent product</span>
</div>
<div style={{ display: "flex", gap: 6 }}>
<button onClick={() => saveEdit(p.id)} style={{ flex: 1, background: "#1A1A1A", color: "#FFFFFF", border: "none", borderRadius: 1, padding: "6px 0", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Save</button>
<button onClick={() => setEditing(null)} style={{ flex: 1, background: "#F0F0EE", color: "#8A8A85", border: "1px solid #D6D6D2", borderRadius: 1, padding: "6px 0", cursor: "pointer", fontSize: 12 }}>Cancel</button>
<button onClick={() => deleteProduct(p.id)} style={{ background: "transparent", color: "#9b5e5e", border: "1px solid #9b5e5e40", borderRadius: 1, padding: "6px 12px", cursor: "pointer", fontSize: 11 }}>Delete</button>
</div>
</div>
) : (
<div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{[...(amazonInfo(p, amazon) ? [["In FBA", amazonInfo(p, amazon).fba], ["Inbound to FBA", amazonInfo(p, amazon).inbound]] : [["On Hand", p.available], ["Inbound to FBA", p.inbound]]), ["Sold 30d", effectiveSold(p, shopify, amazon)], ["Reorder at", p.minStock || 0], ...(shopify && shopify.items && shopify.items[p.id] !== undefined ? [["Shopify", shopify.items[p.id]]] : []), ...(shopify && shopify.ugc && shopify.ugc[p.id] ? [["UGC/Mktg", shopify.ugc[p.id]]] : [])].map(([l, v]) => (
<div key={l} style={{ textAlign: "center" }}>
<div style={{ fontSize: 18, fontWeight: 700, color: "#1A1A1A", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{v}</div>
<div style={{ fontSize: 9, color: "#9A9A95", letterSpacing: 0.5, textTransform: "uppercase" }}>{l}</div>
</div>
))}
<button onClick={() => startEdit(p)} style={{ background: "#F0F0EE", border: "1px solid #D6D6D2", color: "#8A8A85", borderRadius: 1, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>Edit</button>
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
{ label: "Total Ad Spend", value: `$${totalSpend.toFixed(2)}`, color: "#8F8676" },
{ label: "Total Ad Sales", value: `$${totalSales.toFixed(2)}`, color: "#5a7a5a" },
{ label: "Overall TACOS", value: `${overallTacos}%`, color: overallTacos > 30 ? "#9b5e5e" : "#5a7a5a" },
].map(s => (
<Card key={s.label} style={{ flex: 1, minWidth: 120, textAlign: "center", padding: "14px 10px" }}>
<div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{s.value}</div>
<div style={{ fontSize: 10, color: "#9A9A95", letterSpacing: 1, textTransform: "uppercase", marginTop: 4 }}>{s.label}</div>
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
<span style={{ fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 13, color: "#1A1A1A" }}>{c.name}</span>
<Tag color={color} label={label} />
</div>
<div style={{ fontSize: 12, color: "#71716C", fontStyle: "italic" }}>{c.recommendation}</div>
</div>
<div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
{[["Budget", `$${c.budget}/d`], ["Spend 7d", `$${c.spend7d}`], ["Sales 7d", `$${c.sales7d}`], ["ROAS", c.roas || "—"]].map(([l, v]) => (
<div key={l} style={{ textAlign: "center" }}>
<div style={{ fontSize: 15, fontWeight: 700, color: "#1A1A1A", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{v}</div>
<div style={{ fontSize: 9, color: "#9A9A95", letterSpacing: 0.5, textTransform: "uppercase" }}>{l}</div>
</div>
))}
</div>
</div>
</Card>
);
})}
</div>
<Card style={{ marginTop: 16, borderLeft: "3px solid #8b8bff" }}>
<div style={{ fontSize: 12, color: "#7a7a9a", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 8 }}>IMMEDIATE ACTION</div>
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
<div style={{ fontSize: 12, color: "#8F8676", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 6 }}>ACCOUNTANT NOTE</div><div style={{ fontSize: 13, color: "#5a5550", lineHeight: 1.6 }}>
Amazon fees (15% referral + 3% EV commission) and FBA fulfillment/storage are pre-filled based on Amazon's fee schedule. Please fill in: <strong style={{ color: "#1A1A1A" }}>COGS per unit, per-unit shipping cost, and estimated ad spend per unit</strong> for each product. Scrub products need Spain freight cost divided by units per shipment.
</div>
</Card>

{[{ label: "Current Products", data: current }, { label: "Upcoming Products", data: upcoming }].map(section => (
<div key={section.label} style={{ marginBottom: 24 }}>
<div style={{ fontSize: 11, color: "#8A8A85", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 12 }}>{section.label}</div>
<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
{section.data.map(r => {
const calc = calcProfit(r);
const isEditing = editing === r.id;
return (
<Card key={r.id} style={{ borderLeft: `3px solid ${calc ? (parseFloat(calc.margin) > 20 ? "#5a7a5a" : "#8F8676") : "#E0E0DD"}` }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
<div style={{ flex: 1, minWidth: 160 }}>
<div style={{ fontSize: 14, color: "#1A1A1A", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 4 }}>{r.name.replace(" (UPCOMING)", "")}</div>
{r.accountantNote && <div style={{ fontSize: 11, color: "#8F8676", fontStyle: "italic", marginBottom: 6 }}>{r.accountantNote}</div>}
<div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
{[
["List Price", fmt(r.price)],
["Amazon Fees", calc ? fmt(calc.totalFees) : "—"],
["COGS", fmt(r.cogs)],
["Shipping", fmt(r.shipping)],
["Ad Spend", fmt(r.adSpend)],
].map(([l, v]) => (
<div key={l} style={{ textAlign: "center" }}>
<div style={{ fontSize: 13, color: v === "—" ? "#E0E0DD" : "#1A1A1A", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{v}</div>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div>
</div>
))}
{calc && (
<>
<div style={{ textAlign: "center" }}>
<div style={{ fontSize: 13, color: parseFloat(calc.profit) > 0 ? "#5a7a5a" : "#9b5e5e", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontWeight: 700 }}>{fmt(calc.profit)}</div>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 0.5 }}>Est. Profit</div>
</div>
<div style={{ textAlign: "center" }}>
<div style={{ fontSize: 13, color: parseFloat(calc.margin) > 20 ? "#5a7a5a" : "#8F8676", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontWeight: 700 }}>{calc.margin}%</div>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 0.5 }}>Margin</div>
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
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{l}</div>
<NumInput value={r[f]} onChange={val => update(r.id, f, val)} />
</div>
))}
</div>
<input value={r.accountantNote} onChange={e => update(r.id, "accountantNote", e.target.value)} placeholder="Notes..."
style={{ width: "100%", background: "#F0F0EE", border: "1px solid #D6D6D2", borderRadius: 1, padding: "5px 8px", color: "#71716C", fontSize: 11, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }} />
<button onClick={() => setEditing(null)} style={{ background: "#1A1A1A", color: "#FFFFFF", border: "none", borderRadius: 1, padding: "6px 0", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Done</button>
</div>
) : (
<button onClick={() => setEditing(r.id)} style={{ background: "#F0F0EE", border: "1px solid #D6D6D2", color: "#8A8A85", borderRadius: 1, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>
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
<div style={{ fontSize: 12, color: "#7a7a9a", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 6 }}>WHY THIS MATTERS</div>
<div style={{ fontSize: 13, color: "#5a5550", lineHeight: 1.6 }}>
Your Sugar Scrub 8oz Tin at $38 = <strong style={{ color: "#1A1A1A" }}>$4.75/oz</strong> — premium positioning vs competitors at $1.81–$2.37/oz. This is defensible if your branding and ingredients story is strong. The 32oz pouch at $89.60 = $2.80/oz is more competitive.
</div>
</Card>
{categories.map(cat => (
<div key={cat} style={{ marginBottom: 20 }}>
<div style={{ fontSize: 11, color: "#8A8A85", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 10 }}>{cat}</div>
<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
{rows.filter(r => r.category === cat).sort((a, b) => (pricePerOz(b) || 0) - (pricePerOz(a) || 0)).map(r => {
const ppoz = pricePerOz(r);
const color = r.yours ? "#71716C" : "#9A9A95";
return (
<div key={r.id} style={{ background: "#F4F4F3", border: `1px solid ${r.yours ? "#E0E0DD" : "#F0F0EE"}`, borderLeft: `3px solid ${r.yours ? "#71716C" : "#E8E8E6"}`, borderRadius: 1, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
<div>
<div style={{ fontSize: 13, color: r.yours ? "#1A1A1A" : "#8A8A85", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
{r.name} {r.yours && <span style={{ fontSize: 10, color: "#71716C", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>YOU</span>}
</div>
<div style={{ fontSize: 10, color: "#9A9A95", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginTop: 2 }}>{r.asin}</div>
</div>
<div style={{ display: "flex", gap: 16, alignItems: "center" }}>
<div style={{ textAlign: "center" }}>
<div style={{ fontSize: 14, color: "#1A1A1A", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{fmt(r.price)}</div>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 0.5 }}>Price</div>
</div>
<div style={{ textAlign: "center" }}>
<div style={{ fontSize: 14, color: "#5a5550", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{r.oz ? `${r.oz}oz` : "—"}</div>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 0.5 }}>Size</div>
</div>
<div style={{ textAlign: "center", minWidth: 60 }}>
<div style={{ fontSize: 16, fontWeight: 700, color: ppoz ? color : "#E0E0DD", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{ppoz ? `$${ppoz}` : "—"}</div>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 0.5 }}>/oz</div>
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
<Card style={{ borderLeft: "3px solid #A39B8B", marginBottom: 20 }}>
<div style={{ fontSize: 12, color: "#71716C", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 6 }}>HOW TO USE</div>
<div style={{ fontSize: 13, color: "#5a5550", lineHeight: 1.6 }}>
Every Monday, pull your weekly numbers from Amazon Seller Central → Reports → Business Reports. Takes 5 minutes. Paste in below to track trends over time.
</div>
</Card>

{adding ? (
<Card style={{ borderLeft: "3px solid #30d158", marginBottom: 16 }}>
<div style={{ fontSize: 12, color: "#5a7a5a", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 12 }}>NEW WEEK ENTRY</div>
<div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
{[["date","Week of (date)","text"], ["units","Units Sold","number"], ["revenue","Total Revenue $","number"], ["adSpend","Ad Spend $","number"], ["adSales","Ad Sales $","number"], ["organicSales","Organic Sales $","number"], ["sessions","Sessions","number"]].map(([f, l, t]) => (
<div key={f}>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{l}</div>
<input type={t} value={draft[f]} onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
style={{ width: t === "text" ? 110 : 80, background: "#F0F0EE", border: "1px solid #D6D6D2", borderRadius: 1, padding: "4px 8px", color: "#1A1A1A", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }} />
</div>
))}
</div>
<input value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Notes (promotions, stockouts, anything unusual)..."
style={{ width: "100%", background: "#F0F0EE", border: "1px solid #D6D6D2", borderRadius: 1, padding: "6px 10px", color: "#71716C", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 10 }} />
<div style={{ display: "flex", gap: 8 }}>
<button onClick={saveWeek} style={{ background: "#1A1A1A", color: "#FFFFFF", border: "none", borderRadius: 1, padding: "7px 20px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Save Week</button>
<button onClick={() => setAdding(false)} style={{ background: "#F0F0EE", color: "#8A8A85", border: "1px solid #D6D6D2", borderRadius: 1, padding: "7px 16px", cursor: "pointer", fontSize: 12 }}>Cancel</button>
</div>
</Card>) : (
<button onClick={() => setAdding(true)} style={{ background: "#F0F0EE", border: "1px dashed #D6D6D2", color: "#8A8A85", borderRadius: 1, padding: "10px 20px", cursor: "pointer", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1, marginBottom: 16, width: "100%" }}>
+ ADD THIS WEEK'S NUMBERS
</button>
)}

{weeks.length === 0 && !adding && (
<Card style={{ textAlign: "center", padding: "32px 20px" }}>
<div style={{ fontSize: 13, color: "#E0E0DD", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>No weekly data yet. Add your first entry above.</div></Card>
)}

<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
{weeks.map((w, i) => {
const t = tacos(w);
const prevWeek = weeks[i + 1];
const revChange = prevWeek && w.revenue && prevWeek.revenue
? (((parseFloat(w.revenue) - parseFloat(prevWeek.revenue)) / parseFloat(prevWeek.revenue)) * 100).toFixed(0)
: null;
return (
<Card key={w.id} style={{ borderLeft: `3px solid ${i === 0 ? "#71716C" : "#E8E8E6"}` }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
<div>
<div style={{ fontSize: 13, color: "#1A1A1A", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 4 }}>Week of {w.date}</div>
{w.notes && <div style={{ fontSize: 11, color: "#71716C", fontStyle: "italic" }}>{w.notes}</div>}
</div>
<div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
{[
["Revenue", w.revenue ? `$${w.revenue}` : "—", revChange ? (revChange > 0 ? "#5a7a5a" : "#9b5e5e") : "#1A1A1A"],
["Units", w.units || "—", "#1A1A1A"],
["Ad Spend", w.adSpend ? `$${w.adSpend}` : "—", "#8F8676"],
["TACOS", t ? `${t}%` : "—", t ? (t < 30 ? "#5a7a5a" : t < 60 ? "#8F8676" : "#9b5e5e") : "#1A1A1A"],
["Sessions", w.sessions || "—", "#7a7a9a"],
].map(([l, v, c]) => (
<div key={l} style={{ textAlign: "center" }}>
<div style={{ fontSize: 15, fontWeight: 700, color: c, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{v}</div>
{l === "Revenue" && revChange && <div style={{ fontSize: 9, color: parseFloat(revChange) > 0 ? "#5a7a5a" : "#9b5e5e" }}>{revChange > 0 ? "+" : ""}{revChange}% vs prior</div>}
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div>
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
{lastRun && <span style={{ fontSize: 11, color: "#9A9A95", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>Last: {lastRun}</span>}
<button onClick={reset} style={{ background: "#F0F0EE", border: "1px solid #D6D6D2", color: "#8A8A85", borderRadius: 1, padding: "5px 12px", cursor: "pointer", fontSize: 11 }}>Reset</button>
</div>
</div>
{allDone && <Card style={{ borderLeft: "3px solid #30d158", marginBottom: 16 }}><div style={{ color: "#5a7a5a", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 13 }}>All done! Come back in 2 weeks.</div></Card>}
{categories.map(cat => (
<div key={cat} style={{ marginBottom: 20 }}>
<div style={{ fontSize: 11, color: "#8A8A85", letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 10, paddingLeft: 4 }}>{cat}</div>
<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
{CHECKLIST_ITEMS.filter(i => i.category === cat).map(item => (
<div key={item.id} onClick={() => toggle(item.id)} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: checked[item.id] ? "#F4F4F3" : "#F4F4F3", border: `1px solid ${checked[item.id] ? "#30d15840" : "#E8E8E6"}`, borderRadius: 1, padding: "12px 14px", cursor: "pointer" }}>
<div style={{ width: 18, height: 18, borderRadius: 1, border: `1px solid ${checked[item.id] ? "#1A1A1A" : "#E0E0DD"}`, background: checked[item.id] ? "#1A1A1A" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
{checked[item.id] && <span style={{ color: "#FFFFFF", fontSize: 11, fontWeight: 400 }}>✓</span>}
</div>
<div>
<div style={{ fontSize: 13, color: checked[item.id] ? "#9A9A95" : "#1A1A1A", textDecoration: checked[item.id] ? "line-through" : "none", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{item.task}</div>
<div style={{ fontSize: 11, color: "#9A9A95", marginTop: 3 }}>{item.detail}</div>
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
<button onClick={undo} disabled={!past.length} style={{ background: "transparent", border: "1px solid #E0E0DD", color: past.length ? "#71716C" : "#E0E0DD", borderRadius: 1, padding: "4px 14px", cursor: past.length ? "pointer" : "default", fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1 }}>UNDO</button>
<button onClick={redo} disabled={!future.length} style={{ background: "transparent", border: "1px solid #E0E0DD", color: future.length ? "#71716C" : "#E0E0DD", borderRadius: 1, padding: "4px 14px", cursor: future.length ? "pointer" : "default", fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1 }}>REDO</button>
<span style={{ fontSize: 10, color: "#b0a89a", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{past.length ? `${past.length} change${past.length === 1 ? "" : "s"} this session` : "no changes yet"}</span>
</div>

<Card style={{ marginBottom: 20, borderLeft: "2px solid #8F8676" }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
<div>
<div style={{ fontSize: 9, letterSpacing: 3, color: "#9A9A95", textTransform: "uppercase", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 4 }}>Weekly Materials Budget</div>
<div style={{ fontSize: 11, color: "#8A8A85", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
Enter estimated cost per item to track against your $250 weekly budget
</div>
</div>
<div style={{ display: "flex", gap: 20 }}>{[
{ label: "Budget", value: `$${WEEKLY_BUDGET}`, color: "#8A8A85" },
{ label: "Allocated", value: `$${allocatedTotal.toFixed(2)}`, color: "#8F8676" },
{ label: "Remaining", value: `$${remaining.toFixed(2)}`, color: remaining < 0 ? "#9b5e5e" : "#5a7a5a" },
].map(s => (
<div key={s.label} style={{ textAlign: "center" }}>
<div style={{ fontSize: 18, fontWeight: 400, color: s.color, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{s.value}</div>
<div style={{ fontSize: 9, color: "#b0a89a", letterSpacing: 2, textTransform: "uppercase" }}>{s.label}</div>
</div>
))}
</div>
</div>
<div style={{ marginTop: 14, height: 3, background: "#F0F0EE" }}>
<div style={{ width: `${Math.min((allocatedTotal / WEEKLY_BUDGET) * 100, 100)}%`, height: "100%", background: remaining < 0 ? "#9b5e5e" : "#8F8676", transition: "width 0.4s" }} />
</div>
</Card>

<div style={{ fontSize: 11, color: "#b0a89a", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 16, letterSpacing: 0.5 }}>
Click <strong style={{ color: "#8A8A85" }}>Edit</strong> on any item to add a purchase link and estimated cost. Tap status badge to cycle: OK → REORDER → OUT.
</div>

<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
{sorted.map(m => {
const color = m.status === "out" ? "#9b5e5e" : m.status === "reorder" ? "#8F8676" : "#5a7a5a";
const label = m.status === "out" ? "OUT" : m.status === "reorder" ? "REORDER" : "OK";
const isEditing = editId === m.id;
const hasLink = m.buyLink && m.buyLink.trim() !== "";

return (
<div key={m.id} style={{ background: "#f0ede8", border: "1px solid #ddd8d0", borderLeft: `2px solid ${color}`, padding: "14px 16px" }}>
{isEditing ? (
<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
<div style={{ fontSize: 13, color: "#1A1A1A", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 4 }}>{m.name}</div>
<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
<div style={{ flex: 2, minWidth: 200 }}>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 4 }}>Purchase URL</div>
<input value={draft.buyLink} onChange={e => setDraft(d => ({ ...d, buyLink: e.target.value }))} placeholder="https://amazon.com/dp/..."
style={{ width: "100%", background: "#F0F0EE", border: "1px solid #E0E0DD", padding: "6px 10px", color: "#1A1A1A", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", outline: "none" }} />
</div>
<div style={{ minWidth: 100 }}>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 4 }}>Est. Cost ($)</div>
<input value={draft.estCost} onChange={e => setDraft(d => ({ ...d, estCost: e.target.value }))} placeholder="0.00" type="number"
style={{ width: "100%", background: "#F0F0EE", border: "1px solid #E0E0DD", padding: "6px 10px", color: "#1A1A1A", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", outline: "none" }} />
</div>
<div style={{ flex: 2, minWidth: 160 }}>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 4 }}>Notes</div>
<input value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} placeholder="Supplier name, qty needed..."
style={{ width: "100%", background: "#F0F0EE", border: "1px solid #E0E0DD", padding: "6px 10px", color: "#1A1A1A", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", outline: "none" }} />
</div>
</div>
<div style={{ display: "flex", gap: 8 }}>
<button onClick={() => saveEdit(m.id)} style={{ background: "#1A1A1A", color: "#FFFFFF", border: "none", padding: "6px 18px", cursor: "pointer", fontSize: 11, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1 }}>SAVE</button>
<button onClick={() => setEditId(null)} style={{ background: "transparent", color: "#9A9A95", border: "1px solid #E0E0DD", padding: "6px 14px", cursor: "pointer", fontSize: 11, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1 }}>CANCEL</button>
</div>
</div>
) : (
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
<div style={{ flex: 1 }}><div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3, flexWrap: "wrap" }}>
{hasLink ? (
<a href={m.buyLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: "#1A1A1A", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", textDecoration: "underline", textDecorationColor: "#E0E0DD", textUnderlineOffset: 3 }}>{m.name}</a>
) : (
<span style={{ fontSize: 14, color: "#1A1A1A", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{m.name}</span>
)}
{hasLink && <a href={m.buyLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#5a7a5a", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1, textDecoration: "none", border: "1px solid #5a7a5a40", borderRadius: 1, padding: "2px 8px" }}>↗ OPEN LINK</a>}
</div>
{m.note && <div style={{ fontSize: 11, color: "#8A8A85", fontStyle: "italic" }}>{m.note}</div>}
</div>
<div style={{ display: "flex", gap: 12, alignItems: "center" }}>
{m.estCost && (
<div style={{ textAlign: "center" }}>
<div style={{ fontSize: 14, color: "#8F8676", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>${parseFloat(m.estCost).toFixed(2)}</div>
<div style={{ fontSize: 9, color: "#b0a89a", textTransform: "uppercase", letterSpacing: 1 }}>Est.</div>
</div>
)}
<div onClick={() => toggleStatus(m.id)} style={{ cursor: "pointer" }}>
<Tag color={color} label={label} />
</div>
<button onClick={() => startEdit(m)} style={{ background: "transparent", color: "#9A9A95", border: "1px solid #E0E0DD", padding: "4px 12px", cursor: "pointer", fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1 }}>EDIT</button>
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
}} style={{ marginTop: 14, width: "100%", background: "transparent", border: "1px dashed #E0E0DD", color: "#9A9A95", padding: "10px 0", cursor: "pointer", fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 2 }}>
+ ADD MATERIAL
</button>
</div>
);
}

// ── TAB: ROADMAP ──────────────────────────────────────────────────────────────

// ── CHIEF PLATFORM ROLLOUT ────────────────────────────────────────────────────
// The versioned path from this internal master app to the customer-facing
// product (per the Premoretum, Platform Tiers and Final Pricing docs).
// Master App = everything we need internally. Customer MVP = strongest wedge first.
const CHIEF_ROLLOUT = [
{ version: "Chief Core 1.0", who: "Every business", price: "$29–149/mo tiers", promise: "Where do we stand, what needs attention, what happens next.", includes: "CEO dashboard · Business Health · tasks & team · SOPs · weekly AI summary · native finance (statement upload → AI-categorized P&L, no QuickBooks required)", status: "in this app" },
{ version: "Chief Commerce 2.0 — MVP wedge", who: "E-commerce operators, $250k–$10M/yr (launch pricing: Operator $199/mo)", price: "$49–499/mo tiers", promise: "Know exactly what deserves your attention this week.", includes: "Daily Brief · Executive Decision Center · Shopify + Amazon + Meta integrations · inventory alerts · supplier & wholesale tracking · launch workflows. Lavalle Haus + The Fold are the testing environments.", status: "building here" },
{ version: "Chief Executive 2.5", who: "Brands needing forecasting + memory (Executive $999/mo)", price: "$999/mo", promise: "Operate like you have an executive team.", includes: "Institutional Memory · decision log · forecasting · scenario planning · benchmark network · team accountability", status: "planned" },
{ version: "Chief Construction 3.0", who: "Contractors & trades", price: "$49–399/mo tiers", promise: "Know project profitability before the project ends.", includes: "Bids · job costing · labor & materials tracking · change orders · crew profitability. 6th Gen Masonry is the testing environment.", status: "planned" },
];

function RoadmapTab() {
return (
<div>
<SectionTitle>Lavalle Haus Growth Roadmap</SectionTitle>
<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
{ROADMAP.map((r, i) => (
<Card key={i} style={{ borderLeft: `3px solid ${i === 0 ? "#8F8676" : "#E0E0DD"}` }}>
<div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
<div style={{ minWidth: 80 }}>
<div style={{ fontSize: 11, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", color: i === 0 ? "#8F8676" : "#8A8A85", letterSpacing: 1 }}>{r.month}</div>
{i === 0 && <div style={{ fontSize: 9, color: "#8F8676", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginTop: 2 }}>NOW</div>}
</div>
<div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
{r.items.map((item, j) => (
<div key={j} style={{ fontSize: 13, color: i === 0 ? "#1A1A1A" : "#8A8A85", paddingLeft: 12, borderLeft: `1px solid ${i === 0 ? "#E0E0DD" : "#F0F0EE"}`, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{item}</div>
))}
</div>
</div>
</Card>
))}
</div>

<div style={{ height: 30 }} />
<SectionTitle>Chief Platform Rollout</SectionTitle>
<div style={{ fontSize: 11, fontStyle: "italic", color: "rgba(111,102,87,0.7)", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginTop: -14, marginBottom: 14 }}>
One platform, industry modules — this app is the internal master; each version below is a customer-facing slice. “Know exactly what to do next.”
</div>
<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
{CHIEF_ROLLOUT.map((v, i) => (
<Card key={v.version} style={{ borderLeft: `3px solid ${v.status === "building here" ? "#8F8676" : "#E0E0DD"}` }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
<div style={{ fontSize: 16, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", color: "#1A1A1A" }}>{v.version}</div>
<div style={{ fontSize: 9, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 2, textTransform: "uppercase", color: v.status === "building here" ? "#8F8676" : "#8A8A85" }}>{v.status}</div>
</div>
<div style={{ fontSize: 12, fontStyle: "italic", color: "#71716C", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginTop: 3 }}>{v.promise}</div>
<div style={{ fontSize: 11, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", color: "#8A8A85", marginTop: 6 }}>{v.who} · {v.price}</div>
<div style={{ fontSize: 12.5, color: "#2A2A28", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", lineHeight: 1.6, marginTop: 6 }}>{v.includes}</div>
</Card>
))}
</div>
</div>
);
}

// ── SEGMENT TABS — quiet pill switcher inside a section ──────────────────────
// ── GLOBAL SEARCH — jump to any tab, sub-tab, section or record ──────────────
// Every destination carries keywords so plain-language searches land ("posting
// schedule" → Content › Grid, "stockists" → Growth › Wholesale › Accounts).
const SEARCH_SEG_GROUPS = {
  content: { tab: "content", sub: null, segs: [
    { id: "boards", label: "Boards", kw: "trello cards content planning covers photos posts july august fold refillery account health publish" },
    { id: "grid", label: "Schedule", kw: "plann instagram posting schedule calendar grid posts auto publish auto-publish feed preview connect tiktok post now planner" },
    { id: "analytics", label: "Analytics", kw: "insights followers engagement likes saves comments retention reach watch time stats performance" },
  ] },
  wholesale: { tab: "growth", sub: "wholesalehub", segs: [
    { id: "accounts", label: "Accounts", kw: "wholesale accounts stockists stores b2b buyers" },
    { id: "outreach", label: "Retail Outreach", kw: "outreach emails stores pitch templates" },
    { id: "timeline", label: "Outreach Timeline", kw: "follow up cadence timeline gantt sequence" },
    { id: "retailexp", label: "Retail Expansion", kw: "atlas faire spa retailers expansion accounts" },
  ] },
  creative: { tab: "growth", sub: "creative", segs: [
    { id: "poppy", label: "Poppy Framework", kw: "creative studio framework angles hooks ad creative" },
    { id: "competitors", label: "Competitor Intel", kw: "rivals competitors launches promos pricing intel" },
    { id: "creators", label: "Creators", kw: "influencers ugc creators collabs creator program" },
  ] },
};
const SEARCH_KW = {
  brain: "home health score bubbles dashboard overview command view steward revenue profit marketing inventory wholesale launches operations team lens drive map",
  profit: "sales revenue money income",
  "profit.matrix": "profit by product matrix contribution",
  "profit.amazondaily": "amazon daily sales numbers",
  "profit.pricing": "prices price list msrp",
  "profit.cogs": "cost of goods costs unit economics",
  "profit.margins": "margin calculator gross net",
  "profit.finances": "bank pnl profit and loss statements plaid transactions",
  "profit.finance": "cash runway burn rate months",
  ads: "advertising marketing campaigns spend",
  "ads.ppc": "amazon ppc acos campaigns bids",
  "ads.keywords": "keyword library search terms seo ranking",
  "ads.meta": "facebook instagram meta shopify ads roas cpa",
  "ads.google": "google adwords search ads",
  "ads.b2b": "b2b faire wholesale advertising",
  inventory: "stock inventory sku units warehouse",
  "inventory.fba": "fba amazon stock levels weeks of supply at risk",
  "inventory.products": "finished goods sellable products quantity",
  "inventory.packaging": "pouches jars bottles labels pumps lids cartons packaging components",
  "inventory.raw": "raw materials ingredients bulk",
  "inventory.inbound": "shipments inbound fba transfers receiving",
  "inventory.listings": "listing manager amazon listings edit",
  "inventory.createlisting": "create new listing launch",
  "inventory.reorder": "reorder restock purchase order list low stock",
  growth: "growth marketing expansion",
  "growth.wholesalehub": "wholesale stockists retail stores outreach faire atlas",
  "growth.creative": "creative studio poppy competitors creators ugc influencers",
  "growth.email": "email retention klaviyo flows newsletters welcome series",
  "growth.weeklynums": "weekly numbers kpis metrics scorecard",
  "growth.checklist": "action items tasks team todo assignments due dates reminders",
  content: "content social posts instagram tiktok boards grid publishing",
  roadmap: "roadmap plan phases milestones vision",
  materials: "materials suppliers ingredients",
  "materials.suppliers": "supplier database vendors contacts moq",
  "materials.priceoz": "price per ounce oz cost calculator",
  ai: "ai chief advisor coo ask assistant",
  "ai.coo": "ai coo operations recommendations briefing",
  "ai.advisor": "advisor chat ask chief questions",
};

function GlobalSearch({ nav, dbState, onGo }) {
  const [q, setQ] = useState("");
  const [openList, setOpenList] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const sansF = "'Jost', 'Helvetica Neue', Arial, sans-serif";
  const allowed = useMemo(() => new Set(nav.map((n) => n.id)), [nav]);

  // Pages index: tabs, sub-tabs, and the pill sections inside Content/Growth.
  const pages = useMemo(() => {
    const out = [];
    nav.forEach((n) => {
      out.push({ label: n.label, path: n.label, hay: (n.labelEs || "") + " " + (SEARCH_KW[n.id] || ""), dest: { tab: n.id } });
      (n.subs || []).forEach((s) => out.push({ label: s.label, path: n.label + " › " + s.label, hay: SEARCH_KW[n.id + "." + s.id] || "", dest: { tab: n.id, sub: s.id } }));
    });
    Object.entries(SEARCH_SEG_GROUPS).forEach(([gid, g]) => {
      const parent = nav.find((n) => n.id === g.tab);
      if (!parent) return;
      if (g.sub && !(parent.subs || []).some((s) => s.id === g.sub)) return;
      const subLabel = g.sub ? ((parent.subs || []).find((s) => s.id === g.sub) || {}).label : null;
      g.segs.forEach((sg) => out.push({
        label: sg.label,
        path: parent.label + (subLabel ? " › " + subLabel : "") + " › " + sg.label,
        hay: sg.kw,
        dest: { tab: g.tab, sub: g.sub, seg: { id: gid, seg: sg.id } },
      }));
    });
    return out;
  }, [nav]);

  // Records index: cards, posts, accounts, people, products… each points at
  // every section where it lives (a grid post appears under Boards AND Grid).
  const records = useMemo(() => {
    const out = [];
    const add = (label, extra, type, dest) => { if (label && allowed.has(dest.tab)) out.push({ label: String(label).slice(0, 70), hay: extra || "", type, path: null, dest }); };
    const gridCardIds = new Set();
    (((dbState || {}).gridPlanner || {}).feeds || []).forEach((f) => (f.items || []).forEach((it) => gridCardIds.add(it.cardId)));
    Object.entries((dbState || {}).boards || {}).forEach(([, b]) => {
      (b.cards || []).forEach((cd) => {
        add(cd.name, (cd.hook || "") + " " + (cd.desc || "") + " " + (b.name || ""), "Card · " + (b.name || "Boards"), { tab: "content", seg: { id: "content", seg: "boards" } });
        if (gridCardIds.has(cd.id)) add(cd.name, (cd.hook || "") + " " + (cd.desc || ""), "Post · Grid", { tab: "content", seg: { id: "content", seg: "grid" } });
      });
    });
    ((dbState || {}).wholesale || []).forEach((r) => add(r.account || r.name, r.notes, "Wholesale account", { tab: "growth", sub: "wholesalehub", seg: { id: "wholesale", seg: "accounts" } }));
    ((dbState || {}).retail || []).forEach((r) => add(r.account, r.location, "Retail expansion", { tab: "growth", sub: "wholesalehub", seg: { id: "wholesale", seg: "retailexp" } }));
    ((dbState || {}).creators || []).forEach((r) => add(r.creator || r.handle, r.handle, "Creator", { tab: "growth", sub: "creative", seg: { id: "creative", seg: "creators" } }));
    ((dbState || {}).competitors || []).forEach((r) => add(r.brand, r.update, "Competitor note", { tab: "growth", sub: "creative", seg: { id: "creative", seg: "competitors" } }));
    ((dbState || {}).packagingItems || []).forEach((r) => add(r.component, r.supplier, "Packaging", { tab: "inventory", sub: "packaging" }));
    ((dbState || {}).b2bAds || []).forEach((r) => add(r.campaign, r.channel, "B2B campaign", { tab: "ads", sub: "b2b" }));
    (((dbState || {}).actionsBoard || {}).team || []).forEach((t) => add(t.name, t.email, "Team member", { tab: "growth", sub: "checklist" }));
    (((dbState || {}).actionsBoard || {}).items || []).forEach((t) => add(t.title || t.name, t.notes, "Action item", { tab: "growth", sub: "checklist" }));
    return out;
  }, [dbState, allowed]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    const toks = query.split(/\s+/);
    const rank = (e) => {
      const label = e.label.toLowerCase();
      const hay = label + " " + (e.path || "").toLowerCase() + " " + e.hay.toLowerCase();
      let total = 0;
      for (const t of toks) {
        let s = 0;
        if (label === t) s = 100;
        else if (label.startsWith(t)) s = 85;
        else if (label.split(/\W+/).some((w) => w.startsWith(t))) s = 70;
        else if (label.includes(t)) s = 55;
        else if (hay.split(/\W+/).some((w) => w.startsWith(t))) s = 40;
        else if (hay.includes(t)) s = 25;
        if (!s) return 0;
        total += s;
      }
      return total + (e.path ? 5 : 0); // pages edge out records on ties
    };
    const scored = [];
    pages.forEach((e) => { const s = rank(e); if (s) scored.push({ ...e, s, group: "Pages" }); });
    records.forEach((e) => { const s = rank(e); if (s) scored.push({ ...e, s, group: "In your data" }); });
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, 12);
  }, [q, pages, records]);

  useEffect(() => setHi(0), [q]);

  // ⌘K (or plain "/" outside a field) puts the cursor in the search box.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /input|textarea|select/i.test((e.target || {}).tagName || "") || (e.target || {}).isContentEditable;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        inputRef.current && inputRef.current.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpenList(false); };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  const go = (r) => { setOpenList(false); setQ(""); onGo(r.dest); };
  let lastGroup = null;

  return (
    <div ref={boxRef} style={{ position: "relative", flex: "1 1 220px", minWidth: 170, maxWidth: 340 }}>
      <input ref={inputRef} value={q} placeholder="Search the OS…  ⌘K"
        onChange={(e) => { setQ(e.target.value); setOpenList(true); }}
        onFocus={() => setOpenList(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && results[hi]) go(results[hi]);
          else if (e.key === "Escape") { setOpenList(false); e.target.blur(); }
        }}
        style={{ width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #E0E0DD", borderRadius: 1, padding: "9px 13px", fontFamily: sansF, fontSize: 12, color: "#1A1A1A", outline: "none" }} />
      {openList && q.trim().length >= 2 && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, minWidth: 300, background: "#FFFFFF", border: "1px solid #E0E0DD", borderRadius: 1, boxShadow: "0 10px 30px rgba(26,26,26,0.10)", zIndex: 500, maxHeight: 380, overflowY: "auto" }}>
          {results.length === 0 && <div style={{ padding: "12px 14px", fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 12, color: "#8A8A85" }}>Nothing matches — try another word.</div>}
          {results.map((r, i) => {
            const header = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            return (
              <div key={i}>
                {header && <div style={{ padding: "8px 14px 3px", fontFamily: sansF, fontSize: 8.5, letterSpacing: 2, textTransform: "uppercase", color: "#A39B8B" }}>{header}</div>}
                <div onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); go(r); }}
                  style={{ padding: "8px 14px", cursor: "pointer", background: i === hi ? "#F4F1EC" : "transparent" }}>
                  <div style={{ fontFamily: sansF, fontSize: 12.5, color: "#1A1A1A" }}>{r.label}</div>
                  <div style={{ fontFamily: sansF, fontSize: 10, color: "#8A8A85", marginTop: 1 }}>{r.path || r.type}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SegTabs({ id, segments }) {
  const [seg, setSeg] = useState(() => { try { return localStorage.getItem("lh_seg_" + id) || segments[0].id; } catch { return segments[0].id; } });
  useEffect(() => { try { localStorage.setItem("lh_seg_" + id, seg); } catch {} }, [id, seg]);
  // Global search deep-links into a segment via this event (works when the
  // group is already mounted; fresh mounts pick the target up from localStorage).
  useEffect(() => {
    const onSeg = (e) => { if (e.detail && e.detail.id === id && segments.some((s) => s.id === e.detail.seg)) setSeg(e.detail.seg); };
    window.addEventListener("lh-seg", onSeg);
    return () => window.removeEventListener("lh-seg", onSeg);
  }, [id, segments]);
  const active = segments.find((s) => s.id === seg) || segments[0];
  const sansF = "'Jost', 'Helvetica Neue', Arial, sans-serif";
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        {segments.map((s) => (
          <button key={s.id} onClick={() => { setSeg(s.id); window.dispatchEvent(new CustomEvent("lh-seg-click", { detail: { id, seg: s.id } })); }}
            style={{ padding: "8px 16px", borderRadius: 1, cursor: "pointer", fontFamily: sansF, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", border: `1px solid ${s.id === active.id ? "#1A1A1A" : "#E0E0DD"}`, background: s.id === active.id ? "#1A1A1A" : "transparent", color: s.id === active.id ? "#FFFFFF" : "#71716C" }}>
            {s.label}
          </button>
        ))}
      </div>
      {active.render()}
    </div>
  );
}

// ── EMBEDDED PAGE — runs a self-contained public/ page inside a tab ───────────
function EmbeddedPage({ src, title, openLabel = "Open full window" }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 12, color: "#71716C" }}>{title}</div>
        <a href={src} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#8F8676", textDecoration: "underline", textUnderlineOffset: 3 }}>{openLabel} ↗</a>
      </div>
      <iframe title={title} src={src} style={{ width: "100%", height: "calc(100vh - 250px)", minHeight: 560, border: "1px solid #E0E0DD", borderRadius: 1, background: "#FFFFFF" }} />
    </div>
  );
}

// ── TAB: POPPY CREATIVE STUDIO ────────────────────────────────────────────────
// Creative intelligence framework (per the Poppy Creative Studio + Creative
// Intelligence specs). The structure ships now; each phase's data sources
// (Meta Ad Library, Apify, TikTok Creative Center) connect in a later phase.
const POPPY_PHASES = [
{ id: "observe", title: "Observe", body: "Collect competitor ads, organic content, creators, trends, and creative patterns.", sources: ["Meta Competitor Intelligence — top long-running competitor ads, new ads this week, offer & landing-page trackers", "TikTok Organic Intelligence — top videos, trending hooks, sounds, creator discovery", "TikTok Ad Intelligence — top ads, formats, hooks and offers", "Amazon Creative Intelligence — listing changes, launches, review velocity, pricing moves"] },
{ id: "analyze", title: "Analyze", body: "Deconstruct what's working: hook type, offer, format, audience signals, visual style, CTA, length, messaging pattern — with an AI summary of why it works.", sources: [] },
{ id: "adapt", title: "Adapt", body: "Filter everything through Lavalle Haus positioning: Luxury Alignment Score, Brand Equity Score, audience fit, visual refinement. Decide what to keep, remove, elevate, or avoid.", sources: [] },
{ id: "create", title: "Create", body: "Generate original concepts — static ads, video concepts, hooks, headlines, copy, shot lists, creative briefs, testing variations.", sources: [] },
{ id: "test", title: "Test", body: "Build the testing plan: budget allocation, KPI targets, ROAS goals, hook retention targets — and connect results back to Meta, Amazon, Shopify and Klaviyo.", sources: [] },
];

function PoppyStudio() {
const serifF = "'Jost', 'Helvetica Neue', Arial, sans-serif";
return (
<div>
<SectionTitle>Poppy Creative Studio</SectionTitle>
<div style={{ fontSize: 12, fontStyle: "italic", color: "#71716C", fontFamily: serifF, marginTop: -14, marginBottom: 16 }}>
Competitor and trend intelligence, transformed into original brand-aligned creative — never a copying tool. Not an ad spy tool: better decisions, not imitation.
</div>
{/* the featured workflow, always visible */}
<div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
{POPPY_PHASES.map((ph, i) => (
<div key={ph.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
<span style={{ fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#8F8676", border: "1px solid #E0E0DD", borderRadius: 1, padding: "6px 12px", background: "#F4F4F3" }}>{ph.title}</span>
{i < POPPY_PHASES.length - 1 && <span style={{ color: "#8A8A85" }}>→</span>}
</div>
))}
</div>
<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
{POPPY_PHASES.map((ph) => (
<Card key={ph.id}>
<div style={{ fontFamily: serifF, fontSize: 17, color: "#1A1A1A" }}>{ph.title}</div>
<div style={{ fontFamily: serifF, fontSize: 13, color: "#2A2A28", lineHeight: 1.6, marginTop: 4 }}>{ph.body}</div>
{ph.sources.length > 0 && (
<div style={{ marginTop: 8 }}>
{ph.sources.map((s, i) => (
<div key={i} style={{ fontFamily: serifF, fontSize: 12, color: "#71716C", paddingLeft: 12, borderLeft: "1px solid #E8E8E6", marginTop: 5, lineHeight: 1.5 }}>{s}</div>
))}
<div style={{ fontFamily: serifF, fontStyle: "italic", fontSize: 10.5, color: "rgba(111,102,87,0.6)", marginTop: 8 }}>Data sources connect in a later phase — the workflow and scoring structure live here now.</div>
</div>
)}
</Card>
))}
</div>
</div>
);
}

// ── TAB: AI ADVISOR ───────────────────────────────────────────────────────────

function AITab({ products, campaigns, initialQuestion = null, onSeedConsumed }) {
const [q, setQ] = useState("");
const [history, setHistory] = useState([]);
const [loading, setLoading] = useState(false);

// A question handed over from the Business Brain / Command View "Ask Chief"
const seedRef = useRef(false);
useEffect(() => {
if (!initialQuestion || seedRef.current) return;
seedRef.current = true;
ask(initialQuestion);
if (onSeedConsumed) onSeedConsumed();
}, [initialQuestion]);

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
<div style={{ fontSize: 12, color: "#9A9A95", marginBottom: 10 }}>Suggested questions:</div>
<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
{suggestions.map(s => (
<button key={s} onClick={() => ask(s)} style={{ background: "#F0F0EE", border: "1px solid #D6D6D2", color: "#71716C", borderRadius: 1, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{s}</button>
))}
</div>
</div>
)}
<div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, maxHeight: 420, overflowY: "auto" }}>
{history.map((m, i) => (
<div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
<div style={{ maxWidth: "82%", background: m.role === "user" ? "#E8E8E6" : "#F4F4F3", border: `1px solid #E0E0DD`, borderRadius: 1, padding: "10px 14px", fontSize: 13, color: m.role === "user" ? "#1A1A1A" : "#3a4a3a", lineHeight: 1.65, fontFamily: m.role === "user" ? "'Jost', 'Helvetica Neue', Arial, sans-serif" : "'Jost', 'Helvetica Neue', Arial, sans-serif", whiteSpace: "pre-wrap" }}>
{m.content}
</div>
</div>
))}
{loading && <div style={{ display: "flex", justifyContent: "flex-start" }}><div style={{ background: "#F4F4F3", border: "1px solid #2a4a2a", borderRadius: 1, padding: "10px 14px", fontSize: 13, color: "#7a9a7a", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>Thinking...</div></div>}
</div>
<div style={{ display: "flex", gap: 10 }}>
<input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && ask(q)} placeholder="Ask anything about your business..."
style={{ flex: 1, background: "#F4F4F3", border: "1px solid #D6D6D2", borderRadius: 1, padding: "10px 14px", color: "#1A1A1A", fontSize: 13, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", outline: "none" }} />
<button onClick={() => ask(q)} disabled={loading} style={{ background: loading ? "#E8E8E6" : "#71716C", color: loading ? "#9A9A95" : "#0a0a06", border: "none", borderRadius: 1, padding: "10px 20px", cursor: loading ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700 }}>Ask</button>
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
watch: { color: "#8F8676", label: "WATCH" },
};

const MATCH_COLORS = {
exact: "#5a7a5a",
phrase: "#8F8676",
broad: "#9b5e5e",
};

function KeywordsTab({ products, setProducts, dbState, setDbState }) {
const [keywords, setKeywords] = useState(() => (dbState && dbState.keywords && dbState.keywords.length ? dbState.keywords : INITIAL_KEYWORDS));
const [filter, setFilter] = useState("all");
const [adding, setAdding] = useState(false);
const [editId, setEditId] = useState(null);
const [draft, setDraft] = useState({});
const [aiProduct, setAiProduct] = useState("");
const [aiResults, setAiResults] = useState([]);
const [aiLoading, setAiLoading] = useState(false);
const [newProd, setNewProd] = useState("");

function addProduct(name) {
  const nm = String(name || "").trim();
  if (!nm) return;
  const np = { id: Date.now(), name: nm, sku: "", asin: "", available: 0, inbound: 0, unitsSold30: 0, price: 0, channels: ["Amazon"], status: "planning", notes: "Added for keyword research" };
  const updated = [...products, np];
  setProducts(updated);
  setDbState((prev) => { const full = { ...prev, products: updated }; dbSave(full); return full; });
}

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
<AmazonKeywords products={products} onTrack={(kw) => setKeywords(prev => [{ id: Date.now() + Math.floor(Math.random() * 999), product: kw.product || productNames[0] || "", keyword: kw.keyword, matchType: kw.matchType || "exact", spend: 0, clicks: 0, orders: 0, acos: null, status: "test", notes: kw.notes || "" }, ...prev])} onAddProduct={addProduct} />

{/* Summary */}
<div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
{[
{ label: "Keywords", value: keywords.length, color: "#71716C" },
{ label: "Total Spend", value: `$${totalSpend.toFixed(2)}`, color: "#8F8676" },
{ label: "Total Orders", value: totalOrders, color: "#5a7a5a" },
{ label: "Pause Now", value: pauseCount, color: pauseCount > 0 ? "#9b5e5e" : "#5a7a5a" },
].map(s => (
<Card key={s.label} style={{ flex: 1, minWidth: 100, textAlign: "center", padding: "12px 10px" }}>
<div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{s.value}</div>
<div style={{ fontSize: 9, color: "#9A9A95", letterSpacing: 1, textTransform: "uppercase", marginTop: 3 }}>{s.label}</div>
</Card>
))}
</div>

{/* Filter */}
<div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
{["all", "keep", "pause", "test", "watch"].map(f => (
<button key={f} onClick={() => setFilter(f)} style={{ background: filter === f ? "#1A1A1A" : "#F0F0EE", color: filter === f ? "#FFFFFF" : "#8A8A85", border: "1px solid #D6D6D2", borderRadius: 1, padding: "4px 12px", cursor: "pointer", fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1, textTransform: "uppercase" }}>
{f}
</button>
))}
<button onClick={() => { setAdding(true); setDraft(BLANK); }} style={{ marginLeft: "auto", background: "#F0F0EE", border: "1px dashed #D6D6D2", color: "#8A8A85", borderRadius: 1, padding: "4px 16px", cursor: "pointer", fontSize: 10, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 1 }}>
+ ADD KEYWORD
</button>
</div>

{/* Add form */}
{adding && (
<Card style={{ borderLeft: "3px solid #30d158", marginBottom: 16 }}>
<div style={{ fontSize: 11, color: "#5a7a5a", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 12 }}>NEW KEYWORD</div>
<div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
<div style={{ flex: 2, minWidth: 160 }}>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Product</div>
<select value={draft.product} onChange={e => setDraft(d => ({ ...d, product: e.target.value }))}
style={{ width: "100%", background: "#F0F0EE", border: "1px solid #D6D6D2", padding: "5px 8px", color: "#1A1A1A", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
{productNames.map(p => <option key={p}>{p}</option>)}
</select>
</div>
<div style={{ flex: 3, minWidth: 180 }}>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Keyword</div>
<input value={draft.keyword} onChange={e => setDraft(d => ({ ...d, keyword: e.target.value }))} placeholder="beeswax candle sand"
style={{ width: "100%", background: "#F0F0EE", border: "1px solid #D6D6D2", padding: "5px 8px", color: "#1A1A1A", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }} />
</div>
<div>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Match</div>
<select value={draft.matchType} onChange={e => setDraft(d => ({ ...d, matchType: e.target.value }))}
style={{ background: "#F0F0EE", border: "1px solid #D6D6D2", padding: "5px 8px", color: "#1A1A1A", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
{["exact", "phrase", "broad"].map(m => <option key={m}>{m}</option>)}
</select>
</div>
<div>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Status</div>
<select value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}
style={{ background: "#F0F0EE", border: "1px solid #D6D6D2", padding: "5px 8px", color: "#1A1A1A", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
{["keep", "pause", "test", "watch"].map(s => <option key={s}>{s}</option>)}
</select>
</div>
</div>
<div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
{[["spend", "Spend $"], ["clicks", "Clicks"], ["orders", "Orders"], ["acos", "ACOS %"]].map(([f, l]) => (
<div key={f}>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>{l}</div>
<input value={draft[f]} onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))} placeholder="0"
style={{ width: 70, background: "#F0F0EE", border: "1px solid #D6D6D2", padding: "5px 8px", color: "#1A1A1A", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", textAlign: "center" }} />
</div>
))}
</div>
<input value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Notes..."
style={{ width: "100%", background: "#F0F0EE", border: "1px solid #D6D6D2", padding: "5px 8px", color: "#71716C", fontSize: 11, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 10 }} />
<div style={{ display: "flex", gap: 8 }}>
<button onClick={saveNew} style={{ background: "#1A1A1A", color: "#FFFFFF", border: "none", padding: "6px 20px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Save</button>
<button onClick={() => setAdding(false)} style={{ background: "#F0F0EE", color: "#8A8A85", border: "1px solid #D6D6D2", padding: "6px 16px", cursor: "pointer", fontSize: 12 }}>Cancel</button>
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
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Keyword</div>
<input value={draft.keyword} onChange={e => setDraft(d => ({ ...d, keyword: e.target.value }))}
style={{ width: "100%", background: "#F0F0EE", border: "1px solid #D6D6D2", padding: "5px 8px", color: "#1A1A1A", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }} />
</div>
<div>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Match</div>
<select value={draft.matchType} onChange={e => setDraft(d => ({ ...d, matchType: e.target.value }))}
style={{ background: "#F0F0EE", border: "1px solid #D6D6D2", padding: "5px 8px", color: "#1A1A1A", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
{["exact", "phrase", "broad"].map(m => <option key={m}>{m}</option>)}
</select>
</div>
<div>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Status</div>
<select value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}
style={{ background: "#F0F0EE", border: "1px solid #D6D6D2", padding: "5px 8px", color: "#1A1A1A", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
{["keep", "pause", "test", "watch"].map(s => <option key={s}>{s}</option>)}
</select>
</div>
{[["spend", "Spend"], ["clicks", "Clicks"], ["orders", "Orders"], ["acos", "ACOS%"]].map(([f, l]) => (
<div key={f}>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>{l}</div>
<input value={draft[f]} onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
style={{ width: 60, background: "#F0F0EE", border: "1px solid #D6D6D2", padding: "5px 6px", color: "#1A1A1A", fontSize: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", textAlign: "center" }} />
</div>
))}
</div>
<input value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Notes..."
style={{ width: "100%", background: "#F0F0EE", border: "1px solid #D6D6D2", padding: "5px 8px", color: "#71716C", fontSize: 11, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }} />
<div style={{ display: "flex", gap: 8 }}>
<button onClick={() => saveEdit(k.id)} style={{ background: "#1A1A1A", color: "#FFFFFF", border: "none", padding: "5px 18px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>Save</button>
<button onClick={() => setEditId(null)} style={{ background: "#F0F0EE", color: "#8A8A85", border: "1px solid #D6D6D2", padding: "5px 14px", cursor: "pointer", fontSize: 11 }}>Cancel</button>
</div></div>
) : (
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
<div style={{ flex: 1 }}>
<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
<span style={{ fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 13, color: "#1A1A1A", fontWeight: 700 }}>{k.keyword}</span>
<span style={{ fontSize: 9, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", padding: "2px 7px", background: MATCH_COLORS[k.matchType] + "22", color: MATCH_COLORS[k.matchType], border: `1px solid ${MATCH_COLORS[k.matchType]}44`, letterSpacing: 1 }}>{k.matchType.toUpperCase()}</span>
<Tag color={color} label={label} />
</div>
<div style={{ fontSize: 10, color: "#9A9A95", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 4 }}>{k.product}</div>
{k.notes && <div style={{ fontSize: 11, color: "#71716C", fontStyle: "italic" }}>{k.notes}</div>}
</div>
<div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>{[
["Spend", k.spend ? `$${k.spend.toFixed(2)}` : "—", "#8F8676"],
["Clicks", k.clicks || "—", "#1A1A1A"],
["Orders", k.orders || "—", "#5a7a5a"],
["ACOS", k.acos ? `${k.acos}%` : "—", k.acos ? (k.acos < 30 ? "#5a7a5a" : k.acos < 60 ? "#8F8676" : "#9b5e5e") : "#9A9A95"],
].map(([l, v, c]) => (
<div key={l} style={{ textAlign: "center" }}>
<div style={{ fontSize: 14, fontWeight: 700, color: c, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{v}</div>
<div style={{ fontSize: 9, color: "#9A9A95", textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div>
</div>
))}
<button onClick={() => startEdit(k)} style={{ background: "#F0F0EE", border: "1px solid #D6D6D2", color: "#8A8A85", borderRadius: 1, padding: "5px 10px", cursor: "pointer", fontSize: 11 }}>Edit</button>
</div>
</div>
)}
</Card>
);
})}
</div>

{/* AI Keyword Research */}
<div style={{ borderTop: "1px solid #E8E8E6", paddingTop: 24 }}>
<SectionTitle>AI Keyword Research · Generate New Keywords</SectionTitle>
<Card style={{ borderLeft: "3px solid #8b8bff", marginBottom: 16 }}>
<div style={{ fontSize: 12, color: "#7a7a9a", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 6 }}>HOW TO USE</div>
<div style={{ fontSize: 13, color: "#5a5550", lineHeight: 1.6 }}>
Select a product and click Generate — AI will suggest 12 high-intent keywords based on your product type and category. Click any keyword to add it to your tracker.
</div>
</Card>
<div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
<input value={newProd} onChange={e => setNewProd(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { addProduct(newProd); setNewProd(""); } }} placeholder="Add a new product (e.g. Lavender Body Oil)" style={{ flex: 1, minWidth: 200, background: "#fff", border: "1px solid #E0E0DD", padding: "8px 12px", color: "#1A1A1A", fontSize: 13, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }} />
<button onClick={() => { addProduct(newProd); setNewProd(""); }} disabled={!newProd.trim()} style={{ background: newProd.trim() ? "#8F8676" : "#E8E8E6", color: newProd.trim() ? "#fff" : "#9A9A95", border: "none", padding: "8px 20px", cursor: newProd.trim() ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 700, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>+ Add product</button>
</div>
<div style={{ fontSize: 11, color: "#71716C", marginBottom: 16, fontStyle: "italic" }}>Adds it to your catalog and the dropdown below — for body oil, lotion, or any new launch.</div>
<div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
<select value={aiProduct} onChange={e => setAiProduct(e.target.value)}
style={{ flex: 1, minWidth: 200, background: "#F0F0EE", border: "1px solid #D6D6D2", padding: "8px 12px", color: "#1A1A1A", fontSize: 13, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
<option value="">Select a product...</option>
{productNames.map(p => <option key={p}>{p}</option>)}
</select>
<button onClick={generateKeywords} disabled={!aiProduct || aiLoading}
style={{ background: aiLoading || !aiProduct ? "#E8E8E6" : "#71716C", color: aiLoading || !aiProduct ? "#9A9A95" : "#0a0a06", border: "none", padding: "8px 24px", cursor: !aiProduct || aiLoading ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
{aiLoading ? "Generating..." : "Generate Keywords"}
</button>
</div>
{aiResults.length > 0 && (
<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
<div style={{ fontSize: 9, color: "#9A9A95", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 2, marginBottom: 4 }}>CLICK TO ADD TO TRACKER</div>
{aiResults.map((kw, i) => (
<div key={i} onClick={() => addAiKeyword(kw)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#F4F4F3", border: "1px solid #E8E8E6", borderLeft: `3px solid ${MATCH_COLORS[kw.matchType] || "#71716C"}`, padding: "10px 14px", cursor: "pointer", gap: 12 }}
onMouseEnter={e => e.currentTarget.style.background = "#F0F0EE"}
onMouseLeave={e => e.currentTarget.style.background = "#F4F4F3"}>
<div>
<div style={{ fontSize: 13, color: "#1A1A1A", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 2 }}>{kw.keyword}</div>
<div style={{ fontSize: 11, color: "#71716C", fontStyle: "italic" }}>{kw.notes}</div>
</div>
<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
<span style={{ fontSize: 9, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", padding: "2px 7px", background: MATCH_COLORS[kw.matchType] + "22", color: MATCH_COLORS[kw.matchType], border: `1px solid ${MATCH_COLORS[kw.matchType]}44`, letterSpacing: 1 }}>{kw.matchType?.toUpperCase()}</span>
<span style={{ fontSize: 9, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", padding: "2px 7px", background: kw.intent === "high" ? "#5a7a5a22" : "#8F867622", color: kw.intent === "high" ? "#5a7a5a" : "#8F8676", border: `1px solid ${kw.intent === "high" ? "#5a7a5a44" : "#8F867644"}`, letterSpacing: 1 }}>{kw.intent?.toUpperCase()} INTENT</span>
<span style={{ fontSize: 11, color: "#5a7a5a", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>+ ADD</span>
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
{titleEs && <div style={{ fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: -14, marginBottom: 18, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{titleEs}</div>}
<Card style={{ borderLeft: "3px solid #A39B8B" }}>
<div style={{ fontSize: 9, color: "#8F8676", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 2, marginBottom: 8 }}>SCAFFOLDED · NEXT PHASE</div>
<div style={{ fontSize: 13, color: "#5a5550", lineHeight: 1.6 }}>
This section now has its permanent home. We'll build it out in an upcoming phase so no data lives in two places.
<div style={{ fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 3, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>Esta sección ya tiene su hogar permanente. La construiremos en una fase próxima para que ningún dato viva en dos lugares.</div>
</div>
{lines && (
<div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
<div style={{ fontSize: 9, color: "#9A9A95", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", letterSpacing: 2 }}>WILL TRACK</div>
{lines.map((l, i) => (
<div key={i} style={{ fontSize: 12, color: "#71716C", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", paddingLeft: 12, borderLeft: "1px solid #E8E8E6" }}>{l}</div>
))}
</div>
)}
</Card>
</div>
);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

function finishLogin(d) {
  localStorage.setItem("lh_token", d.token);
  try {
    localStorage.setItem("lh_user", JSON.stringify(d.user || {}));
    if (d.user && d.user.name) localStorage.setItem("lh_me", d.user.name);
  } catch (e) {}
  window.location.replace(window.location.pathname);
}

const loginInput = { width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #E0E0DD", borderRadius: 1, padding: "10px 38px 10px 38px", fontSize: 14, color: "#1A1A1A", textAlign: "center", letterSpacing: 1, outline: "none" };
const loginBtn = { width: "100%", marginTop: 10, padding: "10px 0", background: "#1A1A1A", color: "#FFFFFF", border: "none", borderRadius: 1, fontSize: 10, letterSpacing: 3, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", cursor: "pointer", textTransform: "uppercase" };

function LoginShell({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
      <div style={{ background: "#F4F4F3", border: "1px solid #E0E0DD", borderRadius: 1, padding: "40px 44px", textAlign: "center", maxWidth: 340, width: "90%" }}>
        <div style={{ fontSize: 10, letterSpacing: 5, color: "#8A8A85", textTransform: "uppercase", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 3 }}>Lavalle Haus</div>
        <div style={{ fontSize: 20, letterSpacing: 2, fontWeight: 300, textTransform: "uppercase", color: "#1A1A1A" }}>Operating System</div>
        {children}
      </div>
    </div>
  );
}

// ── TEAM LENS ─────────────────────────────────────────────────────────────────
// Owner-only strip above the Business Brain: preview any member's brain —
// which bubbles they see and their own health percentage — and grant or
// remove bubbles right here (writes the same per-person page permissions the
// Team roster uses). Also holds the tab ↔ Drive folder map so bubbles, app
// tabs and Drive stay one taxonomy.
const LENS_GROUPS = [
  { tab: "profit", bubbles: "Revenue · Profit & Cash", tabLabel: "Sales" },
  { tab: "ads", bubbles: "Marketing", tabLabel: "Ads" },
  { tab: "inventory", bubbles: "Inventory", tabLabel: "Inventory" },
  { tab: "growth", bubbles: "Operations · Wholesale", tabLabel: "Growth" },
  { tab: "roadmap", bubbles: "Launches", tabLabel: "Roadmap" },
];
const LENS_ROLE_DEFAULT = {
  "Owner / Admin": ["brain", "profit", "ads", "inventory", "growth", "content", "roadmap", "materials", "ai"],
  "Manager": ["brain", "profit", "ads", "inventory", "growth", "content", "roadmap", "materials", "ai"],
  "Team Member": ["inventory", "growth", "content", "roadmap", "materials"],
  "Viewer": ["content", "roadmap"],
};
function TeamLens({ scoreFor, driveMap, onSaveDriveMap, navTabs }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState(null);
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);
  const sans = "'Jost', 'Helvetica Neue', Arial, sans-serif";
  useEffect(() => {
    if (open && users === null) {
      fetch("/api/data?op=users").then((r) => r.json()).then((d) => setUsers((d.users || []).filter((u) => !u.revoked))).catch(() => setUsers([]));
    }
  }, [open, users]);
  const u = (users || []).find((x) => x.id === sel) || null;
  const pagesOf = (x) => (x.pages && x.pages.length ? x.pages : (LENS_ROLE_DEFAULT[x.role] || LENS_ROLE_DEFAULT["Viewer"]));
  const pages = u ? pagesOf(u) : null;
  const score = u ? scoreFor(pages) : null;
  const toggle = async (tabId) => {
    if (!u || busy) return;
    const next = pages.includes(tabId) ? pages.filter((t) => t !== tabId) : [...pages, tabId];
    if (!next.length) return;
    setBusy(true);
    try {
      await fetch("/api/data?op=set_pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: u.id, pages: next }) });
      setUsers(users.map((x) => (x.id === u.id ? { ...x, pages: next } : x)));
    } catch (e) {}
    setBusy(false);
  };
  const chip = { border: "1px solid #E0E0DD", borderRadius: 1, padding: "5px 11px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer", background: "transparent", color: "#71716C" };
  return (
    <div style={{ background: "#F4F4F3", borderBottom: "1px solid #E0E0DD", padding: "8px 24px", fontFamily: sans }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#8F8676" }}>Team lens</span>
        <button onClick={() => { setOpen(!open); setDriveOpen(false); }} style={{ ...chip, color: open ? "#1A1A1A" : "#71716C", borderColor: open ? "#8F8676" : "#E0E0DD" }}>
          {open ? "Close" : "Preview a member's brain"}
        </button>
        <button onClick={() => { setDriveOpen(!driveOpen); setOpen(false); }} style={{ ...chip, color: driveOpen ? "#1A1A1A" : "#71716C", borderColor: driveOpen ? "#8F8676" : "#E0E0DD" }}>
          {driveOpen ? "Close" : "Tab ↔ Drive map"}
        </button>
      </div>

      {open && (
        <div style={{ padding: "12px 0 8px" }}>
          {users === null ? (
            <span style={{ fontSize: 11, color: "#9A9A95" }}>Loading team…</span>
          ) : users.length === 0 ? (
            <span style={{ fontSize: 11, color: "#9A9A95" }}>No team logins yet — invite people from Growth → Action Items → Team.</span>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <select value={sel} onChange={(e) => setSel(e.target.value)}
                style={{ background: "#FFFFFF", border: "1px solid #E0E0DD", borderRadius: 1, color: "#1A1A1A", fontFamily: sans, fontSize: 12, padding: "6px 9px" }}>
                <option value="">Choose a member…</option>
                {users.map((x) => <option key={x.id} value={x.id}>{x.name} — {x.role}</option>)}
              </select>
              {u && (
                <>
                  <span style={{ fontSize: 12, color: "#1A1A1A" }}>
                    {u.name.split(" ")[0]}'s health: <b>{score}</b>
                    <span style={{ color: "#9A9A95", fontSize: 10 }}> · from their bubbles only</span>
                  </span>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {LENS_GROUPS.map((g) => {
                      const on = pages.includes(g.tab);
                      return (
                        <button key={g.tab} onClick={() => toggle(g.tab)} disabled={busy} title={"On the " + g.tabLabel + " tab"}
                          style={{ ...chip, background: on ? "#1A1A1A" : "transparent", color: on ? "#FFFFFF" : "#71716C", borderColor: on ? "#1A1A1A" : "#E0E0DD" }}>
                          {g.bubbles}
                        </button>
                      );
                    })}
                  </div>
                  <span style={{ fontSize: 10, fontStyle: "italic", fontFamily: "Georgia, serif", color: "#8F8676" }}>
                    Toggling a bubble grants or removes its app tab too — one permission, both places.
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {driveOpen && (
        <div style={{ padding: "12px 0 8px", display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 10, fontStyle: "italic", fontFamily: "Georgia, serif", color: "#8F8676" }}>
            Paste each tab's Drive folder link — a "Drive ⤴" chip appears on that tab for everyone who can see it.
          </span>
          {navTabs.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#71716C", width: 110, flexShrink: 0 }}>{t.label}</span>
              <input defaultValue={driveMap[t.id] || ""} placeholder="https://drive.google.com/drive/folders/…"
                onBlur={(e) => { const v = e.target.value.trim(); if ((driveMap[t.id] || "") !== v) onSaveDriveMap({ ...driveMap, [t.id]: v || undefined }); }}
                style={{ flex: 1, maxWidth: 480, background: "#FFFFFF", border: "1px solid #E0E0DD", borderRadius: 1, padding: "5px 9px", fontFamily: sans, fontSize: 11, color: "#1A1A1A", outline: "none" }} />
              {driveMap[t.id] && <a href={driveMap[t.id]} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#8F8676" }}>open ⤴</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LoginScreen() {
  const [mode, setMode] = useState("user"); // "user" = email + personal password · "house" = master key
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  async function submit() {
    if (!pw || busy || (mode === "user" && !email.trim())) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/data?op=login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "user" ? { email: email.trim(), password: pw } : { password: pw }),
      });
      const d = await r.json();
      if (r.ok && d.token) {
        finishLogin(d);
      } else {
        setErr(mode === "user" ? "Wrong email or password — correo o contraseña incorrectos" : "Wrong password — contraseña incorrecta");
        setBusy(false);
      }
    } catch (e) {
      setErr("Could not reach the server — no se pudo conectar");
      setBusy(false);
    }
  }

  return (
    <LoginShell>
        <div style={{ fontSize: 11, fontStyle: "italic", color: "#71716C", marginTop: 6, marginBottom: 22 }}>
          {mode === "user" ? <>Private — sign in with your email<br/>Privado — ingresa con tu correo</> : <>Private — enter the house password<br/>Privado — ingresa la contraseña de la casa</>}
        </div>
        {mode === "user" && (
          <input
            type="email"
            value={email}
            autoFocus
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submit(); }}
            placeholder="Email"
            style={{ ...loginInput, marginBottom: 8 }}
          />
        )}
        <div style={{ position: "relative" }}>
        <input
          type={show ? "text" : "password"}
          value={pw}
          autoFocus={mode === "house"}
          onChange={e => setPw(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          placeholder="Password"
          style={{ ...loginInput, paddingRight: 78 }}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          title={show ? "Hide password — ocultar" : "Show password — mostrar"}
          style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: `1px solid ${show ? "#1A1A1A" : "#D9D6D0"}`, borderRadius: 3, cursor: "pointer", fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", color: show ? "#1A1A1A" : "#71716C", padding: "5px 9px", lineHeight: 1 }}>
          {show ? "Hide" : "👁 Show"}
        </button>
        </div>
        <button onClick={submit} disabled={busy} style={loginBtn}>
          {busy ? "Unlocking…" : "Enter"}
        </button>
        {err && (
          <div style={{ marginTop: 12, fontSize: 11, color: "#9b5e5e", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
            {err}
            {mode === "user" && <div style={{ marginTop: 6, color: "#8F8676", fontStyle: "italic", fontFamily: "Georgia, serif" }}>Forgot it? Ask the owner to resend your invite — the link lets you set a fresh password.</div>}
          </div>
        )}
        <button onClick={() => { setMode(m => m === "user" ? "house" : "user"); setErr(null); setPw(""); }}
          style={{ marginTop: 16, background: "none", border: "none", cursor: "pointer", fontSize: 10, letterSpacing: 1, color: "#8F8676", textDecoration: "underline", textUnderlineOffset: 2, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
          {mode === "user" ? "Use the house password instead" : "Sign in with your email instead"}
        </button>
    </LoginShell>
  );
}

// Invite acceptance — the private link from the invite email lands here.
function AcceptInvite({ invite }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    fetch("/api/data?op=invite_info&invite=" + encodeURIComponent(invite))
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => { if (ok) setInfo(d); else setErr(d.error || "This invite link is no longer valid."); })
      .catch(() => setErr("Could not reach the server — no se pudo conectar"));
  }, [invite]);

  async function submit() {
    if (busy) return;
    if (pw.length < 8) { setErr("Password must be at least 8 characters — mínimo 8 caracteres"); return; }
    if (pw !== pw2) { setErr("Passwords don't match — las contraseñas no coinciden"); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/data?op=accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite, password: pw }),
      });
      const d = await r.json();
      if (r.ok && d.token) finishLogin(d);
      else { setErr(d.error || "Something went wrong."); setBusy(false); }
    } catch (e) {
      setErr("Could not reach the server — no se pudo conectar");
      setBusy(false);
    }
  }

  return (
    <LoginShell>
      {!info && !err && <div style={{ fontSize: 11, fontStyle: "italic", color: "#71716C", marginTop: 18 }}>Checking your invite…</div>}
      {!info && err && (
        <>
          <div style={{ marginTop: 18, fontSize: 12, color: "#9b5e5e" }}>{err}</div>
          <button onClick={() => window.location.replace(window.location.pathname)} style={{ ...loginBtn, marginTop: 18 }}>Go to sign in</button>
        </>
      )}
      {info && (
        <>
          <div style={{ fontSize: 12, fontStyle: "italic", color: "#71716C", marginTop: 10 }}>Welcome, {info.name}.</div>
          <div style={{ fontSize: 11, color: "#8F8676", marginTop: 4, marginBottom: 18 }}>{info.email} · {info.role}<br/>Choose your password — elige tu contraseña</div>
          <div style={{ position: "relative", marginBottom: 8 }}>
            <input type={show ? "text" : "password"} value={pw} autoFocus onChange={(e) => setPw(e.target.value)} placeholder="New password (8+ characters)" style={{ ...loginInput, paddingRight: 78 }} />
            <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? "Hide password" : "Show password"}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: `1px solid ${show ? "#1A1A1A" : "#D9D6D0"}`, borderRadius: 3, cursor: "pointer", fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", color: show ? "#1A1A1A" : "#71716C", padding: "5px 9px", lineHeight: 1 }}>
              {show ? "Hide" : "👁 Show"}
            </button>
          </div>
          <input type={show ? "text" : "password"} value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder="Repeat password" style={loginInput} />
          <button onClick={submit} disabled={busy} style={loginBtn}>{busy ? "Saving…" : "Set password & enter"}</button>
          {err && <div style={{ marginTop: 12, fontSize: 11, color: "#9b5e5e" }}>{err}</div>}
        </>
      )}
    </LoginShell>
  );
}

function PrivacyModal({ onClose }) {
  const wrap = { position: "fixed", inset: 0, background: "rgba(26,23,20,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 };
  const card = { background: "#FFFFFF", border: "1px solid #E0E0DD", borderRadius: 2, maxWidth: 680, maxHeight: "85vh", overflowY: "auto", padding: "28px 32px", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" };
  const h = { fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", color: "#1A1A1A" };
  const p = { fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 13, lineHeight: 1.6, color: "#2A2A28", margin: "8px 0" };
  const hd = { fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#8F8676", marginTop: 18 };
  return (
    <div style={wrap} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ ...h, fontSize: 26, fontWeight: 400, margin: 0 }}>Privacy Policy</h1>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, color: "#71716C", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 10, color: "#71716C", letterSpacing: 1, marginBottom: 6 }}>Lavalle Haus OS · Effective June 2026 · Last reviewed June 2026</div>
        <div style={hd}>Who we are</div>
        <p style={p}>Lavalle Haus OS is an internal business application operated by Lavalle Haus (“we,” “us”). It is used by the business's owners to manage the company's own operations, inventory, advertising, and finances. It is not a product offered to outside consumers, and it does not create accounts for third-party end users.</p>
        <div style={hd}>What information the application accesses</div>
        <p style={p}>To operate, the application connects to services the business already uses and accesses the business's own data, including: bank account information via Plaid — account names and balances, and transaction history — used to track the company's cash position and runway; and commerce and advertising data via the Amazon, Shopify, and Google APIs — orders, inventory, listings, and ad performance for the business's own accounts. All of this data belongs to the business itself. The application does not collect personal information from outside consumers.</p>
        <div style={hd}>How we use it</div>
        <p style={p}>Information is used solely to run and analyze the business — tracking sales, inventory, margins, cash flow, and advertising. We do not use it for any other purpose.</p>
        <div style={hd}>How we protect it</div>
        <p style={p}>Connections use HTTPS/TLS encryption in transit. Stored data and access tokens are encrypted at rest and held server-side; access tokens are never exposed in the browser. Access to the application is limited to two authorized individuals and protected by password authentication.</p>
        <div style={hd}>Sharing</div>
        <p style={p}>We do not sell or rent any information. Data is shared only with the service providers required to operate the application (Plaid, Vercel, Upstash, and the Amazon, Shopify, and Google APIs), each under their own terms and privacy practices.</p>
        <div style={hd}>Plaid</div>
        <p style={p}>When you connect a bank account, the connection is handled by Plaid Inc. Your bank login credentials are entered directly into Plaid's secure interface and are never seen or stored by this application; we receive only the resulting balance and transaction data. Plaid's handling of that data is governed by the Plaid End User Privacy Policy at plaid.com/legal.</p>
        <div style={hd}>Data retention & deletion</div>
        <p style={p}>We retain data only as long as needed to operate the business. A connected bank can be disconnected at any time within the application, which deletes the stored access token. To request deletion of other stored data, contact us.</p>
        <div style={hd}>Contact</div>
        <p style={p}>For any privacy question or request, contact the business owner at the email associated with the Lavalle Haus account.</p>
      </div>
    </div>
  );
}

function RetentionModal({ onClose }) {
  const wrap = { position: "fixed", inset: 0, background: "rgba(26,23,20,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 };
  const card = { background: "#FFFFFF", border: "1px solid #E0E0DD", borderRadius: 2, maxWidth: 680, maxHeight: "85vh", overflowY: "auto", padding: "28px 32px", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" };
  const h = { fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", color: "#1A1A1A" };
  const p = { fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 13, lineHeight: 1.6, color: "#2A2A28", margin: "8px 0" };
  const hd = { fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#8F8676", marginTop: 18 };
  return (
    <div style={wrap} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ ...h, fontSize: 26, fontWeight: 400, margin: 0 }}>Data Retention & Deletion Policy</h1>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, color: "#71716C", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 10, color: "#71716C", letterSpacing: 1, marginBottom: 6 }}>Owner: Lavalle Haus · Applies to Lavalle Haus OS · Last reviewed June 2026 · Reviewed at least annually</div>
        <div style={hd}>1. Principle</div>
        <p style={p}>We retain only the data needed to operate the business, for only as long as it is useful for that purpose, and we provide clear ways to delete it.</p>
        <div style={hd}>2. What we store and for how long</div>
        <p style={p}><b>Business operational data</b> (inventory, sales, advertising, margins, financial figures): retained while the application is in active use, as it forms the ongoing operating record of the business.</p>
        <p style={p}><b>Bank connection tokens (Plaid):</b> retained only while the bank is connected. Disconnecting a bank within the application immediately deletes its stored access token and stops further data retrieval.</p>
        <p style={p}><b>Bank balance and transaction data:</b> retrieved on demand to display current figures; only the data needed for cash-flow and runway tracking is kept.</p>
        <p style={p}><b>Third-party API credentials</b> (Amazon, Shopify, Google, Plaid): stored server-side as environment variables or encrypted database entries, and removed when an integration is no longer used.</p>
        <div style={hd}>3. Deletion</div>
        <p style={p}>A connected bank can be removed at any time using the disconnect control in the application; this deletes the associated access token via Plaid's item-removal process. Other stored data can be deleted on request by the business owners. When the application is retired, its database key and all connected-integration tokens are deleted.</p>
        <div style={hd}>4. Compliance & review</div>
        <p style={p}>This policy is reviewed at least once per year, and whenever data sources or applicable privacy laws change, to confirm it remains accurate and compliant.</p>
      </div>
    </div>
  );
}

// One-time "get it on your phone" banner. Androids/desktops get a real
// Install button (beforeinstallprompt); iPhones get the two-tap Share →
// Add to Home Screen guide. Hidden forever once the app runs installed
// (standalone); dismiss snoozes it for a week.
function InstallAppNudge() {
  const [deferred, setDeferred] = useState(null);
  const [show, setShow] = useState(false);
  const [guide, setGuide] = useState(false); // full-screen iOS how-to
  const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  useEffect(() => {
    if (standalone) return;
    try { if (Date.now() < parseInt(localStorage.getItem("lh_install_snooze") || "0", 10)) return; } catch {}
    const onBip = (e) => { e.preventDefault(); setDeferred(e); setShow(true); };
    window.addEventListener("beforeinstallprompt", onBip);
    if (isIOS) setShow(true);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []); // eslint-disable-line
  if (!show || standalone) return null;
  const snooze = (e) => { if (e) e.stopPropagation(); try { localStorage.setItem("lh_install_snooze", String(Date.now() + 7 * 86400000)); } catch {} setShow(false); setGuide(false); };
  const activate = async () => {
    if (deferred) { try { deferred.prompt(); await deferred.userChoice; } catch {} setShow(false); return; }
    setGuide(true); // iOS: show the big visual guide
  };
  return (
    <>
      {/* Banner rides at the TOP — Safari's floating bottom bar was swallowing
          taps when it sat at the bottom. The whole banner is one big button. */}
      <div onClick={activate} role="button"
        style={{ position: "fixed", left: 10, right: 10, top: "calc(env(safe-area-inset-top, 0px) + 10px)", zIndex: 400, background: "#1A1A1A", color: "#F4F2EC", borderRadius: 6, padding: "13px 14px", boxShadow: "0 12px 40px rgba(0,0,0,0.4)", fontFamily: "'Jost', sans-serif", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
        <img src="/icons/icon-192.png" alt="" style={{ width: 38, height: 38, borderRadius: 8, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase" }}>Put Lavalle Haus on your phone</div>
          <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 12, opacity: 0.85 }}>{deferred ? "Tap here to install it like a normal app." : "Tap here — 2 quick steps."}</div>
        </div>
        <button onClick={snooze} style={{ border: "1px solid rgba(244,242,236,0.4)", background: "transparent", color: "#F4F2EC", borderRadius: 2, padding: "9px 11px", fontFamily: "'Jost', sans-serif", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer", flexShrink: 0 }}>Later</button>
      </div>
      {guide && (
        <div onClick={() => setGuide(false)} style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#F4F2EC", color: "#1A1A1A", borderRadius: 8, padding: "26px 22px", maxWidth: 330, width: "100%", fontFamily: "'Jost', sans-serif", textAlign: "center" }}>
            <img src="/icons/icon-192.png" alt="" style={{ width: 56, height: 56, borderRadius: 12, marginBottom: 12 }} />
            <div style={{ fontSize: 13, letterSpacing: 2, textTransform: "uppercase", marginBottom: 18 }}>Two taps in Safari</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", marginBottom: 14 }}>
              <div style={{ fontSize: 26, width: 40, textAlign: "center" }}>⬆️</div>
              <div style={{ fontFamily: "Georgia, serif", fontSize: 14 }}><b>1.</b> Tap the <b>Share</b> button — the square with the arrow, at the bottom middle of Safari.</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", marginBottom: 20 }}>
              <div style={{ fontSize: 26, width: 40, textAlign: "center" }}>➕</div>
              <div style={{ fontFamily: "Georgia, serif", fontSize: 14 }}><b>2.</b> Scroll the list and tap <b>"Add to Home Screen"</b>, then <b>Add</b>.</div>
            </div>
            <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 12.5, color: "#71716C", marginBottom: 18 }}>The LH icon lands on your home screen — from then on it opens like any app.</div>
            <button onClick={() => setGuide(false)} style={{ border: "none", background: "#1A1A1A", color: "#F4F2EC", borderRadius: 3, padding: "12px 22px", fontFamily: "'Jost', sans-serif", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" }}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
// The Business Brain home is ALWAYS the first screen — the saved tab only
// survives in-session; a fresh open lands home, like a storefront.
// Refresh keeps you where you were — the tab is validated against the
// person's visible pages below, so nobody lands on a page they can't see.
const [tab, setTab] = useState(() => { try { return localStorage.getItem("lh_tab") || "brain"; } catch { return "brain"; } });
// App-level reel finisher: on ANY screen, every ~12s, nudge any post still
// converting/processing so reels finish without babysitting the board. Reads
// server truth (not local state), so it never clobbers the live status.
useEffect(() => {
  const tick = async () => {
    try {
      if (!localStorage.getItem("lh_token")) return;
      if (document.hidden) return; // backgrounded tabs don't burn bandwidth
      // Tiny probe (<1KB) instead of the full data blob — the old 12s full-blob
      // fetch on every device is what blew Vercel's origin-transfer cap.
      const rec = await (await fetch("/api/data?op=pub_inflight", { cache: "no-store" })).json();
      for (const j of rec.jobs || []) { try { await fetch("/api/data?op=publish_item", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boardKey: j.bk, cardId: j.id, account: j.account }) }); } catch {} }
    } catch {}
  };
  const t = setInterval(tick, 20000);
  return () => clearInterval(t);
}, []);
// Recently-viewed sections, per person — feeds the OS boards strip on home.
useEffect(() => {
  if (tab === "brain") return;
  try {
    const cur = JSON.parse(localStorage.getItem("lh_recent_tabs") || "[]");
    localStorage.setItem("lh_recent_tabs", JSON.stringify([tab, ...cur.filter((x) => x !== tab)].slice(0, 6)));
  } catch {}
}, [tab]);
// Business Brain theme (day/night) + Command View overlay
const [brainTheme, setBrainTheme] = useState(() => { try { return localStorage.getItem("lh_theme") || "day"; } catch { return "day"; } });
useEffect(() => { try { localStorage.setItem("lh_theme", brainTheme); } catch {} }, [brainTheme]);
const [commandView, setCommandView] = useState(false);
const [askSeed, setAskSeed] = useState(null);
const [sub, setSub] = useState(() => { try { return JSON.parse(localStorage.getItem("lh_sub") || "{}"); } catch { return {}; } });
useEffect(() => { try { localStorage.setItem("lh_tab", tab); localStorage.setItem("lh_sub", JSON.stringify(sub)); } catch {} }, [tab, sub]);
const [products, setProducts] = useState(INITIAL_PRODUCTS);
const [materials, setMaterials] = useState(MATERIALS);
const [weeks, setWeeks] = useState([]);
const [campaigns] = useState(INITIAL_CAMPAIGNS);
const [dbState, setDbState] = useState({ products: INITIAL_PRODUCTS, materials: MATERIALS, weekly: [], profitMatrix: {}, cogs: {}, keywords: INITIAL_KEYWORDS, wholesale: [], pnl: {}, googleAds: [], metaAds: [], emailRetention: [], deletedProducts: [] });
const [loaded, setLoaded] = useState(false);
const [showPrivacy, setShowPrivacy] = useState(false);
const [showRetention, setShowRetention] = useState(false);
const [shopify, setShopify] = useState({ connected: false, items: {}, sold: {}, ugc: {}, variantDetail: {}, unmatched: [], soldUnmatched: [], syncedAt: null, syncing: false });
const [shopifySales, setShopifySales] = useState(null);
async function fetchShopifySales() { try { const r = await fetch("/api/shopify-sync?op=sales").then((x) => x.json()); if (r && r.periods) setShopifySales(r); } catch (e) {} }
const [amazonSales, setAmazonSales] = useState(null);
async function fetchAmazonSales() { try { const r = await fetch("/api/amazon-sync?op=sales").then((x) => x.json()); if (r && r.periods) setAmazonSales(r); } catch (e) {} }

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

// ── SELLER CENTRAL NATIVE RESTOCK (on-demand; report is rate-limited) ──
const [restock, setRestock] = useState({ items: {}, syncedAt: null, status: "idle", error: null });
function restockSync(force) {
const startedAt = Date.now();
let polls = 0;
setRestock((s) => ({ ...s, status: "pending", error: null, startedAt }));
const run = async () => {
try {
const url = "/api/amazon-sync?op=restock" + (force && polls === 0 ? "&force=1" : "");
const d = await fetch(url, { method: "GET" }).then((r) => r.json());
if (d && d.ready) {
const items = {};
(d.items || []).forEach((it) => { items[it.productId] = it; });
setRestock({ items, syncedAt: d.syncedAt, status: "ready", error: null, startedAt: null, statusDetail: null, rows: d.rows, matched: d.matched });
setDbState((prev) => { const next = { ...prev, amazonRestock: { items, syncedAt: d.syncedAt } }; dbSave(next); return next; });
return;
}
if (d && d.error) { setRestock((s) => ({ ...s, status: "error", error: d.error })); return; }
if (d && d.status) setRestock((s) => (s.status === "pending" ? { ...s, statusDetail: d.status } : s));
polls += 1;
if (polls > 100) { setRestock((s) => ({ ...s, status: "timeout", error: null })); return; } // ~10 min; resume keeps the same in-flight report
setTimeout(run, 6000);
} catch (e) { setRestock((s) => ({ ...s, status: "error", error: "Connection error." })); }
};
run();
}

// ── AUTO-FETCH SHOPIFY + AMAZON ON LOAD ──
useEffect(() => { shopifySync(); amazonSync(); fetchShopifySales(); fetchAmazonSales(); }, []);

// Auto-pull Seller Central restock once data has loaded — no button required.
// The backend serves a 12h cache instantly and only regenerates (in the
// background) when stale, so this is cheap on every load.
const restockAutoRef = useRef(false);
useEffect(() => { if (!loaded || restockAutoRef.current) return; restockAutoRef.current = true; restockSync(); }, [loaded]);

// ── APP LOCK state: any API 401 anywhere flips this and shows the login ──
const [locked, setLocked] = useState(false);
useEffect(() => {
  const onLock = () => setLocked(true);
  window.addEventListener("lh-locked", onLock);
  return () => window.removeEventListener("lh-locked", onLock);
}, []);

// ── IDENTITY REFRESH ── role/pages edits on the roster apply on the member's
// next page load, not their next login: re-pull who-am-I and update lh_user.
const [, setMeVersion] = useState(0);
useEffect(() => {
  (async () => {
    try {
      const cur = JSON.parse(localStorage.getItem("lh_user") || "null");
      if (!cur) return;
      const r = await fetch("/api/data?op=me");
      if (!r.ok) return;
      const d = await r.json();
      const next = { ...cur, name: d.name, role: d.role, email: d.email, pages: d.pages || null };
      if (JSON.stringify(next) !== JSON.stringify(cur)) {
        localStorage.setItem("lh_user", JSON.stringify(next));
        setMeVersion(v => v + 1);
      }
    } catch (e) {}
  })();
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
const _marginsModel = buildMarginsModel({ cogs: dbState.cogs || {}, products, campaigns, profitMatrix: dbState.profitMatrix || {}, settings: dbState.margins || {} });
const _marginFlags = _marginsModel.flags;
const _liveActions = _storedActions.filter(a => a.status !== "done" && a.status !== "resolved");
const openHighActions = _liveActions.length ? _liveActions.filter(a => a.severity === "high").length : _marginFlags.filter(f => f.severity === "high").length;

// ── BUSINESS BRAIN MODEL — one live config drives the landing page + Command View ──
// ── ROLE GATING (Team Portal spec) ── the house password and Owner / Admin see
// everything; Managers see everything except bank + cash runway; Team Members
// work in operations; Viewers get read-oriented spaces. Server enforces the
// financial ops too — hiding tabs is presentation, not the lock.
const me = (() => { try { return JSON.parse(localStorage.getItem("lh_user") || "null"); } catch { return null; } })();
const myRole = (me && me.role) || "Owner / Admin";
const iAmOwner = /^owner/i.test(myRole);
const ROLE_TABS = {
  "Manager": ["brain", "profit", "ads", "inventory", "growth", "content", "calendar", "roadmap", "materials", "ai"],
  "Team Member": ["inventory", "growth", "content", "calendar", "roadmap", "materials"],
  "Viewer": ["content", "calendar", "roadmap"],
};
const HIDDEN_SUBS = iAmOwner ? {} : { profit: ["finances", "finance"] };
// A per-person pages list (set on the Team roster) replaces the role default.
const myPages = (!iAmOwner && me && Array.isArray(me.pages) && me.pages.length)
  ? me.pages
  : (ROLE_TABS[myRole] || ROLE_TABS["Viewer"]);

// The full signal set for the brain; staff get it through their lens so the
// bubbles — and the percentage itself — are their own.
const brainCtx = {
businessName: "Lavalle Haus",
products: products.map(p => ({ ...p, _status: stockStatus(p, shopify, amazon) })),
campaigns,
flags: _marginFlags,
shopifySales, amazonSales,
bankCash: dbState.bankCash || null,
pnl: dbState.pnl || {},
actionsBoard: dbState.actionsBoard || {},
wholesale: dbState.wholesale || [],
accountHealth: dbState.amazonAccountHealth || null,
cashRunwayWeeks: null,
marginsSummary: _marginsModel.summary || null,
metaAds: dbState.metaAds || [],
};
const brainModel = buildBrainModel({ ...brainCtx, lensTabs: iAmOwner ? null : myPages });
const goTo = (nav) => {
if (!nav) return;
setCommandView(false);
setTab(nav.tab);
if (nav.sub) setSub(s => ({ ...s, [nav.tab]: nav.sub }));
};
const askChief = (question) => {
setCommandView(false);
setAskSeed(question);
setTab("ai");
setSub(s => ({ ...s, ai: "advisor" }));
};
// Search results land here: tab, optional sub-tab, optional pill section.
const goSearch = (dest) => {
setCommandView(false);
setTab(dest.tab);
if (dest.sub) setSub((s) => ({ ...s, [dest.tab]: dest.sub }));
if (dest.seg) {
try { localStorage.setItem("lh_seg_" + dest.seg.id, dest.seg.seg); } catch {}
// brief delay so a freshly mounted SegTabs is listening before the event fires
setTimeout(() => window.dispatchEvent(new CustomEvent("lh-seg", { detail: dest.seg })), 80);
}
};

// ── 8-TAB OPERATING SYSTEM NAV (each metric has one permanent home) ──
const NAV = [
{ id: "brain", label: "Business Brain", labelEs: "Cerebro del negocio" },
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
{ id: "wholesalehub", label: "Wholesale" },
{ id: "creative", label: "Creative Studio" },
{ id: "email", label: "Email / Retention" },
{ id: "weeklynums", label: "Weekly Numbers" },
{ id: "checklist", label: "Action Items" },
] },
{ id: "content", label: "Content", labelEs: "Contenido" },
{ id: "calendar", label: "Calendar", labelEs: "Calendario" },
{ id: "roadmap", label: "Roadmap", labelEs: "Hoja de ruta" },
{ id: "materials", label: "Materials", labelEs: "Materiales", subs: [
{ id: "suppliers", label: "Supplier Database" },
{ id: "priceoz", label: "Price / Oz" },
] },
{ id: "ai", label: "✦ AI", labelEs: "Asesor AI", subs: [{ id: "coo", label: "AI COO" }, { id: "advisor", label: "Advisor" }] },
];

const visibleNav = NAV
  // the Business Brain home is for everyone — its bubbles, insights and the
  // health percentage itself already pass through the person's lens
  .filter(n => iAmOwner || n.id === "brain" || myPages.includes(n.id))
  .map(n => n.subs && HIDDEN_SUBS[n.id] ? { ...n, subs: n.subs.filter(s => !HIDDEN_SUBS[n.id].includes(s.id)) } : n);

if (!visibleNav.some(n => n.id === tab)) { setTab(visibleNav[0].id); return null; }

const activeNav = visibleNav.find(n => n.id === tab) || visibleNav[0];
const activeSub = activeNav.subs ? (activeNav.subs.some(s => s.id === sub[tab]) ? sub[tab] : activeNav.subs[0].id) : null;
const setSubFor = (id) => setSub(s => ({ ...s, [tab]: id }));

if (!loaded) {
return (
<div style={{ minHeight: "100vh", background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
<div style={{ fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 12, color: "#9A9A95", letterSpacing: 3 }}>LOADING...</div>
</div>
);
}

// Live restock status/timer, but fall back to the persisted pull for items +
// timestamp so the page is never blank while a background refresh runs.
const restockMerged = {
...restock,
items: (restock.items && Object.keys(restock.items).length) ? restock.items : ((dbState.amazonRestock || {}).items || {}),
syncedAt: restock.syncedAt || (dbState.amazonRestock || {}).syncedAt || null,
};

const profitNode = (
<ProfitMatrix
data={dbState.profitMatrix || {}}
liveSales={{ shopify: shopifySales, amazon: amazonSales }}
onSave={(pm) => {
setDbState((prev) => { const next = { ...prev, profitMatrix: { products: pm.products, opex: pm.opex, keep: pm.keep, assignees: pm.assignees, profitAdjustments: pm.adjustments, profitManual: pm.manual } }; dbSave(next); return next; });
}}
/>
);

function renderBody() {
if (tab === "brain") {
// Home IS the Command View experience, living under the main-tab header —
// like a storefront homepage. Narrow screens get the vertical summary.
// Owners get the Team lens strip: preview any member's bubbles + their own
// percentage, and the tab ↔ Drive folder map.
const lensStrip = iAmOwner ? (
  <TeamLens
    scoreFor={(tabs) => buildBrainModel({ ...brainCtx, lensTabs: tabs }).healthScore}
    driveMap={dbState.driveMap || {}}
    onSaveDriveMap={(dm) => setDbState((prev) => { const next = { ...prev, driveMap: dm }; dbSave(next); return next; })}
    navTabs={NAV}
  />
) : null;
const osBoards = (
  <OSBoards
    nav={visibleNav}
    tiles={dbState.tabTiles || {}}
    onSaveTile={(id, bg) => setDbState((prev) => { const next = { ...prev, tabTiles: { ...(prev.tabTiles || {}), [id]: { bg } } }; dbSave(next); return next; })}
    iAmOwner={iAmOwner}
    roleTabs={ROLE_TABS}
    goTo={goTo}
  />
);
if (typeof window !== "undefined" && window.innerWidth < 760) {
return (
<div>
{lensStrip}
<CommandDashboard model={brainModel} onNavigate={goTo} />
{osBoards}
</div>
);
}
return (
<div>
{lensStrip}
<CommandDashboard model={brainModel} onNavigate={goTo} />
{osBoards}
</div>
);
}
if (tab === "profit") {
if (activeSub === "amazondaily") return <AmazonProfit products={products} accountHealth={dbState.amazonAccountHealth || null} onSaveHealth={(h) => setDbState((prev) => { const next = { ...prev, amazonAccountHealth: h }; dbSave(next); return next; })} />;
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
if (tab === "content") return (
<SegTabs id="content" segments={[
{ id: "boards", label: "Boards", render: () => <Boards data={dbState.boards || null} gridPlanner={dbState.gridPlanner || null} team={(dbState.actionsBoard || {}).team || []} viewer={{ name: (me && me.name) || "", email: (me && me.email) || "", owner: iAmOwner }} onSave={(bv) => setDbState((prev) => { const next = { ...prev, boards: bv }; dbSave(next); return next; })} onSaveTeam={(tv) => setDbState((prev) => { const next = { ...prev, actionsBoard: { ...(prev.actionsBoard || {}), team: tv } }; dbSave(next); return next; })} /> },
{ id: "brandgrids", label: "Grids", render: () => <BrandGrids boards={dbState.boards || null} data={dbState.brandGrids || null} onSave={(gv) => setDbState((prev) => { const next = { ...prev, brandGrids: gv }; dbSave(next); return next; })} onSaveBoards={(bv) => setDbState((prev) => { const next = { ...prev, boards: bv }; dbSave(next); return next; })} /> },
{ id: "grid", label: "Schedule", render: () => <GridPlanner data={dbState.gridPlanner || null} boards={dbState.boards || null} onSave={(gv) => setDbState((prev) => { const next = { ...prev, gridPlanner: gv }; dbSave(next); return next; })} onSaveBoards={(bv) => setDbState((prev) => { const next = { ...prev, boards: bv }; dbSave(next); return next; })} /> },
{ id: "analytics", label: "Analytics", render: () => <ContentAnalytics /> },
]} />
);
if (tab === "calendar") return <OpsCalendar boards={dbState.boards || null} shoots={dbState.opsShoots || []} onSaveShoots={(s) => setDbState((prev) => { const next = { ...prev, opsShoots: s }; dbSave(next); return next; })} onSetLaunchMonth={(bk, cardId, month) => setDbState((prev) => { const boards = { ...(prev.boards || {}) }; const b = boards[bk]; if (b) boards[bk] = { ...b, cards: (b.cards || []).map((cd) => (cd.id === cardId ? { ...cd, launchMonth: month || null } : cd)) }; const next = { ...prev, boards }; dbSave(next); return next; })} />;
if (tab === "roadmap") return <RoadmapTab />;
if (tab === "ai") {
if (activeSub === "advisor") return <AITab products={products} campaigns={campaigns} initialQuestion={askSeed} onSeedConsumed={() => setAskSeed(null)} />;
return <AICoo
products={products} campaigns={campaigns} weeks={weeks} materials={materials}
cogs={dbState.cogs || {}} profitMatrix={dbState.profitMatrix || {}}
marginsSettings={dbState.margins || {}} bankCash={dbState.bankCash || null}
restock={restockMerged} onRestockSync={restockSync}
actionsBoard={dbState.actionsBoard || {}}
onAddAction={(item) => setDbState((prev) => { const board = prev.actionsBoard || { items: [], team: [] }; const next = { ...prev, actionsBoard: { ...board, items: [item, ...(board.items || [])] } }; dbSave(next); return next; })}
onRemoveAction={(id) => setDbState((prev) => { const board = prev.actionsBoard || { items: [], team: [] }; const next = { ...prev, actionsBoard: { ...board, items: (board.items || []).filter((x) => x.id !== id) } }; dbSave(next); return next; })}
/>;
}
if (tab === "ads") {
if (activeSub === "ppc") return <AdsTab campaigns={campaigns} />;
if (activeSub === "keywords") return <KeywordsTab products={products} setProducts={setProducts} dbState={dbState} setDbState={setDbState} />;
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
if (activeSub === "reorder") return <ReorderList
products={products} packaging={dbState.packagingItems || []} materials={materials}
amazon={amazon} shopify={shopify} onAmazonSync={amazonSync} onShopifySync={shopifySync}
restock={restockMerged} onRestockSync={restockSync}
data={dbState.reorder || {}}
onSave={(r) => setDbState((prev) => { const next = { ...prev, reorder: r }; dbSave(next); return next; })}
onAddAction={(item) => setDbState((prev) => { const board = prev.actionsBoard || { items: [], team: [] }; const next = { ...prev, actionsBoard: { ...board, items: [item, ...(board.items || [])] } }; dbSave(next); return next; })}
onRemoveAction={(id) => setDbState((prev) => { const board = prev.actionsBoard || { items: [], team: [] }; const next = { ...prev, actionsBoard: { ...board, items: (board.items || []).filter((x) => x.id !== id) } }; dbSave(next); return next; })}
/>;
}
if (tab === "growth") {
// legacy saved sub ids map into the consolidated sections
const GROWTH_LEGACY = { wholesale: "wholesalehub", wholesalepage: "wholesalehub", outreachtimeline: "wholesalehub", retail: "wholesalehub", poppy: "creative", competitors: "creative", creators: "creative" };
const gsub = GROWTH_LEGACY[activeSub] || activeSub;
if (gsub === "wholesalehub") return (
<SegTabs id="wholesale" segments={[
{ id: "accounts", label: "Accounts", render: () => <Wholesale data={dbState.wholesale || []} onSave={(wv) => { setDbState((prev) => { const next = { ...prev, wholesale: wv }; dbSave(next); return next; }); }} /> },
{ id: "outreach", label: "Retail Outreach", render: () => <EmbeddedPage src="/wholesale.html" title="Store-by-store outreach emails — 239 stores by category" openLabel="Open full window" /> },
{ id: "timeline", label: "Outreach Timeline", render: () => <EmbeddedPage src="/wholesale-outreach.html" title="Follow-up cadence per store — three-email timeline" openLabel="Open full window" /> },
{ id: "retailexp", label: "Retail Expansion", render: () => <Tracker title="Retail Expansion" intro="Atlas, Faire, spa accounts and independent retailers." columns={[{ key: "account", label: "Account", type: "text" }, { key: "type", label: "Type", type: "select", options: ["Atlas", "Faire", "Spa", "Retailer", "Other"] }, { key: "location", label: "Location", type: "text" }, { key: "status", label: "Status", type: "select", options: ["Prospect", "Pitched", "Open", "Active", "Paused"] }, { key: "notes", label: "Notes", type: "text" }]} data={dbState.retail || []} onSave={(r) => setDbState((prev) => { const next = { ...prev, retail: r }; dbSave(next); return next; })} addLabel="+ Add account" /> },
]} />
);
if (gsub === "creative") return (
<SegTabs id="creative" segments={[
{ id: "poppy", label: "Poppy Framework", render: () => <PoppyStudio /> },
{ id: "competitors", label: "Competitor Intel", render: () => <Tracker title="Competitor Intelligence" intro="Track rival launches, promos, pricing and packaging moves." columns={[{ key: "brand", label: "Brand", type: "text" }, { key: "update", label: "Update", type: "text" }, { key: "type", label: "Type", type: "select", options: ["Launch", "Promo", "Pricing", "Packaging", "Other"] }, { key: "date", label: "Date", type: "text" }, { key: "link", label: "Link", type: "url" }, { key: "notes", label: "Notes", type: "text" }]} data={dbState.competitors || []} onSave={(r) => setDbState((prev) => { const next = { ...prev, competitors: r }; dbSave(next); return next; })} addLabel="+ Add note" /> },
{ id: "creators", label: "Creators", render: () => <Tracker title="Influencer / Creator Program" intro="Creators, deliverables, cost and the revenue they drive." columns={[{ key: "creator", label: "Creator", type: "text" }, { key: "handle", label: "Handle", type: "text" }, { key: "deliverables", label: "Deliverables", type: "text" }, { key: "cost", label: "Cost", type: "number" }, { key: "status", label: "Status", type: "select", options: ["Pitched", "Confirmed", "Live", "Paid", "Done"] }, { key: "revenue", label: "Revenue", type: "number" }, { key: "notes", label: "Notes", type: "text" }]} data={dbState.creators || []} onSave={(r) => setDbState((prev) => { const next = { ...prev, creators: r }; dbSave(next); return next; })} addLabel="+ Add creator" /> },
]} />
);
if (gsub === "email") return <EmailRetention data={dbState.emailRetention || []} onSave={(r) => { setDbState((prev) => { const next = { ...prev, emailRetention: r }; dbSave(next); return next; }); }} />;
if (gsub === "weeklynums") return <WeeklyTab weeks={weeks} setWeeks={setWeeks} dbState={dbState} setDbState={setDbState} />;
if (gsub === "checklist") return <ActionsBoard data={dbState.actionsBoard || {}} flags={_marginFlags} recurring={CHECKLIST_ITEMS} canInvite={iAmOwner} onSave={(payload) => { setDbState((prev) => { const next = { ...prev, actionsBoard: payload }; dbSave(next); return next; }); }} />;
return null;
}
if (tab === "materials") {
if (activeSub === "priceoz") return <PriceOzTab />;
if (activeSub === "suppliers") return <Tracker title="Supplier Database" intro="Every supplier — contact, MOQ, lead time, cost, reorder link." columns={[{ key: "name", label: "Supplier", type: "text" }, { key: "category", label: "Category", type: "text" }, { key: "contact", label: "Contact", type: "text" }, { key: "moq", label: "MOQ", type: "number" }, { key: "leadTime", label: "Lead time", type: "text" }, { key: "cost", label: "Cost", type: "number" }, { key: "link", label: "Link", type: "url" }, { key: "notes", label: "Notes", type: "text" }]} data={dbState.suppliers || []} onSave={(r) => setDbState((prev) => { const next = { ...prev, suppliers: r }; dbSave(next); return next; })} addLabel="+ Add supplier" />;
}
return null;
}

const inviteToken = new URLSearchParams(window.location.search).get("invite");
if (inviteToken) return <AcceptInvite invite={inviteToken} />;
if (locked) return <LoginScreen />;

const hour = new Date().getHours();
const timeOfDay = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

return (
<div style={{ minHeight: "100vh", background: "#FFFFFF", color: "#1A1A1A", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>
<div style={{ background: "#F4F4F3", borderBottom: "1px solid #E0E0DD", padding: "18px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
<button onClick={() => { setCommandView(false); setTab(visibleNav[0].id); }} title="Home"
style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", color: "inherit" }}>
<div style={{ fontSize: 10, letterSpacing: 5, color: "#8A8A85", textTransform: "uppercase", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: 3 }}>Lavalle Haus</div>
<div style={{ fontSize: 20, letterSpacing: 2, fontWeight: 300, textTransform: "uppercase" }}>Operating System</div>
{me && me.name && <div style={{ fontSize: 11, fontStyle: "italic", color: "#8F8676", marginTop: 3 }}>{timeOfDay}, {me.name.split(" ")[0]}.</div>}
</button>
<GlobalSearch nav={visibleNav} dbState={dbState} onGo={goSearch} />
<div style={{ display: "flex", gap: 8 }}>
{[
{ label: "SKUs", value: products.length, color: "#71716C" },
{ label: "Alerts", value: criticalCount + pauseCount + openHighActions, color: criticalCount + pauseCount + openHighActions > 0 ? "#9b5e5e" : "#5a7a5a" },
{ label: "Campaigns", value: campaigns.length, color: "#7a7a9a" },
].map(s => (
<div key={s.label} style={{ textAlign: "center", padding: "7px 12px", background: "#F4F4F3", borderRadius: 1, border: "1px solid #E0E0DD" }}>
<div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif" }}>{s.value}</div>
<div style={{ fontSize: 9, color: "#9A9A95", letterSpacing: 1, textTransform: "uppercase" }}>{s.label}</div>
</div>
))}
{visibleNav.some(n => n.id === "brain") && <button onClick={() => setCommandView(true)}
  title="Open Command View — vista de comando"
  style={{ padding: "7px 12px", background: "transparent", border: "1px solid #E0E0DD", borderRadius: 1, color: "#71716C", fontSize: 9, letterSpacing: 2, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", cursor: "pointer", textTransform: "uppercase" }}>
  ⌘ Command View
</button>}
<button onClick={() => { localStorage.removeItem("lh_token"); localStorage.removeItem("lh_user"); window.location.reload(); }}
  title="Lock the app — cerrar con llave"
  style={{ padding: "7px 12px", background: "transparent", border: "1px solid #E0E0DD", borderRadius: 1, color: "#71716C", fontSize: 9, letterSpacing: 2, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", cursor: "pointer", textTransform: "uppercase" }}>
  ⏻ Lock
</button>
</div>
</div>

{/* TOP NAV — 7 permanent homes */}
<div style={{ background: "#F4F4F3", borderBottom: "1px solid #E0E0DD", padding: "0 24px", display: "flex", gap: 0, overflowX: "auto", WebkitOverflowScrolling: "touch", alignItems: "center", position: "sticky", top: 0, zIndex: 40, maxWidth: "100vw" }}>
{visibleNav.map(n => (
<button key={n.id} onClick={() => { setTab(n.id); if (n.id === "content") window.dispatchEvent(new CustomEvent("lh-seg-click", { detail: { id: "content", seg: "boards" } })); }} style={{ flexShrink: 0, background: "none", border: "none", borderBottom: tab === n.id ? "2px solid #A39B8B" : "2px solid transparent", color: tab === n.id ? "#1A1A1A" : "#9A9A95", padding: "11px 14px", cursor: "pointer", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: -1, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
{n.label}
{n.alert && <span style={{ fontSize: 9, background: "#9b5e5e", color: "#fff", borderRadius: 1, padding: "1px 5px" }}>{n.alert}</span>}
</button>
))}
{(dbState.driveMap || {})[tab] && (
<a href={dbState.driveMap[tab]} target="_blank" rel="noopener noreferrer" title="This tab's Drive folder"
style={{ marginLeft: "auto", flexShrink: 0, border: "1px solid #E0E0DD", borderRadius: 1, padding: "4px 10px", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#8F8676", textDecoration: "none", whiteSpace: "nowrap" }}>
Drive ⤴
</a>
)}
</div>

{/* SUB NAV — appears for tabs that have sections */}
{activeNav.subs && (
<div style={{ background: "#FAFAF9", borderBottom: "1px solid #E8E8E6", padding: "0 24px", display: "flex", gap: 0, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
{activeNav.subs.map(s => (
<button key={s.id} onClick={() => setSubFor(s.id)} style={{ flexShrink: 0, background: "none", border: "none", borderBottom: activeSub === s.id ? "2px solid #A39B8B" : "2px solid transparent", color: activeSub === s.id ? "#1A1A1A" : "#9A9A95", padding: "9px 13px", cursor: "pointer", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", marginBottom: -1, whiteSpace: "nowrap" }}>
{s.label}
</button>
))}
</div>
)}

<div style={(tab === "profit" || tab === "brain") ? {} : tab === "content" ? { padding: "22px 24px" } : { padding: "22px 24px", maxWidth: 960, margin: "0 auto" }}>
{renderBody()}
</div>
<div style={{ borderTop: "1px solid #E8E8E6", padding: "14px 24px", display: "flex", justifyContent: "center", gap: 12, fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 10, letterSpacing: 1, color: "#9A9A95" }}>
<span>© {new Date().getFullYear()} Lavalle Haus</span>
<span>·</span>
<button onClick={() => setShowPrivacy(true)} style={{ background: "none", border: "none", color: "#8F8676", cursor: "pointer", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 10, letterSpacing: 1, textDecoration: "underline", padding: 0 }}>Privacy Policy</button>
<span>·</span>
<button onClick={() => setShowRetention(true)} style={{ background: "none", border: "none", color: "#8F8676", cursor: "pointer", fontFamily: "'Jost', 'Helvetica Neue', Arial, sans-serif", fontSize: 10, letterSpacing: 1, textDecoration: "underline", padding: 0 }}>Data Retention</button>
</div>
{showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
{showRetention && <RetentionModal onClose={() => setShowRetention(false)} />}
{commandView && (
<CommandView
model={brainModel}
themeId={brainTheme}
onToggleTheme={() => setBrainTheme(th => th === "day" ? "night" : "day")}
onExit={() => setCommandView(false)}
onNavigate={goTo}
onAsk={askChief}
/>
)}
<InstallAppNudge />
</div>
);
}
