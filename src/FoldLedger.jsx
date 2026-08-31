import React, { useMemo, useState } from "react";

// THE FOLD · LEDGER — the running cost + ad-spend sheet for the label.
// One row per garment: what we paid wholesale (FashionGo), what it retails
// for (house rule: 3–4x wholesale so the price carries its own marketing),
// its monthly ad allotment, and what the ads are actually doing (spend, CPC,
// ROAS, sales). Kiabeth's business partner runs The Fold's Meta ads off this
// sheet (~$35/day), and her Claude reads the CSV/digest export to propose
// next month's per-piece spend. Production costs from shoots (model,
// location, photographer, creative director) live in the bottom section so
// blended marketing cost per piece is honest, not just ad clicks.

const c = { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#71716C", line: "#E0E0DD", card: "#F4F4F3", taupe: "#8F8676", red: "#9b5e5e", green: "#5a7a5a" };
const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const uid = () => "fl" + Math.random().toString(36).slice(2, 9);
const money = (n) => (n || n === 0) && isFinite(n) ? "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—";
const num = (v) => { const n = parseFloat(String(v).replace(/[$,\s]/g, "")); return isFinite(n) ? n : null; };

const SEED_ITEMS = [
  "Chloe Jean", "Anais Top", "Willa Short", "Camille Blouse", "Elodie Blouse",
  "Green Pant (name TBD)", "Black Knit Dress (name TBD)", "Dove Sweater", "Hazel Sweater",
].map((name) => ({ id: uid(), name, wholesale: null, retail: null, units: null, adAllot: null, adSpent: null, cpc: null, roas: null, sold: null, net: null, live: false, note: "" }));

// Seeded from the verified 2026 receipts in Gmail (Sep 1 2026). The Third
// Culture campaign invoice was paid in three: $2,573.75 + $1,936.87 + $1,936.88.
const SEED_COSTS = [
  { label: "Third Culture LA — lifestyle campaign (Sacia)", amount: 6447.5, month: "2026-07", note: "VERIFIED: 3 payments Jul 8/14/23. Breakdown per Kiabeth: Sacia ~$2,700 + location ~$2,400 + Paige $1,000 (billed via Sacia); MUA included" },
  { label: "Third Culture LA — e-comm shoot", amount: 720, month: "2026-08", note: "VERIFIED payment Aug 11. Contract total ~$1,200–1,300 per Kiabeth — confirm remaining balance" },
  { label: "Luna Vela — makeup artist, e-comm shoot", amount: 500, month: "2026-08", note: "Paid via Zelle Aug 20 (invoice attached in email); $500 per Kiabeth" },
  { label: "Sylvana — model, lifestyle shoot", amount: 750, month: "2026-07", note: "UNVERIFIED: $700–800 per Kiabeth; receipt not found in Gmail — may be in bank/Zelle" },
  { label: "Chloe — model, e-comm shoot", amount: 800, month: "2026-08", note: "Per Kiabeth; receipt not found in Gmail — may be in bank/Zelle" },
].map((x) => ({ id: uid(), ...x }));

// Ad verdict — the partner's Claude uses the same bands. Below $25 spent the
// data is noise, so no verdict is issued yet.
const verdictFor = (it) => {
  const spent = num(it.adSpent), roas = num(it.roas);
  if (!spent || spent < 25) return { t: "Learning", col: c.sub };
  if (roas == null) return { t: "No ROAS", col: c.sub };
  if (roas >= 2.5) return { t: "Scale", col: c.green };
  if (roas >= 1.2) return { t: "Hold", col: c.taupe };
  return { t: "Cut", col: c.red };
};

export default function FoldLedger({ data, onSave, viewer = { owner: true } }) {
  const led = data && data.items ? data : { dailyAd: 35, month: new Date().toISOString().slice(0, 7), items: SEED_ITEMS, costs: SEED_COSTS, history: [] };
  const [draft, setDraft] = useState(null); // {itemId, field} being edited keeps keystrokes local
  const save = (next) => onSave({ ...led, ...next });
  const patchItem = (id, part) => save({ items: led.items.map((x) => (x.id === id ? { ...x, ...part } : x)) });
  const patchCost = (id, part) => save({ costs: led.costs.map((x) => (x.id === id ? { ...x, ...part } : x)) });

  const monthlyBudget = (num(led.dailyAd) || 0) * 30.4;
  const totals = useMemo(() => {
    const t = { allot: 0, spent: 0, net: 0, wholesale: 0, prod: 0 };
    led.items.forEach((it) => {
      t.allot += num(it.adAllot) || 0; t.spent += num(it.adSpent) || 0; t.net += num(it.net) || 0;
      t.wholesale += (num(it.wholesale) || 0) * (num(it.units) || 0);
    });
    (led.costs || []).forEach((x) => { t.prod += num(x.amount) || 0; });
    t.blendedRoas = t.spent ? t.net / t.spent : null;
    return t;
  }, [led]);

  // Markup guard — the whole point of the sheet. Outside 3–4x gets flagged.
  const markupOf = (it) => { const w = num(it.wholesale), r = num(it.retail); return w && r ? r / w : null; };

  const csv = () => {
    const head = ["Piece", "Wholesale", "Retail", "Markup x", "Units bought", "Ad $/mo allotted", "Ad $ spent (" + led.month + ")", "CPC", "ROAS", "Units sold", "Net sales", "Live in ads", "Verdict", "Notes"];
    const rows = led.items.map((it) => [it.name, it.wholesale, it.retail, markupOf(it) ? markupOf(it).toFixed(2) : "", it.units, it.adAllot, it.adSpent, it.cpc, it.roas, it.sold, it.net, it.live ? "yes" : "no", verdictFor(it).t, (it.note || "").replace(/[\n,]/g, " ")]);
    const meta = [["Month", led.month], ["Daily ad budget", led.dailyAd], ["Monthly ad budget", monthlyBudget.toFixed(0)], ["Production costs (shoots)", totals.prod], []];
    const body = [...meta, head, ...rows].map((r) => r.map((v) => v == null ? "" : String(v)).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    a.download = "the-fold-ledger-" + led.month + ".csv"; a.click();
  };

  const copyDigest = async () => {
    const lines = led.items.map((it) => {
      const m = markupOf(it);
      return `- ${it.name}: wholesale ${money(num(it.wholesale))}, retail ${money(num(it.retail))}${m ? ` (${m.toFixed(1)}x)` : ""}, ad allot ${money(num(it.adAllot))}/mo, spent ${money(num(it.adSpent))}, CPC ${it.cpc || "—"}, ROAS ${it.roas || "—"}, sold ${it.sold || 0} / ${money(num(it.net))} net, ${it.live ? "LIVE in ads" : "not running"} → ${verdictFor(it).t}${it.note ? ` · ${it.note}` : ""}`;
    });
    const txt = `THE FOLD LEDGER · ${led.month}\nAd budget: $${led.dailyAd || 0}/day (~${money(monthlyBudget)}/mo) · allocated ${money(totals.allot)} · spent ${money(totals.spent)} · blended ROAS ${totals.blendedRoas ? totals.blendedRoas.toFixed(2) : "—"}\nProduction (model/location/photo/creative): ${money(totals.prod)}\nRule: retail = 3–4x wholesale. Verdict bands: Scale ROAS≥2.5 · Hold ≥1.2 · Cut <1.2 (after $25 spent).\n\n${lines.join("\n")}`;
    try { await navigator.clipboard.writeText(txt); alert("Digest copied — paste it to your ads partner (or her Claude)."); } catch { prompt("Copy the digest:", txt); }
  };

  // Close the month: totals go to history, per-month fields reset, allotments stay.
  const closeMonth = () => {
    if (!confirm(`Close ${led.month}? Spend/sales columns reset for the new month (allotments and prices stay). ${led.month} is archived below.`)) return;
    const snap = { month: led.month, items: led.items.map((it) => ({ name: it.name, adSpent: it.adSpent, cpc: it.cpc, roas: it.roas, sold: it.sold, net: it.net, verdict: verdictFor(it).t })), costs: led.costs, dailyAd: led.dailyAd };
    const d = new Date(led.month + "-15"); d.setMonth(d.getMonth() + 1);
    save({ history: [snap, ...(led.history || [])], month: d.toISOString().slice(0, 7), items: led.items.map((it) => ({ ...it, adSpent: null, cpc: null, roas: null, sold: null, net: null })) });
  };

  const label = { fontFamily: sans, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.taupe };
  const cellIn = { width: "100%", border: "none", background: "transparent", fontFamily: sans, fontSize: 12, color: c.ink, padding: "7px 6px", outline: "none", boxSizing: "border-box" };
  const th = { ...label, textAlign: "left", padding: "6px 6px", borderBottom: `1px solid ${c.ink}`, whiteSpace: "nowrap" };
  const td = { borderBottom: `1px solid ${c.line}`, padding: 0, verticalAlign: "middle" };

  const Cell = ({ it, field, width, placeholder, prefix }) => (
    <td style={{ ...td, width }}>
      <input
        value={draft && draft.id === it.id && draft.field === field ? draft.v : it[field] == null ? "" : it[field]}
        placeholder={placeholder || ""}
        onFocus={() => setDraft({ id: it.id, field, v: it[field] == null ? "" : String(it[field]) })}
        onChange={(e) => setDraft({ id: it.id, field, v: e.target.value })}
        onBlur={() => { if (draft && draft.id === it.id && draft.field === field) { patchItem(it.id, { [field]: field === "name" || field === "note" ? draft.v : num(draft.v) }); setDraft(null); } }}
        onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
        style={{ ...cellIn, ...(prefix ? { paddingLeft: 4 } : {}) }} />
    </td>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
        <div>
          <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase", color: c.ink, fontWeight: 500 }}>The Fold · Ledger — {led.month}</div>
          <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 11, color: c.sub, marginTop: 3 }}>
            Every piece pays its own way: retail = 3–4x wholesale (FashionGo cost first, always), and its ad line answers with ROAS.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={csv} style={btn()}>Export CSV</button>
          <button onClick={copyDigest} style={btn()}>Copy digest for ads partner</button>
          {viewer.owner && <button onClick={closeMonth} style={btn()}>Close month</button>}
        </div>
      </div>

      {/* budget strip */}
      <div style={{ display: "flex", gap: 0, flexWrap: "wrap", border: `1px solid ${c.line}`, borderRadius: 2, margin: "10px 0 14px", background: c.bg }}>
        <Stat label="Ad budget / day">
          <input value={led.dailyAd == null ? "" : led.dailyAd} onChange={(e) => save({ dailyAd: num(e.target.value) })}
            style={{ ...cellIn, fontSize: 16, fontWeight: 500, padding: 0, width: 70 }} placeholder="35" />
        </Stat>
        <Stat label="Monthly budget" v={money(monthlyBudget)} />
        <Stat label="Allotted to pieces" v={money(totals.allot)} warn={totals.allot > monthlyBudget + 1 ? "over budget" : null} />
        <Stat label={"Spent · " + led.month} v={money(totals.spent)} />
        <Stat label="Blended ROAS" v={totals.blendedRoas ? totals.blendedRoas.toFixed(2) + "x" : "—"} />
        <Stat label="Production costs" v={money(totals.prod)} />
        <Stat label="Wholesale on order" v={money(totals.wholesale)} />
      </div>

      {/* the sheet */}
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", border: `1px solid ${c.line}`, borderRadius: 2, background: c.bg }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1080 }}>
          <thead><tr>
            <th style={{ ...th, minWidth: 150 }}>Piece</th><th style={th}>Wholesale</th><th style={th}>Retail</th><th style={th}>Markup</th>
            <th style={th}>Units</th><th style={th}>Ad $/mo</th><th style={th}>Spent</th><th style={th}>CPC</th><th style={th}>ROAS</th>
            <th style={th}>Sold</th><th style={th}>Net sales</th><th style={th}>Live</th><th style={th}>Verdict</th><th style={{ ...th, minWidth: 140 }}>Notes</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {led.items.map((it) => {
              const m = markupOf(it); const v = verdictFor(it);
              const mCol = m == null ? c.sub : m < 3 ? c.red : m > 4 ? c.taupe : c.green;
              return (
                <tr key={it.id}>
                  <Cell it={it} field="name" width={160} />
                  <Cell it={it} field="wholesale" width={78} placeholder="$" />
                  <Cell it={it} field="retail" width={78} placeholder="$" />
                  <td style={{ ...td, width: 84, whiteSpace: "nowrap" }}>
                    <span style={{ fontFamily: sans, fontSize: 12, color: mCol, padding: "0 6px" }}>{m ? m.toFixed(1) + "x" : "—"}</span>
                    {num(it.wholesale) && !num(it.retail) ? (
                      <button title="Suggest 3.5x" onClick={() => patchItem(it.id, { retail: Math.round(num(it.wholesale) * 3.5) - 0.0 })} style={{ ...btn(), padding: "2px 6px", fontSize: 9 }}>3.5x</button>
                    ) : null}
                  </td>
                  <Cell it={it} field="units" width={56} />
                  <Cell it={it} field="adAllot" width={70} placeholder="$" />
                  <Cell it={it} field="adSpent" width={70} placeholder="$" />
                  <Cell it={it} field="cpc" width={60} placeholder="$" />
                  <Cell it={it} field="roas" width={60} />
                  <Cell it={it} field="sold" width={54} />
                  <Cell it={it} field="net" width={80} placeholder="$" />
                  <td style={{ ...td, width: 44, textAlign: "center" }}>
                    <input type="checkbox" checked={!!it.live} onChange={() => patchItem(it.id, { live: !it.live })} title="Currently running in ads" />
                  </td>
                  <td style={{ ...td, width: 76 }}><span style={{ fontFamily: sans, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: v.col, padding: "0 6px" }}>{v.t}</span></td>
                  <Cell it={it} field="note" width={150} />
                  <td style={{ ...td, width: 30, textAlign: "center" }}>
                    <button title="Remove row" onClick={() => { if (confirm(`Remove ${it.name}?`)) save({ items: led.items.filter((x) => x.id !== it.id) }); }}
                      style={{ border: "none", background: "transparent", color: c.sub, cursor: "pointer", fontSize: 12 }}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button onClick={() => save({ items: [...led.items, { id: uid(), name: "", wholesale: null, retail: null, units: null, adAllot: null, adSpent: null, cpc: null, roas: null, sold: null, net: null, live: false, note: "" }] })}
        style={{ ...btn(), marginTop: 8 }}>+ Add piece</button>
      <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 10.5, color: c.sub, marginTop: 6 }}>
        Markup shows red under 3x (price can't carry its marketing) and taupe over 4x. Verdicts: Scale ROAS ≥ 2.5 · Hold ≥ 1.2 · Cut below — only once a piece has spent $25+.
      </div>

      {/* production costs */}
      <div style={{ marginTop: 18 }}>
        <div style={label}>Marketing production · shoots (amortized across the drop)</div>
        <div style={{ border: `1px solid ${c.line}`, borderRadius: 2, marginTop: 6, background: c.bg }}>
          {(led.costs || []).map((x) => (
            <div key={x.id} style={{ display: "flex", gap: 0, borderBottom: `1px solid ${c.line}`, alignItems: "center" }}>
              <input value={x.label || ""} onChange={(e) => patchCost(x.id, { label: e.target.value })} placeholder="Cost" style={{ ...cellIn, flex: 2 }} />
              <input value={x.amount == null ? "" : x.amount} onChange={(e) => patchCost(x.id, { amount: num(e.target.value) })} placeholder="$" style={{ ...cellIn, flex: 1, borderLeft: `1px solid ${c.line}` }} />
              <input value={x.month || ""} onChange={(e) => patchCost(x.id, { month: e.target.value })} placeholder="YYYY-MM" style={{ ...cellIn, flex: 1, borderLeft: `1px solid ${c.line}` }} />
              <input value={x.note || ""} onChange={(e) => patchCost(x.id, { note: e.target.value })} placeholder="Note" style={{ ...cellIn, flex: 3, borderLeft: `1px solid ${c.line}` }} />
              <button onClick={() => save({ costs: led.costs.filter((y) => y.id !== x.id) })} style={{ border: "none", background: "transparent", color: c.sub, cursor: "pointer", fontSize: 12, padding: "0 10px" }}>×</button>
            </div>
          ))}
          <button onClick={() => save({ costs: [...(led.costs || []), { id: uid(), label: "", amount: null, month: "", note: "" }] })} style={{ ...btn(), border: "none", margin: 6 }}>+ Add cost</button>
        </div>
      </div>

      {/* archived months */}
      {(led.history || []).length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={label}>Closed months</div>
          {(led.history || []).map((h) => (
            <details key={h.month} style={{ border: `1px solid ${c.line}`, borderRadius: 2, marginTop: 6, background: c.card, padding: "8px 12px" }}>
              <summary style={{ fontFamily: sans, fontSize: 11.5, color: c.ink, cursor: "pointer" }}>
                {h.month} — spent {money(h.items.reduce((s, i2) => s + (num(i2.adSpent) || 0), 0))} · net {money(h.items.reduce((s, i2) => s + (num(i2.net) || 0), 0))}
              </summary>
              <div style={{ fontFamily: sans, fontSize: 11, color: c.sub, marginTop: 6 }}>
                {h.items.filter((i2) => num(i2.adSpent)).map((i2) => (
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
    <div style={{ padding: "10px 16px", borderRight: `1px solid ${c.line}`, minWidth: 100 }}>
      <div style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 1.8, textTransform: "uppercase", color: c.taupe }}>{l}</div>
      <div style={{ fontFamily: sans, fontSize: 16, fontWeight: 500, color: warn ? c.red : c.ink, marginTop: 3 }}>{children || v}</div>
      {warn && <div style={{ fontFamily: sans, fontSize: 9, color: c.red, letterSpacing: 1, textTransform: "uppercase" }}>{warn}</div>}
    </div>
  );
}
