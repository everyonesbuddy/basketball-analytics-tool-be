/**
 * Push notifications: register a phone, choose what to get, send a test, and
 * the runner that sends whatever is due (every 5 minutes in the server, and
 * from an outside pinger so a sleeping dyno wakes up on time). Notification
 * buttons ("Moved it forward") check in with a short-lived action token.
 */
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { PushSub, NotifySettings, PushSent } = require("../models/pushModels");
const { MealPlan, CustomMeal } = require("../models/foodModels");
const F = require("../config/os/food");
const food = require("../utils/os/food");
const notify = require("../utils/os/notify");
const push = require("../utils/os/push");
const plan = require("../utils/os/plan");

const fail = (res, status, message) => res.status(status).json({ success: false, error: { message } });
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const HHMM = /^\d{2}:\d{2}$/;
const ACTION_AUD = "personal-os-action";
const secret = () => process.env.JWT_SECRET || "";

const settingsFor = async (owner) => ({ ...notify.DEFAULTS, ...((await NotifySettings.findOne({ owner }).lean()) || {}) });

exports.key = async (req, res) => res.json({ success: true, configured: push.configured(), publicKey: push.publicKey() });

exports.subscribe = async (req, res) => {
  const s = req.body?.subscription || {};
  if (!/^https:\/\//.test(s.endpoint || "") || !s.keys?.p256dh || !s.keys?.auth) return fail(res, 400, "That isn't a push subscription.");
  const sub = await PushSub.findOneAndUpdate(
    { endpoint: s.endpoint },
    { $set: { owner: req.user.id, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, label: String(req.body?.label || "").slice(0, 120), failures: 0 } },
    { new: true, upsert: true },
  ).lean();
  return res.status(201).json({ success: true, device: { _id: sub._id, label: sub.label, createdAt: sub.createdAt } });
};

exports.devices = async (req, res) => {
  const subs = await PushSub.find({ owner: req.user.id }).sort({ createdAt: -1 }).lean();
  return res.json({ success: true, configured: push.configured(), devices: subs.map((s) => ({ _id: s._id, label: s.label, endpoint: s.endpoint, lastOk: s.lastOk, createdAt: s.createdAt })) });
};

exports.removeDevice = async (req, res) => {
  const filter = isId(req.params.id) ? { _id: req.params.id, owner: req.user.id } : { endpoint: String(req.body?.endpoint || ""), owner: req.user.id };
  await PushSub.deleteOne(filter);
  return res.json({ success: true });
};

exports.getSettings = async (req, res) => res.json({ success: true, settings: await settingsFor(req.user.id) });

exports.saveSettings = async (req, res) => {
  const b = req.body || {};
  const set = {};
  for (const k of ["brief", "blocks", "checkin", "review", "meals", "gifts", "events"]) if (b[k] !== undefined) set[k] = Boolean(b[k]);
  for (const k of ["briefTime", "quietStart", "quietEnd"]) if (HHMM.test(b[k] || "")) set[k] = b[k];
  if (b.dailyCap !== undefined) set.dailyCap = Math.max(1, Math.min(50, Math.round(Number(b.dailyCap) || 12)));
  const settings = await NotifySettings.findOneAndUpdate({ owner: req.user.id }, { $set: set }, { new: true, upsert: true, runValidators: true }).lean();
  return res.json({ success: true, settings: { ...notify.DEFAULTS, ...settings } });
};

/** Send to every device of an owner; drop devices the push service says are gone. */
async function sendToOwner(owner, payload) {
  const subs = await PushSub.find({ owner }).lean();
  let ok = 0;
  for (const s of subs) {
    const r = await push.send(s, payload);
    if (r === "ok") {
      ok += 1;
      await PushSub.updateOne({ _id: s._id }, { $set: { lastOk: new Date(), failures: 0 } });
    } else if (r === "gone") await PushSub.deleteOne({ _id: s._id });
    else await PushSub.updateOne({ _id: s._id }, { $inc: { failures: 1 } });
  }
  return { devices: subs.length, ok };
}

exports.test = async (req, res) => {
  if (!push.configured()) return fail(res, 503, "Push isn't set up on the server yet (VAPID keys missing).");
  const r = await sendToOwner(req.user.id, { title: "Personal OS", body: "Notifications are on. You'll get a few useful nudges a day.", url: "/settings", tag: "test" });
  if (!r.devices) return fail(res, 400, "Turn on notifications on this device first.");
  return res.json({ success: true, ...r });
};

/** Tonight's dinner from the week's meal plan, if there is one. */
async function tonightsDinner(owner, date) {
  const p = await MealPlan.findOne({ owner, weekStart: food.weekStartOf(date) }).lean();
  const d = p?.days?.find((x) => x.date === date);
  if (!d) return null;
  const custom = d.key.startsWith("c_") ? await CustomMeal.find({ owner }).lean() : [];
  const meal = [...F.MEALS, ...custom.map(food.fromCustom)].find((m) => m.key === d.key);
  return meal ? { name: meal.name, mode: d.mode } : null;
}

/** Work out and send what's due for one owner now. */
async function runFor(owner, now = new Date()) {
  const { today, raw } = await require("./os.controller").todayFor(owner, now);
  const { minutes, date } = plan.localParts(now);
  const [settings, dinner, sentToday] = await Promise.all([settingsFor(owner), tonightsDinner(owner, date), PushSent.countDocuments({ owner, date })]);
  const due = notify.dueNotifications({ today, minutes, raw, dinner, settings, sentToday, now });
  let sent = 0;
  for (const n of due) {
    // Claim the key first, so two runners never send the same one twice.
    try {
      await PushSent.create({ owner, key: n.key, date });
    } catch {
      continue;
    }
    const payload = { title: n.title, body: n.body, url: n.url, tag: n.tag || n.key, actions: n.actions || [] };
    if (n.checkin && secret()) payload.actionToken = jwt.sign({ sub: String(owner), g: n.checkin.goalId, b: n.checkin.block, d: n.checkin.date }, secret(), { audience: ACTION_AUD, expiresIn: "18h" });
    const r = await sendToOwner(owner, payload);
    if (r.ok) sent += 1;
  }
  return { due: due.length, sent };
}

let running = false;
/** Run for everyone with a registered device. Safe to call often. */
async function runAll(now = new Date()) {
  if (!push.configured() || running) return { skipped: true };
  running = true;
  try {
    const owners = await PushSub.distinct("owner");
    const results = [];
    for (const o of owners) results.push(await runFor(o, now).catch((err) => ({ error: err.message })));
    return { owners: owners.length, results };
  } finally {
    running = false;
  }
}
exports.runAll = runAll;
exports.runFor = runFor;

/**
 * For an outside pinger (e.g. cron-job.org every 5 minutes): wakes the dyno
 * and sends what's due. Needs PUSH_CRON_SECRET, as the x-cron-secret header
 * or ?key=.
 */
exports.run = async (req, res) => {
  const expected = process.env.PUSH_CRON_SECRET || "";
  const given = String(req.headers["x-cron-secret"] || req.query.key || "");
  if (!expected || given !== expected) return fail(res, 401, "Not allowed.");
  return res.json({ success: true, ...(await runAll()) });
};

/** A tap on a notification button: check in with the action token. */
exports.action = async (req, res) => {
  const { token, action } = req.body || {};
  if (!["progress", "cleared"].includes(action)) return fail(res, 400, "Which action?");
  let p;
  try {
    p = jwt.verify(String(token || ""), secret(), { audience: ACTION_AUD });
  } catch {
    return fail(res, 401, "That notification has expired. Check in from the app.");
  }
  const out = {};
  const fakeRes = { status: (s) => ((out.status = s), fakeRes), json: (b) => ((out.body = b), fakeRes) };
  await require("./os.controller").createLog({ user: { id: p.sub }, body: { goal: p.g, block: p.b, date: p.d, outcome: action } }, fakeRes);
  if (out.body?.success) await PushSent.create({ owner: p.sub, key: `checkin-done:${p.d}:${p.b}`, date: p.d }).catch(() => {});
  return res.status(out.status || 200).json(out.body || { success: true });
};
