/**
 * Food rules, as pure functions: today's meal ideas (cook or order) that
 * rotate and stay varied, a week of dinners, and the grocery list for it.
 */
const F = require("../../config/os/food");

const DAY = 86400000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULTS = { noShellfish: true, tortillas: true, sugar: "little", cuisines: [], weeknightMax: 45, cookNights: 5, likes: [], dislikes: [] };

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekdayOf = (date) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
const isWeekend = (date) => ["Sat", "Sun"].includes(weekdayOf(date));

/** Monday of the week a date is in. */
function weekStartOf(date) {
  const dow = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

/**
 * Does this text mention shellfish? Safe swaps written into the library
 * ("not crayfish", "no shrimp paste", a vegetarian "oyster" sauce, oyster
 * mushrooms) don't count.
 */
function hasShellfish(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/\([^)]*\b(not|no|instead of|vegetarian)\b[^)]*\)/g, " ")
    .replace(/vegetarian '?oyster'? sauce|oyster mushrooms?/g, " ");
  return F.SHELLFISH.some((w) => new RegExp(`\\b${w}s?\\b`).test(t));
}

const mealHasShellfish = (meal) => hasShellfish(meal.name) || meal.ing.some(([name]) => hasShellfish(name));

/** A link to order it nearby (Google Maps search; no API needed). */
const orderUrl = (meal) => `https://www.google.com/maps/search/${encodeURIComponent(`${meal.order || meal.name} near me`)}`;

/** Your own meals, shaped like library meals. Ingredients come as "chicken, rice, peppers". */
function fromCustom(c) {
  return {
    key: `c_${c._id}`,
    name: c.name,
    cuisine: c.cuisine || "Other",
    slots: c.slots?.length ? c.slots : ["lunch", "dinner"],
    mins: c.mins || 30,
    mode: c.mode || "both",
    ing: String(c.ingredients || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
      .map((x) => [x, "pantry"]),
    search: `${c.name} recipe`,
    sugar: "none",
    link: c.link || "",
    custom: true,
  };
}

/** The meals that fit your settings (no tortillas if they count as bread, sugar level, cuisines, dislikes). */
function library({ settings = {}, custom = [] } = {}) {
  const s = { ...DEFAULTS, ...settings };
  const dislikes = new Set(s.dislikes || []);
  const cuisines = new Set(s.cuisines || []);
  return [...F.MEALS, ...custom.map(fromCustom)].filter(
    (meal) => !dislikes.has(meal.key) && !(s.noShellfish && mealHasShellfish(meal)) && (s.tortillas || !meal.tortilla) && (s.sugar !== "none" || meal.sugar === "none") && (!cuisines.size || meal.custom || cuisines.has(meal.cuisine)),
  );
}

/** How recently each meal and cuisine was eaten (days ago). */
function recency(recent, date) {
  const meals = new Map();
  const cuisines = new Map();
  for (const r of recent) {
    const ago = daysBetween(r.date, date);
    if (ago < 0) continue;
    if (!meals.has(r.key) || ago < meals.get(r.key)) meals.set(r.key, ago);
    if (r.cuisine && (!cuisines.has(r.cuisine) || ago < cuisines.get(r.cuisine))) cuisines.set(r.cuisine, ago);
  }
  return { meals, cuisines };
}

/** Score a meal for a slot on a date: rotation, likes, time on a weeknight, a little daily randomness. */
function scorer({ date, slot, settings, recent, seed = 0 }) {
  const s = { ...DEFAULTS, ...settings };
  const likes = new Set(s.likes || []);
  const { meals, cuisines } = recency(recent, date);
  return (meal, mode) => {
    let score = hash(`${date}:${slot}:${mode}:${seed}:${meal.key}`) * 3;
    if (likes.has(meal.key)) score += 2;
    const ago = meals.get(meal.key);
    if (ago !== undefined) score -= ago <= 2 ? 8 : ago <= 7 ? 3 : 0;
    const cAgo = cuisines.get(meal.cuisine);
    if (cAgo !== undefined && cAgo <= 1) score -= 1.5;
    if (mode === "cook" && slot !== "breakfast" && !isWeekend(date) && meal.mins > s.weeknightMax) score -= 4;
    if (mode === "cook" && slot === "lunch" && meal.mins > 40) score -= 2;
    if (mode === "cook" && isWeekend(date) && meal.batch) score += 1;
    return score;
  };
}

/** The top `n` meals, each from a different cuisine where possible. */
function pickVaried(scored, n, avoidCuisine) {
  const out = [];
  const seen = new Set(avoidCuisine ? [avoidCuisine] : []);
  for (const x of scored) {
    if (out.length >= n) break;
    if (!seen.has(x.meal.cuisine)) {
      out.push(x.meal);
      seen.add(x.meal.cuisine);
    }
  }
  for (const x of scored) {
    if (out.length >= n) break;
    if (!out.includes(x.meal)) out.push(x.meal);
  }
  return out;
}

const view = (meal) => ({ ...meal, orderUrl: orderUrl(meal) });

/**
 * Today's ideas: for breakfast, lunch and dinner, three to cook and three to
 * order, varied by cuisine and rotated away from what you had lately. If the
 * week's plan has tonight's dinner, it's first; if last night's dinner makes
 * leftovers, lunch says so.
 */
function suggestDay({ date, settings = {}, recent = [], plan = null, custom = [], seed = 0 }) {
  const lib = library({ settings, custom });
  const planned = plan?.days?.find((d) => d.date === date) || null;
  const plannedMeal = planned ? lib.find((x) => x.key === planned.key) || [...F.MEALS, ...custom.map(fromCustom)].find((x) => x.key === planned.key) : null;
  const yesterday = addDays(date, -1);
  const lastNight = recent.find((r) => r.date === yesterday && r.slot === "dinner") || plan?.days?.find((d) => d.date === yesterday);
  const leftover = lastNight ? [...F.MEALS, ...custom.map(fromCustom)].find((x) => x.key === lastNight.key && x.batch) : null;

  const slots = {};
  let dinnerCuisine = plannedMeal?.cuisine || null;
  const taken = new Set(plannedMeal ? [plannedMeal.key] : []); // no meal twice in a day
  for (const slot of ["dinner", "lunch", "breakfast"]) {
    const fits = lib.filter((meal) => meal.slots.includes(slot));
    const out = {};
    for (const mode of ["cook", "order"]) {
      const score = scorer({ date, slot, settings, recent, seed });
      const pool = fits.filter((meal) => (mode === "cook" ? meal.mode !== "order" : meal.mode !== "cook") && !taken.has(meal.key));
      const ranked = pool.map((meal) => ({ meal, score: score(meal, mode) })).sort((a, b) => b.score - a.score);
      out[mode] = pickVaried(ranked, 3, slot === "lunch" ? dinnerCuisine : null).map(view);
      for (const meal of out[mode]) taken.add(meal.key);
    }
    if (slot === "dinner" && !dinnerCuisine) dinnerCuisine = out.cook[0]?.cuisine || null;
    slots[slot] = out;
  }
  return {
    date,
    planned: plannedMeal ? { ...view(plannedMeal), mode: planned.mode } : null,
    leftovers: leftover ? { key: leftover.key, name: leftover.name } : null,
    slots,
  };
}

/**
 * A week of dinners from Monday: `cookNights` to cook (weeknights quick,
 * weekend batch cooking), the rest ordered (Friday and Saturday first), no
 * meal twice, no cuisine two nights running, at most two of any cuisine.
 */
function planWeek({ weekStart, settings = {}, recent = [], custom = [], seed = 0 }) {
  const s = { ...DEFAULTS, ...settings };
  const lib = library({ settings: s, custom }).filter((meal) => meal.slots.includes("dinner"));
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const orderOrder = ["Fri", "Sat", "Wed", "Sun", "Thu", "Tue", "Mon"];
  const orderDays = new Set(orderOrder.slice(0, Math.max(0, 7 - Math.max(0, Math.min(7, s.cookNights)))));
  const used = new Set();
  const perCuisine = new Map();
  const days = [];
  let prevCuisine = null;
  for (const date of dates) {
    const wd = weekdayOf(date);
    const mode = orderDays.has(wd) ? "order" : "cook";
    const score = scorer({ date, slot: "dinner", settings: s, recent, seed });
    const pool = lib.filter((meal) => (mode === "cook" ? meal.mode !== "order" : meal.mode !== "cook") && !used.has(meal.key));
    const ranked = pool
      .map((meal) => {
        let sc = score(meal, mode);
        if (meal.cuisine === prevCuisine) sc -= 6;
        if ((perCuisine.get(meal.cuisine) || 0) >= 2) sc -= 10;
        if (mode === "cook" && wd === "Sun" && meal.batch) sc += 2;
        return { meal, sc };
      })
      .sort((a, b) => b.sc - a.sc);
    const meal = ranked[0]?.meal;
    if (!meal) continue;
    used.add(meal.key);
    perCuisine.set(meal.cuisine, (perCuisine.get(meal.cuisine) || 0) + 1);
    prevCuisine = meal.cuisine;
    days.push({ date, weekday: wd, mode, key: meal.key });
  }
  return { weekStart, days: withLeftovers(days, custom) };
}

/** Mark the day after a batch dinner: lunch is leftovers. */
function withLeftovers(days, custom = []) {
  const all = [...F.MEALS, ...custom.map(fromCustom)];
  return days.map((d, i) => {
    const prev = days[i - 1];
    const prevMeal = prev && prev.mode === "cook" ? all.find((x) => x.key === prev.key) : null;
    return { ...d, lunch: prevMeal?.batch ? `Leftovers: ${prevMeal.name}` : d.lunch || null };
  });
}

/**
 * The grocery list for the cook nights, by aisle, each with the meals it's
 * for. Staples (salt, oil, onions, rice…) are listed as "check you have".
 * Keeps `bought` ticks from a previous list.
 */
function groceryFor(days, { custom = [], previous = [] } = {}) {
  const all = [...F.MEALS, ...custom.map(fromCustom)];
  const had = new Map(previous.map((g) => [g.name, Boolean(g.bought)]));
  const items = new Map();
  for (const d of days) {
    if (d.mode !== "cook") continue;
    const meal = all.find((x) => x.key === d.key);
    if (!meal) continue;
    for (const [name, aisle] of meal.ing) {
      const it = items.get(name) || { name, aisle, for: [], staple: F.STAPLES.has(name), bought: had.get(name) || false };
      if (!it.for.includes(meal.name)) it.for.push(meal.name);
      items.set(name, it);
    }
  }
  const order = new Map(F.AISLES.map((a, i) => [a.key, i]));
  return [...items.values()].sort((a, b) => Number(a.staple) - Number(b.staple) || (order.get(a.aisle) ?? 99) - (order.get(b.aisle) ?? 99) || a.name.localeCompare(b.name));
}

module.exports = { hasShellfish, mealHasShellfish, DEFAULTS, library, suggestDay, planWeek, groceryFor, withLeftovers, weekStartOf, addDays, weekdayOf, fromCustom, orderUrl };
