import { createHmac, createHash, scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";

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
  const body = Buffer.from(JSON.stringify({ u: user.id, n: user.name, r: user.role, e: Date.now() + 365 * 86400000 })).toString("base64url");
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
async function getAuthEarly(req) { return getAuth(req); }
async function getAuth(req) {
  if (!process.env.APP_PASSWORD) return { role: "Owner / Admin", name: "", email: "", userId: null, house: true };
  const tok = req.headers["x-app-token"] || "";
  if (tok === appToken()) return { role: "Owner / Admin", name: "", email: "", userId: null, house: true };
  const p = verifyUserToken(tok);
  if (!p) return null;
  const users = (await kvGet("lavalle_users")) || [];
  const u = users.find((x) => x.id === p.u);
  if (!u || u.revoked || !u.hash) return null;
  return { role: u.role, name: u.name, email: u.email, userId: u.id, house: false, pages: u.pages || null, denySegs: u.denySegs || null };
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

// TikTok tokens: KV holds {open_id: token} per environment. Early builds stored
// a single token object at the top level — migrate that shape on read.
const tiktokAccounts = (v) => (!v ? {} : v.access_token ? { [v.open_id]: v } : v);
// Instagram tokens: same shape, keyed by user_id.
const igAccounts = (v) => (!v ? {} : v.access_token ? { [v.user_id]: v } : v);

// ── Instagram content publishing ─────────────────────────────────────────────
// Two-step Graph flow: create a media container, wait for it to process, then
// publish it. Returns {ok, mediaId} or {ok:false, error}.
const APP_ORIGIN = "https://lavalle-haus-os.vercel.app";

// Each destination wants a different shape, and handing over the wrong one gets
// the photo letterboxed with black bars:
//   igfeed   → Instagram feed. 4:5 is the tallest it allows and 1.91:1 the
//              widest; anything outside gets centre-cropped back into range.
//   vertical → full-screen 9:16 for a Reel cover or a TikTok post.
// Anything else passes the original bytes straight through.
async function fitImage(buf, ctype, mode) {
  const m = String(mode || "");
  if (m !== "igfeed" && m !== "vertical") return { buf, ctype };
  try {
    const Jimp = (await import("jimp")).default;
    const img = await Jimp.read(buf);
    const ar = img.getWidth() / img.getHeight();
    if (m === "vertical") img.cover(1080, 1920);
    else if (ar < 0.8) img.cover(1080, 1350);
    else if (ar > 1.91) img.cover(1080, Math.round(1080 / 1.91));
    else if (img.getWidth() > 1080) img.resize(1080, Jimp.AUTO);
    // ALWAYS re-encode to a bounded 1080px JPEG. An in-range photo used to be
    // passed through untouched, which meant a full-size Drive original — one of
    // The Fold's covers came out at 8.4MB — and Instagram rejects anything over
    // 8MB, so the post silently never went out. 1080 is all Instagram serves.
    img.quality(88);
    return { buf: await img.getBufferAsync(Jimp.MIME_JPEG), ctype: "image/jpeg" };
  } catch {
    return { buf, ctype }; // never fail a post over a resize
  }
}

// A card's cover can be a Drive reference, a Drive share link, or an inline
// data: copy saved into the board blob. Those inline copies are downscaled,
// re-compressed JPEGs — posting them is what made feed photos look soft. So the
// ORIGINAL file in Drive always wins: full-resolution bytes streamed through
// our own Google token, with igfeed cropping done server-side. card.coverUrl
// (the "Open cover photo in Drive" target) is a valid source too, which is how
// a card with a blurry inline cover still posts sharp.
function driveIdFrom(s) {
  if (typeof s !== "string" || s.startsWith("data:")) return null;
  if (s.includes("/folders/")) return null; // a folder of slides is not a photo
  // Media-store refs carry an id= too — but it's OUR id, not Drive's. Treating
  // it as a Drive file built a URL to a nonexistent file, so Instagram fetched
  // a 404 page as the "cover" and errored every Lavalle Sisters reel.
  if (s.includes("op=media") || s.includes("/cover/")) return null;
  const m = s.match(/[?&]id=([-\w]{20,})/) || s.match(/\/d\/([-\w]{20,})/)
    || (s.includes("drive.google.com") ? s.match(/([-\w]{25,})/) : null);
  return m ? m[1] : null;
}
// /boards-media/*.jpg are 300px board previews — fine for a card tile, far below
// Instagram's 1080px. Never let one of these be what actually gets posted.
const isLowResPreview = (u) => typeof u === "string" && u.includes("/boards-media/");
// fit: "igfeed" for a feed photo or carousel slide, "vertical" for a Reel cover
// (9:16). A card can be a carousel on Instagram and a video on TikTok, so the
// shape is decided by what's being posted, not by the card.
function cardCoverUrl(card, bKey, fit = "igfeed") {
  // assetUrl is deliberately NOT consulted: on a [reel] card it points at the
  // .mov, and handing Instagram a video as a photo fails the post.
  const id = driveIdFrom(card.cover) || driveIdFrom(card.coverUrl);
  if (id) return APP_ORIGIN + "/api/data?op=drive_img&id=" + id + "&fit=" + fit;
  if (typeof card.cover === "string") {
    if (card.cover.startsWith("data:")) return APP_ORIGIN + "/api/data?op=card_media&board=" + encodeURIComponent(bKey) + "&card=" + encodeURIComponent(card.id);
    // Media-store and drive_img refs both understand ?fit=; anything else is
    // left alone so a plain static file isn't handed a parameter it ignores.
    if (card.cover.startsWith("/")) {
      const shapeable = card.cover.includes("op=drive_img") || card.cover.includes("op=media");
      return APP_ORIGIN + card.cover + (shapeable ? "&fit=" + fit : "");
    }
    if (card.cover.startsWith("http")) return card.cover;
  }
  return null;
}

async function igPublishPhoto(tok, imageUrl, caption) {
  const base = "https://graph.instagram.com/v23.0";
  const create = await fetch(`${base}/${tok.user_id}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ image_url: imageUrl, caption: caption || "", access_token: tok.access_token }),
  });
  const cd = await create.json();
  if (!cd.id) return { ok: false, error: "container: " + JSON.stringify(cd.error || cd).slice(0, 220) };
  for (let i = 0; i < 10; i++) {
    const s = await (await fetch(`${base}/${cd.id}?fields=status_code&access_token=${encodeURIComponent(tok.access_token)}`)).json();
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR") return { ok: false, error: "processing failed — check the image URL is public JPEG" };
    await new Promise((z) => setTimeout(z, 2000));
  }
  const pub = await fetch(`${base}/${tok.user_id}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: cd.id, access_token: tok.access_token }),
  });
  const pd = await pub.json();
  if (!pd.id) return { ok: false, error: "publish: " + JSON.stringify(pd.error || pd).slice(0, 220) };
  return { ok: true, mediaId: pd.id };
}

// Publish a Reel. Video processing is async, so this creates the container (or
// reuses one from a prior run via `existingContainer`), polls up to ~40s within
// the 60s function budget, then publishes. If it's still processing when the
// budget runs out, it returns { pending, containerId } so a later sweep finishes
// it — no re-upload, no double post. The video is served publicly by drive_video.

// Instagram fetches cover_url itself and errors the whole Reel container if that
// fetch is slow or unhappy. Our cover endpoint re-reads Drive and re-crops on
// every hit (~2-3s), so bake it ONCE into the media store and hand Instagram a
// static URL it can pull instantly. Keyed by source, so it's baked one time.
async function bakeCover(sourceUrl) {
  if (!sourceUrl) return null;
  try {
    const key = "bakedcover_" + createHash("sha1").update(sourceUrl).digest("hex").slice(0, 24);
    const existing = await kvGet(key);
    if (existing && existing.url) {
      // Covers baked before the clean-path fix are cached with the old
      // query-string URL — the very thing Meta rejects. Upgrade in place.
      const old = existing.url.match(/op=media&id=([A-Za-z0-9_-]+)/);
      if (old) {
        const upgraded = APP_ORIGIN + "/cover/" + old[1] + ".jpg";
        await kvSet(key, { url: upgraded, at: new Date().toISOString() });
        return upgraded;
      }
      return existing.url;
    }
    const r = await fetch(sourceUrl);
    if (!r.ok) return sourceUrl;
    const buf = Buffer.from(await r.arrayBuffer());
    const id = "m" + randomBytes(10).toString("hex");
    await kvSet("media_" + id, { type: "image/jpeg", b64: buf.toString("base64"), at: new Date().toISOString() });
    // Hand Instagram a clean ".jpg" path, not a query string. A cover_url of
    // /api/data?op=media&id=... made Meta reject EVERY Reel container with a
    // bare "ERROR"; the identical image at /cover/<id>.jpg is accepted.
    const url = APP_ORIGIN + "/cover/" + id + ".jpg";
    await kvSet(key, { url, at: new Date().toISOString() });
    // Warm the CDN so Meta's impatient fetcher gets an edge-cached answer in
    // milliseconds, not a 2s cold serverless render. The media op serves
    // immutable cache headers, so two fetches pin it at the edge.
    try { await fetch(url); await fetch(url); } catch {}
    return url;
  } catch { return sourceUrl; }
}

async function igPublishReel(tok, videoUrl, caption, existingContainer, coverUrl) {
  const base = "https://graph.instagram.com/v23.0";
  let cid = existingContainer;
  if (!cid) {
    const params = { media_type: "REELS", video_url: videoUrl, caption: caption || "", share_to_feed: "true", access_token: tok.access_token };
    if (coverUrl) params.cover_url = coverUrl; // use the card's assigned cover photo as the Reel cover
    const create = await fetch(`${base}/${tok.user_id}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    const cd = await create.json();
    if (!cd.id) return { ok: false, error: "container: " + JSON.stringify(cd.error || cd).slice(0, 220) };
    cid = cd.id;
  }
  // Poll BRIEFLY, then hand back `pending` with the container id so a later
  // sweep can resume it. This used to wait ~40s inside one request; for a big
  // Reel that outran the function's own time limit, so it died before saving the
  // container id — and because it never returned, the publish lock was never
  // released either. Every retry then hit the lock and the post never went out.
  let status = "";
  for (let i = 0; i < 4; i++) {
    // ask for `status` as well: status_code is just ERROR, while `status`
    // carries Instagram's actual reason (bad cover_url, download failed, …)
    const s = await (await fetch(`${base}/${cid}?fields=status_code,status&access_token=${encodeURIComponent(tok.access_token)}`)).json();
    status = s.status_code;
    if (status === "FINISHED") break;
    if (status === "ERROR" || status === "EXPIRED") return { ok: false, error: "Instagram rejected the video (" + status + "): " + String(s.status || "no detail given").slice(0, 300) };
    if (i < 3) await new Promise((z) => setTimeout(z, 2500));
  }
  if (status !== "FINISHED") return { ok: false, pending: true, containerId: cid };
  const pub = await fetch(`${base}/${tok.user_id}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: cid, access_token: tok.access_token }),
  });
  const pd = await pub.json();
  if (!pd.id) return { ok: false, error: "publish: " + JSON.stringify(pd.error || pd).slice(0, 220) };
  return { ok: true, mediaId: pd.id };
}

// Publish a Carousel: one child container per slide image, then a parent CAROUSEL
// container, then publish. Instagram uses the first slide as the grid cover.
// Images are small so this completes in one pass (no async sweeps needed).
async function igPublishCarousel(tok, imageUrls, caption) {
  const base = "https://graph.instagram.com/v23.0";
  const children = [];
  for (const url of imageUrls) {
    const cr = await fetch(`${base}/${tok.user_id}/media`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ image_url: url, is_carousel_item: "true", access_token: tok.access_token }),
    });
    const cd = await cr.json();
    if (!cd.id) return { ok: false, error: "carousel slide: " + JSON.stringify(cd.error || cd).slice(0, 180) };
    children.push(cd.id);
  }
  const pr = await fetch(`${base}/${tok.user_id}/media`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ media_type: "CAROUSEL", children: children.join(","), caption: caption || "", access_token: tok.access_token }),
  });
  const pd = await pr.json();
  if (!pd.id) return { ok: false, error: "carousel container: " + JSON.stringify(pd.error || pd).slice(0, 180) };
  for (let i = 0; i < 12; i++) {
    const s = await (await fetch(`${base}/${pd.id}?fields=status_code&access_token=${encodeURIComponent(tok.access_token)}`)).json();
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR") return { ok: false, error: "carousel processing ERROR" };
    await new Promise((z) => setTimeout(z, 2000));
  }
  const pub = await fetch(`${base}/${tok.user_id}/media_publish`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: pd.id, access_token: tok.access_token }),
  });
  const pubd = await pub.json();
  if (!pubd.id) return { ok: false, error: "carousel publish: " + JSON.stringify(pubd.error || pubd).slice(0, 180) };
  return { ok: true, mediaId: pubd.id };
}

// Transcode a video to H.264 MP4 via Cloudinary so Instagram's Reel API accepts
// it (phone .mov files are usually HEVC, which IG rejects). First call uploads
// the source (from drive_video) and kicks off the transform; later calls poll
// the derived MP4 URL. Returns { mp4Url } when ready, { converting, publicId }
// while transcoding, or { error }. publicId threads the job across sweeps.
// Mux (pay-as-you-go, no size cap). First call creates an asset from the source
// (drive_video) with an H.264 MP4 rendition; later calls poll until ready.
const MUX_ID = () => process.env.MUX_TOKEN_ID || process.env.MUXTOKENID;
const MUX_SECRET = () => process.env.MUX_TOKEN_SECRET || process.env.MUXTOKENSECRET;
async function muxConvert(sourceUrl, jobId) {
  const id = MUX_ID(), secret = MUX_SECRET();
  if (!id || !secret) return { error: "Mux isn't set up yet — add MUX_TOKEN_ID / MUX_TOKEN_SECRET in Vercel" };
  const auth = "Basic " + Buffer.from(id + ":" + secret).toString("base64");
  if (!jobId) {
    const r = await fetch("https://api.mux.com/video/v1/assets", {
      method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ input: sourceUrl, playback_policy: ["public"], mp4_support: "capped-1080p" }),
    });
    const d = await r.json();
    if (!d.data || !d.data.id) return { error: "mux create: " + JSON.stringify(d.error || d).slice(0, 200) };
    return { converting: true, jobId: d.data.id };
  }
  const r = await fetch("https://api.mux.com/video/v1/assets/" + jobId, { headers: { Authorization: auth } });
  const d = await r.json();
  const a = d.data;
  if (!a) return { error: "mux: asset not found" };
  if (a.status === "errored") return { error: "mux processing errored — " + JSON.stringify(a.errors || {}).slice(0, 140) };
  if (a.status !== "ready") return { converting: true, jobId };
  const pb = (a.playback_ids || []).find((x) => x.policy === "public") || (a.playback_ids || [])[0];
  if (!pb) return { converting: true, jobId };
  const mp4Url = "https://stream.mux.com/" + pb.id + "/capped-1080p.mp4"; // static rendition; 404s until ready
  const h = await fetch(mp4Url, { headers: { Range: "bytes=0-1" } });
  if (h.ok || h.status === 206) return { mp4Url, jobId };
  return { converting: true, jobId };
}
async function muxDelete(jobId) {
  const id = MUX_ID(), secret = MUX_SECRET();
  if (!id || !secret || !jobId) return;
  try { await fetch("https://api.mux.com/video/v1/assets/" + jobId, { method: "DELETE", headers: { Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64") } }); } catch {}
}
// Cloudinary alternate (free tier, ~100MB video cap).
async function cloudinaryConvert(sourceUrl, jobId) {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME, key = process.env.CLOUDINARY_API_KEY, secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) return { error: "Cloudinary isn't set up" };
  const xform = "vc_h264,ac_aac,f_mp4";
  const derivedUrl = (pid) => `https://res.cloudinary.com/${cloud}/video/upload/${xform}/${pid}.mp4`;
  const ready = async (pid) => { const h = await fetch(derivedUrl(pid), { headers: { Range: "bytes=0-1" } }); return h.ok || h.status === 206; };
  if (jobId) {
    if (await ready(jobId)) return { mp4Url: derivedUrl(jobId), jobId };
    return { converting: true, jobId };
  }
  const ts = Math.floor(Date.now() / 1000);
  const signature = createHash("sha1").update(`timestamp=${ts}${secret}`).digest("hex");
  const r = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/video/upload`, {
    method: "POST",
    body: new URLSearchParams({ file: sourceUrl, api_key: key, timestamp: String(ts), signature }),
  });
  const d = await r.json();
  if (!d.public_id) return { error: "cloudinary: " + JSON.stringify(d.error || d).slice(0, 200) };
  if (await ready(d.public_id)) return { mp4Url: derivedUrl(d.public_id), jobId: d.public_id };
  return { converting: true, jobId: d.public_id };
}
// Pick whichever transcoder is configured (Mux preferred), else signal "none".
async function videoTranscode(sourceUrl, jobId) {
  if (MUX_ID() && MUX_SECRET()) return muxConvert(sourceUrl, jobId);
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) return cloudinaryConvert(sourceUrl, jobId);
  return { none: true };
}

// Publish every armed, due grid item (or one specific item when `only` is set).
// Mutates the lavalle_data blob in KV and returns a summary.
async function publishDueItems(only) {
  const data = (await kvGet("lavalle_data")) || null;
  const blob = Array.isArray(data) ? data[0] : data;
  if (!blob || !blob.gridPlanner) return { published: 0, failed: [], note: "no grid data" };
  const tokens = Object.values(igAccounts(await kvGet("instagram_oauth")));
  // Dedupe ledger: survives the app clobbering grid state from a stale tab, so
  // a post can never fire twice even if pub.status gets reverted client-side.
  const ledger = (await kvGet("lavalle_published")) || {};
  const now = Date.now();
  const results = { published: 0, failed: [], skipped: 0, items: [] };
  let changed = false, ledgerChanged = false;
  for (const feed of blob.gridPlanner.feeds || []) {
    const tok = tokens.find((t) => (t.username || "").toLowerCase() === (feed.account || "").toLowerCase());
    const board = blob.boards && blob.boards[feed.boardKey];
    const cards = {}; ((board && board.cards) || []).forEach((x) => { cards[x.id] = x; });
    for (const it of feed.items || []) {
      const isOnly = only && only.feedId === feed.id && only.cardId === it.cardId;
      if (only && !isOnly) continue;
      // "Post now" (only) works regardless of pub state — the client may not
      // have synced yet; the ledger below still guarantees no double-post.
      const p = it.pub || (isOnly ? { at: new Date().toISOString(), auto: false, status: "scheduled" } : null);
      if (!p || p.status !== "scheduled") continue;
      const ledgerKey = feed.id + ":" + it.cardId;
      if (ledger[ledgerKey]) {
        // Already went out in a previous run — re-mark the item, never re-post.
        it.pub = { ...p, status: "published", mediaId: ledger[ledgerKey].mediaId, publishedAt: ledger[ledgerKey].at };
        it.live = true; // once posted, drop out of the Planning grid → Live view
        results.items.push({ feedId: feed.id, cardId: it.cardId, ok: true, mediaId: ledger[ledgerKey].mediaId, publishedAt: ledger[ledgerKey].at, already: true });
        changed = true;
        continue;
      }
      if (p.status === "scheduled" && !only && (!p.auto || !p.at || new Date(p.at).getTime() > now)) { results.skipped++; continue; }
      const card = cards[it.cardId] || {};
      const fail = (error) => { it.pub = { ...p, status: "failed", error, failedAt: new Date().toISOString() }; results.failed.push({ card: card.name || it.cardId, error }); results.items.push({ feedId: feed.id, cardId: it.cardId, ok: false, error }); changed = true; };
      if (!tok) { fail("no Instagram token for @" + feed.account); continue; }
      if (/reel|video/i.test((card.name || "").match(/\[(.+?)\]/)?.[1] || "")) { fail("video/Reel posting isn't wired up yet — post this one manually"); continue; }
      const imageUrl = it.src ? "https://lavalle-haus-os.vercel.app" + it.src : "https://drive.google.com/thumbnail?id=" + it.driveId + "&sz=w2000";
      if (!(await kvClaim("claim:" + ledgerKey))) { results.skipped++; results.items.push({ boardKey: bKey, cardId: card.id, ok: false, skipped: "another publish attempt is still holding this post — try again in a minute" }); continue; } // another runner owns this post
      const r = await igPublishPhoto(tok, imageUrl, card.desc || "");
      if (r.ok) {
        const publishedAt = new Date().toISOString();
        ledger[ledgerKey] = { mediaId: r.mediaId, at: publishedAt };
        ledgerChanged = true;
        await kvSet("lavalle_published", ledger); // persist immediately — dedupe beats blob consistency
        it.pub = { ...p, status: "published", mediaId: r.mediaId, publishedAt };
        it.live = true; // once posted, drop out of the Planning grid → Live view
        card.done = true;
        results.published++;
        results.items.push({ feedId: feed.id, cardId: it.cardId, ok: true, mediaId: r.mediaId, publishedAt });
        changed = true;
      } else { await kvDel("claim:" + ledgerKey); fail(r.error); }
    }
  }
  // Board cards can publish too (card.pub, set from the card sheet) — same
  // rules as grid items, media = the card's cover photo.
  for (const [bKey, board] of Object.entries(blob.boards || {})) {
    if (bKey.startsWith("_") || !board || !board.cards) continue;
    for (const card of board.cards) {
      const isOnly = only && only.boardKey === bKey && only.cardId === card.id;
      if (only && !isOnly) continue;
      let p = card.pub || (isOnly ? { at: new Date().toISOString(), auto: false, status: "scheduled", account: only.account } : null);
      // "Post now" (isOnly) forces a fresh attempt even from a failed/old state —
      // otherwise a failed card could never be retried. Already-published stays
      // safe via the ledger check below (no double post).
      // Retrying a FAILED post starts clean — otherwise we re-poll the upload
      // Instagram already rejected and fail identically. But a post that's still
      // uploading keeps its container, or every retry restarts from zero and it
      // can never finish.
      if (isOnly && p && p.status !== "processing" && p.status !== "converting") {
        p = { ...p, status: "scheduled", error: null, ...(p.status === "failed" ? { containerId: undefined } : {}) };
      }
      if (!p || (p.status !== "scheduled" && p.status !== "processing" && p.status !== "converting")) continue;
      // Instagram is opt-in per card. A TikTok-only post (dest.ig === false) is
      // handed to Plann for TikTok and must never auto-post to Instagram.
      if (card.dest && card.dest.ig === false) { results.skipped++; continue; }
      if (isOnly && only.account) p.account = only.account;
      // Lock the posting account to the board's brand, so a Lavalle Sisters board
      // always posts to @lavallesisters, a The Fold board to @thefoldlabel, and a
      // Lavalle Haus board to @refilleryhaus — regardless of what was stored.
      {
        const bn = board.name || "";
        const brandAcct = /lavalle\s*sisters/i.test(bn) ? "lavallesisters"
          : /the\s*fold|^tf\b/i.test(bn) ? "thefoldlabel"
          : /lavalle\s*haus|refillery|^lh\b/i.test(bn) ? "refilleryhaus" : null;
        if (brandAcct) p = { ...p, account: brandAcct };
      }
      const ledgerKey = "card:" + bKey + ":" + card.id;
      if (ledger[ledgerKey]) {
        card.pub = { ...p, status: "published", mediaId: ledger[ledgerKey].mediaId, publishedAt: ledger[ledgerKey].at };
        results.items.push({ boardKey: bKey, cardId: card.id, ok: true, mediaId: ledger[ledgerKey].mediaId, publishedAt: ledger[ledgerKey].at, already: true });
        changed = true;
        continue;
      }
      if (p.status === "scheduled" && !only && (!p.auto || !p.at || new Date(p.at).getTime() > now)) { results.skipped++; continue; }
      const fail = (error) => { card.pub = { ...p, status: "failed", error, failedAt: new Date().toISOString() }; results.failed.push({ card: card.name || card.id, error }); results.items.push({ boardKey: bKey, cardId: card.id, ok: false, error }); changed = true; };
      const tok = tokens.find((t) => (t.username || "").toLowerCase() === (p.account || "").toLowerCase());
      if (!tok) { fail("no Instagram token for @" + (p.account || "?")); continue; }
      // Carousel → post the slides from the linked folder in order (IG uses slide
      // 1 as the grid cover). "IG static / TT carousel" cards stay single-image.
      const fmt = (card.name || "").match(/\[(.+?)\]/)?.[1] || "";
      if (/carousel/i.test(fmt) && !/static/i.test(fmt) && !/reel/i.test(fmt)) {
        const folderId = ((card.assetUrl || "").match(/folders\/([-\w]{20,})/) || [])[1];
        if (!folderId) { fail("no carousel folder linked — link the folder of slides to the card"); continue; }
        const token = await googleToken();
        if (!token) { fail("google_not_connected"); continue; }
        const slides = (await driveListFolder(folderId, token)).filter((f) => !f.folder)
          .sort((a, b) => ((parseInt(a.name) || 999) - (parseInt(b.name) || 999)) || a.name.localeCompare(b.name)).slice(0, 10);
        if (slides.length < 2) { fail("carousel needs at least 2 slides in the linked folder (found " + slides.length + ")"); continue; }
        const imageUrls = slides.map((f) => "https://lavalle-haus-os.vercel.app/api/data?op=drive_img&id=" + f.id + "&fit=igfeed");
        const ccap = card.desc || "";
        if (!(await kvClaim("claim:" + ledgerKey))) { results.skipped++; results.items.push({ boardKey: bKey, cardId: card.id, ok: false, skipped: "another publish attempt is still holding this post — try again in a minute" }); continue; }
        const cr = await igPublishCarousel(tok, imageUrls, ccap);
        if (cr.ok) {
          const publishedAt = new Date().toISOString();
          ledger[ledgerKey] = { mediaId: cr.mediaId, at: publishedAt };
          await kvSet("lavalle_published", ledger);
          card.pub = { ...p, status: "published", mediaId: cr.mediaId, publishedAt };
          card.done = true;
          results.published++;
          results.items.push({ boardKey: bKey, cardId: card.id, ok: true, mediaId: cr.mediaId, publishedAt });
        } else { await kvDel("claim:" + ledgerKey); fail(cr.error); }
        changed = true;
        continue;
      }
      // Reel/video → the async Reel flow (create container → wait for IG to
      // process the video → publish). The video is the card's linked .mov,
      // streamed publicly by drive_video. May span sweeps via p.containerId.
      if (/reel|video/i.test((card.name || "").match(/\[(.+?)\]/)?.[1] || "")) {
        const reelId = ((card.assetUrl || "").match(/\/d\/([-\w]{20,})/) || [])[1];
        if (!reelId) { fail("no Reel video file is linked — the card points at a folder, not a .mov; link the file first"); continue; }
        const rcap = card.desc || "";
        // Auto-convert the .mov to H.264 MP4 (Cloudinary) before Instagram — IG's
        // Reel API rejects HEVC. Skip if already converted (p.mp4Url).
        let videoUrl = p.mp4Url;
        if (!videoUrl) {
          const src = "https://lavalle-haus-os.vercel.app/api/data?op=drive_video&id=" + reelId;
          const conv = await videoTranscode(src, p.convId);
          if (conv.none) { videoUrl = src; } // no transcoder configured — post the file as-is (works when it's already H.264 MP4)
          else if (conv.error) { fail(conv.error); continue; }
          else if (conv.converting) { card.pub = { ...p, status: "converting", convId: conv.jobId }; results.items.push({ boardKey: bKey, cardId: card.id, ok: false, processing: true, converting: true }); changed = true; continue; }
          else { videoUrl = conv.mp4Url; p = { ...p, mp4Url: conv.mp4Url, convId: conv.jobId }; }
        }
        // The Reel cover = the card's assigned cover photo (else IG picks a video frame).
        // A Reel plays full-screen, so its cover is 9:16 — cropping it to the
        // feed's 4:5 left the thumbnail cut off at top and bottom.
        const coverImageUrl = (only && only.noCover) ? null : await bakeCover(cardCoverUrl(card, bKey, "vertical"));
        if (!(await kvClaim("claim:" + ledgerKey))) { results.skipped++; results.items.push({ boardKey: bKey, cardId: card.id, ok: false, skipped: "another publish attempt is still holding this post — try again in a minute" }); continue; }
        const rr = await igPublishReel(tok, videoUrl, rcap, p.containerId, coverImageUrl);
        if (rr.ok) {
          const publishedAt = new Date().toISOString();
          ledger[ledgerKey] = { mediaId: rr.mediaId, at: publishedAt };
          await kvSet("lavalle_published", ledger);
          await muxDelete(p.convId); // reel is live — drop the temp Mux asset so it doesn't accrue storage
          card.pub = { ...p, status: "published", mediaId: rr.mediaId, publishedAt, containerId: undefined, convId: undefined, mp4Url: undefined };
          card.done = true;
          results.published++;
          results.items.push({ boardKey: bKey, cardId: card.id, ok: true, mediaId: rr.mediaId, publishedAt });
        } else if (rr.pending) {
          await kvDel("claim:" + ledgerKey); // not posted yet — let the next sweep finish it
          card.pub = { ...p, status: "processing", containerId: rr.containerId };
          results.items.push({ boardKey: bKey, cardId: card.id, ok: false, processing: true, containerId: rr.containerId });
        } else { await kvDel("claim:" + ledgerKey); fail(rr.error); }
        changed = true;
        continue;
      }
      const imageUrl = cardCoverUrl(card, bKey);
      if (!imageUrl) { fail("card needs a cover photo to post"); continue; }
      // Better a visible failure she can fix than a soft 300px photo on the
      // brand's feed, which can only be undone by deleting the post.
      if (isLowResPreview(imageUrl)) { fail("cover is only a 300px board preview — link the full-size photo from Drive on this card, then re-schedule"); continue; }
      const caption = card.desc || "";
      if (!(await kvClaim("claim:" + ledgerKey))) { results.skipped++; results.items.push({ boardKey: bKey, cardId: card.id, ok: false, skipped: "another publish attempt is still holding this post — try again in a minute" }); continue; }
      const r = await igPublishPhoto(tok, imageUrl, caption);
      if (r.ok) {
        const publishedAt = new Date().toISOString();
        ledger[ledgerKey] = { mediaId: r.mediaId, at: publishedAt };
        await kvSet("lavalle_published", ledger);
        card.pub = { ...p, status: "published", mediaId: r.mediaId, publishedAt };
        card.done = true;
        results.published++;
        results.items.push({ boardKey: bKey, cardId: card.id, ok: true, mediaId: r.mediaId, publishedAt });
        changed = true;
      } else { await kvDel("claim:" + ledgerKey); fail(r.error); }
    }
  }
  if (changed) await kvSet("lavalle_data", Array.isArray(data) ? [blob] : blob);
  return results;
}
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
  const r = await fetch(`${KV_URL}/set/${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(value),
  });
  // Upstash answers 200 with {"error":"..."} when the store is full / the
  // request is too large. Surface it instead of pretending the write landed.
  let d = null; try { d = await r.json(); } catch {}
  if (!r.ok || (d && d.error)) { const msg = "kvSet " + key + " failed: " + (d && d.error ? d.error : r.status); console.error(msg); throw new Error(msg); }
}
// Atomic publish claim (SET NX): only ONE runner in the whole fleet — cron,
// app-level advancers on any number of open devices, manual "post now" — can
// win the claim for a card, killing the duplicate-post race for good. TTL
// covers a crashed run; on a non-publishing outcome the claim is released.
// 3 minutes, not 30. This lock only needs to outlive ONE publish attempt — the
// ledger is what actually prevents a double post. At 30 minutes a run that died
// mid-publish (a timeout uploading a big Reel) left the card locked, and every
// retry for the next half hour was silently skipped: from the app it just looked
// like the post never went out.
async function kvClaim(key, ex = 180) {
  // The value belongs in the PATH. Sending it as the request body alongside
  // ?NX&EX made Upstash answer 400 "ERR syntax error" every time, so this
  // returned false on every call — and since a failed claim means "someone else
  // is publishing this", EVERY post was silently skipped. That is why nothing
  // published at all, on any board, once this lock was introduced.
  // Send the Redis command as a JSON array to the root endpoint. Both URL forms
  // (?NX&EX as query params, and value-in-path) came back "ERR syntax error"
  // from Upstash, which made every claim fail and every post get skipped.
  const r = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(["SET", key, "1", "NX", "EX", String(ex)]),
  });
  const d = await r.json().catch(() => ({}));
  return d.result === "OK";
}
async function kvDel(key) {
  await fetch(`${KV_URL}/del/${key}`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}` } });
}
// Cached Google access token — board covers stream through /api/data?op=drive_img
// which hits Drive per image, so refreshing the token every call would be brutal.
let _gCache = { token: null, exp: 0 };
async function googleToken() {
  const now = Date.now();
  if (_gCache.token && _gCache.exp > now + 30000) return _gCache.token;
  const gstate = (await kvGet("google_oauth")) || {};
  if (!gstate.refresh_token) return null;
  const tr = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", refresh_token: gstate.refresh_token, grant_type: "refresh_token" }),
  });
  const td = await tr.json();
  if (!td.access_token) return null;
  _gCache = { token: td.access_token, exp: now + (td.expires_in || 3500) * 1000 };
  return td.access_token;
}
async function driveListFolder(folderId, token) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { Authorization: "Bearer " + token } });
  const d = await r.json();
  return (d.files || []).map((f) => ({ id: f.id, name: f.name, folder: (f.mimeType || "") === "application/vnd.google-apps.folder" }));
}
// Which Drive "Cover Photos" root each brand board pulls monthly covers from.
// A board can override with board.coverPhotosFolder; this is the built-in default.
const COVER_ROOTS = { "refillery-haus": "1oce4jwPbTB7x-_OSMzJhpvoXFVAaXVGL" };
const MONTH_RX = /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i;

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
async function sendResendEmail({ apiKey, from, to, subject, html, text: bodyText, attachments }) {
  const payload = { from, to: [to], subject };
  if (html) payload.html = html;
  if (bodyText) payload.text = bodyText;
  if (attachments && attachments.length) payload.attachments = attachments; // [{ filename, path }]
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
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
  // Keep Instagram long-lived tokens fresh (60-day expiry; refreshable after 24h).
  try {
    const igR = await fetch(`${url}/get/instagram_oauth`, { headers: { Authorization: `Bearer ${token}` } });
    const igD = await igR.json();
    const map = igD.result ? JSON.parse(igD.result) : null;
    if (map && typeof map === "object" && !map.access_token) {
      let refreshed = false;
      for (const t of Object.values(map)) {
        if (!t || !t.access_token || !t.long_lived) continue;
        if (Date.now() - new Date(t.savedAt || 0).getTime() < 7 * 86400000) continue; // weekly is plenty
        const rr = await fetch("https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=" + encodeURIComponent(t.access_token));
        const rd = await rr.json();
        if (rd.access_token) { t.access_token = rd.access_token; t.expires_in = rd.expires_in; t.savedAt = new Date().toISOString(); refreshed = true; }
      }
      if (refreshed) await fetch(`${url}/set/instagram_oauth`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(map) });
    }
  } catch {}
  // Backup sweep for scheduled posts (primary trigger is the 15-min GitHub
  // Actions pinger; this daily pass catches anything missed).
  try { await publishDueItems(); } catch {}
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

  // Scheduled publishing: hit every 15 min by the GitHub Actions pinger.
  // Guarded by its own key so it can run headless without a user session.
  if (op === "publish_due" && req.method === "POST") {
    if (!process.env.PUBLISH_KEY || req.headers["x-publish-key"] !== process.env.PUBLISH_KEY) {
      res.status(403).json({ error: "Bad publish key" });
      return;
    }
    // Record every sweep. The pinger only reports HTTP 200, which hides a run
    // that published nothing — this keeps the actual verdict for inspection.
    try {
      const out = await publishDueItems();
      await kvSet("publish_last", { at: new Date().toISOString(), ...out });
      // ride the sweep: two-way captions-doc sync (sig-guarded, cheap when idle)
      try { const acCS = new AbortController(); setTimeout(() => acCS.abort(), 15000); await fetch(APP_ORIGIN + "/api/data?op=sisters_captions_doc", { method: "POST", headers: { "x-publish-key": process.env.PUBLISH_KEY }, signal: acCS.signal }).catch(() => {}); } catch (eCS) {}
      res.json(out);
    } catch (e) {
      await kvSet("publish_last", { at: new Date().toISOString(), threw: String(e).slice(0, 400) });
      res.status(500).json({ error: String(e).slice(0, 300) });
    }
    return;
  }

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
        res.json({ token: makeUserToken(u), user: { name: u.name, role: u.role, email: u.email, pages: u.pages || null, denySegs: u.denySegs || null } });
        return;
      }
    }
    res.status(401).json({ error: "Wrong password" });
    return;
  }

  // ── Slack integration ────────────────────────────────────────────────────────
  // One Slack app, installed per workspace (Refillery Haus, Refillery Haus 2,
  // Assist-Her Agency, later Memmer Media — NEVER TTI Alumni: exclusion is
  // simply "don't install there"). Bot tokens land in KV slack_oauth keyed by
  // team id; message events stream into a capped slack_feed for the app bell.
  if (req.method === "GET" && op === "slack_auth") {
    const cid = process.env.SLACK_CLIENT_ID;
    if (!cid) { res.status(500).send("SLACK_CLIENT_ID is not set in Vercel env vars yet."); return; }
    // chat:write lets the bot post replies FOR Kiabeth — but only ever after she
    // taps approve in the app (see slack_draft / slack_send). Nothing auto-sends.
    const scopes = ["channels:read", "channels:join", "channels:history", "groups:read", "groups:history", "team:read", "users:read", "chat:write"].join(",");
    const params = new URLSearchParams({ client_id: cid, scope: scopes, redirect_uri: "https://lavalle-haus-os.vercel.app/api/slack-callback" });
    res.writeHead(302, { Location: "https://slack.com/oauth/v2/authorize?" + params.toString() });
    res.end(); return;
  }
  if (req.method === "GET" && op === "slack_callback") {
    const code = req.query.code;
    if (!code) { res.status(400).send("Slack didn't send a code — try connecting again."); return; }
    const r = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.SLACK_CLIENT_ID || "", client_secret: process.env.SLACK_CLIENT_SECRET || "", code, redirect_uri: "https://lavalle-haus-os.vercel.app/api/slack-callback" }),
    });
    const d = await r.json();
    if (!d.ok) { res.status(400).send("Slack token exchange failed: " + (d.error || "unknown")); return; }
    const map = (await kvGet("slack_oauth")) || {};
    map[d.team.id] = { team: d.team.name, teamId: d.team.id, token: d.access_token, botUserId: d.bot_user_id, installedAt: new Date().toISOString() };
    await kvSet("slack_oauth", map);
    // auto-join every public channel so "any notifications" really means any
    let joined = 0;
    try {
      const lr = await (await fetch("https://slack.com/api/conversations.list?types=public_channel&limit=200", { headers: { Authorization: "Bearer " + d.access_token } })).json();
      for (const ch of lr.channels || []) {
        if (ch.is_member) continue;
        const jr = await (await fetch("https://slack.com/api/conversations.join", { method: "POST", headers: { Authorization: "Bearer " + d.access_token, "Content-Type": "application/json" }, body: JSON.stringify({ channel: ch.id }) })).json();
        if (jr.ok) joined++;
      }
    } catch {}
    res.setHeader("Content-Type", "text/html");
    res.send('<div style="font-family:Georgia,serif;max-width:480px;margin:80px auto;text-align:center"><h2 style="font-weight:400">Slack connected.</h2><p><b>' + d.team.name + '</b> is now wired to Lavalle Haus OS' + (joined ? " — the bot joined " + joined + " channels" : "") + '. You can close this tab, or connect another workspace from the same link.</p></div>');
    return;
  }
  if (op === "slack_events") {
    const b = req.body || {};
    if (b.type === "url_verification") { res.json({ challenge: b.challenge }); return; }
    if (b.type === "event_callback" && b.event) {
      const ev = b.event;
      // Real conversation only: joins/leaves, topic changes and edits carry a
      // subtype and would otherwise flood the bell with "has joined" notices.
      const carried = !ev.subtype || ev.subtype === "file_share" || ev.subtype === "thread_broadcast";
      if ((ev.type === "message") && !ev.bot_id && carried && ev.text) {
        const map = (await kvGet("slack_oauth")) || {};
        const team = map[b.team_id];
        if (team) {
          let userName = ev.user || "";
          let chName = ev.channel || "";
          try {
            const ur = await (await fetch("https://slack.com/api/users.info?user=" + ev.user, { headers: { Authorization: "Bearer " + team.token } })).json();
            if (ur.ok) userName = ur.user.profile.display_name || ur.user.real_name || ur.user.name;
            const cr = await (await fetch("https://slack.com/api/conversations.info?channel=" + ev.channel, { headers: { Authorization: "Bearer " + team.token } })).json();
            if (cr.ok) chName = "#" + cr.channel.name;
          } catch {}
          // Slack markup → readable: <@U123|kia> and <http://x|label> keep the label.
          const text = String(ev.text)
            .replace(/<[@#]([UWC][A-Z0-9]+)\|([^>]+)>/g, "@$2")
            .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2")
            .replace(/<(https?:[^>]+)>/g, "$1")
            .slice(0, 400);
          const feed = (await kvGet("slack_feed")) || [];
          // channelId + ts are what a reply needs to land in the right place.
          feed.unshift({ team: team.team, teamId: b.team_id, channel: chName, channelId: ev.channel, user: userName, userId: ev.user || "", text, ts: ev.ts, at: new Date().toISOString() });
          await kvSet("slack_feed", feed.slice(0, 200)); // capped
        }
      }
      // Channels made after install still reach the bell: join them on sight,
      // otherwise the bot only ever sees what existed on the day it was added.
      if (ev.type === "channel_created" && ev.channel && ev.channel.id) {
        const map = (await kvGet("slack_oauth")) || {};
        const team = map[b.team_id];
        if (team) {
          try {
            await fetch("https://slack.com/api/conversations.join", {
              method: "POST",
              headers: { Authorization: "Bearer " + team.token, "Content-Type": "application/json; charset=utf-8" },
              body: JSON.stringify({ channel: ev.channel.id }),
            });
          } catch {}
        }
      }
    }
    res.json({ ok: true });
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
      // Tokens are stored per account (keyed by open_id) so @refilleryhaus and
      // @thefoldlabel can both be connected without overwriting each other.
      let profile = {};
      try {
        const ur = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", { headers: { Authorization: "Bearer " + d.access_token } });
        profile = (((await ur.json()) || {}).data || {}).user || {};
      } catch {}
      const kvKey = sandbox ? "tiktok_oauth_sandbox" : "tiktok_oauth";
      const map = tiktokAccounts(await kvGet(kvKey));
      map[d.open_id] = {
        access_token: d.access_token, refresh_token: d.refresh_token,
        open_id: d.open_id, scope: d.scope, sandbox,
        expires_in: d.expires_in, refresh_expires_in: d.refresh_expires_in,
        display_name: profile.display_name || null, avatar_url: profile.avatar_url || null,
        savedAt: new Date().toISOString(),
      };
      await kvSet(kvKey, map);
      const who = profile.display_name ? '"' + profile.display_name + '" is' : "The account is";
      res.send(page((sandbox ? who + " linked in the sandbox for the review demo." : who + " linked and the token is stored. Publishing can post once TikTok approves the app's audit.") + " You can close this tab.", true));
    } catch (e) {
      res.status(500).send(page(String(e).slice(0, 200), false));
    }
    return;
  }

  // ── Instagram OAuth (Instagram API with Instagram Login) ────────────────────
  // Meta app "Refillery Haus" → Instagram sub-app "Refillery Haus-IG".
  // Same per-account pattern as TikTok: KV instagram_oauth = {user_id: token}.
  // Long-lived tokens (~60 days) are refreshed by the daily cron.
  if (req.method === "GET" && op === "instagram_auth") {
    if (!process.env.IG_APP_ID) { res.status(500).json({ error: "IG_APP_ID is not set in Vercel env vars yet." }); return; }
    const csrf = randomBytes(16).toString("hex");
    await kvSet("instagram_csrf", { v: csrf, t: Date.now() });
    const params = new URLSearchParams({
      client_id: process.env.IG_APP_ID,
      redirect_uri: "https://lavalle-haus-os.vercel.app/api/instagram-callback",
      response_type: "code",
      scope: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_messages,instagram_business_manage_insights",
      state: csrf,
      force_reauth: "true", // each brand account picks itself at login
    });
    res.writeHead(302, { Location: "https://www.instagram.com/oauth/authorize?" + params.toString() });
    res.end();
    return;
  }
  if (req.method === "GET" && op === "instagram_callback") {
    const page = (msg, ok) => '<!doctype html><html><body style="font-family:Georgia,serif;background:#FFFFFF;color:#1A1A1A;display:flex;align-items:center;justify-content:center;height:96vh"><div style="text-align:center;max-width:440px"><div style="font-family:Jost,Helvetica,Arial,sans-serif;letter-spacing:4px;font-size:11px;color:#8F8676">LAVALLE HAUS OS</div><h2 style="font-weight:400">' + (ok ? "Instagram connected." : "Instagram connection failed") + '</h2><p style="color:#71716C;line-height:1.7">' + msg + "</p></div></body></html>";
    try {
      if (req.query.error) { res.status(400).send(page(String(req.query.error_description || req.query.error), false)); return; }
      const saved = (await kvGet("instagram_csrf")) || {};
      if (!req.query.state || req.query.state !== saved.v) { res.status(400).send(page("Security check failed — start again from /api/instagram-auth.", false)); return; }
      const r = await fetch("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.IG_APP_ID || "",
          client_secret: process.env.IG_APP_SECRET || "",
          grant_type: "authorization_code",
          redirect_uri: "https://lavalle-haus-os.vercel.app/api/instagram-callback",
          code: req.query.code || "",
        }),
      });
      const d = await r.json();
      if (!d.access_token) { res.status(400).send(page("Token exchange failed: " + JSON.stringify(d).slice(0, 250), false)); return; }
      // Swap the 1-hour token for a ~60-day one; the cron keeps it fresh.
      const llr = await fetch("https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=" + encodeURIComponent(process.env.IG_APP_SECRET || "") + "&access_token=" + encodeURIComponent(d.access_token));
      const ll = await llr.json();
      const token = ll.access_token || d.access_token;
      let profile = {};
      try { profile = await (await fetch("https://graph.instagram.com/v23.0/me?fields=user_id,username,name&access_token=" + encodeURIComponent(token))).json(); } catch {}
      const uid = String(profile.user_id || d.user_id);
      const map = igAccounts(await kvGet("instagram_oauth"));
      map[uid] = {
        access_token: token, user_id: uid, username: profile.username || null,
        permissions: d.permissions || null, long_lived: !!ll.access_token,
        expires_in: ll.expires_in || d.expires_in, savedAt: new Date().toISOString(),
      };
      await kvSet("instagram_oauth", map);
      res.send(page((profile.username ? "@" + profile.username + " is" : "The account is") + " linked and the token is stored. You can close this tab.", true));
    } catch (e) {
      res.status(500).send(page(String(e).slice(0, 200), false));
    }
    return;
  }

  // Card cover as a real image URL — Instagram's servers fetch media by URL,
  // and board covers live as data URLs inside the KV blob.
  if (req.method === "GET" && op === "card_media") {
    const data = await kvGet("lavalle_data");
    const blob = Array.isArray(data) ? data[0] : data;
    const board = blob && blob.boards && blob.boards[req.query.board];
    const card = board && (board.cards || []).find((x) => x.id === req.query.card);
    const m = card && typeof card.cover === "string" && /^data:(image\/[\w+]+);base64,(.+)$/.exec(card.cover);
    if (!m) { res.status(404).send("no cover"); return; }
    res.setHeader("Content-Type", m[1]);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(Buffer.from(m[2], "base64"));
    return;
  }

  // Export a Google Sheet as CSV via the app's Google token (owner-only) —
  // used to migrate spreadsheets (e.g. The Loft's PR ready-to-ship tracker)
  // into native app data without retyping.
  if (req.method === "GET" && op === "sheet_csv") {
    const auth0 = await getAuthEarly(req);
    if (!ownerRole(auth0)) { res.status(403).json({ error: "Owner only." }); return; }
    const id = (req.query.id || "").replace(/[^a-zA-Z0-9_-]/g, "");
    const token = await googleToken();
    if (!token) { res.status(400).json({ error: "google_not_connected" }); return; }
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text%2Fcsv`, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) { res.status(400).json({ error: "export_failed " + r.status }); return; }
    res.setHeader("Content-Type", "text/csv");
    res.send(await r.text());
    return;
  }

  // Lightweight poll target for the app-level reel finisher: just the list of
  // in-flight publishes (converting/processing). The finisher used to download
  // the ENTIRE data blob every 12s from every open device — that alone burned
  // through Vercel's Hobby origin-transfer allowance and paused the project.
  if (req.method === "GET" && op === "pub_inflight") {
    const data = (await kvGet("lavalle_data")) || null;
    const blob = Array.isArray(data) ? data[0] : data;
    const jobs = [];
    for (const [bk, board] of Object.entries((blob && blob.boards) || {})) {
      if (bk.startsWith("_") || !board || !board.cards) continue;
      for (const cd of board.cards) if (cd.pub && (cd.pub.status === "converting" || cd.pub.status === "processing")) jobs.push({ bk, id: cd.id, account: cd.pub.account || null });
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ jobs });
    return;
  }

  // ── Media store ────────────────────────────────────────────────────────────
  // Images used to be pasted into the main data blob as base64. That blob is
  // POSTed whole on every save, and Vercel rejects request bodies over 4.5MB —
  // so once enough covers were added, saves failed with 413 and an hour of work
  // vanished silently. Images now live in their own KV entries and the board
  // only keeps a short reference.
  // ── KV health + media garbage collection (owner) ───────────────────────────
  // The media store keeps images as base64 in Redis. When the database hits its
  // storage cap, Upstash rejects every write while reads keep working — and
  // because kvSet never checked the response, the app kept answering "saved".
  // kv_health surfaces the raw SET response; media_gc deletes media_* keys no
  // other key references (dry run unless {apply:true}; {keep:[ids]} protects ids).
  if (op === "kv_health" && req.method === "POST") {
    const authKH = await getAuthEarly(req);
    if (!ownerRole(authKH)) { res.status(403).json({ error: "Owner only." }); return; }
    const cmd = async (arr) => { const r = await fetch(KV_URL, { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(arr) }); return { status: r.status, body: (await r.text()).slice(0, 300) }; };
    const dbsize = await cmd(["DBSIZE"]);
    const probe = await cmd(["SET", "lh_probe", String(Date.now()), "EX", "60"]);
    const big = await cmd(["SET", "lh_probe_big", "x".repeat(200000), "EX", "60"]);
    res.json({ ok: true, dbsize, probe, big });
    return;
  }
  if (op === "media_gc" && req.method === "POST") {
    const authGC = await getAuthEarly(req);
    if (!ownerRole(authGC)) { res.status(403).json({ error: "Owner only." }); return; }
    const bGC = req.body || {};
    const cmd = async (arr) => { const r = await fetch(KV_URL, { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(arr) }); const d = await r.json().catch(() => ({})); return d.result; };
    const pipe = async (cmds) => { const r = await fetch(KV_URL + "/pipeline", { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(cmds) }); return (await r.json().catch(() => [])) || []; };
    const t0 = Date.now();
    // 1. every key
    let cursor = "0"; const keys = [];
    do { const r = await cmd(["SCAN", cursor, "COUNT", "1000"]); if (!r) break; cursor = String(r[0]); keys.push(...(r[1] || [])); } while (cursor !== "0" && keys.length < 200000);
    const mediaKeys = keys.filter((k) => k.startsWith("media_"));
    const otherKeys = keys.filter((k) => !k.startsWith("media_") && !k.startsWith("lh_probe"));
    // 2. tokens referenced anywhere outside the media store
    const referenced = new Set((bGC.keep || []).map(String));
    for (let i = 0; i < otherKeys.length; i += 20) {
      const chunk = otherKeys.slice(i, i + 20);
      const vals = await pipe(chunk.map((k) => ["GET", k]));
      for (const v of vals) { const s = typeof (v && v.result) === "string" ? v.result : JSON.stringify((v && v.result) || ""); for (const m of s.matchAll(/[A-Za-z0-9]{14,}/g)) referenced.add(m[0]); }
      if (Date.now() - t0 > 40000) { res.json({ ok: false, error: "timeout while scanning references", scanned: i, ofKeys: otherKeys.length, mediaKeys: mediaKeys.length }); return; }
    }
    const orphans = mediaKeys.filter((k) => !referenced.has(k.slice(6)));
    let deleted = 0;
    if (bGC.apply) {
      for (let i = 0; i < orphans.length; i += 100) { const r = await cmd(["DEL", ...orphans.slice(i, i + 100)]); deleted += Number(r) || 0; if (Date.now() - t0 > 50000) break; }
    }
    res.json({ ok: true, keys: keys.length, mediaKeys: mediaKeys.length, otherKeys: otherKeys.length, referencedTokens: referenced.size, orphans: orphans.length, sample: orphans.slice(0, 8), deleted, applied: !!bGC.apply, ms: Date.now() - t0 });
    return;
  }
  if (op === "media_put" && req.method === "POST") {
    const b = req.body || {};
    const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(String(b.dataUrl || ""));
    if (!m) { res.status(400).json({ error: "Expected an image data URL." }); return; }
    const id = "m" + randomBytes(10).toString("hex");
    await kvSet("media_" + id, { type: m[1], b64: m[2], at: new Date().toISOString() });
    res.json({ ok: true, id, url: "/api/data?op=media&id=" + id });
    return;
  }
  // Public like card_media/drive_img — <img> tags can't send the app token.
  if (req.method === "GET" && op === "media") {
    const id = String(req.query.id || "").replace(/\.jpe?g$/i, "").replace(/[^a-zA-Z0-9_-]/g, "");
    const rec = id && (await kvGet("media_" + id));
    if (!rec || !rec.b64) { res.status(404).send("no media"); return; }
    // Same ?fit= shaping as Drive images — uploaded covers publish too.
    const fitted = await fitImage(Buffer.from(rec.b64, "base64"), rec.type || "image/jpeg", req.query.fit);
    const buf = fitted.buf;
    res.setHeader("Content-Type", fitted.ctype);
    res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
    res.send(buf);
    return;
  }

  // Stream a Drive image by file id via the app's Google token — lets a board
  // card cover be a tiny reference (?op=drive_img&id=…) instead of inline base64,
  // and renders for every viewer (server holds the token). Unauthenticated like
  // card_media, since <img> tags can't send the x-app-token header.
  if (req.method === "GET" && op === "drive_img") {
    const id = String(req.query.id || "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!id) { res.status(400).send("no id"); return; }
    try {
      const token = await googleToken();
      if (!token) { res.status(400).send("google_not_connected"); return; }
      const ir = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: "Bearer " + token } });
      if (!ir.ok) { res.status(ir.status).send("drive_fail"); return; }
      let buf = Buffer.from(await ir.arrayBuffer());
      let ctype = ir.headers.get("content-type") || "image/jpeg";
      const fitted = await fitImage(buf, ctype, req.query.fit);
      buf = fitted.buf; ctype = fitted.ctype;
      res.setHeader("Content-Type", ctype);
      res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
      res.send(buf);
    } catch (e) { res.status(500).send("err"); }
    return;
  }

  // Download a card's cover at its best available resolution: the Drive
  // original (card.coverUrl Drive link → drive_img ref → the board's
  // <Month>/Cover photos/<n>.jpg), else the media-store copy. Streams as an
  // attachment. Public by ids, like drive_img — <a download> can't send headers.
  if (req.method === "GET" && op === "cover_download") {
    const bkD = String(req.query.board || "").replace(/[^a-zA-Z0-9_-]/g, "");
    const cidD = String(req.query.card || "").replace(/[^a-zA-Z0-9_-]/g, "");
    const rawD = await kvGet("lavalle_data"); const blobD = Array.isArray(rawD) ? rawD[0] : rawD;
    const bdD = blobD && blobD.boards && blobD.boards[bkD];
    const cardD = bdD && (bdD.cards || []).find((c) => c.id === cidD);
    if (!cardD) { res.status(404).send("no card"); return; }
    const safeName = (String(cardD.name || "cover").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "cover").slice(0, 80);
    const idFromLink = (s) => ((String(s || "").match(/[-\w]{25,}/) || [])[0]) || null;
    let fidD = cardD.coverUrl ? idFromLink(cardD.coverUrl) : null;
    if (!fidD && /op=drive_img/.test(cardD.cover || "")) fidD = (/[?&]id=([-\w]+)/.exec(cardD.cover) || [])[1] || null;
    const tokenD = await googleToken();
    if (!fidD && tokenD) {
      const nD = (/^post\s*(\d+)/i.exec(cardD.name || "") || [])[1];
      const cfgD = bkD === "the-fold" ? { root: "1lHEphb2pERjSK3sLktXxRgoC_GAvLMcC", mk: "fold_working_month" } : bkD === "lavalle-sisters" ? { root: "1L6Y0HBNlFmFGt5tWDtsJUL-7jGeGQ8JU", mk: "sisters_working_month" } : null;
      if (nD && cfgD) {
        try {
          const lsD = async (fid) => (await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("'" + fid + "' in parents and trashed=false") + "&fields=files(id,name,mimeType)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true", { headers: { Authorization: "Bearer " + tokenD } })).json()).files || [];
          const monthD = String((await kvGet(cfgD.mk)) || "September");
          const mF = (await lsD(cfgD.root)).find((f) => f.mimeType === "application/vnd.google-apps.folder" && (f.name || "").trim().toLowerCase() === monthD.toLowerCase());
          const cpF = mF && (await lsD(mF.id)).find((f) => f.mimeType === "application/vnd.google-apps.folder" && /^cover photos$/i.test((f.name || "").trim()));
          const hit = cpF && (await lsD(cpF.id)).find((f) => new RegExp("^" + nD + "\\.(jpe?g|png|heic|webp)$", "i").test((f.name || "").trim()));
          if (hit) fidD = hit.id;
        } catch (eD) {}
      }
    }
    try {
      if (fidD && tokenD) {
        const ir = await fetch(`https://www.googleapis.com/drive/v3/files/${fidD}?alt=media&supportsAllDrives=true`, { headers: { Authorization: "Bearer " + tokenD } });
        if (ir.ok) {
          const ct = ir.headers.get("content-type") || "image/jpeg";
          const ext = /png/.test(ct) ? "png" : /heic/.test(ct) ? "heic" : /webp/.test(ct) ? "webp" : "jpg";
          res.setHeader("Content-Type", ct);
          res.setHeader("Content-Disposition", `attachment; filename="${safeName}.${ext}"`);
          res.setHeader("Cache-Control", "private, max-age=0");
          res.send(Buffer.from(await ir.arrayBuffer()));
          return;
        }
      }
      if (cardD.cover) {
        const u = /^https?:/.test(cardD.cover) ? cardD.cover : APP_ORIGIN + cardD.cover;
        const mr = await fetch(u);
        if (mr.ok) {
          const ct = mr.headers.get("content-type") || "image/jpeg";
          res.setHeader("Content-Type", ct);
          res.setHeader("Content-Disposition", `attachment; filename="${safeName}.${/png/.test(ct) ? "png" : "jpg"}"`);
          res.setHeader("Cache-Control", "private, max-age=0");
          res.send(Buffer.from(await mr.arrayBuffer()));
          return;
        }
      }
      res.status(404).send("no cover source");
    } catch (eD2) { res.status(500).send("err"); }
    return;
  }

  // Stream a Drive video by id — the public video_url Instagram fetches when it
  // ingests a Reel. Streamed (not buffered) with Range passthrough so large
  // files don't blow the function's response limit. Uses the app's Google token
  // internally, so the file never has to be shared publicly on Drive.
  if (req.method === "GET" && op === "drive_video") {
    const id = String(req.query.id || "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!id) { res.status(400).send("no id"); return; }
    try {
      const token = await googleToken();
      if (!token) { res.status(400).send("google_not_connected"); return; }
      const hdrs = { Authorization: "Bearer " + token };
      if (req.headers.range) hdrs.Range = req.headers.range;
      const ir = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, { headers: hdrs });
      if (!ir.ok && ir.status !== 206) { res.status(ir.status).send("drive_fail"); return; }
      res.status(ir.status);
      res.setHeader("Content-Type", ir.headers.get("content-type") || "video/mp4");
      res.setHeader("Accept-Ranges", "bytes");
      const cl = ir.headers.get("content-length"); if (cl) res.setHeader("Content-Length", cl);
      const cr = ir.headers.get("content-range"); if (cr) res.setHeader("Content-Range", cr);
      res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
      if (ir.body) { Readable.fromWeb(ir.body).pipe(res); } else { res.end(); }
    } catch (e) { res.status(500).send("err"); }
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
    res.json({ token: makeUserToken(u), user: { name: u.name, role: u.role, email: u.email, pages: u.pages || null, denySegs: u.denySegs || null } });
    return;
  }

  // ── Team meetings (Fathom) ───────────────────────────────────────────────────
  // Fathom fires this webhook when a meeting finishes processing. The meeting is
  // stored for the Meetings tab, and its notes are auto-emailed to the saved
  // recipients. Secured by the shared publish key in the URL she pastes into
  // Fathom's webhook settings.
  if (op === "fathom_webhook" && req.method === "POST") {
    if (!process.env.PUBLISH_KEY || req.query.key !== process.env.PUBLISH_KEY) { res.status(403).json({ error: "bad key" }); return; }
    const b = req.body || {};
    // liberal field mapping — Fathom payloads vary by event version
    const title = String(b.title || b.meeting_title || (b.meeting || {}).title || "Meeting").slice(0, 160);
    const url2 = String(b.share_url || b.url || b.recording_url || (b.recording || {}).url || "").slice(0, 500);
    const when = String(b.started_at || b.created_at || (b.meeting || {}).scheduled_start_time || new Date().toISOString());
    const summary = String(b.summary || (b.ai_summary || {}).markdown_formatted || b.markdown_formatted || "").slice(0, 6000);
    const raw = await kvGet("lavalle_data");
    const blob = Array.isArray(raw) ? raw[0] : raw;
    if (!blob) { res.json({ ok: false }); return; }
    blob.teamMeetings = blob.teamMeetings || { recipients: [], items: [] };
    const item = { id: "mt" + randomBytes(5).toString("hex"), title, url: url2, date: when, summary, from: "fathom", sentTo: [] };
    blob.teamMeetings.items.unshift(item);
    blob.teamMeetings.items = blob.teamMeetings.items.slice(0, 300);
    const recips = (blob.teamMeetings.recipients || []).filter((e2) => /@/.test(e2));
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey && recips.length) {
      const from = process.env.RESEND_FROM || "Lavalle Haus OS <onboarding@resend.dev>";
      const html = '<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px">'
        + '<p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8F8676;font-family:Arial">Meeting notes</p>'
        + '<p style="font-size:17px;color:#1A1A1A">' + title + "</p>"
        + (summary ? '<div style="font-size:13px;color:#444;white-space:pre-wrap">' + summary.replace(/</g, "&lt;") + "</div>" : "")
        + (url2 ? '<p><a href="' + url2 + '" style="display:inline-block;background:#1A1A1A;color:#fff;text-decoration:none;padding:11px 20px;letter-spacing:2px;font-family:Arial;font-size:11px;text-transform:uppercase">View recording</a></p>' : "")
        + '<p style="font-size:11px;color:#71716C">Sent automatically from Lavalle Haus.</p></div>';
      for (const to of recips) {
        try {
          const rr = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [to], subject: "Meeting notes — " + title, html }) });
          if (rr.ok) item.sentTo.push(to);
        } catch (e2) {}
      }
    }
    await kvSet("lavalle_data", blob);
    // File the meeting into Drive: "Meeting Recordings" → Marketing | R&D.
    // A text doc per meeting (title, date, notes, recording link) — the
    // recording itself stays hosted on Fathom, the doc is the searchable trail.
    let drive = null;
    try {
      const gt = await googleToken();
      if (gt) {
        const dept = /r\s*&\s*d|manufactur|supplier|formul|packag|lab\b|sample/i.test(title + " " + summary.slice(0, 400)) ? "R&D" : "Marketing";
        const findOrCreate = async (name, parent) => {
          const q = encodeURIComponent("name='" + name.replace(/'/g, "\\'") + "' and mimeType='application/vnd.google-apps.folder' and trashed=false" + (parent ? " and '" + parent + "' in parents" : ""));
          const fr = await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&fields=files(id)&supportsAllDrives=true", { headers: { Authorization: "Bearer " + gt } })).json();
          if (fr.files && fr.files[0]) return fr.files[0].id;
          const cr = await (await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
            method: "POST", headers: { Authorization: "Bearer " + gt, "Content-Type": "application/json" },
            body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parent ? [parent] : undefined }),
          })).json();
          return cr.id;
        };
        const rootId = await findOrCreate("Meeting Recordings", null);
        const deptId = await findOrCreate(dept, rootId);
        const fname = (when || "").slice(0, 10) + " — " + title;
        const body2 = title + "\n" + when + "\n\nRecording: " + (url2 || "(no link)") + "\n\n" + (summary || "(no notes)");
        const boundary = "lhmeet" + Date.now();
        const mp = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
          + JSON.stringify({ name: fname, parents: [deptId], mimeType: "application/vnd.google-apps.document" })
          + "\r\n--" + boundary + "\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body2 + "\r\n--" + boundary + "--";
        const up = await (await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", {
          method: "POST", headers: { Authorization: "Bearer " + gt, "Content-Type": "multipart/related; boundary=" + boundary },
          body: mp,
        })).json();
        if (up.id) { drive = { fileId: up.id, dept }; item.driveFileId = up.id; item.dept = dept; await kvSet("lavalle_data", blob); }
      }
    } catch (e2) {}
    res.json({ ok: true, stored: item.id, emailed: item.sentTo.length, drive });
    return;
  }
  // Calendar-subscription feed: add this URL once in Google Calendar
  // ("Other calendars → From URL") and every meeting shows up and stays synced.
  if (op === "meetings_ics" && req.method === "GET") {
    if (!process.env.PUBLISH_KEY || req.query.key !== process.env.PUBLISH_KEY) { res.status(403).send("bad key"); return; }
    const raw = await kvGet("lavalle_data");
    const blob = Array.isArray(raw) ? raw[0] : raw;
    const items = ((blob || {}).teamMeetings || {}).items || [];
    const esc = (t) => String(t || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
    const dt = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lavalle Haus//Meetings//EN", "X-WR-CALNAME:Lavalle Haus Meetings"];
    for (const m of items) {
      const start = new Date(m.date || Date.now());
      const end = new Date(start.getTime() + 3600000);
      lines.push("BEGIN:VEVENT", "UID:" + m.id + "@lavalle-haus-os", "DTSTAMP:" + dt(start.toISOString()), "DTSTART:" + dt(start.toISOString()), "DTEND:" + dt(end.toISOString()), "SUMMARY:" + esc(m.title), "DESCRIPTION:" + esc((m.summary || "").slice(0, 500) + (m.url ? "\n" + m.url : "")), "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.send(lines.join("\r\n"));
    return;
  }

  // ── The Fold cover watcher ───────────────────────────────────────────────────
  // Runs daily: finds month folders under The Fold > Social Media that contain
  // a "Cover Photos" subfolder (found via SEARCH, because child listings on
  // that shared drive are patchy), syncs numbered files onto the Schedule 1-21
  // cards, and writes a caption + 2 broad TikTok tags for each NEW cover using
  // vision + the live thefoldlabel.com catalog. Old captions are stashed in
  // card comments, never destroyed.
  // Whose Google account is the app? (i.e., whom to share Drive folders with)
  if (req.method === "GET" && op === "drive_whoami") {
    const auth0d = await getAuthEarly(req);
    if (!ownerRole(auth0d)) { res.status(403).json({ error: "Owner only." }); return; }
    const gt = await googleToken();
    if (!gt) { res.json({ connected: false }); return; }
    const d0 = await (await fetch("https://www.googleapis.com/drive/v3/about?fields=user", { headers: { Authorization: "Bearer " + gt } })).json();
    res.json({ connected: true, user: d0.user || null });
    return;
  }
  if (op === "fold_cover_sync" && req.method === "POST") {
    const okKey = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const auth0c = okKey ? null : await getAuthEarly(req);
    if (!okKey && !ownerRole(auth0c)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const SM = "1lHEphb2pERjSK3sLktXxRgoC_GAvLMcC"; // The Fold > Social Media
    const gt = await googleToken();
    if (!gt) { res.status(400).json({ error: "google_not_connected" }); return; }
    const gfetch = async (u) => (await fetch(u, { headers: { Authorization: "Bearer " + gt } })).json();
    // 1. all Cover Photos folders → keep those whose parent is a month under SM
    const sr = await gfetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("name contains 'Cover Photos' and mimeType='application/vnd.google-apps.folder' and trashed=false") + "&fields=files(id,name,parents)&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true");
    // A month folder counts when its parent chain is Social Media directly
    // (…/Social Media/September/Cover Photos) OR goes through a year folder
    // (…/Social Media/2027/January/Cover Photos) — both layouts work, every
    // month, every year, no per-month setup.
    const MO = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    const months = [];
    for (const f of sr.files || []) {
      const pid = (f.parents || [])[0];
      if (!pid) continue;
      const pm = await gfetch("https://www.googleapis.com/drive/v3/files/" + pid + "?fields=id,name,parents&supportsAllDrives=true");
      const mi = MO.findIndex((x) => (pm.name || "").trim().toLowerCase().startsWith(x));
      if (mi < 0) continue;
      const gpid = (pm.parents || [])[0];
      let year = null;
      if (gpid === SM) {
        // no year folder: a month far behind today means NEXT year (a January
        // folder made in November is January of the coming year)
        const now = new Date();
        year = now.getFullYear();
        if (mi < now.getMonth() - 5) year += 1;
      } else if (gpid) {
        const gp = await gfetch("https://www.googleapis.com/drive/v3/files/" + gpid + "?fields=id,name,parents&supportsAllDrives=true");
        const ym = /^(20\d{2})$/.exec((gp.name || "").trim());
        if (ym && (gp.parents || []).includes(SM)) year = Number(ym[1]);
      }
      if (year !== null) months.push({ month: pm.name.trim(), year, mi, folderId: f.id, date: new Date(year, mi, 1) });
    }
    if (!months.length) { res.json({ ok: true, note: "no month folders found" }); return; }
    // 2. prefer THIS month; else the nearest upcoming; else the latest past
    const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const current = months.find((m) => m.date.getTime() === thisMonth.getTime());
    const upcoming = months.filter((m) => m.date > thisMonth).sort((a, b) => a.date - b.date)[0];
    const latest = months.sort((a, b) => b.date - a.date)[0];
    const target = current || upcoming || latest;
    // 3. numbered files inside it
    const lr = await gfetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("'" + target.folderId + "' in parents and trashed=false") + "&fields=files(id,name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true");
    const byN = {};
    for (const f of lr.files || []) { const m2 = /^(\d{1,2})\./.exec(f.name); if (m2) byN[Number(m2[1])] = f.id; }
    // 4. sync onto Schedule 1-21 cards
    const raw = await kvGet("lavalle_data");
    const blob = Array.isArray(raw) ? raw[0] : raw;
    const board = blob && blob.boards && blob.boards["the-fold"];
    if (!board) { res.json({ ok: false, error: "no board" }); return; }
    const schedIds = new Set((board.lists || []).filter((l) => /^schedule\s*1\s*[-–]\s*21$/i.test((l.name || "").trim())).map((l) => l.id));
    const changed = [];
    for (const card of board.cards) {
      if (!schedIds.has(card.listId)) continue;
      const m3 = /^post\s*(\d+)/i.exec(card.name || "");
      const fid = m3 && byN[Number(m3[1])];
      if (!fid || (card.cover || "").includes(fid)) continue;
      if (card.desc) card.comments = [...(card.comments || []), { id: "bc" + randomBytes(4).toString("hex"), by: "Claude", sys: true, at: new Date().toISOString(), text: "Previous caption (cover replaced by " + target.month + " sync): " + card.desc }];
      card.cover = "/api/data?op=drive_img&id=" + fid;
      card.coverUrl = "https://drive.google.com/file/d/" + fid + "/view";
      changed.push({ card, n: Number(m3[1]) });
    }
    // 5. caption + tags for new covers (vision, capped per run)
    const akey = process.env.ANTHROPIC_API_KEY;
    let captioned = 0;
    if (akey && changed.length) {
      let catalog = "Romy Cardigan, Lucia Dress, Olivia Dress, Iris Dress, Renata Dress, Margaux Blouse, Sera Top, Sable Pant, Luce Pants, Hazel Sweater, Dove Sweater, Selene Necklace, Cora Bracelet, Mira Earrings";
      try {
        const site = await (await fetch("https://thefoldlabel.com/collections/all")).text();
        const names = [...new Set([...site.matchAll(/\/products\/([a-z0-9-]+)/g)].map((x) => x[1].replace(/-/g, " ")))].slice(0, 40);
        if (names.length > 3) catalog = names.join(", ");
      } catch (e3) {}
      for (const ch of changed.slice(0, 8)) {
        try {
          const r4 = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST", headers: { "x-api-key": akey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 300, messages: [{ role: "user", content: [
              { type: "image", source: { type: "url", url: APP_ORIGIN + ch.card.cover + "&fit=igfeed" } },
              { type: "text", text: "This is a grid post for The Fold (thefoldlabel.com) — quiet-luxury womenswear, The Row/Toteme register. Catalog: " + catalog + ". Write ONE understated sentence describing what's pictured (name the product ONLY if clearly identifiable from the catalog; plain punctuation, never an em dash), plus exactly 2 broad TikTok hashtags (never the brand name, no niche tags — think #quietluxury #ootd #minimalstyle #naturalfibers #knitwear #outfitideas #styleinspo). Return ONLY JSON: {\"caption\":\"…\",\"tags\":\"#a #b\"}" },
            ] }] }),
          });
          const d4 = await r4.json();
          const txt = ((d4.content || [])[0] || {}).text || "";
          const parsed = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
          if (parsed.caption) { ch.card.desc = String(parsed.caption).slice(0, 300); ch.card.tags = String(parsed.tags || "").slice(0, 80); captioned++; }
        } catch (e4) {}
      }
    }
    // ── Step 3: format detection ─────────────────────────────────────────────
    // Look at the month's ASSETS (videos, image sets) and label each post
    // [reel] / [carousel] / [IG static] from what actually exists — plus link
    // the asset onto the card so publishing has it. Expected mix: ~10-12 reels,
    // mostly carousels, a couple of statics. Scans the month folder AND any
    // "Content by the Loft" folder beside/inside it, one level of subfolders.
    const fmt = { relabeled: 0, linked: 0, scanned: 0 };
    try {
      const roots = [target.folderId];
      const monthParentQ = await gfetch("https://www.googleapis.com/drive/v3/files/" + target.folderId + "?fields=parents&supportsAllDrives=true");
      const monthId = (monthParentQ.parents || [])[0]; // the month folder itself (Cover Photos' parent)
      if (monthId) roots.push(monthId);
      // Provider folders: The Loft (video/photo content) and Ashe Design
      // (ecomm imagery) — both live under Social Media or inside the month,
      // with month-named subfolders that the scanner walks into.
      for (const provider of ["Loft", "Ashe"]) {
        const pq = await gfetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("name contains '" + provider + "' and mimeType='application/vnd.google-apps.folder' and trashed=false") + "&fields=files(id,name,parents)&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true");
        for (const lf of pq.files || []) if ((lf.parents || []).some((pp) => pp === monthId || pp === SM)) roots.push(lf.id);
      }
      const assets = {}; // N -> { videos: [ids], folders: [{id, imgs, vids}], images: [ids] }
      const scan = async (fid, depth) => {
        const ls = await gfetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("'" + fid + "'" + " in parents and trashed=false") + "&fields=files(id,name,mimeType)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true");
        for (const f of ls.files || []) {
          fmt.scanned++;
          // Accept "3.mp4", "reel 3.mov", "Post 12", "carousel #4" — she names
          // uploads either way, and both must land on the right Post card.
          const nm5 = (f.name || "").trim().replace(/\.\w+$/, "");
          const m5 = /^(\d{1,2})\b/.exec(nm5) || /^(?:reel|post|video|vid|carousel|story)\s*#?\s*(\d{1,2})$/i.exec(nm5);
          const isDir = f.mimeType === "application/vnd.google-apps.folder";
          if (m5) {
            const n5 = Number(m5[1]);
            if (n5 >= 1 && n5 <= 21) {
              assets[n5] = assets[n5] || { videos: [], folders: [], images: [] };
              if (isDir) {
                const inner = await gfetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("'" + f.id + "'" + " in parents and trashed=false") + "&fields=files(id,mimeType)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true");
                const imgs = (inner.files || []).filter((x) => (x.mimeType || "").startsWith("image/")).length;
                const vids = (inner.files || []).filter((x) => (x.mimeType || "").startsWith("video/")).length;
                assets[n5].folders.push({ id: f.id, imgs, vids });
              } else if ((f.mimeType || "").startsWith("video/")) assets[n5].videos.push(f.id);
              else if ((f.mimeType || "").startsWith("image/") && fid !== target.folderId) assets[n5].images.push(f.id);
            }
          } else if (isDir && depth < 1 && !/cover photos/i.test(f.name || "")) {
            await scan(f.id, depth + 1); // e.g. a "Reels" or "Carousels" folder
          }
        }
      };
      for (const r5 of roots) { try { await scan(r5, 0); } catch (e5) {} }
      for (const card of board.cards) {
        if (!schedIds.has(card.listId)) continue;
        const m6 = /^post\s*(\d+)/i.exec(card.name || "");
        if (!m6) continue;
        const a6 = assets[Number(m6[1])];
        if (!a6) continue;
        const vidInFolder = a6.folders.find((x) => x.vids > 0);
        const carFolder = a6.folders.find((x) => x.imgs >= 2);
        let label = null, asset = null;
        if (a6.videos.length || vidInFolder) { label = "reel"; asset = a6.videos[0] ? "https://drive.google.com/file/d/" + a6.videos[0] + "/view" : "https://drive.google.com/drive/folders/" + vidInFolder.id; }
        else if (carFolder || a6.images.length >= 2) { label = "carousel"; asset = carFolder ? "https://drive.google.com/drive/folders/" + carFolder.id : null; }
        else if (a6.images.length === 1 || a6.folders.some((x) => x.imgs === 1)) { label = "IG static"; const sf = a6.folders.find((x) => x.imgs === 1); asset = a6.images[0] ? "https://drive.google.com/file/d/" + a6.images[0] + "/view" : (sf ? "https://drive.google.com/drive/folders/" + sf.id : null); }
        if (!label) continue;
        const newName = /\[.*?\]/.test(card.name) ? card.name.replace(/\[.*?\]/, "[" + label + "]") : card.name + " [" + label + "]";
        if (newName !== card.name) { card.name = newName; fmt.relabeled++; }
        if (asset && card.assetUrl !== asset) { card.assetUrl = asset; fmt.linked++; }
      }
    } catch (e6) {}
    // Board backgrounds follow the covers (her rule): when a month's Cover
    // Photos land, The Fold board's background becomes that month's Post 1
    // cover; the other brand boards take their own newest card cover.
    let bgChanged = 0;
    try {
      if (byN[1]) {
        const bgUrl = "/api/data?op=drive_img&id=" + byN[1];
        const fb = blob.boards && blob.boards["the-fold"];
        if (fb && fb.bg !== bgUrl) { fb.bg = bgUrl; bgChanged++; }
      }
      // Her rule: a board background is never a solo shot of either founder —
      // both of them together, or an aesthetic clothing/beauty product image.
      // Automation can't judge that from pixels, so these boards take a
      // designated pick (KV bg_pick_<board>, set during art direction) and are
      // left untouched when none exists.
      for (const bk of ["refillery-haus", "lavalle-sisters"]) {
        const bd = blob.boards && blob.boards[bk];
        if (!bd) continue;
        const pick = await kvGet("bg_pick_" + bk);
        if (pick && bd.bg !== pick) { bd.bg = pick; bgChanged++; }
      }
    } catch (eBG) {}
    if (changed.length || fmt.relabeled || fmt.linked || bgChanged) await kvSet("lavalle_data", blob);
    res.json({ ok: true, month: target.month + " " + target.year, candidates: months.map((m) => m.month + " " + m.year), filesFound: Object.keys(byN).length, coversUpdated: changed.length, captioned, format: fmt, bgChanged });
    return;
  }
  // ── Monthly grid generation: next month's 21-post grid, art-directed ─────────
  // Her rule: a Grid folder under Social Media holds one archive image per month
  // ("August grid.jpg" etc.). This op designs the NEXT month: it pulls candidate
  // photos from "Content by Ashe Design Haus" (that month's folder) and "Content
  // by the Loft" (skipping anything used in the last two months), shows Claude
  // the previous month's archived grid as the flow reference, and asks for a
  // 21-slot ordering tuned to the season's quiet-luxury trends. Then it copies
  // the picks — resized to 1080×1440 — into Social Media/<Month>/Cover Photos as
  // 1.jpg…21.jpg (which fold_cover_sync already dresses onto cards daily) and
  // renders the montage into Grid/<Month>.
  // One Vercel run can't move 21 images, so the op is a resumable state machine
  // (plan → copy in batches of 4 → composite), with progress in KV; call it
  // repeatedly until stage:"done". Body: {month?, year?, reset?, dry?}.
  // Generated-grid archive list for the planner's month dropdown: every
  // Social Media/<Month>/grid/"<Month> grid.jpg" that exists.
  if (op === "fold_grid_list" && req.method === "GET") {
    const authGL = await getAuthEarly(req);
    if (!authGL) { res.status(401).json({ error: "Locked." }); return; }
    const SMgl = "1lHEphb2pERjSK3sLktXxRgoC_GAvLMcC";
    const gtGL = await googleToken();
    if (!gtGL) { res.status(400).json({ error: "google_not_connected" }); return; }
    const listGL = async (fid) => (await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("'" + fid + "' in parents and trashed=false") + "&fields=files(id,name,mimeType)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true", { headers: { Authorization: "Bearer " + gtGL } })).json()).files || [];
    const MOgl = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const out = [];
    try {
      for (const f of await listGL(SMgl)) {
        if (f.mimeType !== "application/vnd.google-apps.folder") continue;
        const mi2 = MOgl.findIndex((m) => (f.name || "").trim().toLowerCase() === m.toLowerCase());
        if (mi2 < 0) continue;
        const sub = (await listGL(f.id)).find((s) => s.mimeType === "application/vnd.google-apps.folder" && (s.name || "").trim().toLowerCase() === "grid");
        if (!sub) continue;
        const gf = (await listGL(sub.id)).find((s) => / grid\.(jpe?g|png)$/i.test(s.name || ""));
        if (gf) out.push({ month: MOgl[mi2], mi: mi2, fileId: gf.id });
      }
    } catch (eGL) {}
    out.sort((a, b) => a.mi - b.mi);
    res.json({ grids: out });
    return;
  }
  // ── Trello → Courtney ideas sync ─────────────────────────────────────────
  // Standing rule: the 12 ideas on the Lavalle Sisters Trello board's
  // "COURTNEY CONTENT IDEAS" list mirror into the app board's "Courtney Posts
  // 1-12" list. Numbering is stable; new Trello ideas append as the next C#.
  // Needs TRELLO_KEY/TRELLO_TOKEN env (board is private); silently skips when
  // absent so the pinger can call it unconditionally.
  if (op === "trello_courtney_sync" && req.method === "POST") {
    const okKeyT = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authT = okKeyT ? null : await getAuthEarly(req);
    if (!okKeyT && !ownerRole(authT)) { res.status(403).json({ error: "Owner or key only." }); return; }
    if (!process.env.TRELLO_KEY || !process.env.TRELLO_TOKEN) { res.json({ ok: false, skipped: "trello_not_connected" }); return; }
    const trUrl = "https://api.trello.com/1/boards/o5o07L33?lists=open&cards=open&card_fields=name,idList&list_fields=name&key=" + process.env.TRELLO_KEY + "&token=" + process.env.TRELLO_TOKEN;
    const tb = await (await fetch(trUrl)).json();
    const src = (tb.lists || []).find((l) => /courtney content ideas/i.test(l.name || ""));
    if (!src) { res.json({ ok: false, error: "no COURTNEY CONTENT IDEAS list on Trello" }); return; }
    const ideas = (tb.cards || []).filter((c) => c.idList === src.id).map((c) => (c.name || "").trim()).filter(Boolean);
    const rawT = await kvGet("lavalle_data");
    const blobT = Array.isArray(rawT) ? rawT[0] : rawT;
    const bdT = blobT && blobT.boards && blobT.boards["lavalle-sisters"];
    if (!bdT) { res.json({ ok: false, error: "no lavalle-sisters board" }); return; }
    let crtT = bdT.lists.find((l) => /courtney\s*posts/i.test(l.name || ""));
    if (!crtT) { crtT = { id: "l" + Math.random().toString(36).slice(2, 9), name: "Courtney Posts 1-12" }; bdT.lists.push(crtT); }
    const curT = bdT.cards.filter((c) => c.listId === crtT.id);
    let maxN = 0;
    for (const c of curT) { const mN = /^c\s*(\d+)/i.exec(c.name || ""); if (mN) maxN = Math.max(maxN, Number(mN[1])); }
    let addedT = 0;
    for (const idea of ideas) {
      if (curT.some((c) => (c.name || "").includes(idea))) continue;
      maxN++;
      bdT.cards.push({ id: "c" + Math.random().toString(36).slice(2, 10), listId: crtT.id, name: "C" + maxN + " — " + idea, desc: "From Trello: COURTNEY CONTENT IDEAS", labels: [], members: [], attachments: [], links: [], cover: null, done: false });
      addedT++;
    }
    if (addedT) await kvSet("lavalle_data", blobT);
    res.json({ ok: true, ideas: ideas.length, added: addedT });
    return;
  }
  // ── Slack strategy-PDF watch ─────────────────────────────────────────────
  // Her rule (until the Loft contract ends Oct 2026): the Loft drops a monthly
  // strategy PDF for Refillery Haus in Slack — file it automatically into
  // Drive "Strategy & Reports/Strategy Outline" beside the previous months.
  // KV ledger avoids re-saving; newest saved id is reported for follow-up work.
  if (op === "slack_strategy_watch" && req.method === "POST") {
    const okKeyW = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authW = okKeyW ? null : await getAuthEarly(req);
    if (!okKeyW && !ownerRole(authW)) { res.status(403).json({ error: "Owner or key only." }); return; }
    if (Date.now() > Date.UTC(2026, 9, 31)) { res.json({ ok: true, skipped: "loft contract ended" }); return; }
    const mapW = (await kvGet("slack_oauth")) || {};
    const teams = Object.values(mapW).filter((t) => t && t.token);
    if (!teams.length) { res.json({ ok: false, error: "no slack teams connected" }); return; }
    const gtW = await googleToken();
    if (!gtW) { res.status(400).json({ error: "google_not_connected" }); return; }
    const OUTLINE = "1DjnKiexU13hxWHLsVYTGwajrPToty0IH"; // Strategy & Reports/Strategy Outline
    const ledW = (await kvGet("slack_pdf_saved")) || {};
    let saved = 0, checked = 0, lastSaved = null, apiErr = null;
    for (const team of teams) {
      const fl = await (await fetch("https://slack.com/api/files.list?types=pdfs&count=20", { headers: { Authorization: "Bearer " + team.token } })).json();
      if (!fl.ok) { apiErr = fl.error || "files.list failed"; continue; }
      for (const f of fl.files || []) {
        checked++;
        if (ledW[f.id] || !/pdf/i.test(f.filetype || "")) continue;
        const dl = await fetch(f.url_private_download || f.url_private, { headers: { Authorization: "Bearer " + team.token } });
        if (!dl.ok) continue;
        const buf = Buffer.from(await dl.arrayBuffer());
        if (buf.length < 10000) continue;
        const bdW = "lhw" + buf.length.toString(36);
        const metaW = JSON.stringify({ name: f.name || "strategy.pdf", parents: [OUTLINE] });
        const preW = `--${bdW}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaW}\r\n--${bdW}\r\nContent-Type: application/pdf\r\n\r\n`;
        const upW = await (await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name", { method: "POST", headers: { Authorization: "Bearer " + gtW, "Content-Type": `multipart/related; boundary=${bdW}` }, body: Buffer.concat([Buffer.from(preW, "utf8"), buf, Buffer.from(`\r\n--${bdW}--`, "utf8")]) })).json();
        if (upW.id) { ledW[f.id] = upW.id; saved++; lastSaved = { name: f.name, driveId: upW.id }; }
      }
    }
    await kvSet("slack_pdf_saved", ledW);
    res.json({ ok: true, checked, saved, lastSaved, apiErr });
    return;
  }
  // ── Loft → Sisters "Courtney to edit" auto-copy ──────────────────────────
  // Her rule (until the Loft contract ends Oct 2026): every new file the Loft
  // delivers under RH "Content by The Loft" mirrors into Lavalle Sisters /
  // <working month> / "Courtney to edit" / "From the Loft — <delivery folder>"
  // so Courtney never has to ask for shares. KV ledger prevents re-copies;
  // KV sisters_working_month picks the destination month (default September).
  if (op === "loft_sisters_sync" && req.method === "POST") {
    const okKeyL = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authL = okKeyL ? null : await getAuthEarly(req);
    if (!okKeyL && !ownerRole(authL)) { res.status(403).json({ error: "Owner or key only." }); return; }
    if (Date.now() > Date.UTC(2026, 9, 31)) { res.json({ ok: true, skipped: "loft contract ended Oct 2026" }); return; }
    const gtL2 = await googleToken();
    if (!gtL2) { res.status(400).json({ error: "google_not_connected" }); return; }
    const gJ = async (u) => (await (await fetch(u, { headers: { Authorization: "Bearer " + gtL2 } })).json());
    const lsL = async (fid) => (await gJ("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("'" + fid + "' in parents and trashed=false") + "&fields=files(id,name,mimeType)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true")).files || [];
    const mkL = async (name, parent) => {
      const kids = await lsL(parent);
      const hit = kids.find((f) => f.mimeType === "application/vnd.google-apps.folder" && (f.name || "").trim() === name);
      if (hit) return hit.id;
      return (await (await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", { method: "POST", headers: { Authorization: "Bearer " + gtL2, "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }) })).json()).id;
    };
    const CBL = "1jphvq5_W89utxArSnbV1sgIpp-ZJ_tCS"; // RH Content by The Loft
    const SIS = "1L6Y0HBNlFmFGt5tWDtsJUL-7jGeGQ8JU"; // Lavalle Sisters folder
    const wm = (await kvGet("sisters_working_month")) || "September";
    const led = (await kvGet("loft_sisters_copied")) || {};
    const monthL = await mkL(wm, SIS);
    const cteL = await mkL("Courtney to edit", monthL);
    let copied = 0, seen = 0;
    const budget = Date.now() + 40000; // stay under the function limit; pinger resumes
    const walkL = async (fid, destParent, label) => {
      for (const f of await lsL(fid)) {
        if (Date.now() > budget) return;
        if (f.mimeType === "application/vnd.google-apps.folder") {
          await walkL(f.id, destParent, label + " — " + (f.name || "").trim());
        } else {
          seen++;
          if (led[f.id]) continue;
          const dst = await mkL("From the Loft — " + label, cteL);
          const cp2 = await (await fetch("https://www.googleapis.com/drive/v3/files/" + f.id + "/copy?supportsAllDrives=true&fields=id", { method: "POST", headers: { Authorization: "Bearer " + gtL2, "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, parents: [dst] }) })).json();
          if (cp2.id) { led[f.id] = 1; copied++; }
        }
      }
    };
    for (const mf of await lsL(CBL)) {
      if (Date.now() > budget) break;
      if (mf.mimeType !== "application/vnd.google-apps.folder") continue;
      await walkL(mf.id, cteL, (mf.name || "").trim());
    }
    await kvSet("loft_sisters_copied", led);
    res.json({ ok: true, month: wm, copied, seen, more: Date.now() > budget });
    return;
  }
  // ── Lavalle Sisters pre-grid ─────────────────────────────────────────────
  // Her hand-off rule: SHE doesn't wait on Courtney's 12-grid. The app renders
  // a PRE-GRID — her current Schedule 1-21 with any covered Courtney cards
  // woven in after the Mon/Wed/Fri dailies — that she hands over (or Courtney
  // views in the app, then refines herself once she's onboarded in Sept).
  // Montage → Drive archive folder + media store; KV "sisters_pregrid" holds
  // the current pointer for the UI.
  if (op === "sisters_pregrid" && req.method === "POST") {
    const okKeyP = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authP = okKeyP ? null : await getAuthEarly(req);
    if (!okKeyP && !ownerRole(authP)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const gtP = await googleToken();
    if (!gtP) { res.status(400).json({ error: "google_not_connected" }); return; }
    const rawP = await kvGet("lavalle_data");
    const blobP = Array.isArray(rawP) ? rawP[0] : rawP;
    const bdP = blobP && blobP.boards && blobP.boards["lavalle-sisters"];
    if (!bdP) { res.json({ ok: false, error: "no board" }); return; }
    const schedP = bdP.lists.find((l) => /^schedule\s*1\s*[-–]\s*21$/i.test((l.name || "").trim()));
    const courtP = bdP.lists.find((l) => /courtney\s*posts/i.test(l.name || ""));
    if (!schedP) { res.json({ ok: false, error: "no Schedule 1-21 list" }); return; }
    const numP = (c) => Number((/^post\s*(\d+)/i.exec(c.name) || [])[1] || 0);
    const kCards = bdP.cards.filter((c) => c.listId === schedP.id && numP(c) >= 1 && numP(c) <= 21).sort((a, b) => numP(a) - numP(b));
    const cCards = courtP ? bdP.cards.filter((c) => c.listId === courtP.id && c.cover && /\d+/.test(c.name || "")).sort((a, b) => Number((/(\d+)/.exec(a.name) || [])[1]) - Number((/(\d+)/.exec(b.name) || [])[1])) : [];
    // cycle start date from Post 1's title ("Post 1 July 30th"); daily cadence
    const MOP = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    let startP = new Date();
    const mD = /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/i.exec((kCards[0] || {}).name || "");
    if (mD) { startP = new Date(Date.UTC(new Date().getUTCFullYear(), MOP.indexOf(mD[1].toLowerCase()), Number(mD[2]))); }
    // Courtney's Mon/Wed/Fri posts only begin once she's actually onboarded —
    // before her start date the grid is Kiabeth's dailies alone.
    const bodyP = req.body || {};
    if (bodyP.courtneyStart) await kvSet("sisters_courtney_start", String(bodyP.courtneyStart).slice(0, 10));
    const cStartS = await kvGet("sisters_courtney_start");
    const cStartT = cStartS ? Date.parse(cStartS + "T00:00:00Z") : 0;
    const seqP = [];
    let ciP = 0;
    for (let d = 0; d < kCards.length; d++) {
      const day = new Date(startP.getTime() + d * 86400000);
      seqP.push({ cover: kCards[d].cover, tag: "K" });
      if ([1, 3, 5].includes(day.getUTCDay()) && day.getTime() >= cStartT && ciP < cCards.length) { seqP.push({ cover: cCards[ciP].cover, tag: "C" }); ciP++; }
    }
    const Jimp = (await import("jimp")).default;
    const rowsP = Math.max(1, Math.ceil(seqP.length / 3));
    const cvP = await new Jimp(1080, rowsP * 480, 0xffffffff);
    for (let i = 0; i < seqP.length; i++) {
      if (!seqP[i].cover) continue;
      try {
        const full = /^https?:/.test(seqP[i].cover) ? seqP[i].cover : APP_ORIGIN + seqP[i].cover;
        const rT = await fetch(full);
        if (!rT.ok) continue;
        const t = (await Jimp.read(Buffer.from(await rT.arrayBuffer()))).cover(360, 480);
        if (seqP[i].tag === "C") { const cx = t.getWidth() - 26, cy = 26, r = 9; t.scan(cx - r - 4, cy - r - 4, (r + 4) * 2, (r + 4) * 2, function (x2, y2, idx2) { const dd = (x2 - cx) * (x2 - cx) + (y2 - cy) * (y2 - cy); if (dd <= r * r) { this.bitmap.data[idx2] = 255; this.bitmap.data[idx2 + 1] = 255; this.bitmap.data[idx2 + 2] = 255; } else if (dd <= (r + 2) * (r + 2)) { this.bitmap.data[idx2] = 120; this.bitmap.data[idx2 + 1] = 114; this.bitmap.data[idx2 + 2] = 104; } }); }
        cvP.composite(t, (2 - (i % 3)) * 360, (rowsP - 1 - Math.floor(i / 3)) * 480);
      } catch (eT) {}
    }
    cvP.quality(88);
    const bufP = await cvP.getBufferAsync(Jimp.MIME_JPEG);
    // media store copy for the in-app viewer
    const midP = "sg" + createHash("sha256").update(bufP).digest("hex").slice(0, 14);
    await kvSet("media_" + midP, { b64: bufP.toString("base64"), ct: "image/jpeg" });
    const up8 = { id: null }; // Drive copy removed — the archive holds exactly the two named grids; the app reads the media-store render
    await kvSet("sisters_pregrid", { mid: midP, fileId: up8.id || null, kTiles: kCards.filter((c) => c.cover).length, cTiles: ciP, at: Date.now() });
    res.json({ ok: true, tiles: seqP.length, kTiles: kCards.filter((c) => c.cover).length, cWoven: ciP, fileId: up8.id || null, view: "/cover/" + midP + ".jpg" });
    return;
  }
  // Board-generic config for the automation suite: the same ops serve the
  // Sisters board and The Fold (minus everything Courtney-specific).
  const SBOARD = (() => {
    const bkq = (req.query && req.query.board) || (req.body && req.body.board) || "";
    if (bkq === "the-fold") return {
      key: "the-fold", label: "THE FOLD", themeLabelBrand: "The Fold (thefoldlabel.com) — quiet-luxury womenswear",
      kvSuffix: "_tf", igMatch: /thefold/i, driveRootId: "1lHEphb2pERjSK3sLktXxRgoC_GAvLMcC", // The Fold > Social Media (month folders)
      monthDefaultKv: "fold_working_month", hasCourtney: false,
    };
    return {
      key: "lavalle-sisters", label: "LAVALLE SISTERS", themeLabelBrand: "@lavallesisters — The Fold + Lavalle Haus, run by two sisters",
      kvSuffix: "", igMatch: /sister/i, driveRootId: "1L6Y0HBNlFmFGt5tWDtsJUL-7jGeGQ8JU",
      monthDefaultKv: "sisters_working_month", hasCourtney: true,
    };
  })();
  // ── Automations card (plain-English registry) ────────────────────────────
  // Her rule: a card the whole team can read that says what runs on its own,
  // and what triggers it. Regenerated from this registry so it never drifts.
  const AUTOMATIONS = [
    ["Grid card refresh", "Every 15 min", "The Grid card re-renders the four numbered windows, always split 1–9, 10–21, 22–30, 31–42 (the standing rule), from whatever is saved in the grid editor; its cover advances to the window we're in. White dot = Courtney's post. Card names carry no dates; the slot number is the sequence."],
    ["Editorial cover pick", "Every 15 min (re-runs when the grid changes)", "Reads the current grid's photos and picks the most editorial product shot as the Strategy Outline card's cover. Category alternates as grids switch: the first grid takes its majority (fashion if 12 of 21 lean fashion), the next grid takes the other, and so on. Also ranks photos for the collage on the Strategy page."],
    ["Strategy Outline PDF", "When every one of OUR posts in 1–42 is marked Approved (Courtney's 12 don't count); after that, whenever the grid, a caption, a hashtag, the theme or the cover pick changes", "Builds the month's Strategy Outline from the locked grid (the grid is the sequence: C-dotted tiles are Courtney's), the theme, and each card's title, caption and 2 TikTok hashtags. Saves the PDF to Drive → <Month> → Strategy outline, renders the pages as images on the Strategy Outline card (swipe; ⤢ for present mode) and links the PDF on the Grid card. House rule: captions carry no em dashes."],
    ["Card concepts — point of the post", "Every 15 min, a few posts per tick (re-runs when a post's cover photo or caption changes)", "Reads each post's cover photo and auto-caption and writes a short point-of-the-post into the card title — \"Post n <date> - TF: linen set styling\" — recognizing whether the product is The Fold (TF) or Lavalle Haus (LH). Courtney's titles and anything typed by hand are never overwritten."],
    ["Platform-sized cover files", "Every 15 min, a few posts per tick (re-runs when a tile photo or a post's IG/TT format changes)", "Rule: when a post is a reel on one platform and a feed post (carousel/static) on the other, its photo is saved to Drive → Cover photos in BOTH sizes — <n>-IG.jpg and <n>-TT.jpg (1080×1350 feed / 1080×1920 vertical). Same-shape posts keep one numbered file. Either way, when a grid photo is REPLACED the Drive file refreshes in place and the cover photo link on the card always points at the current file."],
    ["Post formats — IG vs TT tags", "Every 15 min (re-runs when the month's Reels/Carousels folders, Blerina's or Courtney's edit folders, the grid, or a Courtney format pick change)", "Tags every card IG · … and TT · … with locked neutral colors (ivory = IG, slate = TT). Courtney's 12: her pick (reel or carousel, switchable on her card) and the SAME format on both channels. Our posts: TikTok runs mainly FTC, face to camera (Sarah's daily rule; a few B-roll/Carousel exceptions), each day tagged as exactly one thing, while Instagram keeps the b-roll / carousel / static read since heavy FTC underperforms there. Cadence: at most 2 statics, Instagram-only; TikTok runs a carousel on those days."],
    ["Next-month Theme card", "Monthly + the moment anyone posts feedback on it", "Reads our top-performing Instagram posts (likes, comments, saves, reach), explains its reasoning with the numbers on the card, and proposes next month's theme. Team feedback re-evaluates the theme immediately; each adjustment is credited in bold to whoever asked for it."],
    ["Cycle rotation", "When Post 10 is checked done", "Archives the finishing grid to Drive (Grid Archive), deletes completed cards, writes the next dated Post cards."],
    ["Loft deliveries → Courtney", "Every 15 min until Oct 2026", "New files the Loft delivers for Lavalle Haus are copied into Lavalle Sisters → <working month> → Courtney to edit → From the Loft."],
    ["Loft strategy PDF from Slack", "Every 15 min until Oct 2026 (needs Slack files permission)", "Files the Loft's monthly strategy PDF into Drive → Strategy & Reports → Strategy Outline."],
    ["Reel / cover link-up (The Fold)", "Every 15 min", "A reel named “3” or “reel 3” dropped into a month's Reels folder links to Post 3; numbered cover photos dress their cards; board backgrounds follow designated picks."],
    ["Links card", "Every 15 min", "The Links card in Strategy Outline always points at the month we're working in: the month folder, Cover photos, Courtney to edit, Reels, Carousels, Strategy outline, plus the Grid Archive."],
    ["Caption approval", "When you tick “Approve caption + hashtags” on a card", "An APPROVED tag shows on the card face. When all of OUR 1–42 are approved, the Strategy Outline PDF builds itself (see above)."],
    ["Save arrangement", "When you hit Save in the grid editor", "The grid IS the sequence: tile 1 is Post 1 … tile 42 is Post 42 (grid 1 = Schedule 1-21, grid 2 = Schedule 22-42). Swapping two tiles swaps their cards too — caption, hashtags, approval and Courtney concept travel with the photo; a tray photo dropped in keeps the slot's caption. Dates re-flow from the slot (each of our posts advances a day, Courtney's share the day before it). The montage, the Grid card and the Strategy Outline follow."],
  ];
  // ── Team roster: remove a member everywhere (admin) ───────────────────────
  // Pulls the name off the roster AND off every card's member list, so the
  // assign dropdown (which unions roster + names already on cards) forgets
  // them too. Login revoke stays separate on the Action Items roster.
  if (op === "team_remove_member" && req.method === "POST") {
    const authTR = await getAuthEarly(req);
    if (!ownerRole(authTR)) { res.status(403).json({ error: "Owner only." }); return; }
    const nmTR = String((req.body || {}).name || "").trim().toLowerCase();
    if (!nmTR) { res.status(400).json({ error: "name required" }); return; }
    const rawTR = await kvGet("lavalle_data"); const blobTR = Array.isArray(rawTR) ? rawTR[0] : rawTR;
    if (!blobTR) { res.json({ ok: false }); return; }
    let rosterHits = 0, cardHits = 0;
    const abTR = blobTR.actionsBoard || {};
    if (Array.isArray(abTR.team)) { const b4 = abTR.team.length; abTR.team = abTR.team.filter((t) => ((t && t.name) || "").trim().toLowerCase() !== nmTR); rosterHits = b4 - abTR.team.length; }
    for (const [bkTR, bdTR] of Object.entries(blobTR.boards || {})) {
      if (bkTR.startsWith("_") || !bdTR || !bdTR.cards) continue;
      for (const cdTR of bdTR.cards) {
        const msTR = cdTR.members || [];
        const keepTR = msTR.filter((m) => String(m).trim().toLowerCase() !== nmTR);
        if (keepTR.length !== msTR.length) { cdTR.members = keepTR; cardHits++; }
      }
    }
    await kvSet("lavalle_data", blobTR);
    res.json({ ok: true, roster: rosterHits, cards: cardHits });
    return;
  }

  // ── LH Operations: Inventory column ⟷ Shopify autosync ────────────────────
  // Recurring (pinger). Matches each card in the Inventory column to its
  // Shopify product by name, sets the card photo to the product's CURRENT
  // featured image (Shopify CDN URL — image swaps show up on their own) and
  // writes the live on-hand count as the first line of the notes, keeping the
  // human notes below it. Cards with no Shopify match (Amazon-only stock,
  // discontinued pieces) are left untouched.
  if (op === "ops_inventory_sync" && req.method === "POST") {
    const okKeyOI = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authOI = okKeyOI ? null : await getAuthEarly(req);
    if (!okKeyOI && !ownerRole(authOI)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const soOI = (await kvGet("shopify_oauth")) || {};
    const stokOI = soOI.accessToken || soOI.token;
    if (!stokOI || !soOI.shop) { res.json({ ok: false, error: "shopify_not_connected" }); return; }
    const qOI = `query { products(first: 150, query: "status:active") { edges { node { title status tags onlineStoreUrl featuredImage { url(transform: { maxWidth: 1600 }) } totalInventory productType variants(first: 5) { edges { node { inventoryPolicy inventoryQuantity inventoryItem { tracked } } } } } } } }`;
    const rOI = await fetch(`https://${soOI.shop}/admin/api/2025-10/graphql.json`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": stokOI },
      body: JSON.stringify({ query: qOI }),
    });
    const dOI = await rOI.json().catch(() => ({}));
    // HER RULE (Aug 25): only SKUs LIVE ON THE WEBSITE sync to the Inventory
    // column — active-but-unpublished products don't get cards, counts, or a
    // Pre-Orders line. onlineStoreUrl is null when a product isn't published
    // to the Online Store channel.
    const prodsOI = (((dOI.data || {}).products || {}).edges || []).filter((e) => e.node.onlineStoreUrl).map((e) => ({ title: e.node.title, image: (e.node.featuredImage || {}).url || null, inv: e.node.totalInventory, tags: e.node.tags || [], ptype: e.node.productType || "", oversell: ((e.node.variants || {}).edges || []).some((v) => v.node.inventoryPolicy === "CONTINUE"), tracked: ((e.node.variants || {}).edges || []).some((v) => ((v.node.inventoryItem || {}).tracked) !== false), approxInv: ((e.node.variants || {}).edges || []).reduce((a, v) => a + (Number(v.node.inventoryQuantity) || 0), 0) }));
    if (!prodsOI.length) { res.json({ ok: false, error: "no_products" }); return; }
    const rawOI = await kvGet("lavalle_data"); const blobOI = Array.isArray(rawOI) ? rawOI[0] : rawOI;
    const bdOI = blobOI && blobOI.boards && blobOI.boards["rh-operations"];
    if (!bdOI) { res.json({ ok: false }); return; }
    const invListOI = bdOI.lists.find((l) => /^inventory$/i.test((l.name || "").trim()));
    if (!invListOI) { res.json({ ok: false, error: "no_inventory_column" }); return; }
    let cardsOI = bdOI.cards.filter((c) => c.listId === invListOI.id);
    // Confirmed pairings: these cards carry the product's Shopify name from now on.
    const ALIAS_OI = { "candle sand": "Sandwax Refill Pouch", "raised arched onyx": "Onyx Arched Refillable Candle Set", "calcatta marble square": "Italian Viola Calcatta Refillable Candle Set" };
    const normOI = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    let renamedOI = 0;
    for (const cAl of cardsOI) { const al = ALIAS_OI[normOI(cAl.name)]; if (al && cAl.name !== al) { cAl.name = al; renamedOI++; } }
    // Self-healing: every active Shopify product (gift cards aside) gets a card
    // in the Inventory column, so new launches appear here on their own.
    // Self-cleanup for the same rule: a card this sync auto-created (sync line
    // only — no human notes, tags, members, or links) whose product is no
    // longer live comes back off the board. Human-touched cards always stay.
    let removedOI = 0;
    const liveSetOI = new Set(prodsOI.map((pp) => normOI(pp.title)));
    const untouchedOI = (c) => {
      const body = String(c.desc || "").split("\n").filter((l) => l.trim() && !l.startsWith("⟳")).join("");
      return !body && !(c.labels || []).length && !(c.members || []).length && !(c.links || []).length && !(c.attachments || []).length && !(c.checklist || []).length;
    };
    for (const cRm of [...cardsOI]) {
      if (/^pre-?orders/i.test(cRm.name || "")) continue;
      const cn = normOI(cRm.name);
      if (!cn || liveSetOI.has(cn) || [...liveSetOI].some((tn) => tn.includes(cn) || cn.includes(tn))) continue;
      if (!untouchedOI(cRm)) continue;
      bdOI.cards.splice(bdOI.cards.indexOf(cRm), 1);
      cardsOI = cardsOI.filter((x) => x !== cRm);
      removedOI++;
    }
    let createdOI = 0;
    for (const pEn of prodsOI) {
      if (/gift card/i.test(pEn.title)) continue;
      const tn = normOI(pEn.title);
      if (cardsOI.some((c) => { const cn = normOI(c.name); return cn === tn || cn.includes(tn) || tn.includes(cn); })) continue;
      const cNew = { id: "c" + Math.random().toString(36).slice(2, 10), listId: invListOI.id, name: pEn.title, desc: "", due: null, labels: [], members: [], attachments: [], links: [], done: false };
      bdOI.cards.push(cNew); cardsOI.push(cNew); createdOI++;
    }
    const sigOI = createHash("sha256").update(JSON.stringify([prodsOI, cardsOI.map((c) => c.id + (c.name || ""))])).digest("hex").slice(0, 12);
    const stOI = (await kvGet("ops_inventory_state")) || {};
    if (!(req.body || {}).force && !renamedOI && !createdOI && !removedOI && stOI.sig === sigOI) { res.json({ ok: true, skipped: true }); return; }
    // Cards no longer live on Shopify lose the auto "Shopify" chip; Amazon
    // chips (human-flagged) stay untouched. {setAmazon:[names]} flags cards.
    const cleanupChip = () => {
      for (const cCh of cardsOI) {
        if (cCh._matchedOI) { delete cCh._matchedOI; continue; }
        if (/^pre-?orders/i.test(cCh.name || "") || /^—/.test((cCh.name || "").trim())) continue;
        const kept = (cCh.labels || []).filter((lb) => (((typeof lb === "string" ? lb : (lb && lb.n)) || "").toLowerCase() !== "shopify"));
        if (kept.length !== (cCh.labels || []).length) { cCh.labels = kept; syncedOI++; }
      }
      // Amazon flags persist in KV and re-assert every run (stale-save proof).
      return (async () => {
        const flagsAz = new Set(((await kvGet("ops_amazon_flags")) || []).map(normOI));
        for (const nmAz of (Array.isArray((req.body || {}).setAmazon) ? req.body.setAmazon : [])) flagsAz.add(normOI(nmAz));
        await kvSet("ops_amazon_flags", [...flagsAz]);
        for (const cAz of cardsOI) {
          if (!flagsAz.has(normOI(cAz.name))) continue;
          if (!(cAz.labels || []).some((lb) => (((typeof lb === "string" ? lb : (lb && lb.n)) || "").toLowerCase() === "amazon"))) { cAz.labels = [...(cAz.labels || []), { n: "Amazon", c: "#E9E6DF" }]; syncedOI++; }
        }
      })();
    };
    // Manual pre-order units (Amazon-only stock with a shipment coming, e.g.
    // Dark Dough Bowl 200): {setPreorder:[{name,units,note}]} persists in KV
    // and is re-asserted every run — the card face shows "Pre-order N".
    const manualPre = (await kvGet("ops_preorder_manual")) || {};
    for (const mp of (Array.isArray((req.body || {}).setPreorder) ? req.body.setPreorder : [])) {
      if (!mp || !mp.name) continue;
      if (mp.remove) delete manualPre[normOI(mp.name)];
      else manualPre[normOI(mp.name)] = { units: Number(mp.units) || 0, note: String(mp.note || "") };
    }
    await kvSet("ops_preorder_manual", manualPre);
    const applyManualPre = () => {
      for (const cMP of cardsOI) {
        const rec = manualPre[normOI(cMP.name)];
        if (!rec) {
          // entry removed → its ⟳ Pre-order line comes off the card too
          if ((cMP.desc || "").split("\n").some((l) => l.startsWith("⟳ Pre-order"))) {
            cMP.desc = String(cMP.desc || "").split("\n").filter((l) => !l.startsWith("⟳ Pre-order")).join("\n").replace(/^\n+/, "");
            syncedOI++;
          }
          continue;
        }
        const lineMP = "⟳ Pre-order · " + rec.units + " units incoming" + (rec.note ? " · " + rec.note : "");
        const restMP = String(cMP.desc || "").split("\n").filter((l) => !l.startsWith("⟳ Pre-order")).join("\n").replace(/^\n+/, "");
        const wantMP = lineMP + (restMP ? "\n" + restMP : "");
        if (cMP.desc !== wantMP) { cMP.desc = wantMP; syncedOI++; }
        const hasPre = (cMP.labels || []).some((lb) => (((typeof lb === "string" ? lb : (lb && lb.n)) || "").toLowerCase()) === "pre-order");
        if (!hasPre) { cMP.labels = [{ n: "Pre-Order", c: "#D9CFC1" }, ...(cMP.labels || [])]; syncedOI++; }
      }
    };
    // Amazon restock sync (daily) → which listing(s) belong to which card.
    const amzItemsOI = Object.values(((blobOI.amazonRestock || {}).items) || {});
    const AMZ_MAP_OI = [
      [/candle sand|sand ?wax refill/i, "sandwax refill pouch"],
      [/small apple|mini.*apple/i, "mini spiced apple botanical candle"],
      [/large apple/i, "large spiced apple botanical candle"],
      [/bath salt/i, "bath salts"],
      [/dough bowl/i, "dark dough bowl"],
    ];
    const amzFor = (cardName) => {
      const cn = normOI(cardName);
      return amzItemsOI.filter((it) => { const m = AMZ_MAP_OI.find(([rx]) => rx.test(it.name || "")); return m && m[1] === cn; });
    };
    // Pre-order detection shared by the status tags and the Pre-Orders card.
    const isPreOI = (pp) => /pre.?order/i.test((pp.tags || []).join(" ")) || (pp.inv != null && pp.inv < 0) || (pp.oversell && (pp.inv == null || pp.inv < 1));
    let syncedOI = 0;
    for (const cOI of cardsOI) {
      if (/^pre-?orders/i.test(cOI.name || "")) continue;
      const cn = normOI(cOI.name);
      if (!cn) continue;
      const hit = prodsOI.find((pp) => normOI(pp.title) === cn) || prodsOI.find((pp) => normOI(pp.title).includes(cn) || cn.includes(normOI(pp.title)));
      if (!hit) continue;
      if (hit.image) cOI.cover = hit.image;
      // HER RULE: every synced SKU carries an auto status tag — "Pre-Order" when
      // the product is on pre-order, "Live" otherwise — and it flips on its own.
      // Status: Pre-Order beats Sold Out beats Live. Sold Out = zero on hand
      // with overselling off and no pre-order tag (her rule, Aug 25).
      const statusOI = isPreOI(hit) ? { n: "Pre-Order", c: "#D9CFC1" } : (hit.tracked && hit.inv != null && hit.inv <= 0) ? { n: "Sold Out", c: "#F3E6E3" } : { n: "Live", c: "#DCE3DC" };
      // Channel tags: "Shopify" is automatic (product is live on the site);
      // "Amazon" is a human flag the sync keeps but never adds or removes.
      const otherLb = (cOI.labels || []).filter((lb) => { const nmLb = ((typeof lb === "string" ? lb : (lb && lb.n)) || "").toLowerCase(); return nmLb !== "live" && nmLb !== "pre-order" && nmLb !== "preorder" && nmLb !== "sold out" && nmLb !== "shopify"; });
      cOI.labels = [statusOI, { n: "Shopify", c: "#C6CCCF" }, ...otherLb];
      cOI._matchedOI = true;
      const lineOI = "⟳ Shopify · " + (!hit.tracked ? (hit.approxInv > 0 ? "≈" + hit.approxInv + " (not tracked by Shopify)" : "not tracked by Shopify") : (hit.inv == null ? "—" : hit.inv) + " on hand") + " · synced " + new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
      // Amazon channel: matched against the daily Amazon restock sync — auto
      // "Amazon" chip + a second ⟳ line with FBA availability.
      const amzOI = amzFor(cOI.name);
      let amzLineOI = "";
      if (amzOI.length) {
        const avA = amzOI.reduce((a, x) => a + (Number(x.available) || 0), 0);
        const inA = amzOI.reduce((a, x) => a + (Number(x.inbound) || 0), 0);
        amzLineOI = "\n⟳ Amazon · " + avA + " available" + (inA ? " · " + inA + " inbound" : "") + (amzOI.some((x) => x.alert === "out_of_stock") ? " · OUT OF STOCK" : "");
        if (!(cOI.labels || []).some((lb) => (((typeof lb === "string" ? lb : (lb && lb.n)) || "").toLowerCase() === "amazon"))) cOI.labels = [...cOI.labels, { n: "Amazon", c: "#E9E6DF" }];
      }
      const restOI = String(cOI.desc || "").split("\n").filter((l) => !l.startsWith("⟳ Shopify") && !l.startsWith("⟳ Amazon") && !l.startsWith("⟳ Pre-order")).join("\n").replace(/^\n+/, "");
      cOI.desc = lineOI + amzLineOI + (restOI ? "\n\n" + restOI.replace(/^\n+/, "") : "");
      syncedOI++;
    }
    // Pre-Orders card: one auto-maintained card listing everything currently on
    // pre-order — tagged pre-order in Shopify, selling with no stock (oversell
    // on), or oversold (negative on-hand = units already pre-sold). The card's
    // "Notes:" section is human-owned and survives every sync.
    const preOI = prodsOI.filter(isPreOI);
    let preCard = bdOI.cards.find((c) => c.listId === invListOI.id && /^pre-?orders/i.test(c.name || ""));
    if (!preCard) {
      preCard = { id: "c" + Math.random().toString(36).slice(2, 10), listId: invListOI.id, name: "Pre-Orders — autosync", desc: "", due: null, labels: [{ n: "Ordered", c: "#D9CFC1" }], members: [], attachments: [], links: [], done: false };
      const firstInv = bdOI.cards.findIndex((c) => c.listId === invListOI.id);
      if (firstInv >= 0) bdOI.cards.splice(firstInv, 0, preCard); else bdOI.cards.push(preCard);
    }
    const noteIx = String(preCard.desc || "").indexOf("Notes:");
    const humanOI = noteIx >= 0 ? String(preCard.desc).slice(noteIx) : "Notes:\n- Onyx Arched Refillable Candle Set: 20 units coming.";
    const preLines = preOI.length
      ? preOI.map((pp) => "• " + pp.title + (pp.inv != null && pp.inv < 0 ? " — " + (-pp.inv) + " pre-sold beyond stock" : " — on hand " + (pp.inv == null ? "—" : pp.inv))).join("\n")
      : "• nothing on pre-order right now";
    const preDesc = "⟳ Shopify pre-orders · synced " + new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }) + "\n" + preLines + "\n\n" + humanOI;
    if (preCard.desc !== preDesc) { preCard.desc = preDesc; syncedOI++; }
    applyManualPre();
    await cleanupChip();
    // {setBg:"url"} persists to KV and is RE-ASSERTED every run — a stale
    // browser tab saving old state can no longer bring the Refillery Haus
    // background back (rebrand: no old-name imagery).
    if ((req.body || {}).setBg) await kvSet("ops_board_bg", String(req.body.setBg).slice(0, 500));
    const wantBgOI = await kvGet("ops_board_bg");
    if (wantBgOI && bdOI.bg !== wantBgOI) { bdOI.bg = wantBgOI; syncedOI++; }
    // HER RULE: the Inventory column reads clearly divided — BODY CARE first,
    // then HOME — with divider cards, regrouped automatically every sync.
    // Category scheme (her order, Aug 26): Body Care → Bundles → Diffusers →
    // Stone Vessels & Candle Sand → Botanical Candles (phase-outs at the bottom).
    const CAT_ORDER_OI = [["— BODY CARE —", "body"], ["— BUNDLES —", "bundle"], ["— DIFFUSERS —", "diffuser"], ["— CANDLE SAND VESSELS —", "stone"], ["— BOTANICAL CANDLES —", "botanical"]];
    const kindOf = (cK) => {
      const cn = normOI(cK.name);
      const hitK = prodsOI.find((pp) => normOI(pp.title) === cn) || prodsOI.find((pp) => normOI(pp.title).includes(cn) || cn.includes(normOI(pp.title)));
      const basis = ((hitK && (hitK.ptype + " " + hitK.title)) || cK.name || "");
      if (/pair\b|bundle|duo\b/i.test(basis)) return "bundle";
      if (/diffuser/i.test(basis)) return "diffuser";
      if (/botanical|spiced apple/i.test(basis)) return "botanical";
      if (/scrub|lotion|body|oil|soap|salt|cr[eè]me|cream|butter|wash|serum|skin/i.test(basis)) return "body";
      return "stone"; // vessels, candle sand, sandwax, dough bowl
    };
    const ensureDivOI = (nmD) => {
      let dv = bdOI.cards.find((c) => c.listId === invListOI.id && (c.name || "").trim().toLowerCase() === nmD.toLowerCase());
      if (!dv) { dv = { id: "c" + Math.random().toString(36).slice(2, 10), listId: invListOI.id, name: nmD, desc: "", labels: [], members: [], attachments: [], links: [], done: false }; bdOI.cards.push(dv); }
      return dv;
    };
    // retire dividers that aren't part of the current scheme (e.g. — HOME —)
    const validDivsOI = new Set(CAT_ORDER_OI.map(([nm]) => nm.toLowerCase()));
    bdOI.cards = bdOI.cards.filter((c) => !(c.listId === invListOI.id && /^—/.test((c.name || "").trim()) && !validDivsOI.has((c.name || "").trim().toLowerCase())));
    cardsOI = cardsOI.filter((c) => bdOI.cards.includes(c));
    const divsOI = CAT_ORDER_OI.map(([nm]) => ensureDivOI(nm));
    const invCardsAll = bdOI.cards.filter((c) => c.listId === invListOI.id);
    const headOI = invCardsAll.filter((c) => /^automations\b/i.test(c.name || "") || /^pre-?orders/i.test(c.name || "") || /^⚠/.test((c.name || "").trim()));
    const restInv = invCardsAll.filter((c) => !headOI.includes(c) && !/^—/.test((c.name || "").trim()));
    const desiredOI = [...headOI];
    CAT_ORDER_OI.forEach(([nm, kind], ixD) => { desiredOI.push(divsOI[ixD]); desiredOI.push(...restInv.filter((c) => kindOf(c) === kind)); });
    const curOrder = invCardsAll.map((c) => c.id).join(",");
    if (desiredOI.map((c) => c.id).join(",") !== curOrder) {
      const othersOI = bdOI.cards.filter((c) => c.listId !== invListOI.id);
      const firstIx = bdOI.cards.findIndex((c) => c.listId === invListOI.id);
      bdOI.cards = [...othersOI.slice(0, firstIx), ...desiredOI, ...othersOI.slice(firstIx)];
      syncedOI++;
    }
    if (syncedOI || renamedOI || createdOI || removedOI) await kvSet("lavalle_data", blobOI);
    await kvSet("ops_inventory_state", { sig: sigOI, at: Date.now() });
    res.json({ ok: true, synced: syncedOI, renamed: renamedOI, created: createdOI, removed: removedOI, products: prodsOI.length });
    return;
  }

  // ── LH Operations: Automations card (visible to admins only — the client
  // hides any card named "Automations…" from non-owner logins) ───────────────
  if (op === "ops_automations_card" && req.method === "POST") {
    const okKeyOA = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authOA = okKeyOA ? null : await getAuthEarly(req);
    if (!okKeyOA && !ownerRole(authOA)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const OPS_AUTOMATIONS = [
      ["Product stats — hover intelligence", "Every 15 min (refreshes when 6h old)", "Builds each SKU's 30-day picture from Shopify analytics + the Amazon sync — weekly velocity and trend, net sales, page visits, true page conversion vs store average, weeks of cover, FBA stock — and names the single lever to pull next week. Shown when an admin hovers a product card in Inventory; never visible to team members."],
      ["Pre-order guard", "Every 15 min", "Watches the pre-order setup (model: the preorder TAG pins the button, the allocation is available > 0 + DENY on the capped three, Onyx Arched stays CONTINUE while allocation-less). Alarms if a tag disappears, a capped product loses DENY, its allocation hits zero (off sale under DENY), the storefront stops being purchasable, or any available/tags value moves between checks (spelled out old → new). Findings appear as an ⚠ card at the top of Inventory and clear when healthy. Never writes to Shopify."],
      ["To be filmed ⟷ PR pairing", "Every 15 min", "Every card in To be filmed (4 per Q) automatically gets a matching card in the PR column (name-matched, created once, never deleted), so PR always mirrors what's being filmed."],
      ["Inventory — Shopify autosync", "Every 15 min (re-runs when Shopify stock, product photos, or the Inventory column change)", "Keeps the Inventory column mirroring the products LIVE on the website: every live product gets a card automatically (unpublished SKUs and gift cards excluded), each card wears the product's current Shopify photo, the live on-hand count is written as the first line of the notes (your own notes stay underneath), each SKU carries an auto status tag (Live, Sold Out when on-hand hits zero, or Pre-Order) plus channel tags — Shopify automatic; Amazon automatic when the product matches the daily Amazon restock sync (a second ⟳ line shows FBA availability + inbound), or flagged by you — and the column stays grouped in her order — Body Care, Bundles, Diffusers, Candle Sand Vessels, Botanical Candles (phase-outs at the bottom) — with divider cards. A Pre-Orders card lists everything currently on pre-order (tagged pre-order, selling with no stock, or oversold) with its own human Notes section. Cards without a Shopify match (e.g. Amazon-only stock) are left alone."],
    ];
    const rawOA = await kvGet("lavalle_data"); const blobOA = Array.isArray(rawOA) ? rawOA[0] : rawOA;
    const bdOA = blobOA && blobOA.boards && blobOA.boards["rh-operations"];
    if (!bdOA) { res.json({ ok: false }); return; }
    const listOA = bdOA.lists[0];
    let cardOA = bdOA.cards.find((c) => /^automations\b/i.test(c.name || ""));
    if (!cardOA) { cardOA = { id: "c" + Math.random().toString(36).slice(2, 10), listId: listOA.id, name: "Automations — what runs on its own", labels: [], members: [], attachments: [], links: [], done: false }; bdOA.cards.unshift(cardOA); }
    cardOA.name = "Automations — what runs on its own";
    cardOA.desc = "Plain-English map of everything automated on this board. Each line: WHAT · WHEN it triggers · what it does.\n\n" + OPS_AUTOMATIONS.map(([w, t, d]) => "• " + w + "\n  Trigger: " + t + "\n  " + d).join("\n\n") + "\n\n(Updated automatically whenever an automation is added or changed.)";
    await kvSet("lavalle_data", blobOA);
    res.json({ ok: true, automations: OPS_AUTOMATIONS.length });
    return;
  }

  // ── LH Operations: "To be filmed" ⟷ PR pairing ────────────────────────────
  // Recurring (pinger). Every card in "To be filmed (4 per Q)" gets a matching
  // card in the PR column (name-matched, created once, never deleted) so PR
  // always mirrors what's being filmed. Optional {add:"Name"} drops a new card
  // into To be filmed first — it pairs into PR on the same run.
  // ── Generic card patch (owner) — small targeted edits without a full-state
  // save: {board, cardId, patch:{name,desc,labels,members,cover,due,links}}.
  if (op === "card_patch" && req.method === "POST") {
    const authCP = await getAuthEarly(req);
    if (!ownerRole(authCP)) { res.status(403).json({ error: "Owner only." }); return; }
    const bCP = req.body || {};
    const rawCP = await kvGet("lavalle_data"); const blobCP = Array.isArray(rawCP) ? rawCP[0] : rawCP;
    const bdCP = blobCP && blobCP.boards && blobCP.boards[String(bCP.board || "")];
    if (bCP.create && bdCP) {
      const listCP = (bdCP.lists || []).find((l) => (bCP.create.listName ? new RegExp(bCP.create.listName, "i").test(l.name || "") : l.id === bCP.create.listId));
      if (!listCP) { res.status(404).json({ error: "No such list." }); return; }
      const cNew = { id: "c" + Math.random().toString(36).slice(2, 10), listId: listCP.id, name: String(bCP.create.name || "New card").slice(0, 140), desc: String(bCP.create.desc || ""), due: null, labels: Array.isArray(bCP.create.labels) ? bCP.create.labels : [], members: Array.isArray(bCP.create.members) ? bCP.create.members : [], attachments: [], links: [], done: false, launchMonth: bCP.create.launchMonth || null, due: bCP.create.due || null };
      bdCP.cards.push(cNew);
      await kvSet("lavalle_data", blobCP);
      res.json({ ok: true, created: { id: cNew.id, name: cNew.name, list: listCP.name } });
      return;
    }
    const cCP = bdCP && (bdCP.cards || []).find((c) => c.id === bCP.cardId);
    if (!cCP) { res.status(404).json({ error: "No such card." }); return; }
    const FIELDS_CP = ["name", "desc", "labels", "members", "cover", "due", "links", "listId"];
    for (const k of FIELDS_CP) if (bCP.patch && Object.prototype.hasOwnProperty.call(bCP.patch, k)) cCP[k] = bCP.patch[k];
    await kvSet("lavalle_data", blobCP);
    res.json({ ok: true, card: { id: cCP.id, name: cCP.name } });
    return;
  }

  // ── Generic list patch (owner): rename a column / remove an EMPTY column ──
  if (op === "list_patch" && req.method === "POST") {
    const authLP = await getAuthEarly(req);
    if (!ownerRole(authLP)) { res.status(403).json({ error: "Owner only." }); return; }
    const bLP = req.body || {};
    const rawLP = await kvGet("lavalle_data"); const blobLP = Array.isArray(rawLP) ? rawLP[0] : rawLP;
    const bdLP = blobLP && blobLP.boards && blobLP.boards[String(bLP.board || "")];
    const lLP = bdLP && (bdLP.lists || []).find((l) => l.id === bLP.listId);
    if (!lLP) { res.status(404).json({ error: "No such list." }); return; }
    if (bLP.remove) {
      if ((bdLP.cards || []).some((c) => c.listId === lLP.id)) { res.status(400).json({ error: "List not empty." }); return; }
      bdLP.lists = bdLP.lists.filter((l) => l.id !== lLP.id);
    } else if (bLP.patch && bLP.patch.name) { lLP.name = String(bLP.patch.name).slice(0, 80); }
    await kvSet("lavalle_data", blobLP);
    res.json({ ok: true });
    return;
  }

  if (op === "ops_film_pr_sync" && req.method === "POST") {
    const okKeyFP = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authFP = okKeyFP ? null : await getAuthEarly(req);
    if (!okKeyFP && !ownerRole(authFP)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const rawFP = await kvGet("lavalle_data"); const blobFP = Array.isArray(rawFP) ? rawFP[0] : rawFP;
    const bdFP = blobFP && blobFP.boards && blobFP.boards["rh-operations"];
    if (!bdFP) { res.json({ ok: false }); return; }
    const filmFP = bdFP.lists.find((l) => /^to be filmed/i.test((l.name || "").trim()));
    const prFP = bdFP.lists.find((l) => /^pr$/i.test((l.name || "").trim()) || /ugc.*pr.*schedule|pr.*ugc.*schedule|^ugc\s*\/\s*pr/i.test((l.name || "").trim()));
    if (!filmFP || !prFP) { res.json({ ok: false, error: "columns missing" }); return; }
    const normFP = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const mkFP = (listId, name, desc) => ({ id: "c" + Math.random().toString(36).slice(2, 10), listId, name, desc: desc || "", due: null, labels: [], members: [], attachments: [], links: [], done: false });
    let addedFP = 0, pairedFP = 0;
    const bFP = req.body || {};
    // Seeded film cards persist in KV and are re-ensured every run, so a
    // stale-tab save can't erase them.
    const seedsFP = ((await kvGet("ops_film_seeds")) || []);
    if (bFP.add) { const nmFP = String(bFP.add).slice(0, 120); if (!seedsFP.some((x) => normFP(x) === normFP(nmFP))) seedsFP.push(nmFP); await kvSet("ops_film_seeds", seedsFP); }
    if (Array.isArray(bFP.removeSeed)) { const keep = seedsFP.filter((x) => !bFP.removeSeed.some((r) => normFP(r) === normFP(x))); await kvSet("ops_film_seeds", keep); seedsFP.length = 0; seedsFP.push(...keep); }
    for (const nmFP of seedsFP) {
      if (!bdFP.cards.some((c) => c.listId === filmFP.id && normFP(c.name) === normFP(nmFP))) { bdFP.cards.push(mkFP(filmFP.id, nmFP)); addedFP++; }
    }
    const skipFP = (c) => /^notes?$/i.test((c.name || "").trim()) || /^automations\b/i.test(c.name || "") || /^—/.test((c.name || "").trim());
    const prNamesFP = new Set(bdFP.cards.filter((c) => c.listId === prFP.id).map((c) => normFP(c.name)));
    for (const fcFP of bdFP.cards.filter((c) => c.listId === filmFP.id && !skipFP(c))) {
      if (prNamesFP.has(normFP(fcFP.name))) continue;
      bdFP.cards.push(mkFP(prFP.id, fcFP.name, "Paired automatically from To be filmed (4 per Q)."));
      prNamesFP.add(normFP(fcFP.name)); pairedFP++;
    }
    if (addedFP || pairedFP) await kvSet("lavalle_data", blobFP);
    res.json({ ok: true, added: addedFP, paired: pairedFP });
    return;
  }

  // ── Platform-sized covers (rule Aug 25 2026): when a post's IG and TikTok
  // formats need different shapes (reel 9:16 vs feed 4:5), save BOTH sizes to
  // Drive → <Month> → Cover photos as "<n>-IG.jpg" / "<n>-TT.jpg" and sync the
  // links onto the card: coverUrl = the IG file, plus a "Cover n-TT" link.
  // Staged: a few posts per tick; the pinger finishes the rest.
  if (op === "sisters_cover_sizes" && req.method === "POST") {
    const okKeyCS = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authCS = okKeyCS ? null : await getAuthEarly(req);
    if (!okKeyCS && !ownerRole(authCS)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const gtCS = await googleToken(); if (!gtCS) { res.json({ ok: false, error: "google_not_connected" }); return; }
    const lsCS = async (fid) => (await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("'" + fid + "' in parents and trashed=false") + "&fields=files(id,name,mimeType)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true", { headers: { Authorization: "Bearer " + gtCS } })).json()).files || [];
    const monthCS = String((await kvGet(SBOARD.monthDefaultKv)) || "September");
    const topCS = await lsCS(SBOARD.driveRootId);
    const mFCS = topCS.find((f) => f.mimeType === "application/vnd.google-apps.folder" && (f.name || "").trim().toLowerCase() === monthCS.toLowerCase());
    const cpCS = mFCS && (await lsCS(mFCS.id)).find((f) => f.mimeType === "application/vnd.google-apps.folder" && /^cover photos$/i.test((f.name || "").trim()));
    if (!cpCS) { res.json({ ok: false, error: "cover photos folder missing" }); return; }
    const existCS = await lsCS(cpCS.id);
    const g1CS = (await kvGet("sisters_grid_tiles_1" + SBOARD.kvSuffix)) || { tiles: [] };
    const g2CS = (await kvGet("sisters_grid_tiles_2" + SBOARD.kvSuffix)) || { tiles: [] };
    const tilesCS = [...(g1CS.tiles || []), ...(g2CS.tiles || [])];
    const rawCS = await kvGet("lavalle_data"); const blobCS = Array.isArray(rawCS) ? rawCS[0] : rawCS;
    const bdCS = blobCS && blobCS.boards && blobCS.boards[SBOARD.key];
    if (!bdCS) { res.json({ ok: false }); return; }
    const schedCS = bdCS.lists.filter((l) => /^schedule/i.test(l.name || "")).map((l) => l.id);
    const cardCS = (n) => bdCS.cards.find((c) => schedCS.includes(c.listId) && new RegExp("^post\\s*" + n + "\\b", "i").test(c.name || ""));
    const lbOf = (c, pre) => ((c.labels || []).map((lb) => (typeof lb === "string" ? lb : (lb && lb.n) || "")).find((x) => x.toUpperCase().startsWith(pre)) || "");
    const shapeOf = (lab) => /reel|ftc|b-?roll/i.test(lab) ? "V" : /carousel|static/i.test(lab) ? "F" : null; // V = 1080x1920, F = 1080x1350
    const stCS = (await kvGet("sisters_cover_sizes_state")) || { done: {} };
    for (const nRe of (Array.isArray((req.body || {}).redo) ? req.body.redo : [])) delete stCS.done[Number(nRe)];
    const JimpCS = (await import("jimp")).default;
    let madeCS = 0, budgetCS = 6;
    for (let n = 1; n <= tilesCS.length && budgetCS > 0; n++) {
      const t = tilesCS[n - 1]; const c = cardCS(n); if (!t || !c) continue;
      const ig = shapeOf(lbOf(c, "IG")); const tt = shapeOf(lbOf(c, "TT"));
      if (!ig || !tt || ig === tt) continue; // one shape fits both → classic single cover
      const sigN = String(t.cover) + "|" + ig + tt;
      if (stCS.done[n] === sigN && (c.coverUrl || "").trim()) continue;
      try {
        const uCS = /^https?:/.test(t.cover) ? t.cover : APP_ORIGIN + t.cover;
        const rb = await fetch(uCS); if (!rb.ok) continue;
        const srcCS = await JimpCS.read(Buffer.from(await rb.arrayBuffer()));
        const outs = [["IG", ig], ["TT", tt]];
        const linksCS = {};
        for (const [plat, shp] of outs) {
          const im = srcCS.clone().cover(1080, shp === "V" ? 1920 : 1350); im.quality(88);
          const buf = await im.getBufferAsync(JimpCS.MIME_JPEG);
          const nm = n + "-" + plat + ".jpg";
          const prev = existCS.find((f) => (f.name || "").trim().toLowerCase() === nm.toLowerCase());
          let fidCS;
          if (prev) {
            await fetch(`https://www.googleapis.com/upload/drive/v3/files/${prev.id}?uploadType=media&supportsAllDrives=true`, { method: "PATCH", headers: { Authorization: "Bearer " + gtCS, "Content-Type": "image/jpeg" }, body: buf });
            fidCS = prev.id;
          } else {
            const meta = JSON.stringify({ name: nm, parents: [cpCS.id] });
            const bnd = "lhb" + Math.random().toString(36).slice(2, 10);
            const body = Buffer.concat([Buffer.from(`--${bnd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${bnd}\r\nContent-Type: image/jpeg\r\n\r\n`), buf, Buffer.from(`\r\n--${bnd}--`)]);
            const cr = await (await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name", { method: "POST", headers: { Authorization: "Bearer " + gtCS, "Content-Type": `multipart/related; boundary=${bnd}` }, body })).json();
            fidCS = cr.id; if (fidCS) existCS.push({ id: fidCS, name: nm });
          }
          if (fidCS) linksCS[plat] = "https://drive.google.com/file/d/" + fidCS + "/view";
        }
        if (linksCS.IG) c.coverUrl = linksCS.IG;
        if (linksCS.TT) {
          const keepL = (c.links || []).filter((L) => !(new RegExp("^cover\\s*" + n + "-tt$", "i").test(L.n || "")));
          c.links = [...keepL, { id: "l" + Math.random().toString(36).slice(2, 8), n: "Cover " + n + "-TT", u: linksCS.TT }];
        }
        stCS.done[n] = sigN; madeCS++; budgetCS--;
      } catch (eCS) {}
    }
    // Non-split posts: the classic numbered file in Cover photos is the card's
    // cover photo link — and when the GRID photo is replaced, the Drive file
    // itself is refreshed in place (same file id, links never break).
    let linkedCS = 0;
    stCS.classic = stCS.classic || {};
    const uploadToCS = async (fidU, nmU, buf) => {
      if (fidU) {
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fidU}?uploadType=media&supportsAllDrives=true`, { method: "PATCH", headers: { Authorization: "Bearer " + gtCS, "Content-Type": "image/jpeg" }, body: buf });
        return fidU;
      }
      const meta = JSON.stringify({ name: nmU, parents: [cpCS.id] });
      const bnd = "lhc" + Math.random().toString(36).slice(2, 10);
      const body = Buffer.concat([Buffer.from(`--${bnd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${bnd}\r\nContent-Type: image/jpeg\r\n\r\n`), buf, Buffer.from(`\r\n--${bnd}--`)]);
      const cr = await (await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name", { method: "POST", headers: { Authorization: "Bearer " + gtCS, "Content-Type": `multipart/related; boundary=${bnd}` }, body })).json();
      if (cr.id) existCS.push({ id: cr.id, name: nmU });
      return cr.id || null;
    };
    for (let n = 1; n <= tilesCS.length && budgetCS > 0; n++) {
      const t = tilesCS[n - 1]; const c = cardCS(n); if (!t || !c) continue;
      const igC = shapeOf(lbOf(c, "IG")); const ttC = shapeOf(lbOf(c, "TT"));
      if (igC && ttC && igC !== ttC) continue; // split posts handled above
      const shpC = igC || ttC || "F";
      const sig2 = createHash("sha256").update(String(t.cover) + "|classic|" + shpC).digest("hex").slice(0, 10);
      const hasUrl = !!(c.coverUrl || "").trim();
      if (stCS.classic[n] === sig2 && hasUrl) continue;
      let fC = existCS.find((f) => new RegExp("^" + n + "\\.(jpe?g|png|heic|webp)$", "i").test((f.name || "").trim()));
      try {
        const photoChanged = (stCS.classic[n] && stCS.classic[n] !== sig2) || (!hasUrl && !stCS.classic[n] && fC);
        if (photoChanged || !fC) {
          // grid photo replaced (or file missing) → write the current grid
          // image into Drive at the post's shape
          const uC2 = /^https?:/.test(t.cover) ? t.cover : APP_ORIGIN + t.cover;
          const rb2 = await fetch(uC2); if (!rb2.ok) continue;
          const im2 = (await JimpCS.read(Buffer.from(await rb2.arrayBuffer()))).cover(1080, shpC === "V" ? 1920 : 1350); im2.quality(88);
          const fid2 = await uploadToCS(fC && fC.id, n + ".jpg", await im2.getBufferAsync(JimpCS.MIME_JPEG));
          if (!fC && fid2) fC = { id: fid2, name: n + ".jpg" };
          budgetCS--;
        }
        if (fC) { c.coverUrl = "https://drive.google.com/file/d/" + fC.id + "/view"; stCS.classic[n] = sig2; linkedCS++; madeCS++; }
      } catch (eC2) {}
    }
    if (madeCS) await kvSet("lavalle_data", blobCS);
    await kvSet("sisters_cover_sizes_state", stCS);
    res.json({ ok: true, made: madeCS, linked: linkedCS, month: monthCS });
    return;
  }

  // ── Card concepts (rule Aug 25 2026): every post title carries a short
  // "point of the post" — "Post n <date> — TF: linen set styling" — read from
  // the cover photo (vision recognizes The Fold vs Lavalle Haus product) and
  // the auto-generated caption. Courtney's cards and hand-written concepts are
  // never overwritten (we only re-touch concepts this op set itself).
  if (op === "sisters_card_concepts" && req.method === "POST") {
    const okKeyCC = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authCC = okKeyCC ? null : await getAuthEarly(req);
    if (!okKeyCC && !ownerRole(authCC)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const akeyCC = process.env.ANTHROPIC_API_KEY;
    if (!akeyCC) { res.json({ ok: false, error: "ANTHROPIC_API_KEY not set" }); return; }
    const g1CC = (await kvGet("sisters_grid_tiles_1" + SBOARD.kvSuffix)) || { tiles: [] };
    const g2CC = (await kvGet("sisters_grid_tiles_2" + SBOARD.kvSuffix)) || { tiles: [] };
    const tilesCC = [...(g1CC.tiles || []), ...(g2CC.tiles || [])];
    const rawCC = await kvGet("lavalle_data"); const blobCC = Array.isArray(rawCC) ? rawCC[0] : rawCC;
    const bdCC = blobCC && blobCC.boards && blobCC.boards[SBOARD.key];
    if (!bdCC || !tilesCC.length) { res.json({ ok: false }); return; }
    const schedCC = bdCC.lists.filter((l) => /^schedule/i.test(l.name || "")).map((l) => l.id);
    const RX_CC = /^(post\s*\d+(?:\s+[A-Za-z]+\s+\d+)?)(?:\s*[—–-]\s*(.+))?$/i;
    const cardCC = (n) => bdCC.cards.find((c) => schedCC.includes(c.listId) && new RegExp("^post\\s*" + n + "\\b", "i").test(c.name || ""));
    const hashCC = (x) => createHash("sha256").update(String(x)).digest("hex").slice(0, 10);
    const stCC = (await kvGet("sisters_card_concepts_state")) || { done: {}, set: {} };
    const todo = [];
    for (let n = 1; n <= tilesCC.length; n++) {
      const t = tilesCC[n - 1]; const c = cardCC(n); if (!t || !c) continue;
      if (t.tag === "C") continue; // Courtney's concepts are hers
      const m = RX_CC.exec(c.name || ""); if (!m) continue;
      const curCon = (m[2] || "").trim();
      if (curCon && curCon !== (stCC.set[n] || "")) continue; // human-written — leave it
      const sigN = hashCC(t.cover + "|" + (c.desc || "").slice(0, 300));
      if (curCon && stCC.done[n] === sigN) continue;
      todo.push({ n, cover: t.cover, caption: (c.desc || "").slice(0, 240), sig: sigN });
      if (todo.length >= 14) break; // staged — the pinger finishes the rest
    }
    if (!todo.length) { res.json({ ok: true, made: 0 }); return; }
    const JimpCC = (await import("jimp")).default;
    const contentCC = [];
    const okN = [];
    for (const it of todo) {
      try {
        const u = /^https?:/.test(it.cover) ? it.cover : APP_ORIGIN + it.cover;
        const rb = await fetch(u); if (!rb.ok) continue;
        const im = await JimpCC.read(Buffer.from(await rb.arrayBuffer())); im.resize(240, JimpCC.AUTO); im.quality(66);
        contentCC.push({ type: "text", text: "Post " + it.n + (it.caption ? " — caption: " + it.caption : " — no caption yet") });
        contentCC.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: (await im.getBufferAsync(JimpCC.MIME_JPEG)).toString("base64") } });
        okN.push(it.n);
      } catch (e1) {}
    }
    if (!okN.length) { res.json({ ok: true, made: 0, error: "no thumbs" }); return; }
    contentCC.push({ type: "text", text: 'These are Instagram posts for the Lavalle Sisters (two sister founders running two brands: THE FOLD = fashion/garments, LAVALLE HAUS = body care, candles, home). For EACH post, from the photo and caption, write a SHORT point-of-the-post: start with "TF:" if the photo is a Fold fashion/garment product, "LH:" if a Lavalle Haus body/home product, or no prefix if neither brand is the subject (BTS, founders, lifestyle). Then 3-5 plain words for what the post is doing (e.g. "TF: linen set styling", "LH: body scrub ritual", "brand shoot BTS"). No hashtags, no em dashes, no quotes. Return ONLY JSON: {"posts":[{"n":1,"concept":"…"}]} covering every post shown.' });
    const rCC = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": akeyCC, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 800, messages: [{ role: "user", content: contentCC }] }) });
    const dCC = await rCC.json(); if (dCC && dCC.error) { res.json({ ok: false, error: dCC.error.message }); return; }
    const tCC = (dCC.content || []).map((c) => c.text || "").join("");
    let parsedCC = {}; try { parsedCC = JSON.parse(tCC.slice(tCC.indexOf("{"), tCC.lastIndexOf("}") + 1)); } catch (e2) { res.json({ ok: false, error: "parse" }); return; }
    let madeCC = 0;
    for (const pcc of (parsedCC.posts || [])) {
      const it = todo.find((x) => x.n === Number(pcc.n)); if (!it) continue;
      const c = cardCC(it.n); if (!c) continue;
      const con = String(pcc.concept || "").replace(/[—–]/g, "-").replace(/["“”]/g, "").trim().slice(0, 60);
      if (!con) continue;
      const m = RX_CC.exec(c.name || ""); if (!m) continue;
      c.name = m[1].trim() + " — " + con;
      stCC.done[it.n] = it.sig; stCC.set[it.n] = con; madeCC++;
    }
    if (madeCC) await kvSet("lavalle_data", blobCC);
    await kvSet("sisters_card_concepts_state", stCC);
    res.json({ ok: true, made: madeCC, checked: todo.length });
    return;
  }

  // ── Pre-order guard (from the incident note, Aug 25 2026) ─────────────────
  // Every 15 min: pull all preorder-tagged products and their storefront pages.
  // Alarms when (a) a pre-order product with no available stock renders
  // "Add to Cart" (inventory or tags were overwritten), or (b) its policy is
  // CONTINUE while available ≤ 0 (allocation uncapped — DENY is the only cap).
  // Findings land as an ⚠ card at the top of the Inventory column; the card is
  // removed automatically when everything is clean again. Read-only by design:
  // this op NEVER writes to Shopify (rules 1-3).
  // ── Product stats for the hover panel (owner-only; carries financials) ─────
  // POST (pinger/owner) refreshes a 30-day per-SKU picture via ShopifyQL:
  // velocity + WoW, net sales, page visits, true page conversion vs store,
  // weeks of cover, Amazon FBA — and computes THE lever to pull next week.
  // GET serves the cached blob to owners for the Inventory hover cards.
  if (op === "ops_product_stats") {
    const authPS = await getAuthEarly(req);
    const okKeyPS = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    if (req.method === "GET") {
      if (!ownerRole(authPS)) { res.status(403).json({ error: "Owner only." }); return; }
      res.json((await kvGet("ops_product_stats")) || { byKey: {}, at: 0 });
      return;
    }
    if (!okKeyPS && !ownerRole(authPS)) { res.status(403).json({ error: "Owner or key only." }); return; }
    // {injectAnalytics:{pages:[[path,sessions,checkouts]...], store:[sessions,checkouts]}}
    // persists session/conversion data delivered from a connection that HAS the
    // analytics scope; merged into every rebuild until the app token gets
    // read_reports and ShopifyQL takes over natively.
    if ((req.body || {}).injectAnalytics) {
      const prevInj = (await kvGet("ops_injected_analytics")) || {};
      await kvSet("ops_injected_analytics", { ...prevInj, ...req.body.injectAnalytics, at: Date.now() });
    }
    const stPS = (await kvGet("ops_product_stats")) || {};
    if (!(req.body || {}).force && stPS.at && Date.now() - stPS.at < 6 * 3600 * 1000) { res.json({ ok: true, skipped: true }); return; }
    const soPS = (await kvGet("shopify_oauth")) || {};
    const stokPS = soPS.accessToken || soPS.token;
    if (!stokPS || !soPS.shop) { res.json({ ok: false, error: "shopify_not_connected" }); return; }
    const gqlPS = async (q) => { const r = await fetch(`https://${soPS.shop}/admin/api/2025-10/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": stokPS }, body: JSON.stringify({ query: q }) }); return (await r.json()).data; };
    const ql = async (q) => {
      const d = await gqlPS(`query { shopifyqlQuery(query: ${JSON.stringify(q)}) { parseErrors tableData { columns { name } rows } } }`);
      const t = d && d.shopifyqlQuery && d.shopifyqlQuery.tableData;
      return t && Array.isArray(t.rows) ? t.rows : []; // rows: objects keyed by column name
    };
    const toMap = (rows, keyCol, cols) => { const m = {}; for (const r of rows) { if (!r || r[keyCol] == null) continue; m[String(r[keyCol]).toLowerCase()] = cols.map((c) => Number(r[c]) || 0); } return m; };
    let s30 = toMap(await ql("FROM sales SHOW net_items_sold, net_sales GROUP BY product_title SINCE -30d UNTIL today"), "product_title", ["net_items_sold", "net_sales"]);
    let s7 = toMap(await ql("FROM sales SHOW net_items_sold GROUP BY product_title SINCE -7d UNTIL today"), "product_title", ["net_items_sold"]);
    let sPrev = toMap(await ql("FROM sales SHOW net_items_sold GROUP BY product_title SINCE -14d UNTIL -7d"), "product_title", ["net_items_sold"]);
    const pages = await ql("FROM sessions SHOW sessions, sessions_that_completed_checkout GROUP BY landing_page_path SINCE -30d UNTIL today ORDER BY sessions DESC LIMIT 100");
    const store = await ql("FROM sessions SHOW sessions, sessions_that_completed_checkout SINCE -30d UNTIL today");
    let storeCvr = store.length && Number(store[0].sessions) > 0 ? Math.round((Number(store[0].sessions_that_completed_checkout) / Number(store[0].sessions)) * 1000) / 10 : null;
    let byPath = {}; for (const r of pages) byPath[String(r.landing_page_path || "")] = { sess: Number(r.sessions) || 0, chk: Number(r.sessions_that_completed_checkout) || 0 };
    let storeCvrInj = null;
    if (!Object.keys(byPath).length) {
      const inj = (await kvGet("ops_injected_analytics")) || null;
      if (inj && Array.isArray(inj.pages)) {
        for (const r of inj.pages) byPath[String(r[0] || "")] = { sess: Number(r[1]) || 0, chk: Number(r[2]) || 0 };
        if (Array.isArray(inj.store) && Number(inj.store[0]) > 0) storeCvrInj = Math.round((Number(inj.store[1]) / Number(inj.store[0])) * 1000) / 10;
      }
    }
    // Injected NET sales (from an analytics-scoped connection) are the
    // authoritative dollars — HER RULE: net, never gross; the orders-based
    // fallback reads line totals BEFORE order-level discount codes, which
    // inflates gifted PR/UGC units (Bath Salts: 76 units, $0 net).
    const injM = (await kvGet("ops_injected_analytics")) || null;
    if (!Object.keys(s30).length && injM && injM.sales30) {
      s30 = {}; s7 = {}; sPrev = {};
      for (const [t, v] of Object.entries(injM.sales30)) s30[t.toLowerCase()] = [Number(v[0]) || 0, Number(v[1]) || 0];
      for (const [t, v] of Object.entries(injM.sales7 || {})) s7[t.toLowerCase()] = [Number(v) || 0];
      for (const [t, v] of Object.entries(injM.salesPrev || {})) sPrev[t.toLowerCase()] = [Number(v) || 0];
    }
    if (!Object.keys(s30).length) {
      const isoPS = new Date(Date.now() - 30 * 86400000).toISOString();
      const oD = await gqlPS(`query { orders(first: 250, query: "created_at:>='${isoPS}'") { edges { node { createdAt lineItems(first: 25) { edges { node { title quantity discountedTotalSet { shopMoney { amount } } } } } } } } }`);
      const edsPS = (((oD || {}).orders || {}).edges || []);
      const accPS = {};
      for (const oE of edsPS) {
        const ageD = (Date.now() - new Date(oE.node.createdAt).getTime()) / 86400000;
        for (const liE of ((oE.node.lineItems || {}).edges || [])) {
          const li = liE.node; const k = String(li.title || "").toLowerCase(); if (!k) continue;
          const a = (accPS[k] = accPS[k] || { u30: 0, sales30: 0, u7: 0, uPrev: 0 });
          a.u30 += li.quantity || 0; a.sales30 += Number(((li.discountedTotalSet || {}).shopMoney || {}).amount) || 0;
          if (ageD <= 7) a.u7 += li.quantity || 0; else if (ageD <= 14) a.uPrev += li.quantity || 0;
        }
      }
      s30 = {}; s7 = {}; sPrev = {};
      for (const [k, a] of Object.entries(accPS)) { s30[k] = [a.u30, a.sales30]; s7[k] = [a.u7]; sPrev[k] = [a.uPrev]; }
    }
    if (storeCvr == null && storeCvrInj != null) storeCvr = storeCvrInj;
    // PAID buyers per product — only orders with a nonzero total count (gifted
    // PR/UGC orders ride 100%-off codes and land at $0; her net-not-gross rule
    // says those are not sales). Counted as ORDERS, not units, so a 3-pack
    // buyer is one buyer. Also reused by the bundle-credit pass below.
    let ordersPS = [];
    try {
      const isoOP = new Date(Date.now() - 30 * 86400000).toISOString();
      const oAll = await gqlPS(`query { orders(first: 250, query: "created_at:>='${isoOP}'") { edges { node { createdAt totalPriceSet { shopMoney { amount } } lineItems(first: 25) { edges { node { title quantity discountedTotalSet { shopMoney { amount } } } } } } } } }`);
      ordersPS = (((oAll || {}).orders || {}).edges || []);
    } catch (eOP) {}
    const paidOrders30 = {};
    for (const oE of ordersPS) {
      if (!(Number((((oE.node || {}).totalPriceSet || {}).shopMoney || {}).amount) > 0)) continue;
      const seenT = new Set();
      // The product's own line must carry revenue too — a free-gift line (the
      // $50+ body-care promo adds Bath Salts at $0) rides inside a PAID order
      // and would otherwise read as a purchase of the gift.
      for (const liE of (((oE.node || {}).lineItems || {}).edges || [])) { const li2 = liE.node || {}; if (!(Number(((li2.discountedTotalSet || {}).shopMoney || {}).amount) > 0)) continue; const k2 = String(li2.title || "").toLowerCase(); if (k2 && !seenT.has(k2)) { seenT.add(k2); paidOrders30[k2] = (paidOrders30[k2] || 0) + 1; } }
    }
    const prodsD = await gqlPS(`query { products(first: 100, query: "status:active") { edges { node { title handle createdAt totalInventory tags variants(first: 3) { edges { node { inventoryItem { tracked } inventoryQuantity } } } } } } }`);
    const amzItems = Object.values((((await kvGet("lavalle_data")) || [])[0] || (await kvGet("lavalle_data")) || {}).amazonRestock ? ((Array.isArray(await kvGet("lavalle_data")) ? (await kvGet("lavalle_data"))[0] : await kvGet("lavalle_data")).amazonRestock.items || {}) : {});
    const AMZ_RX = [[/candle sand|sand ?wax refill/i, "sandwax refill pouch"], [/small apple|mini.*apple/i, "mini spiced apple botanical candle"], [/large apple/i, "large spiced apple botanical candle"], [/bath salt/i, "bath salts"], [/dough bowl/i, "dark dough bowl"]];
    const normPS = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const byKey = {};
    for (const e of (((prodsD || {}).products || {}).edges || [])) {
      const n = e.node; const tKey = String(n.title || "").toLowerCase();
      const key = normPS(n.title);
      const units30 = (s30[tKey] || [])[0] || 0;
      const sales30 = Math.round(((s30[tKey] || [])[1] || 0));
      const u7 = (s7[tKey] || [])[0] || 0;
      const uPrev = (sPrev[tKey] || [])[0] || 0;
      const wow = uPrev > 0 ? Math.round(((u7 - uPrev) / uPrev) * 100) : (u7 > 0 ? 100 : null);
      const pg = byPath["/products/" + n.handle] || null;
      const sess30 = pg ? pg.sess : null;
      // Shopify's only per-page session dimension is LANDING page, so a buyer
      // who arrived via a collection or the homepage never lands in pg.chk —
      // and pg.chk itself counts sessions that landed here then bought ANYTHING.
      // Neither is product conversion. Numerator = paid orders whose own line
      // for this product carried revenue, capped at sessions (rate ≤ 100%).
      // Line totals sit BEFORE order-level codes, so a 100%-off gifted order
      // that charged shipping still slips through both checks — the backstop is
      // her net-not-gross rule: $0 net over 30 days means zero credit.
      const buyers30 = pg && sales30 > 0 ? Math.min(paidOrders30[tKey] || 0, pg.sess) : 0;
      const cvr = pg && pg.sess > 0 ? Math.round((buyers30 / pg.sess) * 1000) / 10 : null;
      const cvrCredited = !!(pg && pg.sess > 0 && buyers30 > pg.chk);
      const tracked = (n.variants.edges || []).some((v) => ((v.node.inventoryItem || {}).tracked) !== false);
      const onHand = tracked ? n.totalInventory : (n.variants.edges || []).reduce((a, v) => a + (Number(v.node.inventoryQuantity) || 0), 0);
      const weekly = u7 > 0 ? u7 : units30 / 4.3;
      const cover = onHand > 0 && weekly > 0 ? Math.round((onHand / weekly) * 10) / 10 : null;
      const amzHit = amzItems.filter((it) => { const m = AMZ_RX.find(([rx]) => rx.test(it.name || "")); return m && m[1] === key; });
      const amz = amzHit.length ? { sold30: amzHit.reduce((a, x) => a + (Number(x.sold30) || 0), 0), avail: amzHit.reduce((a, x) => a + (Number(x.available) || 0), 0), inbound: amzHit.reduce((a, x) => a + (Number(x.inbound) || 0), 0) } : null;
      let lever = "Hold — steady; keep the cadence.";
      const isPre = (n.tags || []).some((t) => /preorder/i.test(t));
      const ageDays = n.createdAt ? Math.round((Date.now() - new Date(n.createdAt).getTime()) / 86400000) : null;
      // Zero PAID sales outranks every other lever — cover, WoW, and conversion
      // are all meaningless without a sale, so without this branch a dead SKU
      // falls through the whole chain and reads "Hold — steady." sales30 <= 0
      // catches gifted-only SKUs whose units are all $0 PR/UGC sends.
      if (units30 === 0 || sales30 <= 0) {
        if (amz && amz.sold30 > 0) lever = "Channel — Amazon moves " + amz.sold30 + "/30d but the site sold zero; the demand is real, so fix site visibility (homepage, collections, email).";
        else if (isPre) lever = "Pre-order — zero orders in 30 days; push the pre-order story in email and a Sisters post, or revisit the offer.";
        else if (ageDays != null && ageDays <= 14) lever = "Launch — " + ageDays + " days old with no sales yet; seed it now with a Sisters post, homepage slot, and email feature.";
        else if (sess30 != null && sess30 >= 40) lever = "Page — " + sess30 + " visits in 30 days and not one sale; the page is the blocker — rework imagery, price framing, or add reviews.";
        else lever = "Dormant — zero sales and only " + (sess30 || 0) + " visits in 30 days; it will not sell unseen — feature it (Sisters post, PR gifting, homepage) or decide to retire it.";
      }
      else if (cover != null && cover <= 2 && !isPre) lever = "Stock — about " + cover + " weeks of cover left; reorder or produce this week.";
      else if (sess30 != null && sess30 >= 40 && cvr != null && storeCvr != null && cvr < storeCvr * 0.6) lever = "Page — traffic is there (" + sess30 + " visits) but conversion lags (" + cvr + "% vs store " + storeCvr + "%); rework imagery, price framing, or add reviews.";
      else if (cvr != null && storeCvr != null && cvr >= storeCvr && (sess30 || 0) < 40) lever = "Traffic — the page converts (" + cvr + "%) but only " + (sess30 || 0) + " visits in 30 days; feature it in a Sisters post, PR gifting, or a homepage slot.";
      else if (wow != null && wow <= -25) lever = "Momentum — units fell " + Math.abs(wow) + "% week over week; refresh the content angle or pair it into a set.";
      else if (amz && amz.avail === 0 && amz.sold30 > 0) lever = "Amazon stock — it sells (" + amz.sold30 + "/30d) but FBA is empty; ship the recommended replenishment.";
      byKey[key] = { u7, wow, sales30, sess30, cvr, cvrCredited, storeCvr, cover, amz, lever };
    }
    // Bundles sell as their EXPANDED COMPONENTS (no parent line item on the
    // order — e.g. The Essentials Pair lands as candle + scrub), so the bundle
    // SKU is credited by finding orders that contain its full component set.
    try {
      const BUNDLE_MAP = { "the essentials pair": ["mini spiced apple botanical candle", "vanilla cashmere body scrub"] };
      try {
        const bd2 = await gqlPS(`query { products(first: 20, query: "status:active") { edges { node { title variants(first: 3) { edges { node { requiresComponents productVariantComponents(first: 8) { nodes { productVariant { product { title } } } } } } } } } } }`);
        for (const e2 of (((bd2 || {}).products || {}).edges || [])) {
          const comps = [];
          for (const vE of (e2.node.variants.edges || [])) for (const cN of (((vE.node || {}).productVariantComponents || {}).nodes || [])) { const t2 = normPS((((cN || {}).productVariant || {}).product || {}).title); if (t2) comps.push(t2); }
          if (comps.length >= 2) BUNDLE_MAP[normPS(e2.node.title)] = [...new Set(comps)];
        }
      } catch (eBm) {}
      for (const [bk, comps] of Object.entries(BUNDLE_MAP)) {
        if (!byKey[bk]) continue;
        let u30 = 0, u7 = 0, uPrev = 0, sales30 = 0;
        for (const oE of ordersPS) {
          // Paid orders only — gifted PR packages ship the same component set
          // at $0 and would read as "pairs sold" (her net-not-gross rule).
          if (!(Number((((oE.node || {}).totalPriceSet || {}).shopMoney || {}).amount) > 0)) continue;
          const titles = ((oE.node.lineItems || {}).edges || []).map((x) => normPS(x.node.title));
          if (!comps.every((c2) => titles.includes(c2))) continue;
          const ageD = (Date.now() - new Date(oE.node.createdAt).getTime()) / 86400000;
          u30 += 1; if (ageD <= 7) u7 += 1; else if (ageD <= 14) uPrev += 1;
          for (const liE of ((oE.node.lineItems || {}).edges || [])) if (comps.includes(normPS(liE.node.title))) sales30 += Number(((liE.node.discountedTotalSet || {}).shopMoney || {}).amount) || 0;
        }
        if (u30 > 0) {
          const b = byKey[bk];
          b.u7 = u7; b.sales30 = Math.round(sales30); b.wow = uPrev > 0 ? Math.round(((u7 - uPrev) / uPrev) * 100) : (u7 > 0 ? 100 : null);
          // The bundle has no line item of its own, so the per-product pass left
          // its conversion at 0 — credit its paid component-set orders here.
          if (b.sess30 > 0 && b.sales30 > 0) { b.cvr = Math.round((Math.min(u30, b.sess30) / b.sess30) * 1000) / 10; b.cvrCredited = b.cvr > 0; }
          b.lever = (u30 === 1 ? "1 pair sold this month" : u30 + " pairs sold this month") + " — the bundle sells as its components on orders, so these are credited from paired purchases. " + (b.lever || "");
        }
      }
    } catch (eBd) {}
    await kvSet("ops_product_stats", { byKey, storeCvr, at: Date.now() });
    res.json({ ok: true, products: Object.keys(byKey).length, storeCvr });
    return;
  }

  if (op === "ops_preorder_guard" && req.method === "POST") {
    // Pre-order guard v3 — model corrected Aug 26 by the theme session's reply:
    // the "preorder" TAG pins the pre-order button (custom Liquid gate), and the
    // ALLOCATION is available>0 + DENY on the three capped products. available 0
    // under DENY = OFF SALE (the Calcatta incident). Onyx Arched deliberately
    // stays CONTINUE while allocation-less. Read-only toward Shopify, always.
    const okKeyPG = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authPG = okKeyPG ? null : await getAuthEarly(req);
    if (!okKeyPG && !ownerRole(authPG)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const soPG = (await kvGet("shopify_oauth")) || {};
    const stokPG = soPG.accessToken || soPG.token;
    if (!stokPG || !soPG.shop) { res.json({ ok: false, error: "shopify_not_connected" }); return; }
    const CAPPED_PG = { "gid://shopify/Product/8758400090279": "Italian Viola Calcatta Refillable Candle Set", "gid://shopify/Product/11110537592999": "Rosso Levanto Diffuser", "gid://shopify/Product/11147205050535": "Onyx Diffuser" };
    const qPG = `query { products(first: 20, query: "tag:preorder") { edges { node { id title onlineStoreUrl tags variants(first: 5) { edges { node { inventoryPolicy inventoryQuantity } } } } } } }`;
    const rPG = await fetch(`https://${soPG.shop}/admin/api/2025-10/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": stokPG }, body: JSON.stringify({ query: qPG }) });
    const dPG = await rPG.json().catch(() => ({}));
    const prodsPG = (((dPG.data || {}).products || {}).edges || []).map((e) => e.node);
    const alerts = [];
    const stPG = (await kvGet("ops_preorder_guard_state")) || { avail: {}, tags: {} };
    const seenIds = new Set(prodsPG.map((pp) => pp.id));
    for (const [pid, ttl] of Object.entries(CAPPED_PG)) {
      if (!seenIds.has(pid)) alerts.push("• " + ttl + " — the preorder TAG is GONE (product no longer matches tag:preorder): the pre-order button is off. Someone replaced the tag list.");
    }
    if ((stPG.known || []).length) { for (const ttl of stPG.known) { if (!prodsPG.some((pp) => pp.title === ttl) && !Object.values(CAPPED_PG).includes(ttl)) alerts.push("• " + ttl + " — dropped out of the preorder set (tag removed?)."); } }
    for (const pp of prodsPG) {
      const avail = (pp.variants.edges || []).reduce((a, v) => a + (Number(v.node.inventoryQuantity) || 0), 0);
      const isCapped = !!CAPPED_PG[pp.id];
      if (isCapped) {
        const anyNotDeny = (pp.variants.edges || []).some((v) => v.node.inventoryPolicy !== "DENY");
        if (anyNotDeny) alerts.push("• " + pp.title + " — policy is not DENY: the pre-order allocation is uncapped.");
        if (avail <= 0) alerts.push("• " + pp.title + " — available is " + avail + ": under DENY this takes the product OFF SALE (allocation zeroed). It should hold the deliberate allocation (> 0).");
        else if (pp.onlineStoreUrl) {
          try {
            const pj = await (await fetch(pp.onlineStoreUrl.replace(/\?.*$/, "") + ".js", { headers: { "User-Agent": "Mozilla/5.0" } })).json();
            if (pj && pj.available === false) alerts.push("• " + pp.title + " — storefront reports NOT purchasable despite allocation " + avail + " (stale cache or inventory overwrite).");
          } catch (ePg) {}
        }
      }
      const key = pp.title;
      // sales draw the allocation DOWN — that is normal and stays quiet.
      // an INCREASE on a protected product means someone wrote stock to it.
      if (key in stPG.avail && avail > stPG.avail[key]) alerts.push("• " + pp.title + " — available INCREASED " + stPG.avail[key] + " → " + avail + ". Nobody should be writing stock to a pre-order product — check who did.");
      const tagsNow = (pp.tags || []).slice().sort().join(", ");
      if (key in stPG.tags && stPG.tags[key] !== tagsNow) alerts.push("• " + pp.title + " — TAGS CHANGED: [" + stPG.tags[key] + "] → [" + tagsNow + "].");
      stPG.avail[key] = avail; stPG.tags[key] = tagsNow;
    }
    stPG.known = prodsPG.map((pp) => pp.title);
    await kvSet("ops_preorder_guard_state", stPG);
    const rawPG = await kvGet("lavalle_data"); const blobPG = Array.isArray(rawPG) ? rawPG[0] : rawPG;
    const bdPG = blobPG && blobPG.boards && blobPG.boards["rh-operations"];
    if (bdPG) {
      const invPG = bdPG.lists.find((l) => /^inventory$/i.test((l.name || "").trim()));
      let guardCard = bdPG.cards.find((cg) => /^⚠ pre-order guard/i.test(cg.name || ""));
      if (alerts.length && invPG) {
        if (!guardCard) { guardCard = { id: "c" + Math.random().toString(36).slice(2, 10), listId: invPG.id, name: "", labels: [{ n: "Priority", c: "#1A1A1A" }], members: [], attachments: [], links: [], done: false }; const ix = bdPG.cards.findIndex((cg) => cg.listId === invPG.id); if (ix >= 0) bdPG.cards.splice(ix, 0, guardCard); else bdPG.cards.push(guardCard); }
        guardCard.name = "⚠ Pre-order guard — " + alerts.length + " issue" + (alerts.length === 1 ? "" : "s");
        guardCard.desc = "Checked every 15 minutes. Pre-order model: the preorder TAG pins the button; allocation = available (> 0) + DENY on the capped three; Onyx Arched stays CONTINUE while allocation-less.\n\n" + alerts.join("\n") + "\n\n(This card clears itself when everything is healthy.)";
        await kvSet("lavalle_data", blobPG);
      } else if (guardCard) {
        bdPG.cards = bdPG.cards.filter((cg) => cg !== guardCard);
        await kvSet("lavalle_data", blobPG);
      }
    }
    res.json({ ok: true, protected: prodsPG.length, alerts });
    return;
  }

  if (op === "automations_card" && req.method === "POST") {
    const okKeyA = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authA = okKeyA ? null : await getAuthEarly(req);
    if (!okKeyA && !ownerRole(authA)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const rawA = await kvGet("lavalle_data"); const blobA = Array.isArray(rawA) ? rawA[0] : rawA;
    const bdA = blobA && blobA.boards && blobA.boards[SBOARD.key];
    if (!bdA) { res.json({ ok: false }); return; }
    const listA = bdA.lists.find((l) => /strategy outline/i.test(l.name || "")) || bdA.lists[0];
    let cardA = bdA.cards.find((c) => /^automations\b/i.test(c.name || ""));
    if (!cardA) { cardA = { id: "c" + Math.random().toString(36).slice(2, 10), listId: listA.id, name: "Automations — what runs on its own", labels: [], members: [], attachments: [], links: [], done: false }; bdA.cards.unshift(cardA); }
    cardA.name = "Automations — what runs on its own";
    cardA.desc = "Plain-English map of everything automated on this board. Each line: WHAT · WHEN it triggers · what it does.\n\n" + AUTOMATIONS.map(([w, t, d]) => "• " + w + "\n  Trigger: " + t + "\n  " + d).join("\n\n") + "\n\n(Updated automatically whenever an automation is added or changed.)";
    await kvSet("lavalle_data", blobA);
    res.json({ ok: true, automations: AUTOMATIONS.length });
    return;
  }
  // ── Editorial cover pick (vision) ──────────────────────────────────────────
  // Her rule: the Strategy Outline card's cover is always the most editorial
  // product photo of the CURRENT grid; the category alternates as grids switch
  // (first grid = its majority category, e.g. fashion if 12 of 21 lean fashion;
  // the next grid = the other category; and so on). Also ranks the grid's photos
  // for the collage on the Strategy page. Cached per grid + tiles hash.
  if (op === "sisters_cover_pick" && req.method === "POST") {
    const okKeyP = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authP = okKeyP ? null : await getAuthEarly(req);
    if (!okKeyP && !ownerRole(authP)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const akeyP = process.env.ANTHROPIC_API_KEY;
    if (!akeyP) { res.json({ ok: false, error: "ANTHROPIC_API_KEY not set" }); return; }
    const startP = Date.UTC(2026, 7, 26); // posting cycle starts Wed Aug 26 (her call, Aug 25) const dayP = Math.max(0, Math.floor((Date.now() - startP) / 86400000));
    let postNP = 0; let dP = new Date(startP); for (let i = 0; i <= dayP && postNP < 42; i++) { postNP++; if ([1, 3, 5].includes(dP.getUTCDay())) postNP++; dP = new Date(dP.getTime() + 86400000); }
    const gridNum = postNP <= 21 ? "1" : "2";
    const recP = (await kvGet("sisters_grid_tiles_" + gridNum + SBOARD.kvSuffix)) || { tiles: [] };
    const tilesP = (recP.tiles || []).slice(0, 21);
    if (tilesP.length < 9) { res.json({ ok: false, error: "grid " + gridNum + " not seeded" }); return; }
    const hashP = createHash("sha256").update(JSON.stringify(tilesP.map((t) => t.cover + t.tag))).digest("hex").slice(0, 12);
    const theme = (await kvGet("sisters_strategy_theme" + SBOARD.kvSuffix)) || { title: "September 2026" };
    const keyP = theme.title + ":" + gridNum;
    const stateP = (await kvGet("sisters_cover_pick" + SBOARD.kvSuffix)) || null;
    if (stateP && stateP.key === keyP && stateP.hash === hashP && !(req.body || {}).force) { res.json({ ok: true, cached: true, ...stateP }); return; }
    // thumbnails (base64) — small enough to send 21 at once
    const Jimp = (await import("jimp")).default;
    const content = [];
    for (let i = 0; i < tilesP.length; i++) {
      try { const u = /^https?:/.test(tilesP[i].cover) ? tilesP[i].cover : APP_ORIGIN + tilesP[i].cover; const r = await fetch(u); if (!r.ok) continue; const im = await Jimp.read(Buffer.from(await r.arrayBuffer())); im.resize(300, Jimp.AUTO); im.quality(70); const b = await im.getBufferAsync(Jimp.MIME_JPEG); content.push({ type: "text", text: "Tile " + (i + 1) + ":" }); content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b.toString("base64") } }); } catch (e) {}
    }
    content.push({ type: "text", text: "These are the " + tilesP.length + " photos of this month's Instagram grid for " + SBOARD.themeLabelBrand + ". For EACH tile give: category = \"fashion\" (clothing, outfits, garments, styling) | \"beauty\" (body care, candles, skincare, home ritual) | \"lifestyle\" (the founders, behind the scenes, places), and an editorial score 1-10 for how much it reads like a quiet-luxury campaign image (composition, light, restraint; the PRODUCT or GARMENT is the subject: still lifes, styled details, hands at most). Any photo where a person, face or founder is prominent scores 3 or less, no matter how beautiful; the same for any photo showing bare feet, toes or tattoos, and for any photo where a BOTANICAL CANDLE is the subject (house rule: botanical candles are never background material — not main movers); phone snaps, busy BTS shots, screens and visible text also score low. Return ONLY JSON: {\"tiles\":[{\"i\":1,\"category\":\"fashion\",\"editorial\":8}, …]}" });
    let parsedP = null;
    try {
      const rP = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": akeyP, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1500, messages: [{ role: "user", content }] }) });
      const dP2 = await rP.json(); const txt = (dP2.content || []).map((c) => c.text || "").join("");
      parsedP = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
    } catch (e) { res.json({ ok: false, error: "vision failed: " + String(e && e.message).slice(0, 200) }); return; }
    const rows = (parsedP.tiles || []).map((t) => ({ i: Number(t.i), cat: String(t.category || "lifestyle").toLowerCase(), score: Number(t.editorial) || 0 })).filter((t) => t.i >= 1 && t.i <= tilesP.length);
    const count = (c) => rows.filter((t) => t.cat === c).length;
    const majority = count("fashion") >= count("beauty") ? "fashion" : "beauty";
    const opposite = (c) => (c === "fashion" ? "beauty" : "fashion");
    // alternate as grids switch: a different grid than last time flips the category
    const cat = stateP && stateP.key && stateP.key !== keyP && stateP.cat ? opposite(stateP.cat) : majority;
    const byScore = [...rows].sort((a, b) => b.score - a.score);
    let best = byScore.find((t) => t.cat === cat && t.score >= 5) || byScore.find((t) => t.cat === cat) || byScore[0];
    const pick = best ? tilesP[best.i - 1].cover : null;
    const ranked = byScore.filter((t) => t.cat !== "lifestyle" || t.score >= 8).map((t) => tilesP[t.i - 1].cover).filter((u, k, arr) => arr.indexOf(u) === k);
    const out = { key: keyP, hash: hashP, grid: gridNum, cat, majority, pick, pickTile: best ? best.i : null, ranked: ranked.slice(0, 8), at: Date.now() };
    await kvSet("sisters_cover_pick" + SBOARD.kvSuffix, out);
    // the BOARD BACKGROUND wears it (her rule): the board is dressed in the
    // current grid's most editorial product shot, alternating fashion/beauty
    // as the grids switch. The Strategy Outline card keeps its cover page.
    try {
      const rawPk = await kvGet("lavalle_data"); const blobPk = Array.isArray(rawPk) ? rawPk[0] : rawPk; const bdPk = blobPk && blobPk.boards && blobPk.boards[SBOARD.key];
      if (bdPk && pick && bdPk.bg !== pick) { bdPk.bg = pick; await kvSet("lavalle_data", blobPk); }
    } catch (e) {}
    res.json({ ok: true, ...out });
    return;
  }
  // ── Strategy Outline PDF (pdf-lib) + page images (Jimp) ────────────────────
  // The grid is the sequence of record: Courtney's posts are the C-dotted tiles,
  // the grid windows come from the Grid card's cache, captions + 2 TikTok tags
  // from the cards. Rebuilds whenever any of that changes (after the first build).
  // Pages are ALSO rendered as images so the card carousel / present mode (⤢)
  // can show the outline in-app without a PDF viewer. House rule: no em dashes
  // in captions (sanitised here as a safety net; the caption bank is written without them).
  if (op === "sisters_strategy_pdf" && req.method === "POST") {
    const okKeyS2 = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authS2 = okKeyS2 ? null : await getAuthEarly(req);
    if (!okKeyS2 && !ownerRole(authS2)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const bS2 = req.body || {};
    const rawS2 = await kvGet("lavalle_data"); const blobS2 = Array.isArray(rawS2) ? rawS2[0] : rawS2;
    const bdS2 = blobS2 && blobS2.boards && blobS2.boards[SBOARD.key];
    if (!bdS2) { res.json({ ok: false, error: "no board" }); return; }
    const g1S = (await kvGet("sisters_grid_tiles_1" + SBOARD.kvSuffix)) || { tiles: [] };
    const g2S = (await kvGet("sisters_grid_tiles_2" + SBOARD.kvSuffix)) || { tiles: [] };
    const tilesS = [...(g1S.tiles || []), ...(g2S.tiles || [])];
    const tagAt = (n) => (tilesS[n - 1] ? tilesS[n - 1].tag : null);
    const noDash = (s) => String(s || "").replace(/\s*[—–]\s*/g, (m, off, str) => (/^[A-Z]/.test(str.slice(off + m.length)) ? ". " : ", ")).replace(/\.\s*\./g, ".").replace(/,\s*,/g, ",").trim();
    const schedLists = bdS2.lists.filter((l) => /^schedule\s*(1\s*[-–]\s*21|22\s*[-–]\s*42)$/i.test((l.name || "").trim())).map((l) => l.id);
    const postCards = bdS2.cards.filter((c) => schedLists.includes(c.listId) && /^Post \d+\b/.test(c.name || ""))
      .map((c) => { const n = Number(/^Post (\d+)/.exec(c.name)[1]); const tg = tagAt(n); const m = /^Post\s*\d+(?:\s+[A-Za-z]+\s+\d+)?(?:\s*[—–-]\s*(.+))?$/.exec(c.name || "") || []; return { n, name: c.name, date: "", concept: (m[1] || "").trim(), desc: noDash(c.desc || ""), tags: String(c.tags || "").trim(), cover: c.cover, approved: !!c.approved, isC: tg ? tg === "C" : (SBOARD.hasCourtney && /Courtney/i.test(c.desc || "")) }; })
      .sort((a, b) => a.n - b.n);
    if (postCards.length < 21) { res.json({ ok: false, error: "schedule incomplete" }); return; }
    const ours = postCards.filter((p) => !p.isC);
    const allApproved = ours.length > 0 && ours.every((p) => p.approved);
    const tilesHashS = "w5" + createHash("sha256").update(JSON.stringify(tilesS.map((t) => t.cover + t.tag))).digest("hex").slice(0, 12); // must match sisters_grid_card's views-cache key
    const cacheS = (await kvGet("sisters_grid_card_views" + SBOARD.kvSuffix)) || {};
    const views = (cacheS.views || {});
    const viewsReady = tilesS.length < 21 || (cacheS.hash === tilesHashS && [0, 1, 2, 3].every((i) => views[i]));
    if (!viewsReady) { res.json({ ok: true, skipped: true, waiting: "grid windows still rendering for this arrangement" }); return; }
    const theme = (await kvGet("sisters_strategy_theme" + SBOARD.kvSuffix)) || { title: "September 2026", body: "First chill. Transitional layering (cashmere cardigans, linen sets, eyelet) meets the refillable evening ritual: black soap, lavender oil, candle sand. The two of us behind both brands; quiet, warm, one palette." };
    theme.body = noDash(theme.body);
    const pickSig = (await kvGet("sisters_cover_pick" + SBOARD.kvSuffix)) || {};
    const sig = createHash("sha256").update(JSON.stringify([postCards.map((p) => [p.n, p.name, p.desc, p.tags, p.cover, p.isC]), tilesHashS, views[0], views[1], views[2], views[3], theme.title, theme.body, pickSig.pick, pickSig.ranked])).digest("hex").slice(0, 12);
    const prev = (await kvGet("sisters_strategy_pdf_state" + SBOARD.kvSuffix)) || {};
    const staleRebuild = prev.sig && prev.sig !== sig; // already built once → keep fresh on caption/cover/grid/theme edits
    if (!bS2.force && !staleRebuild && (!allApproved || prev.sig === sig)) { res.json({ ok: true, skipped: true, allApproved, approvedCount: ours.filter((p) => p.approved).length, ofOurs: ours.length, alreadyBuilt: prev.sig === sig }); return; }
    // shared renderer (lib/strategy-pages.mjs): Cormorant + Inter, cream pages,
    // tracked cover, Loft-style in-feed pages with the numbered 3x3 grid crop.
    // Same ops drive the page JPEGs (resvg-wasm) and the PDF (pdf-lib + fontkit).
    const getBuf = async (u) => { if (!u) return null; try { const r = await fetch(/^https?:/.test(u) ? u : APP_ORIGIN + u); if (!r.ok) return null; return Buffer.from(await r.arrayBuffer()); } catch (e) { return null; } };
    const pageUrls = []; let pageErr = null; let pdfBuf = null;
    {
      const { renderStrategyPages } = await import("../lib/strategy-pages.mjs");
      const pickS = (await kvGet("sisters_cover_pick" + SBOARD.kvSuffix)) || null;
      const collageUrls = (pickS && pickS.ranked && pickS.ranked.length ? pickS.ranked : tilesS.filter((t) => t.tag === "K").map((t) => t.cover)).slice(0, 6);
      const collage = (await Promise.all(collageUrls.map(getBuf))).filter(Boolean);
      const out = await renderStrategyPages({ brand: SBOARD.label, title: theme.title, body: theme.body, posts: postCards, collage, windows: { w19: await getBuf(views[0]), w1021: await getBuf(views[1]), w2230: await getBuf(views[2]), w3142: await getBuf(views[3]) } });
      pdfBuf = out.pdf;
      for (const b of out.jpgs) { const mid = "sp" + createHash("sha256").update(b).digest("hex").slice(0, 14); await kvSet("media_" + mid, { b64: b.toString("base64"), ct: "image/jpeg" }); pageUrls.push("/cover/" + mid + ".jpg"); }
    }
    // Drive: <board root> / <Month> / Strategy outline / <title> Strategy Outline.pdf
    const gtS2 = await googleToken(); let driveId = null;
    if (gtS2) {
      const lsS = async (fid) => (await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("'" + fid + "' in parents and trashed=false") + "&fields=files(id,name,mimeType)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true", { headers: { Authorization: "Bearer " + gtS2 } })).json()).files || [];
      const mkS = async (name, parent) => { const hit = (await lsS(parent)).find((f) => f.mimeType === "application/vnd.google-apps.folder" && (f.name || "").trim() === name); if (hit) return hit.id; return (await (await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", { method: "POST", headers: { Authorization: "Bearer " + gtS2, "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }) })).json()).id; };
      const SIS2 = SBOARD.driveRootId;
      const monthName = (theme.title.split(/[\s+]+/)[0] || "September");
      const mF = await mkS(monthName, SIS2); const soF = await mkS("Strategy outline", mF);
      const fname = theme.title + " Strategy Outline.pdf";
      for (const f of await lsS(soF)) if (f.name === fname) await fetch("https://www.googleapis.com/drive/v3/files/" + f.id, { method: "PATCH", headers: { Authorization: "Bearer " + gtS2, "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
      const bd9 = "lhs" + pdfBuf.length.toString(36);
      const meta9 = JSON.stringify({ name: fname, parents: [soF] });
      const pre9 = `--${bd9}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta9}\r\n--${bd9}\r\nContent-Type: application/pdf\r\n\r\n`;
      const up9 = await (await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name", { method: "POST", headers: { Authorization: "Bearer " + gtS2, "Content-Type": `multipart/related; boundary=${bd9}` }, body: Buffer.concat([Buffer.from(pre9, "utf8"), pdfBuf, Buffer.from(`\r\n--${bd9}--`, "utf8")]) })).json();
      driveId = up9.id || null;
    }
    const pdfUrl = driveId ? "https://drive.google.com/file/d/" + driveId + "/view" : (prev.pdfUrl || null);
    // attach pages + PDF to the Strategy Outline column card (current month on top); PDF link on the Grid card too
    const pageAtt = pageUrls.map((u, i) => ({ id: "sop" + i, name: "Page " + (i + 1), url: u, type: "image/jpeg" }));
    const pdfAtt = pdfUrl ? [{ id: "sopdf", name: theme.title + " Strategy Outline (PDF)", url: pdfUrl, type: "application/pdf" }] : [];
    const gridCard = bdS2.cards.find((c) => /^grid\b/i.test(c.name || ""));
    if (gridCard && pdfUrl) { gridCard.attachments = (gridCard.attachments || []).filter((a) => !/Strategy Outline/i.test(a.name || "")); gridCard.attachments.push({ id: "a" + Math.random().toString(36).slice(2, 9), name: theme.title + " Strategy Outline (PDF)", url: pdfUrl, type: "application/pdf" }); }
    const soList = bdS2.lists.find((l) => /strategy outline/i.test(l.name || ""));
    if (soList) {
      let sc = bdS2.cards.find((c) => c.listId === soList.id && new RegExp("^Strategy Outline — " + theme.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(c.name || ""));
      if (!sc) { sc = { id: "c" + Math.random().toString(36).slice(2, 10), listId: soList.id, name: "Strategy Outline — " + theme.title, labels: [], members: [], attachments: [], links: [], done: false }; }
      bdS2.cards = bdS2.cards.filter((c) => c !== sc); bdS2.cards.unshift(sc); // current month always tops the column
      sc.cover = pageUrls[0] || sc.cover; sc.desc = theme.body + (pdfUrl ? "\n\nPDF: " + pdfUrl : "") + "\n\nOpen the card and tap Present (or ⤢ on the tile) to read the outline full screen.";
      sc.attachments = pageAtt.length ? [...pageAtt, ...pdfAtt] : [...(sc.attachments || []).filter((a) => /^image\//.test(a.type || "")), ...pdfAtt];
    }
    await kvSet("lavalle_data", blobS2);
    await kvSet("sisters_strategy_pdf_state" + SBOARD.kvSuffix, { sig, at: Date.now(), pdfUrl, pages: pageUrls });
    // captions changed → refresh the Google Doc backup too (her rule after the
    // Aug 26 caption loss: the doc is the standing off-app copy)
    if (process.env.PUBLISH_KEY) { try { const acCD = new AbortController(); setTimeout(() => acCD.abort(), 20000); await fetch(APP_ORIGIN + "/api/data?op=sisters_captions_doc", { method: "POST", headers: { "x-publish-key": process.env.PUBLISH_KEY }, signal: acCD.signal }).catch(() => {}); } catch (eCD) {} }
    res.json({ ok: true, built: true, pdfUrl, pages: pageUrls.length, pageErr, posts: postCards.length, allApproved });
    return;
  }
  // ── Captions + hashtags doc — TWO-WAY sync ────────────────────────────────
  // Her protocol (Aug 26, after Courtney's captions were lost): the shared
  // Google Doc is both the standing backup AND an editing surface — Courtney
  // writes captions/hashtags in the doc and they flow onto the matching Post
  // card; card edits flow back out. Merge is 3-way against the last-synced
  // base (state.base): a doc entry that changed since last sync wins its post,
  // otherwise the card is authoritative. Runs on every publish_due sweep
  // (~15 min) and after each strategy-PDF rebuild; callable directly.
  if (op === "sisters_captions_doc" && req.method === "POST") {
    const okKeyCB = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authCB = okKeyCB ? null : await getAuthEarly(req);
    if (!okKeyCB && !ownerRole(authCB)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const gtCB = await googleToken(); if (!gtCB) { res.json({ ok: false, error: "google_not_connected" }); return; }
    const DOC_CB = "1Do98h-x2dl4Wj8suLLHTXrm_2GSOmfN9nyUQhFRXLrI";
    const rawCB = await kvGet("lavalle_data"); const blobCB = Array.isArray(rawCB) ? rawCB[0] : rawCB;
    const bdCB = blobCB && blobCB.boards && blobCB.boards["lavalle-sisters"];
    if (!bdCB) { res.json({ ok: false }); return; }
    const schedCB = bdCB.lists.filter((l) => /^schedule/i.test(l.name || "")).map((l) => l.id);
    const postsCB = bdCB.cards.filter((c) => schedCB.includes(c.listId) && /^post\s*\d+/i.test(c.name || ""))
      .sort((a, b) => Number((/^post\s*(\d+)/i.exec(a.name) || [])[1] || 0) - Number((/^post\s*(\d+)/i.exec(b.name) || [])[1] || 0));
    const numCB = (c) => Number((/^post\s*(\d+)/i.exec(c.name) || [])[1] || 0);
    const stCB = (await kvGet("sisters_captions_doc_state")) || {};
    // 1. read the doc and parse Post blocks (captions may span lines)
    const rEx = await fetch("https://www.googleapis.com/drive/v3/files/" + DOC_CB + "/export?mimeType=text/plain&supportsAllDrives=true", { headers: { Authorization: "Bearer " + gtCB } });
    const docText = rEx.ok ? (await rEx.text()).replace(/^﻿/, "").replace(/\r/g, "") : "";
    const parsed = {};
    for (const m of docText.matchAll(/^Post\s+(\d+)[^\n]*\n(?:Caption:\s?([\s\S]*?))?\nHashtags:\s?([^\n]*)/gim)) {
      const clean = (s) => String(s || "").trim().replace(/^\(none yet\)$/i, "").replace(/\s*—\s*/g, ", "); // captions never carry em dashes (house rule)
      parsed[Number(m[1])] = { c: clean(m[2]), h: String(m[3] || "").trim().replace(/^\(none yet\)$/i, "") };
    }
    // 2. pull: doc entries that changed since last sync win their post
    const base = stCB.base || null;
    let pulled = 0;
    if (base && docText) {
      // compare both sides through the same normalizer so cleaning (em dashes,
      // trims) never reads as a phantom doc edit
      const nrm = (s) => String(s || "").trim().replace(/\s*—\s*/g, ", ");
      for (const c of postsCB) {
        const n = numCB(c); const p = parsed[n]; const b0 = base[n];
        if (!p || !b0) continue;
        if (p.c !== nrm(b0.c) && p.c !== nrm(c.desc)) { c.desc = p.c; pulled++; }
        if (p.h !== nrm(b0.h) && p.h !== nrm(c.tags)) { c.tags = p.h; pulled++; }
      }
    }
    // Courtney's new hashtags get NOTED on the board's "Hashtags" card (her
    // ask, Aug 26): any tag on her 12 posts the card doesn't list yet is
    // appended under a "Courtney's additions" line — once ever (kv seen-set,
    // so Kiabeth can curate the card without tags re-appearing); #thefold
    // never (house rule).
    const notedCT = [];
    try {
      const hcCB = bdCB.cards.find((c) => /^hashtags\b/i.test((c.name || "").trim()));
      if (hcCB) {
        const isCcb = (c) => (c.labels || []).some((lb) => ((typeof lb === "string" ? lb : lb && lb.n) || "").toLowerCase() === "courtney");
        const seenCT = new Set(((await kvGet("sisters_courtney_tags_seen")) || []).map((t) => String(t).toLowerCase()));
        const inCard = new Set(((hcCB.desc || "").match(/#[a-z0-9_]+/gi) || []).map((t) => t.toLowerCase()));
        for (const c of postsCB) {
          if (!isCcb(c)) continue;
          for (const t of ((c.tags || "").match(/#[a-z0-9_]+/gi) || [])) {
            const tl = t.toLowerCase();
            if (tl === "#thefold" || inCard.has(tl) || seenCT.has(tl)) continue;
            notedCT.push(t); inCard.add(tl); seenCT.add(tl);
          }
        }
        if (notedCT.length) {
          if (/courtney's additions:/i.test(hcCB.desc || "")) hcCB.desc = hcCB.desc.replace(/(courtney's additions:[^\n]*)/i, (m0) => m0 + " " + notedCT.join(" "));
          else hcCB.desc = (hcCB.desc || "") + "\n\nCourtney's additions: " + notedCT.join(" ");
          await kvSet("sisters_courtney_tags_seen", [...seenCT]);
        }
      }
    } catch (eCT) {}
    if (pulled || notedCT.length) await kvSet("lavalle_data", blobCB);
    // 2.5 Courtney to-do flags (her ask: BLUE titles for posts she still has to
    // update). KV sisters_captions_todo holds {n: {c,h}} — the values as of
    // flagging; when a post's caption/hashtags CHANGE from that snapshot the
    // flag self-clears and the title returns to black. Seed/replace the set by
    // POSTing {todo:[2,5,...]}.
    let todoCB = (await kvGet("sisters_captions_todo")) || {};
    if (Array.isArray((req.body || {}).todo)) {
      todoCB = {};
      for (const n0 of req.body.todo) { const c0 = postsCB.find((x) => numCB(x) === Number(n0)); if (c0) todoCB[Number(n0)] = { c: (c0.desc || "").trim(), h: (c0.tags || "").trim() }; }
      await kvSet("sisters_captions_todo", todoCB);
    }
    let todoChanged = false;
    for (const [nT, snap] of Object.entries(todoCB)) { const cT = postsCB.find((x) => numCB(x) === Number(nT)); if (!cT) continue; if ((cT.desc || "").trim() !== snap.c || (cT.tags || "").trim() !== snap.h) { delete todoCB[nT]; todoChanged = true; } }
    if (todoChanged) await kvSet("sisters_captions_todo", todoCB);
    // 3. push: rebuild the doc from the (possibly updated) cards — as HTML so
    // the blue to-do titles survive every rebuild (text export for the pull is
    // unaffected by color)
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const lines = ["LAVALLE SISTERS — CAPTIONS + HASHTAGS", "Edit captions or hashtags right here (or on the card) — the app and this doc sync both ways every few minutes. Keep each post's Caption:/Hashtags: lines.", "Blue titles are still waiting on Courtney; they turn black on their own once the caption changes.", "Last synced: " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", ""];
    const htmlParts = lines.map((l) => l ? "<p>" + esc(l) + "</p>" : "<p>&nbsp;</p>");
    for (const c of postsCB) {
      lines.push(c.name);
      lines.push("Caption: " + ((c.desc || "").trim() || "(none yet)"));
      lines.push("Hashtags: " + ((c.tags || "").trim() || "(none yet)"));
      lines.push("");
      const isTodo = !!todoCB[numCB(c)];
      htmlParts.push("<p>" + (isTodo ? '<span style="color:#1155cc">' + esc(c.name) + "</span>" : esc(c.name)) + "</p>");
      htmlParts.push("<p>Caption: " + (esc((c.desc || "").trim() || "(none yet)")).replace(/\n/g, "<br>") + "</p>");
      htmlParts.push("<p>Hashtags: " + esc((c.tags || "").trim() || "(none yet)") + "</p>");
      htmlParts.push("<p>&nbsp;</p>");
    }
    const nextText = lines.join("\n");
    const sigCB = createHash("sha256").update(nextText + "|todo:" + Object.keys(todoCB).sort().join(",")).digest("hex").slice(0, 12);
    let pushedCB = false;
    if (stCB.sig !== sigCB || pulled || (req.body || {}).force) {
      const rUp = await fetch("https://www.googleapis.com/upload/drive/v3/files/" + DOC_CB + "?uploadType=media&supportsAllDrives=true", {
        method: "PATCH", headers: { Authorization: "Bearer " + gtCB, "Content-Type": "text/html; charset=utf-8" }, body: "<html><body>" + htmlParts.join("") + "</body></html>",
      });
      if (!rUp.ok) { const dUp = await rUp.json().catch(() => ({})); res.status(400).json({ error: "doc update failed: " + ((dUp.error && dUp.error.message) || rUp.status) }); return; }
      pushedCB = true;
    }
    const nextBase = {}; for (const c of postsCB) nextBase[numCB(c)] = { c: (c.desc || "").trim(), h: (c.tags || "").trim() };
    await kvSet("sisters_captions_doc_state", { sig: sigCB, base: nextBase, at: Date.now() });
    res.json({ ok: true, posts: postsCB.length, pulled, pushed: pushedCB, noted: notedCT });
    return;
  }
  // ── Post formats: face to camera / b-roll / carousel / static ─────────────
  // Recurring (pinger): watches the month's Reels + Carousels folders and the
  // root "Blerina Videos To Edit" / "Courtney videos to edit" folders; when
  // anything changes it re-reads every post's content (numbered final files
  // first, vision on the grid tile otherwise) and re-tags every card with
  // explicit IG · and TT · chips under her cadence rules:
  //   max 1-2 statics per cycle, statics are Instagram-only;
  //   where IG runs a static, TikTok runs a REEL (her rule Aug 26 — was carousel);
  //   carousels are fine on IG, but TikTok prefers a reel when one exists.
  if (op === "sisters_formats" && req.method === "POST") {
    const okKeyF = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authF = okKeyF ? null : await getAuthEarly(req);
    if (!okKeyF && !ownerRole(authF)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const bF = req.body || {};
    const gtF = await googleToken();
    if (!gtF) { res.json({ ok: false, error: "google_not_connected" }); return; }
    const lsF = async (fid) => (await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("'" + fid + "' in parents and trashed=false") + "&fields=files(id,name,mimeType)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true", { headers: { Authorization: "Bearer " + gtF } })).json()).files || [];
    const rootF = await lsF(SBOARD.driveRootId);
    const monthF = String((await kvGet(SBOARD.monthDefaultKv)) || "September");
    const mFold = rootF.find((f) => f.mimeType === "application/vnd.google-apps.folder" && (f.name || "").trim().toLowerCase() === monthF.toLowerCase());
    const findSub = async (parent, rx) => parent ? (await lsF(parent.id || parent)).find((f) => f.mimeType === "application/vnd.google-apps.folder" && rx.test((f.name || "").trim())) : null;
    const reelsF = mFold ? await findSub(mFold, /^reels$/i) : null;
    const carF = mFold ? await findSub(mFold, /^carousels$/i) : null;
    const reelFiles = reelsF ? await lsF(reelsF.id) : [];
    const carFiles = carF ? await lsF(carF.id) : [];
    // the editors' delivery folders: any change re-triggers classification
    const editNames = [];
    for (const f of rootF) {
      if (!/(blerina|courtney).*(edit)/i.test(f.name || "")) continue;
      const l1 = await lsF(f.id);
      for (const k of l1) { editNames.push(k.name); if (k.mimeType === "application/vnd.google-apps.folder") { (await lsF(k.id)).forEach((x) => editNames.push(k.name + "/" + x.name)); } }
    }
    const numOf = (n) => { const m = /^#?\s*(\d+)/.exec((n || "").trim()); return m ? parseInt(m[1], 10) : null; };
    const reelByN = {}; reelFiles.forEach((f) => { const n = numOf(f.name); if (n) reelByN[n] = true; });
    const carByN = {}; carFiles.forEach((f) => { const n = numOf(f.name); if (n) carByN[n] = true; });
    const g1F = (await kvGet("sisters_grid_tiles_1" + SBOARD.kvSuffix)) || { tiles: [] };
    const g2F = (await kvGet("sisters_grid_tiles_2" + SBOARD.kvSuffix)) || { tiles: [] };
    const tilesF = [...(g1F.tiles || []), ...(g2F.tiles || [])];
    const sigF = createHash("sha256").update(JSON.stringify([tilesF.map((t) => t.cover + t.tag), Object.keys(reelByN), Object.keys(carByN), editNames.sort()])).digest("hex").slice(0, 12);
    const stF = (await kvGet("sisters_formats_state" + SBOARD.kvSuffix)) || {};
    if (!bF.force && stF.sig === sigF) { res.json({ ok: true, skipped: true }); return; }
    // vision: what is each tile — face to camera, b-roll, or a product/static still?
    let tileStyle = stF.sig && stF.tileStyles && stF.tilesHash === createHash("sha256").update(JSON.stringify(tilesF.map((t) => t.cover))).digest("hex").slice(0, 12) ? stF.tileStyles : null;
    const akeyF = process.env.ANTHROPIC_API_KEY;
    if (!tileStyle && akeyF && tilesF.length) {
      tileStyle = {};
      try {
        const JimpF = (await import("jimp")).default;
        for (let batch = 0; batch < tilesF.length; batch += 14) {
          const chunk = tilesF.slice(batch, batch + 14);
          const contentF = [];
          const idxs = [];
          for (let i = 0; i < chunk.length; i++) {
            try {
              const u = /^https?:/.test(chunk[i].cover) ? chunk[i].cover : APP_ORIGIN + chunk[i].cover;
              const rb = await fetch(u); if (!rb.ok) continue;
              const im = await JimpF.read(Buffer.from(await rb.arrayBuffer())); im.resize(260, JimpF.AUTO); im.quality(68);
              contentF.push({ type: "text", text: "Tile " + (batch + i + 1) + ":" });
              contentF.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: (await im.getBufferAsync(JimpF.MIME_JPEG)).toString("base64") } });
              idxs.push(batch + i + 1);
            } catch (e1) {}
          }
          if (!idxs.length) continue;
          contentF.push({ type: "text", text: 'These are Instagram grid tiles. Classify each: "face" (a person talking or looking to camera, face prominent), "broll" (lifestyle or scene moment, people incidental or partial), or "still" (product or garment photo that would run as a static image). Return ONLY JSON: {"tiles":[{"i":1,"style":"face"}]} covering every tile shown.' });
          const rF = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": akeyF, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 900, messages: [{ role: "user", content: contentF }] }) });
          const dF = await rF.json(); if (dF && dF.error) throw new Error(dF.error.message || "api error");
          const tF = (dF.content || []).map((c) => c.text || "").join("");
          const pF = JSON.parse(tF.slice(tF.indexOf("{"), tF.lastIndexOf("}") + 1));
          (pF.tiles || []).forEach((x) => { if (["face", "broll", "still"].includes(x.style)) tileStyle[Number(x.i)] = x.style; });
        }
      } catch (eF) { if (!Object.keys(tileStyle || {}).length) tileStyle = null; }
    }
    // Courtney's 12: her pick rules the format, SAME on both channels. She may
    // have named it already (reel/carousel in the concept) and can switch it on
    // the card any time (card.fmt) — colors stay locked to the platform chips.
    const rawF = await kvGet("lavalle_data"); const blobF = Array.isArray(rawF) ? rawF[0] : rawF;
    const bdF = blobF && blobF.boards && blobF.boards[SBOARD.key];
    const cardByN = {};
    if (bdF) {
      const schedF0 = bdF.lists.filter((l) => /^schedule/i.test(l.name || "")).map((l) => l.id);
      bdF.cards.forEach((c) => { if (schedF0.includes(c.listId)) { const m = /^Post (\d+)\b/.exec(c.name || ""); if (m) cardByN[parseInt(m[1], 10)] = c; } });
    }
    const cFmtOf = (c) => {
      if (!c) return "Reel";
      if (c.fmt === "Carousel" || c.fmt === "Reel") return c.fmt;
      const t = ((c.name || "") + " " + (c.desc || "")).toLowerCase();
      if (/carousel/.test(t)) return "Carousel";
      return "Reel";
    };
    // decide each post's IG + TT formats
    // Sarah's rule: TikTok wants mainly face-to-camera daily. Courtney covers 12
    // of the 42 days, so OUR posts default to TT · FTC — with a few
    // deliberate b-roll/carousel exceptions — while Instagram (where heavy FTC
    // underperforms) keeps the b-roll / carousel / static read of the same slot.
    const formats = {}; let staticCount = 0; let ourReelIdx = 0;
    for (let n = 1; n <= tilesF.length; n++) {
      const style = (tileStyle && tileStyle[n]) || null;
      const isC = tilesF[n - 1] && tilesF[n - 1].tag === "C";
      if (isC) {
        const F = cFmtOf(cardByN[n]);
        formats[n] = { ig: F, tt: F, note: "Courtney's pick" };
        continue;
      }
      let ig, tt, note = style === "face" ? "face to camera" : style === "broll" ? "b-roll" : null;
      if (reelByN[n]) { ig = "Reel"; }
      else if (carByN[n]) { ig = "Carousel"; }
      else if (style === "still" && staticCount < 2) { staticCount++; ig = "Static"; }
      else if (style === "still") { ig = "Carousel"; note = "static cap reached"; }
      else if (style) { ig = "Reel"; }
      else continue; // nothing known yet — leave the card untagged
      if (ig === "Static") tt = "Reel"; // her rule Aug 26: IG static days run a TT reel, never carousel
      else if (carByN[n] && !reelByN[n]) tt = "Carousel"; // an actual carousel final with no reel

      else { ourReelIdx++; tt = (ourReelIdx % 5 === 0 && note === "b-roll") ? "B-roll" : "FTC"; }
      formats[n] = { ig, tt, note };
    }
    // write the tags onto the cards (notation rule: every tagged card says IG · … and TT · …)
    let tagged = 0;
    if (bdF) {
      const schedF = bdF.lists.filter((l) => /^schedule/i.test(l.name || "")).map((l) => l.id);
      for (const c of bdF.cards) {
        if (!schedF.includes(c.listId)) continue;
        const m = /^Post (\d+)\b/.exec(c.name || ""); if (!m) continue;
        const f = formats[parseInt(m[1], 10)]; if (!f) continue;
        const keep = (c.labels || []).filter((lb) => { const nm = (typeof lb === "string" ? lb : (lb && lb.n)) || ""; return !/^(IG|TT)\s*·/i.test(nm); });
        const add = [{ n: "IG · " + f.ig + (f.note && f.note !== "Courtney's pick" && f.ig === "Reel" ? " · " + f.note : ""), c: "#E9E6DF" }, { n: "TT · " + f.tt, c: "#C6CCCF" }];
        const next = [...keep.filter((lb) => ((typeof lb === "string" ? lb : lb.n) || "").toLowerCase() === "courtney"), ...add, ...keep.filter((lb) => ((typeof lb === "string" ? lb : lb.n) || "").toLowerCase() !== "courtney")];
        if (JSON.stringify(next) !== JSON.stringify(c.labels || [])) { c.labels = next; tagged++; }
      }
      if (tagged) await kvSet("lavalle_data", blobF);
    }
    await kvSet("sisters_formats_state" + SBOARD.kvSuffix, { sig: sigF, at: Date.now(), tileStyles: tileStyle || undefined, tilesHash: createHash("sha256").update(JSON.stringify(tilesF.map((t) => t.cover))).digest("hex").slice(0, 12) });
    res.json({ ok: true, month: monthF, reels: Object.keys(reelByN).length, carousels: Object.keys(carByN).length, classified: tileStyle ? Object.keys(tileStyle).length : 0, statics: staticCount, tagged });
    return;
  }

  // ── Next-month theme: analytics-driven, feedback-adjusting ────────────────
  // The Theme card explains itself (analytics factors + charts on the card),
  // takes team feedback (Sarah), and RE-EVALUATES the theme the moment a
  // comment lands: every adjustment is credited to its person and rendered
  // bold in the card. Refreshes monthly with new numbers; skips the expensive
  // pass when nothing changed. Any signed-in member may trigger it.
  if (op === "sisters_theme_card" && req.method === "POST") {
    const okKeyT2 = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authT3 = okKeyT2 ? null : await getAuthEarly(req);
    if (!okKeyT2 && !authT3) { res.status(401).json({ error: "Locked." }); return; }
    const bT4 = req.body || {};
    const noDashT = (x) => String(x || "").replace(/\s*[—–]\s*/g, (m, off, str) => (/^[A-Z]/.test(str.slice(off + m.length)) ? ". " : ", ")).replace(/\.\s*\./g, ".").trim();
    const nowT = new Date(); const nextM = new Date(Date.UTC(nowT.getUTCFullYear(), nowT.getUTCMonth() + 1, 1));
    const MON2 = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const label = MON2[nextM.getUTCMonth()] + " " + nextM.getUTCFullYear();
    const rawT3 = await kvGet("lavalle_data"); const blobT3 = Array.isArray(rawT3) ? rawT3[0] : rawT3;
    const bdT3 = blobT3 && blobT3.boards && blobT3.boards[SBOARD.key];
    if (!bdT3) { res.json({ ok: false }); return; }
    const soL = bdT3.lists.find((l) => /strategy outline/i.test(l.name || "")) || bdT3.lists[0];
    let tc = bdT3.cards.find((c) => c.listId === soL.id && /^Theme — /i.test(c.name || "") && (c.name || "").includes(label));
    if (!tc) { tc = { id: "c" + Math.random().toString(36).slice(2, 10), listId: soL.id, name: "Theme — " + label + " (proposed)", labels: [], members: [], attachments: [], links: [], comments: [], done: false }; bdT3.cards.unshift(tc); }
    tc.comments = tc.comments || [];
    // feedback arrives here (not via autosave) so the re-evaluation can never race it
    if (bT4.feedback && String(bT4.feedback).trim()) {
      tc.comments.push({ id: "cm" + Math.random().toString(36).slice(2, 9), by: (authT3 && authT3.name) || (ownerRole(authT3) ? "Kiabeth Cook" : "Team"), text: String(bT4.feedback).trim().slice(0, 500), at: new Date().toISOString() });
    }
    const feedback = tc.comments.filter((c) => !c.sys && c.text).map((c) => ({ by: c.by || "Team", text: c.text }));
    // Review flow: proposed -> Sarah reviews -> her comment hands it to Kiabeth +
    // Kiaredza -> approval drops "(proposed)" so the card is simply the month's
    // Theme. The stage rides as a quiet white chip on the card face.
    const setStage = (stage) => {
      tc.themeData = tc.themeData || {};
      tc.themeData.stage = stage;
      const chip = stage === "sarah" ? "Sarah · ready for review" : stage === "owners" ? "Kiabeth + Kiaredza · ready for review" : null;
      tc.labels = (tc.labels || []).filter((lb) => !/ready for review/i.test((typeof lb === "string" ? lb : (lb && lb.n)) || ""));
      if (chip) tc.labels = [{ n: chip, c: "#FFFFFF" }, ...tc.labels];
      tc.name = (stage === "approved" ? "Theme — " + label : "Theme — " + label + " (proposed)");
    };
    if (bT4.approve) {
      const canApprove = ownerRole(authT3) || /kiaredza/i.test((authT3 && authT3.name) || "");
      if (!canApprove) { res.status(403).json({ error: "Only Kiabeth or Kiaredza can approve the theme." }); return; }
      setStage("approved");
      await kvSet("lavalle_data", blobT3);
      res.json({ ok: true, approved: true, label });
      return;
    }
    if (bT4.feedback) setStage("owners");
    const stT = (await kvGet("sisters_theme_state" + SBOARD.kvSuffix)) || {};
    const needT = !!bT4.force || !!bT4.feedback || stT.month !== label || !tc.themeData || (Date.now() - (stT.at || 0)) > 6 * 86400000 || (stT.feedbackCount || 0) !== feedback.length;
    if (!needT) { await kvSet("lavalle_data", blobT3); res.json({ ok: true, skipped: true, label }); return; }
    // analytics
    const accts = Object.values(igAccounts(await kvGet("instagram_oauth")));
    const base = "https://graph.instagram.com/v23.0";
    const rows = [];
    for (const t of accts) {
      if (!SBOARD.igMatch.test(t.username || "")) continue;
      try {
        const media = await (await fetch(`${base}/me/media?fields=id,caption,media_type,media_product_type,like_count,comments_count,timestamp,permalink,thumbnail_url,media_url&limit=30&access_token=${encodeURIComponent(t.access_token)}`)).json();
        for (const m of (media.data || [])) {
          let saved = null, reach = null;
          try { const d = await (await fetch(`${base}/${m.id}/insights?metric=saved,reach&access_token=${encodeURIComponent(t.access_token)}`)).json(); (d.data || []).forEach((x) => { if (x.name === "saved") saved = x.values?.[0]?.value ?? null; if (x.name === "reach") reach = x.values?.[0]?.value ?? null; }); } catch (e0) {}
          rows.push({ caption: (m.caption || "").replace(/#[\wÀ-ɏ]+/g, "").slice(0, 160), kind: m.media_product_type === "REELS" || m.media_type === "VIDEO" ? "Reel" : m.media_type === "CAROUSEL_ALBUM" ? "Carousel" : "Static", likes: m.like_count || 0, comments: m.comments_count || 0, saved, reach, at: m.timestamp, thumb: m.thumbnail_url || m.media_url || null, url: m.permalink || null });
        }
      } catch (e) {}
    }
    const score = (r) => (r.saved || 0) * 3 + r.likes + r.comments * 2;
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const agg = rows.length ? {
      posts: rows.length,
      avg: { likes: Math.round(mean(rows.map((r) => r.likes))), comments: Math.round(mean(rows.map((r) => r.comments)) * 10) / 10, saved: rows.some((r) => r.saved != null) ? Math.round(mean(rows.filter((r) => r.saved != null).map((r) => r.saved))) : null, reach: rows.some((r) => r.reach != null) ? Math.round(mean(rows.filter((r) => r.reach != null).map((r) => r.reach))) : null },
      formats: ["Reel", "Carousel", "Static"].map((k) => { const r2 = rows.filter((r) => r.kind === k); return { kind: k, count: r2.length, avgEngagement: r2.length ? Math.round(mean(r2.map(score))) : 0 }; }).filter((f) => f.count > 0),
    } : null;
    // Style read (her question: face to camera vs b-roll): classify each post's
    // thumbnail with vision, then compare performance by style.
    const key = process.env.ANTHROPIC_API_KEY;
    if (key && rows.length) {
      try {
        const withThumb = rows.filter((r) => r.thumb).slice(0, 14);
        if (withThumb.length >= 4) {
          // base64 thumbnails: Anthropic's fetcher can't always reach the signed
          // Instagram CDN URLs, so we fetch + shrink them server-side instead.
          const JimpT = (await import("jimp")).default;
          const contentS = [];
          for (let i = 0; i < withThumb.length; i++) {
            try {
              const rb = await fetch(withThumb[i].thumb); if (!rb.ok) continue;
              const im = await JimpT.read(Buffer.from(await rb.arrayBuffer()));
              im.resize(280, JimpT.AUTO); im.quality(70);
              const b64 = (await im.getBufferAsync(JimpT.MIME_JPEG)).toString("base64");
              contentS.push({ type: "text", text: "Post " + (i + 1) + ":" });
              contentS.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
            } catch (eT) {}
          }
          contentS.push({ type: "text", text: 'Classify each post: "face" (person talking or looking to camera, face prominent), "broll" (lifestyle or scene footage, people incidental or partial), or "product" (product or garment still, no people). Return ONLY JSON: {"posts":[{"i":1,"style":"face"}]} covering every post.' });
          const rS = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 900, messages: [{ role: "user", content: contentS }] }) });
          const dS = await rS.json();
          if (dS && dS.error) throw new Error("api: " + (dS.error.message || dS.error.type || "error"));
          const tS = (dS.content || []).map((c) => c.text || "").join("");
          const pS = JSON.parse(tS.slice(tS.indexOf("{"), tS.lastIndexOf("}") + 1));
          (pS.posts || []).forEach((x) => { const r = withThumb[Number(x.i) - 1]; if (r && ["face", "broll", "product"].includes(x.style)) r.style = x.style; });
        }
      } catch (eS) { var styleErr0 = String((eS && eS.message) || eS).slice(0, 200); }
    }
    const styleDbg = { thumbs: rows.filter((r) => r.thumb).length, classified: rows.filter((r) => r.style).length, err: typeof styleErr0 !== "undefined" ? styleErr0 : null };
    // The posts behind the stats: numbered, linkable examples for every group
    // so the team can open the exact Instagram post a number came from.
    const rowsRanked = [...rows].sort((a, b) => score(b) - score(a));
    rowsRanked.forEach((r, i) => { r.n = i + 1; });
    const exampleOf = (r) => ({ n: r.n, kind: r.kind, style: r.style || null, likes: r.likes, comments: r.comments, saved: r.saved, reach: r.reach, caption: (r.caption || "").slice(0, 90) || "(no caption)", url: r.url || null });
    const STYLE_LABEL = { face: "Face to camera", broll: "B-roll", product: "Product still" };
    const styles = ["face", "broll", "product"].map((k) => { const r2 = rowsRanked.filter((r) => r.style === k); return { style: STYLE_LABEL[k], count: r2.length, avgEngagement: r2.length ? Math.round(r2.map(score).reduce((a, b) => a + b, 0) / r2.length) : 0, examples: r2.slice(0, 4).map(exampleOf) }; }).filter((x) => x.count > 0);
    if (agg && styles.length) agg.styles = styles;
    if (agg) {
      agg.examples = rowsRanked.slice(0, 12).map(exampleOf);
      agg.formats = (agg.formats || []).map((f) => ({ ...f, examples: rowsRanked.filter((r) => r.kind === f.kind).slice(0, 4).map(exampleOf) }));
    }
    let analysis = null;
    if (key) {
      const fbTxt = feedback.length ? "\n\nTEAM FEEDBACK TO HONOUR (each item must visibly shape the theme; answer each with ONE short adjustment line credited to that person):\n" + feedback.map((f) => "- " + f.by + ": " + f.text).join("\n") : "";
      const prompt = "You are the content strategist for @lavallesisters (two sisters running a quiet-luxury womenswear brand, The Fold, and a clean refillable body-care/candle brand, Lavalle Haus). Recent Instagram posts with performance (likes, comments, saves, reach):\n" + (rows.length ? rows.sort((a, b) => score(b) - score(a)).slice(0, 20).map((r) => `${r.n}) [${r.kind}${r.style ? " (" + (r.style === "face" ? "face to camera" : r.style === "broll" ? "b-roll" : "product still") + ")" : ""}] likes ${r.likes}, comments ${r.comments}, saved ${r.saved ?? "?"}, reach ${r.reach ?? "?"}: ${r.caption}`).join("\n") : "(no analytics available yet)") + fbTxt + "\n\nIdentify the top-performing TOPICS (not individual posts) with a strength score, then propose ONE theme for " + label + " in the brands' calm, considered register. Everything SHORT and bullet-ready: no sentence longer than about 15 words. Plain punctuation only, never an em dash. Credit adjustments using each person's exact name from the feedback list. If face to camera vs b-roll performance differs, say so in the why bullets with numbers. Return ONLY JSON: {\"topTopics\":[{\"topic\":\"…\",\"strength\":1-10,\"examples\":[postNumbers]},{…},{…}],\"theme\":\"3-6 word theme title\",\"why\":[\"short bullet\",\"short bullet\",\"short bullet\"],\"pillars\":[\"…\",\"…\",\"…\",\"…\"],\"actions\":[\"short action item to discuss\",\"…\",\"…\"],\"formatMix\":\"one short sentence on reels/carousels/statics\",\"adjustments\":[{\"by\":\"exact name\",\"note\":\"one short sentence: how their feedback changed the theme\"}]}";
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }) });
        const j = await r.json(); const txt = (j.content || []).map((c) => c.text || "").join("");
        const m = txt.match(/\{[\s\S]*\}/); if (m) analysis = JSON.parse(m[0]);
      } catch (e) {}
    }
    if (analysis) {
      const adj = (analysis.adjustments || []).map((a) => ({ by: String(a.by || "Team").slice(0, 60), note: noDashT(a.note) })).filter((a) => a.note);
      tc.themeData = {
        month: label, generatedAt: new Date().toISOString(), analytics: agg,
        topTopics: (analysis.topTopics || []).map((t) => (typeof t === "string" ? { topic: noDashT(t), strength: 7, examples: [] } : { topic: noDashT(t.topic), strength: Math.max(1, Math.min(10, Number(t.strength) || 5)), examples: (Array.isArray(t.examples) ? t.examples : []).map(Number).filter((x) => x >= 1).slice(0, 4) })).slice(0, 5),
        theme: noDashT(analysis.theme),
        why: (analysis.why || (analysis.rationale ? [analysis.rationale] : [])).map(noDashT).filter(Boolean).slice(0, 4),
        pillars: (analysis.pillars || []).map(noDashT).filter(Boolean).slice(0, 6),
        actions: (analysis.actions || []).map(noDashT).filter(Boolean).slice(0, 5),
        formatMix: noDashT(analysis.formatMix), adjustments: adj,
      };
      tc.desc = "Proposed theme: " + tc.themeData.theme + (tc.themeData.why.length ? "\n\nWhy:\n" + tc.themeData.why.map((x) => "• " + x).join("\n") : "") + (tc.themeData.actions.length ? "\n\nTo discuss:\n" + tc.themeData.actions.map((x) => "• " + x).join("\n") : "") + (tc.themeData.pillars.length ? "\n\nPillars:\n" + tc.themeData.pillars.map((x) => "• " + x).join("\n") : "") + (tc.themeData.formatMix ? "\n\nFormat mix: " + tc.themeData.formatMix : "") + (adj.length ? "\n\nAdjusted for the team:\n" + adj.map((a) => "• " + a.note + " (" + a.by + ")").join("\n") : "");
    } else if (!tc.themeData) {
      tc.desc = "Analytics aren't connected for @lavallesisters yet (or no posts returned), so no performance-based theme could be drawn. Connect Instagram for the Sisters account and this card fills itself in.";
    }
    if (!(tc.themeData && (tc.themeData.stage === "owners" || tc.themeData.stage === "approved"))) setStage("sarah");
    await kvSet("lavalle_data", blobT3);
    await kvSet("sisters_theme_state" + SBOARD.kvSuffix, { at: Date.now(), month: label, feedbackCount: feedback.length });
    res.json({ ok: true, label, posts: rows.length, styleDbg, theme: tc.themeData && tc.themeData.theme, adjustments: tc.themeData && tc.themeData.adjustments ? tc.themeData.adjustments.length : 0 });
    return;
  }
  // ── Links card → current month's Drive folders ───────────────────────────
  if (op === "sisters_links_card" && req.method === "POST") {
    const okKeyL3 = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authL3 = okKeyL3 ? null : await getAuthEarly(req);
    if (!okKeyL3 && !ownerRole(authL3)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const gtL3 = await googleToken(); if (!gtL3) { res.json({ ok: false, error: "google_not_connected" }); return; }
    const lsL3 = async (fid) => (await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("'" + fid + "' in parents and trashed=false") + "&fields=files(id,name,mimeType)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true", { headers: { Authorization: "Bearer " + gtL3 } })).json()).files || [];
    const SIS3 = SBOARD.driveRootId;
    const wm3 = (await kvGet(SBOARD.monthDefaultKv)) || "September";
    const top = await lsL3(SIS3);
    const mF = top.find((f) => f.mimeType === "application/vnd.google-apps.folder" && (f.name || "").trim().toLowerCase() === wm3.toLowerCase());
    if (!mF) { res.json({ ok: false, error: "month folder missing: " + wm3 }); return; }
    const subs = (await lsL3(mF.id)).filter((f) => f.mimeType === "application/vnd.google-apps.folder");
    const order = ["cover photos", "courtney to edit", "reels", "carousels", "strategy outline", "grid"];
    subs.sort((a, b) => { const ia = order.indexOf((a.name || "").trim().toLowerCase()), ib = order.indexOf((b.name || "").trim().toLowerCase()); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    // "Courtney to edit" renders as "Courtney drafted" and points at her
    // DRAFTED CONTENT folder (Kiabeth, Aug 26) — the drafts are what the team
    // opens from here, not the raw to-edit pool.
    const links = [{ label: wm3 + " folder", url: "https://drive.google.com/drive/folders/" + mF.id }].concat(subs.map((f) => { const nmL = (f.name || "").trim(); if (/^courtney to edit$/i.test(nmL)) return { label: "Courtney drafted", url: "https://drive.google.com/drive/folders/1woGS7L4PQwFcNOu3sxBtTXP2ZIo8DMkc" }; return { label: wm3 + " → " + nmL, url: "https://drive.google.com/drive/folders/" + f.id }; }));
    // Captions + Hashtags doc and the grid archive ride INSIDE the month group
    // (her ask, Aug 26) — the "<month> → X" label is what nests them in the
    // Links sheet, and they follow the working month automatically.
    if (SBOARD.key === "lavalle-sisters") links.push({ label: wm3 + " → Captions + Hashtags", url: "https://docs.google.com/document/d/1Do98h-x2dl4Wj8suLLHTXrm_2GSOmfN9nyUQhFRXLrI/edit" });
    links.push({ label: wm3 + " → Grid", url: "https://drive.google.com/drive/folders/" + (((await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("name='Lavalle Sisters — Grid Archive' and mimeType='application/vnd.google-apps.folder' and trashed=false") + "&fields=files(id)", { headers: { Authorization: "Bearer " + gtL3 } })).json()).files || [])[0] || {}).id });
    links.push({ label: "Lavalle Sisters (all months)", url: "https://drive.google.com/drive/folders/" + SIS3 });
    // Pinned links survive every rebuild (the card's links are REPLACED each
    // run, so anything hand-added would vanish on the next pinger tick).
    // Owner POST {extra:[{label,url}...]} stores the pinned list.
    if (Array.isArray((req.body || {}).extra)) await kvSet("sisters_links_extra" + SBOARD.kvSuffix, req.body.extra.filter((e) => e && e.label && e.url).map((e) => ({ label: String(e.label).slice(0, 80), url: String(e.url).slice(0, 300) })).slice(0, 20));
    const extraL3 = (await kvGet("sisters_links_extra" + SBOARD.kvSuffix)) || [];
    for (const e of extraL3) links.push({ label: e.label, url: e.url });
    const rawL3 = await kvGet("lavalle_data"); const blobL3 = Array.isArray(rawL3) ? rawL3[0] : rawL3;
    const bdL3 = blobL3 && blobL3.boards && blobL3.boards[SBOARD.key];
    if (!bdL3) { res.json({ ok: false }); return; }
    const soL3 = bdL3.lists.find((l) => /strategy outline/i.test(l.name || "")) || bdL3.lists[0];
    let lc = bdL3.cards.find((c) => /^links\b/i.test((c.name || "").trim()));
    if (!lc) { lc = { id: "c" + Math.random().toString(36).slice(2, 10), listId: soL3.id, name: "Links", labels: [], members: [], attachments: [], done: false }; bdL3.cards.push(lc); }
    lc.name = "Links — " + wm3 + " folders (auto)";
    // Clean hyperlinks only (her rule): the card shows just the word — "Carousels",
    // "Reels" — each a click straight into its Drive folder. No raw URLs anywhere.
    // Deduped by label: Drive sometimes holds two folders with the same name.
    const seenLb = new Set();
    lc.links = links.filter((l) => { const k = String(l.label).toLowerCase(); if (seenLb.has(k)) return false; seenLb.add(k); return true; }).map((l) => ({ id: "l" + Math.random().toString(36).slice(2, 8), n: l.label, u: l.url }));
    lc.desc = "Drive shortcuts for the month we're working in — tap a link below. Updates itself when the working month changes.";
    await kvSet("lavalle_data", blobL3);
    res.json({ ok: true, month: wm3, links: links.length });
    return;
  }
  // ── Sisters grid card (To Do column) ─────────────────────────────────────
  // Her rule: a "Grid" card under To Do whose cover is ALWAYS the grid window
  // we're in — 1-9 → 1-21 → 22-30 → 31-42 — rendered from the live tiles with
  // small white post numbers (1-42) top-left; all four windows attached as a
  // slideshow. Runs on the pinger; window = today's post number (start Aug 22).
  if (op === "sisters_grid_card" && req.method === "POST") {
    const okKeyC = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authC = okKeyC ? null : await getAuthEarly(req);
    if (!okKeyC && !ownerRole(authC)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const g1 = (await kvGet("sisters_grid_tiles_1" + SBOARD.kvSuffix)) || { tiles: [] };
    const g2 = (await kvGet("sisters_grid_tiles_2" + SBOARD.kvSuffix)) || { tiles: [] };
    const all = [...(g1.tiles || []), ...(g2.tiles || [])];
    if (all.length < 21) { res.json({ ok: false, error: "tiles not seeded" }); return; }
    const Jimp = (await import("jimp")).default;
    // Quiet numerals (her note: the pixel digits read too techy): thin Inter
    // numbers rendered by resvg from the bundled font, soft shadow, small.
    const { initWasm: initW, Resvg: ResvgN } = await import("@resvg/resvg-wasm");
    const fsN = await import("node:fs"); const pathN = await import("node:path");
    try { await initW(fsN.readFileSync(pathN.join(process.cwd(), "assets", "resvg.wasm"))); } catch (eW0) { if (!/already/i.test(String(eW0 && eW0.message))) throw eW0; }
    const interN = new Uint8Array(fsN.readFileSync(pathN.join(process.cwd(), "assets", "fonts", "Inter-Regular.ttf")));
    const chipCache = {};
    const numChip = async (n) => {
      if (chipCache[n]) return chipCache[n];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="110" height="56" viewBox="0 0 110 56"><text x="11" y="41" font-family="Inter" font-size="30" fill="rgba(26,26,26,0.5)">${n}</text><text x="10" y="40" font-family="Inter" font-size="30" fill="#FFFFFF">${n}</text></svg>`;
      const png = Buffer.from(new ResvgN(svg, { fitTo: { mode: "original" }, font: { fontBuffers: [interN], loadSystemFonts: false, defaultFontFamily: "Inter" } }).render().asPng());
      chipCache[n] = await Jimp.read(png);
      return chipCache[n];
    };
    const drawNum = async (img, text) => { img.composite(await numChip(text), 4, 2); };
    const tileCache = {};
    const getTile = async (cover) => {
      if (tileCache[cover]) return tileCache[cover].clone();
      const u = /^https?:/.test(cover) ? cover : APP_ORIGIN + cover;
      const r = await fetch(u); if (!r.ok) return null;
      const t = (await Jimp.read(Buffer.from(await r.arrayBuffer()))).cover(360, 480);
      tileCache[cover] = t; return t.clone();
    };
    const render = async (from, to) => {
      const slice = all.slice(from - 1, to);
      const n = slice.length, rows = Math.ceil(n / 3);
      const cv = await new Jimp(1080, rows * 480, 0xf2efe9ff);
      for (let i = 0; i < n; i++) {
        try {
          const t = await getTile(slice[i].cover); if (!t) continue;
          await drawNum(t, from + i);
          if (slice[i].tag === "C") { const cx = 360 - 26, cy = 26, rr = 9; t.scan(cx - rr - 4, cy - rr - 4, (rr + 4) * 2, (rr + 4) * 2, function (x2, y2, idx2) { const dd = (x2 - cx) * (x2 - cx) + (y2 - cy) * (y2 - cy); if (dd <= rr * rr) { this.bitmap.data[idx2] = 255; this.bitmap.data[idx2 + 1] = 255; this.bitmap.data[idx2 + 2] = 255; } else if (dd <= (rr + 2) * (rr + 2)) { this.bitmap.data[idx2] = 120; this.bitmap.data[idx2 + 1] = 114; this.bitmap.data[idx2 + 2] = 104; } }); }
          cv.composite(t, (2 - (i % 3)) * 360, (rows - 1 - Math.floor(i / 3)) * 480);
        } catch (e1) {}
      }
      cv.quality(86);
      const buf = await cv.getBufferAsync(Jimp.MIME_JPEG);
      const mid = "gw" + createHash("sha256").update(buf).digest("hex").slice(0, 14);
      await kvSet("media_" + mid, { b64: buf.toString("base64"), ct: "image/jpeg" });
      return "/cover/" + mid + ".jpg";
    };
    // HER RULE: the Grid card always scrolls through the grid in these four
    // windows, in this order: 1-9, 10-21, 22-30, 31-42.
    const WINDOWS = [[1, 9], [10, 21], [22, 30], [31, 42]];
    // one window per invocation (each render is ~10-20s on serverless); results
    // cached against a hash of the tile set so a rearrangement re-renders and an
    // unchanged grid costs nothing. The pinger's repeated calls converge.
    const tilesHash = "w5" + createHash("sha256").update(JSON.stringify(all.map((t) => t.cover + t.tag))).digest("hex").slice(0, 12); // w4 = the 1-9/10-21/22-30/31-42 window set
    let cacheW = (await kvGet("sisters_grid_card_views" + SBOARD.kvSuffix)) || {};
    if (cacheW.hash !== tilesHash) cacheW = { hash: tilesHash, views: {} };
    // which window are we in? computed FIRST so the window the card DISPLAYS
    // renders first — a tile change shows on the card after ONE render call.
    const start = Date.UTC(2026, 7, 26); // posting cycle starts Wed Aug 26
    const dayN = Math.max(0, Math.floor((Date.now() - start) / 86400000));
    let postN = 0; let d = new Date(start);
    for (let i = 0; i <= dayN && postN < 42; i++) { postN++; if ([1, 3, 5].includes(d.getUTCDay())) postN++; d = new Date(d.getTime() + 86400000); }
    const cur = postN <= 9 ? 0 : postN <= 21 ? 1 : postN <= 30 ? 2 : 3;
    let rendered = null;
    for (const wi of [cur, ...[0, 1, 2, 3].filter((x) => x !== cur)]) {
      if (cacheW.views[wi] || rendered != null) continue;
      const [a, b] = WINDOWS[wi];
      cacheW.views[wi] = await render(a, Math.min(b, all.length)); rendered = wi;
      await kvSet("sisters_grid_card_views" + SBOARD.kvSuffix, cacheW);
    }
    const missingW = [0, 1, 2, 3].filter((wi) => !cacheW.views[wi]);
    const views = WINDOWS.map(([a, b], wi) => ({ label: "Grid " + a + "–" + b, url: cacheW.views[wi] || null }));
    // The card updates on EVERY call that has the current window — even while
    // the other windows are still rendering — so it never shows a stale grid.
    if (views[cur].url) {
      const rawC = await kvGet("lavalle_data");
      const blobC = Array.isArray(rawC) ? rawC[0] : rawC;
      const bdC = blobC && blobC.boards && blobC.boards[SBOARD.key];
      if (bdC) {
        const todo = bdC.lists.find((l) => /grid/i.test(l.name || "")) || bdC.lists.find((l) => /^to\s*do$/i.test((l.name || "").trim())) || (!SBOARD.hasCourtney ? bdC.lists.find((l) => /strategy outline/i.test(l.name || "")) : null);
        if (todo) {
          let card = bdC.cards.find((c) => c.listId === todo.id && /^grid\b/i.test(c.name || ""));
          if (!card) { card = { id: "c" + Math.random().toString(36).slice(2, 10), listId: todo.id, name: "Grid", labels: [], members: [], attachments: [], links: [], done: false, desc: "" }; bdC.cards.unshift(card); }
          const wantName = "Grid — " + views[cur].label + " (auto)";
          const atts = views.filter((v) => v.url).map((v) => ({ id: "a" + Math.random().toString(36).slice(2, 9), name: v.label, url: v.url, type: "image/jpeg" }));
          const changedC = card.name !== wantName || card.cover !== views[cur].url || JSON.stringify((card.attachments || []).map((x) => x.url)) !== JSON.stringify(atts.map((x) => x.url));
          if (changedC) {
            card.name = wantName;
            card.cover = views[cur].url;
            card.attachments = atts;
            card.desc = "Auto-updating grid preview. Swipe through the grid in its four windows (the standing rule for this card): 1–9, 10–21, 22–30, 31–42. White dot = Courtney's post. Numbers = post order.";
            await kvSet("lavalle_data", blobC);
          }
        }
      }
    }
    if (missingW.length) { res.json({ ok: true, partial: true, renderedWindow: rendered, next: missingW[0] }); return; }
    res.json({ ok: true, window: views[cur].label, postN, views });
    return;
  }
  // ── Sisters grid tiles: her hand-rearrange editor ────────────────────────
  // KV holds each named grid's tile list (cover URL + K/C tag). GET returns it;
  // POST {grid, tiles} seeds it; POST {grid, order} applies her tap-swap
  // arrangement, re-renders the montage (white-dot C markers), updates the
  // media-store view AND replaces the Drive archive file so every surface
  // shows her version.
  if (op === "sisters_grid_tiles") {
    const authT2 = await getAuthEarly(req);
    if (!authT2) { res.status(401).json({ error: "Locked." }); return; }
    if (req.method === "GET") {
      const g = String(req.query.grid || "1").replace(/[^12]/g, "") || "1";
      const t = (await kvGet("sisters_grid_tiles_" + g + SBOARD.kvSuffix)) || null;
      const tray = (await kvGet("sisters_grid_tray" + SBOARD.kvSuffix)) || [];
      res.json({ grid: g, tiles: t && t.tiles ? t.tiles : [], tray, view: t && t.mid ? "/cover/" + t.mid + ".jpg" : null, locked: !!(t && t.locked) });
      return;
    }
    const bT = req.body || {};
    const g = String(bT.grid || "1").replace(/[^12]/g, "") || "1";
    // the tray (her photo pool) is shared across both grids and can be saved
    // alone — deleting or adding pool photos shouldn't force a re-render
    if (Array.isArray(bT.tray) && !Array.isArray(bT.tiles) && !Array.isArray(bT.order)) {
      await kvSet("sisters_grid_tray" + SBOARD.kvSuffix, bT.tray.map((t) => String(t || "").slice(0, 300)).slice(0, 200));
      res.json({ ok: true, tray: true });
      return;
    }
    if (typeof bT.locked === "boolean" && !Array.isArray(bT.tiles) && !Array.isArray(bT.order)) {
      const isCourtneyT2 = /courtney/i.test(String(authT2.name || "")) || String(authT2.email || "").toLowerCase() === "courtney@itsdoestudio.com";
      if (!ownerRole(authT2) && !isCourtneyT2) { res.status(403).json({ error: "Only Kiabeth or Courtney can lock or unlock the grid." }); return; }
      const recL = (await kvGet("sisters_grid_tiles_" + g + SBOARD.kvSuffix)) || { tiles: [], mid: null };
      recL.locked = bT.locked;
      await kvSet("sisters_grid_tiles_" + g + SBOARD.kvSuffix, recL);
      res.json({ ok: true, grid: g, locked: !!recL.locked });
      return;
    }
    let rec = (await kvGet("sisters_grid_tiles_" + g + SBOARD.kvSuffix)) || { tiles: [], mid: null };
    if (rec.locked) { res.status(409).json({ error: "This grid is locked — unlock it before moving tiles." }); return; }
    const prevTilesW = (rec.tiles || []).map((t) => ({ cover: t.cover, tag: t.tag })); // what the cards currently follow
    if (Array.isArray(bT.tiles) && bT.tiles.length) {
      rec.tiles = bT.tiles.map((t) => ({ cover: String(t.cover || "").slice(0, 300), tag: t.tag === "C" ? "C" : "K" })).slice(0, 40);
    } else if (Array.isArray(bT.order) && bT.order.length === rec.tiles.length) {
      const seen = new Set(bT.order.map(Number));
      if (seen.size === rec.tiles.length) rec.tiles = bT.order.map((i) => rec.tiles[Number(i)]);
    } else { res.status(400).json({ error: "expected tiles or a complete order" }); return; }
    if (Array.isArray(bT.tray)) await kvSet("sisters_grid_tray" + SBOARD.kvSuffix, bT.tray.map((t) => String(t || "").slice(0, 300)).slice(0, 200));
    // Write the arrangement back onto the Schedule cards so the cover she
    // placed (or reframed) in the grid IS the card's cover when it schedules.
    try {
      const rawW = await kvGet("lavalle_data");
      const blobW = Array.isArray(rawW) ? rawW[0] : rawW;
      const bdW = blobW && blobW.boards && blobW.boards[SBOARD.key];
      if (bdW && !SBOARD.hasCourtney) {
        // Fold (no Courtney): grid 1 = Posts 1..21 (Schedule 1-21); grid 2 = Posts 22..42 (Schedule 22-42).
        const schedW = bdW.lists.find((l) => (g === "2" ? /^schedule\s*22\s*[-–]\s*42$/i : /^schedule\s*1\s*[-–]\s*21$/i).test((l.name || "").trim()));
        let kN = g === "1" ? 1 : 22, wrote = 0;
        for (const t of rec.tiles) {
          if (t.tag !== "K") { kN++; continue; }
          if (schedW) {
            const card = bdW.cards.find((c) => c.listId === schedW.id && new RegExp("^post\\s*" + kN + "\\b", "i").test(c.name || ""));
            if (card && card.cover !== t.cover) { card.cover = t.cover; wrote++; }
          }
          kN++;
        }
        if (wrote) await kvSet("lavalle_data", blobW);
      } else if (bdW) {
        // Sisters — ONE combined numbering: tile i of (grid 1 ⧺ grid 2) IS Post i+1
        // (grid 1 = Posts 1–21 in Schedule 1-21, grid 2 = Posts 22–42 in Schedule
        // 22-42; Courtney's posts are the C-dotted tiles, numbered inline). Her
        // rule: the grid is the sequence. So content FOLLOWS THE PHOTO — when she
        // swaps two tiles, the caption, hashtags, approval and Courtney concept
        // swap with them (matched by cover, in order, so duplicate photos stay
        // stable); a photo dragged in from the tray keeps the slot's content and
        // takes the new cover. Post number + date come from the slot: each K
        // advances a day, a C shares the day of the K before it.
        const sched1 = bdW.lists.find((l) => /^schedule\s*1\s*[-–]\s*21$/i.test((l.name || "").trim()));
        const sched2 = bdW.lists.find((l) => /^schedule\s*22\s*[-–]\s*42$/i.test((l.name || "").trim()));
        const inSched = (c) => (sched1 && c.listId === sched1.id) || (sched2 && c.listId === sched2.id);
        const cardAt = (n) => bdW.cards.find((c) => inSched(c) && new RegExp("^post\\s*" + n + "\\b", "i").test(c.name || ""));
        const NAME_RX = /^post\s*\d+(?:\s+[A-Za-z]+\s+\d+)?(?:\s*[—–-]\s*(.+))?$/i; // date sits between number and concept
        const offsetW = g === "1" ? 0 : 21;
        // Dates (rule Aug 25 2026): cycle starts Wed Aug 26; each K advances a
        // day, a C shares the day of the K before it — so with C tiles on the
        // MWF slots, Courtney lands Mon/Wed/Fri. Grid 2 starts after grid 1's days.
        const START_W = Date.UTC(2026, 7, 26);
        let dayW = 0;
        if (g === "2") { const r1W = (await kvGet("sisters_grid_tiles_1" + SBOARD.kvSuffix)) || { tiles: [] }; dayW = (r1W.tiles || []).filter((t0) => t0.tag !== "C").length; }
        // permutation within this grid: new slot q ← previous slot p (by cover, greedy, dup-safe)
        const usedP = new Set(); const srcOf = new Array(rec.tiles.length).fill(-1);
        rec.tiles.forEach((t, q) => { const p = prevTilesW.findIndex((pt, i) => !usedP.has(i) && pt.cover === t.cover); if (p >= 0) { usedP.add(p); srcOf[q] = p; } });
        rec.tiles.forEach((t, q) => { if (srcOf[q] >= 0) return; if (q < prevTilesW.length && !usedP.has(q)) { usedP.add(q); srcOf[q] = q; return; } const p = prevTilesW.findIndex((pt, i) => !usedP.has(i)); if (p >= 0) { usedP.add(p); srcOf[q] = p; } });
        const snap = prevTilesW.map((pt, p) => { const c = cardAt(offsetW + p + 1); return c ? { desc: c.desc || "", tags: c.tags || "", approved: !!c.approved, labels: c.labels || [], attachments: c.attachments || [], links: c.links || [], done: !!c.done, coverUrl: c.coverUrl || "", pub: c.pub, tiktokCover: c.tiktokCover, concept: ((NAME_RX.exec(c.name || "") || [])[1] || "").trim() } : null; });
        let wrote = 0;
        rec.tiles.forEach((t, q) => {
          const n = offsetW + q + 1; const card = cardAt(n); if (!card) return;
          const s = srcOf[q] >= 0 ? snap[srcOf[q]] : null;
          if (s) { card.desc = s.desc; card.tags = s.tags; card.approved = s.approved; card.labels = s.labels; card.attachments = s.attachments; card.links = s.links; card.done = s.done; card.coverUrl = s.coverUrl; if (s.pub) card.pub = s.pub; else delete card.pub; if (s.tiktokCover) card.tiktokCover = s.tiktokCover; else delete card.tiktokCover; }
          if (card.cover !== t.cover) { card.cover = t.cover; card.coverUrl = ""; }
          const dW = new Date(START_W + (t.tag === "C" ? Math.max(0, dayW - 1) : dayW) * 86400000);
          if (t.tag !== "C") dayW++;
          const base = "Post " + n + " " + dW.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
          const hasCTag = (card.labels || []).some((lb) => ((typeof lb === "string" ? lb : lb && lb.n) || "").toLowerCase() === "courtney");
          if (t.tag === "C") {
            const concept = (s && s.concept) || (((NAME_RX.exec(card.name || "") || [])[1] || "").trim()) || "Courtney post";
            card.name = base + " — " + concept;
            if (!/courtney/i.test(card.desc || "")) { card.desc = "Courtney's post — caption and hashtags to come from Courtney."; card.tags = ""; }
            if (!hasCTag) card.labels = [{ n: "Courtney", c: "#FFFFFF" }, ...(card.labels || [])]; // her tag: white box, black square, "Courtney"
          } else {
            card.name = base;
            if (/^courtney's post — caption and hashtags to come/i.test(card.desc || "")) { card.desc = ""; card.tags = ""; }
            if (hasCTag) card.labels = (card.labels || []).filter((lb) => ((typeof lb === "string" ? lb : lb && lb.n) || "").toLowerCase() !== "courtney");
          }
          wrote++;
        });
        // Courtney's own list ("Courtney Posts 1-12") keeps her 12 topic cards —
        // they are NOT part of the 42 and never get merged away. Here we only
        // keep them in step: same photo + a note of which slot each topic
        // occupies now (matched by topic name, since slots move with the grid).
        const crtW2 = bdW.lists.find((l) => /courtney\s*posts/i.test(l.name || ""));
        if (crtW2) {
          rec.tiles.forEach((t, q) => {
            if (t.tag !== "C") return; const n = offsetW + q + 1; const card = cardAt(n); if (!card) return;
            const concept = ((NAME_RX.exec(card.name || "") || [])[1] || "").trim(); if (!concept) return;
            const cc = bdW.cards.find((c) => c.listId === crtW2.id && (c.name || "").toLowerCase().includes(concept.toLowerCase()));
            if (cc) { if (cc.cover !== card.cover) { cc.cover = card.cover; wrote++; } const d2 = "From Trello: COURTNEY CONTENT IDEAS · scheduled as Post " + n + ". Caption + hashtags: Courtney."; if (cc.desc !== d2) { cc.desc = d2; wrote++; } }
          });
        }
        if (wrote) await kvSet("lavalle_data", blobW);
      }
    } catch (eW) {}
    // render montage: slot 1 bottom-right, chronological
    const Jimp = (await import("jimp")).default;
    const nT = rec.tiles.length, rowsT = Math.ceil(nT / 3);
    const cvT = await new Jimp(1080, rowsT * 480, 0xf2efe9ff);
    for (let i = 0; i < nT; i++) {
      try {
        const u = /^https?:/.test(rec.tiles[i].cover) ? rec.tiles[i].cover : APP_ORIGIN + rec.tiles[i].cover;
        const rr = await fetch(u);
        if (!rr.ok) continue;
        const t2 = (await Jimp.read(Buffer.from(await rr.arrayBuffer()))).cover(360, 480);
        if (rec.tiles[i].tag === "C") {
          const cx = 360 - 26, cy = 26, r = 9;
          t2.scan(cx - r - 4, cy - r - 4, (r + 4) * 2, (r + 4) * 2, function (x2, y2, idx2) { const dd = (x2 - cx) * (x2 - cx) + (y2 - cy) * (y2 - cy); if (dd <= r * r) { this.bitmap.data[idx2] = 255; this.bitmap.data[idx2 + 1] = 255; this.bitmap.data[idx2 + 2] = 255; } else if (dd <= (r + 2) * (r + 2)) { this.bitmap.data[idx2] = 120; this.bitmap.data[idx2 + 1] = 114; this.bitmap.data[idx2 + 2] = 104; } });
        }
        cvT.composite(t2, (2 - (i % 3)) * 360, (rowsT - 1 - Math.floor(i / 3)) * 480);
      } catch (eT2) {}
    }
    cvT.quality(88);
    const bufT = await cvT.getBufferAsync(Jimp.MIME_JPEG);
    const midT = "sg" + createHash("sha256").update(bufT).digest("hex").slice(0, 14);
    await kvSet("media_" + midT, { b64: bufT.toString("base64"), ct: "image/jpeg" });
    rec.mid = midT;
    await kvSet("sisters_grid_tiles_" + g + SBOARD.kvSuffix, rec);
    // replace the Drive archive file for this grid (sisters-only; Fold archives live in Social Media/<Month>/grid)
    try {
      const gtT = SBOARD.hasCourtney ? await googleToken() : null;
      if (gtT) {
        const qT = encodeURIComponent("name='Lavalle Sisters — Grid Archive' and mimeType='application/vnd.google-apps.folder' and trashed=false");
        const fT = await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + qT + "&fields=files(id)", { headers: { Authorization: "Bearer " + gtT } })).json();
        const arcT = fT.files && fT.files[0] && fT.files[0].id;
        if (arcT) {
          const kidsT = await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("'" + arcT + "' in parents and trashed=false") + "&fields=files(id,name)", { headers: { Authorization: "Bearer " + gtT } })).json();
          const oldT = (kidsT.files || []).find((f) => (f.name || "").startsWith(g + " —"));
          const nameT = oldT ? oldT.name : (g === "1" ? "1 — Current grid.jpg" : "2 — Next grid.jpg");
          if (oldT) await fetch("https://www.googleapis.com/drive/v3/files/" + oldT.id, { method: "PATCH", headers: { Authorization: "Bearer " + gtT, "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
          const bdT2 = "lht" + bufT.length.toString(36);
          const metaT = JSON.stringify({ name: nameT, parents: [arcT] });
          const preT = `--${bdT2}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaT}\r\n--${bdT2}\r\nContent-Type: image/jpeg\r\n\r\n`;
          await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", { method: "POST", headers: { Authorization: "Bearer " + gtT, "Content-Type": `multipart/related; boundary=${bdT2}` }, body: Buffer.concat([Buffer.from(preT, "utf8"), bufT, Buffer.from(`\r\n--${bdT2}--`, "utf8")]) });
        }
      }
    } catch (eDR) {}
    // Her rule (Aug 25): the Grid card under "Grid and Contributions" updates
    // the moment the grid changes — kick its re-render now (one window; the
    // pinger finishes the remaining windows within its next ticks).
    try {
      if (process.env.PUBLISH_KEY) {
        // loop until the render set converges (current window lands on call 1;
        // the rest follow while time allows — pinger covers any remainder)
        const t0GC = Date.now();
        for (let iGC = 0; iGC < 4 && Date.now() - t0GC < 32000; iGC++) {
          const acGC = new AbortController(); const tmGC = setTimeout(() => acGC.abort(), 25000);
          const rGC = await fetch(APP_ORIGIN + "/api/data?op=sisters_grid_card" + (req.query.board ? "&board=" + encodeURIComponent(req.query.board) : ""), { method: "POST", headers: { "x-publish-key": process.env.PUBLISH_KEY }, signal: acGC.signal }).catch(() => null);
          clearTimeout(tmGC);
          let dGC = null; try { dGC = rGC && await rGC.json(); } catch (eJ2) {}
          if (!dGC || !dGC.partial) break;
        }
        // and refresh Drive cover files + card links for the changed photos
        if (Date.now() - t0GC < 30000) {
          const acC3 = new AbortController(); const tmC3 = setTimeout(() => acC3.abort(), 20000);
          await fetch(APP_ORIGIN + "/api/data?op=sisters_cover_sizes" + (req.query.board ? "&board=" + encodeURIComponent(req.query.board) : ""), { method: "POST", headers: { "x-publish-key": process.env.PUBLISH_KEY }, signal: acC3.signal }).catch(() => {});
          clearTimeout(tmC3);
        }
      }
    } catch (eGC) {}
    res.json({ ok: true, grid: g, view: "/cover/" + midT + ".jpg", tiles: rec.tiles.length });
    return;
  }
  // Pre-grid pointer + Drive archive listing for the sisters dropdown.
  if (op === "sisters_grid_list" && req.method === "GET") {
    const authGL2 = await getAuthEarly(req);
    if (!authGL2) { res.status(401).json({ error: "Locked." }); return; }
    const pg = await kvGet("sisters_pregrid");
    const out2 = [];
    try {
      const gtL = await googleToken();
      if (gtL) {
        const qL = encodeURIComponent("name='Lavalle Sisters — Grid Archive' and mimeType='application/vnd.google-apps.folder' and trashed=false");
        const fL = await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + qL + "&fields=files(id)", { headers: { Authorization: "Bearer " + gtL } })).json();
        const arcL = fL.files && fL.files[0] && fL.files[0].id;
        if (arcL) {
          const kids = await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("'" + arcL + "' in parents and trashed=false") + "&fields=files(id,name,createdTime)&pageSize=50", { headers: { Authorization: "Bearer " + gtL } })).json();
          for (const f of kids.files || []) if (/\.jpe?g$/i.test(f.name || "")) out2.push({ name: f.name.replace(/\.jpe?g$/i, ""), fileId: f.id, created: f.createdTime });
          out2.sort((a, b) => (b.created || "").localeCompare(a.created || ""));
        }
      }
    } catch (eL2) {}
    // Exactly the two named grids, "1 — …" first — the live render duplicates
    // grid 1 and only confused the dropdown, so it is not listed.
    out2.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    res.json({ pregrid: null, archive: out2 });
    return;
  }
  // ── Lavalle Sisters cycle automation ─────────────────────────────────────
  // Her planning rule: 21-post cycles (1/day = 3 weeks), never more on the
  // grid at once. When Post 10 is checked off, the next cycle spawns: snapshot
  // montage of the finishing cycle → Drive, a COMBINED montage weaving
  // Courtney's Mon/Wed/Fri auto-posts (3/wk × 4wk = her 12/month contract)
  // between the dailies — that composite is Courtney's instruction sheet —
  // then the completed cards are DELETED (Drive holds the backup) and a fresh
  // Post 1-21 set is written with continuing dates. Staged via KV so each
  // 15-min pinger tick resumes safely if an invocation times out.
  if (op === "sisters_cycle_check" && req.method === "POST") {
    const okKeyS = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const authS = okKeyS ? null : await getAuthEarly(req);
    if (!okKeyS && !ownerRole(authS)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const gtS = await googleToken();
    if (!gtS) { res.status(400).json({ error: "google_not_connected" }); return; }
    const rawS = await kvGet("lavalle_data");
    const blobS = Array.isArray(rawS) ? rawS[0] : rawS;
    const bdS = blobS && blobS.boards && blobS.boards["lavalle-sisters"];
    if (!bdS) { res.json({ ok: false, error: "no lavalle-sisters board" }); return; }
    const schedS = bdS.lists.find((l) => /^schedule\s*1\s*[-–]\s*21$/i.test((l.name || "").trim()));
    if (!schedS) { res.json({ ok: false, error: "no Schedule 1-21 list" }); return; }
    let courtS = bdS.lists.find((l) => /courtney\s*posts/i.test(l.name || ""));
    if (!courtS) {
      courtS = { id: "l" + Math.random().toString(36).slice(2, 9), name: "Courtney Posts 1-12" };
      bdS.lists.push(courtS);
      await kvSet("lavalle_data", blobS);
    }
    const cardsS = bdS.cards.filter((c) => c.listId === schedS.id && /^post\s*\d+/i.test(c.name || ""));
    const numS = (c) => Number((/^post\s*(\d+)/i.exec(c.name) || [])[1] || 0);
    const p10 = cardsS.find((c) => numS(c) === 10);
    const p1 = cardsS.find((c) => numS(c) === 1);
    const sigS = p1 ? p1.name : "none";
    let st = (await kvGet("sisters_cycle_state")) || { lastSig: null, stage: null };
    if (!p10 || p10.done !== true) { res.json({ ok: true, fired: false, reason: "Post 10 not completed" }); return; }
    if (st.lastSig === sigS && !st.stage) { res.json({ ok: true, fired: false, reason: "cycle already rotated" }); return; }
    if (st.lastSig !== sigS) st = { lastSig: sigS, stage: "montage" };
    const MOS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const tileS = async (Jimp, url) => {
      try {
        const full = /^https?:/.test(url) ? url : APP_ORIGIN + url;
        const r = await fetch(full);
        if (!r.ok) return null;
        const im = await Jimp.read(Buffer.from(await r.arrayBuffer()));
        return im.cover(360, 480);
      } catch (eT) { return null; }
    };
    const upS = async (buf, name, fid) => {
      const bd9 = "lhs" + buf.length.toString(36);
      const meta9 = JSON.stringify({ name, parents: [fid] });
      const pre9 = `--${bd9}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta9}\r\n--${bd9}\r\nContent-Type: image/jpeg\r\n\r\n`;
      return await (await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name", { method: "POST", headers: { Authorization: "Bearer " + gtS, "Content-Type": `multipart/related; boundary=${bd9}` }, body: Buffer.concat([Buffer.from(pre9, "utf8"), buf, Buffer.from(`\r\n--${bd9}--`, "utf8")]) })).json();
    };
    if (st.stage === "montage") {
      const Jimp = (await import("jimp")).default;
      // Drive archive folder: My Drive root / "Lavalle Sisters — Grid Archive"
      const q9 = encodeURIComponent("name='Lavalle Sisters — Grid Archive' and mimeType='application/vnd.google-apps.folder' and trashed=false");
      const f9 = await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + q9 + "&fields=files(id)", { headers: { Authorization: "Bearer " + gtS } })).json();
      let arcId = f9.files && f9.files[0] && f9.files[0].id;
      if (!arcId) arcId = (await (await fetch("https://www.googleapis.com/drive/v3/files", { method: "POST", headers: { Authorization: "Bearer " + gtS, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Lavalle Sisters — Grid Archive", mimeType: "application/vnd.google-apps.folder" }) })).json()).id;
      // 1) finishing cycle snapshot (21 tiles, slot 1 bottom-right)
      const cv1 = await new Jimp(1080, 3360, 0xffffffff);
      for (const c of cardsS) {
        const n = numS(c);
        if (n < 1 || n > 21 || !c.cover) continue;
        const t = await tileS(Jimp, c.cover);
        if (t) cv1.composite(t, (2 - ((n - 1) % 3)) * 360, (6 - Math.floor((n - 1) / 3)) * 480);
      }
      cv1.quality(88);
      const dateTag = new Date().toISOString().slice(0, 10);
      await upS(await cv1.getBufferAsync(Jimp.MIME_JPEG), "Cycle ending " + dateTag + " — grid.jpg", arcId);
      // 2) combined weave: K daily + Courtney on Mon/Wed/Fri, chronological
      const courtCards = bdS.cards.filter((c) => c.listId === courtS.id && /\d+/.test(c.name || "") && c.cover)
        .sort((a, b) => Number((/(\d+)/.exec(a.name) || [])[1]) - Number((/(\d+)/.exec(b.name) || [])[1]));
      // cycle start = tomorrow (rotation moment); K post n on day n-1
      const start = new Date(Date.now() + 86400000);
      const cStartR = await kvGet("sisters_courtney_start");
      const cStartRT = cStartR ? Date.parse(cStartR + "T00:00:00Z") : 0;
      const seq = [];
      let ci = 0;
      const sorted = cardsS.filter((c) => numS(c) >= 1 && numS(c) <= 21).sort((a, b) => numS(a) - numS(b));
      for (let d = 0; d < 21; d++) {
        const day = new Date(start.getTime() + d * 86400000);
        const k = sorted[d];
        if (k) seq.push({ cover: k.cover, tag: "K" });
        if ([1, 3, 5].includes(day.getUTCDay()) && day.getTime() >= cStartRT && ci < courtCards.length) { seq.push({ cover: courtCards[ci].cover, tag: "C" }); ci++; }
      }
      const rows = Math.ceil(seq.length / 3);
      const cv2 = await new Jimp(1080, rows * 480, 0xffffffff);
      for (let i = 0; i < seq.length; i++) {
        if (!seq[i].cover) continue;
        const t = await tileS(Jimp, seq[i].cover);
        // chronological = slot 1 bottom-right, filling right-to-left upward
        const slot = i, row = rows - 1 - Math.floor(slot / 3), col = 2 - (slot % 3);
        if (t) {
          if (seq[i].tag === "C") { const cx = t.getWidth() - 26, cy = 26, r = 9; t.scan(cx - r - 4, cy - r - 4, (r + 4) * 2, (r + 4) * 2, function (x2, y2, idx2) { const dd = (x2 - cx) * (x2 - cx) + (y2 - cy) * (y2 - cy); if (dd <= r * r) { this.bitmap.data[idx2] = 255; this.bitmap.data[idx2 + 1] = 255; this.bitmap.data[idx2 + 2] = 255; } else if (dd <= (r + 2) * (r + 2)) { this.bitmap.data[idx2] = 120; this.bitmap.data[idx2 + 1] = 114; this.bitmap.data[idx2 + 2] = 104; } }); }
          cv2.composite(t, col * 360, row * 480);
        }
      }
      cv2.quality(88);
      await upS(await cv2.getBufferAsync(Jimp.MIME_JPEG), "Cycle from " + start.toISOString().slice(0, 10) + " — combined with Courtney (taupe strip = Courtney).jpg", arcId);
      st.stage = "rotate";
      await kvSet("sisters_cycle_state", st);
      res.json({ ok: true, fired: true, stage: "montage done", courtneyWoven: ci });
      return;
    }
    if (st.stage === "rotate") {
      // delete finished cycle cards (her rule: Drive is the backup), spawn next 21
      const ids = new Set(cardsS.map((c) => c.id));
      // next cycle starts the day AFTER the finishing cycle's last dated post,
      // never mid-cycle (a shortened bridge cycle must still hand off cleanly)
      const MOP2 = ["january","february","march","april","may","june","july","august","september","october","november","december"];
      let lastT = 0;
      for (const c of cardsS) {
        const mD2 = /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})/i.exec(c.name || "");
        if (mD2) lastT = Math.max(lastT, Date.UTC(new Date().getUTCFullYear(), MOP2.indexOf(mD2[1].toLowerCase()), Number(mD2[2])));
      }
      bdS.cards = bdS.cards.filter((c) => !ids.has(c.id));
      const start = new Date(Math.max(Date.now() + 86400000, lastT + 86400000));
      for (let n = 1; n <= 21; n++) {
        const day = new Date(start.getTime() + (n - 1) * 86400000);
        bdS.cards.push({ id: "c" + Math.random().toString(36).slice(2, 10), listId: schedS.id, name: "Post " + n + " " + MOS[day.getUTCMonth()] + " " + day.getUTCDate(), desc: "", labels: [], members: [], attachments: [], links: [], cover: null, done: false });
      }
      await kvSet("lavalle_data", blobS);
      st.stage = null;
      await kvSet("sisters_cycle_state", st);
      res.json({ ok: true, fired: true, stage: "rotated", newCards: 21 });
      return;
    }
    res.json({ ok: true, fired: false, reason: "no stage" });
    return;
  }
  if (op === "fold_grid_gen" && req.method === "POST") {
    const okKeyG = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const auth0g = okKeyG ? null : await getAuthEarly(req);
    if (!okKeyG && !ownerRole(auth0g)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const SMg = "1lHEphb2pERjSK3sLktXxRgoC_GAvLMcC"; // The Fold > Social Media
    const GRIDg = "1DEwOoGasztWJwk-OFUUBPxSmvg9QqSLG"; // Social Media > Grid
    const ASHEg = "1dK8yulLJGrhLeFT_dytYrQtgf2iRQ2fn"; // Content by Ashe Design Haus
    const LOFTg = "1776hhnJOfMAi84w3plQhl8NKroV24DlW"; // Content by the Loft
    const MONg = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const gt = await googleToken();
    if (!gt) { res.status(400).json({ error: "google_not_connected" }); return; }
    const gfetchG = async (u) => (await fetch(u, { headers: { Authorization: "Bearer " + gt } })).json();
    const listG = async (fid) => (await gfetchG("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("'" + fid + "' in parents and trashed=false") + "&fields=files(id,name,mimeType)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true")).files || [];
    const mkdirG = async (name, parent) => {
      const kids = await listG(parent);
      const hit = kids.find((f) => f.mimeType === "application/vnd.google-apps.folder" && (f.name || "").trim().toLowerCase() === name.toLowerCase());
      if (hit) return hit.id;
      const d = await (await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", {
        method: "POST", headers: { Authorization: "Bearer " + gt, "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }),
      })).json();
      return d.id;
    };
    const b = req.body || {};
    const now = new Date();
    // default target = next calendar month
    let mi = b.month ? Number(b.month) - 1 : (now.getMonth() + 1) % 12;
    let yr = b.year ? Number(b.year) : now.getFullYear() + (b.month ? 0 : (now.getMonth() === 11 ? 1 : 0));
    const planKey = "gridgen_" + yr + "_" + (mi + 1);
    if (b.reset) { await kvSet(planKey, null); if (b.clearUsed) await kvSet("grid_used", {}); res.json({ ok: true, stage: "reset", plan: planKey, clearedUsed: !!b.clearUsed }); return; }
    let plan = await kvGet(planKey);

    // ── Stage 1: gather candidates ───────────────────────────────────────────
    if (!plan || !plan.stage) {
      const used = (await kvGet("grid_used")) || {}; // srcId -> "YYYY-M" it was used
      const cutoff = new Date(yr, mi - 2, 1); // used within the last 2 months = excluded
      const isFresh = (id) => {
        const u = used[id]; if (!u) return true;
        const [uy, um] = u.split("-").map(Number);
        return new Date(uy, um - 1, 1) < cutoff;
      };
      const candidates = []; // {id, name, src}
      // JPEG/PNG/WebP only — HEIC (UGC phone shots) can't be decoded by the
      // vision API or Jimp, and one bad image block fails the whole request.
      const pushImgs = (files, src) => { for (const f of files) if (/^image\/(jpeg|png|webp)/.test(f.mimeType || "") && isFresh(f.id)) candidates.push({ id: f.id, name: f.name, src }); };
      // Ashe: "<Month> <Year>" or bare "<Month>" subfolder of the Ashe folder
      const asheKids = await listG(ASHEg);
      for (const f of asheKids) {
        if (f.mimeType !== "application/vnd.google-apps.folder") continue;
        const nm = (f.name || "").trim().toLowerCase();
        if (nm === MONg[mi].toLowerCase() || nm === (MONg[mi] + " " + yr).toLowerCase()) pushImgs(await listG(f.id), "ashe");
      }
      // Loft: transferred structure nests files two levels deep
      // (Loft / "01. January 2026" / "Flat Lays" / photo.jpg) — walk depth 2.
      const walkLoft = async (fid, depth) => {
        const kids = await listG(fid);
        pushImgs(kids, "loft");
        if (depth < 2) for (const f of kids) if (f.mimeType === "application/vnd.google-apps.folder") await walkLoft(f.id, depth + 1);
      };
      await walkLoft(LOFTg, 0);
      if (!candidates.length) {
        res.json({ ok: false, stage: "plan", month: MONg[mi] + " " + yr, error: "No candidate images: Ashe folder has no " + MONg[mi] + " content and the Loft folder has nothing unused. Add content (ClickUp sync or manual) and re-run." });
        return;
      }
      // Vision request cap is 40. Blend the pools instead of first-come — her
      // rule: unused Loft shoot imagery (lifestyle, texture) LEADS (~26) and
      // Ashe's white-studio e-comm is the accent (~14). An Ashe-heavy pool made
      // September read all-white; never again.
      const asheC = candidates.filter((c) => c.src === "ashe");
      const loftC = candidates.filter((c) => c.src === "loft");
      let cands = [...loftC.slice(0, 40 - Math.min(14, asheC.length)), ...asheC.slice(0, 14)];
      if (cands.length < 40) cands = cands.concat(loftC.slice(40 - Math.min(14, asheC.length)), asheC.slice(14)).slice(0, 40);
      const dropped = Math.max(0, candidates.length - cands.length);
      // previous month's archived grid = the flow reference. Archives live at
      // Social Media/<Month>/grid/<Month> grid.jpg (her rule: per-month, not a
      // separate top-level Grid folder).
      const pmi = (mi + 11) % 12, pyr = mi === 0 ? yr - 1 : yr;
      let refUrl = null;
      const smKids = await listG(SMg);
      const pmFolder = smKids.find((f) => f.mimeType === "application/vnd.google-apps.folder" && (f.name || "").trim().toLowerCase() === MONg[pmi].toLowerCase());
      if (pmFolder) {
        const pmSub = (await listG(pmFolder.id)).find((f) => f.mimeType === "application/vnd.google-apps.folder" && (f.name || "").trim().toLowerCase() === "grid");
        if (pmSub) {
          const ref = (await listG(pmSub.id)).find((f) => / grid\.(jpe?g|png)$/i.test(f.name || "") && (f.mimeType || "").startsWith("image/"));
          if (ref) refUrl = APP_ORIGIN + "/api/data?op=drive_img&id=" + ref.id;
        }
      }
      // Competitor feed references (The Row / Toteme / Jacquemus montages) live
      // in Ashe root/_gridrefs — refreshed captures of their live IG grids.
      let compRefs = [];
      try {
        const grKids = await listG(ASHEg);
        const grF = grKids.find((f) => f.mimeType === "application/vnd.google-apps.folder" && (f.name || "").trim() === "_gridrefs");
        if (grF) compRefs = (await listG(grF.id)).filter((f) => /^image\/(jpeg|png|webp)/.test(f.mimeType || "") && !/-raw-/.test(f.name || "")).map((f) => ({ id: f.id, name: (f.name || "").replace(/\.\w+$/, "") }));
      } catch (eGR) {}
      if (b.dry) { res.json({ ok: true, stage: "dry", month: MONg[mi] + " " + yr, candidates: candidates.length, droppedFromVision: dropped, refUsed: !!refUrl, compRefs: compRefs.map((c) => c.name), sample: cands.slice(0, 10).map((c) => c.src + ":" + c.name) }); return; }
      // Anthropic's URL fetcher times out on 40 live drive_img proxies (each
      // one is a Vercel→Drive→Jimp chain), so bake candidates into the KV
      // media store first and run vision over instant /cover/ URLs.
      plan = { stage: "bake", month: MONg[mi], year: yr, refUrl, refMid: null, cands, dropped, baked: {}, compRefs, compBaked: {} };
      await kvSet(planKey, plan);
      res.json({ ok: true, stage: "bake", month: MONg[mi] + " " + yr, candidates: cands.length, droppedFromVision: dropped, refUsed: !!refUrl, note: "baking candidate images — call again until stage advances" });
      return;
    }

    // ── Stage 1b: bake candidate images into the media store, 8 per run ─────
    if (plan.stage === "bake") {
      // Bakes a SMALL (640px) JPEG for the vision request — images are embedded
      // as base64 blocks, since Anthropic's URL fetcher refused 40 rapid
      // downloads from one host ("Unable to download the file").
      const bakeOne = async (driveId) => {
        try {
          const ir = await fetch("https://www.googleapis.com/drive/v3/files/" + driveId + "?alt=media&supportsAllDrives=true", { headers: { Authorization: "Bearer " + gt } });
          if (!ir.ok) return null;
          const Jimp = (await import("jimp")).default;
          const img = await Jimp.read(Buffer.from(await ir.arrayBuffer()));
          img.cover(640, 800);
          img.quality(80);
          const small = await img.getBufferAsync(Jimp.MIME_JPEG);
          const mid = "g" + randomBytes(8).toString("hex");
          await kvSet("media_" + mid, { type: "image/jpeg", b64: small.toString("base64"), at: new Date().toISOString() });
          return mid;
        } catch (eB) { return null; }
      };
      let did = 0;
      if (plan.refUrl && !plan.refMid) {
        const rid = (plan.refUrl.match(/id=([-\w]+)/) || [])[1];
        plan.refMid = rid ? await bakeOne(rid) : null;
        if (!plan.refMid) plan.refUrl = null; // ref bake failed — proceed without it
        did++;
      }
      for (const cr of plan.compRefs || []) {
        if (did >= 8) break;
        if (plan.compBaked[cr.id] !== undefined) continue;
        plan.compBaked[cr.id] = await bakeOne(cr.id);
        did++;
      }
      for (const c of plan.cands) {
        if (did >= 8) break;
        if (plan.baked[c.id] !== undefined) continue;
        plan.baked[c.id] = await bakeOne(c.id); // null marks a failed bake — skipped later
        did++;
      }
      const remaining = plan.cands.filter((c) => plan.baked[c.id] === undefined).length
        + (plan.compRefs || []).filter((c) => plan.compBaked[c.id] === undefined).length;
      if (!remaining) plan.stage = "vision";
      await kvSet(planKey, plan);
      res.json({ ok: true, stage: plan.stage, month: plan.month + " " + plan.year, baked: Object.keys(plan.baked).length, remaining });
      return;
    }

    // ── Stage 1c: vision arrangement over the baked images ───────────────────
    if (plan.stage === "vision") {
      const akey = process.env.ANTHROPIC_API_KEY;
      if (!akey) { res.status(400).json({ error: "ANTHROPIC_API_KEY not set" }); return; }
      const mi2 = MONg.indexOf(plan.month);
      const pmi = (mi2 + 11) % 12, pyr = mi2 === 0 ? plan.year - 1 : plan.year;
      const usable = plan.cands.filter((c) => plan.baked[c.id]);
      const content = [];
      const b64Of = async (mid) => { const rec = await kvGet("media_" + mid); return rec && rec.b64 ? rec.b64 : null; };
      if (plan.refMid) {
        const rb = await b64Of(plan.refMid);
        if (rb) {
          content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: rb } });
          content.push({ type: "text", text: "Above: LAST month's (" + MONg[pmi] + " " + pyr + ") published grid for @thefoldlabel — 7 rows x 3 columns, reads top-left to bottom-right, and slot 1 is the BOTTOM-RIGHT tile (Instagram stacking: new posts push old ones down). The new month must FLOW from it: the first posts of the new month (low slot numbers) sit visually next to the last rows of this grid, so the palette and rhythm must hand off without an abrupt break." });
        }
      }
      for (const cr of plan.compRefs || []) {
        const mid = (plan.compBaked || {})[cr.id];
        const cb2 = mid ? await b64Of(mid) : null;
        if (!cb2) continue;
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: cb2 } });
        content.push({ type: "text", text: "Competitor reference — @" + cr.name + "'s current Instagram feed. Emulate this level of editorial rhythm, tonal discipline, negative space, and the cadence of mixing product, portrait and texture shots. NEVER copy or pick these images — they are style references only." });
      }
      for (let i = 0; i < usable.length; i++) {
        const cb = await b64Of(plan.baked[usable[i].id]);
        if (!cb) { usable.splice(i, 1); i--; continue; }
        content.push({ type: "text", text: "Candidate " + i + " (" + usable[i].src + "):" });
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: cb } });
      }
      const wantN = Math.min(21, usable.length);
      content.push({ type: "text", text: "You are the art director for The Fold (thefoldlabel.com) — quiet-luxury womenswear in The Row / Toteme register. HOUSE GRID DOCTRINE (distilled from The Loft agency's 10 months of grids for this brand family — follow it in every grid): one tonal palette per grid (warm neutrals — cream/ivory/oat/wood — plus AT MOST one accent color family); ONE subject per tile with generous negative space, never busy scenes; cycle the tile types product close-up → hands-in-action → interior vignette → texture/detail → lifestyle in a quiet rhythm; tactile textures (knit, linen, wood, stone) over flat graphics; at most ONE bare-skin tile (legs/shoulders) per grid — keep it professional; faces sparse and softly turned away; cohesion beats variety. Design the " + plan.month + " " + plan.year + " Instagram grid: choose exactly " + wantN + " candidates and assign each a slot 1-" + wantN + ". Slot 1 = bottom-right of the grid, numbering right-to-left then upward (so visually the grid reads slot 21 at top-left down to slot 1 at bottom-right, and slot 1 is posted FIRST in the month). Rules: continue last month's visual story without repeating it — NEVER pick a candidate that already appears as a tile in the previous-month reference grid (it is posted; reusing it is a hard error); lean into what is on-trend for " + plan.month + " " + plan.year + " in this register (seasonal transition, texture, tone); BACKGROUND VARIETY IS MANDATORY — at most 8 of the " + wantN + " tiles may be white/seamless studio shots, the rest must be lifestyle, outdoor, interior, texture or detail imagery; never place two white-studio tiles adjacent; never place two near-identical images, two faces, or two same-dominant-color tiles adjacent (adjacent = left/right neighbor or directly above/below); alternate product, detail and lifestyle shots for rhythm. Return ONLY JSON: {\"picks\":[{\"slot\":1,\"i\":0},…],\"note\":\"one sentence on the direction\"} — every slot exactly once, every i a valid candidate index, no candidate twice." });
      const r7 = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "x-api-key": akey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1500, messages: [{ role: "user", content }] }),
      });
      const d7 = await r7.json();
      const txt7 = ((d7.content || [])[0] || {}).text || "";
      let parsed7;
      try { parsed7 = JSON.parse(txt7.slice(txt7.indexOf("{"), txt7.lastIndexOf("}") + 1)); } catch (e7b) {
        // plan stays at "vision" — calling the op again just retries this stage
        res.json({ ok: false, stage: "vision", error: "vision_parse_failed", raw: txt7.slice(0, 300), apiErr: d7.error || null, stop: d7.stop_reason || null, nCands: usable.length }); return;
      }
      const picks = (parsed7.picks || []).filter((p) => p && p.slot >= 1 && p.slot <= wantN && usable[p.i]).map((p) => ({ slot: p.slot, srcId: usable[p.i].id, srcName: usable[p.i].name, src: usable[p.i].src, done: false }));
      const monthFolderG = await mkdirG(plan.month, SMg);
      const coverFolderG = await mkdirG("Cover Photos", monthFolderG);
      const gridMonthG = await mkdirG("grid", monthFolderG);
      plan = { month: plan.month, year: plan.year, note: parsed7.note || "", refUsed: !!plan.refMid, coverFolderId: coverFolderG, gridMonthId: gridMonthG, picks, stage: "copy" };
      await kvSet(planKey, plan);
      res.json({ ok: true, stage: "planned", month: plan.month + " " + plan.year, refUsed: plan.refUsed, note: plan.note, picked: picks.length });
      return;
    }

    // ── Stage 2: copy + resize picks into Cover Photos, 4 per run ────────────
    if (plan.stage === "copy") {
      const Jimp = (await import("jimp")).default;
      const todo = plan.picks.filter((p) => !p.done).slice(0, 4);
      const used = (await kvGet("grid_used")) || {};
      for (const p of todo) {
        const ir = await fetch("https://www.googleapis.com/drive/v3/files/" + p.srcId + "?alt=media&supportsAllDrives=true", { headers: { Authorization: "Bearer " + gt } });
        if (!ir.ok) { p.err = "download " + ir.status; p.done = true; continue; }
        let buf = Buffer.from(await ir.arrayBuffer());
        try { const img = await Jimp.read(buf); img.cover(1080, 1440); img.quality(88); buf = await img.getBufferAsync(Jimp.MIME_JPEG); } catch (e8) { p.err = "resize"; }
        const boundary = "lhg" + buf.length.toString(36);
        const meta8 = JSON.stringify({ name: p.slot + ".jpg", parents: [plan.coverFolderId] });
        const pre8 = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta8}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`;
        const body8 = Buffer.concat([Buffer.from(pre8, "utf8"), buf, Buffer.from(`\r\n--${boundary}--`, "utf8")]);
        const ur = await (await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", {
          method: "POST", headers: { Authorization: "Bearer " + gt, "Content-Type": `multipart/related; boundary=${boundary}` }, body: body8,
        })).json();
        p.outId = ur.id || null;
        p.done = true;
        used[p.srcId] = plan.year + "-" + (MONg.indexOf(plan.month) + 1);
      }
      if (!plan.picks.some((p) => !p.done)) plan.stage = "composite";
      await kvSet(planKey, plan);
      await kvSet("grid_used", used);
      res.json({ ok: true, stage: plan.stage, month: plan.month + " " + plan.year, copied: plan.picks.filter((p) => p.done && p.outId).length, remaining: plan.picks.filter((p) => !p.done).length, errors: plan.picks.filter((p) => p.err).map((p) => p.slot + ":" + p.err) });
      return;
    }

    // ── Stage 3: render the montage into Grid/<Month> ────────────────────────
    if (plan.stage === "composite") {
      const Jimp = (await import("jimp")).default;
      const TW = 360, TH = 480;
      const canvas = await new Jimp(TW * 3, TH * 7, 0xffffffff);
      for (const p of plan.picks) {
        if (!p.outId) continue;
        try {
          const ir = await fetch("https://www.googleapis.com/drive/v3/files/" + p.outId + "?alt=media&supportsAllDrives=true", { headers: { Authorization: "Bearer " + gt } });
          const tile = await Jimp.read(Buffer.from(await ir.arrayBuffer()));
          tile.cover(TW, TH);
          const row = 6 - Math.floor((p.slot - 1) / 3), col = 2 - ((p.slot - 1) % 3);
          canvas.composite(tile, col * TW, row * TH);
        } catch (e9) {}
      }
      canvas.quality(88);
      const cbuf = await canvas.getBufferAsync(Jimp.MIME_JPEG);
      const boundary9 = "lhc" + cbuf.length.toString(36);
      const meta9 = JSON.stringify({ name: plan.month + " grid.jpg", parents: [plan.gridMonthId] });
      const pre9 = `--${boundary9}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta9}\r\n--${boundary9}\r\nContent-Type: image/jpeg\r\n\r\n`;
      const body9 = Buffer.concat([Buffer.from(pre9, "utf8"), cbuf, Buffer.from(`\r\n--${boundary9}--`, "utf8")]);
      const cr = await (await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name", {
        method: "POST", headers: { Authorization: "Bearer " + gt, "Content-Type": `multipart/related; boundary=${boundary9}` }, body: body9,
      })).json();
      plan.stage = "done";
      plan.compositeId = cr.id || null;
      await kvSet(planKey, plan);
      // Her rule: a completed generated grid locks automatically so the layout
      // can't be nudged by accident (same flag the planner's lock button sets).
      try {
        const rawL = await kvGet("lavalle_data");
        const blobL = Array.isArray(rawL) ? rawL[0] : rawL;
        if (blobL) {
          blobL.brandGrids = blobL.brandGrids || {};
          blobL.brandGrids["thefoldlabel"] = { ...(blobL.brandGrids["thefoldlabel"] || {}), locked: true };
          await kvSet("lavalle_data", blobL);
        }
      } catch (eL) {}
      res.json({ ok: true, stage: "done", month: plan.month + " " + plan.year, composite: cr.name || null, note: plan.note, tiles: plan.picks.filter((p) => p.outId).length, locked: true });
      return;
    }
    res.json({ ok: true, stage: plan.stage, month: plan.month + " " + plan.year, note: plan.note });
    return;
  }
  // ── Competitor IG grid capture ───────────────────────────────────────────
  // instagram.com's CSP blocks fetch() to us, but plain NAVIGATION is allowed —
  // the profile page collects its tile URLs and navigates here with them
  // base64url-encoded in the query. We pull the tiles server-side, build a 3-col
  // montage, and store it as Ashe/_gridrefs/<brand>.jpg (the grid generator's
  // competitor style references). Key = same derived pbingest key.
  if (op === "ig_gridref" && req.method === "GET") {
    const expect2 = createHash("sha256").update(appToken() + ":pbingest").digest("hex");
    if (req.query.key !== expect2) { res.status(403).send("bad key"); return; }
    let urls = [];
    try { urls = JSON.parse(Buffer.from(String(req.query.urls || ""), "base64url").toString("utf8")); } catch (eU) {}
    urls = (Array.isArray(urls) ? urls : []).filter((u) => /^https:\/\/[\w.-]+\.(cdninstagram\.com|fbcdn\.net)\//.test(String(u))).slice(0, 12);
    const brand = String(req.query.brand || "brand").replace(/[^\w-]/g, "").slice(0, 30);
    if (!urls.length) { res.status(400).send("no valid tile urls"); return; }
    const gtI = await googleToken();
    if (!gtI) { res.status(400).send("google_not_connected"); return; }
    try {
      const Jimp = (await import("jimp")).default;
      const T = 360, cols = 3, rows = Math.ceil(urls.length / cols);
      const canvas = await new Jimp(T * cols, T * rows, 0xffffffff);
      let placed = 0;
      for (let i = 0; i < urls.length; i++) {
        try {
          const ir = await fetch(urls[i]);
          if (!ir.ok) continue;
          const tile = await Jimp.read(Buffer.from(await ir.arrayBuffer()));
          tile.cover(T, T);
          canvas.composite(tile, (i % cols) * T, Math.floor(i / cols) * T);
          placed++;
        } catch (eT) {}
      }
      if (!placed) { res.status(400).send("no tiles fetched"); return; }
      canvas.quality(88);
      const buf = await canvas.getBufferAsync(Jimp.MIME_JPEG);
      const ASHE_I = "1dK8yulLJGrhLeFT_dytYrQtgf2iRQ2fn";
      const qI = encodeURIComponent("name='_gridrefs' and mimeType='application/vnd.google-apps.folder' and '" + ASHE_I + "' in parents and trashed=false");
      const fI = await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + qI + "&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true", { headers: { Authorization: "Bearer " + gtI } })).json();
      let fidI = fI.files && fI.files[0] && fI.files[0].id;
      if (!fidI) fidI = (await (await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", { method: "POST", headers: { Authorization: "Bearer " + gtI, "Content-Type": "application/json" }, body: JSON.stringify({ name: "_gridrefs", mimeType: "application/vnd.google-apps.folder", parents: [ASHE_I] }) })).json()).id;
      // replace any prior capture for this brand
      const qOld = encodeURIComponent("name='" + brand + ".jpg' and '" + fidI + "' in parents and trashed=false");
      const old = await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + qOld + "&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true", { headers: { Authorization: "Bearer " + gtI } })).json();
      for (const of2 of old.files || []) await fetch("https://www.googleapis.com/drive/v3/files/" + of2.id + "?supportsAllDrives=true", { method: "PATCH", headers: { Authorization: "Bearer " + gtI, "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
      const bdI = "lhi" + buf.length.toString(36);
      const metaI = JSON.stringify({ name: brand + ".jpg", parents: [fidI] });
      const preI = `--${bdI}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaI}\r\n--${bdI}\r\nContent-Type: image/jpeg\r\n\r\n`;
      const bodyI = Buffer.concat([Buffer.from(preI, "utf8"), buf, Buffer.from(`\r\n--${bdI}--`, "utf8")]);
      const urI = await (await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name", { method: "POST", headers: { Authorization: "Bearer " + gtI, "Content-Type": `multipart/related; boundary=${bdI}` }, body: bodyI })).json();
      res.setHeader("Content-Type", "text/html");
      res.send("<body style='font-family:monospace'>ig_gridref ok — " + brand + ": " + placed + " tiles → " + (urI.name || "upload failed") + "</body>");
    } catch (eI) { res.status(500).send("err " + String(eI).slice(0, 120)); }
    return;
  }
  // ── Playbook → Drive ingest ──────────────────────────────────────────────
  // Ashe delivers assets via playbook.com share boards. The share page (driven
  // in her browser) fetches each image and POSTs it here as a data URL; we file
  // it into Content by Ashe Design Haus/<folder>. CORS is scoped to
  // playbook.com and auth uses a purpose-derived key (sha256 of the owner
  // token + ":pbingest") so the owner token itself never enters that page.
  // text/plain body avoids a CORS preflight.
  if (op === "pb_ingest") {
    res.setHeader("Access-Control-Allow-Origin", "https://www.playbook.com");
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    let pb = req.body;
    if (typeof pb === "string") { try { pb = JSON.parse(pb); } catch (ePB) { res.status(400).json({ error: "bad json" }); return; } }
    const expect = createHash("sha256").update(appToken() + ":pbingest").digest("hex");
    if (!pb || pb.key !== expect) { res.status(403).json({ error: "bad key" }); return; }
    const mPB = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(String(pb.dataUrl || ""));
    const srcOk = /^https:\/\/(prod\.playbookstatic\.com|img\.playbook\.com|[\w.-]+\.cdninstagram\.com|[\w.-]+\.fbcdn\.net)\//.test(String(pb.srcUrl || ""));
    if (!mPB && !srcOk) { res.status(400).json({ error: "expected image data URL or a playbook srcUrl" }); return; }
    const gtPB = await googleToken();
    if (!gtPB) { res.status(400).json({ error: "google_not_connected" }); return; }
    const ASHE_PB = "1dK8yulLJGrhLeFT_dytYrQtgf2iRQ2fn";
    const findOrMk = async (nm, parent) => {
      const q9 = encodeURIComponent("name='" + nm + "' and mimeType='application/vnd.google-apps.folder' and '" + parent + "' in parents and trashed=false");
      const f9 = await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + q9 + "&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true", { headers: { Authorization: "Bearer " + gtPB } })).json();
      let id9 = f9.files && f9.files[0] && f9.files[0].id;
      if (!id9) id9 = (await (await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", { method: "POST", headers: { Authorization: "Bearer " + gtPB, "Content-Type": "application/json" }, body: JSON.stringify({ name: nm, mimeType: "application/vnd.google-apps.folder", parents: [parent] }) })).json()).id;
      return id9;
    };
    const sub = String(pb.folder || "September 2026").replace(/['"\\]/g, "").slice(0, 60);
    let fidPB = await findOrMk(sub, ASHE_PB);
    if (pb.sub) fidPB = await findOrMk(String(pb.sub).replace(/['"\\]/g, "").slice(0, 60), fidPB);
    let bufPB, ctypePB;
    if (mPB) {
      bufPB = Buffer.from(mPB[2], "base64");
      ctypePB = mPB[1];
    } else {
      // server-side pull for large assets (videos) — the page only sends the
      // signed URL, never the bytes
      const vr = await fetch(pb.srcUrl);
      if (!vr.ok) { res.status(400).json({ error: "src fetch " + vr.status }); return; }
      bufPB = Buffer.from(await vr.arrayBuffer());
      ctypePB = vr.headers.get("content-type") || "video/mp4";
      if (bufPB.length > 150 * 1024 * 1024) { res.status(400).json({ error: "file too large" }); return; }
    }
    const namePB = String(pb.name || "asset.jpg").replace(/[/\\]/g, "-").slice(0, 120);
    const bd = "lhp" + bufPB.length.toString(36);
    const metaPB = JSON.stringify({ name: namePB, parents: [fidPB] });
    const prePB = `--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaPB}\r\n--${bd}\r\nContent-Type: ${ctypePB}\r\n\r\n`;
    const bodyPB = Buffer.concat([Buffer.from(prePB, "utf8"), bufPB, Buffer.from(`\r\n--${bd}--`, "utf8")]);
    const urPB = await (await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name", { method: "POST", headers: { Authorization: "Bearer " + gtPB, "Content-Type": `multipart/related; boundary=${bd}` }, body: bodyPB })).json();
    res.json({ ok: !!urPB.id, id: urPB.id || null, name: urPB.name || null, err: (urPB.error && urPB.error.message) || null });
    return;
  }
  // Owner-only ClickUp API probe — lets us read chat/comment surfaces (e.g. the
  // thread where Ashe shares Playbook delivery links) without shipping the
  // token anywhere. Body: {path: "/v3/workspaces/…"} (v2 paths need /api/v2
  // prefix stripped — pass path relative to api.clickup.com/api).
  if (op === "clickup_probe" && req.method === "POST") {
    const auth0p = await getAuthEarly(req);
    if (!ownerRole(auth0p)) { res.status(403).json({ error: "Owner only." }); return; }
    const ctp = process.env.CLICKUP_TOKEN;
    if (!ctp) { res.json({ ok: false, error: "CLICKUP_TOKEN not set" }); return; }
    const p = String((req.body || {}).path || "");
    if (!p.startsWith("/")) { res.status(400).json({ error: "path required" }); return; }
    const rp = await fetch("https://api.clickup.com/api" + p, { headers: { Authorization: ctp } });
    const dp = await rp.json().catch(() => null);
    res.status(200).json({ status: rp.status, body: dp });
    return;
  }
  // ── ClickUp → Drive: Ashe Design Haus deliveries ─────────────────────────────
  // Ashe uploads her work as ClickUp attachments (playbook lists). This walks
  // workspace 9014402696, finds attachments on playbook tasks (falling back to
  // every task attachment), and files each NEW one into Drive under
  // "Content by Ashe Design Haus" / <Month Year> — month from the attachment's
  // own date. Dedupe by attachment id in KV, ≤5 new files per run (daily cron
  // catches up), files over 80MB reported instead of transferred.
  if (op === "clickup_sync" && req.method === "POST") {
    const okKey2 = process.env.PUBLISH_KEY && req.headers["x-publish-key"] === process.env.PUBLISH_KEY;
    const auth0e = okKey2 ? null : await getAuthEarly(req);
    if (!okKey2 && !ownerRole(auth0e)) { res.status(403).json({ error: "Owner or key only." }); return; }
    const ct = process.env.CLICKUP_TOKEN;
    if (!ct) { res.json({ ok: false, error: "CLICKUP_TOKEN not set — create a personal API token in ClickUp (avatar → Settings → Apps → API Token) and add it as CLICKUP_TOKEN in Vercel env vars." }); return; }
    const cu = async (path) => (await fetch("https://api.clickup.com/api/v2" + path, { headers: { Authorization: ct } })).json();
    const TEAM = "9014402696";
    const ASHE_DRIVE = "1dK8yulLJGrhLeFT_dytYrQtgf2iRQ2fn"; // Content by Ashe Design Haus
    const gt = await googleToken();
    if (!gt) { res.status(400).json({ error: "google_not_connected" }); return; }
    const seen = (await kvGet("clickup_seen")) || {};
    const lists = [];
    let cuDebug = null;
    try {
      const spResp = await cu("/team/" + TEAM + "/space?archived=false");
      const spaces = spResp.spaces || [];
      const teams = (await cu("/team")).teams || [];
      cuDebug = { spacesErr: spResp.err || null, spaces: spaces.map((s) => s.name), teams: teams.map((t) => t.id + ":" + t.name) };
      for (const sp of spaces) {
        for (const fl of ((await cu("/space/" + sp.id + "/folder?archived=false")).folders || [])) for (const l of fl.lists || []) lists.push({ id: l.id, name: (fl.name + " " + l.name) });
        for (const l of ((await cu("/space/" + sp.id + "/list?archived=false")).lists || [])) lists.push({ id: l.id, name: l.name });
      }
      // Guests see no spaces — only items explicitly shared with them, via the
      // shared-hierarchy endpoint. Walk every workspace the token belongs to.
      if (!lists.length) {
        for (const tm of teams) {
          const sh = (await cu("/team/" + tm.id + "/shared")).shared || {};
          for (const fl of sh.folders || []) for (const l of fl.lists || []) lists.push({ id: l.id, name: (fl.name + " " + l.name) });
          for (const l of sh.lists || []) lists.push({ id: l.id, name: l.name });
        }
        cuDebug.sharedLists = lists.map((l) => l.name);
      }
    } catch (e7) { res.json({ ok: false, error: "ClickUp API: " + String(e7).slice(0, 120) }); return; }
    const playbook = lists.filter((l) => /playbook/i.test(l.name));
    const scanLists = playbook.length ? playbook : lists;
    const MONTHS2 = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const found = []; const skippedBig = [];
    // The list-tasks endpoint returns tasks WITHOUT their attachments — those
    // only appear on the per-task detail call, so fetch details (capped).
    let detailCalls = 0;
    for (const l of scanLists.slice(0, 20)) {
      const tasks = (await cu("/list/" + l.id + "/task?include_closed=true&page=0")).tasks || [];
      for (const t of tasks) {
        if (detailCalls >= 60) break;
        detailCalls++;
        const td = await cu("/task/" + t.id);
        for (const a of td.attachments || []) {
          if (!a.url || seen[a.id]) continue;
          found.push({ id: a.id, title: a.title || ("attachment-" + a.id), url: a.url, date: Number(a.date) || Date.now(), task: t.name });
        }
      }
    }
    let uploaded = 0;
    const folderCache = {};
    const findOrCreate2 = async (name, parent) => {
      const key2 = parent + "/" + name;
      if (folderCache[key2]) return folderCache[key2];
      const q7 = encodeURIComponent("name='" + name + "' and mimeType='application/vnd.google-apps.folder' and '" + parent + "' in parents and trashed=false");
      const fr7 = await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + q7 + "&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true", { headers: { Authorization: "Bearer " + gt } })).json();
      let id7 = fr7.files && fr7.files[0] && fr7.files[0].id;
      if (!id7) {
        const cr7 = await (await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", { method: "POST", headers: { Authorization: "Bearer " + gt, "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }) })).json();
        id7 = cr7.id;
      }
      folderCache[key2] = id7;
      return id7;
    };
    for (const a of found.slice(0, 5)) {
      try {
        const fr8 = await fetch(a.url, { headers: { Authorization: ct } });
        const len = Number(fr8.headers.get("content-length") || 0);
        if (len > 80 * 1024 * 1024) { skippedBig.push(a.title); seen[a.id] = "too-big"; continue; }
        const buf = Buffer.from(await fr8.arrayBuffer());
        if (buf.length > 80 * 1024 * 1024) { skippedBig.push(a.title); seen[a.id] = "too-big"; continue; }
        const d8 = new Date(a.date);
        const monthFolder = await findOrCreate2(MONTHS2[d8.getMonth()] + " " + d8.getFullYear(), ASHE_DRIVE);
        const meta8 = JSON.stringify({ name: a.title, parents: [monthFolder] });
        const boundary8 = "cuup" + Date.now();
        const head8 = Buffer.from("--" + boundary8 + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta8 + "\r\n--" + boundary8 + "\r\nContent-Type: " + (fr8.headers.get("content-type") || "application/octet-stream") + "\r\n\r\n");
        const tail8 = Buffer.from("\r\n--" + boundary8 + "--");
        const up8 = await (await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", { method: "POST", headers: { Authorization: "Bearer " + gt, "Content-Type": "multipart/related; boundary=" + boundary8 }, body: Buffer.concat([head8, buf, tail8]) })).json();
        if (up8.id) { seen[a.id] = up8.id; uploaded++; }
      } catch (e8) {}
    }
    await kvSet("clickup_seen", seen);
    res.json({ ok: true, listsScanned: scanLists.length, playbookLists: playbook.map((l) => l.name), newAttachments: found.length, uploaded, skippedTooBig: skippedBig, remaining: Math.max(0, found.length - 5), debug: cuDebug });
    return;
  }
  const auth = await getAuth(req);
  if (!auth) { res.status(401).json({ error: "Locked" }); return; }

  // Slack: recent messages for the header bell + connection status.
  // OWNER ONLY — these are Kiabeth's private workspace conversations, so staff
  // accounts never see the bell or reach the feed, even by URL.
  if (op === "slack_feed" || op === "slack_status" || op === "slack_clear" || op === "slack_draft" || op === "slack_send" || op === "slack_discard") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Owner only." }); return; }
  }
  if (req.method === "GET" && op === "slack_feed") {
    const feed = (await kvGet("slack_feed")) || [];
    const since = parseFloat(req.query.since || "0") || 0;
    const drafts = ((await kvGet("slack_drafts")) || []).filter((d) => d.status === "pending");
    // ?check=1 (sent when she opens the panel) asks Slack whether each pending
    // draft has been overtaken by a real reply, so a stale one is flagged before
    // she can tap Send. Kept off the 60s poll — it costs a Slack call per draft.
    if (req.query.check === "1" && drafts.length) {
      const map = (await kvGet("slack_oauth")) || {};
      for (const d of drafts) {
        const answered = await alreadyAnswered(map[d.teamId], d);
        if (answered) d.answered = answered;
      }
    }
    res.json({ feed: feed.slice(0, 60), drafts, latest: feed.length ? parseFloat(feed[0].ts) : 0, unread: since ? feed.filter((f) => parseFloat(f.ts) > since).length : feed.length });
    return;
  }
  if (req.method === "GET" && op === "slack_status") {
    const map = (await kvGet("slack_oauth")) || {};
    res.json({ teams: Object.values(map).map((t) => ({ team: t.team, teamId: t.teamId, installedAt: t.installedAt })) });
    return;
  }
  // Why isn't this posting? Replays the sweep's gating logic read-only and
  // reports the verdict per card — no claims taken, nothing published.
  if (req.method === "GET" && op === "publish_check") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Owner only." }); return; }
    const data = await kvGet("lavalle_data");
    const blob = Array.isArray(data) ? data[0] : data;
    const ledger = (await kvGet("lavalle_published")) || {};
    const tokens = Object.values(igAccounts(await kvGet("instagram_oauth")));
    const now = Date.now();
    const out = [];
    for (const [bKey, board] of Object.entries((blob && blob.boards) || {})) {
      if (bKey.startsWith("_") || !board || !board.cards) continue;
      for (const card of board.cards) {
        const p = card.pub;
        if (!p || !p.status || p.status === "published") continue;
        const lk = "card:" + bKey + ":" + card.id;
        const claimKey = "claim:" + lk;
        const claimRaw = await kvGet(claimKey);
        const claimHeld = claimRaw !== null && claimRaw !== undefined;
        let verdict = "would attempt";
        if (ledger[lk]) verdict = "ledger says already published";
        else if (p.status !== "scheduled" && p.status !== "processing" && p.status !== "converting") verdict = "status not publishable: " + p.status;
        else if (card.dest && card.dest.ig === false) verdict = "dest.ig is false — TikTok only";
        else if (p.status === "scheduled" && (!p.auto || !p.at)) verdict = "not armed (auto=" + p.auto + ", at=" + p.at + ")";
        else if (p.status === "scheduled" && new Date(p.at).getTime() > now) verdict = "scheduled in the future";
        else if (!tokens.find((t) => (t.username || "").toLowerCase() === (p.account || "").toLowerCase())) verdict = "no Instagram token for @" + p.account;
        else if (claimHeld) verdict = "CLAIM HELD — a previous run locked it and never released";
        out.push({ board: board.name, card: card.name, status: p.status, at: p.at, auto: !!p.auto, account: p.account, claimKey, claimRaw, containerId: p.containerId || null, mp4Url: p.mp4Url ? "set" : null, verdict });
      }
    }
    res.json({ now: new Date().toISOString(), cards: out });
    return;
  }
  // Release a stuck publish lock so a post can be retried immediately instead
  // of waiting out the expiry. The ledger still prevents a double post.
  if (op === "publish_unlock" && req.method === "POST") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Owner only." }); return; }
    const b = req.body || {};
    if (!b.boardKey || !b.cardId) { res.status(400).json({ error: "boardKey + cardId required." }); return; }
    await kvDel("claim:card:" + b.boardKey + ":" + b.cardId);
    res.json({ ok: true, released: "card:" + b.boardKey + ":" + b.cardId });
    return;
  }
  // Does the publish lock actually work? Exercises kvClaim on a scratch key and
  // returns Upstash's raw reply.
  if (req.method === "GET" && op === "claim_probe") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Owner only." }); return; }
    // Exercise the REAL kvClaim: first call must win, second must be refused.
    const key = "claimprobe:" + Date.now();
    const first = await kvClaim(key, 30);
    const second = await kvClaim(key, 30);
    await kvDel(key);
    res.json({ firstClaimWins: first, secondIsBlocked: second === false, healthy: first === true && second === false });
    return;
  }
  if (req.method === "GET" && op === "cover_probe") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Owner only." }); return; }
    const data = await kvGet("lavalle_data");
    const blob = Array.isArray(data) ? data[0] : data;
    const card = blob && blob.boards && blob.boards[req.query.board] && (blob.boards[req.query.board].cards || []).find((x) => x.id === req.query.card);
    if (!card) { res.status(404).json({ error: "card not found" }); return; }
    const raw = cardCoverUrl(card, req.query.board, "vertical");
    const baked = await bakeCover(raw);
    let fetchInfo = null;
    if (baked) {
      const t0 = Date.now();
      const r = await fetch(baked);
      const buf = Buffer.from(await r.arrayBuffer());
      fetchInfo = { status: r.status, ms: Date.now() - t0, type: r.headers.get("content-type"), bytes: buf.length, jpegMagic: buf[0] === 0xFF && buf[1] === 0xD8 };
    }
    res.json({ raw, baked, fetchInfo });
    return;
  }
  // Communications: email a recorded-call link to someone. The contact book
  // lives client-side in dbState.comms; this just delivers the email.
  if (op === "comm_send_recording" && req.method === "POST") {
    const b = req.body || {};
    const to = String(b.to || "").trim().toLowerCase();
    const url2 = String(b.url || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { res.status(400).json({ error: "Valid email required." }); return; }
    if (!/^https?:\/\//.test(url2)) { res.status(400).json({ error: "Recording link must be a full URL." }); return; }
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) { res.status(500).json({ error: "RESEND_API_KEY not set" }); return; }
    const from = process.env.RESEND_FROM || "Lavalle Haus OS <onboarding@resend.dev>";
    const title = String(b.title || "Meeting recording").slice(0, 140);
    const chan = String(b.channel || "").slice(0, 80);
    const html = '<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:24px">'
      + '<p style="font-size:15px;color:#1A1A1A">Here is the recording' + (chan ? " from our meeting (" + chan + ")" : "") + ":</p>"
      + '<p><a href="' + url2 + '" style="display:inline-block;background:#1A1A1A;color:#fff;text-decoration:none;padding:12px 22px;letter-spacing:2px;font-family:Arial,sans-serif;font-size:12px;text-transform:uppercase">▶ ' + title + "</a></p>"
      + '<p style="font-size:12px;color:#71716C">Sent from Lavalle Haus.</p></div>';
    const r2 = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: title + " — recording", html }),
    });
    const d2 = await r2.json().catch(() => ({}));
    if (!r2.ok) { res.status(400).json({ error: "Resend refused: " + JSON.stringify(d2).slice(0, 160) }); return; }
    res.json({ ok: true, id: d2.id });
    return;
  }
  // Live Shopify products for the calendar's product timeline — title, current
  // featured image, status. Cached 6h in KV so browsing the calendar doesn't
  // hammer the Shopify API; images stay current because Shopify serves them
  // from the product's CDN URL (an image swap in Shopify shows up here).
  if (req.method === "GET" && op === "shop_products") {
    const cached = await kvGet("shop_products_cache");
    if (cached && cached.at && Date.now() - new Date(cached.at).getTime() < 6 * 3600 * 1000 && req.query.fresh !== "1") { res.json(cached); return; }
    const so = (await kvGet("shopify_oauth")) || {};
    const stok = so.accessToken || so.token;
    if (!stok || !so.shop) { res.json({ products: [], error: "shopify_not_connected" }); return; }
    const q = `query { products(first: 100, query: "status:active") { edges { node { id title status onlineStoreUrl featuredImage { url(transform: { maxWidth: 360 }) } totalInventory } } } }`;
    const r3 = await fetch(`https://${so.shop}/admin/api/2025-10/graphql.json`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": stok },
      body: JSON.stringify({ query: q }),
    });
    const d3 = await r3.json().catch(() => ({}));
    const products = (((d3.data || {}).products || {}).edges || []).map((e) => ({
      id: e.node.id, title: e.node.title, image: (e.node.featuredImage || {}).url || null,
      url: e.node.onlineStoreUrl || null, inventory: e.node.totalInventory,
    }));
    const out = { at: new Date().toISOString(), products };
    if (products.length) await kvSet("shop_products_cache", out);
    res.json(out);
    return;
  }
  // ── Grid intelligence ────────────────────────────────────────────────────────
  // Classify covers the way an art director reads a feed: who is in frame,
  // what KIND of tile it is, its color family and tone. Claude vision does the
  // reading; results are cached by cover URL so a grid re-run costs nothing.
  if (op === "grid_classify" && req.method === "POST") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Owner only." }); return; }
    const akey = process.env.ANTHROPIC_API_KEY;
    if (!akey) { res.status(500).json({ error: "ANTHROPIC_API_KEY not set" }); return; }
    const b = req.body || {};
    const items = (b.items || []).slice(0, 24);
    const refs = b.refs || {}; // { kiabeth: url, kiaredza: url } — pulled from her own FTC-tagged covers
    const out = {};
    const todo = [];
    for (const it of items) {
      const ck = "gclass_" + createHash("sha1").update(String(it.url)).digest("hex").slice(0, 20);
      const cached = await kvGet(ck);
      if (cached && cached.k) out[it.key] = cached; else todo.push({ ...it, ck });
    }
    // batches of 7 tiles per call keeps requests comfortably sized
    for (let i = 0; i < todo.length; i += 7) {
      const batch = todo.slice(i, i + 7);
      const content = [];
      if (refs.kiabeth) content.push({ type: "text", text: "Reference — this person is KIABETH:" }, { type: "image", source: { type: "url", url: refs.kiabeth } });
      if (refs.kiaredza) content.push({ type: "text", text: "Reference — this person is KIAREDZA:" }, { type: "image", source: { type: "url", url: refs.kiaredza } });
      batch.forEach((it, j) => content.push({ type: "text", text: "TILE " + (j + 1) + ":" }, { type: "image", source: { type: "url", url: it.url } }));
      content.push({ type: "text", text:
        "These are Instagram grid tiles for a quiet-luxury brand (The Row / Toteme editorial standard). For EACH tile return strict JSON in an array, one object per tile in order: " +
        '{"w": who is prominently in frame — "kiabeth"|"kiaredza"|"both"|"other"|"none", ' +
        '"k": tile kind — "face" (a person is the subject), "product" (product is the subject), "detail" (close texture/material/crop), "lifestyle" (scene/interior/place, no prominent person), ' +
        '"c": dominant color family — one of "cream","brown","black","white","green","blue","red","pink","grey","tan", ' +
        '"t": overall tone — "light"|"mid"|"dark"}. ' +
        "Respond with ONLY the JSON array, no prose." });
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": akey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1200, messages: [{ role: "user", content }] }),
      });
      const d = await r.json();
      if (!r.ok) { res.status(400).json({ error: "vision: " + JSON.stringify(d.error || d).slice(0, 200), partial: out }); return; }
      let arr = [];
      try { arr = JSON.parse(((d.content || [])[0] || {}).text.replace(/^[^\[]*/, "").replace(/[^\]]*$/, "")); } catch (e) {}
      for (let j = 0; j < batch.length; j++) {
        const c2 = arr[j];
        if (c2 && c2.k) { out[batch[j].key] = c2; await kvSet(batch[j].ck, c2); }
      }
    }
    res.json({ classes: out });
    return;
  }
  // Read a REFERENCE grid (screenshot of a feed she admires) and extract its
  // editorial rhythm — the top-to-bottom, left-to-right sequence of tile kinds.
  if (op === "grid_template" && req.method === "POST") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Owner only." }); return; }
    const akey = process.env.ANTHROPIC_API_KEY;
    if (!akey) { res.status(500).json({ error: "ANTHROPIC_API_KEY not set" }); return; }
    const b = req.body || {};
    const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(String(b.dataUrl || ""));
    if (!m) { res.status(400).json({ error: "Send the reference grid as an image data URL." }); return; }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": akey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 900, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
        { type: "text", text: 'This is a screenshot of an Instagram grid used as an editorial reference. Reading top-left to bottom-right, classify every visible tile as one of "face","product","detail","lifestyle". Also describe the grid\'s editorial logic in one sentence. Return ONLY strict JSON: {"pattern": ["face","product",...], "logic": "..."}' },
      ] }] }),
    });
    const d = await r.json();
    if (!r.ok) { res.status(400).json({ error: "vision: " + JSON.stringify(d.error || d).slice(0, 200) }); return; }
    try {
      const txt = ((d.content || [])[0] || {}).text || "";
      const parsed = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
      res.json({ pattern: (parsed.pattern || []).slice(0, 42), logic: String(parsed.logic || "").slice(0, 240) });
    } catch (e) { res.status(400).json({ error: "couldn't parse the reference grid" }); }
    return;
  }
  // Owner-only: the two URLs she pastes — webhook into Fathom, ICS into GCal.
  if (req.method === "GET" && op === "meetings_urls") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Owner only." }); return; }
    const k = process.env.PUBLISH_KEY || "";
    res.json({ webhook: APP_ORIGIN + "/api/fathom-webhook?key=" + k, ics: APP_ORIGIN + "/api/meetings.ics?key=" + k });
    return;
  }
  if (req.method === "GET" && op === "publish_last") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Owner only." }); return; }
    res.json((await kvGet("publish_last")) || { note: "no sweep recorded yet" });
    return;
  }
  // What does Mux actually say about a stuck conversion?
  if (req.method === "GET" && op === "mux_status") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Owner only." }); return; }
    const job = String(req.query.job || "").replace(/[^a-zA-Z0-9]/g, "");
    const mid = MUX_ID(), msec = MUX_SECRET();
    if (!mid || !msec) { res.json({ error: "Mux not configured" }); return; }
    const r = await fetch("https://api.mux.com/video/v1/assets/" + job, {
      headers: { Authorization: "Basic " + Buffer.from(mid + ":" + msec).toString("base64") },
    });
    const d = await r.json();
    const a = d.data || {};
    res.json({
      http: r.status, status: a.status, errors: a.errors || null,
      duration: a.duration, created_at: a.created_at,
      mp4_support: a.mp4_support || null,
      static_renditions: a.static_renditions || null,
      playback_ids: (a.playback_ids || []).map((x) => ({ id: x.id, policy: x.policy })),
    });
    return;
  }
  if (op === "slack_clear") {
    await kvSet("slack_feed", []);
    res.json({ ok: true });
    return;
  }
  // Which Shopify permissions the stored token actually carries. Shopify can
  // complete an OAuth redirect without re-prompting, so "it said connected" is
  // not proof the new scope was granted — this reads it back. Names only.
  if (req.method === "GET" && op === "shopify_scopes") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Owner only." }); return; }
    const s = (await kvGet("shopify_oauth")) || {};
    const tok = s.accessToken || s.token; // callback stores it as accessToken
    if (!tok || !s.shop) { res.json({ connected: false }); return; }
    try {
      const r = await (await fetch(`https://${s.shop}/admin/oauth/access_scopes.json`, { headers: { "X-Shopify-Access-Token": tok } })).json();
      const scopes = (r.access_scopes || []).map((x) => x.handle).sort();
      res.json({ connected: true, shop: s.shop, grantedAt: s.connectedAt, scopes, canDraftOrders: scopes.includes("write_draft_orders") });
    } catch (e) { res.status(500).json({ error: String(e).slice(0, 200) }); }
    return;
  }
  // ── Replying on Kiabeth's behalf, with her hand on the trigger ──────────────
  // A draft is only ever QUEUED here; it sits in the bell until she taps Send.
  // Nothing in this file posts to Slack without that explicit approval step.
  //
  // A queued draft also goes STALE the moment the conversation moves on. She
  // often answers Sarah in Slack directly, and a draft written before that would
  // make her reply to her own business partner twice. So before a draft is shown
  // as actionable — and again, authoritatively, at send time — we ask Slack
  // whether anyone on her side has already answered since the message it replies
  // to. Checked at send, not just on display, because the panel can sit open.
  async function alreadyAnswered(team, d) {
    if (!team || !d || !d.channelId) return null;
    // No anchor = nothing to measure "since" against. Scanning from the top of
    // the channel would pair the draft with whatever was said most recently and
    // present a stranger's message as the answer to it — which is exactly the
    // false alarm this guard is supposed to prevent. Better to report nothing.
    if (!d.threadTs && !d.sinceTs) return null;
    try {
      const since = d.threadTs || d.sinceTs;
      const url = d.threadTs
        ? `https://slack.com/api/conversations.replies?channel=${encodeURIComponent(d.channelId)}&ts=${encodeURIComponent(d.threadTs)}&limit=50`
        : `https://slack.com/api/conversations.history?channel=${encodeURIComponent(d.channelId)}&oldest=${encodeURIComponent(since || "0")}&limit=50`;
      const r = await (await fetch(url, { headers: { Authorization: "Bearer " + team.token } })).json();
      if (!r.ok || !Array.isArray(r.messages)) return null;
      const after = parseFloat(since || "0") || 0;
      // Anyone who isn't the original author and isn't our own bot counts as an
      // answer — she may reply as herself, or a teammate may have covered it.
      const reply = r.messages.find((m) => parseFloat(m.ts) > after && m.user && m.user !== team.botUserId && m.user !== d.fromUserId && !m.bot_id && m.text);
      if (!reply) return null;
      let who = reply.user;
      try {
        const ur = await (await fetch("https://slack.com/api/users.info?user=" + reply.user, { headers: { Authorization: "Bearer " + team.token } })).json();
        if (ur.ok) who = ur.user.profile.display_name || ur.user.real_name || ur.user.name;
      } catch {}
      return { by: who, text: String(reply.text).slice(0, 300), ts: reply.ts };
    } catch { return null; }
  }
  if (op === "slack_draft" && req.method === "POST") {
    const b = req.body || {};
    if (!b.teamId || !b.channelId || !String(b.text || "").trim()) { res.status(400).json({ error: "teamId, channelId and text are required." }); return; }
    const drafts = (await kvGet("slack_drafts")) || [];
    const draft = {
      id: "d" + randomBytes(6).toString("hex"),
      teamId: b.teamId, team: b.team || "", channelId: b.channelId, channel: b.channel || "",
      threadTs: b.threadTs || null, sinceTs: b.threadTs || b.sinceTs || null,
      fromUserId: b.fromUserId || "", replyTo: b.replyTo || "",
      text: String(b.text).slice(0, 2000), status: "pending", createdAt: new Date().toISOString(),
    };
    drafts.unshift(draft);
    await kvSet("slack_drafts", drafts.slice(0, 50));
    res.json({ ok: true, draft });
    return;
  }
  if (op === "slack_send" && req.method === "POST") {
    const b = req.body || {};
    const drafts = (await kvGet("slack_drafts")) || [];
    const d = drafts.find((x) => x.id === b.id && x.status === "pending");
    if (!d) { res.status(404).json({ error: "That draft is no longer waiting to be sent." }); return; }
    const text = String(b.text || d.text).trim(); // she can edit right before it goes
    if (!text) { res.status(400).json({ error: "Nothing to send." }); return; }
    const map = (await kvGet("slack_oauth")) || {};
    const team = map[d.teamId];
    if (!team) { res.status(400).json({ error: "That workspace is no longer connected." }); return; }
    // Last line of defence against double-replying to a real person.
    if (!b.force) {
      const answered = await alreadyAnswered(team, d);
      if (answered) {
        d.status = "stale"; d.answered = answered;
        await kvSet("slack_drafts", drafts);
        res.status(409).json({ error: "already_answered", answered });
        return;
      }
    }
    const post = await (await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: "Bearer " + team.token, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: d.channelId, text, ...(d.threadTs ? { thread_ts: d.threadTs } : {}) }),
    })).json();
    if (!post.ok) {
      const hint = post.error === "missing_scope" ? "Reconnect the workspace — the bot needs the newer chat:write permission." : post.error;
      res.status(400).json({ error: "Slack refused the message: " + hint });
      return;
    }
    d.status = "sent"; d.text = text; d.sentAt = new Date().toISOString();
    await kvSet("slack_drafts", drafts);
    res.json({ ok: true });
    return;
  }
  if (op === "slack_discard" && req.method === "POST") {
    const drafts = (await kvGet("slack_drafts")) || [];
    const d = drafts.find((x) => x.id === (req.body || {}).id);
    if (d) { d.status = "discarded"; await kvSet("slack_drafts", drafts); }
    res.json({ ok: true });
    return;
  }

  // Who am I — restores name/role on the client after a reload.
  if (req.method === "GET" && op === "me") {
    let photoMe = null;
    try {
      if (auth.userId) { const us = (await kvGet("lavalle_users")) || []; const u0 = us.find((x) => x.id === auth.userId); photoMe = (u0 && u0.photo) || null; }
      else { photoMe = (await kvGet("owner_photo")) || null; }
    } catch (eMe) {}
    res.json({ name: auth.name, role: auth.role, email: auth.email, pages: auth.pages || null, denySegs: auth.denySegs || null, photo: photoMe });
    return;
  }

  // ── Account settings (everyone signed in): own photo + own password ────────
  // The photo lands on the user record AND the team roster entry, so every
  // Avatar chip in the app picks it up. Passwords are one-way hashes — they can
  // never be shown back — so this sets a new one for the signed-in person only.
  if (op === "account" && req.method === "POST") {
    if (!auth) { res.status(401).json({ error: "Locked." }); return; }
    const bA = req.body || {};
    const out = { ok: true };
    if (bA.photo) {
      const mA = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(String(bA.photo));
      if (!mA) { res.status(400).json({ error: "Expected an image." }); return; }
      const idA = "m" + randomBytes(10).toString("hex");
      await kvSet("media_" + idA, { type: mA[1], b64: mA[2], at: new Date().toISOString() });
      const urlA = "/cover/" + idA + ".jpg";
      if (auth.userId) {
        const usersA = (await kvGet("lavalle_users")) || [];
        const uA = usersA.find((x) => x.id === auth.userId);
        if (uA) { uA.photo = urlA; await kvSet("lavalle_users", usersA); }
      } else { await kvSet("owner_photo", urlA); }
      try {
        const rawA = await kvGet("lavalle_data"); const blobA2 = Array.isArray(rawA) ? rawA[0] : rawA;
        const teamA = ((blobA2 || {}).actionsBoard || {}).team || [];
        const nameA = auth.name || "Kiabeth Cook";
        const tA = teamA.find((x) => (x.email && auth.email && x.email.toLowerCase() === auth.email.toLowerCase()) || (x.name || "").toLowerCase() === nameA.toLowerCase());
        if (tA) { tA.avatar = urlA; await kvSet("lavalle_data", blobA2); }
      } catch (eA) {}
      out.photo = urlA;
    }
    if (bA.password) {
      const pwA = String(bA.password);
      if (pwA.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters." }); return; }
      if (!auth.userId) { res.status(400).json({ error: "The house/admin password lives in the server settings — ask Claude to rotate APP_PASSWORD in Vercel." }); return; }
      const usersP = (await kvGet("lavalle_users")) || [];
      const uP = usersP.find((x) => x.id === auth.userId);
      if (!uP) { res.status(404).json({ error: "No account record." }); return; }
      uP.salt = randomBytes(16).toString("hex");
      uP.hash = hashPassword(pwA, uP.salt);
      await kvSet("lavalle_users", usersP);
      out.password = true;
    }
    res.json(out);
    return;
  }

  // ── TikTok connection status + sandbox test post (owner-only) ───────────────
  if (op === "tiktok_status" && req.method === "GET") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Only the owner can view TikTok connection status." }); return; }
    const fmt = (v) => {
      const accounts = Object.values(tiktokAccounts(v)).map((t) => ({ open_id: t.open_id, display_name: t.display_name || null, scope: t.scope, savedAt: t.savedAt }));
      return { connected: accounts.length > 0, accounts };
    };
    res.json({ sandbox: fmt(await kvGet("tiktok_oauth_sandbox")), production: fmt(await kvGet("tiktok_oauth")) });
    return;
  }
  if (op === "instagram_status" && req.method === "GET") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Only the owner can view Instagram connection status." }); return; }
    const accounts = Object.values(igAccounts(await kvGet("instagram_oauth"))).map((t) => ({ user_id: t.user_id, username: t.username || null, savedAt: t.savedAt }));
    res.json({ connected: accounts.length > 0, accounts });
    return;
  }
  if (op === "ig_insights" && req.method === "GET") {
    // Live channel analytics for the Content → Analytics tab (owner-only).
    // saved/reach/retention need the insights scope — accounts connected before
    // that scope was added return likes/comments/followers only.
    if (!ownerRole(auth)) { res.status(403).json({ error: "Analytics are only available to the owner." }); return; }
    const accts = Object.values(igAccounts(await kvGet("instagram_oauth")));
    const base = "https://graph.instagram.com/v23.0";
    const out = [];
    for (const t of accts) {
      try {
        const prof = await (await fetch(`${base}/me?fields=username,followers_count,media_count&access_token=${encodeURIComponent(t.access_token)}`)).json();
        const media = await (await fetch(`${base}/me/media?fields=id,caption,media_type,media_product_type,like_count,comments_count,timestamp,permalink&limit=15&access_token=${encodeURIComponent(t.access_token)}`)).json();
        const light = req.query.light === "1"; // brain view: skip per-media insight calls
        // Friendly post kind — what she asked for instead of "feed".
        const kindOf = (m) => m.media_type === "CAROUSEL_ALBUM" ? "Carousel"
          : (m.media_product_type === "REELS" || m.media_type === "VIDEO") ? "Reel"
          : m.media_type === "IMAGE" ? "Static post" : (m.media_product_type || m.media_type || "Post");
        const items = [];
        for (const m of (media.data || []).slice(0, 12)) {
          const fullCaption = m.caption || "";
          const tags = (fullCaption.match(/#[\wÀ-ɏ]+/g) || []);
          const captionNoTags = fullCaption.replace(/#[\wÀ-ɏ]+/g, "").replace(/\s+/g, " ").trim();
          if (light) { items.push({ id: m.id, likes: m.like_count ?? null, comments: m.comments_count ?? null, at: m.timestamp }); continue; }
          let ins = null;
          const fetchIns = async (metrics) => {
            const d = await (await fetch(`${base}/${m.id}/insights?metric=${metrics.join(",")}&access_token=${encodeURIComponent(t.access_token)}`)).json();
            if (d.error) throw new Error(d.error.message || "insights");
            const o = {}; (d.data || []).forEach((x) => { o[x.name] = x.values && x.values[0] ? x.values[0].value : null; });
            return o;
          };
          try {
            const base2 = m.media_type === "VIDEO" || m.media_product_type === "REELS" ? ["saved", "reach", "views", "ig_reels_avg_watch_time"] : ["saved", "reach", "views"];
            try { ins = await fetchIns(base2); }
            catch { ins = await fetchIns(base2.filter((x) => x !== "views")); } // older accounts: no unified views metric
          } catch {}
          items.push({
            id: m.id, kind: kindOf(m), caption: captionNoTags.slice(0, 110), hashtags: tags, hashtagCount: tags.length,
            likes: m.like_count ?? null, comments: m.comments_count ?? null, at: m.timestamp, permalink: m.permalink || null,
            saved: ins ? (ins.saved ?? null) : null, reach: ins ? (ins.reach ?? null) : null, views: ins ? (ins.views ?? null) : null,
            avgWatchSec: ins && ins.ig_reels_avg_watch_time != null ? Math.round(ins.ig_reels_avg_watch_time / 1000) : null,
          });
        }
        out.push({
          username: prof.username || t.username, followers: prof.followers_count ?? null, mediaCount: prof.media_count ?? null,
          insightsAvailable: items.some((i) => i.saved != null || i.reach != null),
          items, error: prof.error ? (prof.error.message || "profile fetch failed").slice(0, 140) : null,
        });
      } catch (e) {
        out.push({ username: t.username, error: String(e).slice(0, 140), items: [] });
      }
    }
    res.json({ accounts: out, tiktok: "pending_review" });
    return;
  }
  if (op === "ig_grid" && req.method === "GET") {
    // The account's real, currently-live Instagram grid — for the Schedule
    // tab's "Live" view (owner-only).
    if (!ownerRole(auth)) { res.status(403).json({ error: "Only the owner can view the live grid." }); return; }
    const accts = Object.values(igAccounts(await kvGet("instagram_oauth")));
    const tok = accts.find((t) => (t.username || "").toLowerCase() === (req.query.account || "").toLowerCase()) || accts[0];
    if (!tok) { res.status(400).json({ error: "No connected account." }); return; }
    try {
      const d = await (await fetch(`https://graph.instagram.com/v23.0/me/media?fields=id,media_type,media_product_type,media_url,thumbnail_url,permalink,caption,timestamp&limit=18&access_token=${encodeURIComponent(tok.access_token)}`)).json();
      if (d.error) { res.status(400).json({ error: d.error.message || "media" }); return; }
      res.json({ posts: (d.data || []).map((m) => ({ id: m.id, img: m.media_type === "VIDEO" ? (m.thumbnail_url || m.media_url) : m.media_url, permalink: m.permalink, caption: (m.caption || "").slice(0, 60), at: m.timestamp, kind: m.media_type === "CAROUSEL_ALBUM" ? "Carousel" : (m.media_product_type === "REELS" || m.media_type === "VIDEO") ? "Reel" : "Static" })) });
    } catch (e) { res.status(500).json({ error: String(e).slice(0, 200) }); }
    return;
  }
  if (op === "ig_comments" && req.method === "GET") {
    // Comments on one post, for the Analytics reply dropdown (owner-only).
    if (!ownerRole(auth)) { res.status(403).json({ error: "Only the owner can read comments." }); return; }
    const accts = Object.values(igAccounts(await kvGet("instagram_oauth")));
    const tok = accts.find((t) => (t.username || "").toLowerCase() === (req.query.account || "").toLowerCase()) || accts[0];
    if (!tok) { res.status(400).json({ error: "No connected account." }); return; }
    try {
      // `from{id,username}` returns the commenter identity where the platform
      // allows it; `username` is the older/simpler field. Use whichever fills.
      const d = await (await fetch(`https://graph.instagram.com/v23.0/${req.query.media}/comments?fields=id,text,username,from{id,username},timestamp,like_count,replies{id,text,username,from{id,username},timestamp}&access_token=${encodeURIComponent(tok.access_token)}`)).json();
      if (d.error) { res.status(400).json({ error: d.error.message || "comments" }); return; }
      const name = (x) => (x.from && x.from.username) || x.username || null;
      res.json({ comments: (d.data || []).map((cc) => ({ id: cc.id, text: cc.text, username: name(cc), at: cc.timestamp, likes: cc.like_count ?? null, replies: ((cc.replies && cc.replies.data) || []).map((r) => ({ id: r.id, text: r.text, username: name(r), at: r.timestamp })) })) });
    } catch (e) { res.status(500).json({ error: String(e).slice(0, 200) }); }
    return;
  }
  if (op === "ig_reply" && req.method === "POST") {
    // Reply to a comment — posts straight to Instagram (manage_comments scope).
    if (!ownerRole(auth)) { res.status(403).json({ error: "Only the owner can reply." }); return; }
    const b = req.body || {};
    if (!b.commentId || !(b.message || "").trim()) { res.status(400).json({ error: "commentId and message are required." }); return; }
    const accts = Object.values(igAccounts(await kvGet("instagram_oauth")));
    const tok = accts.find((t) => (t.username || "").toLowerCase() === (b.account || "").toLowerCase()) || accts[0];
    if (!tok) { res.status(400).json({ error: "No connected account." }); return; }
    try {
      const r = await fetch(`https://graph.instagram.com/v23.0/${b.commentId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ message: b.message.trim(), access_token: tok.access_token }),
      });
      const d = await r.json();
      if (!d.id) { res.status(400).json({ error: (d.error && d.error.message) || "reply failed" }); return; }
      res.json({ ok: true, id: d.id });
    } catch (e) { res.status(500).json({ error: String(e).slice(0, 200) }); }
    return;
  }
  if (op === "publish_item" && req.method === "POST") {
    // "Post now" from the Grid drawer — publishes one item immediately.
    if (!ownerRole(auth)) { res.status(403).json({ error: "Only the owner can publish posts." }); return; }
    const b = req.body || {};
    if (!(b.feedId || b.boardKey) || !b.cardId) { res.status(400).json({ error: "feedId (grid) or boardKey (boards) plus cardId are required." }); return; }
    try { res.json(await publishDueItems(b.boardKey ? { boardKey: b.boardKey, cardId: b.cardId, account: b.account, noCover: !!b.noCover } : { feedId: b.feedId, cardId: b.cardId })); }
    catch (e) { res.status(500).json({ error: String(e).slice(0, 300) }); }
    return;
  }
  // Re-post: clear the dedupe ledger entry + re-arm a board card so it can post
  // again (e.g. after deleting the old post on Instagram). Owner only.
  if (op === "repost" && req.method === "POST") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Owner only." }); return; }
    const b = req.body || {};
    if (!b.boardKey || !b.cardId) { res.status(400).json({ error: "boardKey + cardId required." }); return; }
    const data = await kvGet("lavalle_data");
    const blob = Array.isArray(data) ? data[0] : data;
    const card = blob && blob.boards && blob.boards[b.boardKey] && (blob.boards[b.boardKey].cards || []).find((x) => x.id === b.cardId);
    if (!card) { res.status(404).json({ error: "card not found" }); return; }
    const ledger = (await kvGet("lavalle_published")) || {};
    delete ledger[`card:${b.boardKey}:${b.cardId}`];
    await kvSet("lavalle_published", ledger);
    card.pub = { ...(card.pub || {}), status: "scheduled", error: null, mediaId: undefined, publishedAt: undefined, containerId: undefined, convId: undefined, mp4Url: undefined };
    card.done = false;
    await kvSet("lavalle_data", Array.isArray(data) ? [blob] : blob);
    res.json({ ok: true });
    return;
  }

  // Resolve the creator @handle behind a TikTok/IG link. Full URLs already
  // carry the handle; short links (tiktok.com/t/…, vm.tiktok.com) get followed
  // server-side to their canonical @handle URL. Best-effort — returns
  // { handle: null } if the platform blocks the fetch. Powers PR/UGC auto-titles.
  if (op === "resolve_handle" && req.method === "POST") {
    const url = String((req.body || {}).url || "").trim();
    const grab = (u) => {
      let m = u.match(/tiktok\.com\/@([A-Za-z0-9._]+)/i);
      if (m) return "@" + m[1];
      // Instagram: only a /@handle or /handle profile path carries a handle.
      // /p/ and /reel/ links are post shortcodes — no handle available.
      m = u.match(/instagram\.com\/@?([A-Za-z0-9._]+)/i);
      if (m && !/^(p|reel|reels|tv|stories|explore|s)$/i.test(m[1])) return "@" + m[1];
      return null;
    };
    if (!/^https?:\/\//i.test(url)) { res.status(400).json({ error: "bad url" }); return; }
    let handle = grab(url);
    if (!handle) {
      try {
        const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1" } });
        handle = grab(r.url || "");
      } catch (e) { /* platform blocked the fetch — leave handle null */ }
    }
    res.json({ handle: handle || null });
    return;
  }

  // Text-to-speech for the dashboard "Chief" voice. Returns MP3 from a free
  // neural voice (Amazon Polly via StreamElements) — far better than the Mac
  // voice. Chunks long text at sentence boundaries (the endpoint caps length).
  if (op === "tts" && req.method === "POST") {
    const raw = String((req.body || {}).text || "").replace(/\s+/g, " ").trim();
    if (!raw) { res.status(400).send("no text"); return; }
    const voice = (req.body || {}).lang === "es" ? "Miguel" : "Matthew";
    const chunks = []; let cur = "";
    raw.split(/(?<=[.!?])\s+/).forEach((s) => {
      if ((cur + " " + s).length > 480) { if (cur) chunks.push(cur); cur = s.slice(0, 480); }
      else cur = cur ? cur + " " + s : s;
    });
    if (cur) chunks.push(cur);
    try {
      const bufs = [];
      for (const ch of chunks.slice(0, 10)) {
        const r = await fetch("https://api.streamelements.com/kappa/v2/speech?voice=" + voice + "&text=" + encodeURIComponent(ch));
        if (!r.ok) throw new Error("tts upstream " + r.status);
        bufs.push(Buffer.from(await r.arrayBuffer()));
      }
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(Buffer.concat(bufs));
    } catch (e) { res.status(502).send("tts_failed"); }
    return;
  }

  // Send a UGC outreach email from info@lavallehaus.com with the brand-brief PDF
  // attached. Owner-only. Requires RESEND_API_KEY and a verified sender/domain —
  // until info@lavallehaus.com is verified in Resend this returns a clear error.
  if (op === "send_outreach_email" && req.method === "POST") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Owner only." }); return; }
    const b = req.body || {};
    const to = String(b.to || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { res.status(400).json({ error: "A valid creator email is required." }); return; }
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) { res.status(400).json({ error: "RESEND_API_KEY is not set in Vercel." }); return; }
    const from = process.env.OUTREACH_FROM || "Lavalle Haus <info@lavallehaus.com>";
    const subject = String(b.subject || "Lavalle Haus — Collaboration Details").slice(0, 200);
    const bodyText = String(b.body || "");
    const html = "<div style=\"font-family:Georgia,serif;font-size:15px;line-height:1.6;color:#2b2a28;white-space:pre-wrap\">" +
      bodyText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</div>";
    const attachments = [{ filename: "Lavalle Haus — Creator Brief.pdf", path: "https://lavalle-haus-os.vercel.app/lavalle-haus-ugc-brief.pdf" }];
    try {
      const id = await sendResendEmail({ apiKey, from, to, subject, html, attachments });
      res.json({ ok: true, id });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e).slice(0, 240) });
    }
    return;
  }
  if (op === "tiktok_revoke" && req.method === "POST") {
    // Disconnect: revoke the grant with TikTok and clear the stored token.
    if (!ownerRole(auth)) { res.status(403).json({ error: "Only the owner can disconnect TikTok." }); return; }
    const b = req.body || {};
    const sb = !b.production;
    const kvKey = sb ? "tiktok_oauth_sandbox" : "tiktok_oauth";
    const map = tiktokAccounts(await kvGet(kvKey));
    for (const t of Object.values(map)) {
      if (b.open_id && t.open_id !== b.open_id) continue; // no open_id = disconnect all
      await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: (sb ? process.env.TIKTOK_SANDBOX_KEY : process.env.TIKTOK_CLIENT_KEY) || "",
          client_secret: (sb ? process.env.TIKTOK_SANDBOX_SECRET : process.env.TIKTOK_CLIENT_SECRET) || "",
          token: t.access_token,
        }),
      }).catch(() => {});
      delete map[t.open_id];
    }
    await kvSet(kvKey, map);
    res.json({ ok: true });
    return;
  }
  if (op === "tiktok_test_post" && req.method === "POST") {
    // Sends a draft to the sandbox account's TikTok inbox via the Content
    // Posting API (video.upload scope) — used for the app-review demo.
    if (!ownerRole(auth)) { res.status(403).json({ error: "Only the owner can post to TikTok." }); return; }
    const b = req.body || {};
    const accts = Object.values(tiktokAccounts(await kvGet("tiktok_oauth_sandbox")));
    const tok = b.open_id ? accts.find((t) => t.open_id === b.open_id) : accts[0];
    if (!tok) { res.status(400).json({ error: "No sandbox token yet — run /api/tiktok-auth?sandbox=1 first." }); return; }
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
  if (op === "invite" || op === "reset" || op === "revoke" || op === "users" || op === "set_pages" || op === "set_role" || op === "set_password") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Only the owner can manage team access." }); return; }
    const users = (await kvGet("lavalle_users")) || [];

    if (req.method === "GET" && op === "users") {
      res.json({ users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, invitedAt: u.invitedAt || null, acceptedAt: u.acceptedAt || null, pages: u.pages || null, denySegs: u.denySegs || null, revoked: !!u.revoked, inviteExpired: !!(u.inviteToken && u.inviteExp && Date.now() > u.inviteExp) })) });
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

    // Password reset for an already-active member — re-issues a fresh
    // set-password link (their old password keeps working until they pick a
    // new one). No new account is created; acceptedAt stays.
    if (req.method === "POST" && op === "reset") {
      const u = users.find((x) => x.id === (req.body || {}).id);
      if (!u) { res.status(404).json({ error: "No such member." }); return; }
      if (u.revoked) { res.status(400).json({ error: "That member's access is revoked — re-invite them instead." }); return; }
      u.inviteToken = randomBytes(24).toString("hex");
      u.inviteExp = Date.now() + 14 * 86400000;
      await kvSet("lavalle_users", users);
      const host = req.headers["x-forwarded-host"] || req.headers.host || "";
      const link = "https://" + host + "/?invite=" + u.inviteToken;
      let sent = false, sendError = null;
      const apiKey = process.env.RESEND_API_KEY;
      if (apiKey && u.email) {
        const from = process.env.RESEND_FROM || "Lavalle Haus OS <onboarding@resend.dev>";
        const html =
          '<div style="font-family:Georgia,serif;color:#1a1714;max-width:560px">' +
            '<p style="font-size:11px;letter-spacing:2px;color:#a07848;text-transform:uppercase">Lavalle Haus OS</p>' +
            '<h2 style="font-weight:400;margin:6px 0">Reset your password, ' + (u.name || "").replace(/[&<>"]/g, "") + '.</h2>' +
            '<p style="line-height:1.6">Use the private link below to choose a new password for your Lavalle Haus OS login. It&rsquo;s yours alone and expires in 14 days. Your current password keeps working until you set a new one.</p>' +
            '<p style="margin:22px 0"><a href="' + link + '" style="background:#1a1714;color:#ffffff;text-decoration:none;padding:12px 26px;font-size:12px;letter-spacing:2px;text-transform:uppercase">Set a new password</a></p>' +
            '<p style="font-size:12px;color:#8c7d6b;line-height:1.5">If the button doesn&rsquo;t work, copy this link:<br/>' + link + '</p>' +
            '<hr style="border:none;border-top:1px solid #c8c2b8;margin:14px 0"/>' +
            '<p style="font-size:12px;color:#8c7d6b">If you didn&rsquo;t ask for this, you can ignore it &mdash; nothing changes until the link is used.</p>' +
          '</div>';
        try { await sendResendEmail({ apiKey, from, to: u.email, subject: "Reset your Lavalle Haus OS password", html }); sent = true; }
        catch (e) { sendError = String(e).slice(0, 200); }
      } else { sendError = u.email ? "RESEND_API_KEY not set" : "This member has no email on the roster."; }
      res.json({ ok: true, sent, sendError, link });
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
      // Sub-tab denials ("content:pr") — a page grant can still hide segments.
      if (b.denySegs !== undefined) {
        u.denySegs = Array.isArray(b.denySegs)
          ? b.denySegs.map((x) => String(x).toLowerCase().replace(/[^a-z0-9:_-]/g, "")).filter(Boolean).slice(0, 40)
          : null;
        if (u.denySegs && !u.denySegs.length) u.denySegs = null;
      }
      await kvSet("lavalle_users", users);
      res.json({ ok: true, pages: u.pages, denySegs: u.denySegs || null });
      return;
    }

    // Owner sets a member's password directly (no email round-trip): used when
    // Kiabeth hands someone their login herself. Clears any pending invite link.
    if (req.method === "POST" && op === "set_password") {
      const b = req.body || {};
      const u = users.find((x) => x.id === b.id);
      if (!u) { res.status(404).json({ error: "No such member." }); return; }
      const pw = String(b.password || "");
      if (pw.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters." }); return; }
      u.salt = randomBytes(16).toString("hex");
      u.hash = hashPassword(pw, u.salt);
      u.revoked = false; u.inviteToken = null; u.inviteExp = null;
      if (!u.acceptedAt) u.acceptedAt = new Date().toISOString();
      await kvSet("lavalle_users", users);
      res.json({ ok: true, email: u.email });
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
  // Find folders/files by name — the Drive tree is deep and hand-walking it
  // by parent id is hopeless for tasks like "the Loft folder for The Fold".
  if (op === "drive_search" && req.method === "POST") {
    const auth0b = await getAuthEarly(req);
    if (!ownerRole(auth0b)) { res.status(403).json({ error: "Owner only." }); return; }
    const name = String((req.body || {}).name || "").replace(/'/g, "");
    if (!name) { res.status(400).json({ error: "name required" }); return; }
    const gt = await googleToken();
    if (!gt) { res.status(400).json({ error: "google_not_connected" }); return; }
    const q = encodeURIComponent("name contains '" + name + "' and trashed = " + ((req.body || {}).trashed ? "true" : "false"));
    const fr = await (await fetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&fields=files(id,name,mimeType,parents,modifiedTime,trashed)&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true", { headers: { Authorization: "Bearer " + gt } })).json();
    res.json({ files: fr.files || [] });
    return;
  }
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
      const wantAll = !!(req.body || {}).all; // asset linking needs folders + videos too
      const files = (fd.files || [])
        .filter((f) => wantAll || (f.mimeType || "").startsWith("image/"))
        .map((f) => ({ id: f.id, name: f.name, folder: (f.mimeType || "") === "application/vnd.google-apps.folder", mime: f.mimeType || null }));
      res.json({ files });
    } catch (e) {
      res.status(500).json({ error: String(e).slice(0, 200) });
    }
    return;
  }

  // ── Sync covers from Drive (owner-only) ───────────────────────────────────
  // For each month-named column on a brand board, pull that month's subfolder
  // from the brand's "Cover Photos" root and set each "Post N" card's cover to
  // the matching numbered file (1–21). Re-runnable: drop a new cover in the
  // folder, hit sync, and it lands on the right card. Also refreshes the
  // Schedule grid feed for that account.
  if (op === "sync_covers" && req.method === "POST") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Owner only." }); return; }
    const boardKey = String((req.body || {}).boardKey || "");
    const data = await kvGet("lavalle_data");
    const blob = Array.isArray(data) ? data[0] : data;
    const board = blob && blob.boards && blob.boards[boardKey];
    if (!board) { res.status(404).json({ error: "No such board." }); return; }
    const root = board.coverPhotosFolder || COVER_ROOTS[boardKey];
    if (!root) { res.status(400).json({ error: "No Cover Photos folder is set for this board yet." }); return; }
    const token = await googleToken();
    if (!token) { res.status(400).json({ error: "google_not_connected" }); return; }
    try {
      const monthLists = (board.lists || []).filter((l) => MONTH_RX.test(String(l.name || "").trim()));
      if (!monthLists.length) { res.status(400).json({ error: "This board has no month-named columns to sync." }); return; }
      const rootChildren = await driveListFolder(root, token);
      const report = [];
      for (const list of monthLists) {
        const mname = String(list.name).trim().toLowerCase();
        const sub = rootChildren.find((f) => f.folder && f.name.trim().toLowerCase() === mname);
        if (!sub) { report.push({ month: list.name, status: "no folder in Drive" }); continue; }
        const files = await driveListFolder(sub.id, token);
        const byN = {};
        files.filter((f) => !f.folder).forEach((f) => { const mm = /^(\d+)\b/.exec(f.name); if (mm) byN[+mm[1]] = f.id; });
        const cards = (board.cards || []).filter((c) => c.listId === list.id);
        let covered = 0;
        for (const c of cards) {
          const mm = /post\s*(\d+)/i.exec(c.name || "");
          if (!mm) continue;
          const n = +mm[1];
          if (byN[n]) {
            c.cover = "/api/data?op=drive_img&id=" + byN[n];
            // Also set the "Open cover photo in Drive" button's target so assets
            // are one tap away (alongside the reel/carousel button from Link assets).
            c.coverUrl = "https://drive.google.com/file/d/" + byN[n] + "/view";
            covered++;
          }
        }
        report.push({ month: list.name, files: Object.keys(byN).length, covered });
      }
      await kvSet("lavalle_data", Array.isArray(data) ? [blob] : blob);
      res.json({ report });
    } catch (e) {
      res.status(500).json({ error: String(e).slice(0, 200) });
    }
    return;
  }

  // ── Drive write ops (owner-only) — build the numbered cover folders without
  // 40 manual copy/rename clicks. drive.readonly reads the source, drive.file
  // owns the copies + the new folder, so files.copy / files.create both work.
  if (op === "drive_meta" || op === "drive_shortcut" || op === "drive_move" || op === "drive_mkdir" || op === "drive_copy" || op === "drive_upload_url" || op === "drive_trash" || op === "drive_rename" || op === "drive_upload_session" || op === "drive_revisions") {
    if (!ownerRole(auth)) { res.status(403).json({ error: "Owner only." }); return; }
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
      const AUTH = { Authorization: "Bearer " + td.access_token };
      const b = req.body || {};
      if (op === "drive_meta") {
        const id = (b.id || "").replace(/[^a-zA-Z0-9_-]/g, "");
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,parents,mimeType,thumbnailLink&supportsAllDrives=true`, { headers: AUTH });
        const d = await r.json();
        if (!r.ok) { res.status(400).json({ error: (d.error && d.error.message) || "drive_error" }); return; }
        res.json(d); return;
      }
      if (op === "drive_shortcut") {
        const target = (b.targetId || "").replace(/[^a-zA-Z0-9_-]/g, "");
        const parent = (b.parentId || "").replace(/[^a-zA-Z0-9_-]/g, "");
        const nameSc = String(b.name || "").slice(0, 120);
        if (!target || !parent) { res.status(400).json({ error: "targetId and parentId required." }); return; }
        const rC = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,mimeType", {
          method: "POST", headers: { ...AUTH, "Content-Type": "application/json" },
          body: JSON.stringify({ name: nameSc || undefined, mimeType: "application/vnd.google-apps.shortcut", parents: [parent], shortcutDetails: { targetId: target } }),
        });
        const dC = await rC.json();
        if (!rC.ok) { res.status(400).json({ error: (dC.error && dC.error.message) || "drive_error" }); return; }
        res.json(dC); return;
      }
      if (op === "drive_move") {
        const idM = (b.id || "").replace(/[^a-zA-Z0-9_-]/g, "");
        const toM = (b.parentId || "").replace(/[^a-zA-Z0-9_-]/g, "");
        if (!idM || !toM) { res.status(400).json({ error: "id and parentId required." }); return; }
        const mM = await (await fetch(`https://www.googleapis.com/drive/v3/files/${idM}?fields=parents&supportsAllDrives=true`, { headers: AUTH })).json();
        const fromM = (mM.parents || []).join(",");
        const rM = await fetch(`https://www.googleapis.com/drive/v3/files/${idM}?addParents=${toM}${fromM ? "&removeParents=" + fromM : ""}&supportsAllDrives=true&fields=id,name,parents`, { method: "PATCH", headers: { ...AUTH, "Content-Type": "application/json" }, body: "{}" });
        const dM = await rM.json();
        if (!rM.ok) { res.status(400).json({ error: (dM.error && dM.error.message) || "drive_error" }); return; }
        res.json(dM); return;
      }
      if (op === "drive_revisions") {
        // List a Drive file's revisions, or fetch one as base64 — built Aug 26
        // to recover Monday-evening Strategy Outline builds (Drive keeps binary
        // revisions ~30 days; the outline prints every post's caption).
        const id = (b.id || "").replace(/[^a-zA-Z0-9_-]/g, "");
        if (!id) { res.status(400).json({ error: "id required" }); return; }
        if (b.rev) {
          const rev = String(b.rev).replace(/[^a-zA-Z0-9_-]/g, "");
          const rR = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/revisions/${rev}?alt=media`, { headers: AUTH });
          if (!rR.ok) { res.status(400).json({ error: "revision fetch failed: " + rR.status }); return; }
          const buf = Buffer.from(await rR.arrayBuffer());
          res.json({ ok: true, b64: buf.toString("base64"), bytes: buf.length });
          return;
        }
        const rL = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/revisions?fields=revisions(id,modifiedTime,originalFilename,size)&pageSize=100`, { headers: AUTH });
        const dL = await rL.json();
        if (!rL.ok) { res.status(400).json({ error: (dL.error && dL.error.message) || "drive_error" }); return; }
        res.json(dL); return;
      }
      if (op === "drive_mkdir") {
        const name = String(b.name || "").slice(0, 120);
        const parent = (b.parentId || "").replace(/[^a-zA-Z0-9_-]/g, "");
        const r = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,parents", {
          method: "POST", headers: { ...AUTH, "Content-Type": "application/json" },
          body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parent ? [parent] : undefined }),
        });
        const d = await r.json();
        if (!r.ok) { res.status(400).json({ error: (d.error && d.error.message) || "drive_error", detail: d.error }); return; }
        res.json(d); return;
      }
      if (op === "drive_rename") {
        // Rename and/or move a file. Move (addParents/removeParents) lets us pull
        // the numbered grid images into a clean folder as 1-9 without colliding
        // with the source archive's own 1-N.
        const id = (b.id || "").replace(/[^a-zA-Z0-9_-]/g, "");
        const qs = [];
        if (b.parentAdd) qs.push("addParents=" + (b.parentAdd || "").replace(/[^a-zA-Z0-9_-]/g, ""));
        if (b.parentRemove) qs.push("removeParents=" + (b.parentRemove || "").replace(/[^a-zA-Z0-9_-]/g, ""));
        qs.push("supportsAllDrives=true", "fields=id,name,parents");
        const body = {};
        if (b.name != null) body.name = String(b.name).slice(0, 120);
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?${qs.join("&")}`, {
          method: "PATCH", headers: { ...AUTH, "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) { res.status(400).json({ error: (d.error && d.error.message) || "drive_error", detail: d.error }); return; }
        res.json(d); return;
      }
      if (op === "drive_trash") {
        const id = (b.id || "").replace(/[^a-zA-Z0-9_-]/g, "");
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true&fields=id,name,trashed`, {
          method: "PATCH", headers: { ...AUTH, "Content-Type": "application/json" },
          body: JSON.stringify({ trashed: true }),
        });
        const d = await r.json();
        if (!r.ok) { res.status(400).json({ error: (d.error && d.error.message) || "drive_error", detail: d.error }); return; }
        res.json(d); return;
      }
      if (op === "drive_copy") {
        const src = (b.sourceId || "").replace(/[^a-zA-Z0-9_-]/g, "");
        const parent = (b.parentId || "").replace(/[^a-zA-Z0-9_-]/g, "");
        const name = String(b.name || "").slice(0, 120);
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${src}/copy?supportsAllDrives=true&fields=id,name,parents`, {
          method: "POST", headers: { ...AUTH, "Content-Type": "application/json" },
          body: JSON.stringify({ name, parents: parent ? [parent] : undefined }),
        });
        const d = await r.json();
        if (!r.ok) { res.status(400).json({ error: (d.error && d.error.message) || "drive_error", detail: d.error }); return; }
        res.json(d); return;
      }
      if (op === "drive_upload_session") {
        // Mint a Google resumable-upload session: the returned session URI
        // accepts the file bytes WITHOUT auth, so large local files (Playbook
        // reels) can be PUT straight from the laptop into Drive.
        const nameS = String(b.name || "upload.bin").slice(0, 120);
        const parentS = (b.parentId || "").replace(/[^a-zA-Z0-9_-]/g, "");
        const rS = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true", {
          method: "POST", headers: { ...AUTH, "Content-Type": "application/json", "X-Upload-Content-Type": b.mime || "video/mp4" },
          body: JSON.stringify({ name: nameS, parents: parentS ? [parentS] : undefined }),
        });
        if (!rS.ok) { res.status(400).json({ error: "session " + rS.status, detail: (await rS.text()).slice(0, 200) }); return; }
        res.json({ ok: true, sessionUrl: rS.headers.get("location") });
        return;
      }
      if (op === "drive_upload_url") {
        // Fetch an image by URL (e.g. a live IG grid image — an already-edited,
        // logo-overlaid crop) and store a durable copy in Drive, numbered by grid
        // position. Lets us persist covers that only exist as posted edits.
        const url = String(b.url || "");
        const parent = (b.parentId || "").replace(/[^a-zA-Z0-9_-]/g, "");
        const name = String(b.name || "cover.jpg").slice(0, 120);
        if (!/^https?:\/\//.test(url)) { res.status(400).json({ error: "bad url" }); return; }
        const ir = await fetch(url);
        if (!ir.ok) { res.status(400).json({ error: "fetch_image_failed " + ir.status }); return; }
        const ct = ir.headers.get("content-type") || "image/jpeg";
        const buf = Buffer.from(await ir.arrayBuffer());
        const boundary = "lhb" + buf.length.toString(36);
        const meta = JSON.stringify({ name, parents: parent ? [parent] : undefined });
        const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${ct}\r\n\r\n`;
        const body = Buffer.concat([Buffer.from(pre, "utf8"), buf, Buffer.from(`\r\n--${boundary}--`, "utf8")]);
        const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name", {
          method: "POST", headers: { ...AUTH, "Content-Type": `multipart/related; boundary=${boundary}` }, body,
        });
        const d = await r.json();
        if (!r.ok) { res.status(400).json({ error: (d.error && d.error.message) || "upload_error", detail: d.error }); return; }
        res.json(d); return;
      }
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

  // Role-aware data boundary. Hiding tabs client-side is presentation; THIS is
  // the lock: a non-owner session never receives the financial keys (and a
  // Manager never receives bank/cash), never receives boards their access list
  // excludes, and their saves can never overwrite what they never received.
  const FIN_KEYS = ["pnl", "bankCash", "margins", "cogs", "profitMatrix", "wholesale", "googleAds", "metaAds", "b2bAds", "emailRetention", "weekly", "competitors", "retail"];
  const protectedKeysFor = (a) => (ownerRole(a) ? [] : /^manager/i.test(a.role || "") ? ["bankCash"] : FIN_KEYS.slice());
  const segDenied = (a, seg) => Array.isArray(a && a.denySegs) && a.denySegs.includes(seg);
  const canSeeBoard = (a, bd) => { if (ownerRole(a)) return true; const acc = bd && bd.access; if (!acc || !acc.length) return true; return acc.some((n) => n === a.name || (a.email && String(n).toLowerCase() === a.email.toLowerCase())); };
  const scopeBlob = (a, blob) => {
    if (!blob || ownerRole(a)) return blob;
    const out = { ...blob };
    for (const k of protectedKeysFor(a)) delete out[k];
    if (segDenied(a, "content:pr")) delete out.prHub;
    if (segDenied(a, "content:comms")) delete out.comms;
    if (segDenied(a, "content:meetings")) delete out.teamMeetings;
    if (out.boards) { const bs = {}; for (const [k, bd] of Object.entries(out.boards)) { if (k.startsWith("_") || canSeeBoard(a, bd)) bs[k] = bd; } out.boards = bs; }
    return out;
  };
  if (req.method === "GET") {
    const r = await fetch(`${url}/get/lavalle_data`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const d = await r.json();
    let data = d.result ? JSON.parse(d.result) : null;
    // Fix: if data is an array (old bug), unwrap it
    if (Array.isArray(data)) data = data[0];
    res.json(scopeBlob(auth, data) || { products: [], materials: [], weekly: [] });
  } else if (req.method === "POST") {
    // GUARDRAIL. This branch replaces the ENTIRE dataset, and it used to catch
    // any POST that fell through — so a request to an op that didn't exist yet
    // (a typo, or a deploy that hadn't landed) overwrote all 14 boards with its
    // own little JSON body. That happened for real. Two locks now:
    //   1. an unrecognised ?op= never reaches the writer
    //   2. the body must actually look like the full app state
    const body = req.body;
    if (op) {
      res.status(400).json({ error: `Unknown op "${op}" — refusing to treat this as a full-state save.` });
      return;
    }
    const looksLikeState = body && typeof body === "object" && !Array.isArray(body)
      && (body.boards || body.products || body.gridPlanner);
    if (!looksLikeState) {
      res.status(400).json({ error: "Refusing to save: body doesn't look like the app state (no boards/products/gridPlanner)." });
      return;
    }
    // Non-owner saves are MERGED over the stored state: protected keys and
    // boards outside the sender's access keep their stored values, so a member
    // client that never received them can't blank them out on save.
    //
    // Per-board staleness guard (Aug 26 2026 incident: a weeks-stale member tab
    // saved and its July copy of lavalle-sisters replaced the live board —
    // board-by-board replace has no age check). Every stored board carries
    // _rev; a save whose copy of a board is older than the stored one keeps
    // the STORED board and reports it in staleBoards instead of reverting it.
    // Staleness is judged by AGE, not by exact revision (her Aug 26 report:
    // exact-rev matching blocked a tab's second same-day save whenever any
    // other writer had touched the board). A copy under a day behind saves
    // normally (last edit wins, the app's long-standing behavior); a copy more
    // than STALE_MS behind the board's last change is refused — that is the
    // weeks-old-tab disaster this guard exists for. A stamp-less copy of a
    // stamped board is undatable and also refused (reload once to stamp it).
    const STALE_MS = 24 * 3600 * 1000;
    const mergeBoard = (bs, bk, bd, storedBoards, staleBoards) => {
      const sb = (storedBoards || {})[bk];
      const sRev = (sb && sb._rev) || 0;
      const sStamp = (sb && sb._stamp) || 0, iStamp = (bd && bd._stamp) || 0;
      if (sb && sStamp && (!iStamp || sStamp - iStamp > STALE_MS)) { staleBoards.push(bk); return; }
      const norm = (x) => JSON.stringify({ ...x, _rev: 0, _stamp: 0 });
      const changed = !sb || !sb._rev || !sb._stamp || norm(bd) !== norm(sb);
      bs[bk] = changed ? { ...bd, _rev: sRev + 1, _stamp: Date.now() } : sb;
    };
    const staleBoards = [], staleKeys = [];
    let toStore = body;
    let keyStamps = {};
    {
      const r0 = await fetch(`${url}/get/lavalle_data`, { headers: { Authorization: `Bearer ${token}` } });
      const d0 = await r0.json();
      let stored = d0.result ? JSON.parse(d0.result) : null;
      if (Array.isArray(stored)) stored = stored[0];
      // Every OTHER top-level key (team roster, PR hub, grid planner…) gets the
      // same age guard as boards (the Aug 26 roster wipe: only boards were
      // protected, so a stale save could still rewind everything else). Values
      // aren't all objects, so stamps live in a _keyStamps side table that
      // clients echo back and adopt from the save response.
      keyStamps = { ...((stored && stored._keyStamps) || {}) };
      const iStamps = (body && body._keyStamps) || {};
      const nowKS = Date.now();
      const guardKey = (stored0, k, v) => {
        if (!stored0 || !(k in stored0)) { keyStamps[k] = nowKS; return v; }
        const sv = stored0[k];
        if (JSON.stringify(v) === JSON.stringify(sv)) { if (!keyStamps[k]) keyStamps[k] = nowKS; return sv; } // bootstrap-stamp untouched keys
        const sStamp = keyStamps[k] || 0, iStamp = iStamps[k] || 0;
        if (sStamp && (!iStamp || sStamp - iStamp > STALE_MS)) { staleKeys.push(k); return sv; }
        keyStamps[k] = nowKS; return v;
      };
      if (stored && !ownerRole(auth)) {
        toStore = { ...stored };
        const prot = new Set([...protectedKeysFor(auth), ...(segDenied(auth, "content:pr") ? ["prHub"] : []), ...(segDenied(auth, "content:comms") ? ["comms"] : []), ...(segDenied(auth, "content:meetings") ? ["teamMeetings"] : [])]);
        for (const [k, v] of Object.entries(body)) {
          if (prot.has(k) || k === "_keyStamps") continue;
          if (k === "boards" && v && typeof v === "object") {
            const bs = { ...(stored.boards || {}) };
            for (const [bk, bd] of Object.entries(v)) { if (bk.startsWith("_") || canSeeBoard(auth, (stored.boards || {})[bk] || bd)) mergeBoard(bs, bk, bd, stored.boards, staleBoards); }
            toStore.boards = bs;
          } else toStore[k] = guardKey(stored, k, v);
        }
        toStore._keyStamps = keyStamps;
      } else if (stored) {
        // owner: keys absent from the client's copy keep their stored values
        // (the app never deletes top-level keys on purpose), boards + keys get
        // the same age guard
        toStore = { ...stored };
        for (const [k, v] of Object.entries(body)) {
          if (k === "_keyStamps") continue;
          if (k === "boards") continue;
          toStore[k] = guardKey(stored, k, v);
        }
        const bs = { ...(stored.boards || {}) };
        // Boards can't be deleted by omission (the guard keeps stored boards a
        // save doesn't mention) — an owner deletes one EXPLICITLY with a
        // {_deleted:true} tombstone in its place.
        for (const [bk, bd] of Object.entries(body.boards || {})) { if (bd && bd._deleted === true) { delete bs[bk]; continue; } mergeBoard(bs, bk, bd, stored.boards, staleBoards); }
        toStore.boards = bs;
        toStore._keyStamps = keyStamps;
      }
    }
    const rs = await fetch(`${url}/set/lavalle_data`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(toStore)
    });
    let ds = null; try { ds = await rs.json(); } catch {}
    if (!rs.ok || (ds && ds.error)) { res.status(507).json({ error: "Store refused the save: " + (ds && ds.error ? ds.error : rs.status) }); return; }
    // Hand every stored board's rev back so the SAVING tab can adopt them —
    // without this a tab's own successful save left it one rev behind and its
    // very next save read as stale (her Approved-tag report, Aug 26).
    const revs = {}, stamps = {};
    for (const [bk, bd] of Object.entries(toStore.boards || {})) { if (bd && bd._rev) revs[bk] = bd._rev; if (bd && bd._stamp) stamps[bk] = bd._stamp; }
    res.json({ ok: true, staleBoards, staleKeys, revs, stamps, keyStamps });
  }
}
