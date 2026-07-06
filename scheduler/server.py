#!/usr/bin/env python3
"""
Content Scheduler — self-contained local scheduling module.
Zero dependencies: runs on the Python 3 that ships with macOS.
Supports multiple BUSINESSES (workspaces): each business has its own posts,
media library, and platform connections. Pick a business on the login screen;
API calls carry ?biz=<id>.
Run:  python3 server.py   (or double-click start.command)
Then open http://localhost:8787
Claude-friendly API (no upload buttons needed) — see CLAUDE-API.md:
  POST /api/media/import?biz=<id>      {"path": "/absolute/path/file.mp4"}
  POST /api/media/import-url?biz=<id>  {"url": "https://...", "filename": "clip.mp4"}
  Or drop files into incoming/<Business Name>/ — auto-ingested.
"""
import json
import os
import re
import shutil
import sys
import threading
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from email.parser import BytesParser
from email.policy import default as email_default_policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(ROOT, "public")
MEDIA_DIR = os.path.join(ROOT, "media")
INCOMING_DIR = os.path.join(ROOT, "incoming")
DATA_DIR = os.path.join(ROOT, "data")
THUMBS_DIR = os.path.join(DATA_DIR, "thumbs")
DB_PATH = os.path.join(DATA_DIR, "db.json")
PORT = int(os.environ.get("PORT") or os.environ.get("SCHEDULER_PORT") or "8787")
for d in (PUBLIC_DIR, MEDIA_DIR, INCOMING_DIR, DATA_DIR, THUMBS_DIR):
    os.makedirs(d, exist_ok=True)
# ---------------------------------------------------------------- storage
_db_lock = threading.RLock()
def default_platform_settings():
    return {
        "instagram": {"connected": False, "access_token": "", "ig_user_id": "", "public_base_url": ""},
        "tiktok": {"connected": False, "access_token": "", "public_base_url": ""},
        "threads": {"connected": False, "access_token": "", "threads_user_id": "", "public_base_url": ""},
        "pinterest": {"connected": False, "access_token": "", "board_id": ""},
        "youtube": {"connected": False, "client_id": "", "client_secret": "", "refresh_token": ""},
        "facebook": {"connected": False, "access_token": "", "page_id": "", "public_base_url": ""},
    }
def new_business(name):
    return {
        "id": uuid.uuid4().hex[:8],
        "name": name,
        "posts": [],
        "media": [],
        "settings": {"platforms": default_platform_settings()},
    }
def load_db():
    with _db_lock:
        if not os.path.exists(DB_PATH):
            db = {"businesses": {}}
            for name in ("Business One", "Business Two"):
                b = new_business(name)
                db["businesses"][b["id"]] = b

            save_db(db)
            return db
        with open(DB_PATH, "r") as f:
            db = json.load(f)
        # migrate single-business layout to multi-business
        if "businesses" not in db:
            b = new_business("Business One")
            b["posts"] = db.get("posts", [])
            b["media"] = db.get("media", [])
            if db.get("settings", {}).get("platforms"):
                for k, v in db["settings"]["platforms"].items():
                    b["settings"]["platforms"].setdefault(k, {}).update(
                        {kk: vv for kk, vv in v.items() if kk != "label"})
            b2 = new_business("Business Two")
            db = {"businesses": {b["id"]: b, b2["id"]: b2}}
            save_db(db)
        # ensure every business has every platform section
        for b in db["businesses"].values():
            plats = b.setdefault("settings", {}).setdefault("platforms", {})
            for k, v in default_platform_settings().items():
                plats.setdefault(k, v)
        return db
def save_db(db):
    with _db_lock:
        tmp = DB_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(db, f, indent=2)
        os.replace(tmp, DB_PATH)
def get_biz(db, biz_id):
    if biz_id and biz_id in db["businesses"]:
        return db["businesses"][biz_id]
    # fall back to first business
    return next(iter(db["businesses"].values()))
def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")
# ---------------------------------------------------------------- media
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic"}
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm", ".avi"}
AUDIO_EXT = {".mp3", ".m4a", ".wav", ".aac", ".ogg"}
def media_type_for(filename):
    ext = os.path.splitext(filename.lower())[1]
    if ext in IMAGE_EXT:
        return "image"
    if ext in VIDEO_EXT:
        return "video"
    if ext in AUDIO_EXT:
        return "audio"
    return "other"
def safe_filename(name):
    name = os.path.basename(name)
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip() or "file"
    return name
def _media_record(stored, fname, size, nickname):
    return {
        "id": stored.split("__")[0],
        "filename": fname,
        "stored": stored,
        "type": media_type_for(fname),
        "size": size,
        "nickname": nickname or "",
        "addedAt": now_iso(),
    }
def _spawn_thumb(rec):
    """Generate a small poster jpeg in the background (library grid stays fast on 4K files)."""
    if rec["type"] not in ("image", "video"):
        return
    import editing as _ed
    if not _ed.available():
        return
    src = os.path.join(MEDIA_DIR, rec["stored"])

    out = os.path.join(THUMBS_DIR, rec["id"] + ".jpg")
    def work():
        try:
            _ed.make_thumb(src, out, rec["type"] == "video")
        except Exception as e:
            print(f"[thumbs] {rec['stored']}: {e}")
    threading.Thread(target=work, daemon=True).start()
def _register(biz_id, rec):
    db = load_db()
    get_biz(db, biz_id)["media"].insert(0, rec)
    save_db(db)
    _spawn_thumb(rec)
    return rec
def register_media_file(biz_id, src_path, original_name=None, nickname=""):
    original_name = original_name or os.path.basename(src_path)
    fname = safe_filename(original_name)
    stored = f"{uuid.uuid4().hex[:10]}__{fname}"
    shutil.copy2(src_path, os.path.join(MEDIA_DIR, stored))
    rec = _media_record(stored, fname, os.path.getsize(os.path.join(MEDIA_DIR, stored)), nickname)
    return _register(biz_id, rec)
def register_media_bytes(biz_id, data, original_name, nickname=""):
    fname = safe_filename(original_name)
    stored = f"{uuid.uuid4().hex[:10]}__{fname}"
    with open(os.path.join(MEDIA_DIR, stored), "wb") as f:
        f.write(data)
    rec = _media_record(stored, fname, len(data), nickname)
    return _register(biz_id, rec)
def register_media_stream(biz_id, reader, length, original_name, nickname=""):
    """Stream a large upload (e.g. a 4K video) straight to disk in 1 MB chunks."""
    fname = safe_filename(original_name)
    stored = f"{uuid.uuid4().hex[:10]}__{fname}"
    dest = os.path.join(MEDIA_DIR, stored)
    remaining = length
    with open(dest, "wb") as f:
        while remaining > 0:
            chunk = reader.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            f.write(chunk)
            remaining -= len(chunk)
    rec = _media_record(stored, fname, os.path.getsize(dest), nickname)
    return _register(biz_id, rec)
def backfill_thumbs():
    """Generate thumbnails for media that predates the thumbnail feature."""
    try:
        db = load_db()
        for b in db["businesses"].values():
            for rec in b["media"]:
                if rec["type"] in ("image", "video") and \
                        not os.path.exists(os.path.join(THUMBS_DIR, rec["id"] + ".jpg")):
                    _spawn_thumb(rec)
                    time.sleep(0.5)  # don't hammer the CPU at startup
    except Exception as e:
        print(f"[thumbs] backfill error: {e}")
# ---------------------------------------------------------------- incoming folder watcher
def watch_incoming():
    """Auto-ingest files from incoming/ (default business) and
    incoming/<Business Name>/ (that business). Used by Claude."""
    seen_sizes = {}
    while True:
        try:
            db = load_db()
            by_name = {b["name"].lower(): b["id"] for b in db["businesses"].values()}
            default_id = next(iter(db["businesses"]))
            # keep a subfolder per business so drops are unambiguous
            for b in db["businesses"].values():
                os.makedirs(os.path.join(INCOMING_DIR, b["name"]), exist_ok=True)
            candidates = []  # (key, path, name, biz_id)
            for entry in os.listdir(INCOMING_DIR):
                full = os.path.join(INCOMING_DIR, entry)
                if entry.startswith("."):

                    continue
                if os.path.isfile(full):
                    candidates.append((entry, full, entry, default_id))
                elif os.path.isdir(full):
                    biz_id = by_name.get(entry.lower(), default_id)
                    for name in os.listdir(full):
                        if name.startswith("."):
                            continue
                        p = os.path.join(full, name)
                        if os.path.isfile(p):
                            candidates.append((f"{entry}/{name}", p, name, biz_id))
            for key, path, name, biz_id in candidates:
                size = os.path.getsize(path)
                if seen_sizes.get(key) == size:  # finished copying
                    rec = register_media_file(biz_id, path, name)
                    os.remove(path)
                    seen_sizes.pop(key, None)
                    print(f"[incoming] {key} -> media {rec['id']} (biz {biz_id})")
                else:
                    seen_sizes[key] = size
        except Exception as e:
            print(f"[incoming] error: {e}")
        time.sleep(2)
# ---------------------------------------------------------------- editing jobs
import editing  # noqa: E402
JOBS = {}  # id -> {status: running|done|failed, mediaIds: [], error: str}
_jobs_lock = threading.Lock()
def start_edit_job(biz_id, work, nickname_base):
    """Run `work()` (returns list of output file paths) in a thread; register outputs as new media."""
    job_id = uuid.uuid4().hex[:10]
    with _jobs_lock:
        JOBS[job_id] = {"status": "running", "mediaIds": [], "error": None}
    def runner():
        try:
            outs = work()
            ids = []
            for i, path in enumerate(outs):
                suffix = f" part {i + 1}" if len(outs) > 1 else ""
                name = os.path.basename(path)
                rec = register_media_file(biz_id, path, name, (nickname_base or "edited") + suffix)
                ids.append(rec["id"])
                try:
                    os.remove(path)
                except OSError:
                    pass
            with _jobs_lock:
                JOBS[job_id].update({"status": "done", "mediaIds": ids})
        except Exception as e:
            with _jobs_lock:
                JOBS[job_id].update({"status": "failed", "error": str(e)})
            print(f"[edit] job {job_id} failed: {e}")
    threading.Thread(target=runner, daemon=True).start()
    return job_id
# ---------------------------------------------------------------- publishing
from platforms import publish_to_platform  # noqa: E402
def scheduler_loop():
    while True:
        try:
            db = load_db()
            due = []
            now = datetime.now().astimezone()
            changed = False
            for biz_id, b in db["businesses"].items():
                for post in b["posts"]:
                    if post.get("status") != "scheduled" or not post.get("scheduledAt"):
                        continue
                    try:
                        when = datetime.fromisoformat(post["scheduledAt"])
                        if when.tzinfo is None:
                            when = when.astimezone()
                    except ValueError:
                        continue
                    if when <= now:

                        post["status"] = "publishing"
                        due.append((biz_id, post["id"]))
                        changed = True
            if changed:
                save_db(db)
                for biz_id, post_id in due:
                    publish_post(biz_id, post_id)
        except Exception as e:
            print(f"[scheduler] error: {e}")
        time.sleep(20)
def publish_post(biz_id, post_id):
    db = load_db()
    biz = get_biz(db, biz_id)
    post = next((p for p in biz["posts"] if p["id"] == post_id), None)
    if not post:
        return
    settings = biz["settings"]["platforms"]
    media = {m["id"]: m for m in biz["media"]}
    results = post.setdefault("results", {})
    any_fail = False
    for platform, cfg in (post.get("platforms") or {}).items():
        if not cfg.get("enabled"):
            continue
        if results.get(platform, {}).get("status") == "published":
            continue  # don't double-post on retry
        try:
            res = publish_to_platform(platform, post, cfg, settings.get(platform, {}), media, MEDIA_DIR)
            results[platform] = res
            if res.get("status") != "published":
                any_fail = True
        except Exception as e:
            results[platform] = {"status": "failed", "error": str(e)}
            any_fail = True
    post["status"] = "needs_attention" if any_fail else "published"
    post["publishedAt"] = now_iso()
    save_db(db)
    print(f"[publish] {biz['name']} / {post.get('nickname') or post_id}: {post['status']}")
# ---------------------------------------------------------------- HTTP handler
MIME = {
    ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
    ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".svg": "image/svg+xml", ".mp4": "video/mp4", ".mov": "video/quicktime",
    ".webm": "video/webm", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
    ".wav": "audio/wav", ".ico": "image/x-icon", ".woff2": "font/woff2",
}
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    # ------------- helpers
    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""
    def read_json(self):
        try:
            return json.loads(self.read_body() or b"{}")
        except json.JSONDecodeError:
            return {}
    @property
    def biz_id(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        return (q.get("biz") or [None])[0]
    def log_message(self, fmt, *args):
        pass
    # ------------- routing
    def do_OPTIONS(self):
        self.send_response(204)

        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/businesses":
            db = load_db()
            return self.send_json([{"id": b["id"], "name": b["name"],
                                    "posts": len(b["posts"]), "media": len(b["media"])}
                                   for b in db["businesses"].values()])
        if path == "/api/posts":
            return self.send_json(get_biz(load_db(), self.biz_id)["posts"])
        if path == "/api/media":
            return self.send_json(get_biz(load_db(), self.biz_id)["media"])
        if path == "/api/settings":
            return self.send_json(get_biz(load_db(), self.biz_id)["settings"])
        m = re.match(r"^/api/jobs/([\w-]+)$", path)
        if m:
            with _jobs_lock:
                job = JOBS.get(m.group(1))
            if not job:
                return self.send_json({"error": "job not found"}, 404)
            return self.send_json(job)
        if path == "/api/report":
            biz = get_biz(load_db(), self.biz_id)
            posts = biz["posts"]
            by_status = {}
            by_platform = {}
            for p in posts:
                by_status[p.get("status", "draft")] = by_status.get(p.get("status", "draft"), 0) + 1
                for plat, cfg in (p.get("platforms") or {}).items():
                    if not cfg.get("enabled"):
                        continue
                    s = by_platform.setdefault(plat, {"queued": 0, "published": 0, "failed": 0, "simulated": 0})
                    res = (p.get("results") or {}).get(plat)
                    if res is None:
                        s["queued"] += 1
                    elif res.get("status") == "published":
                        s["published"] += 1
                        if res.get("simulated"):
                            s["simulated"] += 1
                    else:
                        s["failed"] += 1
            upcoming = sorted(
                [p for p in posts if p.get("status") == "scheduled" and p.get("scheduledAt")],
                key=lambda p: p["scheduledAt"])[:20]
            recent = sorted(
                [p for p in posts if p.get("publishedAt")],
                key=lambda p: p["publishedAt"], reverse=True)[:20]
            slim = lambda p: {  # noqa: E731
                "id": p["id"], "nickname": p.get("nickname", ""),
                "scheduledAt": p.get("scheduledAt"), "publishedAt": p.get("publishedAt"),
                "status": p.get("status"),
                "platforms": [k for k, c in (p.get("platforms") or {}).items() if c.get("enabled")],
                "results": p.get("results", {}),
            }
            return self.send_json({
                "generatedAt": now_iso(),
                "business": {"id": biz["id"], "name": biz["name"]},
                "totals": {"posts": len(posts), "media": len(biz["media"]), **by_status},
                "byPlatform": by_platform,
                "upcoming": [slim(p) for p in upcoming],
                "recentlyPublished": [slim(p) for p in recent],
            })
        if path == "/api/status":
            db = load_db()
            return self.send_json({
                "ok": True, "time": now_iso(),
                "editing": editing.available(),
                "businesses": {b["name"]: {"posts": len(b["posts"]), "media": len(b["media"])}
                               for b in db["businesses"].values()},
            })
        if path.startswith("/media/"):
            return self.serve_file(MEDIA_DIR, urllib.parse.unquote(path[len("/media/"):]))
        if path.startswith("/thumbs/"):
            return self.serve_file(THUMBS_DIR, urllib.parse.unquote(path[len("/thumbs/"):]))
        rel = "index.html" if path in ("/", "/embed") else path.lstrip("/")
        return self.serve_file(PUBLIC_DIR, urllib.parse.unquote(rel))
    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/api/businesses":
            body = self.read_json()
            name = (body.get("name") or "").strip() or "New Business"

            db = load_db()
            b = new_business(name)
            db["businesses"][b["id"]] = b
            save_db(db)
            return self.send_json({"id": b["id"], "name": b["name"]}, 201)
        if path == "/api/media":
            return self.handle_multipart_upload()
        if path == "/api/media/upload-raw":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            filename = (q.get("filename") or ["upload"])[0]
            nickname = (q.get("nickname") or [""])[0]
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return self.send_json({"error": "empty upload"}, 400)
            rec = register_media_stream(self.biz_id, self.rfile, length, filename, nickname)
            return self.send_json(rec, 201)
        if path == "/api/media/import":
            body = self.read_json()
            src = body.get("path", "")
            if not src or not os.path.isfile(src):
                return self.send_json({"error": f"file not found: {src}"}, 400)
            rec = register_media_file(self.biz_id, src, body.get("filename"), body.get("nickname", ""))
            return self.send_json(rec, 201)
        if path == "/api/media/import-url":
            body = self.read_json()
            url = body.get("url", "")
            if not url.startswith(("http://", "https://")):
                return self.send_json({"error": "url required"}, 400)
            name = body.get("filename") or safe_filename(url.split("?")[0].split("/")[-1] or "download")
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read()
            except Exception as e:
                return self.send_json({"error": f"download failed: {e}"}, 502)
            rec = register_media_bytes(self.biz_id, data, name, body.get("nickname", ""))
            return self.send_json(rec, 201)
        if path == "/api/posts":
            body = self.read_json()
            post = new_post(body)
            db = load_db()
            get_biz(db, self.biz_id)["posts"].insert(0, post)
            save_db(db)
            return self.send_json(post, 201)
        m = re.match(r"^/api/media/([\w-]+)/edit$", path)
        if m:
            if not editing.available():
                return self.send_json({"error": "editing engine (ffmpeg) not found in bin/"}, 501)
            body = self.read_json()
            biz_id = self.biz_id
            db = load_db()
            biz = get_biz(db, biz_id)
            rec = next((x for x in biz["media"] if x["id"] == m.group(1)), None)
            if not rec:
                return self.send_json({"error": "media not found"}, 404)
            src = os.path.join(MEDIA_DIR, rec["stored"])
            is_video = rec["type"] == "video"
            ops = {k: body.get(k) for k in ("trim", "splitAt", "crop", "grade")}
            nick = body.get("nickname") or ((rec.get("nickname") or rec["filename"]) + " edit")
            job_id = start_edit_job(biz["id"], lambda: editing.edit_media(src, is_video, ops), nick)
            return self.send_json({"jobId": job_id}, 202)
        m = re.match(r"^/api/media/([\w-]+)/bake-audio$", path)
        if m:
            if not editing.available():
                return self.send_json({"error": "editing engine (ffmpeg) not found in bin/"}, 501)
            body = self.read_json()
            db = load_db()
            biz = get_biz(db, self.biz_id)
            vid = next((x for x in biz["media"] if x["id"] == m.group(1)), None)
            aud = next((x for x in biz["media"] if x["id"] == body.get("audioMediaId")), None)
            if not vid or not aud:
                return self.send_json({"error": "video or audio not found"}, 404)
            vp = os.path.join(MEDIA_DIR, vid["stored"])
            ap = os.path.join(MEDIA_DIR, aud["stored"])
            nick = (vid.get("nickname") or vid["filename"]) + " + music"
            job_id = start_edit_job(biz["id"], lambda: editing.bake_audio(vp, ap), nick)
            return self.send_json({"jobId": job_id}, 202)
        if path == "/api/media/concat":
            if not editing.available():
                return self.send_json({"error": "editing engine (ffmpeg) not found in bin/"}, 501)
            body = self.read_json()
            db = load_db()
            biz = get_biz(db, self.biz_id)
            recs = [next((x for x in biz["media"] if x["id"] == mid), None)
                    for mid in (body.get("mediaIds") or [])]
            recs = [r for r in recs if r and r["type"] == "video"]
            if len(recs) < 2:

                return self.send_json({"error": "need 2+ videos to stitch"}, 400)
            paths = [os.path.join(MEDIA_DIR, r["stored"]) for r in recs]
            nick = body.get("nickname") or "stitched clip"
            job_id = start_edit_job(biz["id"], lambda: editing.concat_videos(paths), nick)
            return self.send_json({"jobId": job_id}, 202)
        m = re.match(r"^/api/posts/([\w-]+)/publish-now$", path)
        if m:
            biz_id = self.biz_id
            threading.Thread(target=publish_post, args=(biz_id, m.group(1)), daemon=True).start()
            return self.send_json({"ok": True, "note": "publishing in background"})
        m = re.match(r"^/api/posts/([\w-]+)/duplicate$", path)
        if m:
            db = load_db()
            biz = get_biz(db, self.biz_id)
            src = next((p for p in biz["posts"] if p["id"] == m.group(1)), None)
            if not src:
                return self.send_json({"error": "not found"}, 404)
            copy = json.loads(json.dumps(src))
            copy["id"] = uuid.uuid4().hex[:10]
            copy["nickname"] = (src.get("nickname") or "post") + " copy"
            copy["status"] = "draft"
            copy["scheduledAt"] = None
            copy["results"] = {}
            copy["createdAt"] = now_iso()
            biz["posts"].insert(0, copy)
            save_db(db)
            return self.send_json(copy, 201)
        return self.send_json({"error": "unknown endpoint"}, 404)
    def do_PATCH(self):
        path = self.path.split("?")[0]
        m = re.match(r"^/api/businesses/([\w-]+)$", path)
        if m:
            body = self.read_json()
            db = load_db()
            b = db["businesses"].get(m.group(1))
            if not b:
                return self.send_json({"error": "not found"}, 404)
            if body.get("name"):
                b["name"] = body["name"].strip()
            save_db(db)
            return self.send_json({"id": b["id"], "name": b["name"]})
        m = re.match(r"^/api/posts/([\w-]+)$", path)
        if m:
            body = self.read_json()
            db = load_db()
            biz = get_biz(db, self.biz_id)
            post = next((p for p in biz["posts"] if p["id"] == m.group(1)), None)
            if not post:
                return self.send_json({"error": "not found"}, 404)
            for key in ("nickname", "caption", "platforms", "mediaIds", "music",
                        "scheduledAt", "status", "coverMediaId", "notes"):
                if key in body:
                    post[key] = body[key]
            post["updatedAt"] = now_iso()
            save_db(db)
            return self.send_json(post)
        m = re.match(r"^/api/media/([\w-]+)$", path)
        if m:
            body = self.read_json()
            db = load_db()
            biz = get_biz(db, self.biz_id)
            rec = next((x for x in biz["media"] if x["id"] == m.group(1)), None)
            if not rec:
                return self.send_json({"error": "not found"}, 404)
            if "nickname" in body:
                rec["nickname"] = body["nickname"]
            save_db(db)
            return self.send_json(rec)
        return self.send_json({"error": "unknown endpoint"}, 404)
    def do_PUT(self):
        if self.path.split("?")[0] == "/api/settings":
            body = self.read_json()
            db = load_db()
            biz = get_biz(db, self.biz_id)
            plats = biz["settings"]["platforms"]
            for name, cfg in (body.get("platforms") or {}).items():
                if name in plats:
                    plats[name].update({k: v for k, v in cfg.items() if k not in ("label", "connected")})
                    token_keys = [k for k in plats[name] if "token" in k or k == "client_id"]
                    plats[name]["connected"] = any(plats[name].get(k) for k in token_keys)
            save_db(db)
            return self.send_json(biz["settings"])
        return self.send_json({"error": "unknown endpoint"}, 404)
    def do_DELETE(self):

        path = self.path.split("?")[0]
        m = re.match(r"^/api/posts/([\w-]+)$", path)
        if m:
            db = load_db()
            biz = get_biz(db, self.biz_id)
            biz["posts"] = [p for p in biz["posts"] if p["id"] != m.group(1)]
            save_db(db)
            return self.send_json({"ok": True})
        m = re.match(r"^/api/media/([\w-]+)$", path)
        if m:
            db = load_db()
            biz = get_biz(db, self.biz_id)
            rec = next((x for x in biz["media"] if x["id"] == m.group(1)), None)
            if rec:
                biz["media"] = [x for x in biz["media"] if x["id"] != rec["id"]]
                save_db(db)
                # only delete the file if no other business references it
                still_used = any(any(x["stored"] == rec["stored"] for x in b["media"])
                                 for b in load_db()["businesses"].values())
                if not still_used:
                    for f in (os.path.join(MEDIA_DIR, rec["stored"]),
                              os.path.join(THUMBS_DIR, rec["id"] + ".jpg")):
                        try:
                            os.remove(f)
                        except OSError:
                            pass
            return self.send_json({"ok": True})
        return self.send_json({"error": "unknown endpoint"}, 404)
    # ------------- multipart upload (stdlib only)
    def handle_multipart_upload(self):
        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype:
            return self.send_json({"error": "expected multipart/form-data"}, 400)
        raw = self.read_body()
        msg = BytesParser(policy=email_default_policy).parsebytes(
            b"Content-Type: " + ctype.encode() + b"\r\n\r\n" + raw
        )
        uploaded = []
        nickname = ""
        for part in msg.iter_parts():
            name = part.get_param("name", header="content-disposition")
            filename = part.get_filename()
            payload = part.get_payload(decode=True)
            if filename and payload is not None:
                uploaded.append((filename, payload))
            elif name == "nickname" and payload is not None:
                nickname = payload.decode(errors="replace").strip()
        if not uploaded:
            return self.send_json({"error": "no file in upload"}, 400)
        recs = [register_media_bytes(self.biz_id, data, fname, nickname) for fname, data in uploaded]
        return self.send_json(recs if len(recs) > 1 else recs[0], 201)
    # ------------- static files
    def serve_file(self, base, rel):
        full = os.path.normpath(os.path.join(base, rel))
        if not full.startswith(base) or not os.path.isfile(full):
            return self.send_json({"error": "not found"}, 404)
        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)
def new_post(body):
    return {
        "id": uuid.uuid4().hex[:10],
        "nickname": body.get("nickname", ""),
        "caption": body.get("caption", ""),
        "mediaIds": body.get("mediaIds", []),
        "coverMediaId": body.get("coverMediaId"),
        "music": body.get("music", {}),
        "platforms": body.get("platforms", {}),
        "scheduledAt": body.get("scheduledAt"),
        "status": body.get("status", "draft"),
        "notes": body.get("notes", ""),
        "results": {},
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
def main():
    load_db()  # triggers migration + business folders

    threading.Thread(target=scheduler_loop, daemon=True).start()
    threading.Thread(target=watch_incoming, daemon=True).start()
    threading.Thread(target=backfill_thumbs, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Content Scheduler running → http://localhost:{PORT}")
    print(f"Media drop folders for Claude: {INCOMING_DIR}/<Business Name>/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("bye")
        sys.exit(0)
if __name__ == "__main__":
    main()
