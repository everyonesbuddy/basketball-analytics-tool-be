/**
 * Style rules, as pure functions: suggest outfits for an occasion and the
 * day's weather from the guide and the wardrobe, and list the core pieces the
 * guide calls for that aren't owned yet (the shopping gaps).
 */
const S = require("../../config/os/style");

const COLD_F = 62; // below this (or in rain) the layer goes on
const HOT_F = 82; // at or above this the layer stays home
const COAT_F = 45;

const familyOf = (color) => S.COLORS[color]?.family || null;

/** A small stable hash so the same day gives the same order, and the next day rotates. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function layerRule(weather) {
  if (!weather || !Number.isFinite(weather.tempF)) return { layer: "optional", why: "Layer optional." };
  const t = Math.round(weather.tempF);
  if (weather.rain) return { layer: "wear", why: `${t}°F and rain: wear the layer.` };
  if (t < COLD_F) return { layer: "wear", why: `${t}°F: wear the layer.` };
  if (t >= HOT_F) return { layer: "skip", why: `${t}°F: leave the layer at home.` };
  return { layer: "optional", why: `${t}°F: layer optional.` };
}

/**
 * Find a wardrobe piece for a slot and color: the exact color first, then the
 * same family (a tonal look only needs the family), never one already used.
 */
function pick(wardrobe, slot, color, { tonal, used }) {
  const pool = wardrobe.filter((w) => w.active !== false && w.slot === slot && !used.has(String(w._id)));
  const exact = pool.find((w) => w.color === color);
  if (exact) return exact;
  const fam = familyOf(color);
  const same = pool.find((w) => familyOf(w.color) === fam);
  if (same) return same;
  // A black shoe goes with any tonal look that isn't olive.
  if (tonal && slot === "shoe" && fam !== "olive") return pool.find((w) => w.color === "black") || null;
  return null;
}

function lookName(look) {
  if (look.name) return look.name;
  if (look.structure === "monochrome") return S.TONAL[look.family]?.name || "Tonal";
  return look.pieces
    .filter(([slot]) => slot !== "shoe")
    .map(([, , desc]) => desc)
    .join(", ")
    .replace(/^./, (c) => c.toUpperCase());
}

function buildOutfit(look, { occasion, weather, wardrobe }) {
  const occ = S.OCCASIONS[occasion];
  const structure = S.STRUCTURES[look.structure];
  const rule = layerRule(weather);
  const used = new Set();
  const notes = [rule.why];
  const pieces = [];
  for (const [slot, color, desc] of look.pieces) {
    if (slot === "layer" && rule.layer === "skip") continue;
    const item = pick(wardrobe, slot, color, { tonal: look.structure === "monochrome", used });
    if (item) used.add(String(item._id));
    const c = S.COLORS[color] || {};
    let text = desc;
    if (slot === "shoe" && occ.chunky) text = /\(chunky for streetwear\)/.test(desc) ? "Chunky sneaker" : /chunky/i.test(desc) ? desc : `${desc}, or a chunky sneaker on purpose`;
    if (slot === "shoe" && !occ.chunky) text = desc.replace(/ \(chunky for streetwear\)/, "");
    pieces.push({
      slot,
      color,
      colorName: c.name || color,
      hex: c.hex || "#999",
      desc: text,
      item: item ? { _id: item._id, name: item.name, color: item.color, image: item.image || "" } : null,
      missing: !item,
      optional: slot === "layer" && rule.layer === "optional",
    });
  }
  if (weather?.rain) notes.push("Rain: a clean boot over sneakers.");
  if (weather && Number.isFinite(weather.tempF) && weather.tempF < COAT_F) {
    notes.push(look.structure === "monochrome" ? "Cold: a coat in the same color family keeps the line." : "Cold: a cropped jacket or dark coat over it.");
  }
  if (!occ.chunky) notes.push("Shoes minimal with a thin sole.");
  const core = pieces.filter((p) => !p.optional);
  return {
    key: look.key,
    name: lookName(look),
    structure: look.structure,
    structureName: structure.name,
    family: look.family || null,
    why: structure.why,
    layer: rule.layer,
    pieces,
    notes,
    owned: core.filter((p) => !p.missing).length,
    total: core.length,
    search: look.search,
  };
}

/**
 * Suggest up to `count` outfits for an occasion.
 * Ranking: the occasion's preferred structure first, then how much of it you
 * own, minus anything worn in the last few days, with a daily rotation so the
 * top pick changes from day to day.
 */
function suggestOutfits({ occasion = "everyday", weather = null, wardrobe = [], recent = [], date = "", count = 3 } = {}) {
  const occ = S.OCCASIONS[occasion] ? occasion : "everyday";
  const order = S.OCCASIONS[occ].structures;
  const today = date || new Date().toISOString().slice(0, 10);
  const daysAgo = (d) => Math.round((Date.parse(today) - Date.parse(String(d).slice(0, 10))) / 86400000);
  const recentLooks = new Map();
  const recentFamilies = new Map();
  for (const r of recent) {
    const ago = daysAgo(r.date);
    if (!(ago >= 0 && ago <= 7)) continue;
    if (r.lookKey) recentLooks.set(r.lookKey, Math.min(ago, recentLooks.get(r.lookKey) ?? 99));
    if (r.family) recentFamilies.set(r.family, Math.min(ago, recentFamilies.get(r.family) ?? 99));
  }

  const scored = S.LOOKS.filter((l) => l.occasions.includes(occ) && order.includes(l.structure)).map((look) => {
    const outfit = buildOutfit(look, { occasion: occ, weather, wardrobe });
    let score = (order.length - order.indexOf(look.structure)) * 2;
    score += outfit.total ? (outfit.owned / outfit.total) * 3 : 0;
    const lookAgo = recentLooks.get(look.key);
    if (lookAgo !== undefined) score -= lookAgo <= 3 ? 6 : 3;
    const famAgo = look.family ? recentFamilies.get(look.family) : undefined;
    if (famAgo !== undefined && famAgo <= 1) score -= 2;
    score += hash(`${today}:${look.key}`) * 1.5;
    return { outfit, score };
  });
  scored.sort((a, b) => b.score - a.score);

  // Keep the picks varied: one per structure first, then fill.
  const picks = [];
  const seen = new Set();
  for (const s of scored) {
    if (picks.length >= count) break;
    if (!seen.has(s.outfit.structure)) {
      picks.push(s.outfit);
      seen.add(s.outfit.structure);
    }
  }
  for (const s of scored) {
    if (picks.length >= count) break;
    if (!picks.includes(s.outfit)) picks.push(s.outfit);
  }
  return { occasion: occ, occasionName: S.OCCASIONS[occ].name, shoe: S.OCCASIONS[occ].shoe, layer: layerRule(weather), outfits: picks };
}

/** The guide's core pieces, marked owned or missing, missing and most important first. */
function gaps({ wardrobe = [] } = {}) {
  const active = wardrobe.filter((w) => w.active !== false);
  // Each piece you own covers one core item, the most important one first
  // (one white top is the white tee, not also the oxford).
  const used = new Set();
  const byPriority = [...S.CORE].sort((a, b) => a.priority - b.priority);
  const match = new Map();
  for (const c of byPriority) {
    const item = active.find((w) => w.slot === c.slot && w.color === c.color && !used.has(String(w._id)));
    if (item) {
      used.add(String(item._id));
      match.set(c.key, item);
    }
  }
  const items = S.CORE.map((c) => {
    const item = match.get(c.key);
    return { ...c, owned: Boolean(item), item: item ? { _id: item._id, name: item.name } : null };
  });
  items.sort((a, b) => Number(a.owned) - Number(b.owned) || a.priority - b.priority);
  const missing = items.filter((i) => !i.owned);
  return { items, missing: missing.length, owned: items.length - missing.length, next: missing.filter((i) => i.priority === Math.min(...missing.map((m) => m.priority))).slice(0, 3) };
}

module.exports = { suggestOutfits, gaps, layerRule, familyOf };
