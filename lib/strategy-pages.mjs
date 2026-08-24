// Strategy Outline renderer — shared by the page images (SVG → resvg-wasm → JPEG)
// and the PDF (pdf-lib + fontkit), so both carry the same typography.
// Style = Kiabeth's May deck: cream page, tiny tracked header (brand left,
// month right), wide-tracked uppercase titles in a light sans (Inter), a photo
// collage column on the Strategy Outline page, Loft-style in-feed pages with
// the numbered 3x3 grid on the right. House rule: no em dashes.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = [path.join(process.cwd(), "assets"), path.join(HERE, "..", "assets")].find((d) => fs.existsSync(path.join(d, "fonts"))) || path.join(process.cwd(), "assets");
const W = 1920, H = 1080;
const CREAM = "#FBFAF7", INK = "#1A1A1A", SUB = "#7A766E", RULE = "#1A1A1A";
const FONT_DIR = path.join(ASSETS, "fonts");
const FONT_FILES = { sans: "Inter-Regular.ttf", sansL: "Inter-Light.ttf", sansM: "Inter-Medium.ttf", sansB: "Inter-SemiBold.ttf" };
const SVG_FONT = { sans: ["Inter", 400], sansL: ["Inter", 300], sansM: ["Inter", 500], sansB: ["Inter", 600] };

let fontCache = null;
async function loadFonts() {
  if (fontCache) return fontCache;
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const bufs = {}, fk = {};
  for (const [k, f] of Object.entries(FONT_FILES)) { bufs[k] = fs.readFileSync(path.join(FONT_DIR, f)); fk[k] = fontkit.create(bufs[k]); }
  fontCache = { bufs, fk, fontkit };
  return fontCache;
}
const noDash = (s) => String(s || "").replace(/\s*[—–]\s*/g, (m, off, str) => (/^[A-Z]/.test(str.slice(off + m.length)) ? ". " : ", ")).replace(/\.\s*\./g, ".").replace(/,\s*,/g, ",").trim();
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// posts: [{n, date, concept, desc, tags, isC}]; windows: {w121, w2230, w3142} JPEG buffers
// collage: up to 6 JPEG buffers (most editorial photos of the current grid, best first)
export async function renderStrategyPages({ brand, title, body, posts, windows, collage = [] }) {
  const { bufs, fk, fontkit } = await loadFonts();
  const width = (text, font, size, tracking = 0) => { const run = fk[font].layout(String(text)); const w = run.advanceWidth / fk[font].unitsPerEm * size; return w + tracking * Math.max(0, String(text).length - 1); };
  const wrap = (text, font, size, maxW) => { const words = String(text).split(/\s+/).filter(Boolean); const lines = []; let cur = ""; for (const w of words) { const t = cur ? cur + " " + w : w; if (width(t, font, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines; };

  const Jimp = (await import("jimp")).default;
  // grid crops: 3 rows (9 tiles) per in-feed page, numbers included
  let g121 = null, g2242 = null;
  try {
    if (windows.w121) g121 = await Jimp.read(windows.w121);
    else if (windows.w1021 && windows.w19) { const top = await Jimp.read(windows.w1021), bot = await Jimp.read(windows.w19); const cv = await new Jimp(1080, top.bitmap.height + bot.bitmap.height, 0xf2efe9ff); cv.composite(top, 0, 0); cv.composite(bot, 0, top.bitmap.height); g121 = cv; }
  } catch {}
  try {
    if (windows.w3142 && windows.w2230) { const top = await Jimp.read(windows.w3142), bot = await Jimp.read(windows.w2230); const cv = await new Jimp(1080, top.bitmap.height + bot.bitmap.height, 0xf2efe9ff); cv.composite(top, 0, 0); cv.composite(bot, 0, top.bitmap.height); g2242 = cv; }
  } catch {}
  const cropRows = async (img, base, a, b) => {
    if (!img) return null;
    const rowH = Math.round(img.bitmap.height / 7);
    const r0 = Math.floor((a - base) / 3), r1 = Math.floor((b - base) / 3);
    const y = (7 - 1 - r1) * rowH, h = (r1 - r0 + 1) * rowH;
    const c = img.clone().crop(0, y, img.bitmap.width, h); c.quality(88);
    return await c.getBufferAsync(Jimp.MIME_JPEG);
  };
  // collage tiles: 3:4 crops at 440x587 (2 cols x 3 rows column on the left)
  const tiles = [];
  for (const b of collage.slice(0, 6)) { try { const im = await Jimp.read(b); im.cover(440, 587); im.quality(86); tiles.push(await im.getBufferAsync(Jimp.MIME_JPEG)); } catch {} }

  const T = (t) => noDash(t);
  const month = T(title).toUpperCase();
  const SECTIONS = [[1, 7], [8, 14], [15, 21], [22, 28], [29, 35], [36, 42]].filter(([a]) => posts.some((p) => p.n >= a));
  const pages = [];
  const header = (ops) => {
    ops.push({ t: "text", x: 72, y: 62, font: "sans", size: 12, tracking: 5, color: INK, text: brand.toUpperCase() });
    ops.push({ t: "text", x: "right", y: 62, font: "sans", size: 12, tracking: 5, color: INK, text: month });
    ops.push({ t: "line", x1: 72, y1: 84, x2: W - 72, y2: 84, w: 0.6, color: RULE });
    ops.push({ t: "text", x: "center", y: 1036, font: "sans", size: 10, tracking: 4, color: SUB, text: "LAVALLE HAUS OS" });
  };

  // 1 · cover — exactly her May cover: tracked title, nothing else
  { const ops = []; header(ops);
    ops.push({ t: "text", x: "center", y: 528, font: "sansL", size: 54, tracking: 24, color: INK, text: "STRATEGY OUTLINE" });
    ops.push({ t: "text", x: "center", y: 580, font: "sans", size: 16, tracking: 10, color: INK, text: month });
    pages.push({ ops }); }
  // 2 · strategy page — collage column left, tracked title + theme right
  { const ops = []; header(ops);
    const colX = 72, colY = 120, tw = 220, th = 293, gap = 8;
    tiles.forEach((jpg, i) => { const c = i % 2, r = Math.floor(i / 2); ops.push({ t: "img", x: colX + c * (tw + gap), y: colY + r * (th + gap), w: tw, h: th, jpg }); });
    const rx = tiles.length ? colX + 2 * tw + gap + 90 : 72;
    ops.push({ t: "text", x: rx, y: 250, font: "sansL", size: 38, tracking: 16, color: INK, text: "STRATEGY OUTLINE" });
    let y = 320; for (const ln of wrap(T(body), "sans", 18, W - 72 - rx)) { ops.push({ t: "text", x: rx, y, font: "sans", size: 18, color: INK, text: ln }); y += 30; }
    const ours = posts.filter((p) => !p.isC).length, theirs = posts.length - ours;
    y += 26;
    for (const ln of [posts.length + " posts this cycle: " + ours + " ours, " + theirs + " from Courtney (the dotted tiles).", "The grid is the sequence: tile 1 is Post 1, bottom right, reading up and across.", "Captions and two TikTok hashtags live on each card; approve them there and this outline refreshes itself."]) { for (const l2 of wrap(ln, "sans", 15, W - 72 - rx)) { ops.push({ t: "text", x: rx, y, font: "sans", size: 15, color: SUB, text: l2 }); y += 25; } y += 6; }
    pages.push({ ops }); }
  // 3+ · in-feed pages
  for (const [a, b] of SECTIONS) {
    const ops = []; header(ops);
    ops.push({ t: "text", x: 72, y: 186, font: "sansL", size: 32, tracking: 14, color: INK, text: "IN-FEED" });
    ops.push({ t: "text", x: 72, y: 216, font: "sans", size: 11, tracking: 4, color: SUB, text: "POSTS " + a + " TO " + Math.min(b, 42) });
    const crop = a <= 21 ? await cropRows(g121, 1, a, Math.min(b, 21)) : await cropRows(g2242, 22, a, Math.min(b, 42));
    let textW = W - 144;
    if (crop) { const gw = 630, gh = 840; ops.push({ t: "img", x: W - 72 - gw, y: 150, w: gw, h: gh, jpg: crop }); textW = W - 72 - gw - 72 - 70; }
    let y = 290;
    for (const p of posts.filter((p) => p.n >= a && p.n <= b)) {
      if (y > 1000) break;
      const head = "Post " + p.n + (p.date ? " · " + p.date : "") + (p.isC && p.concept ? " · " + T(p.concept) : "");
      ops.push({ t: "text", x: 72, y, font: "sansB", size: 16, color: INK, text: head }); y += 24;
      if (p.isC) { ops.push({ t: "text", x: 72, y, font: "sans", size: 15, color: SUB, text: "Courtney: caption and hashtags to come" }); y += 22; }
      else {
        for (const ln of wrap("Caption: " + T(p.desc), "sans", 16, textW)) { ops.push({ t: "text", x: 72, y, font: "sans", size: 16, color: INK, text: ln }); y += 23; }
        if (p.tags) { ops.push({ t: "text", x: 72, y, font: "sans", size: 14, color: SUB, text: p.tags }); y += 21; }
      }
      y += 14;
    }
    pages.push({ ops });
  }

  // ── SVG + raster ──
  const { initWasm, Resvg } = await import("@resvg/resvg-wasm");
  const wasmPath = [path.join(ASSETS, "resvg.wasm"), (() => { try { return require.resolve("@resvg/resvg-wasm/index_bg.wasm"); } catch { return null; } })()].find((p) => p && fs.existsSync(p));
  try { await initWasm(fs.readFileSync(wasmPath)); } catch (e) { if (!/already/i.test(String(e && e.message))) throw e; }
  const xOf = (op) => op.x === "center" ? (W - width(op.text, op.font, op.size, op.tracking || 0)) / 2 : op.x === "right" ? W - 72 - width(op.text, op.font, op.size, op.tracking || 0) : op.x;
  const toSvg = (page) => {
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${CREAM}"/>`];
    for (const op of page.ops) {
      if (op.t === "text") { const [fam, wt] = SVG_FONT[op.font]; parts.push(`<text x="${xOf(op).toFixed(1)}" y="${op.y}" font-family="${fam}" font-weight="${wt}" font-size="${op.size}" fill="${op.color}"${op.tracking ? ` letter-spacing="${op.tracking}"` : ""}>${esc(op.text)}</text>`); }
      else if (op.t === "line") parts.push(`<line x1="${op.x1}" y1="${op.y1}" x2="${op.x2}" y2="${op.y2}" stroke="${op.color}" stroke-width="${op.w}"/>`);
      else if (op.t === "img") parts.push(`<image x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" preserveAspectRatio="none" href="data:image/jpeg;base64,${op.jpg.toString("base64")}"/>`);
    }
    parts.push("</svg>"); return parts.join("");
  };
  const jpgs = [];
  for (const page of pages) {
    const r = new Resvg(toSvg(page), { fitTo: { mode: "original" }, background: CREAM, font: { fontBuffers: Object.values(bufs).map((b) => new Uint8Array(b)), loadSystemFonts: false, defaultFontFamily: "Inter" } });
    const png = Buffer.from(r.render().asPng());
    const j = await Jimp.read(png); j.quality(86); jpgs.push(await j.getBufferAsync(Jimp.MIME_JPEG));
  }

  // ── PDF (same ops, same fonts) ──
  const { PDFDocument, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const pf = {}; for (const k of Object.keys(bufs)) pf[k] = await pdf.embedFont(bufs[k], { subset: true });
  const col = (hex) => { const n = parseInt(hex.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
  const imgCache = new Map();
  for (const page of pages) {
    const pg = pdf.addPage([W, H]); pg.drawRectangle({ x: 0, y: 0, width: W, height: H, color: col(CREAM) });
    for (const op of page.ops) {
      if (op.t === "text") {
        const f = pf[op.font]; let x = xOf(op); const y = H - op.y;
        if (op.tracking) { for (const ch of String(op.text)) { pg.drawText(ch, { x, y, size: op.size, font: f, color: col(op.color) }); x += f.widthOfTextAtSize(ch, op.size) + op.tracking; } }
        else pg.drawText(String(op.text), { x, y, size: op.size, font: f, color: col(op.color) });
      } else if (op.t === "line") pg.drawLine({ start: { x: op.x1, y: H - op.y1 }, end: { x: op.x2, y: H - op.y2 }, thickness: op.w, color: col(op.color) });
      else if (op.t === "img") { let im = imgCache.get(op.jpg); if (!im) { im = await pdf.embedJpg(op.jpg); imgCache.set(op.jpg, im); } pg.drawImage(im, { x: op.x, y: H - op.y - op.h, width: op.w, height: op.h }); }
    }
  }
  const pdfBuf = Buffer.from(await pdf.save());
  return { jpgs, pdf: pdfBuf, pageCount: pages.length };
}
