import { createHmac, scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

// ── APP LOCK ──────────────────────────────────────────────────────────────────
// Two ways in: the house password (owner master key, legacy token) or a
// per-user session token issued after an email invite + personal password.
// When APP_PASSWORD is unset the lock stays off — deploying this code before
// adding the env var can never lock anyone out.
const SESSION_SALT = "lavalle-haus-session-v1";
function appToken() {
  return createHmac("sha256", process.env.APP_PASSWORD || "").update(SESSION_SALT).digest("hex");
}
function makeUserToken(user) {
  const body = Buffer.from(JSON.stringify({ u: user.id, n: user.name, r: user.role, e: Date.now() + 30 * 86400000 })).toString("base64url");
  const sig = createHmac("sha256", process.env.APP_PASSWORD || "x").update(body).digest("hex");
  return "u." + body + "." + sig;
}
function verifyUserToken(tok) {
  if (!process.env.APP_PASSWORD || !tok || !tok.startsWith("u.")) return null;
  const parts = tok.split(".");
  if (parts.length !== 3) return null;
  const expect = createHmac("sha256", process.env.APP_PASSWORD).update(parts[1]).digest("hex");
  if (parts[2] !== expect) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (!p.e || Date.now() > p.e) return null;
    return p;
  } catch (e) { return null; }
}
// Resolve who is calling. House token → owner. User token → must still exist
// in the user store and not be revoked (so Revoke works instantly, even for
// tokens already issued). Returns { role, name, email, userId } or null.
async function getAuth(req) {
  if (!process.env.APP_PASSWORD) return { role: "Owner / Admin", name: "", email: "", userId: null, house: true };
  const tok = req.headers["x-app-token"] || "";
  if (tok === appToken()) return { role: "Owner / Admin", name: "", email: "", userId: null, house: true };
  const p = verifyUserToken(tok);
  if (!p) return null;
  const users = (await kvGet("lavalle_users")) || [];
  const u = users.find((x) => x.id === p.u);
  if (!u || u.revoked || !u.hash) return null;
  return { role: u.role, name: u.name, email: u.email, userId: u.id, house: false, pages: u.pages || null };
}
// Per-person page overrides: null = the role's default set; an array = exactly
// these tabs. Unknown ids are dropped; an empty result falls back to null.
const PAGE_IDS = ["brain", "profit", "ads", "inventory", "growth", "content", "roadmap", "materials", "ai"];
function cleanPages(v) {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x) => PAGE_IDS.includes(x));
  return out.length ? out : null;
}
const ownerRole = (auth) => !!(auth && /^owner/i.test(auth.role || ""));
const hashPassword = (pw, salt) => scryptSync(pw, salt, 64).toString("hex");
function passwordMatches(pw, salt, hash) {
  try {
    const a = Buffer.from(hashPassword(pw, salt), "hex");
    const b = Buffer.from(hash, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch (e) { return false; }
}

// ── PLAID (folded in here to stay under Vercel's 12-function Hobby cap) ─────────
const PLAID_ENV = process.env.PLAID_ENV || "production";
const PLAID_BASE =
  PLAID_ENV === "sandbox" ? "https://sandbox.plaid.com"
  : PLAID_ENV === "development" ? "https://development.plaid.com"
  : "https://production.plaid.com";
const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID || "";
const PLAID_SECRET = process.env.PLAID_SECRET || "";
const PLAID_REDIRECT_URI = process.env.PLAID_REDIRECT_URI || "";
const PLAID_OPS = ["link_token", "exchange", "balances", "transactions", "items", "remove"];

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${key}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  const d = await r.json();
  if (!d || d.result == null) return null;
  try { return JSON.parse(d.result); } catch { return null; }
}
async function kvSet(key, value) {
  await fetch(`${KV_URL}/set/${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(value),
  });
}
async function plaid(path, body) {
  const r = await fetch(`${PLAID_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, ...body }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_message || d.error_code || `Plaid ${r.status}`);
  return d;
}

// ── Email reminders (cron) ───────────────────────────────────────────────────
async function sendResendEmail({ apiKey, from, to, subject, html }) {
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, html }) });
  const text = await r.text();
  if (!r.ok) throw new Error("Resend " + r.status + ": " + text.slice(0, 200));
  try { return JSON.parse(text).id; } catch (e) { return null; }
}

const REMINDER_DAYS = [7, 3, 1, 0]; // days before due (0 = due today)

// Daily job: email assignees a reminder at each milestone before a task's due
// date. Deduped per (dueDate, milestone) so each fires once.
async function runReminders(res) {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "Lavalle Haus OS <onboarding@resend.dev>";
  if (!apiKey) { res.status(200).json({ ok: false, error: "RESEND_API_KEY not set" }); return; }
  try {
    const r = await fetch(`${url}/get/lavalle_data`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    let data = d.result ? JSON.parse(d.result) : null;
    if (Array.isArray(data)) data = data[0];
    if (!data) { res.status(200).json({ ok: true, sent: 0, note: "no data" }); return; }
    const board = data.actionsBoard || {};
    const items = board.items || [];
    const team = board.team || [];
    const memById = {}; team.forEach((t) => { memById[t.id] = t; });
    const esc = (x) => String(x == null ? "" : x).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
    const now = new Date();
    const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    let sent = 0, changed = false; const log = [];
    for (const it of items) {
      if (!it.dueDate || it.status === "done" || it.status === "resolved") continue;
      const parts = String(it.dueDate).split("-");
      if (parts.length !== 3) continue;
      const dueUTC = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      const days = Math.round((dueUTC - todayUTC) / 86400000);
      if (!REMINDER_DAYS.includes(days)) continue;
      const reminded = it.reminded || {};
      const rkey = it.dueDate + ":" + days;
      if (reminded[rkey]) continue;
      const assignees = (it.assignees && it.assignees.length) ? it.assignees : (it.assigneeId ? [it.assigneeId] : []);
      const recips = assignees.map((a) => memById[a]).filter((m) => m && m.email);
      if (!recips.length) continue;
      const whenTxt = days === 0 ? "due today" : ("due in " + days + " day" + (days === 1 ? "" : "s"));
      const subject = "Reminder: " + it.title + " — " + whenTxt;
      const html = '<div style="font-family:Georgia,serif;color:#1a1714;max-width:560px">' +
        '<p style="font-size:11px;letter-spacing:2px;color:#a07848;text-transform:uppercase">Lavalle Haus OS &middot; Reminder</p>' +
        '<h2 style="font-weight:400;margin:6px 0">' + esc(it.title) + '</h2>' +
        '<p style="color:#9b5e5e;font-weight:bold;margin:4px 0">' + esc(whenTxt.charAt(0).toUpperCase() + whenTxt.slice(1)) + ' (' + esc(it.dueDate) + ')</p>' +
        (it.detail ? '<p style="line-height:1.5">' + esc(it.detail) + '</p>' : '') +
        (it.name ? '<p style="color:#8c7d6b;margin:4px 0"><b>Product:</b> ' + esc(it.name) + '</p>' : '') +
        '<hr style="border:none;border-top:1px solid #c8c2b8;margin:14px 0"/>' +
        '<p style="font-size:12px;color:#8c7d6b">Sent from Lavalle Haus OS</p></div>';
      for (const m of recips) {
        try { await sendResendEmail({ apiKey, from, to: m.email, subject, html }); sent += 1; log.push(m.email + " @" + days + "d"); }
        catch (e) { log.push("ERR " + m.email + ": " + String(e).slice(0, 80)); }
      }
      it.reminded = { ...reminded, [rkey]: true };
      changed = true;
    }
    if (changed) {
      data.actionsBoard = { ...board, items };
      await fetch(`${url}/set/lavalle_data`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(data) });
    }
    res.status(200).json({ ok: true, sent, log });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e).slice(0, 300) });
  }
}

export default async function handler(req, res) {
  // Cron: Vercel sends Authorization: Bearer CRON_SECRET when CRON_SECRET is set.
  if (req.method === "GET" && process.env.CRON_SECRET && req.headers && req.headers.authorization === "Bearer " + process.env.CRON_SECRET) {
    return runReminders(res);
  }
  const op = (req.query && req.query.op) || "";

  // ── Auth (public ops) ────────────────────────────────────────────────────────
  // Login: house password (owner master key) or personal email + password.
  if (req.method === "POST" && op === "login") {
    const b = req.body || {};
    const pw = b.password || "";
    const email = (b.email || "").trim().toLowerCase();
    if (!email && process.env.APP_PASSWORD && pw === process.env.APP_PASSWORD) {
      res.json({ token: appToken(), user: { name: "", role: "Owner / Admin", email: "", pages: null } });
      return;
    }
    if (email && pw) {
      const users = (await kvGet("lavalle_users")) || [];
      const u = users.find((x) => (x.email || "").toLowerCase() === email);
      if (u && !u.revoked && u.hash && passwordMatches(pw, u.salt, u.hash)) {
        res.json({ token: makeUserToken(u), user: { name: u.name, role: u.role, email: u.email, pages: u.pages || null } });
        return;
      }
    }
    res.status(401).json({ error: "Wrong password" });
    return;
  }

  // ── TikTok OAuth (Content Posting API) ───────────────────────────────────────
  // Public endpoints reached via vercel.json rewrites (/api/tiktok-auth and
  // /api/tiktok-callback) — folded in here to stay under the function cap.
  // Token lands in KV as tiktok_oauth for Publishing to use.
  if (req.method === "GET" && op === "tiktok_auth") {
    // ?sandbox=1 runs the flow against the Sandbox app (pre-review testing)
    const sandbox = req.query.sandbox === "1";
    const key = sandbox ? process.env.TIKTOK_SANDBOX_KEY : process.env.TIKTOK_CLIENT_KEY;
    if (!key) { res.status(500).json({ error: (sandbox ? "TIKTOK_SANDBOX_KEY" : "TIKTOK_CLIENT_KEY") + " is not set in Vercel env vars yet." }); return; }
    const csrf = randomBytes(16).toString("hex");
    await kvSet("tiktok_csrf", { v: csrf, sandbox, t: Date.now() });
    const params = new URLSearchParams({
      client_key: key,
      response_type: "code",
      scope: "user.info.basic,video.publish,video.upload",
      redirect_uri: "https://lavalle-haus-os.vercel.app/api/tiktok-callback",
      state: csrf,
    });
    res.writeHead(302, { Location: "https://www.tiktok.com/v2/auth/authorize/?" + params.toString() });
    res.end();
    return;
  }
  if (req.method === "GET" && op === "tiktok_callback") {
    const page = (msg, ok) => '<!doctype html><html><body style="font-family:Georgia,serif;background:#FFFFFF;color:#1A1A1A;display:flex;align-items:center;justify-content:center;height:96vh"><div style="text-align:center;max-width:440px"><div style="font-family:Jost,Helvetica,Arial,sans-serif;letter-spacing:4px;font-size:11px;color:#8F8676">LAVALLE HAUS OS</div><h2 style="font-weight:400">' + (ok ? "TikTok connected." : "TikTok connection failed") + '</h2><p style="color:#71716C;line-height:1.7">' + msg + "</p></div></body></html>";
    try {
      if (req.query.error) { res.status(400).send(page(String(req.query.error_description || req.query.error), false)); return; }
      const saved = (await kvGet("tiktok_csrf")) || {};
      if (!req.query.state || req.query.state !== saved.v) { res.status(400).send(page("Security check failed — start again from /api/tiktok-auth.", false)); return; }
      const sandbox = !!saved.sandbox;
      const r = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: (sandbox ? process.env.TIKTOK_SANDBOX_KEY : process.env.TIKTOK_CLIENT_KEY) || "",
          client_secret: (sandbox ? process.env.TIKTOK_SANDBOX_SECRET : process.env.TIKTOK_CLIENT_SECRET) || "",
          code: req.query.code || "",
          grant_type: "authorization_code",
          redirect_uri: "https://lavalle-haus-os.vercel.app/api/tiktok-callback",
        }),
      });
      const d = await r.json();
      if (!d.access_token) { res.status(400).send(page("Token exchange failed: " + JSON.stringify(d).slice(0, 250), false)); return; }
      await kvSet(sandbox ? "tiktok_oauth_sandbox" : "tiktok_oauth", {
        access_token: d.access_token, refresh_token: d.refresh_token,
        open_id: d.open_id, scope: d.scope, sandbox,
        expires_in: d.expires_in, refresh_expires_in: d.refresh_expires_in,
        savedAt: new Date().toISOString(),
      });
      res.send(page((sandbox ? "Sandbox connection complete — the test account is linked for the review demo." : "The TikTok account is linked and the token is stored. Publishing can post once TikTok approves the app's audit.") + " You can close this tab.", true));
    } catch (e) {
      res.status(500).send(page(String(e).slice(0, 200), false));
    }
    return;
  }

  // Invite details: lets the accept screen greet the person by name.
  if (req.method === "GET" && op === "invite_info") {
    const t = (req.query.invite || "").trim();
    const users = (await kvGet("lavalle_users")) || [];
    const u = users.find((x) => x.inviteToken && x.inviteToken === t && !x.revoked);
    if (!u || (u.inviteExp && Date.now() > u.inviteExp)) { res.status(404).json({ error: "This invite link is no longer valid. Ask for a new one." }); return; }
    res.json({ name: u.name, email: u.email, role: u.role });
    return;
  }

  // Accept an invite: set a personal password, get a session token.
  if (req.method === "POST" && op === "accept") {
    const b = req.body || {};
    const t = (b.invite || "").trim();
    const pw = b.password || "";
    if (pw.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters." }); return; }
    const users = (await kvGet("lavalle_users")) || [];
    const u = users.find((x) => x.inviteToken && x.inviteToken === t && !x.revoked);
    if (!u || (u.inviteExp && Date.now() > u.inviteExp)) { res.status(404).json({ error: "This invite link is no longer valid. Ask for a new one." }); return; }
    u.salt = randomBytes(16).toString("hex");
    u.hash = hashPassword(pw, u.salt);
    u.inviteToken = null;
    u.inviteExp = null;
    u.acceptedAt = new Date().toISOString();
    await kvSet("lavalle_users", users);
    res.json({ token: makeUserToken(u), user: { name: u.name, role: u.role, email: u.email, pages: u.pages || null } });
    return;
  }

  const auth = await getAuth(req);
  if (!auth) { res.status(401).json({ error: "Locked" }); return; }

  // Who am I — restores name/role on the client after a reload.
  if (req.method === "GET" && op === "me") {
    res.json({ name: auth.name, role: auth.role, email: auth.email, pages: auth.pages || null });
    return;
  }

  // ── TikTok connection status + sandbox test post (owner-only) ───────────────
  if (op === "tiktok_status" && req.method === "GET") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Only the owner can view TikTok connection status." }); return; }
    const fmt = (t) => (t && t.access_token ? { connected: true, open_id: t.open_id, scope: t.scope, savedAt: t.savedAt } : { connected: false });
    res.json({ sandbox: fmt(await kvGet("tiktok_oauth_sandbox")), production: fmt(await kvGet("tiktok_oauth")) });
    return;
  }
  if (op === "tiktok_test_post" && req.method === "POST") {
    // Sends a draft to the sandbox account's TikTok inbox via the Content
    // Posting API (video.upload scope) — used for the app-review demo.
    if (!ownerRole(auth)) { res.status(403).json({ error: "Only the owner can post to TikTok." }); return; }
    const tok = await kvGet("tiktok_oauth_sandbox");
    if (!tok || !tok.access_token) { res.status(400).json({ error: "No sandbox token yet — run /api/tiktok-auth?sandbox=1 first." }); return; }
    const b = req.body || {};
    if (b.check) {
      const r = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
        method: "POST",
        headers: { Authorization: "Bearer " + tok.access_token, "Content-Type": "application/json" },
        body: JSON.stringify({ publish_id: b.check }),
      });
      res.status(r.status).json(await r.json());
      return;
    }
    // FILE_UPLOAD (not PULL_FROM_URL): the sandbox app has no verified URL
    // properties of its own, so we stream the bytes up ourselves.
    const vid = await fetch(b.video_url || "https://lavalle-haus-os.vercel.app/tiktok-sample.mp4");
    if (!vid.ok) { res.status(400).json({ error: "Could not fetch the sample video (" + vid.status + ")." }); return; }
    const buf = Buffer.from(await vid.arrayBuffer());
    const init = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
      method: "POST",
      headers: { Authorization: "Bearer " + tok.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ source_info: { source: "FILE_UPLOAD", video_size: buf.length, chunk_size: buf.length, total_chunk_count: 1 } }),
    });
    const initD = await init.json();
    const uploadUrl = initD.data && initD.data.upload_url;
    if (!uploadUrl) { res.status(init.status).json(initD); return; }
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-" + (buf.length - 1) + "/" + buf.length },
      body: buf,
    });
    res.json({ data: { publish_id: initD.data.publish_id, upload_status: put.status } });
    return;
  }

  // ── Team access (owner-only ops) ─────────────────────────────────────────────
  if (op === "invite" || op === "revoke" || op === "users" || op === "set_pages" || op === "set_role") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Only the owner can manage team access." }); return; }
    const users = (await kvGet("lavalle_users")) || [];

    if (req.method === "GET" && op === "users") {
      res.json({ users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, invitedAt: u.invitedAt || null, acceptedAt: u.acceptedAt || null, pages: u.pages || null, revoked: !!u.revoked, inviteExpired: !!(u.inviteToken && u.inviteExp && Date.now() > u.inviteExp) })) });
      return;
    }

    if (req.method === "POST" && op === "invite") {
      const b = req.body || {};
      const name = (b.name || "").trim();
      const email = (b.email || "").trim().toLowerCase();
      const role = ["Owner / Admin", "Manager", "Team Member", "Viewer"].includes(b.role) ? b.role : "Team Member";
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { res.status(400).json({ error: "A name and a valid email are required." }); return; }
      let u = users.find((x) => (x.email || "").toLowerCase() === email);
      if (!u) { u = { id: "usr_" + randomBytes(8).toString("hex") }; users.push(u); }
      u.name = name; u.email = email; u.role = role;
      if (b.pages !== undefined) u.pages = cleanPages(b.pages);
      u.revoked = false;
      u.inviteToken = randomBytes(24).toString("hex");
      u.inviteExp = Date.now() + 14 * 86400000;
      u.invitedAt = new Date().toISOString();
      await kvSet("lavalle_users", users);
      const host = req.headers["x-forwarded-host"] || req.headers.host || "";
      const link = "https://" + host + "/?invite=" + u.inviteToken;
      let sent = false, sendError = null;
      const apiKey = process.env.RESEND_API_KEY;
      if (apiKey) {
        const from = process.env.RESEND_FROM || "Lavalle Haus OS <onboarding@resend.dev>";
        const html =
          '<div style="font-family:Georgia,serif;color:#1a1714;max-width:560px">' +
            '<p style="font-size:11px;letter-spacing:2px;color:#a07848;text-transform:uppercase">Lavalle Haus OS</p>' +
            '<h2 style="font-weight:400;margin:6px 0">You&rsquo;re invited, ' + name.replace(/[&<>"]/g, "") + '.</h2>' +
            '<p style="line-height:1.6">You now have your own access to the Lavalle Haus operating system as <b>' + role + '</b>. Open the private link below and choose your password &mdash; the link is yours alone and expires in 14 days.</p>' +
            '<p style="margin:22px 0"><a href="' + link + '" style="background:#1a1714;color:#ffffff;text-decoration:none;padding:12px 26px;font-size:12px;letter-spacing:2px;text-transform:uppercase">Set your password</a></p>' +
            '<p style="font-size:12px;color:#8c7d6b;line-height:1.5">If the button doesn&rsquo;t work, copy this link:<br/>' + link + '</p>' +
            '<hr style="border:none;border-top:1px solid #c8c2b8;margin:14px 0"/>' +
            '<p style="font-size:12px;color:#8c7d6b">Sent from Lavalle Haus OS</p>' +
          '</div>';
        try { await sendResendEmail({ apiKey, from, to: email, subject: "Your access to Lavalle Haus OS", html }); sent = true; }
        catch (e) { sendError = String(e).slice(0, 200); }
      } else { sendError = "RESEND_API_KEY not set"; }
      res.json({ ok: true, sent, sendError, link, user: { id: u.id, name, email, role } });
      return;
    }

    // Role edits on the roster reach the live login (getAuth reads the store
    // per request, so this applies on the member's next page load).
    if (req.method === "POST" && op === "set_role") {
      const b = req.body || {};
      const u = users.find((x) => x.id === b.id);
      if (!u) { res.status(404).json({ error: "No such user." }); return; }
      if (!["Owner / Admin", "Manager", "Team Member", "Viewer"].includes(b.role)) { res.status(400).json({ error: "Unknown role." }); return; }
      u.role = b.role;
      await kvSet("lavalle_users", users);
      res.json({ ok: true });
      return;
    }

    // Per-person pages: exactly these tabs for this user; null = role default.
    if (req.method === "POST" && op === "set_pages") {
      const b = req.body || {};
      const u = users.find((x) => x.id === b.id);
      if (!u) { res.status(404).json({ error: "No such user." }); return; }
      u.pages = cleanPages(b.pages);
      await kvSet("lavalle_users", users);
      res.json({ ok: true, pages: u.pages });
      return;
    }

    if (req.method === "POST" && op === "revoke") {
      const id = (req.body || {}).id;
      const u = users.find((x) => x.id === id);
      if (!u) { res.status(404).json({ error: "No such user." }); return; }
      u.revoked = true; u.hash = null; u.salt = null; u.inviteToken = null; u.inviteExp = null;
      await kvSet("lavalle_users", users);
      res.json({ ok: true });
      return;
    }
  }

  // ── Drive folder listing (Grid planner sync) ────────────────────────────────
  // Lists image files in a Drive folder using the stored Google OAuth token.
  // Needs the drive.readonly scope — if Google was connected before that scope
  // was added, the query legally succeeds but only sees app-created files, so
  // the UI treats an empty result as "reconnect Google".
  if (op === "drive_list" && req.method === "POST") {
    const folderId = ((req.body || {}).folderId || "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!folderId) { res.status(400).json({ error: "No folder id." }); return; }
    const gstate = (await kvGet("google_oauth")) || {};
    if (!gstate.refresh_token) { res.status(400).json({ error: "google_not_connected" }); return; }
    try {
      const tr = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", refresh_token: gstate.refresh_token, grant_type: "refresh_token" }),
      });
      const td = await tr.json();
      if (!td.access_token) { res.status(400).json({ error: "google_token_failed" }); return; }
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const fr = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { Authorization: "Bearer " + td.access_token } });
      const fd = await fr.json();
      if (!fr.ok) { res.status(400).json({ error: (fd.error && fd.error.message) || "drive_error" }); return; }
      res.json({ files: (fd.files || []).filter((f) => (f.mimeType || "").startsWith("image/")).map((f) => ({ id: f.id, name: f.name })) });
    } catch (e) {
      res.status(500).json({ error: String(e).slice(0, 200) });
    }
    return;
  }

  // ── Plaid ops (bank balances → cash runway) — owner-only financials ─────────
  if (PLAID_OPS.includes(op)) {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Bank data is only available to the owner." }); return; }
    if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
      res.status(400).json({ error: "Plaid credentials not set in Vercel (PLAID_CLIENT_ID, PLAID_SECRET)." });
      return;
    }
    try {
      if (op === "link_token") {
        const body = {
          user: { client_user_id: "lavalle-haus" },
          client_name: "Lavalle Haus OS",
          products: ["transactions"],
          country_codes: ["US"],
          language: "en",
        };
        if (PLAID_REDIRECT_URI) body.redirect_uri = PLAID_REDIRECT_URI;
        const d = await plaid("/link/token/create", body);
        res.status(200).json({ link_token: d.link_token });
        return;
      }
      if (op === "exchange") {
        const { public_token, institution } = req.body || {};
        if (!public_token) { res.status(400).json({ error: "Missing public_token" }); return; }
        const d = await plaid("/item/public_token/exchange", { public_token });
        const items = (await kvGet("plaid_items")) || [];
        if (!items.some((x) => x.item_id === d.item_id)) {
          items.push({ item_id: d.item_id, access_token: d.access_token, institution: institution || "Bank", addedAt: new Date().toISOString() });
        }
        await kvSet("plaid_items", items.slice(-10));
        res.status(200).json({ ok: true, item_id: d.item_id });
        return;
      }
      if (op === "balances") {
        const items = (await kvGet("plaid_items")) || [];
        const accounts = [];
        let totalCash = 0;
        for (const it of items) {
          try {
            const d = await plaid("/accounts/balance/get", { access_token: it.access_token });
            for (const a of d.accounts || []) {
              const bal = (a.balances && (a.balances.available != null ? a.balances.available : a.balances.current)) || 0;
              if (a.type === "depository") totalCash += Number(bal) || 0;
              accounts.push({
                item_id: it.item_id, institution: it.institution,
                name: a.name, mask: a.mask || null, type: a.type, subtype: a.subtype,
                available: a.balances ? a.balances.available : null,
                current: a.balances ? a.balances.current : null,
                currency: a.balances ? a.balances.iso_currency_code : "USD",
              });
            }
          } catch (e) {
            accounts.push({ item_id: it.item_id, institution: it.institution, error: String(e).slice(0, 160) });
          }
        }
        res.status(200).json({ connected: items.length > 0, accounts, totalCash, updatedAt: new Date().toISOString() });
        return;
      }
      if (op === "transactions") {
        const items = (await kvGet("plaid_items")) || [];
        if (!items.length) { res.status(200).json({ connected: false, transactions: [] }); return; }
        const all = [];
        for (const it of items) {
          try {
            let cursor = null, has_more = true, pages = 0;
            while (has_more && pages < 5) {
              const d = await plaid("/transactions/sync", { access_token: it.access_token, cursor: cursor || undefined, count: 100 });
              (d.added || []).forEach((t) => all.push(t));
              cursor = d.next_cursor; has_more = d.has_more; pages += 1;
            }
          } catch (e) {
            if (String(e).indexOf("PRODUCT_NOT_READY") >= 0) { res.status(200).json({ connected: true, pending: true, message: "Your bank is still preparing transactions. Try again in a minute." }); return; }
          }
        }
        const mapped = all.map((t) => ({
          id: "plaid_" + t.transaction_id,
          date: t.date,
          description: t.name || "",
          merchant: t.merchant_name || t.name || "",
          amount: Math.abs(Number(t.amount) || 0),
          type: (Number(t.amount) || 0) >= 0 ? "expense" : "income",
          plaidCategory: (t.personal_finance_category && t.personal_finance_category.primary) || "",
        })).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 200);
        res.status(200).json({ connected: true, transactions: mapped, count: mapped.length });
        return;
      }
      if (op === "items") {
        const items = (await kvGet("plaid_items")) || [];
        res.status(200).json({ items: items.map((i) => ({ item_id: i.item_id, institution: i.institution, addedAt: i.addedAt })) });
        return;
      }
      if (op === "remove") {
        const { item_id } = req.body || {};
        const items = (await kvGet("plaid_items")) || [];
        const it = items.find((x) => x.item_id === item_id);
        if (it) { try { await plaid("/item/remove", { access_token: it.access_token }); } catch (e) { /* drop locally anyway */ } }
        await kvSet("plaid_items", items.filter((x) => x.item_id !== item_id));
        res.status(200).json({ ok: true });
        return;
      }
    } catch (e) {
      res.status(500).json({ error: String(e).slice(0, 400) });
    }
    return;
  }

  // ── Email notify (Resend) — sends an action-item notification to an assignee ──
  if (op === "notify" && req.method === "POST") {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) { res.status(400).json({ error: "RESEND_API_KEY is not set in Vercel (Project Settings -> Environment Variables)." }); return; }
    const b = req.body || {};
    if (!b.to) { res.status(400).json({ error: "No recipient email." }); return; }
    const esc = (x) => String(x == null ? "" : x).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
    const from = process.env.RESEND_FROM || "Lavalle Haus OS <onboarding@resend.dev>";
    const sev = String(b.severity || "").toUpperCase();
    const subject = b.subject || ("Action item: " + (b.itemTitle || ""));
    const html =
      '<div style="font-family:Georgia,serif;color:#1a1714;max-width:560px">' +
        '<p style="font-size:11px;letter-spacing:2px;color:#a07848;text-transform:uppercase">Lavalle Haus OS &middot; Action Item</p>' +
        '<h2 style="font-weight:400;margin:6px 0">' + esc(b.itemTitle) + '</h2>' +
        (b.itemDetail ? '<p style="line-height:1.5">' + esc(b.itemDetail) + '</p>' : '') +
        (b.productName ? '<p style="color:#8c7d6b;margin:4px 0"><b>Product:</b> ' + esc(b.productName) + '</p>' : '') +
        (sev ? '<p style="color:#8c7d6b;margin:4px 0"><b>Urgency:</b> ' + sev + '</p>' : '') +
        (b.assignedBy ? '<p style="color:#8c7d6b;margin:4px 0">Assigned by ' + esc(b.assignedBy) + '</p>' : '') +
        '<hr style="border:none;border-top:1px solid #c8c2b8;margin:14px 0"/>' +
        '<p style="font-size:12px;color:#8c7d6b">Sent from Lavalle Haus OS</p>' +
      '</div>';
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [b.to], subject, html }),
      });
      const text = await r.text();
      if (!r.ok) { res.status(502).json({ error: "Resend " + r.status + ": " + text.slice(0, 300) }); return; }
      let id = null; try { id = JSON.parse(text).id; } catch (e) {}
      res.json({ sent: true, id });
    } catch (e) {
      res.status(500).json({ error: String(e).slice(0, 300) });
    }
    return;
  }

  // ── App data store (unchanged) ───────────────────────────────────────────────
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (req.method === "GET") {
    const r = await fetch(`${url}/get/lavalle_data`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const d = await r.json();
    let data = d.result ? JSON.parse(d.result) : null;
    // Fix: if data is an array (old bug), unwrap it
    if (Array.isArray(data)) data = data[0];
    res.json(data || { products: [], materials: [], weekly: [] });
  } else if (req.method === "POST") {
    const body = req.body;
    await fetch(`${url}/set/lavalle_data`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    res.json({ ok: true });
  }
}
