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
) : (const [q, setQ] = useState("");
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
model: "claude-sonnet-4-20250514",}}>
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
{tab === "inventory" && <InventoryTab products={products} setProducts={setProducts} dbState={dbState} setDbState={setDbState} />}
{tab === "ads" && <AdsTab campaigns={campaigns} />}
{tab === "keywords" && <KeywordsTab products={products} />}
{tab === "weekly" && <WeeklyTab weeks={weeks} setWeeks={setWeeks} dbState={dbState} setDbState={setDbState} />}
{tab === "profit" && (
<ProfitMatrix
data={dbState.profitMatrix || {}}
onSave={(pm) => {
const next = { ...dbState, profitMatrix: { products: pm.products, opex: pm.opex, keep: pm.keep, assignees: pm.assignees, profitAdjustments: pm.adjustments, profitManual: pm.manual } };
setDbState(next);
dbSave(next);
}}
/>
)}
{tab === "priceoz" && <PriceOzTab />}
{tab === "checklist" && <ChecklistTab />}
{tab === "materials" && <MaterialsTab materials={materials} setMaterials={setMaterials} dbState={dbState} setDbState={setDbState} />}
{tab === "roadmap" && <RoadmapTab />}
{tab === "ai" && <AITab products={products} campaigns={campaigns} />}
</div>
</div>
);
}
