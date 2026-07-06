/* Content Scheduler — frontend (vanilla JS, no build step) */
"use strict";
// ---------------------------------------------------------------- state & api
const state = {
  view: "calendar",
  month: startOfMonth(new Date()),
  biz: localStorage.getItem("biz") || null,
  businesses: [],
  posts: [],
  media: [],
  settings: null,
  editingPost: null,   // working copy inside composer
  pickerTarget: null,  // "media" | "music" | "cover"
};
const PLATFORMS = [
  { key: "instagram", name: "Instagram", abbr: "IG" },
  { key: "tiktok", name: "TikTok", abbr: "TT" },
  { key: "threads", name: "Threads", abbr: "TH" },
  { key: "youtube", name: "YouTube Shorts", abbr: "YT" },
  { key: "pinterest", name: "Pinterest", abbr: "PIN" },
  { key: "facebook", name: "Facebook", abbr: "FB" },
];
const ABBR = Object.fromEntries(PLATFORMS.map(p => [p.key, p.abbr]));
function withBiz(p) {
  if (!state.biz) return p;
  return p + (p.includes("?") ? "&" : "?") + "biz=" + encodeURIComponent(state.biz);
}
const api = {
  async get(p) { return (await fetch(withBiz(p))).json(); },
  async send(method, p, body) {
    const r = await fetch(withBiz(p), {
      method,
      headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  },
};
async function refresh() {
  state.businesses = await api.get("/api/businesses");
  let current = state.businesses.find(b => b.id === state.biz);
  if (!current) {
    current = state.businesses[0];
    state.biz = current.id;
    localStorage.setItem("biz", current.id);
  }
  renderBizSwitcher();
  [state.posts, state.media, state.settings] = await Promise.all([
    api.get("/api/posts"), api.get("/api/media"), api.get("/api/settings"),
  ]);
  render();
}
// ---------------------------------------------------------------- business switcher (top bar)
function renderBizSwitcher() {
  const box = document.getElementById("bizSwitcher");
  box.innerHTML = "";
  for (const b of state.businesses) {
    box.append(el("button", {
      class: `biz-tab${b.id === state.biz ? " active" : ""}`,
      title: "Click to switch · double-click to rename",
      onclick: () => {
        if (b.id === state.biz) return;
        state.biz = b.id;
        localStorage.setItem("biz", b.id);
        toast(`Now posting for ${b.name}`);
        refresh();
      },
      ondblclick: async () => {
        const name = prompt("Rename this business:", b.name);
        if (!name) return;
        await api.send("PATCH", `/api/businesses/${b.id}`, { name });
        refresh();
      },
    }, b.name));
  }

  box.append(el("button", {
    class: "biz-tab add", title: "Add a business",
    onclick: async () => {
      const name = prompt("Name of the new business:");
      if (!name) return;
      const b = await api.send("POST", "/api/businesses", { name });
      state.biz = b.id;
      localStorage.setItem("biz", b.id);
      refresh();
    },
  }, "■"));
}
function mediaById(id) { return state.media.find(m => m.id === id); }
function mediaUrl(m) { return m ? `/media/${encodeURIComponent(m.stored)}` : ""; }
function mediaLabel(m) { return m ? (m.nickname || m.filename) : "(missing)"; }
// ---------------------------------------------------------------- utilities
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "html") node.innerHTML = v;
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function toLocalInputValue(iso) {
  const d = iso ? new Date(iso) : new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), 2600);
}
function statusLabel(s) {
  return { draft: "Draft", scheduled: "Scheduled", publishing: "Publishing…",
           published: "Published", needs_attention: "Needs attention", failed: "Failed" }[s] || s;
}
function enabledPlatforms(post) {
  return Object.entries(post.platforms || {}).filter(([, c]) => c.enabled).map(([k]) => k);
}
function mediaThumbEl(m, cls = "mthumb") {
  if (!m) return el("div", { class: cls });
  if (m.type === "audio") return el("div", { class: cls, style: "display:flex;align-items:center;justify-content:center;font-size:2rem;background:var(--coral-soft)" }, "■");
  // lightweight server-side thumbnail; falls back to the real file if not ready yet
  const img = el("img", { class: cls, src: `/thumbs/${m.id}.jpg`, loading: "lazy" });
  img.addEventListener("error", () => {
    if (m.type === "video") {
      const v = el("video", { class: cls, src: mediaUrl(m) + "#t=0.5", muted: "", preload: "metadata" });
      const inline = img.getAttribute("style");
      if (inline) v.setAttribute("style", inline);
      img.replaceWith(v);
    } else if (!img.src.endsWith(mediaUrl(m))) {
      img.src = mediaUrl(m);
    }
  }, { once: true });
  return img;
}
// ---------------------------------------------------------------- router
function render() {
  document.querySelectorAll(".tab").forEach(t =>
    t.classList.toggle("active", t.dataset.view === state.view));
  const view = document.getElementById("view");
  view.innerHTML = "";

  if (state.view === "calendar") view.append(renderCalendar());
  else if (state.view === "drafts") view.append(renderDrafts());
  else if (state.view === "library") view.append(renderLibrary());
  else if (state.view === "settings") view.append(renderSettings());
}
// ---------------------------------------------------------------- calendar view
function renderCalendar() {
  const wrap = el("div");
  const m = state.month;
  const monthName = m.toLocaleString([], { month: "long", year: "numeric" });
  wrap.append(el("div", { class: "cal-header" },
    el("h2", {}, monthName),
    el("button", { class: "btn", onclick: () => { state.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); render(); } }, "‹ Prev"),
    el("button", { class: "btn", onclick: () => { state.month = startOfMonth(new Date()); render(); } }, "Today"),
    el("button", { class: "btn", onclick: () => { state.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); render(); } }, "Next ›"),
  ));
  const grid = el("div", { class: "cal-grid" });
  for (const d of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])
    grid.append(el("div", { class: "cal-dow" }, d));
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 42; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const inMonth = day.getMonth() === m.getMonth();
    const isToday = day.getTime() === today.getTime();
    const dayPosts = state.posts.filter(p => {
      if (!p.scheduledAt) return false;
      const d = new Date(p.scheduledAt);
      return d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
    }).sort((a, b) => (a.scheduledAt || "").localeCompare(b.scheduledAt || ""));
    const cell = el("div", {
      class: `cal-day${inMonth ? "" : " other-month"}${isToday ? " today" : ""}`,
      onclick: (e) => { if (e.target.closest(".chip")) return; openComposer(null, day); },
    }, el("div", { class: "cal-daynum" }, String(day.getDate())));
    for (const p of dayPosts.slice(0, 4)) {
      const time = new Date(p.scheduledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      cell.append(el("div", {
        class: `chip ${p.status}`,
        title: `${p.nickname || "(no nickname)"} — ${statusLabel(p.status)}`,
        onclick: () => openComposer(p),
      },
        `${time} ${p.nickname || "(untitled)"} `,
        el("span", { class: "platform-dots" },
          enabledPlatforms(p).map(k => el("span", { class: `pdot ${k}` }, ABBR[k]))),
      ));
    }
    if (dayPosts.length > 4)
      cell.append(el("div", { class: "chip" }, `+${dayPosts.length - 4} more`));
    grid.append(cell);
  }
  wrap.append(grid);
  wrap.append(el("p", { class: "hint", style: "margin-top:10px" },
    "Click any day to schedule a post for that date. Click a colored chip to edit that post."));
  return wrap;
}
// ---------------------------------------------------------------- drafts view
function renderDrafts() {
  const wrap = el("div");
  const groups = [
    ["Drafts", p => p.status === "draft"],
    ["Scheduled", p => p.status === "scheduled" || p.status === "publishing"],
    ["Needs attention", p => p.status === "needs_attention" || p.status === "failed"],
    ["Published", p => p.status === "published"],
  ];
  for (const [title, fn] of groups) {
    const posts = state.posts.filter(fn);
    if (title !== "Drafts" && posts.length === 0) continue;
    wrap.append(el("div", { class: "section-title" }, `${title} (${posts.length})`));
    if (posts.length === 0) {
      wrap.append(el("div", { class: "empty" }, "No drafts yet — hit “■ New Post” and give it a nickname like “post one”."));
      continue;
    }
    const list = el("div", { class: "card-list", style: "margin-bottom:22px" });
    for (const p of posts) list.append(postCard(p));

    wrap.append(list);
  }
  return wrap;
}
function postCard(p) {
  const firstMedia = mediaById((p.mediaIds || [])[0]);
  const thumb = firstMedia ? mediaThumbEl(firstMedia, "thumb") : el("div", { class: "thumb" }, "■");
  const nickInput = el("input", {
    class: "mnick", type: "text", value: p.nickname || "", placeholder: "add a nickname…",
    style: "font-weight:700;border:1px solid transparent;border-radius:6px;padding:2px 6px;width:100%;max-width:280px;background:transparent",
    onfocus: e => e.target.style.borderColor = "var(--line)",
    onblur: async e => {
      e.target.style.borderColor = "transparent";
      if (e.target.value !== (p.nickname || "")) {
        await api.send("PATCH", `/api/posts/${p.id}`, { nickname: e.target.value });
        p.nickname = e.target.value;
        toast("Nickname saved");
      }
    },
    onkeydown: e => { if (e.key === "Enter") e.target.blur(); },
  });
  const errs = Object.entries(p.results || {}).filter(([, r]) => r.status !== "published");
  return el("div", { class: "post-card" },
    thumb,
    el("div", { class: "info" },
      el("div", { class: "nickname" }, nickInput),
      el("div", { class: "meta" },
        el("span", { class: `badge ${p.status}` }, statusLabel(p.status)),
        " ",
        p.scheduledAt ? `■ ${fmtTime(p.scheduledAt)}` : "no date yet",
        el("span", { class: "platform-dots" },
          enabledPlatforms(p).map(k => el("span", { class: `pdot ${k}`, title: k }, ABBR[k]))),
        ` · ${(p.mediaIds || []).length} media`,
      ),
      p.caption ? el("div", { class: "caption-preview" }, p.caption) : null,
      errs.length ? el("div", { class: "meta", style: "color:var(--bad)" },
        errs.map(([k, r]) => `${k}: ${r.error || r.note || r.status}`).join(" · ")) : null,
    ),
    el("div", { class: "actions" },
      el("button", { class: "btn small", onclick: () => openComposer(p) }, "Edit"),
      el("button", {
        class: "btn small", onclick: async () => {
          await api.send("POST", `/api/posts/${p.id}/duplicate`);
          toast("Duplicated"); refresh();
        }
      }, "Duplicate"),
      el("button", {
        class: "btn small danger", onclick: async () => {
          if (!confirm(`Delete "${p.nickname || "this post"}"?`)) return;
          await api.send("DELETE", `/api/posts/${p.id}`);
          toast("Deleted"); refresh();
        }
      }, "■"),
    ),
  );
}
// ---------------------------------------------------------------- library view
function renderLibrary() {
  const wrap = el("div");
  const fileInput = el("input", { type: "file", multiple: "", style: "display:none" });
  fileInput.addEventListener("change", () => uploadFiles(fileInput.files));
  const dz = el("div", { class: "dropzone", onclick: () => fileInput.click() },
    el("div", { style: "font-size:1.6rem" }, "■"),
    el("div", {}, "Drop photos / videos / music here, or click to browse"),
    el("div", { class: "hint" }, "Claude can also add files for you automatically — see the incoming/ folder or CLAUDE-API.md"));
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("dragover"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
  dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("dragover"); uploadFiles(e.dataTransfer.files); });
  wrap.append(dz, fileInput);
  if (state.media.length === 0) {
    wrap.append(el("div", { class: "empty" }, "Your media library is empty."));
    return wrap;
  }
  const grid = el("div", { class: "media-grid" });
  for (const m of state.media) {
    const nick = el("input", {
      class: "mnick", type: "text", value: m.nickname || "", placeholder: "nickname…",
      onblur: async e => {
        if (e.target.value !== (m.nickname || "")) {
          await api.send("PATCH", `/api/media/${m.id}`, { nickname: e.target.value });

          m.nickname = e.target.value; toast("Saved");
        }
      },
      onkeydown: e => { if (e.key === "Enter") e.target.blur(); },
    });
    const card = el("div", { class: "media-card" },
      mediaThumbEl(m),
      (m.type === "image" || m.type === "video")
        ? el("button", { class: "medit", title: "Edit", onclick: () => openEditor(m) }, "✏■")
        : null,
      el("button", {
        class: "mdel", title: "Delete", onclick: async () => {
          if (!confirm(`Delete ${mediaLabel(m)}?`)) return;
          await api.send("DELETE", `/api/media/${m.id}`); refresh();
        }
      }, "✕"),
      el("div", { class: "mname" }, `${m.type === "audio" ? "■ " : ""}${m.filename}`),
      nick,
    );
    grid.append(card);
  }
  wrap.append(grid);
  return wrap;
}
function uploadOne(f) {
  // XHR streams the file (4K-friendly) and gives real progress
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", withBiz(`/api/media/upload-raw?filename=${encodeURIComponent(f.name)}`));
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        const mb = (e.total / 1048576).toFixed(0);
        toast(`Uploading ${f.name} (${mb} MB) — ${pct}%`);
      }
    };
    xhr.onload = () => xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(xhr.responseText));
    xhr.onerror = () => reject(new Error("upload failed"));
    xhr.send(f);
  });
}
async function uploadFiles(files) {
  if (!files || !files.length) return;
  for (const f of files) {
    try { await uploadOne(f); }
    catch (e) { toast(`Upload of ${f.name} failed`); console.error(e); }
  }
  toast("Upload complete ✓");
  refresh();
}
// ---------------------------------------------------------------- settings view
function renderSettings() {
  const wrap = el("div");
  wrap.append(el("div", { class: "callout" }, el("b", {}, "How going live works: "),
    "posts publish in “simulation mode” until you paste real access tokens below — so you can test everything safely first. ",
    "Instagram, Threads and Facebook also need a public link to your media: fill in “Public base URL” once your app is hosted (or use an ngrok tunnel)."));
  wrap.append(el("div", { class: "callout warn" }, el("b", {}, "Platform truth (verified against official docs): "),
    "■ Carousels CAN be scheduled to TikTok (up to 35 photos) and Instagram (up to 10) — apps like Plann/Loomly just chose not to build it. ",
    "■■ TikTok custom cover photos on videos are NOT possible via any third-party tool — TikTok's API only lets you pick a frame from the video. On photo carousels you CAN pick the cover image. ",
    "■■ TikTok/Instagram music libraries can't be accessed by any third-party app — bake your music into the video file (this app can grab a frame or you can use CapCut), or use TikTok's auto-add-music for photo posts."));
  const fields = {
    instagram: [["access_token", "Access token (Meta Graph API)"], ["ig_user_id", "Instagram user ID"], ["public_base_url", "Public base URL (https://…)"]],
    tiktok: [["access_token", "Access token (TikTok for Developers)"], ["public_base_url", "Public base URL (for photo carousels)"]],
    threads: [["access_token", "Threads access token"], ["threads_user_id", "Threads user ID"], ["public_base_url", "Public base URL"]],
    pinterest: [["access_token", "Pinterest access token"], ["board_id", "Default board ID"]],
    youtube: [["client_id", "Google client ID"], ["client_secret", "Google client secret"], ["refresh_token", "OAuth refresh token"]],
    facebook: [["access_token", "Page access token"], ["page_id", "Page ID"], ["public_base_url", "Public base URL"]],
  };
  const grid = el("div", { class: "settings-grid" });
  const inputs = {};
  for (const p of PLATFORMS) {
    const cfg = state.settings.platforms[p.key] || {};
    inputs[p.key] = {};
    const card = el("div", { class: "setting-card" },
      el("h4", {}, `${p.name} `,
        el("span", { class: `status ${cfg.connected ? "on" : "off"}` },
          cfg.connected ? "● connected" : "■ simulation mode")));
    for (const [key, label] of fields[p.key]) {
      const input = el("input", { type: key.includes("token") || key.includes("secret") ? "password" : "text", value: cfg[key] || "" });
      inputs[p.key][key] = input;

      card.append(el("div", { class: "form-row" }, el("label", {}, label), input));
    }
    grid.append(card);
  }
  wrap.append(grid);
  wrap.append(el("div", { style: "margin-top:16px" },
    el("button", {
      class: "btn primary", onclick: async () => {
        const platforms = {};
        for (const [pk, fieldMap] of Object.entries(inputs)) {
          platforms[pk] = {};
          for (const [k, input] of Object.entries(fieldMap)) platforms[pk][k] = input.value.trim();
        }
        state.settings = await api.send("PUT", "/api/settings", { platforms });
        toast("Connections saved ✓"); render();
      }
    }, "Save connections")));
  return wrap;
}
// ---------------------------------------------------------------- composer
function blankPost(date) {
  const at = date ? new Date(date) : null;
  if (at) at.setHours(12, 0, 0, 0);
  return {
    id: null, nickname: "", caption: "", mediaIds: [], music: {},
    platforms: Object.fromEntries(PLATFORMS.map(p => [p.key, { enabled: false, type: "post" }])),
    scheduledAt: at ? at.toISOString() : null, status: "draft", results: {},
  };
}
function openComposer(post, date) {
  state.editingPost = post ? JSON.parse(JSON.stringify(post)) : blankPost(date);
  const p = state.editingPost;
  for (const pl of PLATFORMS) if (!p.platforms[pl.key]) p.platforms[pl.key] = { enabled: false, type: "post" };
  document.getElementById("composerBackdrop").classList.remove("hidden");
  renderComposer();
}
function closeComposer() {
  document.getElementById("composerBackdrop").classList.add("hidden");
  state.editingPost = null;
}
function renderComposer() {
  const p = state.editingPost;
  const box = document.getElementById("composer");
  box.innerHTML = "";
  box.append(
    el("h3", {}, p.id ? "Edit post" : "New post"),
    el("div", { class: "sub" }, "Fill this out once — it cross-posts to every platform you toggle on."),
  );
  // nickname + schedule
  const nickInput = el("input", { type: "text", value: p.nickname, placeholder: "e.g. post one, post two, launch teaser…" });
  nickInput.addEventListener("input", () => p.nickname = nickInput.value);
  const dtInput = el("input", { type: "datetime-local", value: p.scheduledAt ? toLocalInputValue(p.scheduledAt) : "" });
  dtInput.addEventListener("change", () => p.scheduledAt = dtInput.value ? new Date(dtInput.value).toISOString() : null);
  box.append(el("div", { class: "two-col" },
    el("div", { class: "form-row" }, el("label", {}, "Nickname (your name for this draft)"), nickInput),
    el("div", { class: "form-row" }, el("label", {}, "Schedule for"), dtInput),
  ));
  // caption
  const cap = el("textarea", { placeholder: "Write your caption once… #hashtags too" });
  cap.value = p.caption;
  cap.addEventListener("input", () => p.caption = cap.value);
  box.append(el("div", { class: "form-row" }, el("label", {}, "Caption (shared across platforms — override per platform below)"), cap));
  // attached media
  const swapIn = (oldId) => (newIds) => {
    if (state.editingPost !== p) return; // composer closed or moved on
    const idx = p.mediaIds.indexOf(oldId);
    if (idx >= 0) { p.mediaIds.splice(idx, 1, ...newIds); renderComposer(); toast("Edited version attached ✓"); }
  };
  const strip = el("div", { class: "attached" });
  p.mediaIds.forEach((mid, i) => {
    const m = mediaById(mid);
    const att = el("div", { class: "att", title: mediaLabel(m) },
      m ? mediaThumbEl(m, "") : el("div", {}, "?"),
      el("span", { class: "ord" }, String(i + 1)),
      (m && (m.type === "video" || m.type === "image"))
        ? el("button", { class: "edt", title: "Edit (trim, crop, color)", onclick: () => openEditor(m, swapIn(m.id)) }, "✎")
        : null,
      el("button", { class: "rm", onclick: () => { p.mediaIds.splice(i, 1); renderComposer(); } }, "✕"));

    att.querySelector("img,video")?.setAttribute("style", "width:100%;height:100%;object-fit:cover");
    strip.append(att);
  });
  strip.append(el("button", { class: "add-more", onclick: () => openPicker("media") }, "■"));
  const mediaRow = el("div", { class: "form-row" },
    el("label", {}, `Media (${p.mediaIds.length} attached — 2+ photos = carousel · ✎ to edit)`), strip);
  const vids = p.mediaIds.filter(id => mediaById(id)?.type === "video");
  if (vids.length >= 2) {
    mediaRow.append(el("div", { style: "margin-top:8px" }, el("button", {
      class: "btn small", onclick: async () => {
        const res = await api.send("POST", "/api/media/concat",
          { mediaIds: vids, nickname: (p.nickname || "post") + " stitched" });
        if (!res.jobId) { toast(res.error || "Could not start stitching"); return; }
        const job = await pollJob(res.jobId, "Stitching clips");
        if (job && state.editingPost === p) {
          p.mediaIds = p.mediaIds.filter(id => !vids.includes(id));
          p.mediaIds.push(...job.mediaIds);
          renderComposer(); toast("Stitched clip attached ✓");
        }
      }
    }, `■ Stitch ${vids.length} clips into one video`)));
  }
  box.append(mediaRow);
  // music
  const musicMedia = p.music?.mediaId ? mediaById(p.music.mediaId) : null;
  const firstVideoId = p.mediaIds.find(id => mediaById(id)?.type === "video");
  box.append(el("div", { class: "form-row" },
    el("label", {}, "Music / audio"),
    el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" },
      el("button", { class: "btn small", onclick: () => openPicker("music") },
        musicMedia ? `■ ${mediaLabel(musicMedia)}` : "■ Attach audio file"),
      musicMedia ? el("button", { class: "btn small danger", onclick: () => { p.music = {}; renderComposer(); } }, "remove") : null,
      (musicMedia && firstVideoId) ? el("button", {
        class: "btn small", onclick: async () => {
          const res = await api.send("POST", `/api/media/${firstVideoId}/bake-audio`, { audioMediaId: musicMedia.id });
          if (!res.jobId) { toast(res.error || "Could not start"); return; }
          const job = await pollJob(res.jobId, "Baking music into video");
          if (job) swapIn(firstVideoId)(job.mediaIds);
        }
      }, "■ Bake this music into the video") : null,
    ),
    el("div", { class: "hint" },
      "Heads-up: TikTok & Instagram don't let ANY outside app pick songs from their music libraries. " +
      "Attach your audio here as a reminder / for videos with baked-in sound, toggle TikTok's auto-add-music for photo posts, " +
      "or add the trending sound in-app after it publishes."),
  ));
  // platforms
  box.append(el("div", { class: "form-row" }, el("label", {}, "Post to"), renderPlatformGrid(p)));
  // footer
  const footer = el("div", { class: "composer-footer" });
  if (p.id) footer.append(el("button", {
    class: "btn danger", onclick: async () => {
      if (!confirm("Delete this post?")) return;
      await api.send("DELETE", `/api/posts/${p.id}`);
      closeComposer(); toast("Deleted"); refresh();
    }
  }, "Delete"));
  footer.append(el("div", { class: "spacer" }));
  footer.append(el("button", { class: "btn", onclick: closeComposer }, "Cancel"));
  footer.append(el("button", { class: "btn", onclick: () => savePost("draft") }, "Save as draft"));
  footer.append(el("button", { class: "btn primary", onclick: () => savePost("scheduled") }, p.scheduledAt ? "Schedule ✓" : "Schedule…"));
  if (p.id) footer.append(el("button", { class: "btn primary", onclick: publishNow }, "Publish now"));
  box.append(footer);
}
function renderPlatformGrid(p) {
  const grid = el("div", { class: "plat-grid" });
  for (const plat of PLATFORMS) {
    const cfg = p.platforms[plat.key];
    const card = el("div", { class: `plat-card${cfg.enabled ? " on" : ""}` });
    const check = el("input", { type: "checkbox" });
    check.checked = !!cfg.enabled;
    check.addEventListener("change", () => { cfg.enabled = check.checked; renderComposer(); });
    card.append(el("label", { class: "plat-head" }, check,
      el("span", { class: "pname" }, plat.name),
      el("span", { class: `pdot ${plat.key}` }, plat.abbr)));
    if (cfg.enabled) {
      const opts = el("div", { class: "plat-opts" });
      const hasVideo = p.mediaIds.some(id => mediaById(id)?.type === "video");
      const imgCount = p.mediaIds.filter(id => mediaById(id)?.type === "image").length;
      if (plat.key === "instagram") {

        opts.append(el("div", { class: "mini-label" }, "Format"), sel(cfg, "type", [
          ["post", "Feed post (photo/video)"], ["carousel", "Carousel"], ["reel", "Reel"], ["story", "Story"],
        ]));
        if (cfg.type === "story") opts.append(el("div", { class: "plat-note warn" },
          "Stories publish fine via API, but stickers/music/links can't be added by any outside app (Instagram rule)."));
        opts.append(capOverride(cfg));
      }
      if (plat.key === "tiktok") {
        opts.append(el("div", { class: "mini-label" }, "Format"), sel(cfg, "type", [
          ["video", "Video"], ["carousel", `Photo carousel${imgCount ? ` (${imgCount} photos)` : ""}`],
        ]));
        if (cfg.type === "video" || (cfg.type !== "carousel" && hasVideo)) {
          const btn = el("button", { class: "btn small", onclick: () => openCoverPicker(p, cfg) },
            cfg.cover_timestamp_ms ? `■ Cover frame @ ${(cfg.cover_timestamp_ms / 1000).toFixed(1)}s` : "■ Pick cover frame");
          opts.append(btn, el("div", { class: "plat-note warn" },
            "TikTok's API only allows picking a FRAME from your video as cover — uploading a separate cover photo isn't possible for any scheduling app. Tip: edit your cover image into the first second of the video."));
        }
        if (cfg.type === "carousel") {
          opts.append(el("div", { class: "mini-label" }, "Cover photo = which image?"),
            numInput(cfg, "photo_cover_index", "0 = first photo"),
            checkbox(cfg, "auto_add_music", "Let TikTok auto-add music ■"));
        }
        opts.append(capOverride(cfg));
      }
      if (plat.key === "youtube") {
        opts.append(el("div", { class: "mini-label" }, "Short title"), txt(cfg, "title", "Title for the Short"), capOverride(cfg));
        if (!hasVideo) opts.append(el("div", { class: "plat-note warn" }, "Needs a video attached."));
      }
      if (plat.key === "pinterest") {
        opts.append(el("div", { class: "mini-label" }, "Pin title"), txt(cfg, "title", "Pin title"),
          el("div", { class: "mini-label" }, "Destination link (optional)"), txt(cfg, "link", "https://…"),
          capOverride(cfg));
      }
      if (plat.key === "threads" || plat.key === "facebook") opts.append(capOverride(cfg));
      card.append(opts);
    }
    grid.append(card);
  }
  return grid;
  function sel(cfg, key, options) {
    const s = el("select", {});
    for (const [v, label] of options) s.append(el("option", { value: v }, label));
    s.value = options.some(([v]) => v === cfg[key]) ? cfg[key] : options[0][0];
    cfg[key] = s.value;
    s.addEventListener("change", () => { cfg[key] = s.value; renderComposer(); });
    return s;
  }
  function txt(cfg, key, ph) {
    const i = el("input", { type: "text", value: cfg[key] || "", placeholder: ph });
    i.addEventListener("input", () => cfg[key] = i.value);
    return i;
  }
  function numInput(cfg, key, ph) {
    const i = el("input", { type: "number", value: cfg[key] ?? 0, placeholder: ph, min: 0 });
    i.addEventListener("input", () => cfg[key] = Number(i.value || 0));
    return i;
  }
  function checkbox(cfg, key, label) {
    const c = el("input", { type: "checkbox" });
    c.checked = cfg[key] !== false;
    c.addEventListener("change", () => cfg[key] = c.checked);
    return el("label", { style: "display:flex;gap:6px;align-items:center;font-size:.85rem" }, c, label);
  }
  function capOverride(cfg) {
    const i = el("input", { type: "text", value: cfg.caption || "", placeholder: "Caption override (blank = shared caption)" });
    i.addEventListener("input", () => cfg.caption = i.value);
    return i;
  }
}
async function savePost(status) {
  const p = state.editingPost;
  if (status === "scheduled" && !p.scheduledAt) {
    toast("Pick a date & time first ■"); return;
  }
  const body = {
    nickname: p.nickname, caption: p.caption, mediaIds: p.mediaIds,
    music: p.music, platforms: p.platforms, scheduledAt: p.scheduledAt, status,
  };
  let saved;
  if (p.id) saved = await api.send("PATCH", `/api/posts/${p.id}`, body);
  else saved = await api.send("POST", "/api/posts", body);
  closeComposer();
  toast(status === "scheduled" ? "Scheduled ✓" : "Draft saved ✓");
  refresh();
  return saved;

}
async function publishNow() {
  const p = state.editingPost;
  const saved = await savePost(p.scheduledAt ? "scheduled" : "draft");
  if (!saved?.id) { toast("Save failed — try again"); return; }
  await api.send("POST", `/api/posts/${saved.id}/publish-now`);
  toast("Publishing now…");
  setTimeout(refresh, 3000);
}
// ---------------------------------------------------------------- media picker
function openPicker(target) {
  state.pickerTarget = target;
  const backdrop = document.getElementById("pickerBackdrop");
  const box = document.getElementById("picker");
  box.innerHTML = "";
  const isMusic = target === "music";
  const candidates = state.media.filter(m => isMusic ? m.type === "audio" : m.type !== "audio");
  box.append(el("h3", {}, isMusic ? "Pick audio" : "Pick media"),
    el("div", { class: "sub" }, isMusic ? "Audio files from your library." :
      "Click to select. Selection order = carousel order."));
  const chosen = [];
  const grid = el("div", { class: "media-grid" });
  for (const m of candidates) {
    const card = el("div", { class: "media-card" }, mediaThumbEl(m),
      el("div", { class: "mname" }, mediaLabel(m)));
    card.addEventListener("click", () => {
      if (isMusic) {
        state.editingPost.music = { mediaId: m.id };
        closePicker(); renderComposer(); return;
      }
      const i = chosen.indexOf(m.id);
      if (i >= 0) { chosen.splice(i, 1); card.classList.remove("selected"); }
      else { chosen.push(m.id); card.classList.add("selected"); }
    });
    grid.append(card);
  }
  if (!candidates.length) box.append(el("div", { class: "empty" },
    isMusic ? "No audio files yet — upload mp3/m4a in the Library tab." : "No media yet — upload in the Library tab."));
  box.append(grid);
  const footer = el("div", { class: "composer-footer" },
    el("div", { class: "spacer" }),
    el("button", { class: "btn", onclick: closePicker }, "Cancel"));
  if (!isMusic) footer.append(el("button", {
    class: "btn primary", onclick: () => {
      state.editingPost.mediaIds.push(...chosen);
      closePicker(); renderComposer();
    }
  }, "Add selected"));
  box.append(footer);
  backdrop.classList.remove("hidden");
}
function closePicker() { document.getElementById("pickerBackdrop").classList.add("hidden"); }
// ---------------------------------------------------------------- cover frame picker (TikTok)
function openCoverPicker(post, cfg) {
  const videoMedia = post.mediaIds.map(mediaById).find(m => m?.type === "video");
  if (!videoMedia) { toast("Attach a video first"); return; }
  const backdrop = document.getElementById("editorBackdrop");
  const box = document.getElementById("editor");
  box.innerHTML = "";
  box.append(el("h3", {}, "Pick your cover frame"),
    el("div", { class: "sub" }, "Scrub to the exact frame you want as the TikTok cover. (TikTok only allows a frame from the video — not a separate photo.)"));
  const video = el("video", { src: mediaUrl(videoMedia), muted: "", playsinline: "" });
  const range = el("input", { type: "range", min: 0, max: 1000, value: 0 });
  const timeLabel = el("span", { class: "hint" }, "0.0s");
  video.addEventListener("loadedmetadata", () => {
    range.max = Math.floor(video.duration * 1000);
    if (cfg.cover_timestamp_ms) { range.value = cfg.cover_timestamp_ms; video.currentTime = cfg.cover_timestamp_ms / 1000; }
  });
  range.addEventListener("input", () => {
    video.currentTime = range.value / 1000;
    timeLabel.textContent = `${(range.value / 1000).toFixed(1)}s`;
  });
  box.append(video, el("div", { class: "ed-tools" }, range, timeLabel),
    el("div", { class: "composer-footer" },
      el("div", { class: "spacer" }),
      el("button", { class: "btn", onclick: () => backdrop.classList.add("hidden") }, "Cancel"),

      el("button", {
        class: "btn primary", onclick: () => {
          cfg.cover_timestamp_ms = Number(range.value);
          backdrop.classList.add("hidden");
          renderComposer();
          toast(`Cover frame set at ${(range.value / 1000).toFixed(1)}s ✓`);
        }
      }, "Use this frame")));
  backdrop.classList.remove("hidden");
}
// ---------------------------------------------------------------- editing studio
const GRADE_SLIDERS = [
  ["brightness", "Brightness"],
  ["warmth", "Warmth"],
  ["contrast", "Contrast"],
  ["saturation", "Saturation"],
];
const CROP_PRESETS = [
  [null, "Original"], ["1:1", "Square 1:1"], ["4:5", "Portrait 4:5"],
  ["9:16", "Vertical 9:16"], ["16:9", "Wide 16:9"], ["2:3", "Pin 2:3"],
];
function cssPreviewFilter(grade) {
  const b = 1 + (grade.brightness || 0) * 0.003;
  const c = 1 + (grade.contrast || 0) * 0.005;
  const s = Math.max(0, 1 + (grade.saturation || 0) * 0.01);
  const w = (grade.warmth || 0) * 0.25; // approximate warmth with sepia/hue mix
  const warm = w >= 0
    ? `sepia(${Math.min(60, w) / 100}) saturate(${1 + w / 200})`
    : `hue-rotate(${Math.max(-18, w / 3)}deg)`;
  return `brightness(${b}) contrast(${c}) saturate(${s}) ${warm}`;
}
async function pollJob(jobId, label) {
  toast(`${label}… ✂■ working`);
  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const job = await api.get(`/api/jobs/${jobId}`);
    if (job.status === "done") { toast(`${label} done ✓ saved to Library`); await refresh(); return job; }
    if (job.status === "failed") { toast(`${label} failed: ${job.error || "unknown error"}`); return null; }
  }
  toast(`${label} is taking a while — check the Library later`);
  return null;
}
// onDone(newMediaIds) is used by the composer to swap in the edited clip
function openEditor(m, onDone) {
  if (m.type === "video") return openVideoStudio(m, onDone);
  return openImageStudio(m, onDone);
}
function openVideoStudio(m, onDone) {
  const backdrop = document.getElementById("editorBackdrop");
  const box = document.getElementById("editor");
  box.innerHTML = "";
  const state = { grade: {}, crop: null, trimStart: null, trimEnd: null, duration: 0 };
  box.append(el("h3", {}, `Edit: ${mediaLabel(m)}`),
    el("div", { class: "sub" }, "Trim, split, crop and color grade. Saves as a NEW clip — your original stays safe."));
  const video = el("video", { src: mediaUrl(m), muted: "", playsinline: "", controls: "" });
  box.append(video);
  // --- color grading
  const gradeBox = el("div", { class: "ed-section" }, el("div", { class: "mini-label" }, "Color grade (live preview)"));
  for (const [key, label] of GRADE_SLIDERS) {
    const val = el("span", { class: "hint", style: "min-width:34px;text-align:right" }, "0");
    const range = el("input", { type: "range", min: -100, max: 100, value: 0 });
    range.addEventListener("input", () => {
      state.grade[key] = Number(range.value);
      val.textContent = range.value;
      video.style.filter = cssPreviewFilter(state.grade);
    });
    gradeBox.append(el("div", { class: "ed-tools", style: "margin:6px 0" },
      el("span", { class: "hint", style: "min-width:78px" }, label), range, val));
  }
  gradeBox.append(el("div", { class: "ed-tools" }, el("button", {
    class: "btn small", onclick: () => {
      state.grade = {}; video.style.filter = "";
      gradeBox.querySelectorAll("input[type=range]").forEach(r => { r.value = 0; });
      gradeBox.querySelectorAll(".hint[style*='34px']").forEach(s => s.textContent = "0");
    }
  }, "Reset colors")));
  box.append(gradeBox);
  // --- crop

  const cropBox = el("div", { class: "ed-section" }, el("div", { class: "mini-label" }, "Crop"));
  const cropRow = el("div", { class: "ed-tools" });
  for (const [aspect, label] of CROP_PRESETS) {
    const b = el("button", {
      class: "btn small" + (aspect === null ? " active-crop" : ""), onclick: () => {
        state.crop = aspect;
        cropRow.querySelectorAll("button").forEach(x => x.classList.remove("active-crop"));
        b.classList.add("active-crop");
      }
    }, label);
    cropRow.append(b);
  }
  cropBox.append(cropRow);
  box.append(cropBox);
  // --- trim & split
  const t = sec => `${Math.floor(sec / 60)}:${String((sec % 60).toFixed(1)).padStart(4, "0")}`;
  const trimBox = el("div", { class: "ed-section" }, el("div", { class: "mini-label" }, "Cut / split"));
  const trimLabel = el("span", { class: "hint" }, "whole clip");
  const setStart = el("button", { class: "btn small", onclick: () => { state.trimStart = video.currentTime; upd(); } }, "✂ Cut start here");
  const setEnd = el("button", { class: "btn small", onclick: () => { state.trimEnd = video.currentTime; upd(); } }, "Cut end here ✂");
  const clearTrim = el("button", { class: "btn small", onclick: () => { state.trimStart = state.trimEnd = null; upd(); } }, "Reset cut");
  function upd() {
    const a = state.trimStart != null ? t(state.trimStart) : "start";
    const b = state.trimEnd != null ? t(state.trimEnd) : "end";
    trimLabel.textContent = (state.trimStart == null && state.trimEnd == null) ? "whole clip" : `keeping ${a} → ${b}`;
  }
  trimBox.append(el("div", { class: "ed-tools" }, setStart, setEnd, clearTrim, trimLabel));
  trimBox.append(el("div", { class: "hint" }, "Play or scrub to the exact moment, then use the buttons. “Split” cuts the clip in two at the playhead."));
  box.append(trimBox);
  async function submit(extraOps, label) {
    const ops = {
      grade: Object.keys(state.grade).some(k => state.grade[k]) ? state.grade : undefined,
      crop: state.crop ? { aspect: state.crop } : undefined,
      trim: (state.trimStart != null || state.trimEnd != null)
        ? { start: state.trimStart ?? undefined, end: state.trimEnd ?? undefined } : undefined,
      ...extraOps,
      nickname: (m.nickname || m.filename.replace(/\.\w+$/, "")) + " edit",
    };
    backdrop.classList.add("hidden");
    const res = await api.send("POST", `/api/media/${m.id}/edit`, ops);
    if (!res.jobId) { toast(res.error || "Edit failed to start"); return; }
    const job = await pollJob(res.jobId, label);
    if (job && onDone) onDone(job.mediaIds);
  }
  box.append(el("div", { class: "composer-footer" },
    el("button", {
      class: "btn", onclick: () => {
        if (!video.duration) { toast("Video still loading…"); return; }
        if (video.currentTime < 0.2 || video.currentTime > video.duration - 0.2) { toast("Scrub to the middle first — that's where it splits"); return; }
        submit({ splitAt: video.currentTime }, "Splitting clip");
      }
    }, "Split at playhead"),
    el("button", {
      class: "btn", onclick: () => {
        const c = document.createElement("canvas");
        c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext("2d").drawImage(video, 0, 0);
        c.toBlob(async blob => {
          const fd = new FormData();
          fd.append("file", blob, m.filename.replace(/\.\w+$/, "") + "_frame.jpg");
          fd.append("nickname", (m.nickname || m.filename) + " frame");
          await api.send("POST", "/api/media", fd);
          toast("Frame saved to Library ✓"); refresh();
        }, "image/jpeg", 0.92);
      }
    }, "Save frame as image"),
    el("div", { class: "spacer" }),
    el("button", { class: "btn", onclick: () => backdrop.classList.add("hidden") }, "Cancel"),
    el("button", { class: "btn primary", onclick: () => submit({}, "Editing clip") }, "Save edited clip"),
  ));
  backdrop.classList.remove("hidden");
}
function openImageStudio(m, onDone) {
  const backdrop = document.getElementById("editorBackdrop");
  const box = document.getElementById("editor");
  box.innerHTML = "";
  const state = { grade: {}, crop: null };
  box.append(el("h3", {}, `Edit: ${mediaLabel(m)}`),
    el("div", { class: "sub" }, "Crop and color grade. Saves as a NEW copy — your original stays safe."));
  const img = el("img", { src: mediaUrl(m), style: "max-width:100%;border-radius:12px;display:block" });
  box.append(img);

  const gradeBox = el("div", { class: "ed-section" }, el("div", { class: "mini-label" }, "Color grade (live preview)"));
  for (const [key, label] of GRADE_SLIDERS) {
    const val = el("span", { class: "hint", style: "min-width:34px;text-align:right" }, "0");
    const range = el("input", { type: "range", min: -100, max: 100, value: 0 });
    range.addEventListener("input", () => {
      state.grade[key] = Number(range.value);
      val.textContent = range.value;
      img.style.filter = cssPreviewFilter(state.grade);
    });
    gradeBox.append(el("div", { class: "ed-tools", style: "margin:6px 0" },
      el("span", { class: "hint", style: "min-width:78px" }, label), range, val));
  }
  box.append(gradeBox);
  const cropBox = el("div", { class: "ed-section" }, el("div", { class: "mini-label" }, "Crop"));
  const cropRow = el("div", { class: "ed-tools" });
  for (const [aspect, label] of CROP_PRESETS) {
    const b = el("button", {
      class: "btn small" + (aspect === null ? " active-crop" : ""), onclick: () => {
        state.crop = aspect;
        cropRow.querySelectorAll("button").forEach(x => x.classList.remove("active-crop"));
        b.classList.add("active-crop");
      }
    }, label);
    cropRow.append(b);
  }
  cropBox.append(cropRow);
  box.append(cropBox);
  box.append(el("div", { class: "composer-footer" },
    el("div", { class: "spacer" }),
    el("button", { class: "btn", onclick: () => backdrop.classList.add("hidden") }, "Cancel"),
    el("button", {
      class: "btn primary", onclick: async () => {
        const ops = {
          grade: Object.keys(state.grade).some(k => state.grade[k]) ? state.grade : undefined,
          crop: state.crop ? { aspect: state.crop } : undefined,
          nickname: (m.nickname || m.filename.replace(/\.\w+$/, "")) + " edit",
        };
        backdrop.classList.add("hidden");
        const res = await api.send("POST", `/api/media/${m.id}/edit`, ops);
        if (!res.jobId) { toast(res.error || "Edit failed to start"); return; }
        const job = await pollJob(res.jobId, "Editing photo");
        if (job && onDone) onDone(job.mediaIds);
      }
    }, "Save edited copy"),
  ));
  backdrop.classList.remove("hidden");
}
// ---------------------------------------------------------------- legacy editor (unused)
function openEditorLegacy(m) {
  const backdrop = document.getElementById("editorBackdrop");
  const box = document.getElementById("editor");
  box.innerHTML = "";
  if (m.type === "image") {
    box.append(el("h3", {}, `Edit: ${mediaLabel(m)}`),
      el("div", { class: "sub" }, "Crop to a platform size. Saves as a NEW copy — your original stays safe."));
    const img = new Image();
    img.src = mediaUrl(m);
    const canvas = el("canvas", {});
    const ctx = canvas.getContext("2d");
    let ratio = null; // null = original
    function draw() {
      if (!img.naturalWidth) return;
      let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
      if (ratio) {
        const target = ratio[0] / ratio[1];
        const current = sw / sh;
        if (current > target) { sw = sh * target; sx = (img.naturalWidth - sw) / 2; }
        else { sh = sw / target; sy = (img.naturalHeight - sh) / 2; }
      }
      canvas.width = sw; canvas.height = sh;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    }
    img.onload = draw;
    const tools = el("div", { class: "ed-tools" });
    for (const [label, r] of [["Original", null], ["Square 1:1 (feed)", [1, 1]], ["Portrait 4:5 (IG feed)", [4, 5]], ["Vertical 9:16 (story/reel/TikTok)", [9, 16]], ["Pin 2:3 (Pinterest)", [2, 3]]]) {
      tools.append(el("button", { class: "btn small", onclick: () => { ratio = r; draw(); } }, label));
    }
    box.append(tools, canvas,
      el("div", { class: "composer-footer" },
        el("div", { class: "spacer" }),

        el("button", { class: "btn", onclick: () => backdrop.classList.add("hidden") }, "Cancel"),
        el("button", {
          class: "btn primary", onclick: () => {
            canvas.toBlob(async blob => {
              const fd = new FormData();
              const suffix = ratio ? `${ratio[0]}x${ratio[1]}` : "copy";
              fd.append("file", blob, m.filename.replace(/\.\w+$/, "") + `_${suffix}.jpg`);
              fd.append("nickname", (m.nickname ? m.nickname + " " : "") + suffix);
              await api.send("POST", "/api/media", fd);
              backdrop.classList.add("hidden");
              toast("Cropped copy saved to Library ✓");
              refresh();
            }, "image/jpeg", 0.92);
          }
        }, "Save cropped copy")));
  } else if (m.type === "video") {
    box.append(el("h3", {}, `Grab a frame: ${mediaLabel(m)}`),
      el("div", { class: "sub" }, "Scrub to a frame and save it as an image — perfect for Pinterest pins or reference covers."));
    const video = el("video", { src: mediaUrl(m), muted: "", playsinline: "", crossorigin: "anonymous" });
    const range = el("input", { type: "range", min: 0, max: 1000, value: 0 });
    video.addEventListener("loadedmetadata", () => { range.max = Math.floor(video.duration * 1000); });
    range.addEventListener("input", () => { video.currentTime = range.value / 1000; });
    box.append(video, el("div", { class: "ed-tools" }, range),
      el("div", { class: "composer-footer" },
        el("div", { class: "spacer" }),
        el("button", { class: "btn", onclick: () => backdrop.classList.add("hidden") }, "Cancel"),
        el("button", {
          class: "btn primary", onclick: () => {
            const c = document.createElement("canvas");
            c.width = video.videoWidth; c.height = video.videoHeight;
            c.getContext("2d").drawImage(video, 0, 0);
            c.toBlob(async blob => {
              const fd = new FormData();
              fd.append("file", blob, m.filename.replace(/\.\w+$/, "") + "_frame.jpg");
              fd.append("nickname", (m.nickname || m.filename) + " frame");
              await api.send("POST", "/api/media", fd);
              backdrop.classList.add("hidden");
              toast("Frame saved to Library ✓");
              refresh();
            }, "image/jpeg", 0.92);
          }
        }, "Save frame as image")));
  }
  backdrop.classList.remove("hidden");
}
// ---------------------------------------------------------------- boot
document.querySelectorAll(".tab").forEach(t =>
  t.addEventListener("click", () => { state.view = t.dataset.view; render(); }));
document.getElementById("newPostBtn").addEventListener("click", () => openComposer(null, new Date()));
document.getElementById("composerBackdrop").addEventListener("click", e => {
  if (e.target.id === "composerBackdrop") closeComposer();
});
document.getElementById("pickerBackdrop").addEventListener("click", e => {
  if (e.target.id === "pickerBackdrop") closePicker();
});
document.getElementById("editorBackdrop").addEventListener("click", e => {
  if (e.target.id === "editorBackdrop") e.target.classList.add("hidden");
});
refresh();
setInterval(async () => {
  // background refresh keeps statuses live without stomping open modals
  if (!state.biz || document.querySelector(".modal-backdrop:not(.hidden)")) return;
  [state.posts, state.media] = await Promise.all([api.get("/api/posts"), api.get("/api/media")]);
  render();
}, 30000);
