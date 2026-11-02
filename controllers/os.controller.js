/**
 * Personal OS API: sign-in, today, goals (one active per category), block
 * logs and the weekly review. Everything is scoped to the signed-in owner.
 */
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/userModel");
const Goal = require("../models/goalModel");
const GoalLog = require("../models/goalLogModel");
const Review = require("../models/reviewModel");
const { signToken } = require("../middleware/auth");
const { CATEGORIES, SCHEDULES, MODES, FRAMEWORK, QUOTES } = require("../config/os/framework");
const plan = require("../utils/os/plan");

const fail = (res, status, message) => res.status(status).json({ success: false, error: { message } });
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => plan.localParts().date;
const str = (v, max) => String(v ?? "").trim().slice(0, max);

const MAX_TRIES = 8;
const LOCK_MS = 30 * 60 * 1000;

// ── Sign-in ─────────────────────────────────────────────────────────────

exports.login = async (req, res) => {
  const email = str(req.body?.email, 200).toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) return fail(res, 400, "Enter your email and password.");
  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user || !user.active) return fail(res, 401, "That email and password don't match.");
  if (user.lockedUntil && user.lockedUntil > new Date()) return fail(res, 429, "Too many tries. Wait 30 minutes and try again.");
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const failedLogins = (user.failedLogins || 0) + 1;
    await User.updateOne({ _id: user._id }, { $set: { failedLogins, lockedUntil: failedLogins >= MAX_TRIES ? new Date(Date.now() + LOCK_MS) : null } });
    return fail(res, 401, "That email and password don't match.");
  }
  await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  return res.json({ success: true, token: signToken(user), user: { email: user.email, name: user.name } });
};

exports.me = async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user || !user.active) return fail(res, 401, "Sign in again.");
  return res.json({ success: true, user: { email: user.email, name: user.name } });
};

exports.changePassword = async (req, res) => {
  const current = String(req.body?.current || "");
  const next = String(req.body?.next || "");
  if (next.length < 12) return fail(res, 400, "Use at least 12 characters.");
  const user = await User.findById(req.user.id).select("+passwordHash");
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) return fail(res, 400, "Your current password isn't right.");
  user.passwordHash = await bcrypt.hash(next, 12);
  await user.save();
  return res.json({ success: true });
};

// ── The framework (static) ──────────────────────────────────────────────

exports.framework = (req, res) => res.json({ success: true, categories: CATEGORIES, schedules: SCHEDULES, modes: MODES, framework: FRAMEWORK, quotes: QUOTES });

// ── Today ───────────────────────────────────────────────────────────────

const loadPlanData = async (owner) => {
  const goals = await Goal.find({ owner, status: "active" }).lean();
  const logs = await GoalLog.find({ owner, goal: { $in: goals.map((g) => g._id) } }).sort({ date: 1 }).lean();
  return { goals, logs };
};

/**
 * Today for one owner: the schedule, focus and attention list, including
 * gifting, event and meal reminders. Used by the Today page and by push
 * notifications. `raw` keeps the gift and event reminders with their ids.
 */
exports.todayFor = async (owner, at = new Date()) => {
  const { goals, logs } = await loadPlanData(owner);
  const date = plan.localParts(at).date;
  const reviewDone = await Review.exists({ owner, week: plan.weekOf(date).start });
  const t = plan.buildToday({ goals, logs, at, reviewDone: Boolean(reviewDone) });
  // Gifting reminders that are due soon join the day's decisions.
  const gifts = (await require("./gifting.controller").remindersFor(owner)).filter((r) => r.priority === 1);
  t.attention.push(...gifts.map((r) => ({ kind: "gift", text: r.text })));
  // Shows coming up and tickets going on sale.
  const shows = await require("./events.controller").remindersFor(owner);
  t.attention.push(...shows.map((r) => ({ kind: "event", text: r.text })));
  const meals = await require("./food.controller").remindersFor(owner);
  t.attention.push(...meals);
  t.reviewDone = Boolean(reviewDone);
  return { today: t, raw: { gifts, shows, meals } };
};

exports.today = async (req, res) => {
  const { today: t } = await exports.todayFor(req.user.id);
  return res.json({ success: true, ...t, modes: MODES });
};

// ── Goals ───────────────────────────────────────────────────────────────

function goalFields(body, { partial = false } = {}) {
  const out = {};
  const set = (k, v) => {
    if (v !== undefined) out[k] = v;
  };
  if (!partial || body.title !== undefined) set("title", str(body.title, 200));
  set("outcome", body.outcome === undefined ? undefined : str(body.outcome, 1000));
  set("notes", body.notes === undefined ? undefined : str(body.notes, 4000));
  set("nextStep", body.nextStep === undefined ? undefined : str(body.nextStep, 500));
  if (body.percent !== undefined) set("percent", Math.max(0, Math.min(100, Number(body.percent) || 0)));
  if (body.obstacle) {
    const kind = body.obstacle.kind === "tiered" ? "tiered" : "single";
    set("obstacle", {
      text: str(body.obstacle.text, 1000),
      kind,
      bounded: kind === "tiered" && typeof body.obstacle.bounded === "boolean" ? body.obstacle.bounded : null,
      parallel: kind === "tiered" && typeof body.obstacle.parallel === "boolean" ? body.obstacle.parallel : null,
    });
  }
  if (body.windowStart !== undefined && DATE.test(body.windowStart)) set("windowStart", body.windowStart);
  if (body.windowEnd !== undefined && DATE.test(body.windowEnd)) set("windowEnd", body.windowEnd);
  return out;
}

exports.listGoals = async (req, res) => {
  const status = str(req.query.status, 20);
  const filter = { owner: req.user.id, ...(status ? { status } : {}) };
  const goals = await Goal.find(filter).sort({ status: 1, windowStart: -1 }).lean();
  return res.json({ success: true, goals });
};

exports.createGoal = async (req, res) => {
  const category = str(req.body?.category, 4);
  if (!CATEGORIES.some((c) => c.key === category)) return fail(res, 400, "Pick a category.");
  const fields = goalFields(req.body || {});
  if (!fields.title) return fail(res, 400, "Name the goal.");
  // One active goal per category: the framework's rule.
  const existing = await Goal.findOne({ owner: req.user.id, category, status: "active" }).lean();
  if (existing) return fail(res, 409, `${category} already has an active goal: "${existing.title}". Close it first.`);
  const start = DATE.test(req.body?.windowStart || "") ? req.body.windowStart : today();
  const window = plan.windowFor(category, start);
  const goal = await Goal.create({ owner: req.user.id, category, ...fields, windowStart: window.start, windowEnd: fields.windowEnd || window.end });
  return res.status(201).json({ success: true, goal });
};

exports.updateGoal = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const goal = await Goal.findOneAndUpdate({ _id: req.params.id, owner: req.user.id }, { $set: goalFields(req.body || {}, { partial: true }) }, { new: true, runValidators: true }).lean();
  if (!goal) return fail(res, 404, "Not found");
  return res.json({ success: true, goal });
};

exports.deleteGoal = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const r = await Goal.deleteOne({ _id: req.params.id, owner: req.user.id });
  if (!r.deletedCount) return fail(res, 404, "Not found");
  await GoalLog.deleteMany({ goal: req.params.id, owner: req.user.id });
  return res.json({ success: true });
};

/**
 * End a goal's window: completed, expand (done early: keep going to the end
 * of the window), or rolled over one full window.
 */
exports.closeGoal = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const goal = await Goal.findOne({ _id: req.params.id, owner: req.user.id });
  if (!goal || goal.status !== "active") return fail(res, 404, "No active goal to close.");
  const outcome = str(req.body?.outcome, 20);
  if (outcome === "completed") {
    goal.status = "completed";
    goal.completedAt = new Date();
    if (goal.obstacle?.kind === "tiered") goal.percent = 100;
    await goal.save();
    return res.json({ success: true, goal });
  }
  if (outcome === "expand") {
    // Done early: keep the same goal active with a wider scope until the window ends.
    goal.notes = [goal.notes, `Expanded ${today()}: ${str(req.body?.note, 500) || "scope widened to fill the window"}`].filter(Boolean).join("\n");
    await goal.save();
    return res.json({ success: true, goal });
  }
  if (outcome === "rollover") {
    goal.status = "rolled";
    await goal.save();
    const start = new Date(Date.parse(`${goal.windowEnd}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const window = plan.windowFor(goal.category, start <= today() ? today() : start);
    const next = await Goal.create({
      owner: goal.owner,
      category: goal.category,
      title: goal.title,
      outcome: goal.outcome,
      obstacle: goal.obstacle,
      nextStep: goal.nextStep,
      percent: goal.percent >= 100 ? 0 : goal.percent,
      notes: goal.notes,
      windowStart: window.start,
      windowEnd: window.end,
      rolledFrom: goal._id,
    });
    return res.json({ success: true, goal: next });
  }
  return fail(res, 400, "outcome must be completed, expand or rollover");
};

// ── Logs (what happened in a block) ─────────────────────────────────────

exports.listLogs = async (req, res) => {
  const filter = { owner: req.user.id };
  if (isId(req.query.goal)) filter.goal = req.query.goal;
  if (DATE.test(req.query.since || "")) filter.date = { $gte: req.query.since };
  const logs = await GoalLog.find(filter).sort({ date: -1, createdAt: -1 }).limit(500).lean();
  return res.json({ success: true, logs });
};

/**
 * The check-in at the end of a block: "progress" (moved it forward today) or
 * "cleared" (cleared the goal for this period, so it's 100% and its next step
 * is done). Optional nextStep updates the goal's next step.
 */
exports.createLog = async (req, res) => {
  const b = req.body || {};
  if (!isId(b.goal)) return fail(res, 400, "Which goal?");
  const goal = await Goal.findOne({ _id: b.goal, owner: req.user.id });
  if (!goal) return fail(res, 404, "Goal not found");
  const outcome = ["progress", "cleared"].includes(b.outcome) ? b.outcome : null;
  if (!outcome) return fail(res, 400, "Moved it forward, or cleared it?");
  const log = await GoalLog.create({
    owner: req.user.id,
    goal: goal._id,
    date: DATE.test(b.date || "") ? b.date : today(),
    block: /^\d{2}:\d{2}$/.test(b.block || "") ? b.block : null,
    outcome,
    percentBefore: outcome === "cleared" ? goal.percent || 0 : null,
    note: str(b.note, 2000),
  });
  if (b.nextStep !== undefined) goal.nextStep = str(b.nextStep, 500);
  if (outcome === "cleared") goal.percent = 100;
  await goal.save();
  return res.status(201).json({ success: true, log, goal });
};

exports.deleteLog = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const log = await GoalLog.findOneAndDelete({ _id: req.params.id, owner: req.user.id });
  if (!log) return fail(res, 404, "Not found");
  // Undoing "cleared for the period" puts the goal's % back.
  if (log.outcome === "cleared" && log.percentBefore !== null && log.percentBefore !== undefined) await Goal.updateOne({ _id: log.goal, owner: req.user.id, status: "active" }, { $set: { percent: log.percentBefore } });
  return res.json({ success: true });
};

// ── Weekly review ───────────────────────────────────────────────────────

exports.getReview = async (req, res) => {
  const date = DATE.test(req.query.date || "") ? req.query.date : today();
  const { goals, logs } = await loadPlanData(req.user.id);
  const week = plan.weekOf(date);
  const saved = await Review.findOne({ owner: req.user.id, week: week.start }).lean();
  return res.json({ success: true, week, goals: plan.buildReview({ goals, logs, date }), saved });
};

exports.saveReview = async (req, res) => {
  const date = DATE.test(req.body?.date || "") ? req.body.date : today();
  const week = plan.weekOf(date).start;
  const entries = (Array.isArray(req.body?.entries) ? req.body.entries : [])
    .filter((e) => isId(e.goal))
    .slice(0, 12)
    .map((e) => ({ goal: e.goal, nextAction: str(e.nextAction, 1000), mode: ["m1", "m2single", "m2tiered"].includes(e.mode) ? e.mode : undefined }));
  const review = await Review.findOneAndUpdate(
    { owner: req.user.id, week },
    { $set: { entries, notes: str(req.body?.notes, 4000) } },
    { upsert: true, new: true, runValidators: true },
  ).lean();
  // The review's next actions become each goal's next step, so the next block starts itself.
  await Promise.all(entries.filter((e) => e.nextAction).map((e) => Goal.updateOne({ _id: e.goal, owner: req.user.id }, { $set: { nextStep: e.nextAction.slice(0, 500) } })));
  return res.json({ success: true, review });
};
