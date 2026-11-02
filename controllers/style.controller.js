/**
 * Style API: the guide, outfit suggestions (occasion + the weather the browser
 * sends), the wardrobe, a wear log so suggestions rotate, and the shopping
 * list (gaps from the guide plus saved product links). Scoped to the owner.
 */
const mongoose = require("mongoose");
const { Profile, Wardrobe, OutfitLog, Shop, SLOTS } = require("../models/styleModels");
const S = require("../config/os/style");
const style = require("../utils/os/style");
const { fetchPreview } = require("../utils/os/linkPreview");
const plan = require("../utils/os/plan");

const fail = (res, status, message) => res.status(status).json({ success: false, error: { message } });
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const str = (v, max) => String(v ?? "").trim().slice(0, max);
const num = (v, min, max) => {
  if (v === null || v === "" || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
};
const url = (v) => (/^https?:\/\//i.test(v || "") ? str(v, 2000) : "");
const colorOrNull = (v) => (S.COLORS[v] ? v : null);

const recentLogs = (owner, today) => {
  const since = new Date(Date.parse(today) - 14 * 86400000).toISOString().slice(0, 10);
  return OutfitLog.find({ owner, date: { $gte: since } }).sort({ date: -1, createdAt: -1 }).limit(30).lean();
};

const weatherFrom = (w) => {
  if (!w) return null;
  const tempF = num(w.tempF, -60, 140);
  return tempF === null ? null : { tempF, rain: Boolean(w.rain) };
};

exports.overview = async (req, res) => {
  const owner = req.user.id;
  const today = plan.localParts().date;
  const [profile, wardrobe, shop, recent] = await Promise.all([
    Profile.findOne({ owner }).lean(),
    Wardrobe.find({ owner }).sort({ slot: 1, createdAt: -1 }).lean(),
    Shop.find({ owner }).sort({ status: 1, createdAt: -1 }).limit(200).lean(),
    recentLogs(owner, today),
  ]);
  return res.json({
    success: true,
    today,
    profile: profile || { city: "", lat: null, lon: null },
    wardrobe,
    shop,
    recent,
    gaps: style.gaps({ wardrobe }),
    guide: { colors: S.COLORS, tonal: S.TONAL, structures: S.STRUCTURES, silhouette: S.SILHOUETTE, occasions: S.OCCASIONS, looks: S.LOOKS, tallNote: S.TALL_NOTE, tradNotes: S.TRAD_NOTES },
  });
};

exports.suggest = async (req, res) => {
  const owner = req.user.id;
  const b = req.body || {};
  const today = plan.localParts().date;
  const [wardrobe, recent] = await Promise.all([Wardrobe.find({ owner, active: true }).lean(), recentLogs(owner, today)]);
  const result = style.suggestOutfits({ occasion: str(b.occasion, 30), weather: weatherFrom(b.weather), wardrobe, recent, date: today, count: 3 });
  return res.json({ success: true, ...result, wornToday: recent.filter((r) => r.date === today) });
};

exports.saveProfile = async (req, res) => {
  const b = req.body || {};
  const profile = await Profile.findOneAndUpdate(
    { owner: req.user.id },
    { $set: { city: str(b.city, 120), lat: num(b.lat, -90, 90), lon: num(b.lon, -180, 180) } },
    { new: true, upsert: true, runValidators: true },
  ).lean();
  return res.json({ success: true, profile });
};

// ── Wardrobe ────────────────────────────────────────────────────────────

function itemFields(b, partial) {
  const out = {};
  if (!partial || b.name !== undefined) out.name = str(b.name, 160);
  if (!partial || b.slot !== undefined) out.slot = SLOTS.includes(b.slot) ? b.slot : null;
  if (!partial || b.color !== undefined) out.color = colorOrNull(b.color);
  if (b.note !== undefined) out.note = str(b.note, 500);
  if (b.link !== undefined) out.link = url(b.link);
  if (b.image !== undefined) out.image = url(b.image);
  if (b.active !== undefined) out.active = Boolean(b.active);
  if (b.trad !== undefined) out.trad = Boolean(b.trad);
  return out;
}

exports.addItem = async (req, res) => {
  const f = itemFields(req.body || {}, false);
  if (!f.slot) return fail(res, 400, "Pick top, bottom, layer, shoe or fila.");
  if (!f.color) return fail(res, 400, "Pick a color.");
  if (!f.name) f.name = `${S.COLORS[f.color].name} ${f.slot}`;
  const item = await Wardrobe.create({ owner: req.user.id, ...f });
  return res.status(201).json({ success: true, item });
};

exports.updateItem = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const f = itemFields(req.body || {}, true);
  for (const k of ["name", "slot", "color"]) if (k in f && !f[k]) delete f[k];
  const item = await Wardrobe.findOneAndUpdate({ _id: req.params.id, owner: req.user.id }, { $set: f }, { new: true, runValidators: true }).lean();
  if (!item) return fail(res, 404, "Not found");
  return res.json({ success: true, item });
};

exports.deleteItem = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const r = await Wardrobe.deleteOne({ _id: req.params.id, owner: req.user.id });
  if (!r.deletedCount) return fail(res, 404, "Not found");
  return res.json({ success: true });
};

// ── Wear log ────────────────────────────────────────────────────────────

exports.logOutfit = async (req, res) => {
  const b = req.body || {};
  const look = S.LOOKS.find((l) => l.key === b.lookKey);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : plan.localParts().date;
  const items = (Array.isArray(b.items) ? b.items : []).filter(isId).slice(0, 8);
  const owned = items.length ? await Wardrobe.find({ owner: req.user.id, _id: { $in: items } }, { _id: 1 }).lean() : [];
  const log = await OutfitLog.create({
    owner: req.user.id,
    date,
    occasion: S.OCCASIONS[b.occasion] ? b.occasion : "everyday",
    lookKey: look ? look.key : "",
    structure: look ? look.structure : str(b.structure, 30),
    family: look ? look.family || null : null,
    name: str(b.name, 200),
    items: owned.map((o) => o._id),
  });
  return res.status(201).json({ success: true, log });
};

exports.deleteLog = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const r = await OutfitLog.deleteOne({ _id: req.params.id, owner: req.user.id });
  if (!r.deletedCount) return fail(res, 404, "Not found");
  return res.json({ success: true });
};

// ── Shopping ────────────────────────────────────────────────────────────

exports.addShop = async (req, res) => {
  const b = req.body || {};
  const link = url(b.url);
  const core = S.CORE.find((c) => c.key === b.core);
  if (!link && !b.title && !core) return fail(res, 400, "Paste a link or name the piece.");
  let preview = {};
  if (link && !b.title) {
    try {
      preview = await fetchPreview(link);
    } catch {
      preview = {};
    }
  }
  const item = await Shop.create({
    owner: req.user.id,
    url: link,
    title: str(b.title, 300) || preview.title || (core ? core.name : link),
    image: url(b.image) || preview.image || "",
    price: num(b.price, 0, 100000) ?? preview.price ?? null,
    site: str(b.site, 120) || preview.site || "",
    slot: SLOTS.includes(b.slot) ? b.slot : core ? core.slot : null,
    color: colorOrNull(b.color) || (core ? core.color : null),
    core: core ? core.key : null,
    notes: str(b.notes, 1000),
  });
  return res.status(201).json({ success: true, item, blocked: Boolean(preview.blocked) });
};

exports.updateShop = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const b = req.body || {};
  const set = {};
  if (b.title !== undefined) set.title = str(b.title, 300);
  if (b.price !== undefined) set.price = num(b.price, 0, 100000);
  if (b.notes !== undefined) set.notes = str(b.notes, 1000);
  if (b.slot !== undefined) set.slot = SLOTS.includes(b.slot) ? b.slot : null;
  if (b.color !== undefined) set.color = colorOrNull(b.color);
  if (["want", "bought"].includes(b.status)) set.status = b.status;
  const item = await Shop.findOneAndUpdate({ _id: req.params.id, owner: req.user.id }, { $set: set }, { new: true }).lean();
  if (!item) return fail(res, 404, "Not found");
  // Bought it? Put it in the wardrobe so outfits can use it.
  let added = null;
  if (b.status === "bought" && b.addToWardrobe && item.slot && item.color) {
    const native = S.CORE.find((c) => c.key === item.core)?.group === "traditional";
    added = await Wardrobe.create({ owner: req.user.id, name: item.title.slice(0, 160) || `${S.COLORS[item.color].name} ${item.slot}`, slot: item.slot, color: item.color, link: item.url, image: item.image, trad: native });
  }
  return res.json({ success: true, item, added });
};

exports.deleteShop = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const r = await Shop.deleteOne({ _id: req.params.id, owner: req.user.id });
  if (!r.deletedCount) return fail(res, 404, "Not found");
  return res.json({ success: true });
};
