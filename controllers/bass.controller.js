/**
 * Bass trainer progress: best result per lesson, practice minutes and the
 * streak. The lessons themselves live in the app.
 */
const Bass = require("../models/bassProgressModel");
const bass = require("../utils/os/bass");
const plan = require("../utils/os/plan");

const fail = (res, status, message) => res.status(status).json({ success: false, error: { message } });

async function view(owner) {
  const doc = (await Bass.findOne({ owner }).lean()) || { lessons: [], days: [], sensitivity: 1 };
  const today = plan.localParts().date;
  return {
    success: true,
    lessons: Object.fromEntries((doc.lessons || []).map((l) => [l.key, l])),
    streak: bass.streak(doc.days, today),
    weekMinutes: bass.weekMinutes(doc.days, today),
    todayMinutes: Math.round((doc.days || []).find((d) => d.date === today)?.minutes || 0),
    days: (doc.days || []).slice(-28),
    sensitivity: doc.sensitivity ?? 1,
  };
}

/** GET /bass */
exports.overview = async (req, res) => res.json(await view(req.user.id));

/** POST /bass/attempt { lessonKey, mode: "time"|"step", score, stars, bpm, minutes } */
exports.attempt = async (req, res) => {
  const b = req.body || {};
  const key = String(b.lessonKey || "").trim().slice(0, 60);
  if (!/^[a-z0-9-]+$/.test(key)) return fail(res, 400, "Which lesson?");
  const mode = b.mode === "step" ? "step" : "time";
  const score = Math.max(0, Math.min(100, Number(b.score) || 0));
  const stars = Math.max(0, Math.min(3, Math.round(Number(b.stars) || 0)));
  const bpm = Math.max(0, Math.min(300, Number(b.bpm) || 0));
  const minutes = Math.max(0, Math.min(180, Number(b.minutes) || 0));
  const doc = (await Bass.findOne({ owner: req.user.id })) || new Bass({ owner: req.user.id });
  const prev = doc.lessons.find((l) => l.key === key);
  const next = bass.recordAttempt(prev ? prev.toObject() : { key }, { score, stars, mode, bpm });
  next.key = key;
  if (prev) prev.set(next);
  else doc.lessons.push(next);
  if (minutes > 0) doc.days = bass.addMinutes(doc.days, plan.localParts().date, minutes);
  await doc.save();
  return res.json(await view(req.user.id));
};

/** POST /bass/practice { minutes }: time spent (tuner, exploring) without a scored take. */
exports.practice = async (req, res) => {
  const minutes = Math.max(0, Math.min(180, Number(req.body?.minutes) || 0));
  if (minutes > 0) {
    const doc = (await Bass.findOne({ owner: req.user.id })) || new Bass({ owner: req.user.id });
    doc.days = bass.addMinutes(doc.days, plan.localParts().date, minutes);
    await doc.save();
  }
  return res.json(await view(req.user.id));
};

/** PATCH /bass { sensitivity }: how loud a note has to be for the mic to hear it. */
exports.settings = async (req, res) => {
  const s = Number(req.body?.sensitivity);
  if (!Number.isFinite(s)) return fail(res, 400, "Sensitivity?");
  await Bass.updateOne({ owner: req.user.id }, { $set: { sensitivity: Math.max(0.25, Math.min(4, s)) }, $setOnInsert: { owner: req.user.id } }, { upsert: true });
  return res.json(await view(req.user.id));
};
