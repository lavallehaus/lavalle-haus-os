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

const SEED = ["candle", "candles", "wax", "beeswax", "soy candle", "scented candle", "sand candle", "sand wax", "apple candle", "vanilla candle", "cinnamon", "pumpkin spice", "fall candle", "autumn", "harvest", "vessel candle", "dough bowl", "seashell", "scrub", "sugar scrub", "body scrub", "salt scrub", "exfoliat", "body polish", "bath salt", "bath soak", "bath salts", "epsom salt", "epsom", "soaking salt", "mineral bath", "muscle soak", "foot soak", "dead sea salt", "himalayan salt", "magnesium flakes", "bath bomb", "lavender bath", "sea salt soak", "detox bath", "body oil", "body butter", "body lotion", "shea butter", "botanical", "aromatherapy", "home fragrance", "wax melt", "candle gift", "luxury candle", "natural candle", "spa gift", "vase", "vessel", "home decor", "coastal decor", "beach decor", "nautical decor", "ocean decor", "centerpiece", "table centerpiece", "farmhouse decor", "rustic decor", "boho decor", "decorative bowl", "shelf decor", "mantel decor", "coastal", "nautical"];
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
// Search-frequency rank → PPC competition tier. Lower rank = more searched = pricier & crowded.
function tierOf(rank) {
  if (rank == null) return null;
  if (rank <= 2000) return { label: "broad · competitive", color: c.red };
  if (rank <= 50000) return { label: "moderate", color: c.sub };
  return { label: "long-tail · lower cost", color: c.green };
}

// Per-product "angles" — the different ways a shopper might search for THIS item
// beyond its base category (a seashell candle is also a vase / coastal decor / vessel).
function anglesFor(name) {
  const n = String(name || "").toLowerCase();
  const a = [];
  if (/seashell|shell/.test(n)) a.push("seashell", "shell", "coastal", "beach", "nautical", "ocean", "vessel", "vase", "home decor", "coastal decor", "beach decor", "centerpiece");
  if (/dough\s*bowl/.test(n)) a.push("dough bowl", "farmhouse", "rustic", "centerpiece", "table decor", "vessel", "decorative bowl", "home decor");
  if (/vessel/.test(n)) a.push("vessel", "vase", "home decor", "decorative", "centerpiece");
  if (/sand/.test(n)) a.push("sand candle", "beach", "coastal", "sand wax");
  if (/apple|spiced/.test(n)) a.push("apple", "spiced apple", "fall", "autumn", "harvest", "cinnamon", "pumpkin");
  if (/dough|bowl|vessel|seashell|shell/.test(n)) a.push("decor");
  return a;
}
function angleRegex(name) {
  const a = anglesFor(name);
  if (!a.length) return null;
  return new RegExp(a.map((w) => w.replace(/\s+/g, "\\s*")).join("|"));
}

// Category-aware relevance: a term must POSITIVELY match the product's category
// OR one of its angles, and not hit a known false-friend (e.g. "bath mat").
function categoryOf(name) {
  const n = String(name || "").toLowerCase();
  if (/scrub|exfoliat|polish/.test(n)) return "scrub";
  if (/bath|salt|soak/.test(n)) return "bath";
  if (/body\s*oil|massage/.test(n)) return "bodyoil";
  if (/candle|wax|vessel|sand|seashell|apple|dough|botanical|beeswax/.test(n)) return "candle";
  return "other";
}
const POS = {
  candle: /candle|wax\b|fragrance|aromatherapy|melt|vessel|scent|soy|beeswax|votive|pillar/,
  scrub: /scrub|exfoliat|polish|sugar|body\s*scrub|coffee\s*scrub|salt\s*scrub/,
  bath: /bath\s*salt|bath\s*soak|epsom|mineral\s*soak|mineral\s*bath|muscle\s*soak|salt\s*soak|bath\s*bomb|soaking\s*salt|foot\s*soak|dead\s*sea|himalayan|magnesium|sea\s*salt|detox\s*bath|salt\s*bath|spa\s*salt/,
  bodyoil: /body\s*oil|massage\s*oil|skin\s*oil|bath\s*oil/,
  other: /candle|scrub|bath|salt|oil|wax|soak/,
};
const NEG = {
  candle: /holder|warmer|plug\s*in|wick\s*trimmer|snuffer|lighter|jar\s*only/,
  scrub: /brush|glove|loofah|pad\b|machine|cleaner\b/,
  bath: /\bmat\b|towel|rug|curtain|mirror|tile|faucet|\btub\b|robe|caddy|tray|pillow|sponge|bathroom|rack|shelf|sink/,
  bodyoil: /diffuser|essential\s*oil\s*set|car\b|engine/,
  other: /\bmat\b|towel|rug|holder|warmer|brush|glove/,
};
function relevantTerms(name, terms) {
  const cat = categoryOf(name);
  const pos = POS[cat] || POS.other, neg = NEG[cat] || NEG.other;
  const ang = angleRegex(name);
  return terms.filter((t) => { const tl = String(t).toLowerCase(); return (pos.test(tl) || (ang && ang.test(tl))) && !neg.test(tl); });
}

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

export default function AmazonKeywords({ products = [], onTrack, onAddProduct }) {
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
  const [newName, setNewName] = useState("");
  const [addedMsg, setAddedMsg] = useState("");

  function doAdd() {
    const nm = newName.trim();
    if (!nm || !onAddProduct) return;
    onAddProduct(nm);
    setNewName("");
    setAddedMsg("✓ Added “" + nm + "” to your catalog. Press Refresh above to pull keyword suggestions for it.");
    setTimeout(() => setAddedMsg(""), 9000);
  }

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
            "Give a VARIED mix per product across its different buyer angles — do NOT assign the same generic words to every product. " +
            "A decorative vessel candle (e.g. seashell or dough bowl) should ALSO get decor angles like 'vase','home decor','coastal decor','centerpiece', not only 'candle'. " +
            "Include BOTH broad head terms AND specific long-tail phrases when present. " +
            "EVERY product must get at least 2–6 real terms. If nothing fits perfectly, assign the closest BROADER real terms instead of leaving it empty " +
            "(e.g. a candle product → 'soy candle','scented candle','home fragrance'; a scrub → 'body scrub','sugar scrub','exfoliating scrub'; bath salts → 'bath salts','bath soak','epsom salt'). " +
            "NEVER assign accessories or different product types: e.g. 'bath mat','bath towel','candle holder','warmer' are WRONG — exclude them. " +
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
    const ang = angleRegex(name);
    const scored = candidates.map((t) => {
      const tl = t.toLowerCase();
      const ttok = tl.split(/[^a-z]+/).filter(Boolean);
      let s = 0;
      ttok.forEach((w) => { if (ntok.has(w)) s += 3; });
      if (ang && ang.test(tl)) s += 3;                 // matches one of this product's angles
      if (isScrub && /scrub|exfoliat|polish|body/.test(tl)) s += 2;
      if (isBath && /bath|salt|soak|spa/.test(tl)) s += 2;
      if (isCandle && /candle|wax|fragrance|aromatherapy|melt|vessel/.test(tl)) s += 2;
      return { t, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    return scored.map((x) => x.t);
  }

  // Smart keyword suggestions for products Amazon has no trend data on yet.
  // Returns the real category search phrases a shopper would type (not the product name).
  async function aiSuggest(prods) {
    if (!prods.length) return {};
    const list = prods.map((p) => p.id + ": " + p.name).join("; ");
    try {
      const res = await fetch("/api/categorize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_tokens: 1400,
          system:
            "You suggest high-intent Amazon buyer search keywords for candle & body-care products. " +
            "For EACH product id given, return 6–8 realistic lowercase search phrases a shopper would actually type — the real CATEGORY terms. " +
            "Return a MIX of breadth: 2–3 broad head terms AND 4–5 specific long-tail phrases (long-tail convert cheaper and are less crowded in ads). " +
            "Span the product's DIFFERENT buyer angles, not one repeated theme — a decorative vessel candle is also a vase / coastal or beach decor / centerpiece / nautical piece. " +
            "Do NOT echo the literal product name and NEVER include descriptor words like 'unscented'. " +
            "Example — 'SeaShell Vessel Candle' → ['seashell candle','coastal decor','beach home decor','nautical candle','vase candle','coastal centerpiece','ocean themed decor']. " +
            "Example — 'Bath Salts Unscented' → ['bath salts','epsom salt','epsom bath soak','muscle soak','mineral bath salt','soaking salts','bath soak']. " +
            "No brand names, no markdown. Return ONLY JSON keyed by product id, each value an array of phrases. " +
            'Example: {"6":["bath salts","epsom salt","epsom bath soak","muscle soak","mineral bath salt"]}',
          messages: [{ role: "user", content: "Products: " + list }],
        }),
      }).then((x) => x.json());
      const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("") || "{}";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      const norm = {};
      Object.keys(parsed || {}).forEach((k) => { norm[String(k)] = Array.isArray(parsed[k]) ? parsed[k] : []; });
      return norm;
    } catch (e) { return {}; }
  }

  async function buildAndSuggest(force = false) {
    if (busy) return;
    if (!amz.length) { setErr("No Amazon products found in your catalog yet."); return; }
    setErr(""); setBusy("building");

    const total = 12;                 // this month + 11 prior
    const durations = [];
    let completed = 0;
    const haveHist = !force && Object.keys(monthHistory).length >= 11;
    const avg = () => (durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 165000);
    const show = (stage, monthStart) =>
      setProg({ stage, done: completed, total, monthStart, avgMs: avg(), etaMs: Math.round(avg() * (total - completed)), etaSetAt: Date.now() });

    // Month 0 — reuse the cached current month if we have it; only spend a fresh
    // (slow) pull when there's nothing cached, or when force-rebuilding. etaMs null = "estimating…".
    let s0 = Date.now();
    setProg({ stage: haveHist ? "Reusing cached history…" : "This month’s search terms", done: 0, total, monthStart: s0, avgMs: haveHist ? 4000 : 165000, etaMs: null, etaSetAt: Date.now() });
    let m0 = force ? { rows: [] } : await reportCall({ weekOffset: 0 }); // cache-first unless forcing
    let candidates = (m0.rows || []).map((r) => r.term).filter(Boolean);
    if (force || !candidates.length) {                            // nothing cached, or forced → pull fresh
      setProg({ stage: "This month’s search terms", done: 0, total, monthStart: Date.now(), avgMs: 165000, etaMs: null, etaSetAt: Date.now() });
      m0 = await reportCall({ weekOffset: 0, refresh: true });
      if (m0.error) { setProg(null); setBusy(""); setErr(m0.error); return; }
      candidates = (m0.rows || []).map((r) => r.term).filter(Boolean);
    }
    durations.push(Date.now() - s0); completed = 1;
    if (!candidates.length) { setProg(null); setBusy(""); setErr("No relevant search terms returned yet — press Build again."); return; }

    // Backfill the prior 11 months. Normally cached months return instantly; when
    // forcing, every month is re-pulled fresh with the current (widened) filter.
    let stopped = false;
    for (let o = 1; o <= 11; o++) {
      let so = Date.now();
      show("Month −" + o + " of 11", so);
      const rr = await reportCall({ weekOffset: o, historyOnly: true, refresh: force });
      durations.push(Date.now() - so); completed += 1;
      if (rr.error) { stopped = true; setErr("Paused at month −" + o + " — press Build to resume where it left off."); break; }
    }

    setProg({ stage: "Sorting terms under each product", done: total, total, monthStart: Date.now(), avgMs: avg(), etaMs: 0, etaSetAt: Date.now() });
    const assign = await aiAssign(candidates);
    const have = new Set(candidates.map((x) => x.toLowerCase()));
    const filled = {};
    amz.forEach((p) => {
      const arr = assign[p.id] || assign[String(p.id)] || [];
      const aiReal = (Array.isArray(arr) ? arr : []).filter((t) => t && have.has(String(t).toLowerCase()));
      const close = closestReal(p.name, candidates);
      // union AI picks + closeness picks, then keep only category-relevant terms
      let pool = [...new Set([...aiReal, ...close].map((t) => String(t)))];
      pool = relevantTerms(p.name, pool);
      pool = [...new Set(pool)].slice(0, 14);            // generous pool; render ranks & trims
      filled[p.id] = { matched: pool, ideas: [] };
    });
    // Suggest category/angle keywords when Amazon's data is empty OR one-dimensional
    // (a product that has angles like seashell/dough-bowl but whose real terms miss them).
    const needSugg = amz.filter((p) => {
      const m = filled[p.id].matched || [];
      if (!m.length) return true;
      const ang = angleRegex(p.name);
      return !!(ang && !m.some((t) => ang.test(String(t).toLowerCase())));
    });
    if (needSugg.length) {
      setProg({ stage: "Adding angle & long-tail keyword ideas", done: total, total, monthStart: Date.now(), avgMs: avg(), etaMs: 0, etaSetAt: Date.now() });
      const sugg = await aiSuggest(needSugg);
      needSugg.forEach((p) => {
        const have = new Set((filled[p.id].matched || []).map((t) => String(t).toLowerCase()));
        filled[p.id].ideas = (sugg[p.id] || sugg[String(p.id)] || [])
          .filter((t) => t && !have.has(String(t).toLowerCase())).slice(0, 6);
      });
    }
    setByProduct(filled);
    const o2 = {}; amz.forEach((p) => { o2[p.id] = true; }); setOpen(o2);
    setProg(null); setBusy("");
  }

  function seriesFor(term) {
    const lk = term.toLowerCase();
    return months.map((m) => ({ m, rank: monthHistory[m] && monthHistory[m][lk] != null ? monthHistory[m][lk] : null }));
  }
  // Trend over the whole window: positive score = climbing (rank fell = more searched).
  function trendScore(term) {
    const s = seriesFor(term).filter((x) => x.rank != null).map((x) => x.rank);
    if (s.length < 2) return { dir: 0, score: 0 };       // not enough data = neutral
    const imp = s[0] - s[s.length - 1];
    return { dir: imp > 0 ? 1 : imp < 0 ? -1 : 0, score: imp };
  }
  // Rising first, then stable/new (for angle + long-tail variety). Only declining is dropped.
  function rankByTrend(terms) {
    const scored = terms.map((t) => ({ t, ...trendScore(t) }));
    const up = scored.filter((x) => x.dir > 0).sort((a, b) => b.score - a.score);
    const flat = scored.filter((x) => x.dir === 0);
    return up.concat(flat).slice(0, 9).map((x) => x.t);
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
          <div style={{ textAlign: "right", maxWidth: 280 }}>
            <button onClick={() => buildAndSuggest(false)} disabled={!!busy} style={chip(true)}>
              {byProduct ? "↻ Refresh" : "✦ Build trends & suggest"}
            </button>
            <div style={{ fontSize: 10, color: c.sub, marginTop: 5, lineHeight: 1.4 }}>
              {byProduct
                ? "Fast (seconds). Reuses your saved 12 months and just re-checks this month. Use this day to day."
                : "First-time setup. Pulls 12 months from Amazon — takes a few minutes, then it’s cached."}
            </div>
            <div style={{ fontSize: 10, color: c.sub, marginTop: 6, fontFamily: mono }}>
              {built ? built + " month" + (built === 1 ? "" : "s") + " of history saved" : "no history yet"}
            </div>
            {built > 0 && (
              <div style={{ marginTop: 10, borderTop: "1px dashed " + c.line, paddingTop: 10 }}>
                <button
                  onClick={() => { if (window.confirm("Re-pull all 12 months fresh from Amazon? This is only needed after a keyword settings change. It uses Amazon quota and takes a few minutes.")) buildAndSuggest(true); }}
                  disabled={!!busy}
                  style={{ padding: "4px 10px", fontSize: 9, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, cursor: busy ? "not-allowed" : "pointer", borderRadius: 1, border: "1px solid " + c.line, background: "transparent", color: c.sub, opacity: busy ? 0.5 : 1 }}
                >
                  ⟳ Rebuild (re-pull)
                </button>
                <div style={{ fontSize: 10, color: c.sub, marginTop: 5, lineHeight: 1.4 }}>
                  Slow (several minutes). Throws away saved data and re-pulls all 12 months fresh. Only needed after the keyword setup changes — not for normal use.
                </div>
              </div>
            )}
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
        const matched = rankByTrend((entry.matched || []).filter(Boolean)); // only rising terms
        const ideas = (entry.ideas || []).filter(Boolean);
        const risingN = matched.filter((t) => trendScore(t).dir > 0).length;
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
                {risingN ? <span style={{ color: c.green }}>▲ {risingN} rising</span> : null}
                {risingN && (matched.length - risingN) ? " · " + (matched.length - risingN) + " stable" : ""}
                {!matched.length && ideas.length ? ideas.length + " suggested" : (ideas.length ? " · " + ideas.length + " angle ideas" : "")}
                {!matched.length && !ideas.length ? "no terms" : ""}
                {" "}{isOpen ? "▾" : "▸"}
              </div>
            </div>

            {isOpen && (
              <div style={{ marginTop: 12 }}>
                {rows.length === 0 && (
                  <div style={{ fontSize: 12, color: c.sub, marginTop: 4, lineHeight: 1.5 }}>
                    {(entry.matched || []).filter(Boolean).length > 0
                      ? "No rising search terms right now — this product’s relevant terms are flat or declining this month."
                      : "No Amazon search data for this product yet — it’s a low-search item, so there’s nothing real to suggest until demand picks up. This is the data telling you the truth, not a bug."}
                  </div>
                )}
                {rows.map((row) => {
                  const t = row.term;
                  const isAdded = added[p.name + "|" + t];
                  if (row.idea) {
                    return (
                      <div key={"idea-" + t} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderTop: "1px solid " + c.line, flexWrap: "wrap" }}>
                        <div style={{ flex: "1 1 180px", minWidth: 150 }}>
                          <div style={{ fontSize: 13, color: c.ink }}>{t}</div>
                          <div style={{ fontSize: 10, color: c.clay, fontFamily: mono, marginTop: 2 }}>
                            ◆ suggested category keyword
                          </div>
                        </div>
                        <div style={{ flex: "0 0 auto", fontSize: 10, color: c.sub, fontFamily: mono, width: 132, textAlign: "center" }}>
                          no trend data yet
                        </div>
                        <button
                          onClick={() => adopt(t, p.name, true)}
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
                  }
                  const s = seriesFor(t);
                  const valid = s.filter((x) => x.rank != null);
                  const latest = valid.length ? valid[valid.length - 1].rank : null;
                  const firstR = valid.length ? valid[0].rank : null;
                  const rise = firstR != null && latest != null ? firstR - latest : null; // + = climbed over window
                  const span = valid.length;
                  return (
                    <div key={t} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderTop: "1px solid " + c.line, flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 180px", minWidth: 150 }}>
                        <div style={{ fontSize: 13, color: c.ink }}>{t}</div>
                        <div style={{ fontSize: 10, color: c.sub, fontFamily: mono, marginTop: 2 }}>
                          {latest != null ? "rank #" + num(latest) : "unranked"}
                          {tierOf(latest) && <span style={{ color: tierOf(latest).color, marginLeft: 6 }}>· {tierOf(latest).label}</span>}
                          {rise != null && rise > 0 && (
                            <span style={{ color: c.green, marginLeft: 6 }}>
                              ▲ climbed {Math.abs(rise).toLocaleString()} over {span}mo
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
        <div style={{ fontSize: 10, color: c.sub, lineHeight: 1.7, marginTop: 4, padding: "12px 14px", background: c.card, border: "1px solid " + c.line, borderRadius: 2 }}>
          <div style={{ fontFamily: serif, fontSize: 13, color: c.ink, marginBottom: 5 }}>How to read this</div>
          <span style={{ color: c.green }}>▲ rising</span> = climbing in Amazon searches (good).{" "}
          <b>stable</b> = steady demand.{" "}
          <span style={{ color: c.red }}>broad · competitive</span> = high-volume term, crowded & pricier in ads.{" "}
          <span style={{ color: c.green }}>long-tail · lower cost</span> = niche term, cheaper clicks, buyers closer to purchasing — often the smartest place to start.{" "}
          <span style={{ color: c.clay }}>◆ suggested category keyword</span> = a relevant keyword Amazon has no trend data on yet (run an ad to start gathering it). The little graph is real 12-month search-rank history; lower rank number = more searched.
        </div>
      )}

      {onAddProduct && (
        <div style={{ ...panel, marginTop: 14 }}>
          <div style={{ fontFamily: serif, fontSize: 17, color: c.ink }}>Add a product to research</div>
          <div style={{ fontSize: 12, color: c.sub, marginTop: 4, marginBottom: 12, lineHeight: 1.5 }}>
            Launching something new — body oil, body lotion, a new candle? Add it here and it joins your product
            catalog everywhere in the app (Inventory included). Then press <b>Refresh</b> above to pull keyword suggestions for it.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doAdd(); }}
              placeholder="e.g. Lavender Body Oil"
              style={{ flex: "1 1 220px", minWidth: 180, padding: "9px 12px", fontSize: 13, fontFamily: serif, color: c.ink, background: "#fff", border: "1px solid " + c.line, borderRadius: 1, outline: "none" }}
            />
            <button
              onClick={doAdd}
              disabled={!newName.trim()}
              style={{ padding: "9px 16px", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", fontFamily: mono, cursor: newName.trim() ? "pointer" : "not-allowed", borderRadius: 1, border: "1px solid " + c.clay, background: newName.trim() ? c.clay : "transparent", color: newName.trim() ? "#fff" : c.sub, opacity: newName.trim() ? 1 : 0.6 }}
            >
              ＋ Add product
            </button>
          </div>
          {addedMsg && <div style={{ fontSize: 11, color: c.green, marginTop: 8, fontFamily: mono }}>{addedMsg}</div>}
        </div>
      )}
    </div>
  );
}
