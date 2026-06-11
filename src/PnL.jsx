import { useState, useMemo } from "react";

/* ============================================================================
   LAVALLE HAUS OS — P&L / TRANSACTIONS
   Upload a bank-statement PDF -> AI extracts & categorizes every transaction ->
   you review/override -> it builds a running P&L. Learns merchant rules so
   recurring/same-merchant charges auto-categorize on future statements.

   - A view filter at the top scopes the whole P&L + transaction list to a
     specific day / week / month / quarter / year (or all time).
   - Download the scoped report as a clean PDF (browser Save-as-PDF).
   - An import log keeps a renameable record of every statement imported.
     The raw PDF is NOT stored (size + privacy) - keep originals in Drive.

   Needs api/categorize.js + ANTHROPIC_API_KEY set in Vercel.
       <PnL data={dbState.pnl || {}} onSave={(p) => ...} />
   ========================================================================== */

const c = {
  bg: "#f7f4ef", panel: "#fffdf9", ink: "#2b2620", sub: "#6f6657",
  line: "#e4ddd0", lineSoft: "#efe9de", clay: "#a8643c", gold: "#b08d57",
  green: "#5c7a52", yellow: "#b78b2e", red: "#a8483a", blue: "#5a6a86",
};
const serif = "'IM Fell English', Georgia, 'Times New Roman', serif";
const sans = "'IM Fell English', Georgia, serif";
const faintEs = { fontFamily: sans, fontSize: 10.5, fontStyle: "italic", color: "rgba(111,102,87,0.6)", marginTop: 1 };

const IN_RATE = 3 / 1e6, OUT_RATE = 15 / 1e6;

const CATEGORIES = [
  "Revenue / Sales", "Refunds", "COGS / Materials", "Packaging", "Shipping / Postage",
  "Advertising", "Software / SaaS", "Merchant / Bank Fees", "Office / Supplies",
  "Travel", "Meals", "Contractors / Labor", "Taxes", "Owner Draw / Transfer",
  "Other Expense", "Uncategorized",
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? 0 : Number(v));
const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(num(n)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = (n) => "$" + num(n).toFixed(num(n) < 0.1 ? 4 : 2);
const uid = (p) => (p || "t") + Math.random().toString(36).slice(2, 9);
const mkey = (s) => String(s || "").toLowerCase().replace(/[0-9]/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
const sig = (t) => `${t.date}|${num(t.amount).toFixed(2)}|${mkey(t.merchant || t.description)}`;
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const isDate = (d) => /^\d{4}-\d{2}/.test(d || "");
const pad2 = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthLabel = (ym) => { const [y, m] = ym.split("-"); return `${MONTHS[parseInt(m, 10) - 1]} ${y}`; };
const dayLabel = (s) => { const [y, m, dd] = s.split("-"); return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(dd, 10)}, ${y}`; };
const weekStartOf = (dateStr) => { const d = new Date(dateStr + "T12:00:00"); d.setDate(d.getDate() - d.getDay()); return fmt(d); }; // Sunday start
const weekLabel = (s) => "Week of " + dayLabel(s);
const qOf = (d) => `Q${Math.ceil(parseInt(d.slice(5, 7), 10) / 3)}`;

const toBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.onerror = () => reject(new Error("Could not read file"));
  r.readAsDataURL(file);
});

function rangeLabel(dates) {
  const ds = dates.filter(isDate).sort();
  if (!ds.length) return "no dates";
  const a = ds[0], b = ds[ds.length - 1];
  if (a.slice(0, 7) === b.slice(0, 7)) return monthLabel(a.slice(0, 7));
  return `${a} .. ${b}`;
}

function matchPeriod(t, gran, val) {
  if (gran === "all" || !val) return true;
  const d = t.date || "";
  if (!isDate(d)) return false;
  if (gran === "day") return d.slice(0, 10) === val;
  if (gran === "week") return weekStartOf(d) === val;
  if (gran === "month") return d.slice(0, 7) === val;
  if (gran === "year") return d.slice(0, 4) === val;
  if (gran === "quarter") { const [y, qq] = val.split("|"); return d.slice(0, 4) === y && qOf(d) === qq; }
  return true;
}

const S = {
  wrap: { fontFamily: serif, color: c.ink, background: c.bg, padding: "26px 22px 60px", maxWidth: 1180, margin: "0 auto" },
  h1: { fontFamily: serif, fontSize: 30, fontWeight: 400, letterSpacing: 0.3, margin: 0 },
  sub: { color: c.sub, fontSize: 14.5, marginTop: 4, fontStyle: "italic" },
  sec: { fontSize: 19, fontWeight: 400, margin: "26px 0 12px", letterSpacing: 0.3, borderBottom: `1px solid ${c.line}`, paddingBottom: 8 },
  panel: { background: c.panel, border: `1px solid ${c.line}`, borderRadius: 4, padding: 18 },
  cap: { fontFamily: sans, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: c.sub },
  btn: { fontFamily: sans, fontSize: 13, cursor: "pointer", padding: "8px 18px", borderRadius: 2, border: "none", background: c.ink, color: c.bg },
  btnGhost: { fontFamily: sans, fontSize: 13, cursor: "pointer", padding: "8px 16px", borderRadius: 2, border: `1px solid ${c.line}`, background: "transparent", color: c.sub },
  th: { fontFamily: sans, fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: c.sub, padding: "6px 8px", textAlign: "right", borderBottom: `1px solid ${c.line}`, whiteSpace: "nowrap" },
  td: { fontSize: 12.5, padding: "6px 8px", textAlign: "right", borderBottom: `1px solid ${c.lineSoft}`, whiteSpace: "nowrap" },
  sel: { fontFamily: sans, fontSize: 12, padding: "3px 6px", border: `1px solid ${c.line}`, borderRadius: 2, background: c.panel, color: c.ink },
};

export default function PnL({ data = {}, onSave }) {
  const [transactions, setTransactions] = useState(Array.isArray(data.transactions) ? data.transactions : []);
  const [rules, setRules] = useState(data.rules && typeof data.rules === "object" ? data.rules : {});
  const [totalCost, setTotalCost] = useState(num(data.totalCost));
  const [seen, setSeen] = useState(Array.isArray(data.seen) ? data.seen : []);
  const [statements, setStatements] = useState(Array.isArray(data.statements) ? data.statements : []);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);

  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState("");
  const [lastRun, setLastRun] = useState(null);
  const [gran, setGran] = useState("all");
  const [pickVal, setPickVal] = useState("");
  const [editStmt, setEditStmt] = useState(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftLink, setDraftLink] = useState("");

  // ---- data snapshot + undo/redo history (session-only; data itself is saved to Redis) ----
  const dataState = () => ({ transactions, rules, totalCost, seen, statements });
  const writeState = (st) => {
    setTransactions(st.transactions); setRules(st.rules);
    setTotalCost(st.totalCost); setSeen(st.seen); setStatements(st.statements);
    onSave?.(st);
  };
  function commit(next, record = true) {
    if (record) { setPast((p) => [...p, dataState()].slice(-50)); setFuture([]); }
    writeState(next);
  }
  const mutate = (over = {}) => commit({ ...dataState(), ...over }, true);
  function undo() {
    if (!past.length) return;
    const prev = past[past.length - 1];
    setFuture((f) => [...f, dataState()].slice(-50));
    setPast((p) => p.slice(0, -1));
    writeState(prev);
  }function redo() {
    if (!future.length) return;
    const nxt = future[future.length - 1];
    setPast((p) => [...p, dataState()].slice(-50));
    setFuture((f) => f.slice(0, -1));
    writeState(nxt);
  }

  async function runCategorize() {
    setConfirming(false);
    if (!file || loading) return;
    setErr(""); setLoading(true);
    try {
      const fp = `${file.name}|${file.size}`;
      const fname = file.name;
      const pdfBase64 = await toBase64(file);
      const resp = await fetch("/api/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64, knownMerchants: rules }),
      });
      const out = await resp.json();
      if (!resp.ok) throw new Error(out.error || "Categorization failed");

      const stmtId = uid("s");
      const existing = new Set(transactions.map(sig));
      const incoming = (out.transactions || []).map((t) => {
        const k = mkey(t.merchant || t.description);
        const ruled = rules[k];
        return {
          id: uid("t"), stmt: stmtId, date: t.date || "", description: t.description || "", merchant: t.merchant || "",
          amount: Math.abs(num(t.amount)), type: t.type === "income" ? "income" : "expense",
          category: ruled || t.category || "Uncategorized", source: ruled ? "rule" : "ai",
        };
      });
      const fresh = incoming.filter((t) => !existing.has(sig(t)));

      const u = out.usage || { input_tokens: 0, output_tokens: 0 };
      const runCost = u.input_tokens * IN_RATE + u.output_tokens * OUT_RATE;
      const nextTx = [...fresh, ...transactions];
      const nextCost = totalCost + runCost;
      const nextSeen = seen.includes(fp) ? seen : [...seen, fp];

      let nextStatements = statements;
      if (fresh.length) {
        const stIncome = fresh.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
        const stExpense = fresh.filter((t) => t.type !== "income").reduce((s, t) => s + t.amount, 0);
        const record = {
          id: stmtId, label: fname, importedAt: new Date().toISOString().slice(0, 10),
          periodLabel: rangeLabel(fresh.map((t) => t.date)), count: fresh.length,
          income: stIncome, expense: stExpense, cost: runCost,
        };
        nextStatements = [record, ...statements];
      }

      setLastRun({ input: u.input_tokens, output: u.output_tokens, cost: runCost, added: fresh.length, found: incoming.length });
      setFile(null);
      mutate({ transactions: nextTx, totalCost: nextCost, seen: nextSeen, statements: nextStatements });
    } catch (e) {
      setErr(e.message || String(e));
    }
    setLoading(false);
  }

  function setCategory(id, cat) {
    let newRules = rules;
    const next = transactions.map((t) => {
      if (t.id !== id) return t;
      newRules = { ...newRules, [mkey(t.merchant || t.description)]: cat };
      return { ...t, category: cat, source: "manual" };
    });
    mutate({ transactions: next, rules: newRules });
  }
  function setType(id, type) {
    const next = transactions.map((t) => (t.id === id ? { ...t, type } : t));
    mutate({ transactions: next });
  }
  function delTx(id) {
    const next = transactions.filter((t) => t.id !== id);
    mutate({ transactions: next });
  }
  function clearAll() {
    if (!window.confirm("Clear all transactions, the P&L, and the import log? Merchant rules are kept.")) return;
    mutate({ transactions: [], statements: [] });
  }

  function renameStatement(id, label, link) {
    const next = statements.map((s) => (s.id === id ? { ...s, label, link } : s));
    mutate({ statements: next });
  }
  function removeStatement(id) {
    const st = statements.find((s) => s.id === id); if (!st) return;
    const n = transactions.filter((t) => t.stmt === id).length;
    if (!window.confirm(`Remove "${st.label}" and its ${n} transactions from the P&L?`)) return;
    const nextTx = transactions.filter((t) => t.stmt !== id);
    const nextSt = statements.filter((s) => s.id !== id);
    mutate({ transactions: nextTx, statements: nextSt });
  }

  // distinct period values at each granularity, newest first
  const periodOptions = useMemo(() => {
    const day = new Set(), week = new Set(), month = new Set(), quarter = new Set(), year = new Set();
    transactions.forEach((t) => {
      const d = t.date || ""; if (!isDate(d)) return;
      day.add(d.slice(0, 10)); week.add(weekStartOf(d)); month.add(d.slice(0, 7)); year.add(d.slice(0, 4));
      quarter.add(`${d.slice(0, 4)}|${qOf(d)}`);
    });
    const desc = (set) => [...set].sort().reverse();
    return {
      day: desc(day).map((v) => ({ v, label: dayLabel(v) })),
      week: desc(week).map((v) => ({ v, label: weekLabel(v) })),
      month: desc(month).map((v) => ({ v, label: monthLabel(v) })),
      quarter: desc(quarter).map((v) => { const [y, qq] = v.split("|"); return { v, label: `${qq} ${y}` }; }),
      year: desc(year).map((v) => ({ v, label: v })),
    };
  }, [transactions]);

  function changeGran(g) {
    setGran(g);
    if (g === "all") { setPickVal(""); return; }
    const list = periodOptions[g] || [];
    setPickVal(list.length ? list[0].v : "");
  }

  const currentLabel = gran === "all" ? "All time" : ((periodOptions[gran] || []).find((o) => o.v === pickVal) || { label: "-" }).label;
  const viewTx = useMemo(() => transactions.filter((t) => matchPeriod(t, gran, pickVal)), [transactions, gran, pickVal]);
  const untagged = useMemo(() => transactions.filter((t) => !t.stmt).length, [transactions]);

  const counts = useMemo(() => {
    const m = {}; transactions.forEach((t) => { const k = mkey(t.merchant || t.description); m[k] = (m[k] || 0) + 1; }); return m;
  }, [transactions]);

  const pnl = useMemo(() => {let income = 0; const exp = {};
    viewTx.forEach((t) => {
      if (t.type === "income") income += num(t.amount);
      else exp[t.category] = (exp[t.category] || 0) + num(t.amount);
    });
    const expenseRows = Object.entries(exp).sort((a, b) => b[1] - a[1]);
    const expenseTotal = expenseRows.reduce((s, [, v]) => s + v, 0);
    return { income, expenseRows, expenseTotal, net: income - expenseTotal };
  }, [viewTx]);

  function downloadPDF() {
    const w = window.open("", "_blank");
    if (!w) { alert("Please allow pop-ups for this site to download the PDF."); return; }
    const rows = viewTx.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const expHtml = pnl.expenseRows.map(([cat, v]) =>
      `<tr><td style="padding-left:18px">${esc(cat)}</td><td class="r">(${money(v)})</td></tr>`).join("");
    const txHtml = rows.map((t) =>
      `<tr><td>${esc(t.date)}</td><td>${esc(t.description)}</td><td>${esc(t.category)}</td><td>${esc(t.type)}</td><td class="r">${t.type === "income" ? "" : "("}${money(t.amount)}${t.type === "income" ? "" : ")"}</td></tr>`).join("");
    const today = new Date().toISOString().slice(0, 10);
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>Lavalle Haus P&L - ${esc(currentLabel)}</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#2b2620;margin:40px;}
  h1{font-size:24px;margin:0 0 2px;font-weight:400;letter-spacing:.5px}
  .meta{color:#6f6657;font-size:12px;margin-bottom:24px}
  h2{font-size:15px;border-bottom:1px solid #d8d0c2;padding-bottom:5px;margin:26px 0 8px;font-weight:400}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  td,th{padding:5px 6px;border-bottom:1px solid #eee}
  th{text-align:left;color:#6f6657;font-size:10px;letter-spacing:.5px;text-transform:uppercase}
  .r{text-align:right;white-space:nowrap}
  .tot{border-top:2px solid #2b2620;font-weight:bold}
  .net{font-size:16px}
  .green{color:#5c7a52}.red{color:#a8483a}
  .foot{margin-top:30px;color:#9a8f7e;font-size:10px;font-style:italic}
  @media print{body{margin:18mm}}
</style></head><body>
  <h1>Lavalle Haus - Profit &amp; Loss</h1>
  <div class="meta">Period: <strong>${esc(currentLabel)}</strong> &nbsp;&middot;&nbsp; Generated ${today} &nbsp;&middot;&nbsp; ${rows.length} transactions</div>
  <h2>Summary</h2>
  <table>
    <tr><td>Revenue</td><td class="r green">${money(pnl.income)}</td></tr>
    ${expHtml}
    <tr class="tot"><td>Total expenses</td><td class="r red">(${money(pnl.expenseTotal)})</td></tr>
    <tr class="tot net"><td>Net profit</td><td class="r ${pnl.net >= 0 ? "green" : "red"}">${money(pnl.net)}</td></tr>
  </table>
  <h2>Transactions</h2>
  <table>
    <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Type</th><th class="r">Amount</th></tr></thead>
    <tbody>${txHtml || '<tr><td colspan="5" style="color:#9a8f7e;font-style:italic">No transactions in this period.</td></tr>'}</tbody>
  </table>
  <div class="foot">Lavalle Haus Operating System &middot; figures are AI-assisted from imported bank statements and should be confirmed by your accountant.</div>
</body></html>`;
    w.document.write(doc);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 350);
  }

  const dupWarn = file && seen.includes(`${file.name}|${file.size}`);
  const valOpts = gran === "all" ? [] : (periodOptions[gran] || []);

  return (
    <div style={S.wrap}>
      <div>
        <h1 style={S.h1}>P&amp;L / Transactions</h1><div style={faintEs}>Estado de resultados / transacciones</div>
        <div style={S.sub}>Upload a bank statement, let AI categorize it, and build your profit &amp; loss.</div>
        <div style={faintEs}>Sube un estado de cuenta, deja que la IA lo clasifique, y arma tu P&amp;L.</div>
      </div>

      {/* UNDO / REDO - safety net for the whole team */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <button onClick={undo} disabled={!past.length} title="Undo last change"
          style={{ ...S.btnGhost, padding: "6px 16px", opacity: past.length ? 1 : 0.4, cursor: past.length ? "pointer" : "default" }}>Undo</button>
        <button onClick={redo} disabled={!future.length} title="Redo"
          style={{ ...S.btnGhost, padding: "6px 16px", opacity: future.length ? 1 : 0.4, cursor: future.length ? "pointer" : "default" }}>Redo</button>
        <span style={{ fontSize: 11, color: c.sub, fontStyle: "italic" }}>
          {past.length ? `${past.length} change${past.length === 1 ? "" : "s"} you can undo this session` : "no changes yet this session"} - deshacer / rehacer
        </span>
      </div>

      {/* VIEW PERIOD FILTER - scopes everything below */}
      <div style={{ ...S.panel, marginTop: 16, padding: "14px 16px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={S.cap}>View period - periodo</span>
        <select value={gran} onChange={(e) => changeGran(e.target.value)} style={{ ...S.sel, fontSize: 13, padding: "5px 8px" }}>
          <option value="all">All time</option>
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
          <option value="quarter">Quarter</option>
          <option value="year">Year</option>
        </select>
        {gran !== "all" && (
          <select value={pickVal} onChange={(e) => setPickVal(e.target.value)} style={{ ...S.sel, fontSize: 13, padding: "5px 8px", minWidth: 150 }}>
            {valOpts.length === 0 && <option value="">no data yet</option>}
            {valOpts.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        )}
        <button onClick={downloadPDF} style={{ ...S.btn, padding: "7px 16px" }}>Download PDF</button>
        <span style={{ flexBasis: "100%", fontSize: 11, color: c.sub, fontStyle: "italic", marginTop: 2 }}>
          Showing <strong>{currentLabel}</strong> - {viewTx.length} transactions. Scopes the P&amp;L totals and the list below. Weeks start Sunday. - Filtra los totales y la lista. Las semanas empiezan domingo.
        </span>
      </div>

      <div style={S.sec}>Import a statement<div style={faintEs}>Importar estado de cuenta</div></div>
      <div style={S.panel}>
        <div style={{ fontSize: 12.5, color: c.sub, marginBottom: 12, lineHeight: 1.5 }}>
          Upload a <strong>PDF</strong> statement (Chase, etc.). Redacting your account number first is fine - only date, description, and amount are needed. The statement is sent to the Claude API to read and categorize.
          <div style={faintEs}>Sube un PDF. Redactar el numero de cuenta esta bien - solo se necesitan fecha, descripcion y monto.</div>
        </div>

        <input type="file" accept="application/pdf" onChange={(e) => { setErr(""); setFile(e.target.files && e.target.files[0]); }}
          style={{ fontFamily: sans, fontSize: 13, color: c.ink, marginBottom: 12, display: "block" }} />

        {dupWarn && <div style={{ fontSize: 12, color: c.yellow, marginBottom: 10 }}>This statement looks already imported - re-running will call the API again. Duplicates won't be added. - Parece ya importado.</div>}

        {!confirming ? (
          <button disabled={!file || loading} onClick={() => setConfirming(true)}
            style={{ ...S.btn, opacity: !file || loading ? 0.45 : 1 }}>
            {loading ? "Reading statement..." : "Categorize statement"}
          </button>
        ) : (
          <div style={{ border: `1px solid ${c.gold}`, borderRadius: 3, padding: 14, background: "#fffaf2" }}>
            <div style={{ fontSize: 13, color: c.ink, marginBottom: 4 }}>This will send the statement to the Claude API - <strong>one call</strong>, typically a few cents.</div>
            <div style={faintEs}>Esto enviara el estado a la API de Claude - una sola llamada, normalmente unos centavos.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={runCategorize} style={S.btn}>Confirm &amp; run - confirmar</button>
              <button onClick={() => setConfirming(false)} style={S.btnGhost}>Cancel - cancelar</button>
            </div>
          </div>
        )}
        {err && <div style={{ fontSize: 12.5, color: c.red, marginTop: 10 }}>Error: {err}</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginTop: 14 }}><div style={{ ...S.panel, padding: "14px 16px" }}>
          <div style={S.cap}>Last run cost</div><div style={faintEs}>Costo ultima vez</div>
          <div style={{ fontSize: 22, marginTop: 4, color: c.ink }}>{lastRun ? cents(lastRun.cost) : "-"}</div>
          {lastRun && <div style={{ fontSize: 11, color: c.sub, marginTop: 2 }}>{lastRun.input.toLocaleString()} in / {lastRun.output.toLocaleString()} out tokens - +{lastRun.added} new</div>}
        </div>
        <div style={{ ...S.panel, padding: "14px 16px" }}>
          <div style={S.cap}>Total API cost</div><div style={faintEs}>Costo total API</div>
          <div style={{ fontSize: 22, marginTop: 4, color: c.gold }}>{cents(totalCost)}</div>
          <div style={{ fontSize: 11, color: c.sub, marginTop: 2 }}>cumulative, all statements</div>
        </div>
        <div style={{ ...S.panel, padding: "14px 16px" }}>
          <div style={S.cap}>Merchant rules learned</div><div style={faintEs}>Reglas aprendidas</div>
          <div style={{ fontSize: 22, marginTop: 4, color: c.blue }}>{Object.keys(rules).length}</div>
          <div style={{ fontSize: 11, color: c.sub, marginTop: 2 }}>auto-applied to future statements</div>
        </div>
      </div>

      {/* IMPORTED STATEMENTS LOG */}
      <div style={S.sec}>Imported statements ({statements.length})<div style={faintEs}>Estados importados - para tus registros</div></div>
      <div style={S.panel}>
        <div style={{ fontSize: 12.5, color: c.sub, marginBottom: statements.length ? 12 : 0, lineHeight: 1.5 }}>
          A record of every statement you've imported. Rename any entry and paste a Google Drive link to the original PDF, so you can jump straight to the source document for accounting or an audit. The PDF itself isn't stored in the app.
          <div style={faintEs}>Registro de cada estado importado. Renombra y pega un enlace de Google Drive al PDF original. El PDF no se guarda en la app.</div>
        </div>
        {statements.length === 0 && <div style={{ fontSize: 12.5, color: c.sub, fontStyle: "italic" }}>No statements logged yet - your next import will appear here. - Aun no hay registros.</div>}
        {statements.map((st) => (
          <div key={st.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 0", borderBottom: `1px solid ${c.lineSoft}` }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              {editStmt === st.id ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <input value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} style={{ ...S.sel, fontSize: 13, minWidth: 200 }} placeholder="Statement name" />
                  <input value={draftLink} onChange={(e) => setDraftLink(e.target.value)} style={{ ...S.sel, fontSize: 13, minWidth: 240 }} placeholder="Google Drive link to PDF (optional)" />
                  <button onClick={() => { renameStatement(st.id, draftLabel.trim() || st.label, draftLink.trim()); setEditStmt(null); }} style={{ ...S.btn, padding: "4px 14px" }}>Save</button>
                  <button onClick={() => setEditStmt(null)} style={{ ...S.btnGhost, padding: "4px 10px" }}>Cancel</button>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 14 }}>
                    {st.label}
                    {st.link && <a href={st.link} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 10, fontFamily: sans, fontSize: 11, letterSpacing: 0.5, color: c.clay, textDecoration: "none" }}>Open PDF &gt;</a>}
                  </div>
                  <div style={{ fontSize: 11, color: c.sub, marginTop: 2 }}>{st.periodLabel} &middot; {st.count} tx &middot; imported {st.importedAt} &middot; {cents(st.cost)}</div>
                </>
              )}
            </div>
            {editStmt !== st.id && (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => { setEditStmt(st.id); setDraftLabel(st.label); setDraftLink(st.link || ""); }} style={{ ...S.btnGhost, padding: "4px 12px" }}>Rename</button>
                <button onClick={() => removeStatement(st.id)} style={{ ...S.btnGhost, padding: "4px 12px", color: c.red }}>Remove</button>
              </div>
            )}
          </div>
        ))}
        {untagged > 0 && <div style={{ fontSize: 11, color: c.sub, fontStyle: "italic", marginTop: 10 }}>+ {untagged} transactions imported before the log existed - already counted in your P&amp;L below. - ya incluidas.</div>}
      </div>

      <div style={S.sec}>Profit &amp; Loss<div style={faintEs}>Estado de resultados - {currentLabel}</div></div>
      <div style={S.panel}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 14 }}>
          <span>Revenue - Ingresos</span><span style={{ color: c.green }}>{money(pnl.income)}</span>
        </div>
        {pnl.expenseRows.map(([cat, v]) => (
          <div key={cat} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0 4px 14px", fontSize: 12.5, color: c.sub }}>
            <span>{cat}</span><span>({money(v)})</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, borderTop: `1px solid ${c.lineSoft}`, marginTop: 4 }}>
          <span>Total expenses - Gastos</span><span style={{ color: c.red }}>({money(pnl.expenseTotal)})</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0", fontSize: 16, borderTop: `2px solid ${c.line}`, marginTop: 6 }}>
          <span>Net - Neto</span><span style={{ color: pnl.net >= 0 ? c.green : c.red }}>{money(pnl.net)}</span>
        </div>
        <div style={{ fontSize: 11, color: c.sub, marginTop: 8, fontStyle: "italic" }}>Showing: {currentLabel} - {viewTx.length} transactions</div>
        {transactions.length === 0 && <div style={{ fontSize: 12.5, color: c.sub, fontStyle: "italic", marginTop: 8 }}>No transactions yet - import a statement above. - Sin transacciones aun.</div>}
      </div>

      {viewTx.length > 0 && (
        <>
          <div style={S.sec}>
            Transactions ({viewTx.length})<div style={faintEs}>Transacciones - {currentLabel}</div>
          </div>
          <div style={{ overflowX: "auto", border: `1px solid ${c.lineSoft}`, borderRadius: 3 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead><tr>
                <th style={{ ...S.th, textAlign: "left" }}>Date</th>
                <th style={{ ...S.th, textAlign: "left" }}>Description</th>
                <th style={S.th}>Amount</th>
                <th style={{ ...S.th, textAlign: "center" }}>Type</th>
                <th style={{ ...S.th, textAlign: "left" }}>Category</th>
                <th style={S.th}></th>
              </tr></thead>
              <tbody>
                {viewTx.map((t) => {
                  const recurring = counts[mkey(t.merchant || t.description)] > 1;
                  return (
                    <tr key={t.id}>
                      <td style={{ ...S.td, textAlign: "left", color: c.sub }}>{t.date}</td>
                      <td style={{ ...S.td, textAlign: "left", maxWidth: 240, whiteSpace: "normal" }}>
                        {t.description}
                        {recurring && <span style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 0.5, color: c.blue, border: `1px solid ${c.blue}40`, borderRadius: 2, padding: "0 4px", marginLeft: 6 }}>RECURRING</span>}
                        {t.source === "rule" && <span style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 0.5, color: c.green, marginLeft: 6 }}>auto</span>}
                      </td>
                      <td style={{ ...S.td, color: t.type === "income" ? c.green : c.ink }}>{t.type === "income" ? "" : "("}{money(t.amount)}{t.type === "income" ? "" : ")"}</td>
                      <td style={{ ...S.td, textAlign: "center" }}>
                        <select value={t.type} onChange={(e) => setType(t.id, e.target.value)} style={S.sel}>
                          <option value="expense">expense</option>
                          <option value="income">income</option>
                        </select>
                      </td>
                      <td style={{ ...S.td, textAlign: "left" }}>
                        <select value={t.category} onChange={(e) => setCategory(t.id, e.target.value)} style={S.sel}>
                          {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                      </td>
                      <td style={S.td}><button onClick={() => delTx(t.id)} style={{ ...S.btnGhost, padding: "2px 8px", color: c.red }}>X</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: c.sub, marginTop: 8, fontStyle: "italic" }}>
            Changing a category teaches a merchant rule - that merchant auto-categorizes on every future statement.
            <div style={faintEs}>Cambiar una categoria ensena una regla - ese comercio se clasifica solo en el futuro.</div>
          </div>
          <button onClick={clearAll} style={{ ...S.btnGhost, marginTop: 12, color: c.red }}>Clear all transactions - borrar todo</button>
        </>
      )}
    </div>
  );
}
