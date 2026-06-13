import { useState, useEffect, useCallback } from "react";

// LAVALLE HAUS OS — Bank (Plaid). Connect bank accounts, show live balances,
// total cash, and feed the cash figure into FinanceCash runway via onSaveCash.
// Access tokens are stored server-side; this component only ever sees balances.

const c = {
  bg: "#f7f4ef", ink: "#1a1714", sub: "#8c7d6b", line: "#c8c2b8",
  green: "#5a7a5a", clay: "#a07848", red: "#9b5e5e", card: "#efece5",
};
const serif = "'IM Fell English', Georgia, serif";
const sans = "monospace";
const card = { background: c.card, border: `1px solid ${c.line}`, borderRadius: 1, padding: 16, marginBottom: 12 };
const btnDark = { padding: "9px 20px", fontSize: 10, fontFamily: sans, letterSpacing: 2, cursor: "pointer", borderRadius: 1, border: "1px solid #1a1714", background: "#1a1714", color: "#f7f4ef", textTransform: "uppercase" };
const btnGhost = { padding: "6px 14px", fontSize: 10, fontFamily: sans, letterSpacing: 1, cursor: "pointer", borderRadius: 1, border: `1px solid ${c.line}`, background: "transparent", color: c.sub, textTransform: "uppercase" };
const money = (v) => (v == null || isNaN(v) ? "—" : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const PLAID_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

export default function Bank({ onSaveCash }) {
  const [bal, setBal] = useState({ loading: true, accounts: [], totalCash: 0, connected: false, updatedAt: null, error: null });
  const [linking, setLinking] = useState(false);
  const [scriptReady, setScriptReady] = useState(typeof window !== "undefined" && window.Plaid);

  useEffect(() => {
    if (window.Plaid) { setScriptReady(true); return; }
    const s = document.createElement("script");
    s.src = PLAID_SCRIPT; s.onload = () => setScriptReady(true);
    document.body.appendChild(s);
  }, []);

  const loadBalances = useCallback(() => {
    setBal((b) => ({ ...b, loading: true, error: null }));
    fetch("/api/plaid?op=balances").then((r) => r.json()).then((d) => {
      if (d.accounts) {
        setBal({ loading: false, accounts: d.accounts, totalCash: d.totalCash || 0, connected: d.connected, updatedAt: d.updatedAt, error: null });
        if (onSaveCash) onSaveCash(d.totalCash || 0, d.updatedAt);
      } else setBal({ loading: false, accounts: [], totalCash: 0, connected: false, updatedAt: null, error: d.error || "Could not load balances" });
    }).catch((e) => setBal({ loading: false, accounts: [], totalCash: 0, connected: false, updatedAt: null, error: String(e) }));
  }, [onSaveCash]);

  useEffect(() => { loadBalances(); }, [loadBalances]);

  async function connect() {
    if (!scriptReady || !window.Plaid) { alert("Plaid is still loading — try again in a second."); return; }
    setLinking(true);
    try {
      const { link_token } = await fetch("/api/plaid?op=link_token").then((r) => r.json());
      if (!link_token) { setLinking(false); alert("Could not start Plaid — check that PLAID_CLIENT_ID and PLAID_SECRET are set in Vercel."); return; }
      const handler = window.Plaid.create({
        token: link_token,
        onSuccess: async (public_token, metadata) => {
          await fetch("/api/plaid?op=exchange", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ public_token, institution: metadata && metadata.institution ? metadata.institution.name : "Bank" }),
          });
          setLinking(false);
          loadBalances();
        },
        onExit: () => setLinking(false),
      });
      handler.open();
    } catch (e) { setLinking(false); alert(String(e)); }
  }

  async function disconnect(item_id) {
    if (!window.confirm("Disconnect this bank? Balances from it will stop updating.")) return;
    await fetch("/api/plaid?op=remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_id }) });
    loadBalances();
  }

  const banks = {};
  for (const a of bal.accounts) { (banks[a.item_id] = banks[a.item_id] || { institution: a.institution, accounts: [], error: null }); if (a.error) banks[a.item_id].error = a.error; else banks[a.item_id].accounts.push(a); }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div>
          <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 400, color: c.ink, margin: 0 }}>Bank & Cash</h1>
          <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 12, color: "rgba(111,102,87,0.6)" }}>Saldos bancarios en vivo vía Plaid — alimentan tu pista de efectivo</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <button onClick={loadBalances} style={btnGhost}>REFRESH</button>
          <div style={{ fontSize: 9, fontFamily: sans, letterSpacing: 1, color: bal.updatedAt ? c.green : c.sub, marginTop: 4 }}>
            {bal.updatedAt ? `● AS OF ${new Date(bal.updatedAt).toLocaleTimeString()}` : bal.loading ? "○ LOADING…" : ""}
          </div>
        </div>
      </div>

      <div style={{ ...card, borderLeft: `3px solid ${c.green}` }}>
        <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: c.sub, fontFamily: sans }}>Total cash · checking + savings</div>
        <div style={{ fontFamily: serif, fontSize: 38, color: c.ink, marginTop: 2 }}>{money(bal.totalCash)}</div>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 11, color: "rgba(111,102,87,0.55)" }}>This figure now drives Cash Runway in the Finance / Cash tab. Esta cifra impulsa la pista de efectivo.</div>
      </div>

      {bal.error && <div style={{ ...card, borderLeft: `3px solid ${c.red}`, fontFamily: sans, fontSize: 12, color: c.red }}>{bal.error}</div>}

      {Object.keys(banks).map((id) => (
        <div key={id} style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontFamily: serif, fontSize: 16, color: c.ink }}>{banks[id].institution}</span>
            <span onClick={() => disconnect(id)} style={{ fontFamily: sans, fontSize: 9, letterSpacing: 1, color: c.red, cursor: "pointer" }}>DISCONNECT</span>
          </div>
          {banks[id].error ? (
            <div style={{ fontFamily: sans, fontSize: 11, color: c.clay, marginTop: 6 }}>Couldn't refresh — may need reconnect: {banks[id].error}</div>
          ) : banks[id].accounts.map((a, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #00000008", fontFamily: sans, fontSize: 12 }}>
              <span style={{ color: c.sub }}>{a.name}{a.mask ? ` ··${a.mask}` : ""} <span style={{ fontSize: 9 }}>{a.subtype || a.type}</span></span>
              <span style={{ color: c.ink }}>{money(a.available != null ? a.available : a.current)}</span>
            </div>
          ))}
        </div>
      ))}

      <div style={card}>
        <button onClick={connect} disabled={linking} style={{ ...btnDark, opacity: linking ? 0.5 : 1 }}>
          {linking ? "Opening Plaid…" : bal.connected ? "＋ Connect another bank" : "Connect your bank"}
        </button>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 10, color: "rgba(111,102,87,0.55)", marginTop: 8 }}>
          Opens Plaid's secure connection window. Your bank login never touches this app — Plaid returns only balances, and the connection token is stored server-side. Up to 10 banks.
          <br/>Abre la ventana segura de Plaid. Tu login bancario nunca toca esta app — Plaid devuelve solo saldos. Hasta 10 bancos.
        </div>
      </div>
    </div>
  );
}
