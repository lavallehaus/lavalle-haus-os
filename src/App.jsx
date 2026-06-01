import { useState, useEffect, useCallback } from "react";

// ── JSONBIN DATABASE ─────────────────────────────────────────────────────────
const BIN_ID = "6a1ddc11f5f4af5e29a98828";
const BIN_KEY = "$2a$10$x5athd/h30hd.smPNzviJOXs0M3WP14q6mHvQsKbIvLlnZMY7zFEG";
const BIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

let _cache = null;

async function binGet() {
try {
const res = await fetch(BIN_URL, { headers: { "X-Master-Key": BIN_KEY } });
const data = await res.json();
_cache = data.record;
return _cache;
} catch(e) { return _cache || { products: [], materials: [], weekly: [] }; }
}

async function binSet(record) {
try {
_cache = record;
await fetch(BIN_URL, {
method: "PUT",
headers: { "X-Master-Key": BIN_KEY, "Content-Type": "application/json" },
body: JSON.stringify(record),
});
} catch(e) { console.warn("binSet failed:", e); }
}

async function dbGet(table) {
const record = await binGet();
return record[table] || [];
}

async function dbUpsert(table, row) {
const record = await binGet();
const arr = record[table] || [];
const idx = arr.findIndex(r => r.id === row.id);
if (idx >= 0) arr[idx] = { ...arr[idx], ...row };
else arr.push(row);
record[table] = arr;
await binSet(record);
}

async function dbInsert(table, row) {
const record = await binGet();
const arr = record[table] || [];
arr.unshift(row);
record[table] = arr;
await binSet(record);
}

const FONT_LINK = "https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&display=swap";

// ── DATA ─────────────────────────────────────────────────────────────────────

const CHANNELS = ["Amazon", "Shopify", "Amazon + Shopify", "Coming Soon"];

const INITIAL_PRODUCTS = [
// ── AMAZON ──
{ id: 1, name: "SeaShell Vessel Candle", sku: "RH-SeaShell-9633", asin: "B0GR8452CL", available: 0, inbound: 200, unitsSold30: 0, price: 0, channels: ["Amazon"], status: "inbound", notes: "200 units incoming — launch campaigns on arrival" },
{ id: 2, name: "Beeswax Candle Sand 16oz", sku: "RH-Sandwax-AC-16c", asin: "B0GR1NWNG8", available: 30, inbound: 0, unitsSold30: 8, price: 26, channels: ["Amazon"], status: "ok", notes: "Main revenue driver. Phrase Match & H10 campaigns performing." },
{ id: 3, name: "Beeswax Candle Sand 32oz", sku: "RH-Sandwax-AC-32c", asin: "B0GR1KQ253", available: 30, inbound: 0, unitsSold30: 1, price: 46, channels: ["Amazon"], status: "slow", notes: "129 weeks supply. Very slow mover — pause ads, evaluate." },
{ id: 4, name: "Small Apple Vanilla Candle",sku: "RH-CANDLE-SM-AP", asin: "B0FVGM15JB", available: 55, inbound: 0, unitsSold30: 16, price: 18.99, channels: ["Amazon"], status: "ok", notes: "Best seller by units. Keep campaigns healthy." },
{ id: 5, name: "Large Apple Vanilla Candle",sku: "RH-CANDLE-LG-AP", asin: "B0FVGM15J7", available: 34, inbound: 0, unitsSold30: 8, price: 59, channels: ["Amazon"], status: "ok", notes: "Good velocity. Monitor stock — 18 weeks supply." },
{ id: 6, name: "Bath Salts Unscented", sku: "LH-BATH-SALT-UN", asin: "", available: 0, inbound: 0, unitsSold30: 0, price: 0, channels: ["Amazon"], status: "inbound", notes: "Upcoming Amazon launch. ASIN TBD." },
// ── SHOPIFY ONLY ──
{ id: 7, name: "Dough Bowl Vessel Candle", sku: "LH-VESSEL-DOUGH", asin: "", available: 0, inbound: 0, unitsSold30: 0, price: 0, channels: ["Shopify"], status: "ok", notes: "Shopify only. Add stock levels and pricing." },
{ id: 8, name: "Sugar Scrub", sku: "LH-SCRUB-SUGAR", asin: "", available: 0, inbound: 0, unitsSold30: 0, price: 38, channels: ["Shopify"], status: "ok", notes: "Shopify only. Manufacturing in Spain. Amazon launch in 3-4 months." },
// ── COMING SOON ──
{ id: 9, name: "Lavender Body Oil", sku: "LH-OIL-LAV", asin: "", available: 0, inbound: 0, unitsSold30: 0, price: 0, channels: ["Shopify"], status: "inbound", notes: "Shopify first. Plan Amazon launch — update channel when live." },
{ id: 10, name: "Moroccan Soap", sku: "LH-SOAP-MOR", asin: "", available: 0, inbound: 0, unitsSold30: 0, price: 0, channels: ["Shopify"], status: "inbound", notes: "Shopify only for now." },
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

// Profit Matrix — pre-filled where known, blanks for accountant
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

// Price Per Oz — your products + key competitors
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

function stockStatus(p) {
if (p.status === "inbound") return "inbound";
const w = weeksOfSupply(p.available, p.unitsSold30);
if (p.available === 0) return "out";
if (w < 6) return "low";
if (w > 50 && p.unitsSold30 < 3) return "slow";
return "ok";
}

const STATUS_STYLE = {
out: { color: "#9b5e5e", bg: "#9b5e5e14", label: "OUT OF STOCK" },
inbound: { color: "#a07848", bg: "#a0784814", label: "INBOUND" },
low: { color: "#a07848", bg: "#a0784814", label: "LOW STOCK" },
slow: { color: "#7a7a9a", bg: "#7a7a9a14", label: "SLOW MOVER" },
ok: { color: "#5a7a5a", bg: "#5a7a5a14", label: "HEALTHY" },
};

const CAMP_STYLE = {
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

function InventoryTab({ products, setProducts }) {
const [editing, setEditing] = useState(null);
const [draft, setDraft] = useState({});

function startEdit(p) { setEditing(p.id); setDraft({ available: p.available, inbound: p.inbound, unitsSold30: p.unitsSold30, notes: p.notes, channels: p.channels || ["Amazon"] }); }
function saveEdit(id) {
setProducts(prev => prev.map(p => p.id !== id ? p : { ...p, available: +draft.available || 0, inbound: +draft.inbound || 0, unitsSold30: +draft.unitsSold30 || 0, notes: draft.notes, channels: draft.channels }));
setEditing(null);
}
function toggleChannel(ch) {
setDraft(d => {
const has = d.channels.includes(ch);
const next = has ? d.channels.filter(c => c !== ch) : [...d.channels, ch];
return { ...d, channels: next.length ? next : [ch] };
});
}

const sorted = [...products].sort((a, b) => {
const order = { out: 0, low: 1, inbound: 2, slow: 3, ok: 4 };
return (order[stockStatus(a)] ?? 5) - (order[stockStatus(b)] ?? 5);
});

return (
<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
<SectionTitle>Amazon FBA Inventory</SectionTitle>
{sorted.map(p => {
const st = stockStatus(p);
const { color, bg, label } = STATUS_STYLE[st];
const weeks = weeksOfSupply(p.available, p.unitsSold30);
const isEditing = editing === p.id;
return (
<Card key={p.id} style={{ borderLeft: `3px solid ${color}`, background: bg }}>
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
<div style={{ display: "flex", gap: 8 }}>
{[["available", "On Hand"], ["inbound", "Inbound"], ["unitsSold30", "Sold/30d"]].map(([f, l]) => (
<div key={f}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{l}</div>
<input value={draft[f]} onChange={e => setDraft(d => ({ ...d, [f]: e.target.value }))}
style={{ width: 56, background: "#e5e1da", border: "1px solid #4a3f2a", borderRadius: 1, padding: "4px 6px", color: "#1a1714", fontSize: 13, textAlign: "center", fontFamily: "monospace" }} />
</div>
))}
</div>
<textarea value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} rows={2}
style={{ width: "100%", background: "#e5e1da", border: "1px solid #4a3f2a", borderRadius: 1, padding: "6px 8px", color: "#8c7d6b", fontSize: 11, fontFamily: "monospace", resize: "none" }} />
<div style={{ marginBottom: 4 }}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace", marginBottom: 6 }}>Sold On</div>
<div style={{ display: "flex", gap: 8 }}>
{["Amazon", "Shopify"].map(ch => (
<div key={ch} onClick={() => toggleChannel(ch)} style={{ cursor: "pointer", padding: "4px 12px", fontSize: 10, fontFamily: "monospace", letterSpacing: 1, border: `1px solid ${draft.channels && draft.channels.includes(ch) ? (ch === "Amazon" ? "#a07848" : "#5a7a5a") : "#c8c2b8"}`, color: draft.channels && draft.channels.includes(ch) ? (ch === "Amazon" ? "#a07848" : "#5a7a5a") : "#a09488", background: draft.channels && draft.channels.includes(ch) ? (ch === "Amazon" ? "#a0784814" : "#5a7a5a14") : "transparent" }}>
{ch}
</div>
))}
</div>
</div>
<div style={{ display: "flex", gap: 6 }}>
<button onClick={() => saveEdit(p.id)} style={{ flex: 1, background: "#1a1714", color: "#f7f4ef", border: "none", borderRadius: 1, padding: "6px 0", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Save</button>
<button onClick={() => setEditing(null)} style={{ flex: 1, background: "#e5e1da", color: "#9c8d7b", border: "1px solid #4a3f2a", borderRadius: 1, padding: "6px 0", cursor: "pointer", fontSize: 12 }}>Cancel</button>
</div>
</div>
) : (
<div style={{ display: "flex", gap: 10, alignItems: "center" }}>
{[["On Hand", p.available], ["Inbound", p.inbound], ["Sold/30d", p.unitsSold30]].map(([l, v]) => (
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
<div style={{ fontSize: 12, color: "#a07848", fontFamily: "monospace", marginBottom: 6 }}>ACCOUNTANT NOTE</div>
<div style={{ fontSize: 13, color: "#5a5550", lineHeight: 1.6 }}>
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
</div>
</>
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
<div key={r.id} style={{ background: r.yours ? "#edeae4" : "#edeae4", border: `1px solid ${r.yours ? "#c8c2b8" : "#e5e1da"}`, borderLeft: `3px solid ${r.yours ? "#8c7d6b" : "#d4cfc7"}`, borderRadius: 1, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
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

function WeeklyTab() {
const [weeks, setWeeks] = useState([]);
const [adding, setAdding] = useState(false);
const [draft, setDraft] = useState(BLANK_WEEK);

function saveWeek() {
if (!draft.date) return;
setWeeks(prev => [{ ...draft, id: Date.now() }, ...prev]);
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
</Card>
) : (
<button onClick={() => setAdding(true)} style={{ background: "#e5e1da", border: "1px dashed #4a3f2a", color: "#9c8d7b", borderRadius: 1, padding: "10px 20px", cursor: "pointer", fontSize: 12, fontFamily: "monospace", letterSpacing: 1, marginBottom: 16, width: "100%" }}>
+ ADD THIS WEEK'S NUMBERS
</button>
)}

{weeks.length === 0 && !adding && (
<Card style={{ textAlign: "center", padding: "32px 20px" }}>
<div style={{ fontSize: 13, color: "#c8c2b8", fontFamily: "monospace" }}>No weekly data yet. Add your first entry above.</div>
</Card>
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

function MaterialsTab() {
const [materials, setMaterials] = useState(MATERIALS);
const [editId, setEditId] = useState(null);
const [draft, setDraft] = useState({});

const WEEKLY_BUDGET = 250;
const urgentItems = materials.filter(m => m.status === "out" || m.status === "reorder");
const allocatedTotal = urgentItems.reduce((s, m) => s + (parseFloat(m.estCost) || 0), 0);
const remaining = WEEKLY_BUDGET - allocatedTotal;

function toggleStatus(id) {
setMaterials(p => p.map(m => m.id !== id ? m : {
...m, status: m.status === "ok" ? "reorder" : m.status === "reorder" ? "out" : "ok"
}));
}

function startEdit(m) {
setEditId(m.id);
setDraft({ buyLink: m.buyLink || "", estCost: m.estCost || "", note: m.note || "" });
}

function saveEdit(id) {
setMaterials(p => p.map(m => m.id !== id ? m : {
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

{/* Budget tracker */}
<Card style={{ marginBottom: 20, borderLeft: "2px solid #a07848" }}>
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
<div>
<div style={{ fontSize: 9, letterSpacing: 3, color: "#a09488", textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4 }}>Weekly Materials Budget</div>
<div style={{ fontSize: 11, color: "#9c8d7b", fontFamily: "monospace" }}>
Enter estimated cost per item to track against your $250 weekly budget
</div>
</div>
<div style={{ display: "flex", gap: 20 }}>
{[
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
{/* Budget bar */}
<div style={{ marginTop: 14, height: 3, background: "#e5e1da" }}>
<div style={{ width: `${Math.min((allocatedTotal / WEEKLY_BUDGET) * 100, 100)}%`, height: "100%", background: remaining < 0 ? "#9b5e5e" : "#a07848", transition: "width 0.4s" }} />
</div>
</Card>

{/* How to use note */}
<div style={{ fontSize: 11, color: "#b0a89a", fontFamily: "monospace", marginBottom: 16, letterSpacing: 0.5 }}>
Click <strong style={{ color: "#9c8d7b" }}>Edit</strong> on any item to add a purchase link and estimated cost. Material names with links become clickable. Tap status badge to cycle: OK → REORDER → OUT.
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
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace", marginBottom: 4 }}>Purchase URL (Amazon, supplier, etc.)</div>
<input
value={draft.buyLink}
onChange={e => setDraft(d => ({ ...d, buyLink: e.target.value }))}
placeholder="https://amazon.com/dp/... or supplier URL"
style={{ width: "100%", background: "#e5e1da", border: "1px solid #c8c2b8", padding: "6px 10px", color: "#1a1714", fontSize: 12, fontFamily: "monospace", outline: "none" }}
/>
</div>
<div style={{ minWidth: 100 }}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace", marginBottom: 4 }}>Est. Cost ($)</div>
<input
value={draft.estCost}
onChange={e => setDraft(d => ({ ...d, estCost: e.target.value }))}
placeholder="0.00"
type="number"
style={{ width: "100%", background: "#e5e1da", border: "1px solid #c8c2b8", padding: "6px 10px", color: "#1a1714", fontSize: 12, fontFamily: "monospace", outline: "none" }}
/>
</div>
<div style={{ flex: 2, minWidth: 160 }}>
<div style={{ fontSize: 9, color: "#a09488", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "monospace", marginBottom: 4 }}>Notes</div>
<input
value={draft.note}
onChange={e => setDraft(d => ({ ...d, note: e.target.value }))}
placeholder="Supplier name, qty needed, etc."
style={{ width: "100%", background: "#e5e1da", border: "1px solid #c8c2b8", padding: "6px 10px", color: "#1a1714", fontSize: 12, fontFamily: "monospace", outline: "none" }}
/>
</div>
</div>
<div style={{ display: "flex", gap: 8 }}>
<button onClick={() => saveEdit(m.id)} style={{ background: "#1a1714", color: "#f7f4ef", border: "none", padding: "6px 18px", cursor: "pointer", fontSize: 11, fontFamily: "monospace", letterSpacing: 1 }}>SAVE</button>
<button onClick={() => setEditId(null)} style={{ background: "transparent", color: "#a09488", border: "1px solid #c8c2b8", padding: "6px 14px", cursor: "pointer", fontSize: 11, fontFamily: "monospace", letterSpacing: 1 }}>CANCEL</button>
</div>
</div>
) : (
<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
<div style={{ flex: 1 }}>
<div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3, flexWrap: "wrap" }}>
{hasLink ? (
<a href={m.buyLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: "#1a1714", fontFamily: "'IM Fell English', Georgia, serif", textDecoration: "underline", textDecorationColor: "#c8c2b8", textUnderlineOffset: 3 }}>{m.name}</a>
) : (
<span style={{ fontSize: 14, color: "#1a1714", fontFamily: "'IM Fell English', Georgia, serif" }}>{m.name}</span>
)}
{hasLink && <span style={{ fontSize: 9, color: "#5a7a5a", fontFamily: "monospace", letterSpacing: 1 }}>↗ LINK ADDED</span>}
{!hasLink && (m.status === "out" || m.status === "reorder") && (
<span style={{ fontSize: 9, color: "#b0a89a", fontFamily: "monospace", letterSpacing: 1 }}>— add buy link</span>
)}
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

{/* Add new material */}
<button onClick={() => {
const newId = Math.max(...materials.map(m => m.id)) + 1;
setMaterials(p => [...p, { id: newId, name: "New Material", status: "reorder", note: "", buyLink: "", estCost: null, priority: 4 }]);
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
const userMsg = { role: "user", content: question };
setHistory(h => [...h, userMsg]);
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
const res = await fetch("https://api.anthropic.com/v1/messages", {
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
<div style={{ maxWidth: "82%", background: m.role === "user" ? "#d4cfc7" : "#eae8e3", border: `1px solid ${m.role === "user" ? "#c8c2b8" : "#c8c2b8"}`, borderRadius: 1, padding: "10px 14px", fontSize: 13, color: m.role === "user" ? "#1a1714" : "#3a4a3a", lineHeight: 1.65, fontFamily: m.role === "user" ? "'IM Fell English', Georgia, serif" : "monospace", whiteSpace: "pre-wrap" }}>
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

// ── MAIN ──────────────────────────────────────────────────────────────────────

export default function App() {
const [tab, setTab] = useState("inventory");
useEffect(() => {
const link = document.createElement("link");
link.rel = "stylesheet"; link.href = FONT_LINK;
document.head.appendChild(link);
}, []);
const [products, setProducts] = useState(INITIAL_PRODUCTS);
const [campaigns] = useState(INITIAL_CAMPAIGNS);

const criticalCount = products.filter(p => ["out", "low"].includes(stockStatus(p))).length;
const pauseCount = campaigns.filter(c => c.status === "pause").length;

const tabs = [
{ id: "inventory", label: "Inventory", alert: criticalCount || null },
{ id: "ads", label: "Ads", alert: pauseCount ? `${pauseCount}!` : null },
{ id: "weekly", label: "Weekly" },
{ id: "profit", label: "Profit" },
{ id: "priceoz", label: "Price/Oz" },
{ id: "checklist", label: "Bi-Weekly" },
{ id: "materials", label: "Materials" },
{ id: "roadmap", label: "Roadmap" },
{ id: "ai", label: "✦ AI" },
];

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
{ label: "Alerts", value: criticalCount + pauseCount, color: criticalCount + pauseCount > 0 ? "#9b5e5e" : "#5a7a5a" },
{ label: "Campaigns", value: campaigns.length, color: "#7a7a9a" },
].map(s => (
<div key={s.label} style={{ textAlign: "center", padding: "7px 12px", background: "#edeae4", borderRadius: 1, border: "1px solid #3a3020" }}>
<div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: "monospace" }}>{s.value}</div>
<div style={{ fontSize: 9, color: "#a09488", letterSpacing: 1, textTransform: "uppercase" }}>{s.label}</div>
</div>
))}
</div>
</div>

<div style={{ background: "#ede9e3", borderBottom: "1px solid #3a3020", padding: "0 24px", display: "flex", gap: 0, overflowX: "auto" }}>
{tabs.map(t => (
<button key={t.id} onClick={() => setTab(t.id)} style={{ background: "none", border: "none", borderBottom: tab === t.id ? "2px solid #a89060" : "2px solid transparent", color: tab === t.id ? "#1a1714" : "#a09488", padding: "11px 14px", cursor: "pointer", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", fontFamily: "monospace", marginBottom: -1, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
{t.label}
{t.alert && <span style={{ fontSize: 9, background: "#9b5e5e", color: "#fff", borderRadius: 1, padding: "1px 5px" }}>{t.alert}</span>}
</button>
))}
</div>

<div style={{ padding: "22px 24px", maxWidth: 960, margin: "0 auto" }}>
{tab === "inventory" && <InventoryTab products={products} setProducts={setProducts} />}
{tab === "ads" && <AdsTab campaigns={campaigns} />}
{tab === "weekly" && <WeeklyTab />}
{tab === "profit" && <ProfitTab />}
{tab === "priceoz" && <PriceOzTab />}
{tab === "checklist" && <ChecklistTab />}
{tab === "materials" && <MaterialsTab />}
{tab === "roadmap" && <RoadmapTab />}
{tab === "ai" && <AITab products={products} campaigns={campaigns} />}
</div>
</div>
);
}
