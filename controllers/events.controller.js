/**
 * Events & concerts: artists and teams you follow, their upcoming shows
 * (near you first), what's on near you, and events you've saved, with
 * reminders on Today. Data from Ticketmaster's free Discovery API.
 */
const mongoose = require("mongoose");
const { Settings, Follow, Saved } = require("../models/eventModels");
const tm = require("../utils/os/ticketmaster");
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
const SEGMENTS = ["Music", "Sports", "Arts & Theatre", "Comedy", "Family"];

/** Run a Ticketmaster call; turn its errors into a plain message. */
const tmCall = async (res, fn) => {
  try {
    return await fn();
  } catch (err) {
    fail(res, err.statusCode || 502, err.statusCode ? err.message : "Couldn't reach Ticketmaster.");
    return undefined;
  }
};

const settingsFor = async (owner) => (await Settings.findOne({ owner }).lean()) || { city: "", lat: null, lon: null, radius: 50 };

/** Reminders for Today (used by the OS controller). */
exports.remindersFor = async (owner) => {
  const saved = await Saved.find({ owner, status: { $in: ["interested", "going", "bought"] } }).lean();
  return tm.eventReminders({ saved });
};

exports.overview = async (req, res) => {
  const owner = req.user.id;
  const today = plan.localParts().date;
  const [settings, follows, saved] = await Promise.all([settingsFor(owner), Follow.find({ owner }).sort({ name: 1 }).lean(), Saved.find({ owner }).sort({ date: 1 }).lean()]);
  return res.json({
    success: true,
    configured: tm.configured(),
    today,
    settings,
    follows,
    saved: saved.filter((s) => !s.date || s.date >= today),
    past: saved.filter((s) => s.date && s.date < today).reverse().slice(0, 20),
    reminders: tm.eventReminders({ saved }),
    segments: SEGMENTS,
  });
};

exports.saveSettings = async (req, res) => {
  const b = req.body || {};
  const set = {};
  if (b.city !== undefined) set.city = str(b.city, 120);
  if (b.lat !== undefined) set.lat = num(b.lat, -90, 90);
  if (b.lon !== undefined) set.lon = num(b.lon, -180, 180);
  if (b.radius !== undefined) set.radius = num(b.radius, 5, 500) ?? 50;
  const settings = await Settings.findOneAndUpdate({ owner: req.user.id }, { $set: set }, { new: true, upsert: true, runValidators: true }).lean();
  return res.json({ success: true, settings });
};

// ── Follows ─────────────────────────────────────────────────────────────

exports.searchAttractions = async (req, res) => {
  const q = str(req.query.q, 100);
  if (q.length < 2) return res.json({ success: true, results: [] });
  const results = await tmCall(res, () => tm.searchAttractions(q));
  if (results) return res.json({ success: true, results });
  return undefined;
};

exports.follow = async (req, res) => {
  const b = req.body || {};
  const tmId = str(b.tmId, 60);
  const name = str(b.name, 200);
  if (!tmId || !name) return fail(res, 400, "Pick an artist or team from the search.");
  const follow = await Follow.findOneAndUpdate(
    { owner: req.user.id, tmId },
    { $set: { name, image: url(b.image), segment: str(b.segment, 60), genre: str(b.genre, 60) } },
    { new: true, upsert: true, runValidators: true },
  ).lean();
  return res.status(201).json({ success: true, follow });
};

exports.unfollow = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const r = await Follow.deleteOne({ _id: req.params.id, owner: req.user.id });
  if (!r.deletedCount) return fail(res, 404, "Not found");
  return res.json({ success: true });
};

/** Every followed artist or team's upcoming shows, each marked near you or not. */
exports.following = async (req, res) => {
  const owner = req.user.id;
  const [settings, follows] = await Promise.all([settingsFor(owner), Follow.find({ owner }).sort({ name: 1 }).limit(25).lean()]);
  const from = settings.lat !== null && settings.lon !== null ? { lat: settings.lat, lon: settings.lon } : null;
  const out = await tmCall(res, async () => {
    const groups = [];
    for (const f of follows) {
      const events = await tm.eventsFor(f.tmId, from);
      const near = events.filter((e) => e.distance !== null && e.distance <= settings.radius);
      groups.push({ follow: f, near, elsewhere: events.filter((e) => !near.includes(e)).slice(0, 8), total: events.length });
    }
    // Followed artists with a show near you first, then by their next date.
    groups.sort((a, b) => Number(b.near.length > 0) - Number(a.near.length > 0) || String(a.near[0]?.date || a.elsewhere[0]?.date || "9").localeCompare(String(b.near[0]?.date || b.elsewhere[0]?.date || "9")));
    return groups;
  });
  if (out) return res.json({ success: true, located: Boolean(from), radius: settings.radius, groups: out });
  return undefined;
};

/** What's on near you over the next weeks, by type. */
exports.nearby = async (req, res) => {
  const settings = await settingsFor(req.user.id);
  if (settings.lat === null || settings.lon === null) return fail(res, 400, "Set your city first.");
  const segment = SEGMENTS.includes(req.query.segment) ? req.query.segment : undefined;
  const days = num(req.query.days, 1, 90) || 30;
  const events = await tmCall(res, () => tm.nearby({ lat: settings.lat, lon: settings.lon, radius: settings.radius, days, segment }));
  if (events) return res.json({ success: true, events });
  return undefined;
};

// ── Saved events ────────────────────────────────────────────────────────

exports.save = async (req, res) => {
  const e = req.body || {};
  const tmId = str(e.id || e.tmId, 60);
  if (!tmId || !e.name) return fail(res, 400, "Which event?");
  const status = ["interested", "going", "bought"].includes(e.status) ? e.status : "interested";
  const saved = await Saved.findOneAndUpdate(
    { owner: req.user.id, tmId },
    {
      $set: {
        name: str(e.name, 300),
        url: url(e.url),
        image: url(e.image),
        date: /^\d{4}-\d{2}-\d{2}$/.test(e.date || "") ? e.date : null,
        time: str(e.time, 10) || null,
        venue: str(e.venue, 200),
        city: str(e.city, 120),
        priceMin: num(e.priceMin, 0, 1e6),
        priceMax: num(e.priceMax, 0, 1e6),
        onsaleAt: str(e.onsaleAt, 40) || null,
        status,
      },
    },
    { new: true, upsert: true, runValidators: true },
  ).lean();
  return res.status(201).json({ success: true, saved });
};

exports.updateSaved = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const b = req.body || {};
  const set = {};
  if (["interested", "going", "bought"].includes(b.status)) set.status = b.status;
  if (b.notes !== undefined) set.notes = str(b.notes, 1000);
  const saved = await Saved.findOneAndUpdate({ _id: req.params.id, owner: req.user.id }, { $set: set }, { new: true }).lean();
  if (!saved) return fail(res, 404, "Not found");
  return res.json({ success: true, saved });
};

exports.removeSaved = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const r = await Saved.deleteOne({ _id: req.params.id, owner: req.user.id });
  if (!r.deletedCount) return fail(res, 404, "Not found");
  return res.json({ success: true });
};
