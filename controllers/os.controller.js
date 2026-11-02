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

exports.today = async (req, res) => {
  const { goals, logs } = await loadPlanData(req.user.id);
  const date = today();
  const reviewDone = await Review.exists({ owner: req.user.id, week: plan.weekOf(date).start });
  const t = plan.buildToday({ goals, logs, reviewDone: Boolean(reviewDone) });
  // Gifting reminders that are due soon join the day's decisions.
  const gifts = (await require("./gifting.controller").remindersFor(req.user.id)).filter((r) => r.priority === 1);
  t.attention.push(...gifts.map((r) => ({ kind: "gift", text: r.text })));
  // Shows coming up and tickets going on sale.
  const shows = await require("./events.controller").remindersFor(req.user.id);
  t.attention.push(...shows.map((r) => ({ kind: "event", text: r.text })));
  const meals = await require("./food.controller").remindersFor(req.user.id);
  t.attention.push(...meals);
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
  set("toolReady", body.toolReady === undefined ? undefined : Boolean(body.toolReady));
  set("toolNeeded", body.toolNeeded === undefined ? undefined : str(body.toolNeeded, 500));
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
 * End a goal's window: completed (optionally expand: keep going with a new
 * end date), or rolled over one full window, starting in Mode 1 if its tool
 * hit a ceiling.
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
    const logs = await GoalLog.find({ goal: goal._id }).lean();
    const ceiling = goal.obstacle?.kind === "tiered" && plan.ceilingCheck(logs).hit;
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
      toolReady: ceiling ? false : goal.toolReady,
      toolNeeded: ceiling ? str(req.body?.toolNeeded, 500) || "a new tool to get past the ceiling" : goal.toolNeeded,
      percent: goal.percent,
      notes: goal.notes,
      windowStart: window.start,
      windowEnd: window.end,
      rolledFrom: goal._id,
    });
    return res.json({ success: true, goal: next, startsIn: ceiling ? "m1" : null });
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

exports.createLog = async (req, res) => {
  const b = req.body || {};
  if (!isId(b.goal)) return fail(res, 400, "Which goal?");
  const goal = await Goal.findOne({ _id: b.goal, owner: req.user.id });
  if (!goal) return fail(res, 404, "Goal not found");
  // One tap at the end of a block: moved it forward, cleared it, or stuck.
  // The framework's mode follows from it (stuck = something's missing = Mode 1).
  const outcome = ["progress", "cleared", "blocked"].includes(b.outcome) ? b.outcome : null;
  let mode = ["m1", "m2single", "m2tiered"].includes(b.mode) ? b.mode : null;
  // Moved it forward with a % earned (or on a goal you chip away at) is Mode 2-Tiered.
  if (!mode && outcome) mode = outcome === "blocked" ? "m1" : outcome === "cleared" ? "m2single" : Number(b.percentGained) > 0 || goal.obstacle?.kind === "tiered" ? "m2tiered" : "m2single";
  if (!mode) return fail(res, 400, "How did it go?");
  const percentGained = mode === "m2tiered" ? Math.max(0, Math.min(100, Number(b.percentGained) || 0)) : 0;
  const log = await GoalLog.create({
    owner: req.user.id,
    goal: goal._id,
    date: DATE.test(b.date || "") ? b.date : today(),
    block: /^\d{2}:\d{2}$/.test(b.block || "") ? b.block : null,
    outcome,
    mode,
    percentGained,
    cleared: (mode === "m2single" && Boolean(b.cleared)) || outcome === "cleared",
    toolAcquired: mode === "m1" && Boolean(b.toolAcquired),
    missing: mode === "m1" ? str(b.missing, 500) : "",
    note: str(b.note, 2000),
  });
  if (b.nextStep !== undefined) goal.nextStep = str(b.nextStep, 500);
  // Cleared the goal entirely for this window: it's done (the window-end choice comes next).
  if (outcome === "cleared") goal.percent = 100;
  // Keep the goal's state in step with what was logged: the mode is decided
  // block by block, and the goal remembers the latest answers.
  if (percentGained) goal.percent = Math.min(100, Math.round(((goal.percent || 0) + percentGained) * 10) / 10);
  if (mode === "m1") {
    goal.toolReady = log.toolAcquired;
    goal.toolNeeded = log.toolAcquired ? "" : log.missing || goal.toolNeeded;
  } else {
    goal.toolReady = true;
    goal.toolNeeded = "";
    goal.obstacle = { ...(goal.obstacle?.toObject?.() || goal.obstacle || {}), kind: mode === "m2tiered" ? "tiered" : "single" };
  }
  await goal.save();
  return res.status(201).json({ success: true, log, goal });
};

exports.deleteLog = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const log = await GoalLog.findOneAndDelete({ _id: req.params.id, owner: req.user.id });
  if (!log) return fail(res, 404, "Not found");
  if (log.percentGained) await Goal.updateOne({ _id: log.goal, owner: req.user.id }, [{ $set: { percent: { $max: [0, { $subtract: ["$percent", log.percentGained] }] } } }]);
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
