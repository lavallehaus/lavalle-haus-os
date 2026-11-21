/* Virtual Wardrobe
 * Self-contained module: Closet → Changing Room → Planned Outfits.
 * Data lives in IndexedDB ("virtual-wardrobe": items, outfits, poses). See README.md for the data model.
 */
'use strict';

/* ---------------- config ---------------- */
const CATEGORIES = [
  { id: 'tops', label: 'Tops' },
  { id: 'bottoms', label: 'Pants & Jeans' },
  { id: 'skirts', label: 'Skirts' },
  { id: 'shorts', label: 'Shorts' },
  { id: 'dresses', label: 'Dresses' },
  { id: 'sets', label: 'Sets' },
  { id: 'outerwear', label: 'Outerwear' },
  { id: 'shoes', label: 'Shoes' },
  { id: 'bags', label: 'Bags' },
  { id: 'accessories', label: 'Accessories' },
];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// Where a piece lands on the body when first tried on (center x/y and width, all % of the figure box)
const PLACEMENT = {
  tops: { x: 50, y: 33, w: 56, z: 4 },
  bottoms: { x: 50, y: 67, w: 50, z: 2 },
  shorts: { x: 50, y: 56, w: 46, z: 2 },
  skirts: { x: 50, y: 60, w: 54, z: 2 },
  dresses: { x: 50, y: 47, w: 62, z: 3 },
  sets: { x: 50, y: 50, w: 64, z: 3 },
  outerwear: { x: 50, y: 37, w: 72, z: 6 },
  shoes: { x: 50, y: 94, w: 40, z: 1 },
  bags: { x: 76, y: 56, w: 30, z: 7 },
  accessories: { x: 50, y: 15, w: 24, z: 8 },
};
const AI_CUTOUT_URL = 'https://esm.sh/@imgly/background-removal@1.4.5';

const SILHOUETTE = `<svg class="pose silhouette" viewBox="0 0 300 500" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg"><g fill="#ebe6df"><circle cx="150" cy="50" r="29"/><rect x="140" y="74" width="20" height="24" rx="8"/><path d="M100 106 Q150 90 200 106 L212 190 Q204 226 195 250 L203 300 L97 300 L105 250 Q96 226 88 190 Z"/><path d="M88 110 Q73 118 69 148 L59 250 Q57 263 65 265 Q73 265 75 252 L93 160 Z"/><path d="M212 110 Q227 118 231 148 L241 250 Q243 263 235 265 Q227 265 225 252 L207 160 Z"/><path d="M98 296 L147 296 L141 482 Q139 494 128 494 Q118 494 118 482 Z"/><path d="M153 296 L202 296 L182 482 Q180 494 171 494 Q160 494 159 482 Z"/></g></svg>`;

/* ---------------- tiny helpers ---------------- */
// Embedded in the OS app: /api/data is locked, and the house sign-in token sits
// in this origin's localStorage, so every call to it carries that token.
const api = (path, opts = {}) => fetch(path, { ...opts, headers: { ...(opts.headers || {}), 'x-app-token': (() => { try { return localStorage.getItem('lh_token') || ''; } catch { return ''; } })() } });
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clone = (o) => JSON.parse(JSON.stringify(o));
const catLabel = (id) => (CATEGORIES.find((c) => c.id === id) || { label: id }).label;
/* ---------- people: Kiaredza & Kiabeth (both admins, full access to everything) ---------- */
const PEOPLE = [{ id: 'kiaredza', name: 'Kiaredza' }, { id: 'kiabeth', name: 'Kiabeth' }];
const personName = (id) => id === 'together' ? 'Together' : (PEOPLE.find((p) => p.id === id) || PEOPLE[0]).name;
const ownerOf = (x) => x?.owner || 'kiaredza'; // everything made before profiles belongs to Kiaredza
let ME = 'kiaredza';
// each person keeps their own session (picks, what's on, try-on photo); everything else is shared
const PER_PERSON = new Set(['vw.room', 'vw.selected', 'vw.tryon', 'vw.view', 'vw.inBoots', 'vw.coat', 'vw.whose']);
const skey = (k) => PER_PERSON.has(k) && ME !== 'kiaredza' ? `${k}@${ME}` : k;
const store = {
  get(k, d) { try { const v = localStorage.getItem(skey(k)); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(skey(k), JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Copied');
}
function extractUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0].replace(/[),.]+$/, '') : String(text || '').trim();
}

/* ---------------- IndexedDB ---------------- */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('virtual-wardrobe', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      ['items', 'outfits', 'poses'].forEach((s) => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = async (name, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(name, mode); const req = fn(t.objectStore(name));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    all: (s) => run(s, 'readonly', (st) => st.getAll()),
    put: (s, v) => run(s, 'readwrite', (st) => st.put(v)),
    del: (s, id) => run(s, 'readwrite', (st) => st.delete(id)),
  };
})();

/* ---------------- image tools ---------------- */
const loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const fileToDataURL = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });

async function downscale(src, max = 1400) {
  const img = await loadImage(src);
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return src.startsWith('data:image/png') ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
}
async function cropImage(src, r) {
  const img = await loadImage(src);
  const c = document.createElement('canvas'); c.width = Math.round(r.w); c.height = Math.round(r.h);
  c.getContext('2d').drawImage(img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return src.startsWith('data:image/png') ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
}
// Trim fully transparent edges so placement on the body is tight.
// Crop to just you (ignores see-through and near-white areas), small margin.
async function trimToBody(src) {
  const img = await loadImage(src); const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  const p = x.getImageData(0, 0, W, H).data; let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y += 2) for (let i = 0; i < W; i += 2) { const k = (y * W + i) * 4; if (p[k + 3] > 20 && (p[k] < 236 || p[k + 1] < 236 || p[k + 2] < 236)) { if (i < minX) minX = i; if (i > maxX) maxX = i; if (y < minY) minY = y; if (y > maxY) maxY = y; } }
  if (maxX < 0) return src;
  const m = Math.round((maxY - minY) * 0.03); minX = Math.max(0, minX - m); minY = Math.max(0, minY - m); maxX = Math.min(W - 1, maxX + m); maxY = Math.min(H - 1, maxY + m);
  const o = document.createElement('canvas'); o.width = maxX - minX + 1; o.height = maxY - minY + 1; o.getContext('2d').drawImage(c, minX, minY, o.width, o.height, 0, 0, o.width, o.height);
  return o.toDataURL('image/png');
}
// Photo taken from above makes lower legs + feet look tiny. Widen and lengthen them a little (perspective fix).
// true when the photo is cut out (see-through or plain white around you) - our body/face fixes only work then
async function plainBg(src) {
  const img = await loadImage(src); const W = 200, H = Math.round(200 * img.naturalHeight / img.naturalWidth);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, W, H);
  const p = x.getImageData(0, 0, W, H).data; let ok = 0, n = 0;
  const chk = (i, j) => { const k = (j * W + i) * 4; n++; if (p[k + 3] < 30 || (p[k] > 225 && p[k + 1] > 225 && p[k + 2] > 225)) ok++; };
  for (let i = 0; i < W; i++) { chk(i, 0); chk(i, 1); } for (let j = 0; j < H * 0.5; j++) { chk(0, j); chk(W - 1, j); }
  return ok / n > 0.85;
}
async function legFix(src, amt = 0.3, grow = 0.06) {
  const img = await loadImage(src); const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(img, 0, 0);
  const p = x.getImageData(0, 0, W, H).data; const fg = (i) => p[i] < 235 || p[i + 1] < 235 || p[i + 2] < 235;
  let top = -1, bot = -1;
  for (let y = 0; y < H; y++) { let n = 0; for (let i = 0; i < W; i += 2) if (fg((y * W + i) * 4)) n++; if (n > 3) { if (top < 0) top = y; bot = y; } }
  if (top < 0 || bot - top < 300) return src;
  const bh = bot - top, y0 = Math.round(top + bh * 0.6);
  const xs = []; for (let y = y0; y < y0 + 10; y++) for (let i = 0; i < W; i++) if (fg((y * W + i) * 4)) xs.push(i);
  if (!xs.length) return src;
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, L = bot - y0, NL = Math.round(L * (1 + grow));
  const o = document.createElement('canvas'); o.width = W; o.height = H + NL - L; const ox = o.getContext('2d');
  ox.fillStyle = '#fff'; ox.fillRect(0, 0, o.width, o.height); ox.drawImage(c, 0, 0, W, y0, 0, 0, W, y0);
  for (let k = 0; k < NL; k++) { const t = k / NL, f = 1 + amt * Math.pow(t, 1.3); ox.drawImage(c, 0, y0 + t * L, W, 1, cx - cx * f, y0 + k, W * f, 1.5); }
  return o.toDataURL('image/png');
}
// Keep only you (the biggest solid shape) and crop tight, so you fill the frame and leftover haze disappears.
async function keepSubject(src) {
  const img = await loadImage(src); const W = img.naturalWidth, H = img.naturalHeight, N = W * H;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H), p = d.data;
  // wipe edge strips (rows/columns that are mostly flat white across the picture) so they don't glue onto you
  const wht = (k) => p[k * 4 + 3] > 100 && p[k * 4] > 225 && p[k * 4 + 1] > 225 && p[k * 4 + 2] > 225;
  for (let j = 0; j < H; j++) { let n = 0; for (let i = 0; i < W; i++) if (wht(j * W + i)) n++; if (n > W * 0.6) for (let i = 0; i < W; i++) p[(j * W + i) * 4 + 3] = 0; }
  for (let i = 0; i < W; i++) { let n = 0; for (let j = 0; j < H; j++) if (wht(j * W + i)) n++; if (n > H * 0.6) for (let j = 0; j < H; j++) p[(j * W + i) * 4 + 3] = 0; }
  const lab = new Int32Array(N), st = new Int32Array(N); let id = 0, best = 0, bestN = 0;
  const on = (k) => p[k * 4 + 3] > 100;
  for (let k0 = 0; k0 < N; k0++) {
    if (lab[k0] || !on(k0)) continue; id++; let sp = 0, n = 0; lab[k0] = id; st[sp++] = k0;
    while (sp) { const k = st[--sp]; n++; const xk = k % W; for (const m of [xk > 0 ? k - 1 : -1, xk < W - 1 ? k + 1 : -1, k - W, k + W]) if (m >= 0 && m < N && !lab[m] && on(m)) { lab[m] = id; st[sp++] = m; } }
    if (n > bestN) { bestN = n; best = id; }
  }
  if (!best || bestN < N * 0.03) return src;
  // keep you + soft edges right next to you; clear everything else
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let k = 0; k < N; k++) {
    if (lab[k] === best) { const i = k % W, j = (k / W) | 0; if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; continue; }
    if (lab[k] === 0 && p[k * 4 + 3] > 0) { const xk = k % W; const nb = (xk > 0 && lab[k - 1] === best) || (xk < W - 1 && lab[k + 1] === best) || (k >= W && lab[k - W] === best) || (k + W < N && lab[k + W] === best); if (nb) continue; }
    p[k * 4 + 3] = 0;
  }
  x.putImageData(d, 0, 0);
  const m = Math.round((y1 - y0) * 0.02); x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(W - 1, x1 + m); y1 = Math.min(H - 1, y1 + m);
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1; o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o.toDataURL('image/png');
}
async function trimTransparent(src) {
  const img = await loadImage(src);
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  const p = x.getImageData(0, 0, W, H).data;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
    if (p[(y * W + i) * 4 + 3] > 12) { if (i < minX) minX = i; if (i > maxX) maxX = i; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return src;
  const pad = 4;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(W - 1, maxX + pad); maxY = Math.min(H - 1, maxY + pad);
  const o = document.createElement('canvas'); o.width = maxX - minX + 1; o.height = maxY - minY + 1;
  o.getContext('2d').drawImage(c, minX, minY, o.width, o.height, 0, 0, o.width, o.height);
  return o.toDataURL('image/png');
}
// Quick cutout: flood-fills the plain background in from the edges (great for white product shots).
// White try-on backgrounds: use a tight cut so white clothes (sleeves) aren't cut away with the background.
async function tryonCut(src) {
  const img = await loadImage(src); const c = document.createElement('canvas'); c.width = 8; c.height = 8;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight * 0.02, 0, 0, 8, 8);
  const d = x.getImageData(0, 0, 8, 8).data; let mn = 255; for (let i = 0; i < d.length; i += 4) mn = Math.min(mn, d[i], d[i + 1], d[i + 2]);
  return removePlainBackground(src, mn >= 246 ? 10 : 34);
}
async function removePlainBackground(src, tol = 30) {
  const img = await loadImage(src);
  const W = img.naturalWidth, H = img.naturalHeight, N = W * H;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H); const p = d.data;
  const border = [];
  for (let i = 0; i < W; i++) border.push(i, (H - 1) * W + i);
  for (let j = 0; j < H; j++) border.push(j * W, j * W + W - 1);
  const med = (a) => a.sort((m, n) => m - n)[a.length >> 1];
  const R = med(border.map((k) => p[k * 4])), G = med(border.map((k) => p[k * 4 + 1])), B = med(border.map((k) => p[k * 4 + 2]));
  const dist = (k) => { const o = k * 4; return Math.max(Math.abs(p[o] - R), Math.abs(p[o + 1] - G), Math.abs(p[o + 2] - B)); };
  const mask = new Uint8Array(N); const stack = new Int32Array(N); let sp = 0;
  for (const k of border) if (!mask[k] && dist(k) <= tol) { mask[k] = 1; stack[sp++] = k; }
  while (sp) {
    const k = stack[--sp]; const xk = k % W;
    const nb = [xk > 0 ? k - 1 : -1, xk < W - 1 ? k + 1 : -1, k - W, k + W];
    for (const n of nb) { if (n < 0 || n >= N || mask[n]) continue; if (dist(n) <= tol) { mask[n] = 1; stack[sp++] = n; } }
  }
  for (let k = 0; k < N; k++) {
    if (mask[k]) { p[k * 4 + 3] = 0; continue; }
    const xk = k % W;
    const edge = (xk > 0 && mask[k - 1]) || (xk < W - 1 && mask[k + 1]) || (k >= W && mask[k - W]) || (k + W < N && mask[k + W]);
    if (edge && dist(k) < tol * 2.2) p[k * 4 + 3] = 140;
  }
  x.putImageData(d, 0, 0);
  return trimTransparent(c.toDataURL('image/png'));
}
// AI cutout (in-browser model). Falls back to the quick cutout if it can't load.
async function aiCutout(src) {
  try {
    const mod = await import(AI_CUTOUT_URL);
    const fn = mod.removeBackground || mod.default;
    const blob = await (await fetch(src)).blob();
    const out = await fn(blob);
    return trimTransparent(await fileToDataURL(out));
  } catch (e) {
    console.warn('AI cutout unavailable, using quick cutout', e);
    toast('AI cutout unavailable here — used quick cutout instead', 3200);
    return removePlainBackground(src);
  }
}

/* ---------------- state ---------------- */
const state = {
  items: [], outfits: [], poses: [],
  view: store.get('vw.view', 'closet'),
  cat: 'all', status: 'all', planFilter: 'all', whose: 'kiaredza', source: 'tiktok',
  togMode: store.get('vw.togMode', 'side'), stops: null, pins: store.get('vw.shootPins', {}),
  shared: [], hand: [],
  selected: new Set(store.get('vw.selected', [])),
  room: store.get('vw.room', null) || { poseId: null, layers: [], active: null, editingId: null },
  queue: [], queueTotal: 0,
};
const saveUI = () => { store.set('vw.view', state.view); store.set('vw.selected', [...state.selected]); store.set('vw.room', state.room); };
const getItem = (id) => state.items.find((i) => i.id === id);
const getLayer = (u) => state.room.layers.find((l) => l.uid === u);

/* ---------------- navigation ---------------- */
function go(view) {
  state.view = view; saveUI();
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('on', v.id === 'view-' + view));
  if (view === 'closet') renderCloset();
  if (view === 'room') renderRoom();
  if (view === 'planned') renderPlanned();
  renderTray();
  window.scrollTo({ top: 0 });
}

/* ================= CLOSET ================= */
const CART_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2"/></svg>`;
const inTikTokCart = (it) => it.status === 'cart' && !it.outOfCart && (it.inCart || /^(cart|sync)/.test(it.importKey || ''));
const isPurchased = (it) => it.status === 'owned' || it.status === 'coming';
const priceNum = (it) => { const m = String(it.price || '').replace(/,/g, '').match(/\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; };
const money = (n) => '$' + n.toFixed(2);
// Each piece counts once, even if it's in several outfits or layered twice.
const uniqItems = (its) => [...new Map(its.filter(Boolean).map((it) => [it.id, it])).values()];
const sumPrice = (its) => uniqItems(its).reduce((t, it) => t + priceNum(it), 0);
function priceHtml(it) {
  if (!priceNum(it)) return '';
  const was = String(it.priceWas || '');
  return `<span class="price">${esc(money(priceNum(it)))}${was ? ` <s>${esc(was)}</s>` : ''}</span>`;
}
function cardTags(it) {
  const t = [];
  if (it.source === 'fold') t.push('<span class="sticker fold">The Fold</span>');
  else if (isPurchased(it)) t.push('<span class="sticker green">Purchased</span>');
  else if (inTikTokCart(it)) t.push(`<span class="incart" title="${it.inCart ? 'In cart · ticked to check out' : 'In your TikTok cart'}">${CART_SVG}In cart${it.inCart ? '<b>✓</b>' : ''}</span>`);
  else if (it.status === 'cart' && it.outOfCart) t.push('<span class="sticker">Not in cart anymore</span>');
  else if (it.status === 'cart') t.push('<span class="sticker">Favorited for later</span>');
  if (it.soldOut) t.push('<span class="sticker red">Sold out</span>');
  return t.length ? `<div class="tags">${t.join('')}</div>` : '';
}
function pieceCard(it) {
  const sel = state.selected.has(it.id);
  return `<div class="piece ${sel ? 'sel' : ''}" data-id="${it.id}">
    <div class="piece-img">
      <img src="${it.image}" alt="" loading="lazy" draggable="false">
      <span class="check">✓</span>
      ${it.link ? `<button class="copy-link" data-copylink="${it.id}" title="Copy TikTok Shop link">🔗 Link</button>` : ''}
      ${it.status === 'coming' ? '<span class="pill">On the way</span>' : ''}
      ${cardTags(it)}
      ${it.status === 'cart' ? `<button class="x-btn" data-skip="${it.id}" title="Not getting this">✕</button>` : ''}
    </div>
    <div class="piece-meta">
      <div class="piece-name ${it.name ? '' : 'untitled'}">${esc(it.name || 'Untitled piece')}</div>
      <button class="link-btn" data-edit="${it.id}">Edit</button>
    </div>
    ${priceHtml(it)}
  </div>`;
}
function updSelAll() {
  const sa = $('#selectAll'); if (!sa) return; const vis = state.visible || [];
  const all = vis.length && vis.every((id) => state.selected.has(id));
  sa.textContent = all ? `Unselect all (${vis.length})` : `Select all (${vis.length})`; sa.disabled = !vis.length;
}
function renderWhose() {
  const show = state.view === 'closet' || state.view === 'planned';
  $$('.whose-tabs').forEach((el) => {
    el.hidden = !show;
    el.innerHTML = [...PEOPLE.map((p) => ({ id: p.id, label: `${p.name}'s` })), { id: 'together', label: 'Together' }]
      .map((t) => `<button class="${state.whose === t.id ? 'on' : ''}" data-whose="${t.id}">${t.label}${t.id === ME ? ' <small>(you)</small>' : ''}</button>`).join('');
  });
}
const inWhose = (x) => state.whose === 'together' || x.source === 'fold' || ownerOf(x) === state.whose; // The Fold pieces are shared by both
const isFold = (it) => it.source === 'fold';

/* ---------- the shared closet: both sisters' synced pieces, and handoffs ----------
Her ask Nov 20 2026: each of us syncs our own TikTok instead of adding
screenshots, and when a piece turns out to be the other's, hand it over — she
gets a card on the board and the piece only moves when she takes it. These
pieces live on the server (op=wardrobe_pieces), keyed by owner, images kept as
TikTok URLs so the app never fills up. */
const OTHER = (w) => (w === 'kiabeth' ? 'kiaredza' : 'kiabeth');
function guessCat(n) {
  const t = String(n || '');
  if (/jewel|earring|necklace|bracelet|ring\b|cuff/i.test(t)) return 'accessories';
  if (/dress(?!er)/i.test(t)) return 'dresses';
  if (/skirt/i.test(t)) return 'skirts';
  if (/short\b|shorts/i.test(t)) return 'shorts';
  if (/pant|jean|trouser|legging|bottom/i.test(t)) return 'bottoms';
  if (/jacket|coat|blazer|trench|puffer|outer/i.test(t)) return 'outerwear';
  if (/\bset\b|two-piece|2 piece|matching/i.test(t)) return 'sets';
  if (/shoe|boot|heel|sandal|sneaker|loafer|flat\b/i.test(t)) return 'shoes';
  if (/bag|tote|clutch|purse|backpack/i.test(t)) return 'bags';
  return 'tops';
}
async function loadShared() {
  try {
    const r = await api('/api/data?op=wardrobe_pieces', { cache: 'no-store' });
    const j = await r.json(); if (!r.ok) return;
    state.shared = (j.items || []).map((x) => ({ ...x, shared: true }));
    state.hand = j.transfers || [];
  } catch (e) { console.warn('shared closet', e); }
}
const myHandoffs = () => (state.hand || []).filter((t) => t.state === 'pending' && t.to === ME);
const sentHandoffs = () => (state.hand || []).filter((t) => t.state === 'pending' && t.from === ME);
const sharedOf = (id) => (state.shared || []).find((x) => x.id === id);
function handBanner() {
  const mine = myHandoffs(), sent = sentHandoffs();
  if (!mine.length && !sent.length) return '';
  const row = (t, incoming) => {
    const it = sharedOf(t.itemId) || {};
    return `<div class="hand-row">
      ${it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy">` : '<span class="hand-no"></span>'}
      <div><b>${esc(it.name || 'A piece')}</b><small>${incoming ? `${esc(personName(t.from))} thinks this one is yours` : `Waiting on ${esc(personName(t.to))}`}${it.price ? ' · ' + esc(it.price) : ''}</small></div>
      ${incoming ? `<div class="hand-act"><button class="primary small" data-hand="${t.id}" data-do="accept">Take it</button><button class="ghost small" data-hand="${t.id}" data-do="decline">Not mine</button></div>` : ''}
    </div>`;
  };
  return `<section class="hand-box"><h2>Handoffs</h2>${mine.map((t) => row(t, true)).join('')}${sent.map((t) => row(t, false)).join('')}</section>`;
}
function syncCard(it) {
  const mineNow = it.owner === ME;
  const pend = (state.hand || []).some((t) => t.itemId === it.id && t.state === 'pending');
  return `<div class="piece synced">
    <div class="piece-img"><img src="${esc(it.image)}" alt="" loading="lazy" draggable="false">
      ${it.status === 'cart' ? '<span class="sticker">In cart</span>' : '<span class="sticker green">Bought</span>'}
      ${state.whose === 'together' ? `<span class="pill owner">${esc(personName(it.owner))}</span>` : ''}
    </div>
    <div class="piece-meta"><div class="piece-name">${esc(it.name || 'Untitled piece')}</div>
      ${it.link ? `<button class="link-btn" data-copy="${esc(it.link)}">Copy link</button>` : ''}</div>
    ${it.price ? `<span class="price">${esc(it.price)}</span>` : ''}
    ${pend ? '<div class="sync-note">Waiting on her</div>'
      : mineNow ? `<button class="link-btn send" data-send="${it.id}">Send to ${esc(personName(OTHER(ME)))} →</button>`
      : `<div class="sync-note">${esc(personName(it.owner))}'s</div>`}
  </div>`;
}
function renderSynced() {
  const grid = $('#closetGrid');
  const mine = (state.shared || []).filter((i) => state.whose === 'together' || i.owner === state.whose);
  const head = `<div class="sync-head"><div><small>Synced from TikTok Shop</small><b>${mine.length} piece${mine.length === 1 ? '' : 's'}${state.whose === 'together' ? '' : ' · ' + esc(personName(state.whose))}</b></div>
    <p>Each of you syncs her own TikTok. What you sync lands in your closet; if a piece is really hers, send it over and she takes it from her side.</p>
    <button class="primary small" data-syncsetup>Sync my TikTok</button></div>`;
  if (!mine.length) { grid.innerHTML = handBanner() + head + `<div class="empty"><h3>Nothing synced yet</h3><p>Tap “Sync my TikTok” for the one-time setup, then one click on your TikTok cart or orders page brings everything in.</p></div>`; return; }
  const cats = CATEGORIES.filter((c) => mine.some((i) => i.category === c.id));
  grid.innerHTML = handBanner() + head + cats.map((c) => {
    const its = mine.filter((i) => i.category === c.id);
    return `<section class="cat-section"><h2 class="cat-title">${c.label}<small>${its.length} piece${its.length === 1 ? '' : 's'}</small></h2>
      <div class="grid">${its.map(syncCard).join('')}</div></section>`;
  }).join('');
}
// One click on her own TikTok page. It has to run there (the shop blocks reads
// from anywhere else), so it is a bookmark she drags over once.
const SYNC_BM = "javascript:(function(){var ORD=/order/i.test(location.href);var R=[],SN={},SS={};" +
  "function M(t){var m=String(t).replace(/\\s+/g,'').match(/\\$\\s?([\\d,]+\\.?\\d{0,2})/);return m?'$'+m[1]:''}" +
  "function L(b){return b.innerText.split('\\n').map(function(s){return s.trim()}).filter(Boolean)}" +
  // The cart prints a price on every row; the orders list prints none, only the
  // shop, the order date and a delivery line. So each page needs its own anchor.
  "function OK(t){return ORD?/ordered on|delivered|shipped|arriv|in transit|out for/i.test(t):t.indexOf('$')>-1}" +
  "function D(t){var m=t.match(/Ordered on ([A-Za-z]{3,9} ?\\d{1,2})/i);return m?m[1]:''}" +
  // The order card's first line reads "Pacsun | Ordered on Nov 4" as one line.
  "function SH(t){return String(t||'').split('|')[0].replace(/ordered on.*/i,'').replace(/[\\s\\u00b7|]+$/,'').trim()}" +
  "Array.prototype.forEach.call(document.querySelectorAll('img'),function(g){var src=(g.currentSrc||g.src||'').split('?')[0];" +
  "if(!/oec-general|\\/tos-/.test(src)||/static\\/image|tiktok-web-common|-avt-/.test(src)||g.naturalWidth<80||SS[src])return;" +
  "var el=g,box=null;for(var i=0;i<10&&el;i++){el=el.parentElement;if(el&&el.innerText&&el.innerText.length>20&&OK(el.innerText)){box=el;break}}" +
  "if(!box)return;var txt=L(box);var nm=(g.alt||'').trim();" +
  "if(nm.length<12){nm=txt.filter(function(s){return s.length>18&&s.charAt(0)!=='$'&&!/sold$|ordered on|delivered|view order|arrived at|^your order|place your|in transit|out for deliv/i.test(s)}).sort(function(a,b){return b.length-a.length})[0]||''}" +
  // An order row often carries no product title at all, so fall back to the shop
  // and the date she bought it. She can rename it in the closet.
  "var fb=false;if(!nm&&ORD){var d=D(box.innerText);nm=(SH(txt[0])||'TikTok order')+(d?' \\u00b7 ordered '+d:'');fb=true}" +
  // A real product title appears once per piece, so repeats are the same thing
  // photographed twice. A fallback name repeats across a shop's whole order, so
  // those are told apart by their photo instead.
  "if(!nm)return;if(fb){SS[src]=1}else{if(SN[nm])return;SN[nm]=1;SS[src]=1}" +
  "var a=Array.prototype.map.call(box.querySelectorAll('a[href]'),function(x){return x.href}).filter(function(h){return /pdp|product|\\/view\\//.test(h)})[0]||'';" +
  "R.push({key:src,name:nm.slice(0,160),price:M(box.innerText),link:a.split('?')[0],image:src,shop:ORD?SH(txt[0]).slice(0,60):'',ordered:D(box.innerText),variant:(txt.filter(function(s){return /^Color|, ?[SMLX]+$/i.test(s)})[0]||''),status:ORD?'owned':'cart'})});" +
  "if(!R.length){alert('Nothing to read here \\u2014 open your TikTok Shop orders or your cart, scroll to the bottom so every row has loaded, then click this again.');return}" +
  // Safari blocks a popup opened from a bookmarklet, so fall back to this tab.
  "var u='https://lavalle-haus-os.vercel.app/wardrobe/#sync='+encodeURIComponent(JSON.stringify(R));var w=null;try{w=window.open(u,'_blank')}catch(e){};if(!w)location.href=u})()";
function openSyncSetup() {
  let el = $('#syncSetup');
  if (!el) { el = document.createElement('div'); el.id = 'syncSetup'; el.className = 'zoom-view sync-help';
    (document.getElementById('vw-app') || document.body).appendChild(el);
    el.onclick = (e) => { if (e.target === el || e.target.closest('[data-close]')) el.hidden = true; }; }
  el.innerHTML = `<div class="sync-card">
    <h3>Sync your own TikTok</h3>
    <p>It reads the page you are on and files everything to <b>${esc(personName(ME))}</b>. Set it up <b>in the browser your TikTok is signed in to</b> — your orders only show where that session lives, which for Kiabeth is Safari.</p>
    <ol>
      <li>Show the bookmarks bar there once. <b>Safari:</b> View → Show Favorites Bar. <b>Chrome:</b> ⌘⇧B.</li>
      <li>Drag this up onto it: <a class="bm" href="${esc(SYNC_BM)}" onclick="return false">🛍 Sync Wardrobe</a></li>
      <li>In that same browser open your <a href="https://shop.tiktok.com/web/order_list" target="_blank" rel="noopener">TikTok orders</a> (or your <a href="https://shop.tiktok.com/web/cart" target="_blank" rel="noopener">cart</a>), scroll to the bottom so every row has loaded, and click the bookmark.</li>
      <li>It brings you here. Pick your name and the pieces file themselves.</li>
    </ol>
    <p class="muted">Orders come in as bought, cart items as in cart. An order row only prints the shop and the date, so those pieces arrive named that way — tap the name in your closet to call it what it is. Kiaredza does the same in whichever browser her TikTok is in, and hers land in her closet. Copy the bookmark to both browsers if you shop in both.</p>
    <div class="sync-btns"><button class="ghost small" data-close>Done</button></div>
  </div>`;
  el.hidden = false;
}
// The bookmark opens the app in a fresh tab, so the rows usually arrive before
// anyone has picked who they are. Hold them until she signs in — they are filed
// to whoever that is.
let SIGNED = false;
function receiveSync() {
  const h = location.hash; if (!h.startsWith('#sync=')) return;
  history.replaceState(null, '', location.pathname);
  let rows; try { rows = JSON.parse(decodeURIComponent(h.slice(6))); } catch { return toast('Couldn\'t read that sync — click the bookmark again', 5000); }
  if (!Array.isArray(rows) || !rows.length) return;
  if (!SIGNED) { state.pendingSync = rows; return toast(`${rows.length} pieces ready — pick who you are first`, 6000); }
  return applySync(rows);
}
async function applySync(rows) {
  toast(`Filing ${rows.length} piece${rows.length === 1 ? '' : 's'} to ${personName(ME)}…`, 30000);
  try {
    const r = await api('/api/data?op=wardrobe_pieces_put', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person: ME, source: 'tiktok', rows: rows.map((x) => ({ ...x, category: guessCat(x.name) })) }) });
    const o = await r.json(); if (!r.ok) throw new Error(o.error || 'sync failed');
    await loadShared(); state.source = 'synced'; go('closet');
    toast(`${o.added} new · ${o.updated} updated in ${personName(ME)}'s closet ✨`, 5000);
  } catch (e) { toast('Sync didn\'t work: ' + e.message, 6000); }
}
async function sendPiece(id) {
  const it = sharedOf(id); if (!it) return;
  const to = OTHER(ME);
  if (!confirm(`Send “${it.name || 'this piece'}” to ${personName(to)}?\n\nIt stays in your closet until she takes it.`)) return;
  try {
    const r = await api('/api/data?op=wardrobe_handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: id, to }) });
    const o = await r.json(); if (!r.ok) throw new Error(o.error || 'could not send');
    await loadShared(); refresh();
    toast(`Sent to ${personName(to)}${o.carded ? ' — a card is waiting on her board' : ''} ✓`, 5000);
  } catch (e) { toast(e.message, 5000); }
}
async function actHandoff(id, action) {
  try {
    const r = await api('/api/data?op=wardrobe_handoff_act', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) });
    const o = await r.json(); if (!r.ok) throw new Error(o.error || 'could not do that');
    await loadShared(); refresh();
    toast(action === 'accept' ? 'In your closet now ✓' : 'Passed back', 3500);
  } catch (e) { toast(e.message, 5000); }
}

function renderCloset() {
  renderWhose();
  const all = state.items.filter((i) => !i.skipped && inWhose(i));
  const foldN = all.filter(isFold).length;
  const items = all.filter((i) => (state.source === 'fold') === isFold(i));
  const counts = { all: items.length };
  CATEGORIES.forEach((c) => (counts[c.id] = items.filter((i) => i.category === c.id).length));
  const srcBtn = (id, label, n) => `<button class="chip src-chip ${state.source === id && state.cat === 'all' ? 'on' : ''} ${state.source === id ? 'src-on' : ''}" data-source="${id}">${label}<span>${n}</span></button>`;
  const syncN = (state.shared || []).filter((i) => state.whose === 'together' || i.owner === state.whose).length;
  $('#catTabs').innerHTML = srcBtn('tiktok', 'TikTok Shop · All', all.length - foldN) + srcBtn('fold', 'The Fold · All', foldN)
    + srcBtn('synced', 'Synced · ' + (state.whose === 'together' ? 'Both' : 'Mine'), syncN)
    + (myHandoffs().length ? `<button class="chip hand-chip ${state.source === 'synced' ? 'on' : ''}" data-source="synced">Handoffs<span>${myHandoffs().length}</span></button>` : '')
    + '<span class="chip-sep"></span>'
    + CATEGORIES.filter((c) => counts[c.id] || state.cat === c.id)
      .map((c) => `<button class="chip ${state.cat === c.id ? 'on' : ''}" data-cat="${c.id}">${c.label}<span>${counts[c.id] || 0}</span></button>`).join('');
  $$('#statusSeg button').forEach((b) => b.classList.toggle('on', b.dataset.status === state.status));
  $('#statusSeg').hidden = state.source !== 'tiktok';

  const grid = $('#closetGrid');
  if (state.source === 'synced') { state.visible = []; updSelAll(); return renderSynced(); }
  if (!items.length && state.source === 'fold') { grid.innerHTML = `<div class="empty"><h3>No pieces from The Fold yet</h3><p>Tap ↻ Refresh to pull them in from thefoldlabel.com.</p></div>`; state.visible = []; updSelAll(); return; }
  if (!items.length) {
    grid.innerHTML = `<div class="empty"><h3>Your closet is empty</h3>
      <p>Add screenshots of what you bought on TikTok Shop and what's on the way. You can crop each one and remove the background so it fits on you in the changing room.</p>
      <label class="primary file-btn">+ Add pieces<input type="file" accept="image/*" multiple hidden data-upload-items></label></div>`;
    return;
  }
  const st = state.source === 'fold' ? 'all' : state.status;
  const list = items.filter((i) => (state.cat === 'all' || i.category === state.cat) && (st === 'all' || (state.status === 'incart' ? inTikTokCart(i) : state.status === 'cart' ? (i.status === 'cart' && !inTikTokCart(i)) : state.status === 'soldout' ? !!i.soldOut : state.status === 'owned' ? isPurchased(i) : i.status === state.status)));
  state.visible = list.map((i) => i.id);
  updSelAll();
  if (!list.length) { grid.innerHTML = `<div class="empty"><h3>Nothing here yet</h3><p>No pieces match this filter.</p></div>`; return; }
  const cats = state.cat === 'all' ? CATEGORIES.filter((c) => list.some((i) => i.category === c.id)) : [CATEGORIES.find((c) => c.id === state.cat)];
  grid.innerHTML = cats.map((c) => {
    const its = list.filter((i) => i.category === c.id);
    return `<section class="cat-section"><h2 class="cat-title">${c.label}<small>${its.length} piece${its.length === 1 ? '' : 's'}</small></h2>
      <div class="grid">${its.map(pieceCard).join('')}</div></section>`;
  }).join('');
}
async function skipItem(id) {
  const it = getItem(id); if (!it) return;
  it.skipped = true; state.selected.delete(id); await DB.put('items', it); saveUI();
  renderCloset(); renderTray();
  const el = $('#toast'); clearTimeout(skipItem.t);
  el.innerHTML = `Removed “${esc(it.name)}” <button class="link-btn" data-unskip="${id}">Undo</button>`; el.hidden = false;
  skipItem.t = setTimeout(() => (el.hidden = true), 5000);
}
function renderTray() {
  const tray = $('#tray');
  const ids = [...state.selected].filter(getItem);
  if (!ids.length || state.view === 'room') { tray.hidden = true; return; }
  tray.hidden = false;
  tray.innerHTML = `<div class="tray-thumbs">${ids.slice(0, 6).map((id) => `<img src="${getItem(id).image}" alt="">`).join('')}</div>
    <span class="tray-count">${ids.length} picked${sumPrice(ids.map(getItem)) ? ` · <b>${money(sumPrice(ids.map(getItem)))}</b>` : ''}</span>
    <button class="ghost small" data-tray="clear">Clear</button>
    <button class="primary small" data-tray="room">Go to the changing room →</button>`;
}
async function addItemFiles(files) {
  const ids = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const image = await downscale(await fileToDataURL(f), 1200);
    const it = {
      id: uid(), owner: state.whose !== 'together' ? state.whose : ME, name: '', category: state.cat !== 'all' ? state.cat : 'tops',
      status: state.status === 'coming' ? 'coming' : 'owned',
      link: '', price: '', size: '', notes: '', image, original: image, createdAt: Date.now(),
    };
    await DB.put('items', it); state.items.push(it); ids.push(it.id);
  }
  if (!ids.length) return;
  renderCloset();
  state.queue = ids; state.queueTotal = ids.length;
  openEditor(state.queue.shift());
}

/* ---------- item editor ---------- */
let ed = null; let crop = null;
function openEditor(id) {
  const it = getItem(id); if (!it) return;
  ed = clone(it);
  $('#edImg').src = ed.image;
  $('#edName').value = ed.name; $('#edCat').value = ed.category;
  $('#edLink').value = ed.link; $('#edPrice').value = ed.price || ''; $('#edSize').value = ed.size || ''; $('#edNotes').value = ed.notes || '';
  $$('#edStatus button').forEach((b) => b.classList.toggle('on', b.dataset.edstatus === ed.status));
  $('#edOwner').value = ownerOf(ed);
  const done = state.queueTotal - state.queue.length;
  $('#edQueue').textContent = state.queueTotal > 1 ? `${done} of ${state.queueTotal}` : '';
  $('#edSave').textContent = state.queue.length ? 'Save & next' : 'Save';
  stopCrop();
  $('#itemModal').hidden = false;
  setTimeout(() => $('#edName').focus(), 50);
}
function closeEditor() { $('#itemModal').hidden = true; ed = null; state.queue = []; state.queueTotal = 0; stopCrop(); }
async function saveEditor() {
  const it = getItem(ed.id); if (!it) return closeEditor();
  Object.assign(it, ed, {
    name: $('#edName').value.trim(), category: $('#edCat').value,
    link: extractUrl($('#edLink').value), price: $('#edPrice').value.trim(), size: $('#edSize').value.trim(), notes: $('#edNotes').value.trim(),
    owner: $('#edOwner').value,
  });
  await DB.put('items', it);
  if (state.queue.length) openEditor(state.queue.shift()); else closeEditor();
  refresh();
}
function setImgBusy(on, label) {
  ['#bgBtn', '#aiBgBtn', '#cropBtn', '#resetImgBtn', '#edSave'].forEach((s) => ($(s).disabled = on));
  $('#edImgHint').textContent = on ? label : 'Tip: crop the screenshot to just the clothing, then remove the background so it sits nicely on you.';
}
function stopCrop() { crop = null; $('#cropWrap').classList.remove('cropping'); $('#cropBox').hidden = true; $('#applyCropBtn').hidden = true; $('#cropBtn').textContent = 'Crop'; }
function bindCrop() {
  const wrap = $('#cropWrap'), box = $('#cropBox'), img = $('#edImg');
  $('#cropBtn').onclick = () => {
    if (crop) return stopCrop();
    crop = { rect: null }; wrap.classList.add('cropping'); $('#cropBtn').textContent = 'Cancel crop';
    $('#edImgHint').textContent = 'Drag a box around the piece, then Apply crop.';
  };
  wrap.addEventListener('pointerdown', (e) => {
    if (!crop) return; e.preventDefault();
    const ir = img.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const sx = clamp(e.clientX, ir.left, ir.right), sy = clamp(e.clientY, ir.top, ir.bottom);
    wrap.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const cx = clamp(ev.clientX, ir.left, ir.right), cy = clamp(ev.clientY, ir.top, ir.bottom);
      const r = { x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) };
      crop.rect = { x: (r.x - ir.left) / ir.width, y: (r.y - ir.top) / ir.height, w: r.w / ir.width, h: r.h / ir.height };
      Object.assign(box.style, { left: r.x - wr.left + 'px', top: r.y - wr.top + 'px', width: r.w + 'px', height: r.h + 'px' });
      box.hidden = false; $('#applyCropBtn').hidden = r.w < 8 || r.h < 8;
    };
    const up = () => { wrap.removeEventListener('pointermove', move); wrap.removeEventListener('pointerup', up); };
    wrap.addEventListener('pointermove', move); wrap.addEventListener('pointerup', up);
  });
  $('#applyCropBtn').onclick = async () => {
    if (!crop?.rect) return;
    const n = { w: img.naturalWidth, h: img.naturalHeight }, r = crop.rect;
    ed.image = await cropImage(ed.image, { x: r.x * n.w, y: r.y * n.h, w: r.w * n.w, h: r.h * n.h });
    img.src = ed.image; stopCrop(); setImgBusy(false);
  };
}

/* ================= CHANGING ROOM ================= */
async function bagCutout(src) {
  const img = await loadImage(await removePlainBackground(src, 26));
  const W = img.naturalWidth, H = img.naturalHeight, N = W * H;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H), p = d.data;
  const white = (k) => p[k * 4] > 232 && p[k * 4 + 1] > 232 && p[k * 4 + 2] > 232;
  const lab = new Int32Array(N); const stack = new Int32Array(N); let id = 0;
  // white blobs that are big = background showing through (e.g. inside the strap)
  for (let k0 = 0; k0 < N; k0++) {
    if (lab[k0] || p[k0 * 4 + 3] < 20 || !white(k0)) continue;
    id++; let sp = 0; const blob = []; lab[k0] = id; stack[sp++] = k0;
    while (sp) { const k = stack[--sp]; blob.push(k); const xk = k % W;
      for (const n of [xk > 0 ? k - 1 : -1, xk < W - 1 ? k + 1 : -1, k - W, k + W]) if (n >= 0 && n < N && !lab[n] && p[n * 4 + 3] >= 20 && white(n)) { lab[n] = id; stack[sp++] = n; } }
    if (blob.length > N * 0.002) for (const k of blob) p[k * 4 + 3] = 0;
  }
  // keep the biggest solid piece
  lab.fill(0); id = 0; let best = 0, bestN = 0;
  for (let k0 = 0; k0 < N; k0++) {
    if (lab[k0] || p[k0 * 4 + 3] < 20) continue;
    id++; let sp = 0, n0 = 0; lab[k0] = id; stack[sp++] = k0;
    while (sp) { const k = stack[--sp]; n0++; const xk = k % W;
      for (const n of [xk > 0 ? k - 1 : -1, xk < W - 1 ? k + 1 : -1, k - W, k + W]) if (n >= 0 && n < N && !lab[n] && p[n * 4 + 3] >= 20) { lab[n] = id; stack[sp++] = n; } }
    if (n0 > bestN) { bestN = n0; best = id; }
  }
  for (let k = 0; k < N; k++) if (lab[k] !== best) p[k * 4 + 3] = 0;
  x.putImageData(d, 0, 0);
  return trimTransparent(c.toDataURL('image/png'));
}
async function makeCutout(it) { // white background off, once per bag
  state.cutouts = state.cutouts || {}; if (state.cutouts[it.id] !== undefined) return; state.cutouts[it.id] = null;
  try { state.cutouts[it.id] = await bagCutout(it.tryonPic || it.image); renderFigure(); if (state.view === 'planned' && !document.activeElement?.matches?.('.ed, textarea') && !state.planBusy) renderPlanned(); } catch { delete state.cutouts[it.id]; }
}
function figureHTML(poseId, layers, interactive = false, tryon = null) {
  const pose = state.poses.find((p) => p.id === poseId);
  const base = tryon ? `<img class="pose tryon" src="${tryon}" alt="" draggable="false">` : pose ? `<img class="pose" src="${pose.image}" alt="" draggable="false">` : SILHOUETTE;
  const ls = [...layers].filter((l) => !tryon || isOverlay(l)).sort((a, b) => a.z - b.z).map((l) => {
    const it = getItem(l.itemId); if (!it) return '';
    const on = interactive && l.uid === state.room.active ? ' active' : '';
    const src = (tryon && state.cutouts && state.cutouts[it.id]) || it.image;
    if (tryon && !(state.cutouts && state.cutouts[it.id])) makeCutout(it);
    const st = layerStyle(l) + (tryon ? `;z-index:${l.behind ? 5 : 20}` : '');
    return `<img class="layer${on}" data-uid="${l.uid}" src="${src}" alt="" draggable="false" style="${st}">`;
  }).join('');
  const front = tryon && layers.some((l) => isOverlay(l) && l.behind) ? `<img class="pose tryon body-front" src="${tryon}" alt="" draggable="false" style="z-index:10">` : '';
  return base + ls + front;
}
const layerStyle = (l) => `left:${l.x}%;top:${l.y}%;width:${l.w}%;transform:translate(-50%,-50%) rotate(${l.r}deg) scaleX(${l.flip ? -1 : 1});z-index:${Math.round(l.z)}`;

function renderRoom() {
  if (state.pickCat === undefined) { state.pickCat = store.get('vw.pickCat', 'all'); state.pickClosed = store.get('vw.pickClosed', {}) || {}; state.bigPicks = store.get('vw.bigPicks', true); }
  const R = state.room;
  state.poseOwner = state.poseOwner || ME;
  const myPoses = state.poses.filter((p) => ownerOf(p) === state.poseOwner);
  if (!myPoses.some((p) => p.id === R.poseId)) R.poseId = myPoses[0]?.id || null;
  R.layers = R.layers.filter((l) => getItem(l.itemId));

  // picks
  const picks = [...new Set([...state.selected, ...R.layers.map((l) => l.itemId)])].map(getItem).filter(Boolean);
  const pickBtn = (it) => {
    const on = R.layers.some((l) => l.itemId === it.id);
    return `<button class="pick ${on ? 'on' : ''}" data-pick="${it.id}"><img src="${it.image}" alt="">
        <span><b>${esc(it.name || catLabel(it.category))}</b>${priceHtml(it)}<em>${on ? 'Wearing · tap to adjust' : 'Tap to try on'}</em></span></button>`;
  };
  const pcats = CATEGORIES.filter((c) => picks.some((i) => i.category === c.id));
  if (state.pickCat && !pcats.some((c) => c.id === state.pickCat)) state.pickCat = 'all';
  const pc = state.pickCat || 'all';
  const shown = pc === 'all' ? pcats : pcats.filter((c) => c.id === pc);
  $('.room-layout').classList.toggle('big-picks', !!state.bigPicks);
  const cs = $('#coatSeg'); if (cs) cs.hidden = !R.layers.some((l) => getItem(l.itemId)?.category === 'outerwear');
  $('#picks').innerHTML = picks.length
    ? `<div class="pick-total"><div><small>Wearing now</small><b>${money(sumPrice(R.layers.map((l) => getItem(l.itemId)).filter(Boolean)))}</b></div><div><small>All ${picks.length} picks</small><b>${money(sumPrice(picks))}</b></div></div><button class="big-toggle" data-bigpicks>${state.bigPicks ? '− Smaller pictures' : '⤢ Bigger pictures'}</button><div class="pick-tabs"><button data-pickcat="all" class="${pc === 'all' ? 'on' : ''}">All ${picks.length}</button>${pcats.map((c) => `<button data-pickcat="${c.id}" class="${pc === c.id ? 'on' : ''}">${c.label} ${picks.filter((i) => i.category === c.id).length}</button>`).join('')}</div>`
      + shown.map((c) => {
        const its = picks.filter((i) => i.category === c.id); const open = pc !== 'all' || !(state.pickClosed || {})[c.id];
        return `<div class="pick-sec"><button class="pick-head" data-picksec="${c.id}">${c.label}<small>${its.length}</small><i>${open ? '−' : '+'}</i></button>${open ? its.map(pickBtn).join('') : ''}</div>`;
      }).join('')
      + `<button class="ghost small block" data-goto="closet" style="margin-top:8px">+ Pick more from closet</button>`
    : `<p class="pick-empty">Pick pieces in your closet first, then come back here to try them on.</p>
       <button class="primary small block" data-goto="closet">Open closet</button>`;

  // poses
  $('#posesWho').innerHTML = PEOPLE.map((p) => `<button class="${state.poseOwner === p.id ? 'on' : ''}" data-poseowner="${p.id}">${p.name}</button>`).join('');
  $('#poses').innerHTML = `<div class="pose-grid">
      ${myPoses.map((p) => `<button class="pose-thumb ${p.id === R.poseId ? 'on' : ''}" data-pose="${p.id}"><img src="${p.image}" alt=""></button>`).join('')}
      <label class="pose-thumb pose-add" title="Add a photo of you">+<input type="file" accept="image/*" multiple hidden id="poseFiles"></label>
    </div>
    ${R.poseId ? `<div class="pose-actions">
      <button class="ghost small" data-poseact="ai">AI cut me out</button>
      <button class="ghost small" data-poseact="plain">Quick cutout (plain wall)</button>
      <button class="ghost small" data-poseact="reset">Reset photo</button>
      <button class="danger-link small" data-poseact="delete">Remove this pose</button>
    </div>` : `<p class="hint">Add a full-body photo of ${state.poseOwner === ME ? 'yourself' : personName(state.poseOwner)} (head to toe, facing forward, plain wall is best). Add a few poses if you like.</p>`}`;

  // editing banner
  const editing = state.outfits.find((o) => o.id === R.editingId);
  $('#editingBanner').hidden = !editing;
  if (editing) $('#editingBanner').innerHTML = `<span>Editing <b>${esc(editing.name || 'outfit')}</b> — lock in to save changes.</span><button class="link-btn" data-stopedit>Start a new outfit instead</button>`;

  renderFigure();
  saveUI();
}
// Pop-up for a piece you're wearing: see it big (tap to zoom), resize, front/back, take off.
function openPiece(l) {
  const it = getItem(l.itemId); if (!it) return;
  state.room.active = l.uid; renderFigure();
  let el = $('#pieceView');
  if (!el) {
    el = document.createElement('div'); el.id = 'pieceView'; el.className = 'piece-view';
    (document.getElementById('vw-app') || document.body).appendChild(el);
    el.addEventListener('click', (e) => {
      const L = getLayer(state.room.active); const a = e.target.closest('[data-pv]');
      if (e.target === el || (a && a.dataset.pv === 'close')) { el.hidden = true; return; }
      if (e.target.closest('.pv-img')) { e.target.closest('.pv-img').classList.toggle('zoomed'); return; }
      if (!a || !L) return;
      const zs = state.room.layers.map((x) => x.z); const onPhoto = !!currentTryon();
      if (a.dataset.pv === 'front') { L.z = Math.max(...zs) + 1; L.behind = false; toast(onPhoto && !isOverlay(L) ? 'On the AI photo, clothes layer the way they are worn (coat over top)' : 'In front', 2200); }
      if (a.dataset.pv === 'back') { L.z = Math.min(...zs) - 1; if (onPhoto && isOverlay(L)) L.behind = true; toast(onPhoto && !isOverlay(L) ? 'On the AI photo, clothes layer the way they are worn (coat over top)' : 'Sent back', 2200); }
      if (a.dataset.pv === 'off') { el.hidden = true; return toggleTryOn(L.itemId, true); }
      saveUI(); renderFigure();
    });
    el.addEventListener('input', (e) => {
      const L = getLayer(state.room.active); if (!L || !e.target.matches('[data-pvw]')) return;
      L.w = parseFloat(e.target.value); const f = $(`#figure .layer[data-uid="${L.uid}"]`); if (f) f.style.cssText = layerStyle(L) + (currentTryon() ? `;z-index:${L.behind ? 5 : 20}` : ''); saveUI();
    });
  }
  const sizable = !currentTryon() || isOverlay(l);
  el.innerHTML = `<div class="pv-card">
    <button class="pv-x" data-pv="close" aria-label="Close">✕</button>
    <div class="pv-img"><img src="${it.tryonPic || it.image}" alt=""></div>
    <div class="pv-side">
      <div class="pv-name">${esc(it.name || catLabel(it.category))}</div>
      <div class="pv-price">${priceHtml(it)}</div>
      <p class="pv-hint">Tap the picture to zoom in.</p>
      ${sizable ? `<label class="pv-size">Size<input type="range" min="8" max="140" step="0.5" value="${l.w}" data-pvw></label>` : ''}
      <div class="pv-btns">
        <button class="ghost small" data-pv="front">Bring to front</button>
        <button class="ghost small" data-pv="back">Send back</button>
        <button class="danger-link small" data-pv="off">Take it off</button>
      </div>
      ${it.link ? `<a class="pv-link" href="${esc(it.link)}" target="_blank" rel="noopener">Open in TikTok Shop ↗</a>` : ''}
    </div></div>`;
  el.hidden = false;
}
function openZoom() {
  const t = currentTryon(); if (!t) return;
  let el = $('#zoomView');
  if (!el) { el = document.createElement('div'); el.id = 'zoomView'; el.className = 'zoom-view'; (document.getElementById('vw-app') || document.body).appendChild(el); el.onclick = () => (el.hidden = true); }
  el.innerHTML = `<img src="${state.tryonRaw || t.image}" alt=""><button class="zoom-close">✕ Close</button>`;
  el.hidden = false;
}
function renderFigure() {
  const t = currentTryon();
  $('#figure').innerHTML = figureHTML(state.room.poseId, state.room.layers, true, t);
  $('#figure').classList.toggle('is-tryon', !!t);
  const zb = $('#zoomBtn'); if (zb) zb.hidden = !t;
  const b = $('#tryonBtn'); if (b && !b.disabled) b.textContent = t ? 'Try it on again (AI)' : 'Try it on (AI)';
  updateMirrors(); renderLayerTools(); paintCost();
  const ti = $('#figure .pose.tryon'); if (ti) { if (ti.complete) paintHighlight(); else ti.onload = paintHighlight; }
}
let mirrorRaf = 0;
function updateMirrors() {
  cancelAnimationFrame(mirrorRaf);
  mirrorRaf = requestAnimationFrame(() => {
    const html = `<div class="figure">${figureHTML(state.room.poseId, state.room.layers, false, currentTryon())}</div>`;
    $$('#room .reflect, #room .floor-reflect').forEach((m) => (m.innerHTML = html));
  });
}
function wornChips() {
  const L = state.room.layers; if (!L.length) return '';
  return `<div class="worn-chips"><span class="wc-label">Wearing</span>${L.map((x) => { const it = getItem(x.itemId);
    return `<span class="wchip${state.room.active === x.uid ? ' on' : ''}" data-wsel="${x.uid}" title="Tap to highlight">${it?.image ? `<img src="${esc(it.image)}" alt="">` : ''}<b>${esc((it?.name || catLabel(it?.category)).split(/[,–(]/)[0].slice(0, 26))}</b><button class="wx" data-wx="${x.uid}" title="Take it off" aria-label="Take it off">✕</button></span>`; }).join('')}</div>`;
}
function renderLayerTools() {
  const box = $('#layerTools'); const l = getLayer(state.room.active);
  if (!l) {
    box.innerHTML = `${wornChips()}<span class="lt-empty">${state.room.layers.length ? 'Tap a piece on you (or in the Wearing row) to highlight it.' : 'Tap a piece on the left to try it on.'}</span>`;
    return;
  }
  const it = getItem(l.itemId);
  box.innerHTML = `${wornChips()}<span class="lt-name">${esc(it?.name || catLabel(it?.category))}</span>
    ${currentTryon() && !isOverlay(l) ? '' : `<label>Size<input type="range" min="8" max="140" step="0.5" value="${l.w}" data-lt="w"></label>
    <label>Tilt<input type="range" min="-45" max="45" step="0.5" value="${l.r}" data-lt="r"></label>`}
    <div class="lt-btns">
      ${currentTryon() && !isOverlay(l) ? '' : '<button class="ghost small" data-ltb="flip">Flip</button>'}
      ${currentTryon() && !isOverlay(l) ? styleBtns(l) : `<button class="ghost small" data-ltb="front">Bring forward</button>
      <button class="ghost small" data-ltb="back">Send back</button>`}
      <button class="ghost small" data-ltb="remove">Take off</button>
      ${currentTryon() && isOverlay(l) ? '<button class="primary small" data-ltb="shoulder">On shoulder (AI)</button>' : ''}
    </div>`;
}
// one piece per body spot: a new pair of pants replaces the old pair, a dress replaces top + bottoms
const SLOT = { tops: 'top', bottoms: 'low', skirts: 'low', shorts: 'low', dresses: 'full', sets: 'full', shoes: 'shoes' };
const clashes = (a, b) => a && b && (a === b || (a === 'full' && (b === 'top' || b === 'low')) || (b === 'full' && (a === 'top' || a === 'low')));
function dedupeLayers(layers) {
  const keep = [];
  for (let i = layers.length - 1; i >= 0; i--) { // newest wins
    const sl = SLOT[getItem(layers[i].itemId)?.category];
    if (keep.some((k) => clashes(SLOT[getItem(k.itemId)?.category], sl))) continue;
    keep.unshift(layers[i]);
  }
  return keep;
}
function toggleTryOn(itemId, force) {
  const R = state.room; const ex = R.layers.find((l) => l.itemId === itemId);
  if (ex && !force) return selectPiece(ex);
  if (ex) { R.layers = R.layers.filter((l) => l !== ex); if (R.active === ex.uid) R.active = null; }
  else {
    const it = getItem(itemId); const p = PLACEMENT[it.category] || PLACEMENT.tops;
    const z = p.z * 100 + R.layers.filter((l) => Math.floor(l.z / 100) === p.z).length;
    const l = { uid: uid(), itemId, x: p.x, y: p.y, w: p.w, r: 0, flip: false, z };
    R.layers.push(l); R.active = l.uid;
    const before = R.layers.length; R.layers = dedupeLayers(R.layers);
    if (R.layers.length < before) toast('Swapped ✨', 1600);
  }
  renderRoom();
}
// On the AI photo the clothes are part of the picture, so work out which piece you tapped from where you tapped.
function photoBox() {
  const img = $('#figure .pose.tryon'); if (!img || !img.naturalWidth) return null;
  const b = img.getBoundingClientRect(); const s = Math.min(b.width / img.naturalWidth, b.height / img.naturalHeight);
  const w = img.naturalWidth * s, h = img.naturalHeight * s, left = b.left + (b.width - w) / 2, top = b.bottom - h; // contain, bottom center
  // where you actually are inside the picture (ignore see-through / white edges)
  if (!img._body) {
    const W = 160, H = Math.round(160 * img.naturalHeight / img.naturalWidth); const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, W, H); const p = x.getImageData(0, 0, W, H).data;
    // biggest solid shape = you (skips leftover bits of background)
    const N = W * H, lab = new Int32Array(N), st = new Int32Array(N); let id = 0, best = 0, bestN = 0;
    const on = (k) => p[k * 4 + 3] > 140;
    for (let k0 = 0; k0 < N; k0++) {
      if (lab[k0] || !on(k0)) continue; id++; let sp = 0, n = 0; lab[k0] = id; st[sp++] = k0;
      while (sp) { const k = st[--sp]; n++; const xk = k % W; for (const m of [xk > 0 ? k - 1 : -1, xk < W - 1 ? k + 1 : -1, k - W, k + W]) if (m >= 0 && m < N && !lab[m] && on(m)) { lab[m] = id; st[sp++] = m; } }
      if (n > bestN) { bestN = n; best = id; }
    }
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (let k = 0; k < N; k++) if (lab[k] === best) { const i = k % W, j = (k / W) | 0; if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
    const hx = []; for (let k = 0; k < N; k++) if (lab[k] === best) { const j = (k / W) | 0; if (j >= y0 + (y1 - y0) * 0.15 && j <= y0 + (y1 - y0) * 0.45) hx.push(k % W); }
    hx.sort((a, b) => a - b); const cx = hx.length ? hx[hx.length >> 1] : (x0 + x1) / 2;
    img._body = y1 > y0 ? { x0: x0 / W, x1: (x1 + 1) / W, y0: y0 / H, y1: (y1 + 1) / H, cx: (cx + 0.5) / W } : { x0: 0, x1: 1, y0: 0, y1: 1, cx: 0.5 };
  }
  const B = img._body;
  return { cx: left + B.cx * w, top: top + B.y0 * h, h: (B.y1 - B.y0) * h };
}
// which part of you each kind of piece covers (fractions of you, head to toe)
function pieceBand(cat) { // [half width, top, bottom] as parts of your height
  if (cat === 'shoes') return [0.1, 0.9, 1.01];
  if (['bottoms', 'skirts', 'shorts'].includes(cat)) return [0.11, 0.45, 0.93];
  if (['dresses', 'sets'].includes(cat)) return [0.15, 0.13, 0.9];
  if (cat === 'outerwear') return isLongCoat() ? [0.19, 0.12, 0.8] : [0.17, 0.12, 0.56];
  return [0.16, 0.13, 0.52];
}
function isLongCoat() { const it = state.room.layers.map((l) => getItem(l.itemId)).find((i) => i?.category === 'outerwear'); return !!it && /robe|long|trench|maxi|duster|overcoat|midi|cardigan coat/i.test(`${it.name} ${it.tryonNote || ''}`); }
function pieceAtTap(e) {
  const P = photoBox(); if (!P) return null;
  const dx = (e.clientX - P.cx) / P.h, fy = (e.clientY - P.top) / P.h; const fx = 0.5 + dx * 2.6;
  if (fx < -0.1 || fx > 1.1 || fy < 0.12 || fy > 1.03) return null; // outside you, or your head
  const worn = state.room.layers.filter((l) => !isOverlay(l)).map((l) => ({ l, c: getItem(l.itemId)?.category }));
  const find = (...cats) => worn.find((x) => cats.includes(x.c))?.l;
  const centre = Math.abs(dx) < 0.05;
  if (isLongCoat() && fy > 0.12 && fy < 0.8 && Math.abs(dx) > (fy > 0.47 ? 0.07 : 0.1) && find('outerwear')) return find('outerwear'); // the sides of a long coat / robe
  if (fy > 0.91) return find('shoes') || find('bottoms', 'skirts', 'shorts', 'dresses', 'sets');
  if (fy > 0.47) return find('bottoms', 'skirts', 'shorts', 'dresses', 'sets') || find('shoes');
  // upper body: middle = what's under an open coat, sides = the coat
  if (centre && store.get('vw.coat', 'open') === 'open') return find('tops', 'dresses', 'sets') || find('outerwear');
  return find('outerwear') || find('tops', 'dresses', 'sets');
}
// remember every finished photo, so taking a piece off can go straight back to a photo you already have (free)
state.tryonHist = state.tryonHist || {};
function rememberTryon() { if (state.tryon?.sig) state.tryonHist[state.tryon.sig] = state.tryon.image; }
function takeOff(l) {
  rememberTryon();
  const it = getItem(l.itemId); const hadPhoto = !!currentTryon();
  state.room.layers = state.room.layers.filter((x) => x !== l); state.room.active = null;
  const saved = state.tryonHist[tryonSig()];
  if (saved) { state.tryon = { sig: tryonSig(), image: saved }; store.set('vw.tryon', state.tryon); toast(`Took off ${shortName(it)} ✨`, 2200); }
  else if (hadPhoto && !isOverlay(l) && state.room.layers.some((x) => !isOverlay(x))) {
    if (fashnFree()) { toast(`Taking off ${shortName(it)}…`, 2000); renderRoom(); return runFashnTryon(); }
    toast(`Took off ${shortName(it)}. Tap "Try it on again" to see the photo without it`, 4200);
  } else toast(`Took off ${shortName(it)}`, 1800);
  saveUI(); renderRoom();
}
function shortName(it) { return (it?.name || catLabel(it?.category) || 'it').split(/[,–(]/)[0].trim(); }
// true when every piece left is already drawn on you in the saved AI steps (no credits needed)
function fashnFree() {
  const pose = state.poses.find((p) => p.id === state.room.poseId); if (!pose || !state.fashnCache) return false;
  const ids = fashnOrder().map((it) => it.id); const mode = store.get('vw.fashnMode', 'balanced');
  return ids.length > 0 && !!state.fashnCache.get(`${mode}${store.get('vw.coat', 'open')}|v6${pantsInBoots() ? 'ib' : ''}|${pose.id}|${ids.join(',')}`);
}
function fashnOrder() {
  const R = state.room; const layers = dedupeLayers(R.layers);
  const items = [...new Set(layers.map((l) => l.itemId))].map(getItem).filter(Boolean).filter((it) => !OVERLAY_CATS.has(it.category));
  const zOf = (it) => Math.max(...layers.filter((l) => l.itemId === it.id).map((l) => l.z));
  items.sort((a, b) => zOf(a) - zOf(b));
  items.sort((a, b) => (FASHN_ORDER[a.category] ?? 9) - (FASHN_ORDER[b.category] ?? 9));
  { const full = !pantsInBoots() && items.find((it) => it.category === 'bottoms' && !/crop|capri|ankle|short|culotte|7\/8/i.test(it.name || '')); const sh = items.findIndex((it) => it.category === 'shoes'); if (full && sh > 0) items.unshift(...items.splice(sh, 1)); }
  return items;
}
function selectPiece(l) {
  state.room.active = state.room.active === l.uid ? null : l.uid;
  renderFigure();
}
function paintHighlight() {
  const fig = $('#figure'); if (!fig) return; $$('.piece-hl', fig).forEach((n) => n.remove());
  const l = getLayer(state.room.active); if (!l || !currentTryon() || isOverlay(l)) return;
  const P = photoBox(); if (!P) return; const f = fig.getBoundingClientRect(); const [hw, b, d] = pieceBand(getItem(l.itemId)?.category);
  const el = document.createElement('div'); el.className = 'piece-hl';
  el.style.cssText = `left:${P.cx - f.left - hw * P.h}px;top:${P.top - f.top + b * P.h}px;width:${2 * hw * P.h}px;height:${(d - b) * P.h}px`;
  fig.appendChild(el);
}
function bindFigure() {
  const fig = $('#figure');
  fig.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.layer');
    if (!el && currentTryon()) { const hit = pieceAtTap(e); if (hit) { e.preventDefault(); return selectPiece(hit); } }
    if (!el) { if (state.room.active) { state.room.active = null; $$('.layer', fig).forEach((n) => n.classList.remove('active')); renderLayerTools(); paintHighlight(); } return; }
    e.preventDefault();
    const l = getLayer(el.dataset.uid); if (!l) return;
    state.room.active = l.uid;
    $$('.layer', fig).forEach((n) => n.classList.toggle('active', n === el));
    renderLayerTools();
    const rect = fig.getBoundingClientRect(); const s = { x: e.clientX, y: e.clientY, lx: l.x, ly: l.y };
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      l.x = clamp(s.lx + ((ev.clientX - s.x) / rect.width) * 100, -30, 130);
      l.y = clamp(s.ly + ((ev.clientY - s.y) / rect.height) * 100, -20, 120);
      el.style.cssText = layerStyle(l); updateMirrors();
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); saveUI(); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  fig.addEventListener('wheel', (e) => {
    const el = e.target.closest('.layer'); if (!el) return; e.preventDefault();
    const l = getLayer(el.dataset.uid); l.w = clamp(l.w * (e.deltaY < 0 ? 1.04 : 0.96), 8, 140);
    el.style.cssText = layerStyle(l); updateMirrors(); saveUI();
    const sl = $('[data-lt="w"]'); if (sl && state.room.active === l.uid) sl.value = l.w;
  }, { passive: false });
}
async function addPoseFiles(files) {
  let last = null;
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const image = await downscale(await fileToDataURL(f), 1600);
    const p = { id: uid(), owner: state.poseOwner || ME, image, original: image, createdAt: Date.now() };
    await DB.put('poses', p); state.poses.push(p); last = p;
  }
  if (last) { state.room.poseId = last.id; renderRoom(); toast('Tip: tap "AI cut me out" so you stand on the platform', 3500); }
}
async function poseAction(act) {
  const p = state.poses.find((x) => x.id === state.room.poseId); if (!p) return;
  if (act === 'delete') {
    if (!confirm('Remove this photo of you?')) return;
    await DB.del('poses', p.id); state.poses = state.poses.filter((x) => x !== p); state.room.poseId = null; return renderRoom();
  }
  const btns = $$('[data-poseact]'); btns.forEach((b) => (b.disabled = true));
  try {
    if (act === 'reset') p.image = p.original;
    if (act === 'plain') { toast('Cutting you out…'); p.image = await removePlainBackground(p.original, 34); }
    if (act === 'ai') { toast('Cutting you out… the first time can take a minute', 6000); p.image = await aiCutout(p.original); }
    await DB.put('poses', p);
  } finally { renderRoom(); }
}

/* ---------- lock in ---------- */
let lockPlan = 'day';
function openLock() {
  const R = state.room;
  if (!R.layers.length) return toast('Try something on first');
  const editing = state.outfits.find((o) => o.id === R.editingId);
  $('#lkTitle').textContent = editing ? 'Update this outfit' : 'Lock in this outfit';
  $('#lkName').value = editing?.name || ''; $('#lkWhere').value = editing?.where || ''; $('#lkNote').value = editing?.note || '';
  lockPlan = editing?.plan?.type || 'day';
  $('#lkDay').value = editing?.plan?.day || DAYS[(new Date().getDay() + 6) % 7];
  $('#lkVideo').value = editing?.plan?.video || '';
  syncLockPlan();
  lockOwner = editing ? ownerOf(editing) : ownerOf(state.poses.find((p) => p.id === R.poseId)) || ME;
  syncLockOwner();
  const ids = [...new Set(R.layers.map((l) => l.itemId))];
  $('#lkPieces').innerHTML = ids.map(getItem).filter(Boolean).map((it) => `<div class="tag-row"><img src="${it.image}" alt="">
      <div class="t-name">${esc(it.name || catLabel(it.category))}<small>${it.link ? esc(it.link) : 'No TikTok Shop link yet — add it in the closet'}</small></div><span></span></div>`).join('');
  $('#lkSave').textContent = editing ? 'Save changes' : 'Lock it in';
  $('#lockModal').hidden = false;
  setTimeout(() => $('#lkName').focus(), 50);
}
let lockOwner = 'kiaredza';
function syncLockOwner() { $('#lkOwner').innerHTML = [...PEOPLE, { id: 'together', name: 'Together' }].map((p) => `<button class="${lockOwner === p.id ? 'on' : ''}" data-lkowner="${p.id}">${p.id === 'together' ? 'Together' : p.name + "'s"}</button>`).join(''); }
function syncLockPlan() {
  $$('#lkPlan button').forEach((b) => b.classList.toggle('on', b.dataset.plan === lockPlan));
  $('#lkDayWrap').hidden = lockPlan !== 'day'; $('#lkVideoWrap').hidden = lockPlan !== 'video';
}
async function saveLock() {
  const R = state.room; const existing = state.outfits.find((o) => o.id === R.editingId);
  const o = {
    id: existing?.id || uid(),
    name: $('#lkName').value.trim() || 'Untitled outfit',
    where: $('#lkWhere').value.trim(),
    note: $('#lkNote').value.trim(),
    plan: { type: lockPlan, day: lockPlan === 'day' ? $('#lkDay').value : '', video: lockPlan === 'video' ? $('#lkVideo').value.trim() : '' },
    owner: lockOwner,
    poseId: R.poseId,
    layers: clone(R.layers).map((l) => ({ ...l })),
    itemIds: [...new Set(R.layers.map((l) => l.itemId))],
    tryon: currentTryon() || null,
    createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(),
  };
  await DB.put('outfits', o);
  state.outfits = existing ? state.outfits.map((x) => (x.id === o.id ? o : x)) : [...state.outfits, o];
  R.editingId = null; saveUI();
  $('#lockModal').hidden = true;
  toast(existing ? 'Outfit updated' : `Locked in for ${lockOwner === 'together' ? 'both of you' : personName(lockOwner)} ✓`);
  state.whose = lockOwner; store.set('vw.whose', state.whose);
  go('planned');
}

/* ================= AI TRY-ON (Google Gemini) ================= */
const OVERLAY_CATS = new Set(['bags']); // these stay as movable stickers on top of the AI photo
const isOverlay = (l) => OVERLAY_CATS.has(getItem(l.itemId)?.category) && !l.baked;
const tryonSig = (R = state.room) => `${R.poseId}|${[...new Set(R.layers.filter((l) => !isOverlay(l)).map((l) => l.itemId))].sort().join(',')}`;
state.tryon = store.get('vw.tryon', null);
function currentTryon() { if (!state.room.layers.some((l) => !isOverlay(l))) return null; const sig = tryonSig(); if (state.tryon && state.tryon.sig === sig) return state.tryon.image; const h = state.tryonHist && state.tryonHist[sig]; if (h) { state.tryon = { sig, image: h }; return h; } return null; }
function openKeyModal() { $('#keyModal').hidden = false; setTimeout(() => $('#keyInput').focus(), 50); }
async function toJpegB64(src, max = 1024, bg = '#ffffff') {
  const img = await loadImage(src); const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  const x = c.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
}
// Remove the solid green background the model is asked to paint behind you.
async function keyOutGreen(src) {
  const img = await loadImage(src); const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H); const p = d.data;
  const at = (i) => { const r = p[i], g = p[i + 1], b = p[i + 2]; return g - Math.max(r, b) > 60; };
  const corners = [0, (W - 1) * 4, (H - 1) * W * 4, (H * W - 1) * 4].filter(at).length;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2], m = Math.max(r, b);
    const k = g - m; // how "green-screen" this pixel is
    if ((k > 40 && g > 70) || (g > 1.6 * m && g > 60)) p[i + 3] = 0;
    else if (k > 14) { p[i + 3] = Math.min(p[i + 3], Math.round(255 * (1 - (k - 14) / 26))); p[i + 1] = m; }
    else if (k > 0) p[i + 1] = m + k * 0.3; // de-spill edges
  }
  x.putImageData(d, 0, 0);
  const keyed = c.toDataURL('image/png');
  return trimTransparent(corners < 3 ? await removePlainBackground(keyed, 34) : keyed); // no green screen: also strip plain bg
}
// Undo the "phone held above" look: legs/feet get gradually wider + a touch longer toward the floor.
async function keystone(src, start = 0.42, gain = 0.28, stretch = 0.06) {
  const img = await loadImage(src); const W = img.naturalWidth, H = img.naturalHeight;
  const y0 = Math.round(H * start), rows = H - y0, extra = Math.round(rows * stretch), outRows = rows + extra;
  const out = document.createElement('canvas'); out.width = Math.round(W * (1 + gain)); out.height = H + extra; const x = out.getContext('2d');
  x.drawImage(img, 0, 0, W, y0, (out.width - W) / 2, 0, W, y0);
  for (let j = 0; j < outRows; j++) {
    const t = j / outRows, sy = y0 + Math.floor(t * rows), w = W * (1 + gain * Math.pow(t, 1.15));
    x.drawImage(img, 0, sy, W, 1, (out.width - w) / 2, y0 + j, w, 1.5);
  }
  return trimTransparent(out.toDataURL('image/png'));
}
// Put your cut-out photo on a 2:3 green canvas at a known spot (room left below for feet).
const STAGE = { W: 1024, H: 1536, top: 0.03, h: 0.8 };
async function buildStage(src) {
  const img = await loadImage(src); const { W, H } = STAGE;
  const h = H * STAGE.h, w = h * (img.naturalWidth / img.naturalHeight), x0 = (W - w) / 2, y0 = H * STAGE.top;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  x.fillStyle = '#00ff00'; x.fillRect(0, 0, W, H); x.drawImage(img, x0, y0, w, h);
  return { url: c.toDataURL('image/png'), rect: { x: x0, y: y0, w, h } };
}
// Paste your REAL head (from your photo) back onto the AI image so the face is always yours.
async function pasteRealHead(genSrc, stage, cutSrc, headFrac) {
  const { W, H } = STAGE; const gen = await loadImage(genSrc), cut = await loadImage(cutSrc);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(gen, 0, 0, W, H);
  const R = stage.rect, hh = R.h * headFrac;
  // head patch with soft bottom edge
  const hc = document.createElement('canvas'); hc.width = Math.round(R.w); hc.height = Math.round(hh); const hx = hc.getContext('2d');
  hx.drawImage(cut, 0, 0, cut.naturalWidth, cut.naturalHeight * headFrac, 0, 0, hc.width, hc.height);
  hx.globalCompositeOperation = 'destination-in';
  const g = hx.createLinearGradient(0, 0, 0, hc.height); g.addColorStop(0, '#000'); g.addColorStop(0.82, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
  hx.fillStyle = g; hx.fillRect(0, 0, hc.width, hc.height);
  // find where the AI put the head: small search over shift/scale, comparing to the stage head
  const S = 0.125, gw = Math.round(W * S), gh = Math.round(H * S);
  const gray = (canvas) => { const t = document.createElement('canvas'); t.width = gw; t.height = gh; const tx = t.getContext('2d', { willReadFrequently: true }); tx.drawImage(canvas, 0, 0, gw, gh); const d = tx.getImageData(0, 0, gw, gh).data; const o = new Float32Array(gw * gh); for (let i = 0; i < o.length; i++) o[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11; return o; };
  const st = document.createElement('canvas'); st.width = W; st.height = H; st.getContext('2d').drawImage(await loadImage(stage.url), 0, 0);
  const A = gray(st), B = gray(c);
  const x0 = Math.round(R.x * S), y0 = Math.round(R.y * S), w0 = Math.round(R.w * S), h0 = Math.round(hh * 0.75 * S);
  let best = { e: Infinity, dx: 0, dy: 0, k: 1 };
  const search = (ks, ke, kstep, r, step, c0) => { for (let k = ks; k <= ke + 1e-9; k += kstep) for (let dy = c0.dy - r; dy <= c0.dy + r; dy += step) for (let dx = c0.dx - r; dx <= c0.dx + r; dx += step) {
    let e = 0, n = 0;
    for (let yy = 0; yy < h0; yy += 1) for (let xx = 0; xx < w0; xx += 1) {
      const ax = x0 + xx, ay = y0 + yy; const a = A[ay * gw + ax]; if (a === undefined) continue;
      const bx = Math.round(x0 + w0 / 2 + (xx - w0 / 2) * k + dx), by = Math.round(y0 + yy * k + dy);
      if (bx < 0 || by < 0 || bx >= gw || by >= gh) { e += 2500; n++; continue; }
      const dd = a - B[by * gw + bx]; e += dd * dd; n++;
    }
    e /= n; if (e < best.e) best = { e, dx, dy, k };
  } };
  search(0.6, 1.2, 0.03, 40, 2, { dx: 0, dy: 0 });       // coarse
  { const b0 = { ...best }; search(b0.k - 0.03, b0.k + 0.03, 0.01, 3, 1, b0); } // fine
  const k = best.k, dx = best.dx / S, dy = best.dy / S;
  x.drawImage(hc, R.x + R.w / 2 - (R.w / 2) * k + dx, R.y + dy, R.w * k, hh * k);
  console.log('head align', best);
  return c.toDataURL('image/png');
}
async function pickGeminiModel(key) {
  const cached = store.get('vw.geminiModel', null); if (cached) return cached;
  let names = [];
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    if (r.status === 400 || r.status === 403) throw new Error('KEY');
    names = ((await r.json()).models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', ''));
  } catch (e) { if (e.message === 'KEY') throw e; }
  const pref = ['gemini-3-pro-image', 'gemini-3-pro-image-preview', 'gemini-2.5-flash-image']; // pro keeps your real face
  const m = pref.find((n) => names.includes(n)) || names.find((n) => /flash.*image/.test(n)) || names.find((n) => /image/.test(n) && !/imagen/.test(n)) || 'gemini-2.5-flash-image';
  store.set('vw.geminiModel', m); return m;
}
// Free try-on: OOTDiffusion on Hugging Face. One piece at a time, chained.
const OOTD = 'https://levihsu-ootdiffusion.hf.space/gradio_api';
const OOTD_CAT = { tops: 'Upper-body', outerwear: 'Upper-body', bottoms: 'Lower-body', skirts: 'Lower-body', shorts: 'Lower-body', dresses: 'Dress', sets: 'Dress' };
async function padTo34(src, W = 768, H = 1024) {
  const img = await loadImage(src); const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
  const s = Math.min((W * 0.92) / img.naturalWidth, (H * 0.96) / img.naturalHeight);
  const w = img.naturalWidth * s, h = img.naturalHeight * s; x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
}
async function ootdUpload(blob) { const f = new FormData(); f.append('files', blob, 'img.jpg'); const r = await fetch(OOTD + '/upload', { method: 'POST', body: f }); if (!r.ok) throw new Error('Upload failed'); return (await r.json())[0]; }
async function ootdOne(personBlob, garmentSrc, cat) {
  const fd = (p) => ({ path: p, meta: { _type: 'gradio.FileData' } });
  const [pp, gp] = [await ootdUpload(personBlob), await ootdUpload(await padTo34(garmentSrc))];
  const r = await fetch(OOTD + '/call/process_dc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [fd(pp), fd(gp), cat, 1, 20, 2, -1] }) });
  const { event_id } = await r.json(); if (!event_id) throw new Error('The free try-on is busy — try again in a minute.');
  const txt = await (await fetch(`${OOTD}/call/process_dc/${event_id}`)).text();
  if (/event: error/.test(txt)) throw new Error(/quota|GPU/i.test(txt) ? 'Free daily limit reached — try again later.' : 'The free try-on is busy — try again in a minute.');
  const data = JSON.parse(txt.split('data: ').pop()); const url = data[0][0].image.url;
  return (await fetch(url)).blob();
}
async function runFreeTryon() {
  const R = state.room;
  const pose = state.poses.find((p) => p.id === R.poseId);
  if (!pose) return toast('Add a photo of you first', 2600);
  R.layers = dedupeLayers(R.layers); renderRoom();
  const items = [...new Set(R.layers.map((l) => l.itemId))].map(getItem).filter((it) => it && OOTD_CAT[it.category]);
  if (!items.length) return toast('Tap a top, bottom or dress to try on first (shoes & bags can\'t be tried on yet)', 3600);
  const order = { 'Lower-body': 0, 'Dress': 1, 'Upper-body': 2 };
  items.sort((a, b) => order[OOTD_CAT[a.category]] - order[OOTD_CAT[b.category]]);
  const btn = $('#tryonBtn'); btn.disabled = true; $('#room').classList.add('busy');
  try {
    let person = await padTo34(pose.image);
    for (const [i, it] of items.entries()) {
      btn.textContent = items.length > 1 ? `Dressing you… ${i + 1}/${items.length}` : 'Dressing you…';
      person = await ootdOne(person, it.original || it.image, OOTD_CAT[it.category]);
    }
    const raw = await fileToDataURL(person);
    const image = await trimTransparent(await removePlainBackground(raw, 26));
    state.tryon = { sig: tryonSig(), image }; store.set('vw.tryon', state.tryon); rememberTryon();
    R.active = null; toast('Here you go ✨');
  } catch (e) { console.warn(e); toast(e.message || 'Try-on failed — try again', 4200); }
  finally { btn.disabled = false; $('#room').classList.remove('busy'); renderFigure(); }
}
/* ---- FASHN try-on: repaints only the clothing, your face & body stay untouched ---- */
// How many credits the next "Try it on" will cost (pieces already done on this photo are free).
function tryonCost() {
  const R = state.room; const pose = state.poses.find((p) => p.id === R.poseId); if (!pose) return { need: 0, pieces: 0, per: 2 };
  const mode = store.get('vw.fashnMode', 'balanced'); const per = { fast: 1, balanced: 2, quality: 3 }[mode] || 2;
  const items = [...new Set(dedupeLayers([...R.layers]).map((l) => l.itemId))].map(getItem).filter((it) => it && !OVERLAY_CATS.has(it.category));
  items.sort((a, b) => (FASHN_ORDER[a.category] ?? 9) - (FASHN_ORDER[b.category] ?? 9));
  { const full = !pantsInBoots() && items.find((it) => it.category === 'bottoms' && !/crop|capri|ankle|short|culotte|7\/8/i.test(it.name || '')); const sh = items.findIndex((it) => it.category === 'shoes'); if (full && sh > 0) items.unshift(...items.splice(sh, 1)); } // full-length pants go on AFTER shoes so they fall over them
  const ids = items.map((it) => it.id); let done = 0;
  for (let k = ids.length; k > 0; k--) if (state.fashnCache?.get(`${mode}${store.get('vw.coat', 'open')}|v6${pantsInBoots() ? 'ib' : ''}|${pose.id}|${ids.slice(0, k).join(',')}`)) { done = k; break; }
  return { need: (ids.length - done) * per, pieces: ids.length - done, per };
}
function paintCost() {
  const el = $('#costLine'); if (!el) return; const c = tryonCost();
  el.innerHTML = c.pieces ? `This try-on costs <b>${c.need} credits</b> (${c.pieces} piece${c.pieces > 1 ? 's' : ''} × ${c.per})` : 'Nothing new to try on — free';
  const left = state.creditsLeft; const short = typeof left === 'number' && left < c.need;
  el.classList.toggle('low', short); if (short) el.innerHTML += ' — not enough credits';
}
const FASHN_ORDER = { dresses: 0, sets: 0, bottoms: 1, skirts: 1, shorts: 1, tops: 2, outerwear: 3, shoes: 4, bags: 5, accessories: 6 };
// After several AI passes the face drifts and gets blotchy. Find the face in the original photo,
// find the same spot in the result (small shift/scale search), and blend the real face back in.
// scale + shift your original photo so your body sits exactly where it is in the new picture (white background)
async function alignBody(o, r) {
  const W = r.naturalWidth, H = r.naturalHeight;
  const box = (img, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data;
    const fg = (i) => d[i] < 232 || d[i + 1] < 232 || d[i + 2] < 232; let top = -1, bot = -1;
    for (let y = 0; y < h; y++) { let n = 0; for (let xx = 0; xx < w; xx += 2) if (fg((y * w + xx) * 4)) n++; if (n > 3) { if (top < 0) top = y; bot = y; } }
    if (top < 0) return null; const bh = bot - top; const xs = [];
    for (let y = Math.round(top + bh * 0.04); y < top + bh * 0.11; y++) for (let xx = 0; xx < w; xx++) if (fg((y * w + xx) * 4)) xs.push(xx);
    xs.sort((a, b) => a - b); return { top, bh, cx: xs.length ? (xs[Math.floor(xs.length * 0.2)] + xs[Math.floor(xs.length * 0.8)]) / 2 : w / 2 }; };
  const A = box(o, o.naturalWidth, o.naturalHeight), B = box(r, W, H); if (!A || !B || A.bh < 200 || B.bh < 200) return null;
  const s = B.bh / A.bh; const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.drawImage(o, B.cx - A.cx * s, B.top - A.top * s, o.naturalWidth * s, o.naturalHeight * s);
  return c.toDataURL('image/jpeg', 0.95);
}
async function restoreFace(origSrc, outSrc) {
  if (!(await plainBg(origSrc)) || !(await plainBg(outSrc))) return outSrc; // only safe on plain backgrounds
  const [o, r] = await Promise.all([loadImage(origSrc), loadImage(outSrc)]);
  const W = r.naturalWidth, H = r.naturalHeight;
  if (Math.abs(o.naturalWidth / o.naturalHeight - W / H) > 0.03) { // framing changed: line your photo up with the new one first (same body height and spot), then fix the face
    if (origSrc._aligned) return outSrc;
    const al = await alignBody(o, r); if (!al) return outSrc; const t = new String(al); t._aligned = 1; return restoreFace(t, outSrc);
  }
  const mk = (img) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, W, H); return { c, x, d: x.getImageData(0, 0, W, H).data }; };
  const A = mk(o), B = mk(r);
  // body box in the original (non-white pixels)
  const fg = (d, i) => d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235;
  let top = -1, bot = -1;
  for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x += 2) if (fg(A.d, (y * W + x) * 4)) n++; if (n > 3) { if (top < 0) top = y; bot = y; } }
  if (top < 0) return outSrc;
  const bh = bot - top; if (bh < 300) return outSrc;
  let xs = []; for (let y = top + Math.round(bh * 0.04); y < top + bh * 0.11; y++) for (let x = 0; x < W; x++) if (fg(A.d, (y * W + x) * 4)) xs.push(x);
  if (!xs.length) return outSrc;
  xs.sort((a, b) => a - b); const cx = (xs[Math.floor(xs.length * 0.2)] + xs[Math.floor(xs.length * 0.8)]) / 2;
  const cy = top + bh * 0.072, rx = bh * 0.034, ry = bh * 0.048;
  // template match: grayscale, compare a box around the face
  const g = (d, x, y) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return 255; const i = (y * W + x) * 4; return d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; };
  const step = Math.max(2, Math.round(rx / 12));
  let best = { cost: 1e9 };
  const range = Math.round(bh * 0.03);
  for (const sc of [0.94, 0.97, 1, 1.03, 1.06]) for (let dy = -range; dy <= range; dy += 3) for (let dx = -range; dx <= range; dx += 3) {
    let cost = 0, n = 0;
    for (let v = -ry; v <= ry; v += step) for (let u = -rx; u <= rx; u += step) { cost += Math.abs(g(A.d, cx + u, cy + v) - g(B.d, cx + dx + u * sc, cy + dy + v * sc)); n++; }
    cost /= n; if (cost < best.cost) best = { cost, dx, dy, sc };
  }
  if (best.cost > 20 || best.sc === 0.94 || best.sc === 1.06 || Math.abs(best.dx) >= range - 3 || Math.abs(best.dy) >= range - 3) return outSrc; // couldn't find the face confidently — leave the AI face alone (a bad paste doubles the face)
  // colour-match the original face to the result's lighting
  let ma = [0, 0, 0], mb = [0, 0, 0], n = 0;
  for (let v = -ry * 0.6; v <= ry * 0.6; v += step) for (let u = -rx * 0.6; u <= rx * 0.6; u += step) {
    const ia = (Math.round(cy + v) * W + Math.round(cx + u)) * 4, ib = (Math.round(cy + best.dy + v * best.sc) * W + Math.round(cx + best.dx + u * best.sc)) * 4;
    for (let k = 0; k < 3; k++) { ma[k] += A.d[ia + k]; mb[k] += B.d[ib + k]; } n++;
  }
  const shift = ma.map((m, k) => (mb[k] - m) / n);
  // blend with a soft oval mask
  const out = B.x.getImageData(0, 0, W, H), od = out.data;
  const ncx = cx + best.dx, ncy = cy + best.dy, nrx = rx * best.sc * 1.05, nry = ry * best.sc * 1.05;
  for (let y = Math.floor(ncy - nry); y <= Math.ceil(ncy + nry); y++) for (let x = Math.floor(ncx - nrx); x <= Math.ceil(ncx + nrx); x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const e = ((x - ncx) / nrx) ** 2 + ((y - ncy) / nry) ** 2; if (e >= 1) continue;
    const a = e < 0.45 ? 1 : 1 - (e - 0.45) / 0.55; // solid centre, soft edge
    const sx = Math.round(cx + (x - ncx) / best.sc), sy = Math.round(cy + (y - ncy) / best.sc); const si = (sy * W + sx) * 4, di = (y * W + x) * 4;
    for (let k = 0; k < 3; k++) od[di + k] = od[di + k] * (1 - a) + Math.min(255, Math.max(0, A.d[si + k] + shift[k])) * a;
  }
  B.x.putImageData(out, 0, 0);
  return B.c.toDataURL('image/png');
}
async function toDataJpeg(src, max = 1296, bg = '#ffffff', pad = false) {
  const img = await loadImage(src); const W = img.naturalWidth, H = img.naturalHeight;
  const s = Math.min(1, max / Math.max(W, H)); const w = W * s, h = H * s; let cw = w, ch = h;
  if (pad) { ch = Math.max(h, w * 1.5) * 1.04; cw = ch / 1.5; } // 2:3 canvas with a margin
  const c = document.createElement('canvas'); c.width = Math.round(cw); c.height = Math.round(ch); const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
  return c.toDataURL('image/jpeg', 0.95);
}
// Rule: the AI always gets 3 shop photos of each piece (side by side in one picture), so it sees the real shape.
function garmentPics(it) {
  return [...new Set([it.tryonPic || it.original || it.image, ...(it.refs || [])].filter(Boolean))].slice(0, 3);
}
function multiNote(it) {
  return garmentPics(it).length > 1 ? `The product image shows this SAME single garment in ${garmentPics(it).length} shop photos side by side — use them all together to copy its exact shape, length, drape, slouch, neckline, colour and details. She wears ONE of it. Take the exact COLOUR only from the first (left) photo. ` : '';
}
async function garmentPic(it) {
  const pics = garmentPics(it);
  if (pics.length < 2) return toDataJpeg(pics[0], 1296, '#ffffff');
  const imgs = []; for (const p of pics) { try { imgs.push(await loadImage(p)); } catch {} }
  if (imgs.length < 2) return toDataJpeg(pics[0], 1296, '#ffffff');
  const H = 1024, gap = 32, ws = imgs.map((im) => Math.round(im.naturalWidth * H / im.naturalHeight));
  const c = document.createElement('canvas'); c.width = ws.reduce((a, b) => a + b, 0) + gap * (imgs.length - 1); c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  let left = 0; imgs.forEach((im, i) => { x.drawImage(im, left, 0, ws[i], H); left += ws[i] + gap; });
  return c.toDataURL('image/jpeg', 0.92);
}
async function fashnOne(key, person, garment, prompt) {
  const H = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const body = { model_name: 'tryon-max', inputs: { model_image: person, product_image: garment, prompt, resolution: '1k', generation_mode: store.get('vw.fashnMode', 'balanced'), output_format: 'png', return_base64: true } };
  const r = await fetch('https://api.fashn.ai/v1/run', { method: 'POST', headers: H, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('KEY');
  if (r.status === 429 || /credit/i.test(JSON.stringify(j))) throw new Error('Out of FASHN credits — add more at app.fashn.ai');
  if (!j.id) throw new Error(j.message || j.error || 'Try-on failed');
  for (let i = 0; i < 150; i++) {
    await new Promise((res) => setTimeout(res, i < 3 ? 1500 : 800));
    const s = await (await fetch(`https://api.fashn.ai/v1/status/${j.id}`, { headers: H })).json();
    if (s.status === 'completed') return s.output[0];
    if (s.status === 'failed') { const m = s.error?.message || s.error?.name || 'failed'; throw new Error(/Pose/i.test(m) ? 'Couldn\'t find your body in the photo — use a full-body photo' : m); }
  }
  throw new Error('Try-on timed out — try again');
}
async function showCredits() {
  const el = $('#creditsLeft'); const key = store.get('vw.fashnKey', ''); if (!el || !key) return;
  try { const j = await fetch('https://api.fashn.ai/v1/credits', { headers: { Authorization: `Bearer ${key}` } }).then((r) => r.json()); const n = j?.credits?.total; if (typeof n === 'number') { state.creditsLeft = n; paintCost(); el.textContent = `${n} credits left`; el.classList.toggle('low', n < 6); } } catch {}
}
function tryonMsg(t) { const el = $('#tryonMsg'); if (el) { el.textContent = t; el.hidden = !t; } }
async function runFashnTryon() {
  const R = state.room; const key = store.get('vw.fashnKey', '');
  if (!key) return openKeyModal();
  const pose = state.poses.find((p) => p.id === R.poseId);
  if (!pose) return toast('Add a photo of you first', 2600);
  R.layers = dedupeLayers(R.layers); R.layers.forEach((l) => { l.baked = false; }); renderRoom();
  const all = [...new Set(R.layers.map((l) => l.itemId))].map(getItem).filter(Boolean);
  const items = all.filter((it) => !OVERLAY_CATS.has(it.category)); const skipped = [];
  if (!items.length) return toast('Tap a piece to try on first', 3000);
  const zOf = (it) => Math.max(...R.layers.filter((l) => l.itemId === it.id).map((l) => l.z));
  items.sort((a, b) => zOf(a) - zOf(b)); // front/back you set decides what goes on top
  items.sort((a, b) => (FASHN_ORDER[a.category] ?? 9) - (FASHN_ORDER[b.category] ?? 9)); // dress/bottoms first, then tops, jacket, shoes, bag
  { const full = !pantsInBoots() && items.find((it) => it.category === 'bottoms' && !/crop|capri|ankle|short|culotte|7\/8/i.test(it.name || '')); const sh = items.findIndex((it) => it.category === 'shoes'); if (full && sh > 0) items.unshift(...items.splice(sh, 1)); } // full-length pants go on AFTER shoes so they fall over them
  const btn = $('#tryonBtn'); btn.disabled = true; $('#room').classList.add('busy'); tryonMsg('');
  const mode = store.get('vw.fashnMode', 'balanced'); const per = { fast: 1, balanced: 2, quality: 3 }[mode] || 2;
  try {
    // reuse pieces already put on this photo (same order) - only new pieces cost a run
    state.fashnCache = state.fashnCache || new Map();
    const ids = items.map((it) => it.id); let start = 0; let person = null;
    for (let k = ids.length; k > 0; k--) { const hit = state.fashnCache.get(`${mode}${store.get('vw.coat', 'open')}|v6${pantsInBoots() ? 'ib' : ''}|${pose.id}|${ids.slice(0, k).join(',')}`); if (hit) { person = hit; start = k; break; } }
    const need = (items.length - start) * per;
    if (need) {
      btn.textContent = 'Checking credits…';
      const cr = await fetch('https://api.fashn.ai/v1/credits', { headers: { Authorization: `Bearer ${key}` } }).then((r) => (r.status === 401 ? { bad: 1 } : r.json())).catch(() => null);
      if (cr && cr.bad) throw new Error('KEY');
      const left = cr && cr.credits ? cr.credits.total : undefined;
      if (typeof left === 'number' && left < need) throw new Error(`Out of FASHN credits — this outfit needs ${need}, you have ${left}. Add more at app.fashn.ai, then try again.`);
    }
    const basePhoto = await toDataJpeg(pose.base ? await trimToBody(pose.image) : (await plainBg(pose.image)) ? await legFix(await trimToBody(pose.image)) : pose.image, 1296, '#ffffff', true);
    if (!person) person = basePhoto;
    for (let i = start; i < items.length; i++) { const it = items[i];
      btn.textContent = items.length > 1 ? `Dressing you… ${i + 1}/${items.length}` : 'Dressing you…';
      const garment = await garmentPic(it);
      const coatHow = it.category === 'outerwear' ? (store.get('vw.coat', 'open') === 'open' ? ' Worn OPEN — unzipped and unbuttoned, hanging loose and open at the front so the outfit underneath clearly shows.' : ' Worn fully zipped and buttoned up.') : '';
      const fullLen = it.category === 'bottoms' && !pantsInBoots() && !/crop|capri|ankle|short|culotte|7\/8/i.test(it.name || '');
      const len = fullLen ? ' FULL-LENGTH pants: the legs go all the way down to her feet and the hems fall over the tops of her shoes or boots, slightly stacking. NOT cropped, NOT ankle length — ignore the length of the pants she is wearing in the input photo.' : '';
      const fit = it.category === 'shoes' && pantsInBoots() && /boot/i.test(it.name || '') ? ' ' + STYLES.inboots.how : it.category === 'outerwear' ? ' The jacket fits naturally over what she is wearing, real shoulders and sleeves, natural drape and folds.' : it.category === 'tops' ? ' Fits her naturally with real drape, sleeves and hem sitting realistically on her body.' : '';
      const prompt = `${it.name || catLabel(it.category)}.${it.tryonNote ? ' ' + it.tryonNote : ''}${coatHow}${fit}${len} ${multiNote(it)}Copy the garment's exact shape from the product photo — same fit, length, neckline, sleeve shape and waist (cinched, fitted or oversized exactly as shown); do not make it looser.${noBelly()} Her feet and shoes are natural full adult size, not tiny or pointed. Keep her face, skin, hair, body shape, proportions and pose exactly the same as the input photo — do not redraw or retouch the face. Plain white background.`;
      let out;
      try { out = await fashnOne(key, person, garment, prompt); }
      catch (e) { if (e.message === 'KEY' || /credits/.test(e.message)) throw e; out = await fashnOne(key, person, garment, prompt); } // one automatic retry
      person = out.startsWith('data:') ? out : `data:image/png;base64,${out}`;
      state.fashnCache.set(`${mode}${store.get('vw.coat', 'open')}|v6${pantsInBoots() ? 'ib' : ''}|${pose.id}|${ids.slice(0, i + 1).join(',')}`, person);
    }
    try { btn.textContent = 'Fixing your face…'; person = await restoreFace(basePhoto, person); } catch (e) { console.warn('face restore skipped', e); }
    state.lastRaw = person;
    const cut = await keepSubject(await tryonCut(person));
    const image = await downscale(cut, 1400);
    state.tryonRaw = await downscale(person, 1800);
    state.tryon = { sig: tryonSig(), image }; store.set('vw.tryon', state.tryon); rememberTryon();
    R.active = null;
    toast(skipped.length ? `Here you go ✨ (${skipped.map((s) => catLabel(s.category).toLowerCase()).join(', ')} can't be tried on yet)` : 'Here you go ✨', 3800);
  } catch (e) {
    console.warn(e);
    if (e.message === 'KEY') { store.set('vw.fashnKey', ''); toast('That FASHN key didn\'t work — paste a new one', 4200); openKeyModal(); }
    else { toast(e.message || 'Try-on failed', 6000); tryonMsg(e.message || 'Try-on failed — tap to try again.'); }
  } finally { btn.disabled = false; $('#room').classList.remove('busy'); renderFigure(); showCredits(); }
}
// Styling you can change on the AI photo (each is one AI step on the current photo).
function wearingBoots() { return state.room.layers.some((x) => { const it = getItem(x.itemId); return it?.category === 'shoes' && /boot/i.test(it.name || ''); }); }
function pantsInBoots() {
  if (!wearingBoots()) return false;
  const v = store.get('vw.inBoots', null); if (v !== null) return v;
  return state.room.layers.some((x) => { const it = getItem(x.itemId); return it?.category === 'bottoms' && /legging|skinny|jegging/i.test(it.name || ''); });
}
const STYLES = {
  tuck: { label: 'Tuck top in', piece: 'top', how: 'The top is neatly TUCKED INTO the waistband of the bottoms, waistband visible.' },
  untuck: { label: 'Top over pants', piece: 'top', how: 'The top is worn UNTUCKED, hanging loose over the waistband of the bottoms.' },
  inboots: { label: 'Pants in boots', piece: 'shoes', how: 'These boots are pulled on OVER her pants: the pant legs are tucked INSIDE the boot shafts. From the boot tops down, ONLY the boots show — the full boot shaft is visible up to its top edge, with no pant fabric over, around or covering the boots. The pants only show above the boots.' },
  overshoes: { label: 'Pants over shoes', piece: 'low', how: 'FULL-LENGTH pants: the pant legs go all the way down and fall OVER the shoes / boots, covering the boot shafts, hems resting on the tops of the feet.' },
};
function styleBtns(l) {
  const cat = getItem(l.itemId)?.category; const per = { fast: 1, balanced: 2, quality: 3 }[store.get('vw.fashnMode', 'balanced')] || 2;
  const has = (...c) => state.room.layers.some((x) => c.includes(getItem(x.itemId)?.category));
  const keys = [];
  if ((cat === 'tops' || cat === 'bottoms' || cat === 'skirts' || cat === 'shorts') && has('tops') && has('bottoms', 'skirts', 'shorts')) keys.push('tuck', 'untuck');
  if ((cat === 'shoes' || cat === 'bottoms') && has('bottoms') && state.room.layers.some((x) => getItem(x.itemId)?.category === 'shoes' && /boot/i.test(getItem(x.itemId)?.name || ''))) keys.push('inboots', 'overshoes');
  if (!keys.length) return '<span class="lt-empty">This piece is part of the AI photo.</span>';
  return keys.map((k) => `<button class="ghost small" data-ltb="style" data-style="${k}">${STYLES[k].label} · ${per} cr</button>`).join('');
}
async function restyleAI(key) {
  const S = STYLES[key]; const apiKey = store.get('vw.fashnKey', ''); if (!apiKey) return openKeyModal();
  const pose = state.poses.find((p) => p.id === state.room.poseId); const t = currentTryon(); if (!S || !pose || !t) return;
  const pick = (...c) => state.room.layers.map((x) => getItem(x.itemId)).find((it) => it && c.includes(it.category));
  const it = S.piece === 'top' ? pick('tops') : S.piece === 'shoes' ? state.room.layers.map((x) => getItem(x.itemId)).find((i) => i?.category === 'shoes' && /boot/i.test(i.name || '')) : pick('bottoms'); if (!it) return;
  if (key === 'inboots') store.set('vw.inBoots', true); if (key === 'overshoes') store.set('vw.inBoots', false);
  const btn = $('#tryonBtn'); btn.disabled = true; btn.textContent = 'Restyling…'; $('#room').classList.add('busy');
  try {
    const person = state.lastRaw || await toDataJpeg(t, 1296, '#ffffff');
    const garment = await garmentPic(it);
    const prompt = `${it.name || catLabel(it.category)}.${it.tryonNote ? ' ' + it.tryonNote : ''} ${multiNote(it)}${S.how}${noBelly()} Keep everything else in the outfit exactly the same. Keep her face, skin, hair, body shape, proportions and pose exactly the same — do not redraw the face. Plain white background.`;
    let out;
    try { out = await fashnOne(apiKey, person, garment, prompt); } catch (e) { if (e.message === 'KEY' || /credits/.test(e.message)) throw e; out = await fashnOne(apiKey, person, garment, prompt); }
    let img = out.startsWith('data:') ? out : `data:image/png;base64,${out}`;
    try { img = await restoreFace(await toDataJpeg(pose.base ? await trimToBody(pose.image) : (await plainBg(pose.image)) ? await legFix(await trimToBody(pose.image)) : pose.image, 1296, '#ffffff', true), img); } catch {}
    state.lastRaw = img;
    const image = await downscale(await keepSubject(await tryonCut(img)), 1400);
    state.tryonRaw = await downscale(img, 1800);
    state.tryon = { sig: tryonSig(), image }; store.set('vw.tryon', state.tryon); rememberTryon();
    toast('Done ✨', 2200);
  } catch (e) {
    console.warn(e);
    if (e.message === 'KEY') { store.set('vw.fashnKey', ''); openKeyModal(); } else toast(e.message || 'Could not restyle', 5000);
  } finally { btn.disabled = false; $('#room').classList.remove('busy'); renderFigure(); showCredits(); }
}
// No belly showing — unless she's wearing an actual crop top.
function noBelly() {
  const tops = state.room.layers.map((x) => getItem(x.itemId)).filter((it) => it && ['tops', 'outerwear', 'dresses', 'sets'].includes(it.category));
  if (tops.some((it) => /crop|bralette|bra top|tube top|bandeau/i.test(`${it.name || ''} ${it.tryonNote || ''}`))) return ' This is a crop top: show the midriff exactly as the product photo does.';
  return ' NO belly, stomach or midriff skin may show anywhere — every top must reach down to the waistband of the bottoms and overlap it (a cropped top just meets the waistband, no gap).';
}
async function wearBagAI(l) {
  const key = store.get('vw.fashnKey', ''); if (!key) return openKeyModal();
  const it = getItem(l.itemId); const pose = state.poses.find((p) => p.id === state.room.poseId);
  const t = currentTryon(); if (!it || !pose || !t) return;
  const btn = $('#tryonBtn'); btn.disabled = true; btn.textContent = 'Putting the bag on…'; $('#room').classList.add('busy');
  try {
    const person = state.lastRaw || await toDataJpeg(t, 1296, '#ffffff');
    const garment = await toDataJpeg(it.tryonPic || it.image, 1296, '#ffffff');
    const prompt = `${it.name || 'Handbag'}. She carries this bag on her shoulder: the strap goes over her shoulder and the bag sits tucked in against her side, under her arm, with her arm resting naturally over the front of it. Realistic size and shadows. Keep her outfit, face, skin, hair, body shape, proportions and pose exactly the same — do not redraw the face. Plain white background.`;
    let out;
    try { out = await fashnOne(key, person, garment, prompt); } catch (e) { if (e.message === 'KEY' || /credits/.test(e.message)) throw e; out = await fashnOne(key, person, garment, prompt); }
    let img = out.startsWith('data:') ? out : `data:image/png;base64,${out}`;
    try { img = await restoreFace(await toDataJpeg(pose.base ? await trimToBody(pose.image) : (await plainBg(pose.image)) ? await legFix(await trimToBody(pose.image)) : pose.image, 1296, '#ffffff', true), img); } catch {}
    state.lastRaw = img;
    const image = await downscale(await keepSubject(await tryonCut(img)), 1400);
    state.tryonRaw = await downscale(img, 1800);
    l.baked = true; l.behind = false; state.room.active = null; saveUI();
    state.tryon = { sig: tryonSig(), image }; store.set('vw.tryon', state.tryon); rememberTryon();
    toast('Bag on ✨', 2500);
  } catch (e) {
    console.warn(e);
    if (e.message === 'KEY') { store.set('vw.fashnKey', ''); openKeyModal(); } else toast(e.message || 'Could not put the bag on', 5000);
  } finally { btn.disabled = false; $('#room').classList.remove('busy'); renderFigure(); showCredits(); }
}
async function runTryon() {
  const engine = store.get('vw.tryonEngine', 'fashn');
  if (engine === 'fashn') return runFashnTryon();
  if (engine === 'free') return runFreeTryon();
  const R = state.room; const key = store.get('vw.geminiKey', '');
  if (!key) return openKeyModal();
  const pose = state.poses.find((p) => p.id === R.poseId);
  if (!pose) return toast('Add a photo of you first', 2600);
  const items = [...new Set(R.layers.map((l) => l.itemId))].map(getItem).filter(Boolean);
  if (!items.length) return toast('Tap the pieces you want to try on first', 2600);
  const btn = $('#tryonBtn'); btn.disabled = true; btn.textContent = 'Dressing you…'; $('#room').classList.add('busy');
  try {
    const model = await pickGeminiModel(key);
    const stage = await buildStage(pose.image);
    const refs = [stage.url, ...(pose.face ? [pose.face] : [])];
    const off = refs.length + 1;
    const list = items.map((it, i) => `Image ${i + off}: ${it.name || catLabel(it.category)} (${catLabel(it.category)})`).join('\n');
    const prompt = `Edit Image 1. It shows me standing on a solid green (#00FF00) background.${pose.face ? ' Image 2 is a close-up of my face for reference.' : ''} Replace ONLY my clothes with the exact pieces from these shop photos, worn together as one outfit:
${list}
Those shop photos may show a different model — copy only the garment (cut, color, pattern, texture, length), never that model.

Strict rules:
- Keep the exact same framing: same canvas, my head, face and hair in exactly the same position and size, same pose, same body shape and proportions, same skin tone. Do not move, zoom, crop or re-center me. Do not change my face.
- Below where Image 1 ends at my feet, complete my legs and feet with the outfit's shoes (or simple neutral shoes if none) inside the green area, so I'm shown head to toe.
- Image 1 was taken from slightly above, which makes my legs look shorter and narrow toward the feet. Fix that: give my legs and feet natural, straight, full-width proportions as if photographed from hip height — calves, ankles and feet must NOT taper or shrink, feet are normal adult size, and use the extra green space at the bottom so legs are full length.
- The clothes fit my body realistically with natural drape, folds and shadows, in the exact colors and patterns of the shop photos. No bag unless a bag is in the outfit.
- Keep the background flat solid pure green (#00FF00) everywhere, no shadows.`;
    const parts = [{ text: prompt }];
    for (const [k, src] of refs.entries()) parts.push({ inline_data: { mime_type: 'image/jpeg', data: await toJpegB64(src, k === 0 ? 1536 : 768, '#00ff00') } });
    for (const it of items) parts.push({ inline_data: { mime_type: 'image/jpeg', data: await toJpegB64(it.original || it.image, 768) } });
    const body = { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '2:3' } } };
    let res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
    if (res.status === 400) { delete body.generationConfig.imageConfig; res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) }); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = j.error?.message || res.statusText;
      if (res.status === 429) throw new Error('Free limit reached for now — try again in a minute (or tomorrow if it says daily).');
      if (res.status === 403 || /API key/i.test(msg)) { store.set('vw.geminiKey', ''); throw new Error('That key didn\'t work — paste a new one.'); }
      throw new Error(msg);
    }
    const out = (j.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData || p.inline_data);
    if (!out) throw new Error('The AI didn\'t send an image back — try again.');
    const d = out.inlineData || out.inline_data;
    state.lastRaw = `data:${d.mimeType || d.mime_type};base64,${d.data}`; state.lastStage = stage;
    const withFace = await pasteRealHead(`data:${d.mimeType || d.mime_type};base64,${d.data}`, stage, pose.image, pose.headFrac || 0.165);
    const image = await downscale(await keystone(await keyOutGreen(withFace)), 1400);
    state.tryon = { sig: tryonSig(), image }; store.set('vw.tryon', state.tryon); rememberTryon();
    R.active = null; renderFigure(); toast('Here you go ✨');
  } catch (e) {
    console.warn(e); toast(e.message === 'KEY' ? 'That key didn\'t work — paste a new one.' : e.message || 'Try-on failed', 4200);
    if (e.message === 'KEY') store.set('vw.geminiKey', '');
  } finally { btn.disabled = false; $('#room').classList.remove('busy'); renderFigure(); showCredits(); }
}

/* ================= PLANNED ================= */
const planLabel = (o) => o.plan?.type === 'day' ? o.plan.day : o.plan?.type === 'video' ? `Video${o.plan.video ? ' · ' + o.plan.video : ''}` : 'Saved look';
function lookCard(o) {
  const pieces = o.itemIds.map(getItem).filter(Boolean);
  return `<article class="look" data-outfit="${o.id}">
    <div class="look-grip" draggable="true" title="Drag to move">⠿</div>
    <div class="look-stage" title="Tap to ask the AI for a tweak · drag the bag to move it"><div class="mini-platform"></div><div class="figure">${figureHTML(o.poseId, o.layers, false, o.tryon)}</div>
      ${state.tweaking === o.id ? '<div class="tweak-busy"><span>Making your tweak…</span></div>' : ''}
      ${o.tryonPrev && state.tweaking !== o.id ? '<button class="tweak-undo" data-tweakundo>↶ Undo tweak</button>' : ''}</div>
    <div class="look-info">
      <div class="eyebrow">${esc(planLabel(o))}</div>
      <h3 class="ed" contenteditable="plaintext-only" spellcheck="false" data-edit-outfit="name" data-ph="Outfit name">${esc(o.name)}</h3>
      <p class="where"><span>Wear to</span><span class="ed" contenteditable="plaintext-only" data-edit-outfit="where" data-ph="add where">${esc(o.where || '')}</span></p>
      <p class="note ed" contenteditable="plaintext-only" data-edit-outfit="note" data-ph="Add a note">${esc(o.note || '')}</p>
      <div class="tagged">
        <div class="tagged-label">Tag in TikTok Shop · ${pieces.length} piece${pieces.length === 1 ? '' : 's'}</div>
        ${pieces.map((it) => `<div class="tag-row"><img src="${it.image}" alt="">
          <div class="t-name"><span class="ed" contenteditable="plaintext-only" data-edit-item="name" data-item="${it.id}" data-ph="Name">${esc(it.name || catLabel(it.category))}</span><small>${esc(catLabel(it.category))} · <span class="ed" contenteditable="plaintext-only" data-edit-item="price" data-item="${it.id}" data-ph="add price">${esc(it.price || '')}</span>${it.status === 'coming' ? ' · on the way' : ''}</small></div>
          <div class="t-act">${it.link ? `<a class="link-btn" href="${esc(it.link)}" target="_blank" rel="noopener">Open</a><button class="link-btn" data-copy="${esc(it.link)}">Copy link</button>` : `<button class="link-btn" data-edit="${it.id}">Add link</button>`}</div>
        </div>`).join('')}
        <div class="look-total"><span>Outfit total</span><b>${money(sumPrice(pieces))}</b></div>
        ${pieces.some((it) => !priceNum(it)) ? `<div class="look-total-note">Not counted (no price yet): ${pieces.filter((it) => !priceNum(it)).map((it) => esc(it.name || catLabel(it.category))).join(', ')}</div>` : ''}
      </div>
      <div class="look-actions">
        <button class="ghost small" data-act="copyall">Copy all links</button>
        <button class="ghost small" data-act="download">Download image</button>
        <button class="ghost small" data-act="edit">Edit in changing room</button>
        <button class="danger-link small" data-act="delete">Delete</button>
      </div>
    </div>
  </article>`;
}
/* ------------- Together: the two of you side by side, and the shoot day -------------
Her ask (Nov 20 2026): each sister works in her own closet, and Together puts the
two of them next to each other — for a shoot, outfit beside outfit under the stop's
own location photo. The stops come from the LS Photoshoots board, where both
sisters' run-of-day columns already name the same stops ("2 · 1:50 · CAMINO REAL"),
so the number pairs them. The location photos are the real covers off that board,
not stand-ins. */
const SIS_COL = { kiabeth: 'k1', kiaredza: 'k2' };
function miniLook(o) {
  const pieces = o.itemIds.map(getItem).filter(Boolean);
  const toBuy = pieces.filter((it) => !isPurchased(it));
  return `<article class="mini-look" data-mini="${o.id}">
    <div class="mini-stage"><div class="mini-platform"></div><div class="figure">${figureHTML(o.poseId, o.layers, false, o.tryon)}</div></div>
    <div class="mini-info"><div class="eyebrow">${esc(planLabel(o))}</div>
      <h4>${esc(o.name || 'Untitled look')}</h4>
      ${o.where ? `<p>${esc(o.where)}</p>` : ''}
      <small>${pieces.length} piece${pieces.length === 1 ? '' : 's'}${toBuy.length ? ' · ' + money(sumPrice(toBuy)) + ' to buy' : ' · all owned'}</small></div>
  </article>`;
}
function renderTogether() {
  const mode = state.togMode === 'shoot' ? 'shoot' : 'side';
  $('#planTabs').innerHTML = [['side', 'Side by side'], ['shoot', 'Shoot day']]
    .map(([id, l]) => `<button class="chip ${mode === id ? 'on' : ''}" data-togmode="${id}">${l}</button>`).join('');
  if (mode === 'shoot') return renderShoot();
  const list = $('#plannedList');
  const pair = state.outfits.filter((o) => ownerOf(o) === 'together').sort(lookOrder);
  list.innerHTML = `<div class="tog-grid">${PEOPLE.map((p) => {
    const os = state.outfits.filter((o) => ownerOf(o) === p.id).sort(lookOrder);
    return `<section class="tog-col"><h2>${esc(p.name)}'s${p.id === ME ? ' <small>(you)</small>' : ''}<span>${os.length}</span></h2>
      ${os.length ? os.map(miniLook).join('') : '<div class="tog-empty">No looks locked in yet</div>'}</section>`;
  }).join('')}</div>${pair.length ? `<section class="plan-group"><h2 class="plan-group-title">Planned as a pair</h2><div class="looks">${pair.map(lookCard).join('')}</div></section>` : ''}`;
  wireLookBags(list);
}
async function loadStops(force) {
  if (state.stops && !force) return state.stops;
  const r = await api('/api/data?op=wardrobe_itinerary', { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not read the shoot board');
  state.stops = j.stops || [];
  return state.stops;
}
const pinKey = (n, who) => `${n}|${who}`;
function pinnedLook(n, who) { const id = state.pins[pinKey(n, who)]; return id && state.outfits.find((o) => o.id === id); }
function noteLines(txt) {
  return String(txt || '').split(/\n+/).map((l) => l.trim()).filter((l) => l && /[📍⭐👗🕐]/.test(l)).slice(0, 4);
}
function renderShoot() {
  const list = $('#plannedList');
  if (!state.stops) {
    list.innerHTML = '<div class="empty"><h3>Reading the shoot board…</h3><p>Stops, times and locations come from LS Photoshoots.</p></div>';
    loadStops().then(renderShoot).catch((e) => {
      list.innerHTML = `<div class="empty"><h3>Couldn't read the shoot board</h3><p>${esc(e.message)}</p><button class="primary" data-shootretry>Try again</button></div>`;
    });
    return;
  }
  if (!state.stops.length) {
    list.innerHTML = '<div class="empty"><h3>No shoot day on the board yet</h3><p>Add numbered stops to a "run of day" column on LS Photoshoots and they show up here.</p><button class="primary" data-shootretry>Check again</button></div>';
    return;
  }
  const optsFor = (who) => state.outfits.filter((o) => ownerOf(o) === who).sort(lookOrder);
  list.innerHTML = `<div class="shoot-head"><div><small>From the board</small><b>LS Photoshoots · run of day</b></div>
      <p>${state.stops.length} stops. Each sister's look for that stop sits beside the other's, under the location. Pin one of your own locked-in looks to a stop to plan against it.</p>
      <button class="ghost small" data-shootretry>Refresh from the board</button></div>` +
    state.stops.map((st) => {
      const cell = (who) => {
        const col = st[SIS_COL[who]]; const pin = pinnedLook(st.n, who); const os = optsFor(who);
        return `<div class="shoot-cell"><div class="shoot-who">${esc(personName(who))}${who === ME ? ' <small>(you)</small>' : ''}</div>
          ${col && col.cover ? `<img class="shoot-look" src="${esc(col.cover)}" alt="${esc(personName(who))} at ${esc(st.place)}" loading="lazy">`
            : '<div class="shoot-look none">No look on the board for this stop</div>'}
          ${col ? `<ul class="shoot-note">${noteLines(col.note).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
          <label class="shoot-pin"><span>Pin a closet look</span>
            <select data-pin="${st.n}|${who}"><option value="">None</option>${os.map((o) => `<option value="${o.id}"${pin && pin.id === o.id ? ' selected' : ''}>${esc(o.name || planLabel(o))}</option>`).join('')}</select></label>
          ${pin ? miniLook(pin) : ''}</div>`;
      };
      return `<section class="shoot-stop">
        <header class="shoot-loc">${st.location ? `<img src="${esc(st.location)}" alt="${esc(st.place)}" loading="lazy">` : ''}
          <div><span class="shoot-n">${st.n}</span><b>${esc(st.place)}</b>${st.time ? `<small>${esc(st.time)}</small>` : ''}</div></header>
        ${(st.shots || []).length > 1 ? `<div class="shoot-strip">${st.shots.map((sh) => `<figure><img src="${esc(sh.cover)}" alt="" loading="lazy"><figcaption>${esc(String(sh.name).replace(/^\s*\d{1,2}:\d{2}\s*[·•]\s*/, ''))}</figcaption></figure>`).join('')}</div>` : ''}
        <div class="shoot-pair">${cell('kiabeth')}${cell('kiaredza')}</div>
      </section>`;
    }).join('');
}
function renderPlanned() {
  renderWhose();
  if (state.whose === 'together') return renderTogether();
  const mine = state.outfits.filter((o) => ownerOf(o) === state.whose);
  const groups = [
    ...DAYS.map((d) => ({ id: d, label: d, match: (o) => o.plan?.type === 'day' && o.plan.day === d })),
    { id: 'video', label: 'Videos', match: (o) => o.plan?.type === 'video' },
    { id: 'none', label: 'Saved looks', match: (o) => !o.plan || o.plan.type === 'none' },
  ];
  const tabs = [{ id: 'all', label: 'All' }, ...groups.map((g) => ({ id: g.id, label: g.id === 'video' || g.id === 'none' ? g.label : g.label.slice(0, 3) }))];
  $('#planTabs').innerHTML = tabs.map((t) => {
    const n = t.id === 'all' ? mine.length : mine.filter(groups.find((g) => g.id === t.id).match).length;
    return `<button class="chip ${state.planFilter === t.id ? 'on' : ''}" data-plan-filter="${t.id}">${t.label}<span>${n}</span></button>`;
  }).join('');
  const list = $('#plannedList'); wirePlanDrag();
  if (!mine.length) {
    list.innerHTML = `<div class="empty"><h3>No ${state.whose === 'together' ? 'outfits together' : personName(state.whose) + "'s outfits"} yet</h3><p>Pick pieces in your closet, try them on in the changing room, then tap "Lock in outfit".</p><button class="primary" data-goto="closet">Start in the closet</button></div>`;
    return;
  }
  const shown = groups.filter((g) => state.planFilter === 'all' || g.id === state.planFilter)
    .map((g) => ({ g, os: mine.filter(g.match).sort(lookOrder) }))
    .filter((x) => x.os.length || state.planFilter === 'all');
  const allPieces = uniqItems(shown.flatMap(({ os }) => os.flatMap((o) => o.itemIds.map(getItem))));
  const slots = shown.reduce((n, { os }) => n + os.reduce((m, o) => m + new Set(o.itemIds).size, 0), 0);
  const toBuy = allPieces.filter((it) => !isPurchased(it)); const noPrice = toBuy.filter((it) => !priceNum(it));
  const summary = shown.some(({ os }) => os.length) ? `<div class="checkout-sum">
    <div><small>Real checkout total · ${toBuy.length} piece${toBuy.length === 1 ? '' : 's'} to buy</small><b>${money(sumPrice(toBuy))}</b></div>
    <div><small>All pieces in these outfits</small><b>${allPieces.length}</b></div>
    <p>${slots > allPieces.length ? `Repeats counted once (${slots - allPieces.length} repeat${slots - allPieces.length === 1 ? '' : 's'} across outfits). ` : ''}Pieces you already own or ordered aren't included.${noPrice.length ? ` No price yet: ${noPrice.map((it) => esc(it.name || catLabel(it.category))).join(', ')}.` : ''} Drag outfits to move them.</p>
  </div>` : '';
  list.innerHTML = shown.length
    ? summary + shown.map(({ g, os }) => `<section class="plan-group${os.length ? '' : ' drop-only'}" data-group="${g.id}"><h2 class="plan-group-title">${g.label}</h2><div class="looks">${os.map(lookCard).join('')}${os.length ? '' : '<div class="look-drop">Drop here</div>'}</div></section>`).join('')
    : `<div class="empty"><h3>Nothing planned here</h3><p>No outfits for this filter yet.</p></div>`;
}
const lookOrder = (a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt);
// Drag a look to a new spot (or onto another day / Videos / Saved looks) — the order is saved.
function planForGroup(o, gid) {
  if (DAYS.includes(gid)) return { ...(o.plan || {}), type: 'day', day: gid };
  if (gid === 'video') return { ...(o.plan || {}), type: 'video' };
  return { ...(o.plan || {}), type: 'none' };
}
function groupOf(o) { return o.plan?.type === 'day' ? o.plan.day : o.plan?.type === 'video' ? 'video' : 'none'; }
async function dropLook(id, gid, beforeId) {
  const o = state.outfits.find((x) => x.id === id); if (!o) return;
  if (groupOf(o) !== gid) o.plan = planForGroup(o, gid);
  const list = state.outfits.filter((x) => x !== o && groupOf(x) === gid && ownerOf(x) === ownerOf(o)).sort(lookOrder);
  const at = beforeId ? list.findIndex((x) => x.id === beforeId) : -1;
  list.splice(at < 0 ? list.length : at, 0, o);
  list.forEach((x, i) => { x.order = i + 1; });
  for (const x of list) await DB.put('outfits', x);
  renderPlanned();
}
// Click any words on a planned outfit to change them (saved when you click away or press Enter).
async function saveInlineEdit(el) {
  const v = el.textContent.replace(/\s+/g, ' ').trim();
  if (el.dataset.editOutfit) {
    const o = state.outfits.find((x) => x.id === el.closest('.look')?.dataset.outfit); if (!o) return;
    const f = el.dataset.editOutfit; const nv = f === 'name' ? (v || 'Untitled outfit') : v;
    if ((o[f] || '') === nv) return; o[f] = nv; o.updatedAt = Date.now(); await DB.put('outfits', o);
  } else if (el.dataset.editItem) {
    const it = getItem(el.dataset.item); if (!it) return;
    const f = el.dataset.editItem; if ((it[f] || '') === v) return; it[f] = v; await DB.put('items', it);
  } else return;
  toast('Saved ✓', 1200); renderPlanned();
}
/* ---------- tap an outfit photo: ask the AI for a tweak ---------- */
const TWEAK_PIECES = [
  ['outerwear', /jacket|coat|blazer|puffer|parka|trench|vest/i], ['dresses', /dress/i], ['sets', /\bset\b|jumpsuit|romper/i],
  ['skirts', /skirt/i], ['shorts', /shorts/i], ['bottoms', /pant|legging|jean|trouser|jogger/i],
  ['shoes', /boot|shoe|heel|sneaker|loafer|flat|sandal/i], ['tops', /shirt|top|sweater|blouse|tee|cardigan|knit|hoodie|tank|cami|bodysuit|waist|stomach|back|sleeve|hem|neck|tight|loose|fit|hourglass/i],
];
function tweakPiece(o, text) {
  const pieces = o.itemIds.map(getItem).filter((it) => it && !OVERLAY_CATS.has(it.category));
  const words = text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  const byName = pieces.map((it) => [it, words.filter((w) => (it.name || '').toLowerCase().includes(w)).length]).sort((a, b) => b[1] - a[1]);
  if (byName[0] && byName[0][1] > 0) return byName[0][0];
  for (const [cat, rx] of TWEAK_PIECES) if (rx.test(text)) { const it = pieces.find((p) => p.category === cat); if (it) return it; }
  return pieces.find((p) => p.category === 'tops') || pieces[0];
}
function openTweak(o, stage) {
  closeTweak();
  const mode = store.get('vw.fashnMode', 'balanced'); const cost = { fast: 1, balanced: 2, quality: 3 }[mode] || 2;
  const b = document.createElement('div'); b.className = 'tweak-bubble'; b.dataset.outfit = o.id;
  b.innerHTML = `<div class="tw-head"><b>Tweak this look</b><button class="tw-x" data-tweakclose aria-label="Close">✕</button></div>
    <textarea rows="3" placeholder="e.g. Cinch the plaid shirt in at the back a little so it shapes my waist — more hourglass, not skin-tight"></textarea>
    <div class="tw-foot"><span class="tw-cost">Uses ${cost} FASHN credit${cost === 1 ? '' : 's'} · only after you tap Make it</span><button class="primary small" data-tweakgo>Make it</button></div>
    <p class="tw-tip">Moving the bag is free — just drag it on the photo.</p>`;
  stage.appendChild(b); setTimeout(() => b.querySelector('textarea').focus(), 30);
}
function closeTweak() { $$('.tweak-bubble').forEach((b) => b.remove()); }
async function runTweak(o, text) {
  const apiKey = store.get('vw.fashnKey', ''); if (!apiKey) return openKeyModal();
  const it = tweakPiece(o, text); if (!it || !o.tryon) return toast('This outfit has no AI photo to tweak yet', 3000);
  const pose = state.poses.find((p) => p.id === o.poseId);
  state.tweaking = o.id; state.planBusy = true; renderPlanned();
  try {
    const person = await toDataJpeg(o.tryon, 1296, '#ffffff', true);
    const garment = await garmentPic(it);
    const prompt = `${it.name || catLabel(it.category)}.${it.tryonNote ? ' ' + it.tryonNote : ''} ${multiNote(it)}CHANGE ONLY THIS: ${text}. It's a styling illusion (like it's pinned or tied at the back) — keep the garment's colour, pattern, fabric and details exactly the same. Keep everything else in the outfit exactly the same. Keep her face, skin, hair, body shape, proportions and pose exactly the same — do not redraw the face. Plain white background.`;
    let out;
    try { out = await fashnOne(apiKey, person, garment, prompt); } catch (e) { if (e.message === 'KEY' || /credits/.test(e.message)) throw e; out = await fashnOne(apiKey, person, garment, prompt); }
    let img = out.startsWith('data:') ? out : `data:image/png;base64,${out}`;
    if (pose) { try { img = await restoreFace(await toDataJpeg(pose.base ? await trimToBody(pose.image) : (await plainBg(pose.image)) ? await legFix(await trimToBody(pose.image)) : pose.image, 1296, '#ffffff', true), img); } catch {} }
    const image = await downscale(await keepSubject(await tryonCut(img)), 1400);
    o.tryonPrev = o.tryon; o.tryon = image; o.tweaks = [...(o.tweaks || []), { text, at: Date.now() }]; o.updatedAt = Date.now();
    await DB.put('outfits', o); toast('Tweak done ✨ — tap Undo tweak if you liked it better before', 3800);
  } catch (e) {
    console.warn(e);
    if (e.message === 'KEY') { store.set('vw.fashnKey', ''); openKeyModal(); } else toast(e.message || 'Could not make that tweak', 5000);
  } finally { state.tweaking = null; state.planBusy = false; renderPlanned(); showCredits(); }
}
/* ---------- drag the bag on a planned outfit photo (free, saved) ---------- */
function wireLookBags(root) {
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.look-stage .layer'); if (!el) return;
    const o = state.outfits.find((x) => x.id === el.closest('.look')?.dataset.outfit); const l = o?.layers.find((x) => x.uid === el.dataset.uid); if (!l) return;
    e.preventDefault(); el.setPointerCapture?.(e.pointerId);
    drag = { o, l, el, box: el.closest('.figure').getBoundingClientRect(), sx: e.clientX, sy: e.clientY, x0: l.x, y0: l.y, moved: false };
  });
  root.addEventListener('pointermove', (e) => { if (!drag) return;
    const dx = (e.clientX - drag.sx) / drag.box.width * 100, dy = (e.clientY - drag.sy) / drag.box.height * 100;
    if (Math.abs(dx) + Math.abs(dy) > 0.6) drag.moved = true;
    drag.l.x = clamp(drag.x0 + dx, -10, 110); drag.l.y = clamp(drag.y0 + dy, -5, 105); drag.el.style.cssText = layerStyle(drag.l) + ';z-index:20'; });
  const end = async () => { if (!drag) return; const d = drag; drag = null; if (d.moved) { d.o.updatedAt = Date.now(); await DB.put('outfits', d.o); toast('Bag moved ✓', 1200); state.justDragged = Date.now(); } };
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
  root.addEventListener('wheel', (e) => { const el = e.target.closest('.look-stage .layer'); if (!el) return; e.preventDefault();
    const o = state.outfits.find((x) => x.id === el.closest('.look')?.dataset.outfit); const l = o?.layers.find((x) => x.uid === el.dataset.uid); if (!l) return;
    l.w = clamp(l.w * (e.deltaY < 0 ? 1.04 : 0.96), 8, 140); el.style.cssText = layerStyle(l) + ';z-index:20'; clearTimeout(state._bagSave); state._bagSave = setTimeout(() => DB.put('outfits', o), 400); }, { passive: false });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-tweakclose]')) return closeTweak();
    if (e.target.closest('[data-tweakgo]')) { const b = e.target.closest('.tweak-bubble'); const t = b.querySelector('textarea').value.trim(); const o = state.outfits.find((x) => x.id === b.dataset.outfit); if (!t) return b.querySelector('textarea').focus(); closeTweak(); if (o) runTweak(o, t); return; }
    if (e.target.closest('[data-tweakundo]')) { const o = state.outfits.find((x) => x.id === e.target.closest('.look')?.dataset.outfit); if (o?.tryonPrev) { [o.tryon, o.tryonPrev] = [o.tryonPrev, null]; DB.put('outfits', o); renderPlanned(); toast('Back to how it was', 1600); } return; }
    if (e.target.closest('.tweak-bubble') || e.target.closest('.look-stage .layer') || e.target.closest('.look-grip')) return;
    if (state.justDragged && Date.now() - state.justDragged < 400) return;
    const stage = e.target.closest('.look-stage'); if (!stage || state.tweaking) return;
    const o = state.outfits.find((x) => x.id === stage.closest('.look')?.dataset.outfit); if (o) openTweak(o, stage);
  });
}
function wirePlanDrag() {
  const root = $('#plannedList'); if (!root || root._dnd) return; root._dnd = 1; wireLookBags(root);
  root.addEventListener('focusout', (e) => { if (e.target.matches?.('.ed')) saveInlineEdit(e.target); });
  root.addEventListener('keydown', (e) => { if (!e.target.matches?.('.ed')) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); renderPlanned(); } });
  let dragId = null; const clear = () => root.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach((e) => e.classList.remove('drop-before', 'drop-after', 'drop-into'));
  const target = (e) => {
    const card = e.target.closest('.look'); const sec = e.target.closest('.plan-group'); if (!sec) return null;
    if (card && card.dataset.outfit !== dragId) { const r = card.getBoundingClientRect(); const after = e.clientX > r.left + r.width / 2; return { sec, card, after }; }
    return { sec, card: null };
  };
  root.addEventListener('dragstart', (e) => { if (!e.target.closest?.('.look-grip')) return; const c = e.target.closest('.look'); if (!c) return; dragId = c.dataset.outfit; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); try { e.dataTransfer.setDragImage(c, 30, 30); } catch {} c.classList.add('dragging');
    root.classList.add('is-dragging'); });
  root.addEventListener('dragover', (e) => { if (!dragId) return; const t = target(e); if (!t) return; e.preventDefault(); clear();
    if (t.card) t.card.classList.add(t.after ? 'drop-after' : 'drop-before'); else t.sec.classList.add('drop-into'); });
  root.addEventListener('drop', async (e) => { if (!dragId) return; e.preventDefault(); const t = target(e); clear(); const id = dragId; dragId = null; root.classList.remove('is-dragging'); if (!t) return renderPlanned();
    let before = null; if (t.card) { if (!t.after) before = t.card.dataset.outfit; else { const nx = t.card.nextElementSibling; before = nx?.classList.contains('look') ? (nx.dataset.outfit === id ? nx.nextElementSibling?.dataset?.outfit || null : nx.dataset.outfit) : null; } }
    await dropLook(id, t.sec.dataset.group, before); toast('Moved ✓', 1400); });
  root.addEventListener('dragend', () => { clear(); root.classList.remove('is-dragging'); root.querySelectorAll('.dragging').forEach((e) => e.classList.remove('dragging')); dragId = null; });
}
async function outfitAction(act, id) {
  const o = state.outfits.find((x) => x.id === id); if (!o) return;
  const pieces = o.itemIds.map(getItem).filter(Boolean);
  if (act === 'copyall') {
    const withLinks = pieces.filter((p) => p.link);
    if (!withLinks.length) return toast('None of these pieces have links yet');
    copyText(withLinks.map((p) => `${p.name || catLabel(p.category)}: ${p.link}`).join('\n'));
  }
  if (act === 'download') downloadLook(o);
  if (act === 'edit') {
    state.room = { poseId: o.poseId, layers: clone(o.layers), active: null, editingId: o.id };
    const op = state.poses.find((p) => p.id === o.poseId); if (op) state.poseOwner = ownerOf(op);
    o.itemIds.forEach((i) => state.selected.add(i));
    go('room');
  }
  if (act === 'delete') {
    if (!confirm(`Delete "${o.name}"? This can't be undone.`)) return;
    await DB.del('outfits', id); state.outfits = state.outfits.filter((x) => x.id !== id);
    if (state.room.editingId === id) state.room.editingId = null;
    renderPlanned();
  }
}

/* ---------- export a clean image of a look (white, platform, note underneath) ---------- */
async function drawFigure(ctx, box, poseId, layers, tryon = null) {
  if (tryon) layers = [];
  const pose = state.poses.find((p) => p.id === poseId);
  const baseSrc = tryon || (pose ? pose.image : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(SILHOUETTE.replace('class="pose silhouette" ', '')));
  const base = await loadImage(baseSrc);
  const s = Math.min(box.w / base.naturalWidth, box.h / base.naturalHeight);
  const bw = base.naturalWidth * s, bh = base.naturalHeight * s;
  ctx.drawImage(base, box.x + (box.w - bw) / 2, box.y + box.h - bh, bw, bh);
  for (const l of [...layers].sort((a, b) => a.z - b.z)) {
    const it = getItem(l.itemId); if (!it) continue;
    const img = await loadImage(it.image);
    const w = (l.w / 100) * box.w, h = w * (img.naturalHeight / img.naturalWidth);
    ctx.save();
    ctx.translate(box.x + (l.x / 100) * box.w, box.y + (l.y / 100) * box.h);
    ctx.rotate((l.r * Math.PI) / 180); ctx.scale(l.flip ? -1 : 1, 1);
    ctx.shadowColor = 'rgba(0,0,0,.12)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}
function wrapText(ctx, text, x, y, maxW, lh) {
  const words = String(text).split(/\s+/); let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); y += lh; line = w; } else line = t;
  }
  if (line) { ctx.fillText(line, x, y); y += lh; }
  return y;
}
async function downloadLook(o) {
  await document.fonts?.ready;
  const W = 1080, H = 1440; const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const bg = ctx.createRadialGradient(W / 2, 380, 50, W / 2, 500, 900); bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#f6f3ee');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const py = 1000;
  ctx.save(); ctx.filter = 'blur(16px)'; ctx.fillStyle = 'rgba(40,30,20,.16)';
  ctx.beginPath(); ctx.ellipse(W / 2, py + 34, 300, 50, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#ddd5ca'; ctx.beginPath(); ctx.ellipse(W / 2, py + 12, 280, 60, 0, 0, Math.PI * 2); ctx.fill();
  const pg = ctx.createRadialGradient(W / 2, py - 10, 20, W / 2, py, 300); pg.addColorStop(0, '#ffffff'); pg.addColorStop(1, '#eeeae4');
  ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(W / 2, py, 280, 60, 0, 0, Math.PI * 2); ctx.fill();
  await drawFigure(ctx, { x: W / 2 - 270, y: py + 6 - 900, w: 540, h: 900 }, o.poseId, o.layers, o.tryon);

  let y = 1128; ctx.textAlign = 'center';
  ctx.fillStyle = '#9a938b'; ctx.font = '500 22px Inter, sans-serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '5px';
  ctx.fillText(planLabel(o).toUpperCase(), W / 2, y); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  y += 66; ctx.fillStyle = '#1d1b19'; ctx.font = '500 60px "Cormorant Garamond", Georgia, serif';
  y = wrapText(ctx, o.name, W / 2, y, 900, 62);
  if (o.where) { ctx.font = '400 28px Inter, sans-serif'; ctx.fillStyle = '#5f5a54'; y = wrapText(ctx, 'Wear to: ' + o.where, W / 2, y + 4, 900, 38); }
  if (o.note) { ctx.font = 'italic 400 30px "Cormorant Garamond", Georgia, serif'; ctx.fillStyle = '#5f5a54'; y = wrapText(ctx, o.note, W / 2, y + 2, 900, 36); }
  const names = o.itemIds.map(getItem).filter(Boolean).map((i) => i.name || catLabel(i.category)).join('  ·  ');
  if (names) { ctx.font = '400 22px Inter, sans-serif'; ctx.fillStyle = '#9a938b'; wrapText(ctx, names, W / 2, y + 14, 940, 32); }

  const a = document.createElement('a');
  a.download = (o.name || 'outfit').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.png';
  a.href = c.toDataURL('image/png'); a.click();
}

/* ================= backup ================= */
async function exportBackup() {
  const data = { app: 'virtual-wardrobe', version: 1, exportedAt: new Date().toISOString(), items: state.items, outfits: state.outfits, poses: state.poses };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `wardrobe-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    let n = 0;
    for (const s of ['items', 'outfits', 'poses']) for (const v of data[s] || []) { if (!v.id) continue; await DB.put(s, v); n++; }
    await loadAll(); refresh(); toast(`Restored ${n} things`);
  } catch (e) { console.error(e); toast('That file could not be read'); }
}

/* ================= wiring ================= */
function refresh() { if (state.view === 'closet') renderCloset(); if (state.view === 'room') renderRoom(); if (state.view === 'planned') renderPlanned(); renderTray(); }
async function loadAll() {
  const [items, outfits, poses] = await Promise.all(['items', 'outfits', 'poses'].map(DB.all));
  const by = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);
  state.items = items.sort(by); state.outfits = outfits.sort(by); state.poses = poses.sort(by);
  state.selected = new Set([...state.selected].filter(getItem));
}
function bind() {
  $('#edCat').innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
  $('#lkDay').innerHTML = DAYS.map((d) => `<option>${d}</option>`).join('');

  $('#nav').onclick = (e) => { const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); };
  $('#itemFiles').onchange = (e) => { addItemFiles([...e.target.files]); e.target.value = ''; };
  $('#exportBtn').onclick = exportBackup;
  $('#importFile').onchange = (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; };

  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-upload-items]')) { addItemFiles([...e.target.files]); e.target.value = ''; }
    if (e.target.id === 'poseFiles') { addPoseFiles([...e.target.files]); e.target.value = ''; }
    if (e.target.matches('[data-pin]')) {
      const [n, who] = e.target.dataset.pin.split('|');
      if (e.target.value) state.pins[pinKey(n, who)] = e.target.value; else delete state.pins[pinKey(n, who)];
      store.set('vw.shootPins', state.pins); renderShoot();
    }
  });
  document.addEventListener('click', (e) => {
    { const si = e.target.closest('[data-signin]'); if (si) return signIn(si.dataset.signin); }
    { const sc = e.target.closest('[data-source]'); if (sc) { state.source = sc.dataset.source; state.cat = 'all'; return renderCloset(); } }
    if (e.target.closest('[data-syncsetup]')) return openSyncSetup();
    { const sd = e.target.closest('[data-send]'); if (sd) return sendPiece(sd.dataset.send); }
    { const hb = e.target.closest('[data-hand]'); if (hb) return actHandoff(hb.dataset.hand, hb.dataset.do); }
    if (e.target.closest('#meBtn')) return openSignin();
    { const tm = e.target.closest('[data-togmode]'); if (tm) { state.togMode = tm.dataset.togmode; store.set('vw.togMode', state.togMode); return renderTogether(); } }
    if (e.target.closest('[data-shootretry]')) { state.stops = null; renderShoot(); loadStops(true).then(renderShoot).catch(() => {}); return; }
    { const w = e.target.closest('[data-whose]'); if (w) { state.whose = w.dataset.whose; store.set('vw.whose', state.whose); state.planFilter = 'all'; return refresh(); } }
    { const po = e.target.closest('[data-poseowner]'); if (po) { state.poseOwner = po.dataset.poseowner; return renderRoom(); } }
    { const lo = e.target.closest('[data-lkowner]'); if (lo) { lockOwner = lo.dataset.lkowner; return syncLockOwner(); } }
    const t = e.target;
    const cl = t.closest('[data-copylink]'); if (cl) { e.stopPropagation(); const it = getItem(cl.dataset.copylink); copyText(it.link); cl.textContent = '✓ Copied'; setTimeout(() => (cl.textContent = '🔗 Link'), 1500); return; }
    const skip = t.closest('[data-skip]'); if (skip) { e.stopPropagation(); return skipItem(skip.dataset.skip); }
    const unskip = t.closest('[data-unskip]'); if (unskip) { const it = getItem(unskip.dataset.unskip); if (it) { it.skipped = false; DB.put('items', it); renderCloset(); } $('#toast').hidden = true; return; }
    const edit = t.closest('[data-edit]'); if (edit) { e.stopPropagation(); state.queue = []; state.queueTotal = 1; return openEditor(edit.dataset.edit); }
    const piece = t.closest('.piece'); if (piece) {
      const id = piece.dataset.id; state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
      piece.classList.toggle('sel'); saveUI(); updSelAll(); return renderTray();
    }
    const cat = t.closest('[data-cat]'); if (cat) { state.cat = cat.dataset.cat; return renderCloset(); }
    const st = t.closest('[data-status]'); if (st) { state.status = st.dataset.status; return renderCloset(); }
    if (t.closest('#selectAll')) {
      const vis = state.visible || []; const all = vis.length && vis.every((id) => state.selected.has(id));
      vis.forEach((id) => (all ? state.selected.delete(id) : state.selected.add(id)));
      saveUI(); return refresh();
    }
    const tray = t.closest('[data-tray]'); if (tray) {
      if (tray.dataset.tray === 'clear') { state.selected.clear(); saveUI(); return refresh(); }
      return go('room');
    }
    const gt = t.closest('[data-goto]'); if (gt) return go(gt.dataset.goto);
    const pcat = t.closest('[data-pickcat]'); if (pcat) { state.pickCat = pcat.dataset.pickcat; store.set('vw.pickCat', state.pickCat); return renderRoom(); }
    if (t.closest('[data-bigpicks]')) { state.bigPicks = !state.bigPicks; store.set('vw.bigPicks', state.bigPicks); return renderRoom(); }
    const psec = t.closest('[data-picksec]'); if (psec) { const id = psec.dataset.picksec; if ((state.pickCat || 'all') !== 'all') { state.pickCat = 'all'; } else { state.pickClosed = state.pickClosed || {}; state.pickClosed[id] = !state.pickClosed[id]; store.set('vw.pickClosed', state.pickClosed); } return renderRoom(); }
    const pick = t.closest('[data-pick]'); if (pick) return toggleTryOn(pick.dataset.pick);
    const pose = t.closest('[data-pose]'); if (pose) { state.room.poseId = pose.dataset.pose; return renderRoom(); }
    const pa = t.closest('[data-poseact]'); if (pa) return poseAction(pa.dataset.poseact);
    if (t.closest('[data-stopedit]')) { state.room.editingId = null; return renderRoom(); }
    const wx = t.closest('[data-wx]'); if (wx) { const l = getLayer(wx.dataset.wx); return l && takeOff(l); }
    const ws = t.closest('[data-wsel]'); if (ws) { const l = getLayer(ws.dataset.wsel); return l && selectPiece(l); }
    const ltb = t.closest('[data-ltb]'); if (ltb) {
      const l = getLayer(state.room.active); if (!l) return;
      const zs = state.room.layers.map((x) => x.z);
      if (ltb.dataset.ltb === 'flip') l.flip = !l.flip;
      if (ltb.dataset.ltb === 'front') { l.z = Math.max(...zs) + 1; l.behind = false; }
      if (ltb.dataset.ltb === 'back') { l.z = Math.min(...zs) - 1; if (currentTryon()) { l.behind = true; toast('Tucked behind you', 1800); } }
      if (ltb.dataset.ltb === 'shoulder') return wearBagAI(l);
      if (ltb.dataset.style) return restyleAI(ltb.dataset.style);
      if (ltb.dataset.ltb === 'remove') return takeOff(l);
      saveUI(); return renderFigure();
    }
    const pf = t.closest('[data-plan-filter]'); if (pf) { state.planFilter = pf.dataset.planFilter; return renderPlanned(); }
    const cp = t.closest('[data-copy]'); if (cp) return copyText(cp.dataset.copy);
    const act = t.closest('[data-act]'); if (act) return outfitAction(act.dataset.act, act.closest('[data-outfit]').dataset.outfit);
  });
  document.addEventListener('input', (e) => {
    const k = e.target.dataset?.lt; if (!k) return;
    const l = getLayer(state.room.active); if (!l) return;
    l[k] = parseFloat(e.target.value);
    const el = $(`#figure .layer[data-uid="${l.uid}"]`); if (el) el.style.cssText = layerStyle(l);
    updateMirrors(); saveUI();
  });

  // editor
  bindCrop();
  $('#edStatus').onclick = (e) => { const b = e.target.closest('[data-edstatus]'); if (!b || !ed) return; ed.status = b.dataset.edstatus; $$('#edStatus button').forEach((x) => x.classList.toggle('on', x === b)); };
  $('#edLink').addEventListener('paste', () => setTimeout(() => ($('#edLink').value = extractUrl($('#edLink').value)), 0));
  $('#bgBtn').onclick = async () => { setImgBusy(true, 'Removing background…'); try { ed.image = await removePlainBackground(ed.image); $('#edImg').src = ed.image; } finally { setImgBusy(false); } };
  $('#aiBgBtn').onclick = async () => { setImgBusy(true, 'AI cutout running… the first time downloads the model and can take a minute.'); try { ed.image = await aiCutout(ed.image); $('#edImg').src = ed.image; } finally { setImgBusy(false); } };
  $('#resetImgBtn').onclick = () => { ed.image = ed.original; $('#edImg').src = ed.image; stopCrop(); };
  $('#edSave').onclick = saveEditor;
  $('#edCancel').onclick = closeEditor;
  $('#edDelete').onclick = async () => {
    if (!ed || !confirm('Delete this piece from your closet?')) return;
    const id = ed.id; await DB.del('items', id);
    state.items = state.items.filter((i) => i.id !== id); state.selected.delete(id);
    state.room.layers = state.room.layers.filter((l) => l.itemId !== id); saveUI();
    if (state.queue.length) openEditor(state.queue.shift()); else closeEditor();
    refresh();
  };

  // room + lock
  bindFigure();
  $('#lockBtn').onclick = openLock;
  $('#tryonBtn').onclick = runTryon;
  $('#syncBtn').onclick = refreshCart;
  showCredits(); setInterval(showCredits, 120000);
  const paintCoat = () => $$('#coatSeg button').forEach((b) => b.classList.toggle('on', b.dataset.coat === store.get('vw.coat', 'open')));
  $$('#coatSeg button').forEach((b) => (b.onclick = () => { store.set('vw.coat', b.dataset.coat); paintCoat(); paintCost(); }));
  paintCoat();
  $('#zoomBtn').onclick = openZoom;
  const paintSpeed = () => $$('#speedSeg button').forEach((b) => b.classList.toggle('on', b.dataset.speed === store.get('vw.fashnMode', 'balanced')));
  $$('#speedSeg button').forEach((b) => (b.onclick = () => { store.set('vw.fashnMode', b.dataset.speed); paintSpeed(); paintCost(); }));
  paintSpeed();
  $('#aiKeyLink').onclick = openKeyModal;
  $('#keyPaste').onclick = async () => { try { const t = (await navigator.clipboard.readText()).trim(); if (!t) return toast('Nothing copied yet — copy the key first', 3200); $('#keyInput').value = t; $('#keySave').click(); } catch { toast('Allow clipboard access, or paste into the box', 3200); } };
  $('#keyCancel').onclick = () => ($('#keyModal').hidden = true);
  $('#keySave').onclick = () => { const k = $('#keyInput').value.trim(); if (store.get('vw.tryonEngine', 'fashn') === 'fashn') store.set('vw.fashnKey', k); else { store.set('vw.geminiKey', k); store.set('vw.geminiModel', null); } $('#keyModal').hidden = true; $('#keyInput').value = ''; if (k) { toast('Key saved'); runTryon(); } };
  $('#clearRoomBtn').onclick = () => { state.room.layers = []; state.room.active = null; renderRoom(); };
  $('#lkPlan').onclick = (e) => { const b = e.target.closest('[data-plan]'); if (b) { lockPlan = b.dataset.plan; syncLockPlan(); } };
  $('#lkCancel').onclick = () => ($('#lockModal').hidden = true);
  $('#lkSave').onclick = saveLock;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('#itemModal').hidden) closeEditor(); $('#lockModal').hidden = true; }
  });
}

// Pull in products added by add_product.py (imports/manifest.json); skips ones already in the closet.
// ---- cart sync (bookmark on the TikTok cart page -> #cart=... -> local server) ----
async function receiveCartSync() {
  const h = location.hash; if (!h.startsWith('#cart=')) return;
  history.replaceState(null, '', location.pathname);
  let rows; try { rows = JSON.parse(decodeURIComponent(h.slice(6))); } catch { return toast('Couldn\'t read the cart — try the bookmark again', 5000); }
  return applyCartRows(rows);
}
async function applyCartRows(rows) {
  toast(`Syncing ${rows.length} cart items…`, 60000);
  try {
    const r = await api('/api/data?op=wardrobe_cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) });
    const out = await r.json(); if (!r.ok) throw new Error(out.error || 'sync failed');
    await syncImports(); state.items = await DB.all('items'); refresh();
    const bits = [out.added.length ? `Added ${out.added.length} new` : 'Nothing new to add', 'prices updated'];
    if (out.soldOut.length) bits.push(`${out.soldOut.length} sold out`);
    toast(bits.join(' · ') + ' ✨', 6000);
  } catch (e) { toast('Sync didn\'t work: ' + e.message, 6000); }
}
/* ---------- The Fold (thefoldlabel.com) — pulled in live from the website ---------- */
function foldCategory(p) {
  const t = `${p.type} ${p.title}`;
  if (/jewel|earring|cuff|necklace|bracelet|ring\b/i.test(t)) return 'accessories';
  if (/dress/i.test(t)) return 'dresses';
  if (/skirt/i.test(t)) return 'skirts';
  if (/short/i.test(t)) return 'shorts';
  if (/pant|jean|trouser|bottom/i.test(t)) return 'bottoms';
  if (/jacket|coat|blazer|outer/i.test(t)) return 'outerwear';
  if (/set\b/i.test(t)) return 'sets';
  if (/shoe|boot|heel|sandal/i.test(t)) return 'shoes';
  if (/bag|tote|clutch/i.test(t)) return 'bags';
  return 'tops';
}
const foldImg = (u, w = 1200) => u + (u.includes('?') ? '&' : '?') + 'width=' + w;
async function syncFold() {
  const r = await api('/api/data?op=wardrobe_fold', { cache: 'no-store' }); const j = await r.json(); if (!r.ok || !j.products) throw new Error(j.error || 'The Fold site didn\'t answer');
  let added = 0, updated = 0; const seen = new Set();
  const pic = async (u) => downscale(await fileToDataURL(await (await fetch(foldImg(u))).blob()), 1200);
  await Promise.all(j.products.map(async (p) => {
    const key = `fold-${p.id}`; seen.add(key); const have = state.items.find((i) => i.importKey === key);
    const price = p.price ? `$${p.price}` : ''; const was = p.was && p.was !== p.price ? `$${p.was}` : '';
    const link = `https://www.thefoldlabel.com/products/${p.handle}`;
    if (have) {
      const ch = {}; if (have.price !== price) ch.price = price; if ((have.priceWas || '') !== was) ch.priceWas = was; if (!!have.soldOut !== !p.available) ch.soldOut = !p.available;
      if (have.link !== link) ch.link = link; if (have.foldUpdated !== p.updated) { ch.foldUpdated = p.updated; if (!have.renamed && have.name !== p.title) ch.name = p.title; }
      if (have.foldImg !== (p.images[0] || '') && p.images[0]) { try { const im = await pic(p.images[0]); ch.image = im; ch.original = im; ch.tryonPic = foldImg(p.images[0]); ch.foldImg = p.images[0]; } catch {} }
      if (Object.keys(ch).length) { Object.assign(have, ch); await DB.put('items', have); updated++; }
      return;
    }
    if (!p.images[0]) return;
    try {
      const image = await pic(p.images[0]);
      const it = { id: uid(), importKey: key, source: 'fold', owner: 'kiaredza', name: p.title, category: foldCategory(p), status: 'owned', productId: p.id,
        link, price, priceWas: was, size: '', notes: p.sizes.length ? `Sizes: ${p.sizes.join(', ')}` : '', soldOut: !p.available,
        image, original: image, tryonPic: foldImg(p.images[0]), refs: p.images.slice(1, 3).map((u) => foldImg(u)), foldImg: p.images[0], foldUpdated: p.updated, createdAt: Date.now() + added };
      await DB.put('items', it); state.items.push(it); added++;
    } catch (e) { console.warn('fold import failed', p.title, e); }
  }));
  for (const it of state.items) if (isFold(it) && it.importKey && !seen.has(it.importKey) && !it.soldOut) { it.soldOut = true; await DB.put('items', it); updated++; } // gone from the site
  return { added, updated, total: j.products.length };
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
async function refreshFold(quiet) {
  try { const o = await withTimeout(syncFold(), 15000); if (!quiet) toast(`The Fold: ${o.total} pieces${o.added ? ` · ${o.added} new` : ''}${o.updated ? ` · ${o.updated} updated` : ''} ✨`, 3500); return o; }
  catch (e) { console.warn(e); if (!quiet) toast('Couldn\'t reach thefoldlabel.com — try again', 4000); return null; }
}
async function refreshCart() {
  const btn = $('#syncBtn');
  if (!btn.disabled) { btn.disabled = true; btn.textContent = '↻ Refreshing…'; await refreshFold(false); state.items = await DB.all('items'); refresh(); btn.disabled = false; btn.textContent = '↻ Refresh'; }
  if (document.documentElement.dataset.vwHelper !== '1') { // no Chrome helper: pull in the latest auto-sync
    return syncImports().then(async () => { state.items = await DB.all('items'); refresh(); toast('Up to date with the latest sync ✨ New cart adds come in at 8am, 12pm, 4pm & 8pm', 6000); });
  }
  if (btn.disabled) return;
  btn.disabled = true; btn.textContent = '↻ Refreshing…'; toast('Reading your TikTok cart…', 60000);
  const done = () => { btn.disabled = false; btn.textContent = '↻ Refresh'; window.removeEventListener('message', onMsg); clearTimeout(t); };
  const onMsg = (e) => {
    if (e.source !== window || !e.data || e.data.type !== 'vw-sync-result') return;
    done();
    if (e.data.error || !e.data.rows) return toast(e.data.error || 'Refresh didn\'t work', 6000);
    applyCartRows(e.data.rows);
  };
  const t = setTimeout(() => { done(); toast('TikTok took too long — try again', 5000); }, 90000);
  window.addEventListener('message', onMsg);
  window.postMessage({ type: 'vw-sync-request' }, location.origin);
}
function openHelperSetup() {
  let el = $('#syncHelp');
  if (!el) {
    el = document.createElement('div'); el.id = 'syncHelp'; el.className = 'zoom-view sync-help'; (document.getElementById('vw-app') || document.body).appendChild(el);
    el.onclick = (e) => { if (e.target === el || e.target.closest('[data-close]')) el.hidden = true; };
  }
  el.innerHTML = `<div class="sync-card">
    <h3>Turn on one-tap Refresh</h3>
    <p>One time only, in Chrome:</p>
    <ol>
      <li>Go to <b>chrome://extensions</b></li>
      <li>Turn on <b>Developer mode</b> (top right)</li>
      <li>Click <b>Load unpacked</b> → open your home folder → <b>Virtual Wardrobe</b> → pick <b>Wardrobe Helper</b> → Select</li>
      <li>Come back here and reload this page</li>
    </ol>
    <p class="muted">After that, ↻ Refresh pulls your cart, new pieces and today's prices in one tap. It also syncs on its own 4× a day.</p>
    <div class="sync-btns"><button class="ghost small" data-close>Done</button></div>
  </div>`;
  el.hidden = false;
}
async function syncImports() {
  let list;
  try { const r = await fetch('imports/manifest.json', { cache: 'no-store' }); if (!r.ok) return; list = await r.json(); } catch { return; }
  let n = 0;
  for (const it of state.items) { // fix old-style links
    const id = (it.link || '').match(/tiktok\.com\/view\/product\/(\d{15,})/)?.[1];
    if (id) { it.link = `https://shop.tiktok.com/us/pdp/${id}`; await DB.put('items', it); }
  }
  for (const e of list) {
    const key = e.key || e.productId;
    const have = state.items.find((i) => (i.importKey || i.productId) === key);
    if (have && e.imgv && have.imgv !== e.imgv) {
      try { const img = await downscale(await fileToDataURL(await (await fetch(e.image)).blob()), 1200); have.image = img; have.original = img; have.imgv = e.imgv; await DB.put('items', have); } catch (err) { console.warn(err); }
    }
    if (have && (e.tryonPic || '') !== (have.tryonPic || '')) { have.tryonPic = e.tryonPic || ''; await DB.put('items', have); }
    if (have && JSON.stringify(e.refs || []) !== JSON.stringify(have.refs || [])) { have.refs = e.refs || []; await DB.put('items', have); }
    if (have && (e.tryonNote || '') !== (have.tryonNote || '') && e.tryonNote) { have.tryonNote = e.tryonNote; await DB.put('items', have); }
    if (have && !!have.inCart !== !!e.inCart) { have.inCart = !!e.inCart; await DB.put('items', have); }
    if (have && !!have.soldOut !== !!e.soldOut) { have.soldOut = !!e.soldOut; await DB.put('items', have); }
    if (have && !!have.outOfCart !== !!e.outOfCart) { have.outOfCart = !!e.outOfCart; await DB.put('items', have); }
    if (have && ((e.price || '') !== (have.price || '') || (e.priceWas || '') !== (have.priceWas || '')) && e.price) { have.price = e.price; have.priceWas = e.priceWas || ''; await DB.put('items', have); }
    if (have && e.link && have.link !== e.link) { have.link = e.link; await DB.put('items', have); }
    if (have) { if (!have.link && e.link) { have.link = e.link; have.productId = have.productId || e.productId; await DB.put('items', have); } continue; }
    try {
      const blob = await (await fetch(e.image)).blob();
      const image = await downscale(await fileToDataURL(blob), 1200);
      const it = { id: uid(), importKey: key, tryonPic: e.tryonPic || '', refs: e.refs || [], tryonNote: e.tryonNote || '', inCart: !!e.inCart, soldOut: !!e.soldOut, productId: e.productId, name: e.name, category: e.category, status: e.status || 'owned',
        link: e.link, price: e.price || '', priceWas: e.priceWas || '', size: '', notes: '', image, original: image, createdAt: Date.now() + n };
      await DB.put('items', it); state.items.push(it); n++;
    } catch (err) { console.warn('import failed', e, err); }
  }
  if (n) toast(`Added ${n} new piece${n === 1 ? '' : 's'} from TikTok Shop`);
  // Photos of you (imports/poses.json)
  try {
    const r = await fetch('imports/poses.json', { cache: 'no-store' });
    if (r.ok) for (const e of await r.json()) {
      const hp = state.poses.find((p) => p.importKey === e.key);
      if (hp) { if ((e.photo && !hp.photo) || (e.face && !hp.face)) { hp.photo = e.photo || hp.photo; hp.face = e.face || hp.face; await DB.put('poses', hp); } continue; }
      const image = await downscale(await fileToDataURL(await (await fetch(e.image)).blob()), 1600);
      const p = { id: uid(), importKey: e.key, image, original: image, createdAt: Date.now() };
      await DB.put('poses', p); state.poses.push(p);
    }
  } catch (err) { console.warn('pose import failed', err); }
}

/* ---------- who's dressing? (asked every time the wardrobe opens) ---------- */
function signIn(id) {
  // "Both" is a third way in (her ask Nov 20 2026): it opens straight on the
  // shoot day, the two of you side by side against the run of day on the LS
  // Photoshoots board, and pulls that board fresh. You are still signed in as
  // yourself underneath, so anything you edit is still yours.
  const both = id === 'both';
  if (both) { let l = 'kiabeth'; try { l = localStorage.getItem('vw.lastPerson') || l; } catch {} id = l; }
  ME = id; store_last(id);
  state.view = both ? 'planned' : store.get('vw.view', 'closet');
  state.selected = new Set(store.get('vw.selected', []));
  state.room = store.get('vw.room', null) || { poseId: null, layers: [], active: null, editingId: null };
  state.tryon = store.get('vw.tryon', null); state.tryonHist = {}; state.poseOwner = ME;
  state.whose = both ? 'together' : ME; // on your own things unless you asked for both
  if (both) { state.togMode = 'shoot'; store.set('vw.togMode', 'shoot'); state.stops = null; }
  state.selected = new Set([...state.selected].filter(getItem));
  $('#meBtn').innerHTML = `<span class="me-dot">${personName(ME)[0]}</span>${personName(ME)} · Admin`;
  $('#signinModal').hidden = true; SIGNED = true;
  go(['closet', 'room', 'planned'].includes(state.view) ? state.view : 'closet');
  if (both) loadStops(true).then(renderShoot).catch(() => {});
  if (state.pendingSync) { const rs = state.pendingSync; state.pendingSync = null; applySync(rs); }
}
function store_last(id) { try { localStorage.setItem('vw.lastPerson', id); } catch {} }
function openSignin() {
  let last = 'kiaredza'; try { last = localStorage.getItem('vw.lastPerson') || last; } catch {}
  $('#signinPeople').innerHTML = PEOPLE.map((p) => `<button class="signin-btn ${p.id === last ? 'last' : ''}" data-signin="${p.id}"><span class="me-dot big">${p.name[0]}</span><b>${p.name}</b><small>Admin</small></button>`).join('')
    + `<button class="signin-btn both" data-signin="both"><span class="me-dot big pair">K<i>K</i></span><b>Both</b><small>Shoot day · synced to LS Photoshoots</small></button>`;
  $('#signinModal').hidden = false;
}
(async function init() {
  bind();
  $('#bootModal').hidden = false;
  await loadAll();
  await Promise.all([syncImports().catch((e) => console.warn(e)), refreshFold(true)]);
  state.items = (await DB.all('items')).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  $('#bootModal').hidden = true;
  await loadShared();
  receiveCartSync(); receiveSync();
  window.addEventListener('hashchange', () => { receiveCartSync(); receiveSync(); });
  openSignin();
})();
