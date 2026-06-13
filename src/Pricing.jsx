import { useState, useEffect } from "react";

// LAVALLE HAUS OS — Pricing & Competitor Research
// Live buy-box status for every listed ASIN, plus a competitor watchlist
// (any ASIN on Amazon) with $/oz so positioning is comparable across sizes.
// Watchlist edits persist to Redis and carry the standard Undo/Redo stack.

const c = {
  bg: "#f7f4ef", ink: "#1a1714", sub: "#8c7d6b", line: "#c8c2b8",
  green: "#5a7a5a", clay: "#a07848", red: "#9b5e5e", card: "#efece5",
};
const serif = "'IM Fell English', Georgia, serif";
const sans = "monospace";
const card = { background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: 14, marginBottom: 12 };
const inputS = { background: "#e5e1da", border: `1px solid ${c.line}`, color: c.ink, fontSize: 12, padding: "6px 8px", borderRadius: 1, boxSizing: "border-box" };
const btnGhost = { padding: "5px 14px", fontSize: 10, fontFamily: sans, letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: `1px solid ${c.line}`, background: "transparent", color: c.sub, textTransform: "uppercase" };

const money = (v) => (v === null || v === undefined || isNaN(v) ? "—" : `$${Number(v).toFixed(2)}`);

export default function Pricing({ products = [] }) {
  const [mine, setMine] = useState({ loading: true, results: [], error: null });
  const [comp, setComp] = useState([]); // [{asin, label, oz}]
  const [compPrices, setCompPrices] = useState({}); // asin -> result
  const [compLoading, setCompLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [form, setForm] = useState({ asin: "", label: "", oz: "" });
  // Undo/Redo over the watchlist (standard OS pattern)
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);

  function nameForSku(skus) {
    for (const sku of skus || []) {
      const p = products.find((pp) => (pp.sku || "").trim().toLowerCase() === (sku || "").trim().toLowerCase());
      if (p) return p.name;
    }
    return null;
  }

  function loadMine() {
    setMine((s) => ({ ...s, loading: true, error: null }));
    fetch("/api/amazon-sync?op=pricing").then((r) => r.json()).then((d) => {
      setFetchedAt(new Date());
      if (d.results) setMine({ loading: false, results: d.results, error: null });
      else setMine({ loading: false, results: [], error: d.error || "Not connected" });
    }).catch((e) => setMine({ loading: false, results: [], error: String(e) }));
  }

  function loadCompPrices(list) {
    const asins = (list || comp).map((x) => x.asin).filter(Boolean);
    if (!asins.length) { setCompPrices({}); return; }
    setCompLoading(true);
    fetch(`/api/amazon-sync?op=pricing&asins=${encodeURIComponent(asins.join(","))}`)
      .then((r) => r.json())
      .then((d) => {
        const map = {};
        for (const r of d.results || []) map[r.asin] = r;
        setCompPrices(map);
        setCompLoading(false);
      })
      .catch(() => setCompLoading(false));
  }

  useEffect(() => {
    loadMine();
    fetch("/api/amazon-sync?op=pricing&action=getcomp").then((r) => r.json()).then((d) => {
      const list = d.competitors || [];
      setComp(list);
      loadCompPrices(list);
    }).catch(() => {});
  }, []);

  function persist(list) {
    fetch("/api/amazon-sync?op=pricing&action=setcomp", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ competitors: list }),
    }).catch(() => {});
  }

  function applyComp(next, { refetch = false } = {}) {
    setPast((p) => [...p.slice(-49), comp]);
    setFuture([]);
    setComp(next);
    persist(next);
    if (refetch) loadCompPrices(next);
  }
  function undo() {
    if (!past.length) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [comp, ...f]);
    setComp(prev);
    persist(prev);
    loadCompPrices(prev);
  }
  function redo() {
    if (!future.length) return;
    const nxt = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, comp]);
    setComp(nxt);
    persist(nxt);
    loadCompPrices(nxt);
  }

  function addCompetitor() {
    const asin = form.asin.trim().toUpperCase();
    if (!/^B0[A-Z0-9]{8}$/.test(asin)) return;
    if (comp.some((x) => x.asin === asin)) return;
    applyComp([...comp, { asin, label: form.label.trim(), oz: form.oz.trim() }], { refetch: true });
    setForm({ asin: "", label: "", oz: "" });
  }

  const perOz = (price, oz) => {
    const o = Number(oz);
    return price && o > 0 ? `$${(price / o).toFixed(2)}/oz` : null;
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div>
          <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 400, color: c.ink, margin: 0 }}>Pricing & Competitors</h1>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: "rgba(111,102,87,0.6)" }}>Buy box en vivo y vigilancia de competidores — precios reales de Amazon</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <button onClick={() => { loadMine(); loadCompPrices(); }} style={btnGhost}>REFRESH</button>
          <div style={{ fontSize: 9, fontFamily: sans, letterSpacing: 1, color: fetchedAt ? c.green : c.sub, marginTop: 4 }}>
            {fetchedAt ? `● DATA AS OF ${fetchedAt.toLocaleTimeString()}` : "○ FETCHING…"}
          </div>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans, marginBottom: 2 }}>My listings · buy box status</div>
        <div style={{ fontSize: 10, fontStyle: "italic", color: "rgba(111,102,87,0.55)", fontFamily: serif, marginBottom: 8 }}>Mis listados — quién tiene el buy box, el precio más bajo y cuántas ofertas compiten</div>
        {mine.loading && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub }}>Pricing every listing — Amazon limits the pace, ~1 second per ASIN…</div>}
        {mine.error && <div style={{ fontFamily: sans, fontSize: 11, color: c.red }}>{String(mine.error)}</div>}
        {!mine.loading && mine.results.map((r) => (
          <div key={r.asin} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #00000008", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: "1 1 220px" }}>
              <span style={{ fontFamily: serif, fontSize: 14, color: c.ink }}>{nameForSku(r.skus) || r.asin}</span>
              <span style={{ fontFamily: sans, fontSize: 9, color: c.sub, marginLeft: 8 }}>{r.asin}</span>
            </div>
            {r.error ? (
              <span style={{ fontFamily: sans, fontSize: 10, color: c.sub }}>no offer data (listing may be inactive)</span>
            ) : (
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", fontFamily: sans, fontSize: 11 }}>
                <span style={{ color: c.ink }}>MINE {money(r.myPrice)}</span>
                <span style={{ color: r.buyBoxIsMine ? c.green : c.red }}>
                  BUY BOX {money(r.buyBox)} {r.buyBoxIsMine ? "✓ mine" : r.buyBox !== null ? "✗ not mine" : ""}
                </span>
                <span style={{ color: c.sub }}>LOWEST {money(r.lowest)}</span>
                <span style={{ color: c.sub }}>{r.offerCount || 0} offer{r.offerCount === 1 ? "" : "s"}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ ...card, borderLeft: `3px solid ${c.clay}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans }}>Competitor watchlist</div>
            <div style={{ fontSize: 10, fontStyle: "italic", color: "rgba(111,102,87,0.55)", fontFamily: serif }}>Vigila cualquier ASIN — agrega las onzas y el $/oz hace comparables los tamaños</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={undo} disabled={!past.length} style={{ ...btnGhost, opacity: past.length ? 1 : 0.35 }}>↶ UNDO</button>
            <button onClick={redo} disabled={!future.length} style={{ ...btnGhost, opacity: future.length ? 1 : 0.35 }}>↷ REDO</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          <input style={{ ...inputS, width: 130 }} placeholder="ASIN (B0...)" value={form.asin} onChange={(e) => setForm({ ...form, asin: e.target.value })} />
          <input style={{ ...inputS, width: 180 }} placeholder="Label (e.g. Yankee 12oz)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <input style={{ ...inputS, width: 70 }} placeholder="oz" value={form.oz} onChange={(e) => setForm({ ...form, oz: e.target.value.replace(/[^0-9.]/g, "") })} />
          <button onClick={addCompetitor} style={{ ...btnGhost, borderColor: c.clay, color: c.clay }}>＋ WATCH</button>
        </div>

        {compLoading && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub, marginTop: 8 }}>Pricing the watchlist…</div>}
        {comp.map((x, i) => {
          const p = compPrices[x.asin] || {};
          return (
            <div key={x.asin} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #00000008", flexWrap: "wrap", marginTop: i === 0 ? 8 : 0 }}>
              <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                <span style={{ fontFamily: serif, fontSize: 14, color: c.ink }}>{x.label || x.asin}</span>
                <a href={`https://www.amazon.com/dp/${x.asin}`} target="_blank" rel="noreferrer" style={{ fontFamily: sans, fontSize: 9, color: c.clay, marginLeft: 8, textDecoration: "none" }}>{x.asin} ↗</a>
              </div>
              <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", fontFamily: sans, fontSize: 11 }}>
                <span style={{ color: c.ink }}>{p.error ? "no data" : money(p.buyBox ?? p.lowest)}</span>
                {perOz(p.buyBox ?? p.lowest, x.oz) && <span style={{ color: c.clay }}>{perOz(p.buyBox ?? p.lowest, x.oz)}</span>}
                <span style={{ color: c.sub }}>{p.offerCount ? `${p.offerCount} offers` : ""}</span>
                <input style={{ ...inputS, width: 56, textAlign: "center" }} value={x.oz} placeholder="oz"
                  onChange={(e) => applyComp(comp.map((y) => (y.asin === x.asin ? { ...y, oz: e.target.value.replace(/[^0-9.]/g, "") } : y)))} />
                <span onClick={() => applyComp(comp.filter((y) => y.asin !== x.asin))} style={{ color: c.red, cursor: "pointer", fontSize: 12 }}>✕</span>
              </div>
            </div>
          );
        })}
        {!comp.length && <div style={{ fontFamily: sans, fontSize: 11, color: c.sub, marginTop: 10 }}>Nothing watched yet — paste any Amazon ASIN above to start tracking it.</div>}
      </div>
    </div>
  );
}
