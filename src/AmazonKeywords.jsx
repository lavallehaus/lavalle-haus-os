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
  const [prog, setProg] = useState(null); // { stage, done, total, monthStart, avgMs, etaMs, etaSetAt }
  const [nowTs, setNowTs] = useState(Date.now());

  const months = useMemo(() => Object.keys(monthHistory).sort(), [monthHistory]);

  // 1s ticker so the progress bar + ETA count down smoothly between month updates.
  useEffect(() => {
    if (!prog) return;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [prog]);

  const fmtDur = (ms) => {
    if (ms == null) return "—";
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    return (m > 0 ? m + "m " : "") + String(s % 60).padStart(m > 0 ? 2 : 1, "0") + "s";
  };

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
      if (r && r.quota) { setProg((p) => (p ? { ...p, stage: "Amazon rate-limit — pausing 60s", etaMs: (p.etaMs || 0) + 60000, etaSetAt: Date.now() } : p)); await wait(60000); tries++; continue; }
      return r || {};
    }
    return { error: "Timed out preparing a monthly report." };
  }

  // Keyword research: assign each product its CLOSEST real search terms (verbatim).
  // Returns { productId: [realTerm,...] } — real terms only, broad matches allowed.
  async function aiAssign(candidates) {
    if (!amz.length || !candidates.length) return {};
    const catalog = amz.map((p) => p.id + ": " + p.name).join("; ");
    const terms = candidates.slice(0, 110);
    try {
      const res = await fetch("/api/categorize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_tokens: 2200,
          system:
            "You are doing Amazon keyword research for a candle & body-care seller. " +
            "Input: a catalog ('id: name; id: name') and a list of REAL Amazon search terms. " +
            "For EACH product, return the real search terms CLOSEST and most relevant to it — copied VERBATIM from the list. " +
            "EVERY product must get at least 2–6 real terms. If nothing fits perfectly, assign the closest BROADER real terms instead of leaving it empty " +
            "(e.g. a candle product → 'candles','scented candle','soy candle','home fragrance'; a scrub → 'body scrub','sugar scrub','exfoliating scrub'; bath salts → 'bath salts','bath soak'). " +
            "A broad term may be given to several products when equally relevant. Use ONLY terms from the provided list — never invent terms. " +
            "Return ONLY compact JSON keyed by product id, each value an array of terms. No prose, no markdown. " +
            'Example: {"4":["spiced apple candle","apple cinnamon candle","candles"],"1":["seashell candle","coastal candle","home fragrance"]}',
          messages: [{ role: "user", content: "Catalog: " + catalog + "\n\nReal search terms: " + terms.join(", ") }],
        }),
      }).then((x) => x.json());
      const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("") || "{}";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      const norm = {};
      Object.keys(parsed || {}).forEach((k) => {
        const v = parsed[k];
        norm[String(k)] = Array.isArray(v) ? v : (v && Array.isArray(v.matched) ? v.matched : []);
      });
      return norm;
    } catch (e) { return {}; }
  }

  // Client-side closeness ranking — used if the AI omits a product, so it still
  // gets the closest REAL terms (graphed) rather than a made-up idea.
  function closestReal(name, candidates) {
    const n = String(name || "").toLowerCase();
    const ntok = new Set(n.split(/[^a-z]+/).filter((w) => w.length > 2));
    const isScrub = /scrub/.test(n);
    const isBath = /bath|salt/.test(n);
    const isCandle = /candle|wax|vessel|sand|seashell|apple|dough|botanical/.test(n);
    const scored = candidates.map((t) => {
      const tl = t.toLowerCase();
      const ttok = tl.split(/[^a-z]+/).filter(Boolean);
      let s = 0;
      ttok.forEach((w) => { if (ntok.has(w)) s += 3; });
      if (isScrub && /scrub|exfoliat|polish|body/.test(tl)) s += 2;
      if (isBath && /bath|salt|soak|spa/.test(tl)) s += 2;
      if (isCandle && /candle|wax|fragrance|aromatherapy|melt|vessel/.test(tl)) s += 2;
      return { t, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    return scored.map((x) => x.t);
  }

  // Deterministic last-resort keyword if the AI returns nothing for a product.
  function fallbackIdeas(name) {
    const n = String(name || "").toLowerCase();
    const skip = ["the", "and", "with", "set", "pack", "oz", "16oz", "32oz", "mini", "large", "small"];
    const words = n.split(/[^a-z]+/).filter((w) => w.length > 2 && skip.indexOf(w) < 0);
    const base = words.slice(0, 3).join(" ").trim();
    const out = [];
    if (base) out.push(base);
    if (n.indexOf("candle") >= 0 && base.indexOf("candle") < 0) {
      const alt = (words.filter((w) => w !== "candle").slice(0, 2).join(" ") + " candle").trim();
      if (alt && out.indexOf(alt) < 0) out.push(alt);
    }
    return out.length ? out.slice(0, 2) : ["lavalle haus candle"];
  }

  async function buildAndSuggest() {
    if (busy) return;
    if (!amz.length) { setErr("No Amazon products found in your catalog yet."); return; }
    setErr(""); setBusy("building");

    const total = 12;                 // this month + 11 prior
    const durations = [];
    let completed = 0;
    const haveHist = Object.keys(monthHistory).length >= 11;
    const avg = () => (durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 165000);
    const show = (stage, monthStart) =>
      setProg({ stage, done: completed, total, monthStart, avgMs: avg(), etaMs: Math.round(avg() * (total - completed)), etaSetAt: Date.now() });

    // Month 0 — reuse the cached current month if we have it; only spend a fresh
    // (slow) pull when there's nothing cached. etaMs starts null = "estimating…".
    let s0 = Date.now();
    setProg({ stage: haveHist ? "Reusing cached history…" : "This month’s search terms", done: 0, total, monthStart: s0, avgMs: haveHist ? 4000 : 165000, etaMs: null, etaSetAt: Date.now() });
    let m0 = await reportCall({ weekOffset: 0 });                 // cache-first (no refresh)
    let candidates = (m0.rows || []).map((r) => r.term).filter(Boolean);
    if (!candidates.length) {                                     // nothing cached → pull fresh
      setProg({ stage: "This month’s search terms", done: 0, total, monthStart: Date.now(), avgMs: 165000, etaMs: null, etaSetAt: Date.now() });
      m0 = await reportCall({ weekOffset: 0, refresh: true });
      if (m0.error) { setProg(null); setBusy(""); setErr(m0.error); return; }
      candidates = (m0.rows || []).map((r) => r.term).filter(Boolean);
    }
    durations.push(Date.now() - s0); completed = 1;
    if (!candidates.length) { setProg(null); setBusy(""); setErr("No relevant search terms returned yet — press Build again."); return; }

    // Backfill the prior 11 months (resumable — already-cached months return instantly).
    let stopped = false;
    for (let o = 1; o <= 11; o++) {
      let so = Date.now();
      show("Month −" + o + " of 11", so);
      const rr = await reportCall({ weekOffset: o, historyOnly: true });
      durations.push(Date.now() - so); completed += 1;
      if (rr.error) { stopped = true; setErr("Paused at month −" + o + " — press Build to resume where it left off."); break; }
    }

    setProg({ stage: "Sorting terms under each product", done: total, total, monthStart: Date.now(), avgMs: avg(), etaMs: 0, etaSetAt: Date.now() });
    const assign = await aiAssign(candidates);
    const have = new Set(candidates.map((x) => x.toLowerCase()));
    const filled = {};
    amz.forEach((p) => {
      const arr = assign[p.id] || assign[String(p.id)] || [];
      // keep only terms we actually have data for (guard against any invented term)
      let real = (Array.isArray(arr) ? arr : []).filter((t) => t && have.has(String(t).toLowerCase()));
      if (real.length < 2) {
        // AI under-assigned — backfill with the closest REAL terms by token overlap
        const close = closestReal(p.name, candidates).filter((t) => real.indexOf(t) < 0);
        real = real.concat(close).slice(0, 6);
      }
      // de-dupe, cap
      real = [...new Set(real.map((t) => String(t)))].slice(0, 6);
      const ideas = real.length ? [] : fallbackIdeas(p.name); // only if Amazon truly returned nothing relevant
      filled[p.id] = { matched: real, ideas };
    });
    setByProduct(filled);
    const o2 = {}; amz.forEach((p) => { o2[p.id] = true; }); setOpen(o2);
    setProg(null); setBusy("");
  }

  function seriesFor(term) {
    const lk = term.toLowerCase();
    return months.map((m) => ({ m, rank: monthHistory[m] && monthHistory[m][lk] != null ? monthHistory[m][lk] : null }));
  }
  function adopt(term, pname, idea) {
    if (!onTrack) return;
    onTrack({ keyword: term, matchType: "phrase", product: pname, notes: idea ? "test idea (no trend data yet)" : "trending (Brand Analytics)" });
    setAdded((a) => ({ ...a, [pname + "|" + term]: true }));
  }

  const panel = { background: c.card, border: "1px solid " + c.line, borderRadius: 2, padding: 18, marginBottom: 14 };
  const chip = (on) => ({
    padding: "9px 16px", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono,
    cursor: busy ? "not-allowed" : "pointer", borderRadius: 1, border: "1px solid " + (on ? c.clay : c.line),
    background: on ? c.clay : "transparent", color: on ? "#fff" : c.sub, opacity: busy ? 0.6 : 1,
  });

  const built = months.length;

  // Live progress derivations (recompute each ticker tick via nowTs).
  const partial = prog && prog.avgMs ? Math.min(0.97, (nowTs - prog.monthStart) / prog.avgMs) : 0;
  const frac = prog ? Math.min(1, (prog.done + partial) / prog.total) : 0;
  const remainMs = prog && prog.etaMs != null ? Math.max(0, prog.etaMs - (nowTs - prog.etaSetAt)) : null;
  const monthNo = prog ? Math.min(prog.done + 1, prog.total) : 0;

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
        {!byProduct && !prog && (
          <div style={{ fontSize: 11, color: c.sub, marginTop: 12, borderTop: "1px solid " + c.line, paddingTop: 10 }}>
            First build pulls ~12 monthly reports from Amazon and is paced for their rate limit, so it can take a
            few minutes. It’s one-time — months are cached permanently and the build resumes where it left off.
          </div>
        )}
        {prog && (
          <div style={{ marginTop: 14, borderTop: "1px solid " + c.line, paddingTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
              <span style={{ fontSize: 12, color: c.clay, fontFamily: mono }}>◷ {prog.stage}</span>
              <span style={{ fontSize: 11, color: c.sub, fontFamily: mono }}>
                {prog.done >= prog.total ? "finalizing" : "month " + monthNo + " of " + prog.total}
              </span>
            </div>
            <div style={{ height: 9, background: "#e2ddd3", borderRadius: 5, overflow: "hidden" }}>
              <div style={{ height: "100%", width: (frac * 100).toFixed(1) + "%", background: c.clay, borderRadius: 5, transition: "width 0.6s ease" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: c.sub, fontFamily: mono, marginTop: 7 }}>
              <span>{Math.round(frac * 100)}% complete</span>
              <span>{remainMs != null ? "~" + fmtDur(remainMs) + " left" : "estimating…"}</span>
            </div>
            <div style={{ fontSize: 10, color: c.sub, marginTop: 6 }}>
              You can leave this running. If it stops, press Build again — it resumes where it left off.
            </div>
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
        const entry = byProduct[p.id] || byProduct[String(p.id)] || { matched: [], ideas: [] };
        const matched = (entry.matched || []).filter(Boolean);
        const ideas = (entry.ideas || []).filter(Boolean);
        const rows = matched.map((t) => ({ term: t, idea: false })).concat(ideas.map((t) => ({ term: t, idea: true })));
        const isOpen = open[p.id];
        return (
          <div key={p.id} style={panel}>
            <div
              onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
            >
              <div style={{ fontFamily: serif, fontSize: 17, color: c.ink }}>{p.name}</div>
              <div style={{ fontSize: 11, color: c.sub, fontFamily: mono }}>
                {matched.length} trend{matched.length === 1 ? "" : "s"}
                {ideas.length ? " · " + ideas.length + " idea" + (ideas.length === 1 ? "" : "s") : ""} {isOpen ? "▾" : "▸"}
              </div>
            </div>

            {isOpen && (
              <div style={{ marginTop: 12 }}>
                {rows.map((row) => {
                  const t = row.term;
                  const isAdded = added[p.name + "|" + t];
                  if (row.idea) {
                    return (
                      <div key={"idea-" + t} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderTop: "1px solid " + c.line, flexWrap: "wrap" }}>
                        <div style={{ flex: "1 1 180px", minWidth: 150 }}>
                          <div style={{ fontSize: 13, color: c.ink }}>{t}</div>
                          <div style={{ fontSize: 10, color: c.clay, fontFamily: mono, marginTop: 2 }}>
                            ◇ test idea — no Amazon trend data yet
                          </div>
                        </div>
                        <div style={{ flex: "0 0 auto", fontSize: 10, color: c.sub, fontFamily: mono, width: 132, textAlign: "center" }}>
                          run an ad to gather data
                        </div>
                        <button
                          onClick={() => adopt(t, p.name, true)}
                          disabled={isAdded}
                          style={{
                            flex: "0 0 auto", padding: "6px 12px", fontSize: 11, fontFamily: mono, borderRadius: 1, cursor: isAdded ? "default" : "pointer",
                            border: "1px dashed " + (isAdded ? c.green : c.clay), background: isAdded ? c.green : "transparent", color: isAdded ? "#fff" : c.clay,
                          }}
                        >
                          {isAdded ? "✓ added" : "＋ test"}
                        </button>
                      </div>
                    );
                  }
                  const s = seriesFor(t);
                  const valid = s.filter((x) => x.rank != null);
                  const latest = valid.length ? valid[valid.length - 1].rank : null;
                  const prev = valid.length >= 2 ? valid[valid.length - 2].rank : null;
                  const delta = latest != null && prev != null ? prev - latest : null; // + = improved (rose)
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
                        onClick={() => adopt(t, p.name, false)}
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
            )}
          </div>
        );
      })}

      {byProduct && (
        <div style={{ fontSize: 10, color: c.sub, fontFamily: mono, textAlign: "center", marginTop: 4 }}>
          Solid line = real Brand Analytics rank (lower = more searched). ◇ test ideas have no trend data until you run an ad.
        </div>
      )}
    </div>
  );
}
