// Strategy Outline renderer — shared by the page images (SVG → resvg-wasm → JPEG)
// and the PDF (pdf-lib + fontkit), so both carry the same typography:
// Cormorant Garamond (light serif wordmark / tracked titles) + Inter (sans).
// Aesthetic follows the Loft's monthly outline + Kiabeth's May cover: cream
// page, thin rule, tracked uppercase, quiet hierarchy. House rule: no em dashes.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const W = 1920, H = 1080;
const CREAM = "#FBFAF7", INK = "#1A1A1A", SUB = "#7A766E";
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const FONT_FILES = { serif: "CormorantGaramond.ttf", sans: "Inter-Regular.ttf", sansL: "Inter-Light.ttf", sansM: "Inter-Medium.ttf", sansB: "Inter-SemiBold.ttf" };
const SVG_FONT = { serif: ["Cormorant Garamond", 300], sans: ["Inter", 400], sansL: ["Inter", 300], sansM: ["Inter", 500], sansB: ["Inter", 600] };

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

export async function renderStrategyPages({ brand, title, body, posts, windows }) {
  const { bufs, fk, fontkit } = await loadFonts();
  const width = (text, font, size, tracking = 0) => { const run = fk[font].layout(String(text)); const w = run.advanceWidth / fk[font].unitsPerEm * size; return w + tracking * Math.max(0, String(text).length - 1); };
  const wrap = (text, font, size, maxW) => { const words = String(text).split(/\s+/).filter(Boolean); const lines = []; let cur = ""; for (const w of words) { const t = cur ? cur + " " + w : w; if (width(t, font, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines; };

  // ── grid crops: 3 rows (9 tiles) per page, numbers included, from the Grid-card windows ──
  const Jimp = (await import("jimp")).default;
  let g121 = null, g2242 = null;
  try { if (windows.w121) g121 = await Jimp.read(windows.w121); } catch {}
  try {
    if (windows.w3142 && windows.w2230) { const top = await Jimp.read(windows.w3142), bot = await Jimp.read(windows.w2230); const cv = await new Jimp(1080, top.bitmap.height + bot.bitmap.height, 0xf2efe9ff); cv.composite(top, 0, 0); cv.composite(bot, 0, top.bitmap.height); g2242 = cv; }
    else if (windows.w2242) g2242 = await Jimp.read(windows.w2242);
  } catch {}
  const cropRows = async (img, base, a, b) => { // posts a..b (absolute numbers); base = first post number in img (1 or 22)
    if (!img) return null;
    const rowH = Math.round(img.bitmap.height / 7);
    const r0 = Math.floor((a - base) / 3), r1 = Math.floor((b - base) / 3);
    const y = (7 - 1 - r1) * rowH, h = (r1 - r0 + 1) * rowH;
    const c = img.clone().crop(0, y, img.bitmap.width, h); c.quality(88);
    return await c.getBufferAsync(Jimp.MIME_JPEG);
  };

  // ── content ──
  const T = (t) => noDash(t);
  const month = T(title).toUpperCase();
  const SECTIONS = [[1, 7], [8, 14], [15, 21], [22, 28], [29, 35], [36, 42]].filter(([a]) => posts.some((p) => p.n >= a));
  const pages = []; // each: { ops: [...] }
  const foot = (ops) => ops.push({ t: "text", x: "center", y: 1034, font: "sans", size: 11, tracking: 4, color: SUB, text: "LAVALLE HAUS OS" });

  // cover
  {
    const ops = [];
    ops.push({ t: "text", x: 72, y: 64, font: "sans", size: 13, tracking: 5, color: INK, text: brand.toUpperCase() });
    ops.push({ t: "text", x: "right", y: 64, font: "sans", size: 13, tracking: 5, color: INK, text: month });
    ops.push({ t: "text", x: "center", y: 500, font: "serif", size: 66, tracking: 18, color: INK, text: "STRATEGY OUTLINE" });
    ops.push({ t: "text", x: "center", y: 556, font: "serif", size: 30, tracking: 10, color: INK, text: month });
    let y = 640; for (const ln of wrap(T(body), "sansL", 19, 1040)) { ops.push({ t: "text", x: "center", y, font: "sansL", size: 19, color: SUB, text: ln }); y += 32; }
    foot(ops); pages.push({ ops });
  }
  // in-feed pages
  for (const [a, b] of SECTIONS) {
    const ops = [];
    ops.push({ t: "text", x: 72, y: 74, font: "serif", size: 40, tracking: 4, color: INK, text: brand.toUpperCase() });
    ops.push({ t: "text", x: "right", y: 72, font: "sans", size: 26, color: INK, text: month });
    ops.push({ t: "line", x1: 72, y1: 98, x2: W - 72, y2: 98, w: 1, color: INK });
    ops.push({ t: "text", x: 72, y: 196, font: "sansL", size: 46, color: INK, text: "In-Feed" });
    ops.push({ t: "text", x: 72, y: 228, font: "sans", size: 12, tracking: 4, color: SUB, text: "POSTS " + a + " TO " + Math.min(b, 42) });
    const crop = a <= 21 ? await cropRows(g121, 1, a, Math.min(b, 21)) : await cropRows(g2242, 22, a, Math.min(b, 42));
    let textW = W - 144;
    if (crop) { const gw = 630, gh = 840; ops.push({ t: "img", x: W - 72 - gw, y: 170, w: gw, h: gh, jpg: crop }); textW = W - 72 - gw - 72 - 70; }
    let y = 300;
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
    foot(ops); pages.push({ ops });
  }

  // ── SVG + raster ──
  const { initWasm, Resvg } = await import("@resvg/resvg-wasm");
  try { await initWasm(fs.readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm"))); } catch (e) { if (!/already/i.test(String(e && e.message))) throw e; }
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
