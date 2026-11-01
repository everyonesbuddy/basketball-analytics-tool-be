/**
 * Gifting API: people you give to (with a gift log), plans (a group or one
 * person, worked out by the planner and saved with a checklist), saved ideas
 * from product links, and reminders. Scoped to the signed-in owner.
 */
const mongoose = require("mongoose");
const Person = require("../models/giftPersonModel");
const Plan = require("../models/giftPlanModel");
const Idea = require("../models/giftIdeaModel");
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

/** Reminders for Today (used by the OS controller). */
exports.remindersFor = async (owner) => {
  const [people, plans] = await Promise.all([Person.find({ owner }).lean(), Plan.find({ owner, status: { $ne: "done" } }).lean()]);
  return gifting.reminders({ people, plans, today: plan.localParts().date });
};

exports.overview = async (req, res) => {
  const all = await loadAll(req.user.id);
  const reminders = gifting.reminders({ people: all.people, plans: all.plans, today: plan.localParts().date });
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
