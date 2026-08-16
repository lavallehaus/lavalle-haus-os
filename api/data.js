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
  await fetch(`${KV_URL}/set/${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(value),
  });
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
    res.json({ name: auth.name, role: auth.role, email: auth.email, pages: auth.pages || null, denySegs: auth.denySegs || null });
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
  if (op === "invite" || op === "reset" || op === "revoke" || op === "users" || op === "set_pages" || op === "set_role") {
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
      const wantAll = !!(req.body || {}).all; // asset linking needs folders + videos too
      const files = (fd.files || [])
        .filter((f) => wantAll || (f.mimeType || "").startsWith("image/"))
        .map((f) => ({ id: f.id, name: f.name, folder: (f.mimeType || "") === "application/vnd.google-apps.folder" }));
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
  if (op === "drive_meta" || op === "drive_mkdir" || op === "drive_copy" || op === "drive_upload_url" || op === "drive_trash" || op === "drive_rename") {
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
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,parents,mimeType&supportsAllDrives=true`, { headers: AUTH });
        const d = await r.json();
        if (!r.ok) { res.status(400).json({ error: (d.error && d.error.message) || "drive_error" }); return; }
        res.json(d); return;
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
    await fetch(`${url}/set/lavalle_data`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    res.json({ ok: true });
  }
}
