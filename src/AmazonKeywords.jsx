import { useState, useEffect, useMemo } from "react";

// LAVALLE HAUS OS — Amazon keyword trends, by product.
// Option A: suggestions are REAL Amazon Brand Analytics search terms, assigned to the
// product they fit, each with a 12-month monthly trend sparkline (real frequency-rank
// history — lower rank = more searched). ＋ adopts a term into the manual tracker,
// already tagged to that product. No invented keywords; every graph is real data.

const c = {
  ink: "#1a1714", sub: "#8c7d6b", line: "#c8c2b8", green: "#5a7a5a",
  clay: "#a07848", red: "#9b5e5e", card: "#efece5",
};
const serif = "'IM Fell English', Georgia, serif";
const mono = "monospace";

const SEED = ["candle", "candles", "wax", "beeswax", "soy candle", "scented candle", "sand candle", "sand wax", "apple candle", "vanilla candle", "cinnamon", "pumpkin spice", "fall candle", "autumn", "vessel candle", "dough bowl", "seashell", "scrub", "sugar scrub", "body scrub", "exfoliat", "bath salt", "bath soak", "body oil", "botanical", "aromatherapy", "home fragrance", "wax melt", "candle gift", "luxury candle", "natural candle", "spa gift"];
const STOP = ["candle", "large", "small", "with", "sand", "vanilla", "apple", "the", "and", "set", "pack", "oz"];
function buildFilter(products) {
  const toks = new Set(SEED);
  (products || []).filter((p) => !p.isSample).forEach((p) => {
    String(p.name || "").toLowerCase().split(/[^a-z]+/).forEach((w) => { if (w.length > 3 && STOP.indexOf(w) < 0) toks.add(w); });
  });
  return [...toks];
}

const num = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString());
const wait = (ms) => new Promise((z) => setTimeout(z, ms));
const monthLabel = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
};

// Sparkline of frequency RANK across months. Rank is inverted (lower = better),
// so we flip it visually: a rising line = climbing in search demand.
function Spark({ points }) {
  const valid = points.filter((p) => p.rank != null);
  if (valid.length < 2) return <span style={{ fontSize: 10, color: c.sub, fontFamily: mono }}>no trend yet</span>;
  const W = 132, H = 30, pad = 3;
  const ranks = valid.map((p) => p.rank);
  const lo = Math.min(...ranks), hi = Math.max(...ranks);
  const span = hi - lo || 1;
  const step = valid.length > 1 ? (W - pad * 2) / (valid.length - 1) : 0;
  // invert: best (low) rank -> top of chart
  const xy = valid.map((p, i) => {
    const x = pad + i * step;
    const y = pad + ((p.rank - lo) / span) * (H - pad * 2);
    return [x, y];
  });
  const path = xy.map((p) => p.join(",")).join(" ");
  const last = xy[xy.length - 1];
  const first = valid[0].rank, lastR = valid[valid.length - 1].rank;
  const up = lastR < first; // rank went DOWN numerically = MORE searched = up
  const col = up ? c.green : c.red;
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <polyline points={path} fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill={col} />
    </svg>
  );
}

export default function AmazonKeywords({ products = [], onTrack }) {
  const FILTER = useMemo(() => buildFilter(products), [products]);
  const amz = useMemo(
    () => (products || []).filter((p) => !p.isSample && (p.asin || (p.channels || []).indexOf("Amazon") >= 0)).map((p) => ({ id: String(p.id), name: p.name })),
    [products]
  );

  const [monthHistory, setMonthHistory] = useState({});
  const [byProduct, setByProduct] = useState(null);   // { productId: [term,...] }
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [open, setOpen] = useState({});
  const [added, setAdded] = useState({});

  const months = useMemo(() => Object.keys(monthHistory).sort(), [monthHistory]);

  // On mount: load whatever monthly history is already cached (no quota spent).
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/amazon-sync?op=keywords", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "searchterms", period: "MONTH" }),
        }).then((x) => x.json());
        if (r && r.monthHistory) setMonthHistory(r.monthHistory);
      } catch (e) { /* offline / not configured — fine */ }
    })();
  }, []);

  // One report pull (monthly), handling pending-poll and rate-limit waits.
  async function reportCall(extra) {
    let reportId = null, tries = 0;
    while (tries < 16) {
      let r;
      try {
        r = await fetch("/api/amazon-sync?op=keywords", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "searchterms", period: "MONTH", filter: FILTER, reportId, ...extra }),
        }).then((x) => x.json());
      } catch (e) { return { error: String(e).slice(0, 160) }; }
      if (r && r.monthHistory) setMonthHistory(r.monthHistory);
      if (r && r.pending) { reportId = r.reportId; await wait(11000); tries++; continue; }
      if (r && r.quota) { setBusy("Amazon rate-limit — pausing a minute…"); await wait(60000); tries++; continue; }
      return r || {};
    }
    return { error: "Timed out preparing a monthly report." };
  }

  // Ask the AI proxy to assign REAL terms to the product each best fits.
  async function aiAssign(candidates) {
    if (!amz.length || !candidates.length) return {};
    const catalog = amz.map((p) => p.id + ": " + p.name).join("; ");
    const terms = candidates.slice(0, 100);
    try {
      const res = await fetch("/api/categorize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_tokens: 1800,
          system:
            "You assign REAL Amazon search terms to a candle & body-care seller's products. " +
            "You are given a catalog ('id: name; id: name') and a list of real search terms. " +
            "Return ONLY a compact JSON object keyed by product id; each value is an array of the terms that genuinely fit THAT product. " +
            "Assign each term to at most one product. Drop terms that fit no product. No prose, no markdown fences. " +
            'Example: {"4":["spiced apple candle","apple cinnamon candle"],"7":["sugar body scrub"]}',
          messages: [{ role: "user", content: "Catalog: " + catalog + "\n\nReal search terms: " + terms.join(", ") }],
        }),
      }).then((x) => x.json());
      const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("") || "{}";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      const norm = {};
      Object.keys(parsed || {}).forEach((k) => { norm[String(k)] = Array.isArray(parsed[k]) ? parsed[k] : []; });
      return norm;
    } catch (e) { return {}; }
  }

  async function buildAndSuggest() {
    if (busy) return;
    if (!amz.length) { setErr("No Amazon products found in your catalog yet."); return; }
    setErr(""); setBusy("Pulling this month’s search terms…");
    const m0 = await reportCall({ weekOffset: 0, refresh: true });
    if (m0.error) { setBusy(""); setErr(m0.error); return; }
    const candidates = (m0.rows || []).map((r) => r.term).filter(Boolean);
    if (!candidates.length) { setBusy(""); setErr("No relevant search terms returned for this month yet."); return; }

    // Backfill the prior 11 months (resumable — already-cached months return instantly).
    for (let o = 1; o <= 11; o++) {
      setBusy("Building 12-month history… month −" + o + " of 11");
      const rr = await reportCall({ weekOffset: o, historyOnly: true });
      if (rr.error) break;
    }

    setBusy("Assigning trending terms to your products…");
    const assign = await aiAssign(candidates);
    setByProduct(assign || {});
    const o2 = {}; amz.forEach((p) => { o2[p.id] = true; }); setOpen(o2);
    setBusy("");
  }

  function seriesFor(term) {
    const lk = term.toLowerCase();
    return months.map((m) => ({ m, rank: monthHistory[m] && monthHistory[m][lk] != null ? monthHistory[m][lk] : null }));
  }
  function adopt(term, pname) {
    if (!onTrack) return;
    onTrack({ keyword: term, matchType: "phrase", product: pname, notes: "trending (Brand Analytics)" });
    setAdded((a) => ({ ...a, [pname + "|" + term]: true }));
  }

  const panel = { background: c.card, border: "1px solid " + c.line, borderRadius: 2, padding: 18, marginBottom: 14 };
  const chip = (on) => ({
    padding: "9px 16px", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono,
    cursor: busy ? "not-allowed" : "pointer", borderRadius: 1, border: "1px solid " + (on ? c.clay : c.line),
    background: on ? c.clay : "transparent", color: on ? "#fff" : c.sub, opacity: busy ? 0.6 : 1,
  });

  const built = months.length;

  return (
    <div>
      {/* Header / build */}
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontFamily: serif, fontSize: 22, color: c.ink }}>Keyword trends, by product</div>
            <div style={{ fontSize: 12, color: c.sub, marginTop: 4, maxWidth: 520 }}>
              Real Amazon search terms, grouped under the product they fit — each with a 12-month trend.
              A rising green line means the term is climbing in search demand.
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <button onClick={buildAndSuggest} disabled={!!busy} style={chip(true)}>
              {byProduct ? "↻ Refresh" : "✦ Build trends & suggest"}
            </button>
            <div style={{ fontSize: 10, color: c.sub, marginTop: 6, fontFamily: mono }}>
              {built ? built + " month" + (built === 1 ? "" : "s") + " of history" : "no history yet"}
            </div>
          </div>
        </div>
        {!byProduct && !busy && (
          <div style={{ fontSize: 11, color: c.sub, marginTop: 12, borderTop: "1px solid " + c.line, paddingTop: 10 }}>
            First build pulls ~12 monthly reports from Amazon and is paced for their rate limit, so it can take a
            few minutes. It’s one-time — months are cached permanently and the build resumes where it left off.
          </div>
        )}
        {busy && (
          <div style={{ fontSize: 12, color: c.clay, marginTop: 12, fontFamily: mono, borderTop: "1px solid " + c.line, paddingTop: 10 }}>
            ◷ {busy}
          </div>
        )}
        {err && (
          <div style={{ fontSize: 12, color: c.red, marginTop: 12, fontFamily: mono, borderTop: "1px solid " + c.line, paddingTop: 10 }}>
            {err}
          </div>
        )}
      </div>

      {/* Per-product results */}
      {byProduct && amz.map((p) => {
        const terms = (byProduct[p.id] || byProduct[String(p.id)] || []).filter(Boolean);
        const isOpen = open[p.id];
        return (
          <div key={p.id} style={panel}>
            <div
              onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
            >
              <div style={{ fontFamily: serif, fontSize: 17, color: c.ink }}>
                {p.name}
              </div>
              <div style={{ fontSize: 11, color: c.sub, fontFamily: mono }}>
                {terms.length} term{terms.length === 1 ? "" : "s"} {isOpen ? "▾" : "▸"}
              </div>
            </div>

            {isOpen && (
              terms.length === 0 ? (
                <div style={{ fontSize: 12, color: c.sub, marginTop: 10 }}>
                  No trending search terms matched this product this month.
                </div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  {terms.map((t) => {
                    const s = seriesFor(t);
                    const valid = s.filter((x) => x.rank != null);
                    const latest = valid.length ? valid[valid.length - 1].rank : null;
                    const prev = valid.length >= 2 ? valid[valid.length - 2].rank : null;
                    const delta = latest != null && prev != null ? prev - latest : null; // + = improved (rose)
                    const isAdded = added[p.name + "|" + t];
                    return (
                      <div key={t} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderTop: "1px solid " + c.line, flexWrap: "wrap" }}>
                        <div style={{ flex: "1 1 180px", minWidth: 150 }}>
                          <div style={{ fontSize: 13, color: c.ink }}>{t}</div>
                          <div style={{ fontSize: 10, color: c.sub, fontFamily: mono, marginTop: 2 }}>
                            {latest != null ? "rank #" + num(latest) : "unranked"}
                            {delta != null && delta !== 0 && (
                              <span style={{ color: delta > 0 ? c.green : c.red, marginLeft: 8 }}>
                                {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toLocaleString()} vs last mo
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ flex: "0 0 auto" }}>
                          <Spark points={s} />
                          {valid.length >= 2 && (
                            <div style={{ fontSize: 9, color: c.sub, fontFamily: mono, display: "flex", justifyContent: "space-between" }}>
                              <span>{monthLabel(valid[0].m)}</span>
                              <span>{monthLabel(valid[valid.length - 1].m)}</span>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => adopt(t, p.name)}
                          disabled={isAdded}
                          style={{
                            flex: "0 0 auto", padding: "6px 12px", fontSize: 11, fontFamily: mono, borderRadius: 1, cursor: isAdded ? "default" : "pointer",
                            border: "1px solid " + (isAdded ? c.green : c.clay), background: isAdded ? c.green : "transparent", color: isAdded ? "#fff" : c.clay,
                          }}
                        >
                          {isAdded ? "✓ added" : "＋ track"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        );
      })}

      {byProduct && (
        <div style={{ fontSize: 10, color: c.sub, fontFamily: mono, textAlign: "center", marginTop: 4 }}>
          Trend = Amazon Brand Analytics search-frequency rank, monthly. Lower rank = more searched.
        </div>
      )}
    </div>
  );
}
