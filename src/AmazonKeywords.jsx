import { useState, useEffect, useRef, useMemo } from "react";

// LAVALLE HAUS OS — Amazon keyword workbench.
// Product-first: your Amazon products are the list; AI suggests keywords under each,
// grounded in real Brand Analytics search terms when available. ＋ adopts a keyword
// into the manual tracker, already assigned to that product.
// The raw Brand Analytics report is still pullable, but collapsed out of the way.

const c = {
  ink: "#1a1714", sub: "#8c7d6b", line: "#c8c2b8", green: "#5a7a5a",
  clay: "#a07848", red: "#9b5e5e", card: "#efece5",
};
const serif = "'IM Fell English', Georgia, serif";
const mono = "monospace";
const MODEL = "claude-sonnet-4-20250514";

const SEED = ["candle", "candles", "wax", "beeswax", "soy candle", "scented candle", "sand candle", "sand wax", "apple candle", "vanilla candle", "cinnamon", "pumpkin spice", "fall candle", "autumn", "vessel candle", "dough bowl", "seashell", "scrub", "sugar scrub", "body scrub", "exfoliat", "bath salt", "bath soak", "body oil", "botanical", "aromatherapy", "home fragrance", "wax melt", "candle gift", "luxury candle", "natural candle", "spa gift"];
const STOP = ["candle", "large", "small", "with", "sand", "vanilla", "apple", "the", "and", "set", "pack", "oz"];
function buildFilter(products) {
  const toks = new Set(SEED);
  (products || []).filter((p) => !p.isSample).forEach((p) => {
    String(p.name || "").toLowerCase().split(/[^a-z]+/).forEach((w) => { if (w.length > 3 && STOP.indexOf(w) < 0) toks.add(w); });
  });
  return [...toks];
}

const toggle = (on) => ({
  padding: "6px 13px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono,
  cursor: "pointer", borderRadius: 1, border: `1px solid ${on ? c.clay : c.line}`,
  background: on ? c.clay : "transparent", color: on ? "#fff" : c.sub,
});
const pct = (v) => (v == null ? "—" : (v <= 1 ? (v * 100).toFixed(1) : Number(v).toFixed(1)) + "%");
const num = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString());

export default function AmazonKeywords({ products = [], onTrack }) {
  const [view, setView] = useState("research");
  const [period, setPeriod] = useState("WEEK");
  const [byKind, setByKind] = useState({ searchterms: null, sqp: null });
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const pollRef = useRef(null);
  const attemptsRef = useRef(0);

  const kind = view === "mine" ? "sqp" : "searchterms";
  const FILTER = useMemo(() => buildFilter(products), [products]);
  const data = byKind[kind];

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);
  useEffect(() => { pull({ refresh: false, silent: true }); /* eslint-disable-next-line */ }, [view, period]);

  async function pull({ refresh = false, reportId = null, silent = false } = {}) {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
    setError("");
    if (!silent || refresh || reportId) setLoading(true);
    try {
      const asins = view === "mine" ? products.filter((p) => p.asin && !p.isSample).map((p) => p.asin) : [];
      const r = await fetch("/api/amazon-sync?op=keywords", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, period, asins, refresh, reportId, filter: view === "research" ? FILTER : undefined }),
      }).then((x) => x.json());

      if (r && r.error) { setError(r.error); setPending(false); setLoading(false); return; }
      if (r && r.pending) {
        attemptsRef.current += 1;
        if (attemptsRef.current > 20) { setPending(false); setLoading(false); setError("Amazon is taking unusually long. Try again in a few minutes."); return; }
        setPending(true);
        pollRef.current = setTimeout(() => pull({ reportId: r.reportId }), 12000);
        return;
      }
      if (r && r.rows) setByKind((prev) => ({ ...prev, [r.kind || kind]: r }));
      attemptsRef.current = 0;
      setPending(false); setLoading(false);
    } catch (e) { setError(String(e).slice(0, 200)); setPending(false); setLoading(false); }
  }

  const rows = (data && data.rows) || [];
  const reportTerms = useMemo(() => rows.map((r) => r.term).filter(Boolean), [rows]);
  const reportInfo = useMemo(() => { const m = {}; rows.forEach((r) => { const k = (r.term || "").toLowerCase(); if (k && r.rank != null && (m[k] == null || r.rank < m[k])) m[k] = r.rank; }); return m; }, [rows]);
  const periodLabel = data ? `${(data.dataStart || "").slice(0, 10)} – ${(data.dataEnd || "").slice(0, 10)}` : "";
  const filtered = q.trim() ? rows.filter((r) => (r.term || "").toLowerCase().includes(q.trim().toLowerCase())) : rows;
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
          <div style={{ fontFamily: serif, fontSize: 20, color: c.ink }}>Keyword Suggestions by Product</div>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: "rgba(111,102,87,0.65)" }}>Grounded in real Amazon search data · Basado en datos reales de Amazon</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontFamily: mono, fontSize: 8.5, color: c.sub, letterSpacing: 1 }}>DATA</span>
          <button onClick={() => setView("research")} style={toggle(view === "research")}>Market</button>
          <button onClick={() => setView("mine")} style={toggle(view === "mine")}>My Sales</button>
          <button onClick={() => pull({ refresh: true })} disabled={loading || pending} style={{ ...toggle(false), borderColor: c.clay, color: c.ink, opacity: (loading || pending) ? 0.5 : 1 }}>
            {loading || pending ? "Pulling…" : "↻ Pull"}
          </button>
        </div>
      </div>

      <div style={{ fontFamily: mono, fontSize: 10, color: c.sub, margin: "8px 0 4px" }}>
        {pending ? "Amazon is preparing the report…" :
          error ? <span style={{ color: c.red }}>{error}</span> :
          data ? `${reportTerms.length} relevant search terms loaded${data.cached ? " · cached" : ""}` :
          "Tip: pull data for stronger suggestions, or just generate below."}
      </div>

      <ProductSuggestions products={products} reportTerms={reportTerms} reportInfo={reportInfo} periodLabel={periodLabel} onTrack={onTrack} />

      {/* raw report, collapsed */}
      <div style={{ marginTop: 14, borderTop: `1px solid ${c.line}`, paddingTop: 10 }}>
        <button onClick={() => setShowRaw(!showRaw)} style={{ background: "none", border: "none", color: c.sub, cursor: "pointer", fontFamily: mono, fontSize: 10, letterSpacing: 1, padding: 0 }}>
          {showRaw ? "▾" : "▸"} Raw Amazon report{data ? ` (${reportTerms.length} terms)` : ""}
        </button>
        {showRaw && (
          <div style={{ marginTop: 8 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter terms…" style={{ background: "#e5e1da", border: `1px solid ${c.line}`, color: c.ink, fontSize: 12, padding: "5px 8px", borderRadius: 1, fontFamily: serif, width: 150, marginBottom: 8 }} />
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 540 }}>
                <thead>
                  {view === "research" ? (
                    <tr><th style={th}>Search term</th><th style={{ ...th, textAlign: "right" }}>Freq rank</th><th style={th}>Top clicked</th><th style={{ ...th, textAlign: "right" }}>Click %</th><th style={{ ...th, textAlign: "right" }}>Conv %</th></tr>
                  ) : (
                    <tr><th style={th}>Query</th><th style={{ ...th, textAlign: "right" }}>Impr</th><th style={{ ...th, textAlign: "right" }}>Clicks</th><th style={{ ...th, textAlign: "right" }}>Purch</th><th style={{ ...th, textAlign: "right" }}>CVR</th></tr>
                  )}
                </thead>
                <tbody>
                  {sorted.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: "center", fontStyle: "italic", color: c.sub, padding: 14 }}>{data ? "No terms." : "Pull data to populate."}</td></tr>}
                  {sorted.slice(0, 200).map((r, i) => view === "research" ? (
                    <tr key={i}><td style={td}>{r.term}</td><td style={tdR}>{r.rank == null ? "—" : "#" + num(r.rank)}</td><td style={{ ...td, fontSize: 11, color: c.sub, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.clickedTitle || r.clickedAsin || "—"}</td><td style={tdR}>{pct(r.clickShare)}</td><td style={tdR}>{pct(r.convShare)}</td></tr>
                  ) : (
                    <tr key={i}><td style={td}>{r.term}</td><td style={tdR}>{num(r.impressions)}</td><td style={tdR}>{num(r.clicks)}</td><td style={tdR}>{num(r.purchases)}</td><td style={tdR}>{r.clicks ? ((r.purchases || 0) / r.clicks * 100).toFixed(1) + "%" : "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProductSuggestions({ products = [], reportTerms = [], reportInfo = {}, periodLabel = "", onTrack }) {
  const amz = products.filter((p) => !p.isSample && (p.asin || (p.channels || []).includes("Amazon"))).map((p) => ({ id: p.id, name: p.name }));
  const [loading, setLoading] = useState(false);
  const [byProduct, setByProduct] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState({});
  const [added, setAdded] = useState({});

  const reportSet = useMemo(() => new Set(reportTerms.map((t) => String(t).toLowerCase())), [reportTerms]);

  async function suggest() {
    if (!amz.length) { setErr("No Amazon products found."); return; }
    setLoading(true); setErr(""); setByProduct(null);
    try {
      const catalog = amz.map((p) => p.id + ": " + p.name).join("; ");
      const real = reportTerms.slice(0, 120).join(", ");
      const res = await fetch("/api/categorize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL, max_tokens: 1000,
          system: `You are an Amazon PPC strategist for a candle and body-care brand. For EACH product in the catalog, suggest up to 6 high-intent Amazon search keywords a shopper would type to buy THAT product. Strongly prefer the provided real customer search terms when they fit a product; otherwise use your own buyer-intent terms. Return ONLY a compact JSON object keyed by product id; each value is an array of strings "keyword|m" where m is e (exact), p (phrase) or b (broad). No markdown, no prose. Example: {"4":["spiced apple candle|e","apple cinnamon candle|p"]}`,
          messages: [{ role: "user", content: "Catalog: " + catalog + (real ? "\n\nReal customer search terms to prefer: " + real : "") }],
        }),
      });
      const d = await res.json();
      const text = (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("") || "{}";
      const obj = JSON.parse(text.replace(/```json|```/g, "").trim());
      const out = {};
      Object.keys(obj || {}).forEach((k) => {
        out[k] = (obj[k] || []).map((sgg) => { const parts = String(sgg).split("|"); const m = (parts[1] || "").trim().toLowerCase(); return { keyword: (parts[0] || "").trim(), matchType: m === "e" ? "exact" : m === "b" ? "broad" : "phrase" }; }).filter((x) => x.keyword);
      });
      setByProduct(out);
      const o = {}; amz.forEach((p) => { o[p.id] = true; }); setOpen(o);
    } catch (e) { setErr("Could not generate — try again."); }
    setLoading(false);
  }

  function adopt(prod, kw) {
    onTrack && onTrack({ keyword: kw.keyword, matchType: kw.matchType, product: prod.name, notes: reportSet.has(kw.keyword.toLowerCase()) ? "searched on Amazon" : "AI suggested" });
    setAdded((a) => ({ ...a, [prod.id + "|" + kw.keyword]: true }));
  }

  const chip = { fontFamily: mono, fontSize: 8.5, color: c.sub, letterSpacing: 0.5 };

  return (
    <div style={{ marginTop: 6 }}>
      <button onClick={suggest} disabled={loading} style={{ ...toggle(false), borderColor: c.green, color: c.green, opacity: loading ? 0.5 : 1, padding: "7px 14px" }}>
        {loading ? "Thinking…" : (byProduct ? "↻ Regenerate suggestions" : "✦ Suggest keywords for my products")}
      </button>
      {err && <div style={{ color: c.red, fontFamily: mono, fontSize: 10, marginTop: 6 }}>{err}</div>}

      {!byProduct && !loading && (
        <div style={{ marginTop: 10, fontFamily: serif, fontStyle: "italic", fontSize: 12.5, color: c.sub }}>
          {amz.length ? `${amz.length} Amazon products ready. Generate to get keyword ideas under each one.` : "No Amazon products found in your catalog."}
        </div>
      )}

      {byProduct && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {amz.map((p) => {
            const sugg = byProduct[p.id] || byProduct[String(p.id)] || [];
            const isOpen = open[p.id];
            return (
              <div key={p.id} style={{ border: `1px solid ${c.line}`, borderRadius: 1, background: "#f4f1ea", overflow: "hidden" }}>
                <button onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))} style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: serif, fontSize: 15, color: c.ink }}>{isOpen ? "▾" : "▸"}&nbsp; {p.name}</span>
                  <span style={chip}>{sugg.length} keyword{sugg.length === 1 ? "" : "s"}</span>
                </button>
                {isOpen && (
                  <div style={{ padding: "2px 12px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                    {sugg.length === 0 && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: c.sub }}>No suggestions for this one.</div>}
                    {sugg.map((kw, i) => {
                      const id = p.id + "|" + kw.keyword;
                      const lk = kw.keyword.toLowerCase();
                      const rank = reportInfo[lk];
                      const searched = rank != null || reportSet.has(lk);
                      const isAdded = added[id];
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderTop: i ? "1px solid #00000008" : "none" }}>
                          <span style={{ fontFamily: serif, fontSize: 14, color: c.ink, flex: 1 }}>{kw.keyword}</span>
                          {searched && <span style={{ fontFamily: mono, fontSize: 8, color: c.green, border: `1px solid ${c.green}`, borderRadius: 1, padding: "1px 4px" }} title="Amazon search-frequency rank — lower = more searched">★ {rank != null ? "RANK #" + Number(rank).toLocaleString() : "SEARCHED"}</span>}
                          {searched && rank != null && periodLabel && <span style={{ fontFamily: mono, fontSize: 8, color: c.sub }} title="Report period">{periodLabel}</span>}
                          <span style={chip}>{kw.matchType}</span>
                          <button onClick={() => adopt(p, kw)} disabled={isAdded} title="add to tracker" style={{ border: "none", background: "transparent", color: isAdded ? c.sub : c.clay, cursor: isAdded ? "default" : "pointer", fontSize: 17, lineHeight: 1, width: 22 }}>{isAdded ? "✓" : "＋"}</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
