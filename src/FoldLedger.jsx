import React, { useMemo, useState } from "react";

// THE FOLD · LEDGER — per-piece unit economics + ad spend for the label,
// built like a case study: every garment carries its wholesale cost, retail,
// contribution per unit, its share of fixed marketing (shoot production,
// allocated by inventory investment within its season), its monthly ad
// allotment from the $35/day pool, and a break-even unit count. Seasons
// group the sheet; the Month/YTD toggle answers "what happened this month"
// vs "where do we stand for the year" so ads gear toward what actually
// sells for the time of year. Constraint the analysis honors: ad spend is
// CAPPED at ~$35/day and clothing sales are ~zero so far — prices must
// compete (hold the 3x floor of the 3–4x rule rather than stretch to 4x),
// and the budget concentrates on the few pieces with proof of demand.
// Her ads partner works from the CSV / digest exports.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", red: "#9b5e5e", green: "#5a7a5a" };
const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const uid = () => "fl" + Math.random().toString(36).slice(2, 9);
const money = (n) => (n || n === 0) && isFinite(n) ? "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—";
const num = (v) => { const n = parseFloat(String(v).replace(/[$,\s]/g, "")); return isFinite(n) ? n : null; };
const SEASONS = ["Fall 2026", "Summer 2026", "Core", "Spring 2027"];

// Full catalog — the YTD view covers EVERYTHING on the site, not just the
// drop, so campaign/ad decisions see the whole board (her ask, Sep 1 2026).
// Wholesale + units pulled from her real FashionGo order history (Sep 1 2026).
// Anais/Willa arrive as one wholesale SET ($38.75) — split by retail ratio.
const SEED_ITEMS = [
  ["Cleo Jean", "Fall 2026", 138, 27.75, 6, "et clet C6518P_1 dark denim 3S/2M/1L Feb 23 — 5.0x, OVER the 3-4x band"],
  ["Anais Top", "Fall 2026", 88, 22.45, 6, "MABLE MST8254 set w/ Willa @$38.75/set, split by retail ratio; 3S/2M/1L"],
  ["Willa Short", "Fall 2026", 64, 16.30, 6, "other half of the MABLE set; 3S/2M/1L"],
  ["Camille Blouse", "Fall 2026", 78, 18.95, 12, "Miss Love T2828 white 6S/4M/2L Jun 17 — 4.1x"],
  ["Elodie Blouse", "Fall 2026", 92, 37.30, 6, "Esley T2502 eyelet 3S/2M/1L Feb 23 — 2.5x, UNDER the 3x floor"],
  ["Gia Pant", "Fall 2026", 118, 25.95, 6, "Miss Love P5544B olive 3S/2M/1L Jun 17 — 4.5x, OVER the band"],
  ["Mara Dress", "Fall 2026", 118, null, null, "NO FashionGo record on this account — where was the black knit dress bought?"],
  ["Luce Pants", "Summer 2026", 138, null, null, "not in this FashionGo account's history"],
  ["Sera Top", "Summer 2026", 98, 23, 6, "Mod Ref Eugenie Top white 3S/2M/1L Feb 15 — 4.3x"],
  ["Iris Dress", "Summer 2026", 92, 8, 12, "IRIS BD05739 taupe 4S/4M/4L Feb 23 — 11.5x"],
  ["Romy Cardigan", "Core", 145, null, null, ""],
  ["Sable Pant", "Summer 2026", 76, null, null, ""],
  ["Renata Dress", "Summer 2026", 155, 38, 6, "Loucia Eliza halter maxi white 3S/2M/1L Feb 13 — 4.1x"],
  ["Olivia Dress", "Summer 2026", 96, null, null, ""],
  ["Margaux Blouse", "Summer 2026", 68, null, null, ""],
  ["Dove Sweater", "Core", 88, 30, 12, "Mod Ref Layla white: 6 Feb + 6 Jun restock — 2.9x; 4 sold/$88 net past 90d"],
  ["Hazel Sweater", "Core", 88, 30, 6, "Mod Ref Layla brown 3S/2M/1L Feb 15 — 2.9x; 1 gifted $0"],
  ["Solene Dress", "Summer 2026", 84, null, null, ""],
  ["Lucia Dress", "Summer 2026", 98, 38, 6, "Loucia Cressida poplin maxi white 3S/2M/1L Feb 13 — 2.6x, under floor"],
  ["Selene Necklace", "Core", 68, null, null, ""],
  ["Cora Bracelet", "Core", 78, null, null, ""],
  ["Mira Earrings", "Core", 38, 15, 20, "Flint J. E0037 pearl dangle studs, 20 units Aug 13 — 2.5x; the ~1/week seller"],
].map(([name, season, retail, wholesale, units, note]) => ({ id: uid(), name, season, retail, wholesale, units, adAllot: null, adSpent: null, cpc: null, roas: null, sold: null, net: null, live: false, note }));

const SEED_COSTS = [
  { label: "Third Culture LA — lifestyle campaign (Sacia)", amount: 6447.5, month: "2026-07", season: "Fall 2026", note: "VERIFIED: 3 payments Jul 8/14/23. Per Kiabeth: Sacia ~$2,700 + location ~$2,400 + Paige $1,000; MUA included" },
  { label: "Third Culture LA — e-comm shoot", amount: 720, month: "2026-08", season: "Fall 2026", note: "VERIFIED payment Aug 11. Contract ~$1,200–1,300 per Kiabeth — confirm balance" },
  { label: "Luna Vela — makeup artist, e-comm shoot", amount: 500, month: "2026-08", season: "Fall 2026", note: "Paid via Zelle Aug 20; $500 per Kiabeth" },
  { label: "Sylvana — model, lifestyle shoot", amount: 750, month: "2026-07", season: "Fall 2026", note: "UNVERIFIED: $700–800 per Kiabeth" },
  { label: "Chloe — model, e-comm shoot", amount: 800, month: "2026-08", season: "Fall 2026", note: "Per Kiabeth; receipt likely Zelle" },
].map((x) => ({ id: uid(), ...x }));

const verdictFor = (spent, roas) => {
  if (!spent || spent < 25) return { t: "Learning", col: c.sub };
  if (roas == null) return { t: "No ROAS", col: c.sub };
  if (roas >= 2.5) return { t: "Scale", col: c.green };
  if (roas >= 1.2) return { t: "Hold", col: c.taupe };
  return { t: "Cut", col: c.red };
};

export default function FoldLedger({ data, onSave, viewer = { owner: true } }) {
  const led = data && data.items ? { history: [], costs: [], ...data } : { dailyAd: 35, month: "2026-09", items: SEED_ITEMS, costs: SEED_COSTS, history: [] };
  const [view, setView] = useState("month"); // "month" | "ytd"
  const [draft, setDraft] = useState(null);
  const save = (next) => onSave({ ...led, ...next });
  const patchItem = (id, part) => save({ items: led.items.map((x) => (x.id === id ? { ...x, ...part } : x)) });
  const patchCost = (id, part) => save({ costs: led.costs.map((x) => (x.id === id ? { ...x, ...part } : x)) });

  const monthlyBudget = (num(led.dailyAd) || 0) * 30.4;

  // YTD per item = archived months + the live month, matched by name.
  const ytd = useMemo(() => {
    const m = {};
    const add = (name, f, v) => { if (v == null) return; const k = name.trim().toLowerCase(); m[k] = m[k] || { adSpent: 0, sold: 0, net: 0 }; m[k][f] += v; };
    (led.history || []).forEach((h) => (h.items || []).forEach((it) => { add(it.name, "adSpent", num(it.adSpent)); add(it.name, "sold", num(it.sold)); add(it.name, "net", num(it.net)); }));
    led.items.forEach((it) => { add(it.name, "adSpent", num(it.adSpent)); add(it.name, "sold", num(it.sold)); add(it.name, "net", num(it.net)); });
    return m;
  }, [led]);
  const y = (it) => ytd[it.name.trim().toLowerCase()] || { adSpent: 0, sold: 0, net: 0 };

  // Fixed-cost allocation: each season's production spend spreads across that
  // season's pieces in proportion to inventory investment (wholesale x units);
  // equal split when investments are unknown. Costs without a season spread
  // across everything.
  const alloc = useMemo(() => {
    const bySeason = {}; const out = {};
    (led.costs || []).forEach((x) => { const s = x.season || "_all"; bySeason[s] = (bySeason[s] || 0) + (num(x.amount) || 0); });
    const seasonItems = (s) => led.items.filter((it) => s === "_all" ? true : (it.season || "Fall 2026") === s);
    Object.entries(bySeason).forEach(([s, total]) => {
      const items = seasonItems(s); if (!items.length) return;
      const invs = items.map((it) => (num(it.wholesale) || 0) * (num(it.units) || 0));
      const invTotal = invs.reduce((a, b) => a + b, 0);
      items.forEach((it, i) => { out[it.id] = (out[it.id] || 0) + (invTotal > 0 ? total * (invs[i] / invTotal) : total / items.length); });
    });
    return out;
  }, [led]);

  const contribOf = (it) => { const w = num(it.wholesale), r = num(it.retail); return w != null && r != null ? r - w : null; };
  const breakEvenOf = (it) => {
    const cu = contribOf(it); if (!cu || cu <= 0) return null;
    return Math.ceil(((alloc[it.id] || 0) + (y(it).adSpent || 0)) / cu);
  };

  const totals = useMemo(() => {
    const t = { allot: 0, spent: 0, net: 0, wholesale: 0, prod: 0, ytdSpent: 0, ytdNet: 0, contribYtd: 0 };
    led.items.forEach((it) => {
      t.allot += num(it.adAllot) || 0; t.spent += num(it.adSpent) || 0; t.net += num(it.net) || 0;
      t.wholesale += (num(it.wholesale) || 0) * (num(it.units) || 0);
      const yy = y(it); t.ytdSpent += yy.adSpent; t.ytdNet += yy.net;
      const cu = contribOf(it); if (cu != null) t.contribYtd += cu * (yy.sold || 0);
    });
    (led.costs || []).forEach((x) => { t.prod += num(x.amount) || 0; });
    t.blendedRoas = t.spent ? t.net / t.spent : null;
    t.recovery = (t.prod + t.ytdSpent) > 0 ? (t.contribYtd / (t.prod + t.ytdSpent)) * 100 : null;
    return t;
  }, [led, ytd, alloc]);

  // Case-study focus list: proof-of-demand x margin. With near-zero clothing
  // sales, anything with sold>0 and decent contribution leads; ties go to the
  // current season (we are in fall).
  const focus = useMemo(() => {
    const inSeason = (it) => (it.season || "") === "Fall 2026";
    return led.items
      .map((it) => ({ it, cu: contribOf(it), yy: y(it) }))
      .filter((r) => r.cu == null || r.cu > 0)
      .sort((a, b) => ((b.yy.sold || 0) * (b.cu || 40) + (inSeason(b.it) ? 20 : 0)) - ((a.yy.sold || 0) * (a.cu || 40) + (inSeason(a.it) ? 20 : 0)))
      .slice(0, 3);
  }, [led, ytd]);

  const csv = () => {
    const head = ["Piece", "Season", "Wholesale", "Retail", "Markup x", "Contribution/unit", "Units bought", "Alloc fixed $", "Break-even units", "Ad $/mo allotted", "Ad $ spent " + (view === "ytd" ? "YTD" : led.month), "CPC", "ROAS", "Sold " + (view === "ytd" ? "YTD" : led.month), "Net sales", "Sell-through %", "Live", "Verdict", "Notes"];
    const rows = led.items.map((it) => {
      const m = markupOf(it), cu = contribOf(it), be = breakEvenOf(it), yy = y(it);
      const spent = view === "ytd" ? yy.adSpent : num(it.adSpent), sold = view === "ytd" ? yy.sold : num(it.sold), net = view === "ytd" ? yy.net : num(it.net);
      const st = num(it.units) && sold != null ? Math.round((sold / num(it.units)) * 100) : "";
      return [it.name, it.season || "", it.wholesale, it.retail, m ? m.toFixed(2) : "", cu, it.units, Math.round(alloc[it.id] || 0), be, it.adAllot, spent, it.cpc, it.roas, sold, net, st, it.live ? "yes" : "no", verdictFor(spent, num(it.roas)).t, (it.note || "").replace(/[\n,]/g, " ")];
    });
    const meta = [["View", view.toUpperCase()], ["Month", led.month], ["Daily ad budget (HARD CAP)", led.dailyAd], ["Monthly ad budget", monthlyBudget.toFixed(0)], ["Production costs", totals.prod], ["Spend recovered by contribution YTD", totals.recovery != null ? totals.recovery.toFixed(1) + "%" : ""], []];
    const body = [...meta, head, ...rows].map((r) => r.map((v) => v == null ? "" : String(v)).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    a.download = "the-fold-ledger-" + (view === "ytd" ? "ytd" : led.month) + ".csv"; a.click();
  };

  const copyDigest = async () => {
    const lines = led.items.map((it) => {
      const m = markupOf(it), cu = contribOf(it), be = breakEvenOf(it), yy = y(it);
      return `- ${it.name} [${it.season || "?"}]: wholesale ${money(num(it.wholesale))}, retail ${money(num(it.retail))}${m ? ` (${m.toFixed(1)}x, ${money(cu)}/unit)` : ""}${be ? `, break-even ${be} units (sold ${yy.sold || 0} YTD)` : ""}, allot ${money(num(it.adAllot))}/mo, spent ${money(num(it.adSpent))} this mo / ${money(yy.adSpent)} YTD, ROAS ${it.roas || "—"}, ${it.live ? "LIVE" : "off"} → ${verdictFor(num(it.adSpent), num(it.roas)).t}${it.note ? ` · ${it.note}` : ""}`;
    });
    const f = focus.map((r) => r.it.name).join(", ");
    const txt = `THE FOLD LEDGER · ${led.month}\nHARD CAP $${led.dailyAd || 0}/day (~${money(monthlyBudget)}/mo). Clothing sales are near zero — price to compete (3x floor), concentrate spend, no broad reach.\nAllocated ${money(totals.allot)} · spent ${money(totals.spent)} this mo · YTD ad ${money(totals.ytdSpent)} · production ${money(totals.prod)} · contribution recovered ${totals.recovery != null ? totals.recovery.toFixed(1) + "%" : "—"}\nFocus (demand x margin x season): ${f}\nVerdicts: Scale ROAS≥2.5 · Hold ≥1.2 · Cut <1.2 after $25.\n\n${lines.join("\n")}`;
    try { await navigator.clipboard.writeText(txt); alert("Digest copied for the ads partner."); } catch { prompt("Copy:", txt); }
  };

  const closeMonth = () => {
    if (!confirm(`Close ${led.month}? Spend/sales reset for the new month; ${led.month} is archived (and stays in YTD).`)) return;
    const snap = { month: led.month, items: led.items.map((it) => ({ name: it.name, season: it.season, adSpent: it.adSpent, cpc: it.cpc, roas: it.roas, sold: it.sold, net: it.net, verdict: verdictFor(num(it.adSpent), num(it.roas)).t })), costs: led.costs, dailyAd: led.dailyAd };
    const d = new Date(led.month + "-15"); d.setMonth(d.getMonth() + 1);
    save({ history: [snap, ...(led.history || [])], month: d.toISOString().slice(0, 7), items: led.items.map((it) => ({ ...it, adSpent: null, cpc: null, roas: null, sold: null, net: null })) });
  };

  const markupOf = (it) => { const w = num(it.wholesale), r = num(it.retail); return w && r ? r / w : null; };
  const label = { fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe };
  const cellIn = { width: "100%", border: "none", background: "transparent", fontFamily: sans, fontSize: 12, color: c.ink, padding: "7px 6px", outline: "none", boxSizing: "border-box" };
  const th = { ...label, textAlign: "left", padding: "6px 6px", borderBottom: `1px solid ${c.ink}`, whiteSpace: "nowrap" };
  const td = { borderBottom: `1px solid ${c.line}`, padding: 0, verticalAlign: "middle" };

  const Cell = ({ it, field, width, placeholder }) => (
    <td style={{ ...td, width }}>
      <input
        value={draft && draft.id === it.id && draft.field === field ? draft.v : it[field] == null ? "" : it[field]}
        placeholder={placeholder || ""}
        onFocus={() => setDraft({ id: it.id, field, v: it[field] == null ? "" : String(it[field]) })}
        onChange={(e) => setDraft({ id: it.id, field, v: e.target.value })}
        onBlur={() => { if (draft && draft.id === it.id && draft.field === field) { patchItem(it.id, { [field]: field === "name" || field === "note" ? draft.v : num(draft.v) }); setDraft(null); } }}
        onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
        style={cellIn} />
    </td>
  );

  const seasonsInSheet = [...new Set(led.items.map((it) => it.season || "Fall 2026"))].sort((a, b) => SEASONS.indexOf(a) - SEASONS.indexOf(b));

  const renderRow = (it) => {
    const m = markupOf(it), cu = contribOf(it), be = breakEvenOf(it), yy = y(it);
    const spent = view === "ytd" ? yy.adSpent : num(it.adSpent);
    const sold = view === "ytd" ? yy.sold : num(it.sold);
    const net = view === "ytd" ? yy.net : num(it.net);
    const v = verdictFor(spent, num(it.roas));
    const mCol = m == null ? c.sub : m < 3 ? c.red : m > 4 ? c.taupe : c.green;
    const beCol = be != null && sold != null && sold >= be ? c.green : c.ink;
    return (
      <tr key={it.id}>
        <Cell it={it} field="name" width={150} />
        <td style={{ ...td, width: 92 }}>
          <select value={it.season || "Fall 2026"} onChange={(e) => patchItem(it.id, { season: e.target.value })}
            style={{ ...cellIn, appearance: "none", fontSize: 10.5, color: c.sub }}>
            {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </td>
        <Cell it={it} field="wholesale" width={70} placeholder="$" />
        <Cell it={it} field="retail" width={70} placeholder="$" />
        <td style={{ ...td, width: 52 }}><span style={{ fontFamily: sans, fontSize: 12, color: mCol, padding: "0 6px" }}>{m ? m.toFixed(1) + "x" : "—"}</span></td>
        <Cell it={it} field="units" width={50} />
        <td style={{ ...td, width: 78, whiteSpace: "nowrap" }}>
          <span style={{ fontFamily: sans, fontSize: 11.5, color: beCol, padding: "0 6px" }} title={cu ? `${money(cu)}/unit contribution · ${money(alloc[it.id] || 0)} allocated fixed + ${money(yy.adSpent)} YTD ads` : "needs wholesale + retail"}>
            {be != null ? `${be} u` : "—"}
          </span>
        </td>
        {view === "month" ? <Cell it={it} field="adAllot" width={64} placeholder="$" /> : <td style={{ ...td, width: 64 }}><span style={{ fontFamily: sans, fontSize: 12, color: c.sub, padding: "0 6px" }}>{money(num(it.adAllot))}</span></td>}
        {view === "month" ? <Cell it={it} field="adSpent" width={64} placeholder="$" /> : <td style={{ ...td, width: 64 }}><span style={{ fontFamily: sans, fontSize: 12, padding: "0 6px" }}>{money(yy.adSpent)}</span></td>}
        <Cell it={it} field="cpc" width={52} placeholder="$" />
        <Cell it={it} field="roas" width={52} />
        {view === "month" ? <Cell it={it} field="sold" width={48} /> : <td style={{ ...td, width: 48 }}><span style={{ fontFamily: sans, fontSize: 12, padding: "0 6px" }}>{yy.sold || 0}</span></td>}
        {view === "month" ? <Cell it={it} field="net" width={74} placeholder="$" /> : <td style={{ ...td, width: 74 }}><span style={{ fontFamily: sans, fontSize: 12, padding: "0 6px" }}>{money(yy.net)}</span></td>}
        <td style={{ ...td, width: 40, textAlign: "center" }}>
          <input type="checkbox" checked={!!it.live} onChange={() => patchItem(it.id, { live: !it.live })} title="Currently running in ads" />
        </td>
        <td style={{ ...td, width: 72 }}><span style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: v.col, padding: "0 6px" }}>{v.t}</span></td>
        <Cell it={it} field="note" width={130} />
        <td style={{ ...td, width: 26, textAlign: "center" }}>
          <button title="Remove row" onClick={() => { if (confirm(`Remove ${it.name}?`)) save({ items: led.items.filter((x) => x.id !== it.id) }); }}
            style={{ border: "none", background: "transparent", color: c.sub, cursor: "pointer", fontSize: 12 }}>×</button>
        </td>
      </tr>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
        <div>
          <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase", color: c.ink, fontWeight: 500 }}>The Fold · Ledger — {view === "ytd" ? "Year to date" : led.month}</div>
          <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 11, color: c.sub, marginTop: 3 }}>
            Wholesale first, 3–4x retail (hold the 3x floor while sales build), $35/day is a hard cap — concentrate it where demand is proven.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", border: `1px solid ${c.line}`, borderRadius: 1 }}>
            {["month", "ytd"].map((vk) => (
              <button key={vk} onClick={() => setView(vk)} style={{ ...btn(), border: "none", background: view === vk ? c.ink : c.bg, color: view === vk ? "#fff" : c.ink }}>{vk === "ytd" ? "Year to date" : "This month"}</button>
            ))}
          </div>
          <button onClick={csv} style={btn()}>Export CSV</button>
          <button onClick={copyDigest} style={btn()}>Copy digest</button>
          {viewer.owner && view === "month" && <button onClick={closeMonth} style={btn()}>Close month</button>}
        </div>
      </div>

      {/* budget strip */}
      <div style={{ display: "flex", gap: 0, flexWrap: "wrap", border: `1px solid ${c.line}`, borderRadius: 2, margin: "10px 0 10px", background: c.bg }}>
        <Stat label="Ad $/day (cap)">
          <input value={led.dailyAd == null ? "" : led.dailyAd} onChange={(e) => save({ dailyAd: num(e.target.value) })}
            style={{ ...cellIn, fontSize: 16, fontWeight: 500, padding: 0, width: 60 }} placeholder="35" />
        </Stat>
        <Stat label="Monthly budget" v={money(monthlyBudget)} />
        <Stat label="Allotted" v={money(totals.allot)} warn={totals.allot > monthlyBudget + 1 ? "over cap" : null} />
        <Stat label={"Spent · " + led.month} v={money(totals.spent)} />
        <Stat label="Ad spend YTD" v={money(totals.ytdSpent)} />
        <Stat label="Production" v={money(totals.prod)} />
        <Stat label="Inventory $" v={money(totals.wholesale)} />
        <Stat label="Contribution YTD" v={money(totals.contribYtd)} />
        <Stat label="Spend recovered" v={totals.recovery != null ? totals.recovery.toFixed(1) + "%" : "—"} warn={totals.recovery != null && totals.recovery < 25 ? "early days" : null} />
      </div>

      {/* the professor's paragraph */}
      <div style={{ border: `1px solid ${c.line}`, borderLeft: `3px solid ${c.taupe}`, borderRadius: 2, padding: "10px 14px", marginBottom: 14, background: c.card }}>
        <div style={label}>Read on the business</div>
        <div style={{ fontFamily: sans, fontSize: 12, color: c.ink, marginTop: 5, lineHeight: 1.55 }}>
          {money(totals.prod)} of production + {money(totals.ytdSpent)} of ads are sunk into marketing; contribution earned back so far is {money(totals.contribYtd)} ({totals.recovery != null ? totals.recovery.toFixed(1) : "—"}%).
          Break-even column = units each piece must sell to cover its share of shoots plus its own ad spend, at current contribution per unit — it needs wholesale costs (FashionGo) to be exact.
          With ~1 jewelry sale/week and clothing at zero, the play is not reach, it is concentration: keep the whole {money(monthlyBudget)}/mo behind 2–3 fall pieces until one earns a Scale verdict, price at the 3x floor so conversion isn't fighting the tag, and re-split monthly from the verdicts.
          {focus.length ? <> Current focus picks: <b>{focus.map((r) => r.it.name).join(", ")}</b>.</> : null}
        </div>
      </div>

      {/* season-grouped sheet */}
      {seasonsInSheet.map((s) => {
        const items = led.items.filter((it) => (it.season || "Fall 2026") === s);
        const st = items.reduce((a, it) => {
          const yy = y(it); a.spent += view === "ytd" ? yy.adSpent : (num(it.adSpent) || 0); a.net += view === "ytd" ? yy.net : (num(it.net) || 0);
          a.sold += view === "ytd" ? yy.sold : (num(it.sold) || 0); a.inv += (num(it.wholesale) || 0) * (num(it.units) || 0); a.fixed += alloc[it.id] || 0; return a;
        }, { spent: 0, net: 0, sold: 0, inv: 0, fixed: 0 });
        return (
          <div key={s} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 2px" }}>
              <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: c.ink, fontWeight: 500 }}>{s}</div>
              <div style={{ fontFamily: sans, fontSize: 10.5, color: c.sub }}>
                {items.length} pieces · inventory {money(st.inv)} · fixed {money(st.fixed)} · ads {money(st.spent)} · {st.sold} sold · net {money(st.net)}
              </div>
            </div>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", border: `1px solid ${c.line}`, borderRadius: 2, background: c.bg }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1220 }}>
                <thead><tr>
                  <th style={{ ...th, minWidth: 140 }}>Piece</th><th style={th}>Season</th><th style={th}>Whlsl</th><th style={th}>Retail</th><th style={th}>Mark</th>
                  <th style={th}>Units</th><th style={th}>Break-even</th><th style={th}>Ad $/mo</th><th style={th}>Spent{view === "ytd" ? " YTD" : ""}</th><th style={th}>CPC</th><th style={th}>ROAS</th>
                  <th style={th}>Sold{view === "ytd" ? " YTD" : ""}</th><th style={th}>Net</th><th style={th}>Live</th><th style={th}>Verdict</th><th style={{ ...th, minWidth: 120 }}>Notes</th><th style={th}></th>
                </tr></thead>
                <tbody>{items.map(renderRow)}</tbody>
              </table>
            </div>
          </div>
        );
      })}
      <button onClick={() => save({ items: [...led.items, { id: uid(), name: "", season: "Fall 2026", wholesale: null, retail: null, units: null, adAllot: null, adSpent: null, cpc: null, roas: null, sold: null, net: null, live: false, note: "" }] })}
        style={btn()}>+ Add piece</button>
      <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 10.5, color: c.sub, marginTop: 6 }}>
        Markup: red under 3x, taupe over 4x. Break-even turns green once sold ≥ needed. YTD sums every closed month plus this one. Sales/ROAS are entered by whoever runs the ads; nothing here syncs automatically yet.
      </div>

      {/* production costs */}
      <div style={{ marginTop: 18 }}>
        <div style={label}>Marketing production · shoots (allocated to pieces by season + inventory share)</div>
        <div style={{ border: `1px solid ${c.line}`, borderRadius: 2, marginTop: 6, background: c.bg }}>
          {(led.costs || []).map((x) => (
            <div key={x.id} style={{ display: "flex", gap: 0, borderBottom: `1px solid ${c.line}`, alignItems: "center" }}>
              <input value={x.label || ""} onChange={(e) => patchCost(x.id, { label: e.target.value })} placeholder="Cost" style={{ ...cellIn, flex: 2.4 }} />
              <input value={x.amount == null ? "" : x.amount} onChange={(e) => patchCost(x.id, { amount: num(e.target.value) })} placeholder="$" style={{ ...cellIn, flex: 0.7, borderLeft: `1px solid ${c.line}` }} />
              <input value={x.month || ""} onChange={(e) => patchCost(x.id, { month: e.target.value })} placeholder="YYYY-MM" style={{ ...cellIn, flex: 0.8, borderLeft: `1px solid ${c.line}` }} />
              <select value={x.season || ""} onChange={(e) => patchCost(x.id, { season: e.target.value || null })} style={{ ...cellIn, flex: 0.9, borderLeft: `1px solid ${c.line}`, appearance: "none", fontSize: 10.5, color: c.sub }}>
                <option value="">All seasons</option>{SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input value={x.note || ""} onChange={(e) => patchCost(x.id, { note: e.target.value })} placeholder="Note" style={{ ...cellIn, flex: 2.6, borderLeft: `1px solid ${c.line}` }} />
              <button onClick={() => save({ costs: led.costs.filter((z) => z.id !== x.id) })} style={{ border: "none", background: "transparent", color: c.sub, cursor: "pointer", fontSize: 12, padding: "0 10px" }}>×</button>
            </div>
          ))}
          <button onClick={() => save({ costs: [...(led.costs || []), { id: uid(), label: "", amount: null, month: "", season: "Fall 2026", note: "" }] })} style={{ ...btn(), border: "none", margin: 6 }}>+ Add cost</button>
        </div>
      </div>

      {(led.history || []).length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={label}>Closed months</div>
          {(led.history || []).map((h) => (
            <details key={h.month} style={{ border: `1px solid ${c.line}`, borderRadius: 2, marginTop: 6, background: c.card, padding: "8px 12px" }}>
              <summary style={{ fontFamily: sans, fontSize: 11.5, color: c.ink, cursor: "pointer" }}>
                {h.month} — spent {money(h.items.reduce((s2, i2) => s2 + (num(i2.adSpent) || 0), 0))} · net {money(h.items.reduce((s2, i2) => s2 + (num(i2.net) || 0), 0))}
              </summary>
              <div style={{ fontFamily: sans, fontSize: 11, color: c.sub, marginTop: 6 }}>
                {h.items.filter((i2) => num(i2.adSpent) || num(i2.sold)).map((i2) => (
                  <div key={i2.name}>{i2.name}: spent {money(num(i2.adSpent))} · ROAS {i2.roas || "—"} · {i2.sold || 0} sold · {i2.verdict}</div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

const btn = () => ({ border: `1px solid ${c.line}`, background: c.bg, borderRadius: 1, padding: "6px 12px", fontFamily: sans, fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: c.ink, cursor: "pointer" });

function Stat({ label: l, v, children, warn }) {
  return (
    <div style={{ padding: "9px 13px", borderRight: `1px solid ${c.line}`, minWidth: 84 }}>
      <div style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1.6, textTransform: "uppercase", color: c.taupe }}>{l}</div>
      <div style={{ fontFamily: sans, fontSize: 15, fontWeight: 500, color: warn ? c.red : c.ink, marginTop: 3 }}>{children || v}</div>
      {warn && <div style={{ fontFamily: sans, fontSize: 9, color: c.red, letterSpacing: 1, textTransform: "uppercase" }}>{warn}</div>}
    </div>
  );
}
