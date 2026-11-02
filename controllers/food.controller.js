/**
 * Food: today's meal ideas (cook or order), a week of dinners with its
 * grocery list, what you ate (so ideas rotate), likes and dislikes, and
 * meals of your own. Scoped to the signed-in owner.
 */
const mongoose = require("mongoose");
const { FoodSettings, MealLog, MealPlan, CustomMeal } = require("../models/foodModels");
const F = require("../config/os/food");
const food = require("../utils/os/food");
const plan = require("../utils/os/plan");

const fail = (res, status, message) => res.status(status).json({ success: false, error: { message } });
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const str = (v, max) => String(v ?? "").trim().slice(0, max);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLOTS = ["breakfast", "lunch", "dinner"];
const today = () => plan.localParts().date;

const settingsFor = async (owner) => (await FoodSettings.findOne({ owner }).lean()) || { ...food.DEFAULTS };
const recentFor = (owner, date) => MealLog.find({ owner, date: { $gte: food.addDays(date, -14), $lte: date } }).sort({ date: -1 }).lean();

/** Reminder for Today: on the weekend, plan next week's dinners and groceries. */
exports.remindersFor = async (owner) => {
  const date = today();
  if (!["Sat", "Sun"].includes(food.weekdayOf(date))) return [];
  const next = food.addDays(food.weekStartOf(date), 7);
  const has = await MealPlan.exists({ owner, weekStart: next });
  return has ? [] : [{ kind: "food", text: "Plan next week's dinners and the grocery list (two minutes)." }];
};

exports.overview = async (req, res) => {
  const owner = req.user.id;
  const date = today();
  const thisWeek = food.weekStartOf(date);
  const nextWeek = food.addDays(thisWeek, 7);
  const [settings, recent, plans, custom] = await Promise.all([
    settingsFor(owner),
    recentFor(owner, date),
    MealPlan.find({ owner, weekStart: { $in: [thisWeek, nextWeek] } }).lean(),
    CustomMeal.find({ owner }).sort({ name: 1 }).lean(),
  ]);
  const current = plans.find((p) => p.weekStart === thisWeek) || null;
  return res.json({
    success: true,
    date,
    weekday: food.weekdayOf(date),
    thisWeek,
    nextWeek,
    settings: { ...food.DEFAULTS, ...settings },
    recent,
    plans: { current, next: plans.find((p) => p.weekStart === nextWeek) || null },
    custom,
    ideas: food.suggestDay({ date, settings, recent, plan: current, custom }),
    meals: [...F.MEALS, ...custom.map(food.fromCustom)].map((m) => ({ key: m.key, name: m.name, cuisine: m.cuisine, mins: m.mins, mode: m.mode, slots: m.slots, search: m.search, batch: Boolean(m.batch), note: m.note || "", order: m.order || "", link: m.link || "", custom: Boolean(m.custom), orderUrl: food.orderUrl(m) })),
    cuisines: F.CUISINES,
    aisles: F.AISLES,
  });
};

/** New ideas for today (seed changes the shuffle). */
exports.suggest = async (req, res) => {
  const owner = req.user.id;
  const date = today();
  const [settings, recent, current, custom] = await Promise.all([settingsFor(owner), recentFor(owner, date), MealPlan.findOne({ owner, weekStart: food.weekStartOf(date) }).lean(), CustomMeal.find({ owner }).lean()]);
  const seed = Number(req.body?.seed) || 0;
  return res.json({ success: true, ideas: food.suggestDay({ date, settings, recent, plan: current, custom, seed }) });
};

exports.saveSettings = async (req, res) => {
  const b = req.body || {};
  const set = {};
  if (b.noShellfish !== undefined) set.noShellfish = Boolean(b.noShellfish);
  if (b.tortillas !== undefined) set.tortillas = Boolean(b.tortillas);
  if (["little", "none"].includes(b.sugar)) set.sugar = b.sugar;
  if (Array.isArray(b.cuisines)) set.cuisines = b.cuisines.filter((c) => F.CUISINES.includes(c));
  if (b.weeknightMax !== undefined) set.weeknightMax = Math.max(15, Math.min(180, Number(b.weeknightMax) || 45));
  if (b.cookNights !== undefined) set.cookNights = Math.max(0, Math.min(7, Math.round(Number(b.cookNights))));
  const settings = await FoodSettings.findOneAndUpdate({ owner: req.user.id }, { $set: set }, { new: true, upsert: true, runValidators: true }).lean();
  return res.json({ success: true, settings });
};

/** Like, dislike (hidden from ideas), or clear. */
exports.vote = async (req, res) => {
  const key = str(req.body?.key, 60);
  const vote = req.body?.vote;
  if (!key) return fail(res, 400, "Which meal?");
  const update = { $pull: { likes: key, dislikes: key } };
  await FoodSettings.updateOne({ owner: req.user.id }, update, { upsert: true });
  if (vote === "like" || vote === "dislike") await FoodSettings.updateOne({ owner: req.user.id }, { $addToSet: { [vote === "like" ? "likes" : "dislikes"]: key } });
  return res.json({ success: true, settings: await settingsFor(req.user.id) });
};

// ── What you ate ────────────────────────────────────────────────────────

exports.ate = async (req, res) => {
  const b = req.body || {};
  const custom = await CustomMeal.find({ owner: req.user.id }).lean();
  const meal = [...F.MEALS, ...custom.map(food.fromCustom)].find((m) => m.key === b.key);
  if (!meal) return fail(res, 400, "Which meal?");
  const slot = SLOTS.includes(b.slot) ? b.slot : "dinner";
  const date = DATE.test(b.date || "") ? b.date : today();
  // One meal per slot per day: picking again replaces it.
  await MealLog.deleteMany({ owner: req.user.id, date, slot });
  const log = await MealLog.create({ owner: req.user.id, date, slot, key: meal.key, name: meal.name, cuisine: meal.cuisine, mode: b.mode === "order" ? "order" : "cook" });
  return res.status(201).json({ success: true, log });
};

exports.unate = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const r = await MealLog.deleteOne({ _id: req.params.id, owner: req.user.id });
  if (!r.deletedCount) return fail(res, 404, "Not found");
  return res.json({ success: true });
};

// ── Week plan ───────────────────────────────────────────────────────────

/** A suggested week (not saved): dinners plus the grocery list. */
exports.previewPlan = async (req, res) => {
  const owner = req.user.id;
  const weekStart = DATE.test(req.body?.weekStart || "") ? food.weekStartOf(req.body.weekStart) : food.weekStartOf(today());
  const [settings, recent, custom] = await Promise.all([settingsFor(owner), recentFor(owner, today()), CustomMeal.find({ owner }).lean()]);
  const p = food.planWeek({ weekStart, settings, recent, custom, seed: Number(req.body?.seed) || 0 });
  return res.json({ success: true, plan: { ...p, grocery: food.groceryFor(p.days, { custom }) } });
};

function cleanDays(days, weekStart, keys) {
  const dates = new Set(Array.from({ length: 7 }, (_, i) => food.addDays(weekStart, i)));
  return (Array.isArray(days) ? days : [])
    .filter((d) => dates.has(d?.date) && keys.has(d.key))
    .slice(0, 7)
    .map((d) => ({ date: d.date, weekday: food.weekdayOf(d.date), mode: d.mode === "order" ? "order" : "cook", key: d.key }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Save (or replace) a week's plan; the grocery list is worked out from it, keeping ticks. */
exports.savePlan = async (req, res) => {
  const owner = req.user.id;
  const weekStart = DATE.test(req.body?.weekStart || "") ? food.weekStartOf(req.body.weekStart) : null;
  if (!weekStart) return fail(res, 400, "Which week?");
  const custom = await CustomMeal.find({ owner }).lean();
  const keys = new Set([...F.MEALS, ...custom.map(food.fromCustom)].map((m) => m.key));
  const days = food.withLeftovers(cleanDays(req.body?.days, weekStart, keys), custom);
  if (!days.length) return fail(res, 400, "Pick at least one dinner.");
  const existing = await MealPlan.findOne({ owner, weekStart }).lean();
  const grocery = food.groceryFor(days, { custom, previous: existing?.grocery || [] });
  const saved = await MealPlan.findOneAndUpdate({ owner, weekStart }, { $set: { days, grocery } }, { new: true, upsert: true, runValidators: true }).lean();
  return res.json({ success: true, plan: saved });
};

/** Tick grocery items: { bought: { "chicken thighs": true } }. */
exports.tickGrocery = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const p = await MealPlan.findOne({ _id: req.params.id, owner: req.user.id });
  if (!p) return fail(res, 404, "Not found");
  const ticks = req.body?.bought || {};
  for (const g of p.grocery) if (Object.prototype.hasOwnProperty.call(ticks, g.name)) g.bought = Boolean(ticks[g.name]);
  await p.save();
  return res.json({ success: true, plan: p.toObject() });
};

exports.deletePlan = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const r = await MealPlan.deleteOne({ _id: req.params.id, owner: req.user.id });
  if (!r.deletedCount) return fail(res, 404, "Not found");
  return res.json({ success: true });
};

// ── Your own meals ──────────────────────────────────────────────────────

exports.addMeal = async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 200);
  if (!name) return fail(res, 400, "Name the meal.");
  const meal = await CustomMeal.create({
    owner: req.user.id,
    name,
    cuisine: str(b.cuisine, 40) || "Other",
    slots: (Array.isArray(b.slots) ? b.slots : []).filter((s) => SLOTS.includes(s)),
    mins: Math.max(5, Math.min(600, Number(b.mins) || 30)),
    mode: ["cook", "order", "both"].includes(b.mode) ? b.mode : "both",
    ingredients: str(b.ingredients, 1000),
    link: /^https?:\/\//i.test(b.link || "") ? str(b.link, 2000) : "",
  });
  // With the shellfish allergy on, a meal with shellfish won't show up in ideas; say so.
  const settings = { ...food.DEFAULTS, ...(await settingsFor(req.user.id)) };
  const shellfish = food.mealHasShellfish(food.fromCustom(meal.toObject ? meal.toObject() : meal));
  return res.status(201).json({ success: true, meal, warning: shellfish && settings.noShellfish ? "Saved, but it has shellfish, so it's hidden from ideas while the shellfish allergy setting is on." : null });
};

exports.deleteMeal = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const r = await CustomMeal.deleteOne({ _id: req.params.id, owner: req.user.id });
  if (!r.deletedCount) return fail(res, 404, "Not found");
  return res.json({ success: true });
};
