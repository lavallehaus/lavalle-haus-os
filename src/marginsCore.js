// LAVALLE HAUS OS — shared margins core.
// Pure functions that turn raw business data into the per-SKU CM1/CM2 model
// AND the action-item flags. Both the Margins tab and the Action Items board
// import this, so the board can build its to-do list on its own — no need to
// open the Margins tab, no button to press.

export const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
export const SPEND_30 = 30 / 7;

export function cogsPerUnit(p, laborRate) {
  const y = Math.max(num(p.batchYield), 1);
  const per = (cost, basis) => (basis === "unit" ? cost : cost / y);
  const sumMat = (rows) => (rows || []).reduce((s, l) => s + per(num(l.qty) * num(l.unitCost), l.basis), 0);
  const sumLab = (rows) => (rows || []).reduce((s, l) => s + per(num(l.hours) * num(laborRate), l.basis), 0);
  return sumMat(p.materials) + sumMat(p.packaging) + sumMat(p.shipping) + sumLab(p.labor);
}

// Auto-suggest which SKU a campaign promotes, from its name.
const STOP = new Set(["match", "broad", "exact", "phrase", "discovery", "expansion", "high", "intent", "search", "volume", "targeting", "product", "h10", "campaign", "sponsored", "auto", "manual", "keyword", "keywords", "ads", "amazon", "the", "and", "for", "launch", "new", "test", "low", "brand", "defense", "competitor", "set", "vessel", "candle"]);
const toks = (str) => (str || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
export function suggestProductId(campName, prods) {
  const ct = toks(campName);
  if (!ct.length) return "";
  let best = "", bestScore = 0;
  prods.forEach((p) => {
    const pt = toks(p.name);
    const lname = (p.name || "").toLowerCase();
    let score = 0;
    ct.forEach((w) => { if (pt.includes(w)) score += 1; else if (lname.includes(w)) score += 0.5; });
    if (score > bestScore) { bestScore = score; best = p.id; }
  });
  return bestScore > 0 ? best : "";
}

// Build the full margins model from raw slices + the user's margin settings.
// settings = { referralPct, returnsPct, bySku, adMap, amazonFba }
export function buildMarginsModel({ cogs = {}, products = [], campaigns = [], profitMatrix = {}, settings = {} } = {}) {
  const laborRate = num(cogs.laborRate);
  const cogsProducts = cogs.products || [];
  const referralPct = settings.referralPct != null ? settings.referralPct : 15;
  const returnsPct = settings.returnsPct != null ? settings.returnsPct : 2;
  const bySku = settings.bySku || {};
  const adMap = settings.adMap || {};
  const amazonFba = settings.amazonFba || {};

  const pmById = {};
  (profitMatrix.products || []).forEach((p) => { pmById[p.id] = { fba: num(p.fbaFee) + num(p.storage), landed: num(p.cogs) + num(p.packaging) + num(p.freight), retail: num(p.retail) }; });
  const cogsById = {};
  cogsProducts.forEach((p) => { cogsById[p.id] = p; });

  const amazonTargets = products.filter((p) => (p.channels || []).includes("Amazon") || p.asin);

  const effMap = {};
  (campaigns || []).forEach((cm) => { const ex = adMap[cm.id]; effMap[cm.id] = (ex !== undefined && ex !== "") ? ex : suggestProductId(cm.name, amazonTargets); });

  const adByProduct = {};
  (campaigns || []).forEach((cm) => { const pid = effMap[cm.id]; if (pid == null || pid === "") return; adByProduct[pid] = (adByProduct[pid] || 0) + num(cm.spend7d) * SPEND_30; });

  const rows = (products || []).filter((p) => !p.isSample && (num(p.price) > 0 || cogsById[p.id] || pmById[p.id] || p.asin)).map((prod) => {
    const p = cogsById[prod.id] || {};
    const pm = pmById[prod.id] || {};
    const price = num(p.retail) > 0 ? num(p.retail) : (num(prod.price) > 0 ? num(prod.price) : num(pm.retail));
    const builderCogs = cogsById[prod.id] ? cogsPerUnit(p, laborRate) : 0;
    const cogsU = builderCogs > 0 ? builderCogs : (pm.landed || 0);
    const cogsSrc = builderCogs > 0 ? "builder" : (pm.landed > 0 ? "matrix" : null);
    const cm1 = price - cogsU;
    const cm1pct = price > 0 ? (cm1 / price) * 100 : null;
    const sk = bySku[prod.id] || {};
    const referral = price * (num(referralPct) / 100);
    const returns = price * (num(returnsPct) / 100);
    const overrideFba = sk.fbaFee !== undefined && sk.fbaFee !== "";
    const amzFba = amazonFba[prod.id];
    const amzSet = amzFba != null && amzFba !== "";
    const autoFba = amzSet ? num(amzFba) : (pm.fba != null ? pm.fba : null);
    const fbaAutoSrc = amzSet ? "amazon" : (pm.fba != null && pm.fba > 0 ? "matrix" : null);
    const fbaFee = overrideFba ? num(sk.fbaFee) : (autoFba != null && autoFba > 0 ? autoFba : null);
    const fbaIsAuto = !overrideFba && autoFba != null && autoFba > 0;
    const units = num(prod.unitsSold30);
    const mappedSpend = adByProduct[prod.id] || 0;
    const computedAd = units > 0 ? mappedSpend / units : null;
    const overrideAd = sk.adPerUnit !== undefined && sk.adPerUnit !== "";
    const ad = overrideAd ? num(sk.adPerUnit) : (computedAd != null ? computedAd : 0);
    const adIsAuto = !overrideAd && computedAd != null && mappedSpend > 0;
    const fbaSet = fbaFee != null;
    const cm2 = fbaSet ? cm1 - referral - returns - fbaFee - ad : null;
    const cm2pct = cm2 != null && price > 0 ? (cm2 / price) * 100 : null;
    return { id: prod.id, name: prod.name, price, cogsU, cogsSrc, cm1, cm1pct, referral, returns, fbaFee, autoFba, fbaIsAuto, fbaAutoSrc, ad, adIsAuto, computedAd, mappedSpend, cm2, cm2pct, units, hasCogs: cogsU > 0 };
  }).sort((a, b) => {
    const am = a.cm2pct != null ? a.cm2pct : (a.cm1pct != null ? a.cm1pct : 999);
    const bm = b.cm2pct != null ? b.cm2pct : (b.cm1pct != null ? b.cm1pct : 999);
    return am - bm;
  });

  // Action-item flags (same keys the board dedupes on).
  const flags = [];
  rows.forEach((r) => {
    if (r.price <= 0) { flags.push({ key: "price:" + r.id, productId: r.id, name: r.name, severity: "med", title: "Set a retail price for " + r.name, detail: "No price is set, so margin can't be calculated yet." }); return; }
    if (r.units === 0 && r.mappedSpend > 0) { flags.push({ key: "adwaste:" + r.id, productId: r.id, name: r.name, severity: "high", title: "Ad spend with no sales — " + r.name, detail: "$" + r.mappedSpend.toFixed(0) + "/mo in ads, 0 units sold in 30 days. Pure loss — pause or retarget." }); }
    if (r.cm2 != null && r.cm2 < 0) {
      const adBig = r.ad > (r.fbaFee || 0);
      flags.push({ key: "cm2neg:" + r.id, productId: r.id, name: r.name, severity: "high", title: r.name + " loses $" + Math.abs(r.cm2).toFixed(2) + "/unit after Amazon's cut", detail: "CM2 " + (r.cm2pct != null ? r.cm2pct.toFixed(0) + "%" : "") + ". Biggest lever: " + (adBig ? ("ad cost $" + r.ad.toFixed(2) + "/unit — review campaign mapping & spend") : ("FBA $" + (r.fbaFee || 0).toFixed(2) + "/unit")) + (r.hasCogs ? "" : " (COGS not yet entered, so the real loss is larger)") + "." });
    } else if (r.cm2 != null && r.cm2pct != null && r.cm2pct < 15) {
      flags.push({ key: "thin:" + r.id, productId: r.id, name: r.name, severity: "med", title: "Thin margin on " + r.name + " (" + r.cm2pct.toFixed(0) + "% CM2)", detail: "Little cushion after Amazon fees and ads. A small cost rise or price drop turns it negative." });
    }
    if (!r.hasCogs && r.price > 0) { flags.push({ key: "cogs:" + r.id, productId: r.id, name: r.name, severity: "low", title: "Add COGS for " + r.name, detail: "Margin is overstated until cost is entered in the COGS Builder and saved." }); }
  });

  // Portfolio summary (weighted by units sold).
  let wRev = 0, wCm1 = 0, wCm2 = 0, cm2KnownRev = 0;
  const totUnits = rows.reduce((s, r) => s + r.units, 0);
  rows.forEach((r) => {
    const w = totUnits > 0 ? r.units : 1;
    wRev += r.price * w; wCm1 += r.cm1 * w;
    if (r.cm2 != null) { wCm2 += r.cm2 * w; cm2KnownRev += r.price * w; }
  });
  const summary = { cm1Pct: wRev > 0 ? (wCm1 / wRev) * 100 : null, cm2Pct: cm2KnownRev > 0 ? (wCm2 / cm2KnownRev) * 100 : null };

  const totalCampaignSpend30 = (campaigns || []).reduce((s, cm) => s + num(cm.spend7d) * SPEND_30, 0);
  const unmappedSpend30 = (campaigns || []).reduce((s, cm) => s + (effMap[cm.id] ? 0 : num(cm.spend7d) * SPEND_30), 0);

  return { rows, flags, summary, effMap, adByProduct, amazonTargets, totalCampaignSpend30, unmappedSpend30, laborRate };
}
