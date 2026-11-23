/**
 * Gifting API: people you give to (with a gift log), plans (a group or one
 * person, worked out by the planner and saved with a checklist), saved ideas
 * from product links, and reminders. Scoped to the signed-in owner.
 */
const mongoose = require("mongoose");
const Person = require("../models/giftPersonModel");
const Plan = require("../models/giftPlanModel");
const Idea = require("../models/giftIdeaModel");
const Care = require("../models/giftCareModel");
const CC = require("../config/os/care");
const care = require("../utils/os/care");
const G = require("../config/os/gifting");
const gifting = require("../utils/os/gifting");
const { fetchPreview } = require("../utils/os/linkPreview");
const plan = require("../utils/os/plan");

const fail = (res, status, message) => res.status(status).json({ success: false, error: { message } });
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const str = (v, max) => String(v ?? "").trim().slice(0, max);
const MD = /^\d{2}-\d{2}$/;
const num = (v, min = 0, max = 1e6) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
};
const dateOrNull = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

// ── Overview ────────────────────────────────────────────────────────────

const loadAll = async (owner) => {
  const [people, plans, ideas] = await Promise.all([
    Person.find({ owner }).sort({ name: 1 }).lean(),
    Plan.find({ owner }).sort({ status: 1, date: 1, createdAt: -1 }).lean(),
    Idea.find({ owner }).sort({ createdAt: -1 }).limit(200).lean(),
  ]);
  return { people, plans, ideas };
};

/** Care settings and log, with the spouse's name filled in from her person record. */
async function careFor(owner, people) {
  const c = (await Care.findOne({ owner }).lean()) || { log: [] };
  const spouse = (c.spouseId && people.find((p) => String(p._id) === String(c.spouseId))) || people.find((p) => p.relationship === "wife") || null;
  const prefs = { ...c, spouseId: spouse ? String(spouse._id) : null, spouseName: c.spouseName || spouse?.name || "" };
  return { prefs, log: c.log || [], spouse };
}

/** Reminders for Today (used by the OS controller): dates and plans, plus care and the gift circle. */
exports.remindersFor = async (owner) => {
  const [people, plans] = await Promise.all([Person.find({ owner }).lean(), Plan.find({ owner, status: { $ne: "done" } }).lean()]);
  const today = plan.localParts().date;
  const { prefs, log } = await careFor(owner, people);
  return [...care.careReminders({ prefs, log, people, today }), ...gifting.reminders({ people, plans, today })];
};

exports.overview = async (req, res) => {
  const all = await loadAll(req.user.id);
  const today = plan.localParts().date;
  const { prefs, log } = await careFor(req.user.id, all.people);
  const reminders = [...care.careReminders({ prefs, log, people: all.people, today }), ...gifting.reminders({ people: all.people, plans: all.plans, today })];
  return res.json({
    success: true,
    ...all,
    reminders,
    config: { relationships: G.RELATIONSHIPS, groups: G.GROUPS, packaging: G.PACKAGING, packages: G.PACKAGES, hampers: Object.fromEntries(Object.entries(G.HAMPERS).map(([k, h]) => [k, { name: h.name }])) },
  });
};

// ── People ──────────────────────────────────────────────────────────────

function personFields(b) {
  const out = {};
  if (b.name !== undefined) out.name = str(b.name, 120);
  if (b.relationship !== undefined) out.relationship = str(b.relationship, 40) || "friend";
  if (["child", "young", "adult", "elder"].includes(b.group)) out.group = b.group;
  if (b.gender !== undefined) out.gender = ["man", "woman"].includes(b.gender) ? b.gender : null;
  if (["close", "thoughtful", "casual"].includes(b.tier)) out.tier = b.tier;
  if (b.birthday !== undefined) out.birthday = MD.test(b.birthday || "") ? b.birthday : null;
  if (Array.isArray(b.dates)) out.dates = b.dates.filter((d) => MD.test(d?.md || "")).slice(0, 10).map((d) => ({ label: str(d.label, 60) || "date", md: d.md }));
  if (b.sizes) out.sizes = { shirt: str(b.sizes.shirt, 20), shoe: str(b.sizes.shoe, 20) };
  if (b.likes !== undefined) out.likes = str(b.likes, 500);
  if (b.servicesOk !== undefined) out.servicesOk = Boolean(b.servicesOk);
  if (b.inCircle !== undefined) out.inCircle = Boolean(b.inCircle);
  if (b.notes !== undefined) out.notes = str(b.notes, 2000);
  return out;
}

exports.createPerson = async (req, res) => {
  const fields = personFields(req.body || {});
  if (!fields.name) return fail(res, 400, "Add a name.");
  const person = await Person.create({ owner: req.user.id, ...fields });
  return res.status(201).json({ success: true, person });
};

exports.updatePerson = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const person = await Person.findOneAndUpdate({ _id: req.params.id, owner: req.user.id }, { $set: personFields(req.body || {}) }, { new: true, runValidators: true }).lean();
  if (!person) return fail(res, 404, "Not found");
  return res.json({ success: true, person });
};

exports.deletePerson = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const r = await Person.deleteOne({ _id: req.params.id, owner: req.user.id });
  if (!r.deletedCount) return fail(res, 404, "Not found");
  return res.json({ success: true });
};

/** Log a gift you gave someone (this resets their "haven't gifted in a while" reminder). */
exports.logGift = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const gift = { date: dateOrNull(req.body?.date) || new Date(), what: str(req.body?.what, 300), cost: num(req.body?.cost, 0, 100000), plan: isId(req.body?.plan) ? req.body.plan : null };
  const person = await Person.findOneAndUpdate({ _id: req.params.id, owner: req.user.id }, { $push: { gifts: { $each: [gift], $slice: -100 } } }, { new: true }).lean();
  if (!person) return fail(res, 404, "Not found");
  return res.json({ success: true, person });
};

/** Remove one logged gift. */
exports.deleteGift = async (req, res) => {
  if (!isId(req.params.id) || !isId(req.params.giftId)) return fail(res, 404, "Not found");
  const person = await Person.findOneAndUpdate({ _id: req.params.id, owner: req.user.id }, { $pull: { gifts: { _id: req.params.giftId } } }, { new: true }).lean();
  if (!person) return fail(res, 404, "Not found");
  return res.json({ success: true, person });
};

// ── Plans ───────────────────────────────────────────────────────────────

function cleanInputs(kind, b = {}) {
  if (kind === "group") {
    const counts = Object.fromEntries(G.GROUPS.map((g) => [g.key, Math.floor(num(b.counts?.[g.key], 0, 500) || 0)]));
    return { budget: num(b.budget, 0, 100000) || 0, counts, special: Math.floor(num(b.special, 0, 200) || 0), womenShare: num(b.womenShare, 0, 1) ?? 0.5, suitcases: Math.floor(num(b.suitcases, 1, 10) || 1) };
  }
  return {
    budget: num(b.budget, 0, 100000) || 0,
    relationship: G.RELATIONSHIPS.some((r) => r.key === b.relationship) ? b.relationship : "friend",
    likes: str(b.likes, 300),
    services: b.services !== false,
    where: ["us", "ng"].includes(b.where) ? b.where : "any",
  };
}

const compute = (kind, inputs) => (kind === "group" ? gifting.planGroup(inputs) : gifting.planHamper(inputs));

const checklistFor = (kind, result) =>
  kind === "group"
    ? gifting.checklistFrom(result)
    : [result.best.container, ...result.best.items, result.best.card].map((i, n) => ({ key: `h${n}`, name: i.name, store: "", packs: 1, bought: false, packed: false }));

/** Work out a plan without saving it (the form's live preview). */
exports.previewPlan = async (req, res) => {
  const kind = req.body?.kind === "one" ? "one" : "group";
  const inputs = cleanInputs(kind, req.body?.inputs || req.body);
  return res.json({ success: true, kind, inputs, result: compute(kind, inputs) });
};

exports.createPlan = async (req, res) => {
  const b = req.body || {};
  const kind = b.kind === "one" ? "one" : "group";
  const title = str(b.title, 160);
  if (!title) return fail(res, 400, "Name the plan.");
  const inputs = cleanInputs(kind, b.inputs);
  const result = compute(kind, inputs);
  const doc = await Plan.create({
    owner: req.user.id,
    title,
    kind,
    date: dateOrNull(b.date),
    inputs,
    result,
    person: kind === "one" && isId(b.person) ? b.person : null,
    checklist: checklistFor(kind, result),
    notes: str(b.notes, 4000),
  });
  return res.status(201).json({ success: true, plan: doc });
};

exports.updatePlan = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const doc = await Plan.findOne({ _id: req.params.id, owner: req.user.id });
  if (!doc) return fail(res, 404, "Not found");
  const b = req.body || {};
  if (b.title !== undefined) doc.title = str(b.title, 160) || doc.title;
  if (b.date !== undefined) doc.date = dateOrNull(b.date);
  if (["planning", "shopping", "done"].includes(b.status)) doc.status = b.status;
  if (b.notes !== undefined) doc.notes = str(b.notes, 4000);
  if (b.inputs) {
    // New numbers: work it out again and start a fresh checklist.
    doc.inputs = cleanInputs(doc.kind, b.inputs);
    doc.result = compute(doc.kind, doc.inputs);
    doc.checklist = checklistFor(doc.kind, doc.result);
    doc.markModified("result");
    doc.markModified("inputs");
  }
  if (Array.isArray(b.checklist)) {
    // Tick boxes: { key, bought?, packed? }
    for (const c of b.checklist) {
      const row = doc.checklist.find((r) => r.key === c.key);
      if (!row) continue;
      if (typeof c.bought === "boolean") row.bought = c.bought;
      if (typeof c.packed === "boolean") row.packed = c.packed;
    }
  }
  await doc.save();
  return res.json({ success: true, plan: doc });
};

exports.deletePlan = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const r = await Plan.deleteOne({ _id: req.params.id, owner: req.user.id });
  if (!r.deletedCount) return fail(res, 404, "Not found");
  await Idea.updateMany({ owner: req.user.id, plan: req.params.id }, { $set: { plan: null } });
  return res.json({ success: true });
};

// ── Ideas (product links) ───────────────────────────────────────────────

exports.linkPreview = async (req, res) => {
  const url = str(req.body?.url, 2000);
  if (!url) return fail(res, 400, "Paste a link.");
  try {
    return res.json({ success: true, preview: await fetchPreview(url) });
  } catch (err) {
    return fail(res, err.statusCode || 422, err.statusCode ? err.message : "Couldn't open that page. You can still save it and add the details yourself.");
  }
};

exports.createIdea = async (req, res) => {
  const b = req.body || {};
  const url = str(b.url, 2000);
  let preview = {};
  if (url && !b.title) {
    try {
      preview = await fetchPreview(url);
    } catch {
      preview = {};
    }
  }
  const idea = await Idea.create({
    owner: req.user.id,
    url,
    title: str(b.title, 300) || preview.title || url || "Gift idea",
    image: /^https?:\/\//.test(b.image || "") ? str(b.image, 2000) : preview.image || "",
    price: num(b.price, 0, 100000) ?? preview.price ?? null,
    site: str(b.site, 120) || preview.site || "",
    person: isId(b.person) ? b.person : null,
    plan: isId(b.plan) ? b.plan : null,
    notes: str(b.notes, 1000),
  });
  return res.status(201).json({ success: true, idea, blocked: Boolean(preview.blocked) });
};

exports.updateIdea = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const b = req.body || {};
  const set = {};
  if (b.title !== undefined) set.title = str(b.title, 300);
  if (b.price !== undefined) set.price = num(b.price, 0, 100000);
  if (b.notes !== undefined) set.notes = str(b.notes, 1000);
  if (b.person !== undefined) set.person = isId(b.person) ? b.person : null;
  if (b.plan !== undefined) set.plan = isId(b.plan) ? b.plan : null;
  const idea = await Idea.findOneAndUpdate({ _id: req.params.id, owner: req.user.id }, { $set: set }, { new: true }).lean();
  if (!idea) return fail(res, 404, "Not found");
  return res.json({ success: true, idea });
};

exports.deleteIdea = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const r = await Idea.deleteOne({ _id: req.params.id, owner: req.user.id });
  if (!r.deletedCount) return fail(res, 404, "Not found");
  return res.json({ success: true });
};

// ── Care for your wife, and the gift circle ──────────────────────────────

async function careView(owner) {
  const people = await Person.find({ owner }).sort({ name: 1 }).lean();
  const today = plan.localParts().date;
  const { prefs, log, spouse } = await careFor(owner, people);
  return {
    success: true,
    today,
    prefs: {
      spouseId: prefs.spouseId,
      spouseName: prefs.spouseName,
      likesKinds: prefs.likesKinds || [],
      dislikes: prefs.dislikes || [],
      wishlist: prefs.wishlist || "",
      budgetSmall: prefs.budgetSmall ?? 40,
      budgetBig: prefs.budgetBig ?? 150,
      smallEveryDays: prefs.smallEveryDays ?? CC.DEFAULTS.smallEveryDays,
      bigEveryDays: prefs.bigEveryDays ?? CC.DEFAULTS.bigEveryDays,
      circleOn: prefs.circleOn !== false,
      circleEveryDays: prefs.circleEveryDays ?? CC.DEFAULTS.circleEveryDays,
      circleBudget: prefs.circleBudget ?? CC.DEFAULTS.circleBudget,
      circleRelationships: prefs.circleRelationships?.length ? prefs.circleRelationships : CC.CIRCLE_RELATIONSHIPS,
    },
    spouse: spouse ? { _id: String(spouse._id), name: spouse.name } : null,
    kinds: CC.KINDS,
    ideas: CC.CARE_IDEAS.map((i) => ({ ...i, links: care.links(i) })),
    suggestions: { big: care.suggestCare({ prefs, log, today, size: "big", count: 3 }), small: care.suggestCare({ prefs, log, today, size: "small", count: 3 }) },
    due: care.careDue({ prefs, log, today }),
    circle: care.circle({ people, log, today, prefs, count: 4 }),
    log: [...log].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 60),
    people: people.map((p) => ({ _id: String(p._id), name: p.name, relationship: p.relationship, inCircle: p.inCircle !== false, last: care.lastGiftFor(p, log) })),
    relationships: G.RELATIONSHIPS,
  };
}

/** GET /gifting/care: suggestions for her, what's due, the gift circle, and the log. */
exports.careOverview = async (req, res) => res.json(await careView(req.user.id));

/** PATCH /gifting/care: her likes, dislikes, wishlist, budgets, how often, and the circle settings. */
exports.updateCare = async (req, res) => {
  const b = req.body || {};
  const set = {};
  if (b.spouseId !== undefined) set.spouseId = isId(b.spouseId) ? b.spouseId : null;
  if (b.spouseName !== undefined) set.spouseName = str(b.spouseName, 60);
  if (Array.isArray(b.likesKinds)) set.likesKinds = b.likesKinds.filter((k) => CC.KINDS[k]);
  if (Array.isArray(b.dislikes)) set.dislikes = b.dislikes.filter((k) => CC.CARE_IDEAS.some((i) => i.key === k)).slice(0, 100);
  if (b.wishlist !== undefined) set.wishlist = str(b.wishlist, 2000);
  const n = (k, lo, hi) => {
    if (b[k] === undefined) return;
    const v = num(b[k], lo, hi);
    if (v !== null) set[k] = Math.round(v);
  };
  n("budgetSmall", 0, 1000);
  n("budgetBig", 0, 5000);
  n("smallEveryDays", 3, 60);
  n("bigEveryDays", 7, 120);
  n("circleEveryDays", 14, 180);
  n("circleBudget", 10, 2000);
  if (b.circleOn !== undefined) set.circleOn = Boolean(b.circleOn);
  if (Array.isArray(b.circleRelationships)) set.circleRelationships = b.circleRelationships.filter((r) => G.RELATIONSHIPS.some((x) => x.key === r) && r !== "wife");
  await Care.updateOne({ owner: req.user.id }, { $set: set, $setOnInsert: { owner: req.user.id } }, { upsert: true });
  return res.json(await careView(req.user.id));
};

/** Also log it on the person's gift history, so "haven't gifted in a while" stays right. */
async function logOnPerson(owner, personId, what, cost, date) {
  if (!personId) return;
  await Person.updateOne({ _id: personId, owner }, { $push: { gifts: { $each: [{ date, what: str(what, 300), cost }], $slice: -100 } } });
}

/**
 * POST /gifting/care/log { kind: "care"|"circle", ideaKey?, relationship?, who?, title?, status, plannedFor?, cost?, note? }
 * Circle gifts are by kind of person (relationship); "who" is an optional name.
 * Done care for her (with her on your people) also goes on her gift log.
 */
exports.addCareLog = async (req, res) => {
  const b = req.body || {};
  const kind = b.kind === "circle" ? "circle" : "care";
  const status = ["planned", "done", "skipped"].includes(b.status) ? b.status : null;
  if (!status) return fail(res, 400, "Planned, done or skipped?");
  const idea = kind === "care" ? CC.CARE_IDEAS.find((i) => i.key === b.ideaKey) : null;
  const title = str(b.title, 200) || idea?.title || "";
  if (kind === "care" && !idea && !title) return fail(res, 400, "What did you do for her?");
  const relationship = kind === "circle" ? b.relationship : null;
  if (kind === "circle" && (!G.RELATIONSHIPS.some((r) => r.key === relationship) || relationship === "wife")) return fail(res, 400, "Who is it for: a friend, an uncle…?");
  const people = await Person.find({ owner: req.user.id }).lean();
  const entry = {
    kind,
    ideaKey: idea?.key || null,
    size: kind === "care" ? (idea?.size || (b.size === "small" ? "small" : "big")) : null,
    personId: null,
    relationship,
    who: kind === "circle" ? str(b.who, 80) : "",
    title,
    status,
    date: dateOrNull(b.date) || new Date(),
    plannedFor: status === "planned" ? dateOrNull(b.plannedFor) : null,
    cost: num(b.cost, 0, 100000),
    note: str(b.note, 500),
  };
  await Care.updateOne({ owner: req.user.id }, { $push: { log: { $each: [entry], $slice: -500 } }, $setOnInsert: { owner: req.user.id } }, { upsert: true });
  if (status === "done" && kind === "care") {
    const { spouse } = await careFor(req.user.id, people);
    await logOnPerson(req.user.id, spouse?._id, title, entry.cost, entry.date);
  }
  return res.status(201).json(await careView(req.user.id));
};

/** PATCH /gifting/care/log/:id { status, plannedFor, cost, note }: e.g. a planned one is now done. */
exports.updateCareLog = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const doc = await Care.findOne({ owner: req.user.id });
  const entry = doc?.log.id(req.params.id);
  if (!entry) return fail(res, 404, "Not found");
  const b = req.body || {};
  const wasDone = entry.status === "done";
  if (["planned", "done", "skipped"].includes(b.status)) {
    entry.status = b.status;
    if (b.status === "done") entry.date = new Date();
  }
  if (b.plannedFor !== undefined) entry.plannedFor = dateOrNull(b.plannedFor);
  if (b.cost !== undefined) entry.cost = num(b.cost, 0, 100000);
  if (b.note !== undefined) entry.note = str(b.note, 500);
  if (b.who !== undefined && entry.kind === "circle") entry.who = str(b.who, 80);
  await doc.save();
  if (!wasDone && entry.status === "done") {
    const people = await Person.find({ owner: req.user.id }).lean();
    const { spouse } = await careFor(req.user.id, people);
    await logOnPerson(req.user.id, entry.kind === "circle" ? entry.personId : spouse?._id, entry.title, entry.cost, entry.date); // circle: only older entries tied to a person
  }
  return res.json(await careView(req.user.id));
};

/** DELETE /gifting/care/log/:id */
exports.deleteCareLog = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  await Care.updateOne({ owner: req.user.id }, { $pull: { log: { _id: req.params.id } } });
  return res.json(await careView(req.user.id));
};

exports._care = { careView };
