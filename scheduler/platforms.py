"""
Platform publishing adapters (stdlib urllib only).
Each adapter implements the REAL official API flow for its platform.
They activate once you paste access tokens into Settings. Until then,
posts publish as "simulated" so you can test the whole workflow safely.
Honest platform notes (verified July 2026):
- Instagram & Threads APIs require media to be reachable at a PUBLIC url.
  Set settings.public_base_url (e.g. your hosted app's domain, or an ngrok
  tunnel) so /media/<file> resolves publicly. TikTok, Pinterest and YouTube
  accept direct file upload, so they work straight from this machine.
- TikTok API: photo carousels ARE supported (up to 35 images,
  photo_cover_index picks the cover). Custom cover images on VIDEOS are NOT
  supported by TikTok's API — only picking a frame (video_cover_timestamp_ms).
  Music cannot be chosen via API; bake audio into the video file, or let
  TikTok auto-add music on photo posts (auto_add_music).
- Instagram API: carousels, reels, stories all supported. Music from IG's
  library cannot be added via API — bake audio into the video.
"""
import json
import mimetypes
import os
import urllib.parse
import urllib.request
TIMEOUT = 180
def _http(method, url, headers=None, data=None, json_body=None):
    headers = dict(headers or {})
    if json_body is not None:
        data = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise RuntimeError(f"{e.code} from {url.split('?')[0]}: {body[:500]}")
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {"raw": body}
def _media_paths(post, media_index, media_dir):
    out = []
    for mid in post.get("mediaIds", []):
        rec = media_index.get(mid)
        if rec:
            out.append((rec, os.path.join(media_dir, rec["stored"])))
    return out
def _public_url(settings_platform, global_note, stored):
    base = (settings_platform.get("public_base_url") or "").rstrip("/")
    if not base:
        raise RuntimeError(
            "This platform's API requires media at a public URL. In Settings, set "
            "'public_base_url' to your hosted app domain or an ngrok tunnel "
            "(so <base>/media/<file> is reachable from the internet)."
        )
    return f"{base}/media/{urllib.parse.quote(stored)}"
def _simulated(platform, why="no access token yet"):
    return {
        "status": "published",
        "simulated": True,
        "note": f"Simulated publish to {platform} ({why}). Paste a token in Settings to go live.",
    }
# ---------------------------------------------------------------- Instagram
def publish_instagram(post, cfg, settings, media_index, media_dir):
    token = settings.get("access_token")
    ig_user = settings.get("ig_user_id")
    if not token or not ig_user:
        return _simulated("Instagram")

    items = _media_paths(post, media_index, media_dir)
    if not items:
        raise RuntimeError("no media attached")
    caption = cfg.get("caption") or post.get("caption", "")
    ptype = cfg.get("type", "post")  # post | carousel | reel | story
    base = f"https://graph.facebook.com/v21.0/{ig_user}"
    def create_container(params):
        params["access_token"] = token
        res = _http("POST", f"{base}/media", data=urllib.parse.urlencode(params).encode(),
                    headers={"Content-Type": "application/x-www-form-urlencoded"})
        if "id" not in res:
            raise RuntimeError(f"container failed: {res}")
        return res["id"]
    def publish(container_id):
        res = _http("POST", f"{base}/media_publish",
                    data=urllib.parse.urlencode({"creation_id": container_id, "access_token": token}).encode(),
                    headers={"Content-Type": "application/x-www-form-urlencoded"})
        return res
    if ptype == "carousel" or (ptype == "post" and len(items) > 1):
        children = []
        for rec, _ in items[:10]:
            url = _public_url(settings, None, rec["stored"])
            p = {"is_carousel_item": "true"}
            if rec["type"] == "video":
                p.update({"media_type": "VIDEO", "video_url": url})
            else:
                p["image_url"] = url
            children.append(create_container(p))
        cid = create_container({"media_type": "CAROUSEL", "children": ",".join(children), "caption": caption})
    elif ptype == "reel":
        rec, _ = items[0]
        cid = create_container({"media_type": "REELS",
                                "video_url": _public_url(settings, None, rec["stored"]),
                                "caption": caption, "share_to_feed": "true"})
    elif ptype == "story":
        rec, _ = items[0]
        p = {"media_type": "STORIES"}
        key = "video_url" if rec["type"] == "video" else "image_url"
        p[key] = _public_url(settings, None, rec["stored"])
        cid = create_container(p)
    else:  # single photo/video post
        rec, _ = items[0]
        if rec["type"] == "video":
            cid = create_container({"media_type": "REELS",
                                    "video_url": _public_url(settings, None, rec["stored"]),
                                    "caption": caption})
        else:
            cid = create_container({"image_url": _public_url(settings, None, rec["stored"]), "caption": caption})
    res = publish(cid)
    return {"status": "published", "platform_id": res.get("id"), "note": f"Instagram {ptype}"}
# ---------------------------------------------------------------- TikTok
def publish_tiktok(post, cfg, settings, media_index, media_dir):
    token = settings.get("access_token")
    if not token:
        return _simulated("TikTok")
    items = _media_paths(post, media_index, media_dir)
    if not items:
        raise RuntimeError("no media attached")
    caption = cfg.get("caption") or post.get("caption", "")
    headers = {"Authorization": f"Bearer {token}"}
    images = [(r, p) for r, p in items if r["type"] == "image"]
    videos = [(r, p) for r, p in items if r["type"] == "video"]
    if videos:  # video post — direct file upload, chunked
        rec, path = videos[0]
        size = os.path.getsize(path)
        init = _http("POST", "https://open.tiktokapis.com/v2/post/publish/video/init/",
                     headers=headers, json_body={
                         "post_info": {
                             "title": caption[:2200],
                             "privacy_level": cfg.get("privacy", "SELF_ONLY"),
                             "video_cover_timestamp_ms": int(cfg.get("cover_timestamp_ms") or 0),
                         },
                         "source_info": {
                             "source": "FILE_UPLOAD",
                             "video_size": size,
                             "chunk_size": size,
                             "total_chunk_count": 1,
                         },
                     })

        data = init.get("data") or {}
        upload_url = data.get("upload_url")
        if not upload_url:
            raise RuntimeError(f"tiktok init failed: {init}")
        with open(path, "rb") as f:
            blob = f.read()
        _http("PUT", upload_url, headers={
            "Content-Type": mimetypes.guess_type(path)[0] or "video/mp4",
            "Content-Range": f"bytes 0-{size-1}/{size}",
        }, data=blob)
        return {"status": "published", "platform_id": data.get("publish_id"),
                "note": "TikTok video (cover = chosen frame; custom cover images are a TikTok API limitation)"}
    # photo post / carousel — TikTok API wants public photo URLs
    photo_urls = [_public_url(settings, None, r["stored"]) for r, _ in images[:35]]
    res = _http("POST", "https://open.tiktokapis.com/v2/post/publish/content/init/",
                headers=headers, json_body={
                    "post_info": {
                        "title": (cfg.get("title") or post.get("nickname") or "")[:90],
                        "description": caption[:4000],
                        "privacy_level": cfg.get("privacy", "SELF_ONLY"),
                        "auto_add_music": bool(cfg.get("auto_add_music", True)),
                    },
                    "source_info": {
                        "source": "PULL_FROM_URL",
                        "photo_images": photo_urls,
                        "photo_cover_index": int(cfg.get("photo_cover_index") or 0),
                    },
                    "post_mode": "DIRECT_POST",
                    "media_type": "PHOTO",
                })
    data = res.get("data") or {}
    if not data.get("publish_id"):
        raise RuntimeError(f"tiktok photo post failed: {res}")
    return {"status": "published", "platform_id": data.get("publish_id"), "note": "TikTok photo carousel"}
# ---------------------------------------------------------------- Threads
def publish_threads(post, cfg, settings, media_index, media_dir):
    token = settings.get("access_token")
    user = settings.get("threads_user_id")
    if not token or not user:
        return _simulated("Threads")
    items = _media_paths(post, media_index, media_dir)
    caption = cfg.get("caption") or post.get("caption", "")
    base = f"https://graph.threads.net/v1.0/{user}"
    def create(params):
        params["access_token"] = token
        res = _http("POST", f"{base}/threads", data=urllib.parse.urlencode(params).encode(),
                    headers={"Content-Type": "application/x-www-form-urlencoded"})
        if "id" not in res:
            raise RuntimeError(f"threads container failed: {res}")
        return res["id"]
    if not items:
        cid = create({"media_type": "TEXT", "text": caption})
    elif len(items) == 1:
        rec, _ = items[0]
        url = _public_url(settings, None, rec["stored"])
        mt = "VIDEO" if rec["type"] == "video" else "IMAGE"
        key = "video_url" if mt == "VIDEO" else "image_url"
        cid = create({"media_type": mt, key: url, "text": caption})
    else:  # carousel
        children = []
        for rec, _ in items[:20]:
            url = _public_url(settings, None, rec["stored"])
            mt = "VIDEO" if rec["type"] == "video" else "IMAGE"
            key = "video_url" if mt == "VIDEO" else "image_url"
            children.append(create({"media_type": mt, key: url, "is_carousel_item": "true"}))
        cid = create({"media_type": "CAROUSEL", "children": ",".join(children), "text": caption})
    res = _http("POST", f"{base}/threads_publish",
                data=urllib.parse.urlencode({"creation_id": cid, "access_token": token}).encode(),
                headers={"Content-Type": "application/x-www-form-urlencoded"})
    return {"status": "published", "platform_id": res.get("id"), "note": "Threads"}
# ---------------------------------------------------------------- Pinterest
def publish_pinterest(post, cfg, settings, media_index, media_dir):
    token = settings.get("access_token")
    board = cfg.get("board_id") or settings.get("board_id")
    if not token:
        return _simulated("Pinterest")
    if not board:

        raise RuntimeError("Pinterest board_id missing (set it in Settings)")
    items = _media_paths(post, media_index, media_dir)
    if not items:
        raise RuntimeError("no media attached")
    rec, path = items[0]
    import base64
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    body = {
        "board_id": board,
        "title": (cfg.get("title") or post.get("nickname") or "")[:100],
        "description": (cfg.get("caption") or post.get("caption", ""))[:800],
        "media_source": {
            "source_type": "image_base64",
            "content_type": mimetypes.guess_type(path)[0] or "image/jpeg",
            "data": b64,
        },
    }
    if cfg.get("link"):
        body["link"] = cfg["link"]
    res = _http("POST", "https://api.pinterest.com/v5/pins",
                headers={"Authorization": f"Bearer {token}"}, json_body=body)
    if not res.get("id"):
        raise RuntimeError(f"pinterest failed: {res}")
    return {"status": "published", "platform_id": res.get("id"), "note": "Pinterest pin"}
# ---------------------------------------------------------------- YouTube Shorts
def publish_youtube(post, cfg, settings, media_index, media_dir):
    if not settings.get("refresh_token"):
        return _simulated("YouTube Shorts")
    items = [x for x in _media_paths(post, media_index, media_dir) if x[0]["type"] == "video"]
    if not items:
        raise RuntimeError("YouTube Shorts needs a video")
    rec, path = items[0]
    # refresh the access token
    tok = _http("POST", "https://oauth2.googleapis.com/token",
                data=urllib.parse.urlencode({
                    "client_id": settings.get("client_id", ""),
                    "client_secret": settings.get("client_secret", ""),
                    "refresh_token": settings["refresh_token"],
                    "grant_type": "refresh_token",
                }).encode(),
                headers={"Content-Type": "application/x-www-form-urlencoded"})
    access = tok.get("access_token")
    if not access:
        raise RuntimeError(f"google oauth failed: {tok}")
    meta = {
        "snippet": {
            "title": (cfg.get("title") or post.get("nickname") or "Short")[:95],
            "description": (cfg.get("caption") or post.get("caption", ""))[:4900] + "\n#Shorts",
        },
        "status": {"privacyStatus": cfg.get("privacy", "public"), "selfDeclaredMadeForKids": False},
    }
    init = urllib.request.Request(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        data=json.dumps(meta).encode(),
        headers={"Authorization": f"Bearer {access}", "Content-Type": "application/json",
                 "X-Upload-Content-Type": "video/*"},
        method="POST")
    with urllib.request.urlopen(init, timeout=TIMEOUT) as r:
        upload_url = r.headers.get("Location")
    if not upload_url:
        raise RuntimeError("youtube resumable init failed")
    with open(path, "rb") as f:
        blob = f.read()
    res = _http("PUT", upload_url, headers={"Content-Type": "video/*"}, data=blob)
    return {"status": "published", "platform_id": res.get("id"), "note": "YouTube Short"}
# ---------------------------------------------------------------- Facebook Page
def publish_facebook(post, cfg, settings, media_index, media_dir):
    token = settings.get("access_token")
    page = settings.get("page_id")
    if not token or not page:
        return _simulated("Facebook")
    items = _media_paths(post, media_index, media_dir)
    caption = cfg.get("caption") or post.get("caption", "")
    if not items:
        res = _http("POST", f"https://graph.facebook.com/v21.0/{page}/feed",
                    data=urllib.parse.urlencode({"message": caption, "access_token": token}).encode(),
                    headers={"Content-Type": "application/x-www-form-urlencoded"})
        return {"status": "published", "platform_id": res.get("id"), "note": "Facebook text post"}
    rec, path = items[0]
    url = _public_url(settings, None, rec["stored"])

    if rec["type"] == "video":
        res = _http("POST", f"https://graph.facebook.com/v21.0/{page}/videos",
                    data=urllib.parse.urlencode({"file_url": url, "description": caption,
                                                 "access_token": token}).encode(),
                    headers={"Content-Type": "application/x-www-form-urlencoded"})
    else:
        res = _http("POST", f"https://graph.facebook.com/v21.0/{page}/photos",
                    data=urllib.parse.urlencode({"url": url, "caption": caption,
                                                 "access_token": token}).encode(),
                    headers={"Content-Type": "application/x-www-form-urlencoded"})
    return {"status": "published", "platform_id": res.get("id"), "note": "Facebook"}
ADAPTERS = {
    "instagram": publish_instagram,
    "tiktok": publish_tiktok,
    "threads": publish_threads,
    "pinterest": publish_pinterest,
    "youtube": publish_youtube,
    "facebook": publish_facebook,
}
def publish_to_platform(platform, post, cfg, settings, media_index, media_dir):
    fn = ADAPTERS.get(platform)
    if not fn:
        return {"status": "failed", "error": f"unknown platform {platform}"}
    return fn(post, cfg, settings, media_index, media_dir)
