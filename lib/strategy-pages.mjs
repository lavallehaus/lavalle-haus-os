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
  // HER FORMAT RULE: the deck's in-feed pages mirror the Grid card exactly —
  // one page per window (1-9, 10-21, 22-30, 31-42), each showing that window's
  // numbered image as the Grid card renders it. Permanent for every month.
  // collage tiles: 3:4 crops at 440x587 (2 cols x 3 rows column on the left)
  const tiles = [];
  for (const b of collage.slice(0, 6)) { try { const im = await Jimp.read(b); im.cover(440, 587); im.quality(86); tiles.push(await im.getBufferAsync(Jimp.MIME_JPEG)); } catch {} }

  const T = (t) => noDash(t);
  const month = T(title).toUpperCase();
  const SECTIONS = [[1, 9, windows.w19], [10, 21, windows.w1021], [22, 30, windows.w2230], [31, 42, windows.w3142]].filter(([a]) => posts.some((p) => p.n >= a));
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
  for (const [a, b, buf] of SECTIONS) {
    const ops = []; header(ops);
    ops.push({ t: "text", x: 72, y: 176, font: "sansL", size: 32, tracking: 14, color: INK, text: "IN-FEED" });
    ops.push({ t: "text", x: 72, y: 206, font: "sans", size: 11, tracking: 4, color: SUB, text: "POSTS " + a + " TO " + Math.min(b, 42) });
    let textW = W - 144;
    if (buf) {
      try {
        const gi = await Jimp.read(buf); gi.quality(88);
        const maxH = H - 240; let gh = maxH, gw = Math.round(gi.bitmap.width * gh / gi.bitmap.height);
        if (gw > 660) { gw = 660; gh = Math.round(gi.bitmap.height * gw / gi.bitmap.width); }
        ops.push({ t: "img", x: W - 72 - gw, y: 140, w: gw, h: gh, jpg: await gi.getBufferAsync(Jimp.MIME_JPEG) });
        textW = W - 72 - gw - 72 - 54;
      } catch {}
    }
    const items = posts.filter((p) => p.n >= a && p.n <= b);
    const dense = items.length > 9; // 12-post windows sit a little tighter
    const fT = dense ? 15 : 16, fC = dense ? 15 : 16, lh = dense ? 21 : 23, gap = dense ? 9 : 13;
    let y = 244;
    for (const p of items) {
      if (y > H - 70) break;
      const head = "Post " + p.n + (p.isC && p.concept ? " · " + T(p.concept) : "");
      ops.push({ t: "text", x: 72, y, font: "sansB", size: fT, color: INK, text: head }); y += lh + 1;
      if (p.isC) { ops.push({ t: "text", x: 72, y, font: "sans", size: fC - 1, color: SUB, text: "Courtney: caption and hashtags to come" }); y += lh - 1; }
      else {
        for (const ln of wrap("Caption: " + T(p.desc), "sans", fC, textW)) { ops.push({ t: "text", x: 72, y, font: "sans", size: fC, color: INK, text: ln }); y += lh; }
        if (p.tags) { ops.push({ t: "text", x: 72, y, font: "sans", size: fC - 2, color: SUB, text: p.tags }); y += lh - 2; }
      }
      y += gap;
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
