// api/drive-upload.js — Lavalle Haus OS
// GET  -> { connected, folderId }   (status check for the UI)
// POST { pdfBase64, filename } -> { link, id, folderId }
//
// Uses the stored Google refresh token to get a fresh access token, ensures a
// dedicated "Lavalle Haus — Statements" folder exists (creating it once and
// remembering its id), uploads the PDF into it, and returns the file's
// webViewLink so the app can bookmark it. drive.file scope means this app can
// only ever see/manage the files and folder it created — nothing else in Drive.
//
// Needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, KV_REST_API_URL, KV_REST_API_TOKEN.

import { createHmac } from "node:crypto";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KEY = "google_oauth";
const FOLDER_NAME = "Lavalle Haus — Statements";

// ── APP LOCK ── same session check as /api/data: uploads land in the business
// Drive folder, so only a logged-in session may use this. No APP_PASSWORD = off.
const SESSION_SALT = "lavalle-haus-session-v1";
function appToken() {
  return createHmac("sha256", process.env.APP_PASSWORD || "").update(SESSION_SALT).digest("hex");
}
function isAuthed(req) {
  if (!process.env.APP_PASSWORD) return true;
  return (req.headers["x-app-token"] || "") === appToken();
}

async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${key}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}
async function kvSet(key, val) {
  await fetch(`${KV_URL}/set/${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "text/plain" },
    body: JSON.stringify(val),
  });
}

async function getAccessToken(refreshToken) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Token refresh failed: " + JSON.stringify(j));
  return j.access_token;
}

async function ensureFolder(access, state) {
  if (state.folderId) return state.folderId;
  const r = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Folder create failed: " + JSON.stringify(j));
  state.folderId = j.id;
  await kvSet(KEY, state);
  return j.id;
}

export default async function handler(req, res) {
  if (!isAuthed(req)) { res.status(401).json({ error: "Locked" }); return; }
  const state = (await kvGet(KEY)) || {};

  if (req.method === "GET") {
    res.status(200).json({ connected: !!state.refresh_token, folderId: state.folderId || null });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!state.refresh_token) { res.status(400).json({ error: "not_connected" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const pdfBase64 = body && body.pdfBase64;
  const filename = (body && body.filename) || `statement-${Date.now()}.pdf`;
  if (!pdfBase64) { res.status(400).json({ error: "No PDF provided." }); return; }

  try {
    const access = await getAccessToken(state.refresh_token);
    const folderId = await ensureFolder(access, state);

    const boundary = "lavalle" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: filename, parents: [folderId] });
    const pre =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
    const post = `\r\n--${boundary}--`;
    const pdfBuf = Buffer.from(pdfBase64, "base64");
    const multipart = Buffer.concat([Buffer.from(pre, "utf8"), pdfBuf, Buffer.from(post, "utf8")]);

    const up = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipart,
      }
    );
    const file = await up.json();
    if (!up.ok) throw new Error("Upload failed: " + JSON.stringify(file));

    res.status(200).json({ link: file.webViewLink, id: file.id, folderId });
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
}
