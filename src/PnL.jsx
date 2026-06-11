import { useState, useMemo } from "react";

/* ============================================================================
   LAVALLE HAUS OS — P&L / TRANSACTIONS
   Upload a bank-statement PDF → AI extracts & categorizes every transaction →
   you review/override → it builds a running P&L. Learns merchant rules so
   recurring/same-merchant charges auto-categorize on future statements.

   Cost is fully disclosed: every run shows tokens + dollars, plus a running
   total. Guardrails: one API call per statement, manual confirm before each
   call, and duplicate statements are caught so you're never double-charged.

   Needs the api/categorize.js function + ANTHROPIC_API_KEY set in Vercel.
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

// Sonnet 4.6 rates, $ per token
const IN_RATE = 3 / 1e6, OUT_RATE = 15 / 1e6;

const CATEGORIES = [
  "Revenue / Sales", "Refunds", "COGS / Materials", "Packaging", "Shipping / Postage",
  "Advertising", "Software / SaaS", "Merchant / Bank Fees", "Office / Supplies",
  "Travel", "Meals", "Contractors / Labor", "Taxes", "Owner Draw / Transfer",
  "Other Expense", "Uncategorized",
];

const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? 0 : Number(v));
const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(num(n)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = (n) => "$" + num(n).toFixed(num(n) < 0.1 ? 4 : 2);
const uid = () => "t" + Math.random().toString(36).slice(2, 9);
const mkey = (s) => String(s || "").toLowerCase().replace(/[0-9]/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
const sig = (t) => `${t.date}|${num(t.amount).toFixed(2)}|${mkey(t.merchant || t.description)}`;
const toBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.onerror = () => reject(new Error("Could not read file"));
  r.readAsDataURL(file);
});

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
  const [seen, setSeen] = useState(Array.isArray(data.seen) ? data.seen : []); // statement fingerprints

  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState("");
  const [lastRun, setLastRun] = useState(null);

  const save = (txs, rls, cost, sn) => { onSave?.({ transactions: txs, rules: rls, totalCost: cost, seen: sn }); };

  async function runCategorize() {
    setConfirming(false);
    if (!file || loading) return;
    setErr(""); setLoading(true);
    try {
      const fp = `${file.name}|${file.size}`;
      const pdfBase64 = await toBase64(file);
      const resp = await fetch("/api/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64, knownMerchants: rules }),
      });
      const out = await resp.json();
      if (!resp.ok) throw new Error(out.error || "Categorization failed");

      const existing = new Set(transactions.map(sig));
      const incoming = (out.transactions || []).map((t) => {
        const k = mkey(t.merchant || t.description);
        const ruled = rules[k];
        return {
          id: uid(), date: t.date || "", description: t.description || "", merchant: t.merchant || "",
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

      setTransactions(nextTx); setTotalCost(nextCost); setSeen(nextSeen);
      setLastRun({ input: u.input_tokens, output: u.output_tokens, cost: runCost, added: fresh.length, found: incoming.length });
      setFile(null);
      save(nextTx, rules, nextCost, nextSeen);
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
    setTransactions(next); setRules(newRules);
    save(next, newRules, totalCost, seen);
  }
  function setType(id, type) {
    const next = transactions.map((t) => (t.id === id ? { ...t, type } : t));
    setTransactions(next); save(next, rules, totalCost, seen);
  }
  function delTx(id) {
    const next = transactions.filter((t) => t.id !== id);
    setTransactions(next); save(next, rules, totalCost, seen);
  }
  function clearAll() {
    if (!window.confirm("Clear all transactions and the P&L? Merchant rules are kept.")) return;
    setTransactions([]); save([], rules, totalCost, seen);
  }

  // recurring = merchant key seen >1 time
  const counts = useMemo(() => {
    const m = {}; transactions.forEach((t) => { const k = mkey(t.merchant || t.description); m[k] = (m[k] || 0) + 1; }); return m;
  }, [transactions]);

  const pnl = useMemo(() => {
    let income = 0; const exp = {};
    transactions.forEach((t) => {if (t.type === "income") income += num(t.amount);
      else exp[t.category] = (exp[t.category] || 0) + num(t.amount);
    });
    const expenseRows = Object.entries(exp).sort((a, b) => b[1] - a[1]);
    const expenseTotal = expenseRows.reduce((s, [, v]) => s + v, 0);
    return { income, expenseRows, expenseTotal, net: income - expenseTotal };
  }, [transactions]);

  const dupWarn = file && seen.includes(`${file.name}|${file.size}`);

  return (
    <div style={S.wrap}>
      <div>
        <h1 style={S.h1}>P&amp;L / Transactions</h1><div style={faintEs}>Estado de resultados / transacciones</div>
        <div style={S.sub}>Upload a bank statement, let AI categorize it, and build your profit &amp; loss.</div>
        <div style={faintEs}>Sube un estado de cuenta, deja que la IA lo clasifique, y arma tu P&amp;L.</div>
      </div>

      {/* UPLOAD */}
      <div style={S.sec}>Import a statement<div style={faintEs}>Importar estado de cuenta</div></div>
      <div style={S.panel}>
        <div style={{ fontSize: 12.5, color: c.sub, marginBottom: 12, lineHeight: 1.5 }}>
          Upload a <strong>PDF</strong> statement (Chase, etc.). Redacting your account number first is fine — only date, description, and amount are needed. The statement is sent to the Claude API to read and categorize.
          <div style={faintEs}>Sube un PDF. Redactar el número de cuenta está bien — solo se necesitan fecha, descripción y monto. El estado se envía a la API de Claude.</div>
        </div>

        <input type="file" accept="application/pdf" onChange={(e) => { setErr(""); setFile(e.target.files && e.target.files[0]); }}
          style={{ fontFamily: sans, fontSize: 13, color: c.ink, marginBottom: 12, display: "block" }} />

        {dupWarn && <div style={{ fontSize: 12, color: c.yellow, marginBottom: 10 }}>⚠ This statement looks already imported — re-running will call the API again. Duplicate transactions won't be added. · Parece ya importado; no se duplicarán transacciones.</div>}

        {!confirming ? (
          <button disabled={!file || loading} onClick={() => setConfirming(true)}
            style={{ ...S.btn, opacity: !file || loading ? 0.45 : 1 }}>
            {loading ? "Reading statement…" : "Categorize statement"}
          </button>
        ) : (
          <div style={{ border: `1px solid ${c.gold}`, borderRadius: 3, padding: 14, background: "#fffaf2" }}>
            <div style={{ fontSize: 13, color: c.ink, marginBottom: 4 }}>This will send the statement to the Claude API — <strong>one call</strong>, typically a few cents.</div>
            <div style={faintEs}>Esto enviará el estado a la API de Claude — una sola llamada, normalmente unos centavos.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={runCategorize} style={S.btn}>Confirm &amp; run · confirmar</button>
              <button onClick={() => setConfirming(false)} style={S.btnGhost}>Cancel · cancelar</button>
            </div>
          </div>
        )}
        {err && <div style={{ fontSize: 12.5, color: c.red, marginTop: 10 }}>Error: {err}</div>}
      </div>

      {/* COST PANEL */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginTop: 14 }}>
        <div style={{ ...S.panel, padding: "14px 16px" }}>
          <div style={S.cap}>Last run cost</div><div style={faintEs}>Costo última vez</div>
          <div style={{ fontSize: 22, marginTop: 4, color: c.ink }}>{lastRun ? cents(lastRun.cost) : "—"}</div>
          {lastRun && <div style={{ fontSize: 11, color: c.sub, marginTop: 2 }}>{lastRun.input.toLocaleString()} in / {lastRun.output.toLocaleString()} out tokens · +{lastRun.added} new</div>}
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

      {/* P&L SUMMARY */}
      <div style={S.sec}>Profit &amp; Loss<div style={faintEs}>Estado de resultados</div></div>
      <div style={S.panel}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 14 }}>
          <span>Revenue · Ingresos</span><span style={{ color: c.green }}>{money(pnl.income)}</span>
        </div>
        {pnl.expenseRows.map(([cat, v]) => (
          <div key={cat} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0 4px 14px", fontSize: 12.5, color: c.sub }}>
            <span>{cat}</span><span>({money(v)})</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, borderTop: `1px solid ${c.lineSoft}`, marginTop: 4 }}>
          <span>Total expenses · Gastos</span><span style={{ color: c.red }}>({money(pnl.expenseTotal)})</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0", fontSize: 16, borderTop: `2px solid ${c.line}`, marginTop: 6 }}>
          <span>Net · Neto</span><span style={{ color: pnl.net >= 0 ? c.green : c.red }}>{money(pnl.net)}</span>
        </div>
        {transactions.length === 0 && <div style={{ fontSize: 12.5, color: c.sub, fontStyle: "italic", marginTop: 8 }}>No transactions yet — import a statement above. · Sin transacciones aún.</div>}
      </div>

      {/* TRANSACTIONS TABLE */}
      {transactions.length > 0 && (
        <>
          <div style={S.sec}>
            Transactions ({transactions.length})<div style={faintEs}>Transacciones</div>
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
                {transactions.map((t) => {
                  const recurring = counts[mkey(t.merchant || t.description)] > 1;
                  return (
                    <tr key={t.id}>
                      <td style={{ ...S.td, textAlign: "left", color: c.sub }}>{t.date}</td>
                      <td style={{ ...S.td, textAlign: "left", maxWidth: 240, whiteSpace: "normal" }}>
                        {t.description}
                        {recurring && <span style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 0.5, color: c.blue, border: `1px solid ${c.blue}40`, borderRadius: 2, padding: "0 4px", marginLeft: 6 }}>RECURRING</span>}
                        {t.source === "rule" && <span style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 0.5, color: c.green, marginLeft: 6 }}>auto</span>}
                      </td>
                      <td style={{ ...S.td, color: t.type === "income" ? c.green : c.ink }}>{t.type === "income" ? "" : "("}{money(t.amount).replace("$", "$")}{t.type === "income" ? "" : ")"}</td>
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
                      <td style={S.td}><button onClick={() => delTx(t.id)} style={{ ...S.btnGhost, padding: "2px 8px", color: c.red }}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: c.sub, marginTop: 8, fontStyle: "italic" }}>
            Changing a category teaches a merchant rule — that merchant auto-categorizes on every future statement.
            <div style={faintEs}>Cambiar una categoría enseña una regla — ese comercio se clasifica solo en el futuro.</div>
          </div>
          <button onClick={clearAll} style={{ ...S.btnGhost, marginTop: 12, color: c.red }}>Clear all transactions · borrar todo</button>
        </>
      )}
    </div>
  );
}
