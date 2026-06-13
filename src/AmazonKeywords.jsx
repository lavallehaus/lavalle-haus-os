import { useState, useEffect, useRef } from "react";

// LAVALLE HAUS OS — Amazon Brand Analytics keyword panel.
// Pulls real data through the SP-API (no upload):
//   • Research  → GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT (top terms + frequency rank)
//   • My Products → GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT (your funnel per query)
// Plus an AI expansion seeded by the real top terms so suggestions are on-brand.
// onTrack(kw) hands a term up to the manual Keyword Tracker.

const c = {
  ink: "#1a1714", sub: "#8c7d6b", line: "#c8c2b8", green: "#5a7a5a",
  clay: "#a07848", red: "#9b5e5e", card: "#efece5",
};
const serif = "'IM Fell English', Georgia, serif";
const mono = "monospace";
const MODEL = "claude-sonnet-4-20250514";

const toggle = (on) => ({
  padding: "6px 13px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono,
  cursor: "pointer", borderRadius: 1, border: `1px solid ${on ? c.clay : c.line}`,
  background: on ? c.clay : "transparent", color: on ? "#fff" : c.sub,
});
const pct = (v) => (v == null ? "—" : (v <= 1 ? (v * 100).toFixed(1) : Number(v).toFixed(1)) + "%");
const num = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString());

export default function AmazonKeywords({ products = [], onTrack }) {
  const [view, setView] = useState("research"); // research | mine
  const [period, setPeriod] = useState("WEEK");
  const [byKind, setByKind] = useState({ searchterms: null, sqp: null });
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const pollRef = useRef(null);
  const attemptsRef = useRef(0);

  const kind = view === "mine" ? "sqp" : "searchterms";
  const data = byKind[kind];

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);
  // Load cache (or nothing) when switching view; don't auto-spend a fresh pull.
  useEffect(() => { pull({ refresh: false, silent: true }); /* eslint-disable-next-line */ }, [view, period]);

  async function pull({ refresh = false, reportId = null, silent = false } = {}) {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    setError("");
    if (!silent || refresh || reportId) setLoading(true);
    try {
      const asins = view === "mine" ? products.filter((p) => p.asin && !p.isSample).map((p) => p.asin) : [];
      const r = await fetch("/api/amazon-sync?op=keywords", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, period, asins, refresh, reportId }),
      }).then((x) => x.json());

      if (r && r.error) { setError(r.error); setPending(false); setLoading(false); return; }
      if (r && r.pending) {
        attemptsRef.current += 1;
        if (attemptsRef.current > 20) { setPending(false); setLoading(false); setError("Amazon is taking unusually long to prepare this report. Try again in a few minutes."); return; }
        setPending(true);
        pollRef.current = setTimeout(() => pull({ reportId: r.reportId }), 12000);
        return;
      }
      if (r && r.rows) { setByKind((prev) => ({ ...prev, [r.kind || kind]: r })); }
      else if (!silent) setError("No data returned for this period yet.");
      attemptsRef.current = 0;
      setPending(false); setLoading(false);
    } catch (e) { setError(String(e).slice(0, 200)); setPending(false); setLoading(false); }
  }

  const rows = (data && data.rows) || [];
  const filtered = q.trim()
    ? rows.filter((r) => (r.term || "").toLowerCase().includes(q.trim().toLowerCase()))
    : rows;
  const sorted = view === "research"
    ? [...filtered].sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9))
    : [...filtered].sort((a, b) => (b.purchases || 0) - (a.purchases || 0) || (b.impressions || 0) - (a.impressions || 0));

  const th = { fontFamily: mono, fontSize: 8.5, letterSpacing: 1, textTransform: "uppercase", color: c.sub, padding: "6px 8px", textAlign: "left", borderBottom: `1px solid ${c.line}`, whiteSpace: "nowrap" };
  const td = { padding: "5px 8px", borderBottom: "1px solid #00000008", fontFamily: serif, fontSize: 13, color: c.ink };
  const tdR = { ...td, textAlign: "right", fontFamily: mono, fontSize: 12 };

  return (
    <div style={{ background: c.card, border: `1px solid ${c.line}`, borderRadius: 2, padding: "16px 18px", marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: serif, fontSize: 20, color: c.ink }}>Amazon Brand Analytics</div>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: "rgba(111,102,87,0.65)" }}>Real search data, pulled live from Seller Central · Datos reales de Seller Central</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => setView("research")} style={toggle(view === "research")}>Research</button>
          <button onClick={() => setView("mine")} style={toggle(view === "mine")}>My Products</button>
          <span style={{ width: 8 }} />
          <button onClick={() => setPeriod("WEEK")} style={toggle(period === "WEEK")}>Week</button>
          <button onClick={() => setPeriod("MONTH")} style={toggle(period === "MONTH")}>Month</button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, margin: "12px 0 8px", flexWrap: "wrap" }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: c.sub }}>
          {pending ? "Amazon is preparing the report…" :
            error ? <span style={{ color: c.red }}>{error}</span> :
            data ? `${rows.length} terms · ${data.dataStart ? data.dataStart.slice(0, 10) : ""}–${data.dataEnd ? data.dataEnd.slice(0, 10) : ""}${data.cached ? " · cached" : ""}` :
            "No data pulled yet."}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter terms…" style={{ background: "#e5e1da", border: `1px solid ${c.line}`, color: c.ink, fontSize: 12, padding: "5px 8px", borderRadius: 1, fontFamily: serif, width: 130 }} />
          <button onClick={() => pull({ refresh: true })} disabled={loading || pending} style={{ ...toggle(false), borderColor: c.clay, color: c.ink, opacity: (loading || pending) ? 0.5 : 1 }}>
            {loading || pending ? "Pulling…" : "↻ Pull from Amazon"}
          </button>
        </div>
      </div>

      {pending && <div style={{ height: 2, background: "#e0dccf", overflow: "hidden", borderRadius: 2, marginBottom: 8 }}><div style={{ width: "40%", height: "100%", background: c.clay, animation: "lhpulse 1.1s ease-in-out infinite" }} /></div>}
      <style>{"@keyframes lhpulse{0%{margin-left:-40%}100%{margin-left:100%}}"}</style>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>
          <thead>
            {view === "research" ? (
              <tr><th style={th}>Search term</th><th style={{ ...th, textAlign: "right" }}>Freq rank</th><th style={th}>Top clicked</th><th style={{ ...th, textAlign: "right" }}>Click %</th><th style={{ ...th, textAlign: "right" }}>Conv %</th><th style={{ ...th, width: 30 }}></th></tr>
            ) : (
              <tr><th style={th}>Query</th><th style={{ ...th, textAlign: "right" }}>Impr</th><th style={{ ...th, textAlign: "right" }}>Clicks</th><th style={{ ...th, textAlign: "right" }}>Cart</th><th style={{ ...th, textAlign: "right" }}>Purch</th><th style={{ ...th, textAlign: "right" }}>CVR</th><th style={{ ...th, width: 30 }}></th></tr>
            )}
          </thead>
          <tbody>
            {sorted.length === 0 && !pending && (
              <tr><td colSpan={6} style={{ ...td, textAlign: "center", fontStyle: "italic", color: c.sub, padding: 16 }}>
                {data ? "No terms match." : "Hit “Pull from Amazon” to load this report."}
              </td></tr>
            )}
            {sorted.slice(0, 200).map((r, i) => view === "research" ? (
              <tr key={i}>
                <td style={td}>{r.term}</td>
                <td style={tdR}>{r.rank == null ? "—" : "#" + num(r.rank)}</td>
                <td style={{ ...td, fontSize: 11, color: c.sub, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.clickedTitle || ""}>{r.clickedTitle || r.clickedAsin || "—"}</td>
                <td style={tdR}>{pct(r.clickShare)}</td>
                <td style={tdR}>{pct(r.convShare)}</td>
                <td style={{ ...td, textAlign: "center" }}><button onClick={() => onTrack && onTrack({ keyword: r.term, matchType: "phrase", notes: `BA rank #${r.rank || "?"}` })} title="add to tracker" style={{ border: "none", background: "transparent", color: c.clay, cursor: "pointer", fontSize: 15 }}>＋</button></td>
              </tr>
            ) : (
              <tr key={i}>
                <td style={td}>{r.term}</td>
                <td style={tdR}>{num(r.impressions)}</td>
                <td style={tdR}>{num(r.clicks)}</td>
                <td style={tdR}>{num(r.cartAdds)}</td>
                <td style={tdR}>{num(r.purchases)}</td>
                <td style={tdR}>{r.clicks ? ((r.purchases || 0) / r.clicks * 100).toFixed(1) + "%" : "—"}</td>
                <td style={{ ...td, textAlign: "center" }}><button onClick={() => onTrack && onTrack({ keyword: r.term, matchType: "exact", notes: `${num(r.purchases)} purch / ${num(r.clicks)} clicks` })} title="add to tracker" style={{ border: "none", background: "transparent", color: c.clay, cursor: "pointer", fontSize: 15 }}>＋</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AiExpansion products={products} topTerms={rows.slice(0, 25).map((r) => r.term)} onTrack={onTrack} />
    </div>
  );
}

function AiExpansion({ products = [], topTerms = [], onTrack }) {
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const names = [...new Set(products.filter((p) => !p.isSample).map((p) => p.name))];

  async function generate() {
    const prod = product || names[0] || "";
    if (!prod) return;
    setLoading(true); setResults([]);
    try {
      const seed = topTerms.length ? `Customers are already finding similar products with these real Amazon search terms: ${topTerms.join(", ")}. Use them as relevance signal.` : "";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL, max_tokens: 1000,
          system: `You are an Amazon PPC keyword research expert. Return ONLY a JSON array, no markdown. Each item: { "keyword": string, "matchType": "exact"|"phrase"|"broad", "intent": "high"|"medium"|"low", "notes": string }`,
          messages: [{ role: "user", content: `Generate 12 high-intent Amazon keywords for: "${prod}". ${seed} Favor buyer-intent and long-tail terms that convert.` }],
        }),
      });
      const d = await res.json();
      const text = (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("") || "[]";
      setResults(JSON.parse(text.replace(/```json|```/g, "").trim()));
    } catch (e) { setResults([{ keyword: "Could not generate — try again", matchType: "exact", intent: "low", notes: "" }]); }
    setLoading(false);
  }

  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${c.line}`, paddingTop: 12 }}>
      <button onClick={() => setOpen(!open)} style={{ background: "none", border: "none", color: c.clay, cursor: "pointer", fontFamily: mono, fontSize: 11, letterSpacing: 1, padding: 0 }}>
        {open ? "▾" : "▸"} Expand with AI {topTerms.length ? "(seeded by your top terms)" : ""}
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <select value={product} onChange={(e) => setProduct(e.target.value)} style={{ background: "#e5e1da", border: `1px solid ${c.line}`, color: c.ink, fontSize: 12, padding: "5px 8px", borderRadius: 1, fontFamily: mono }}>
              <option value="">{names[0] || "Select product"}</option>
              {names.map((nm) => <option key={nm} value={nm}>{nm}</option>)}
            </select>
            <button onClick={generate} disabled={loading} style={{ ...toggle(false), borderColor: c.green, color: c.green, opacity: loading ? 0.5 : 1 }}>{loading ? "Thinking…" : "Generate ideas"}</button>
          </div>
          {results.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
              {results.map((kw, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "#f4f1ea", border: `1px solid ${c.line}`, borderRadius: 1, padding: "6px 9px" }}>
                  <div>
                    <span style={{ fontFamily: serif, fontSize: 13, color: c.ink }}>{kw.keyword}</span>
                    <span style={{ fontFamily: mono, fontSize: 9, color: c.sub, marginLeft: 8 }}>{kw.matchType} · {kw.intent}</span>
                    {kw.notes && <div style={{ fontFamily: serif, fontSize: 11, fontStyle: "italic", color: c.sub }}>{kw.notes}</div>}
                  </div>
                  <button onClick={() => onTrack && onTrack({ keyword: kw.keyword, matchType: kw.matchType || "exact", notes: kw.notes || "AI idea" })} style={{ ...toggle(false), borderColor: c.clay, color: c.clay, padding: "4px 9px" }}>＋ Track</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
