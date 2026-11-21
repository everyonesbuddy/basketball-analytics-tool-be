/**
 * Care and the gift circle, as pure functions (tested).
 *
 * Care: what to do for your wife next. A small gesture every week or so and
 * something booked every month or so (both adjustable). Ideas she's done
 * lately, ones you skipped recently and ones she doesn't like are left out;
 * the kinds she likes come first, and it avoids repeating the last kind.
 *
 * Gift circle: every 1–2 months, someone from your people (a friend, an
 * uncle, your mum, grandma…) who hasn't had a gift in the longest time, with
 * a hamper or service that fits your budget.
 */
const C = require("../../config/os/care");
const gifting = require("./gifting");

const DAY = 24 * 60 * 60 * 1000;
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const addDays = (date, n) => ymd(Date.parse(`${date}T00:00:00Z`) + n * DAY);

/** A stable number for today + text, so suggestions shuffle daily but not on every refresh. */
function seeded(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}

/** Map and booking links for an idea ("pedicure salon near me"). */
function links(idea) {
  if (!idea.find) return [];
  const q = encodeURIComponent(`${idea.find} near me`);
  return [
    { label: "Find nearby", url: `https://www.google.com/maps/search/${q}` },
    ...(idea.kind === "active" || idea.kind === "pamper" ? [{ label: "ClassPass", url: `https://classpass.com/search?q=${encodeURIComponent(idea.find)}` }] : []),
    ...(idea.key === "book_club" || idea.key === "workshop" || idea.key === "paint_sip" ? [{ label: "Eventbrite", url: `https://www.eventbrite.com/d/local/${encodeURIComponent(idea.find.replace(/\s+/g, "-"))}/` }] : []),
  ];
}

/**
 * The next ideas for her, best first.
 * prefs: { likesKinds: [], dislikes: [ideaKey], budgetSmall, budgetBig }
 * log:   [{ kind: "care", ideaKey, status: "done"|"planned"|"skipped", date }]
 */
function suggestCare({ prefs = {}, log = [], today, size = "big", count = 3, ideas = C.CARE_IDEAS }) {
  const care = log.filter((l) => l.kind === "care");
  const lastAt = (key, status) =>
    care
      .filter((l) => l.ideaKey === key && (!status || status.includes(l.status)))
      .map((l) => ymd(l.date))
      .sort()
      .at(-1);
  const lastKind = care
    .filter((l) => l.status === "done" && l.size === size)
    .sort((a, b) => ymd(a.date).localeCompare(ymd(b.date)))
    .map((l) => ideas.find((i) => i.key === l.ideaKey)?.kind)
    .at(-1);
  const budget = size === "big" ? prefs.budgetBig ?? 150 : prefs.budgetSmall ?? 40;
  const likes = new Set(prefs.likesKinds || []);
  const dislikes = new Set(prefs.dislikes || []);
  const rest = size === "big" ? 60 : 21; // days before the same idea comes back

  const scored = ideas
    .filter((i) => i.size === size && !dislikes.has(i.key))
    .filter((i) => {
      const done = lastAt(i.key, ["done", "planned"]);
      const skipped = lastAt(i.key, ["skipped"]);
      return (!done || daysBetween(done, today) >= rest) && (!skipped || daysBetween(skipped, today) >= 14);
    })
    .map((i) => {
      let score = seeded(`${today}:${i.key}`); // 0..1 daily shuffle
      if (likes.has(i.kind)) score += 1;
      if (i.kind === lastKind) score -= 0.6;
      if (i.price > budget) score -= 2;
      if (!lastAt(i.key)) score += 0.3; // never tried
      return { ...i, score, fits: i.price <= budget, links: links(i) };
    })
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map(({ score, ...i }) => i);
}

/**
 * Is a gesture or a booking due? Counts from the last one done (or planned
 * for a date already passed); before any, it's due right away.
 */
function careDue({ prefs = {}, log = [], today }) {
  const every = { small: prefs.smallEveryDays ?? C.DEFAULTS.smallEveryDays, big: prefs.bigEveryDays ?? C.DEFAULTS.bigEveryDays };
  const out = {};
  for (const size of ["small", "big"]) {
    const items = log.filter((l) => l.kind === "care" && l.size === size);
    const last = items
      .filter((l) => l.status === "done")
      .map((l) => ymd(l.date))
      .sort()
      .at(-1);
    const planned = items
      .filter((l) => l.status === "planned" && l.plannedFor && ymd(l.plannedFor) >= today)
      .sort((a, b) => ymd(a.plannedFor).localeCompare(ymd(b.plannedFor)))[0];
    const since = last ? daysBetween(last, today) : null;
    const nextOn = last ? addDays(last, every[size]) : today;
    out[size] = { every: every[size], lastDone: last || null, since, nextOn, due: !planned && nextOn <= today, planned: planned ? { id: String(planned._id || ""), title: planned.title, on: ymd(planned.plannedFor) } : null };
  }
  return out;
}

/** Last gift to a person: from their gift log or a done circle entry. */
function lastGiftFor(person, log) {
  return [...(person.gifts || []).map((g) => ymd(g.date)), ...log.filter((l) => l.kind === "circle" && l.status === "done" && String(l.personId) === String(person._id)).map((l) => ymd(l.date))].sort().at(-1) || null;
}

/**
 * The gift circle: who's next and what to give them.
 * people: gifting people. Not the spouse. Only relationships in the circle.
 * Order: no gift ever first, then the longest since a gift; closer tiers break ties.
 * skipped: people skipped in the last 14 days go to the back.
 */
function circle({ people = [], log = [], today, prefs = {}, count = 4 }) {
  const every = prefs.circleEveryDays ?? C.DEFAULTS.circleEveryDays;
  const budget = prefs.circleBudget ?? C.DEFAULTS.circleBudget;
  const allowed = new Set(prefs.circleRelationships?.length ? prefs.circleRelationships : C.CIRCLE_RELATIONSHIPS);
  const spouseId = prefs.spouseId ? String(prefs.spouseId) : null;
  const tierRank = { close: 0, thoughtful: 1, casual: 2 };
  const recentlySkipped = new Set(log.filter((l) => l.kind === "circle" && l.status === "skipped" && daysBetween(ymd(l.date), today) < 14).map((l) => String(l.personId)));

  const pool = people
    .filter((p) => String(p._id) !== spouseId && p.relationship !== "wife" && allowed.has(p.relationship) && p.inCircle !== false)
    .map((p) => {
      const last = lastGiftFor(p, log);
      return { p, last, since: last ? daysBetween(last, today) : null };
    })
    .sort(
      (a, b) =>
        Number(recentlySkipped.has(String(a.p._id))) - Number(recentlySkipped.has(String(b.p._id))) ||
        Number(a.last !== null) - Number(b.last !== null) ||
        (b.since ?? 0) - (a.since ?? 0) ||
        (tierRank[a.p.tier] ?? 1) - (tierRank[b.p.tier] ?? 1) ||
        seeded(`${today}:${a.p._id}`) - seeded(`${today}:${b.p._id}`),
    );

  const idea = (p) => {
    const rel = gifting.planHamper({ relationship: p.relationship, budget, likes: p.likes || "", services: p.servicesOk !== false });
    return {
      hamper: { key: rel.best.key, name: rel.best.name, total: rel.best.total, items: rel.best.items.map((i) => i.name) },
      service: rel.services.find((s) => s.fits) ? { key: rel.services.find((s) => s.fits).key, name: rel.services.find((s) => s.fits).name, price: rel.services.find((s) => s.fits).price } : null,
    };
  };

  const lastCircle = log
    .filter((l) => l.kind === "circle" && l.status === "done")
    .map((l) => ymd(l.date))
    .sort()
    .at(-1);
  const nextOn = lastCircle ? addDays(lastCircle, every) : today;
  const planned = log.find((l) => l.kind === "circle" && l.status === "planned" && (!l.plannedFor || ymd(l.plannedFor) >= today));
  return {
    every,
    budget,
    lastDone: lastCircle || null,
    nextOn,
    due: !planned && nextOn <= today && pool.length > 0,
    planned: planned ? { id: String(planned._id || ""), personId: String(planned.personId), title: planned.title, on: planned.plannedFor ? ymd(planned.plannedFor) : null } : null,
    next: pool.slice(0, count).map(({ p, last, since }) => ({ personId: String(p._id), name: p.name, relationship: p.relationship, last, since, ...idea(p) })),
    eligible: pool.length,
  };
}

/** Reminders for Today and phone notifications (priority 1 = shown and sent). */
function careReminders({ prefs = {}, log = [], people = [], today }) {
  const out = [];
  const her = prefs.spouseName || "your wife";
  const due = careDue({ prefs, log, today });
  for (const size of ["big", "small"]) {
    const d = due[size];
    if (d.planned && d.planned.on === today) out.push({ kind: "care", size, priority: 1, days: 0, text: `Today for ${her}: ${d.planned.title}.` });
    else if (d.planned && daysBetween(today, d.planned.on) === 1) out.push({ kind: "care", size, priority: 1, days: 0, text: `Tomorrow for ${her}: ${d.planned.title}.` }); // days 0: notify the day before too
    else if (d.due) {
      const [idea] = suggestCare({ prefs, log, today, size, count: 1 });
      if (idea) out.push({ kind: "care", size, priority: 1, days: d.since === null ? 0 : d.since - d.every, ideaKey: idea.key, text: size === "big" ? `Book something for ${her}: ${idea.title.replace(/^Book her /, "").replace(/^Book /, "")}${idea.price ? ` (about $${idea.price})` : ""}.` : `A small one for ${her} this week: ${idea.title.toLowerCase()}.` });
    }
  }
  if (prefs.circleOn !== false) {
    const c = circle({ people, log, today, prefs, count: 1 });
    if (c.due && c.next[0]) {
      const n = c.next[0];
      out.push({ kind: "circle", priority: 1, days: daysBetween(c.nextOn, today), personId: n.personId, text: `Gift circle: send ${n.name} something this month. Idea: ${n.service && n.service.price < n.hamper.total ? n.service.name.toLowerCase() : `a ${n.hamper.name.toLowerCase()} hamper`} (about $${Math.round(n.service && n.service.price < n.hamper.total ? n.service.price : n.hamper.total)}).` });
    }
  }
  return out;
}

module.exports = { suggestCare, careDue, circle, careReminders, links, lastGiftFor };
