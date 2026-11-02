const mongoose = require("mongoose");

const owner = { type: mongoose.Schema.Types.ObjectId, ref: "OsUser", required: true, index: true };

// One phone or browser that receives push notifications.
const subSchema = new mongoose.Schema(
  {
    owner,
    endpoint: { type: String, required: true, unique: true, maxlength: 2000 },
    keys: { p256dh: { type: String, required: true, maxlength: 300 }, auth: { type: String, required: true, maxlength: 300 } },
    label: { type: String, trim: true, maxlength: 120, default: "" },
    lastOk: { type: Date, default: null },
    failures: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Which notifications you want, when, and how many.
const settingsSchema = new mongoose.Schema(
  {
    owner: { ...owner, unique: true },
    brief: { type: Boolean, default: true },
    blocks: { type: Boolean, default: true },
    checkin: { type: Boolean, default: true },
    review: { type: Boolean, default: true },
    meals: { type: Boolean, default: true },
    gifts: { type: Boolean, default: true },
    events: { type: Boolean, default: true },
    briefTime: { type: String, match: /^\d{2}:\d{2}$/, default: "06:00" },
    quietStart: { type: String, match: /^\d{2}:\d{2}$/, default: "23:00" },
    quietEnd: { type: String, match: /^\d{2}:\d{2}$/, default: "06:00" },
    dailyCap: { type: Number, min: 1, max: 50, default: 12 },
  },
  { timestamps: true },
);

// What's been sent, so each notification goes once (kept 4 days).
const sentSchema = new mongoose.Schema({
  owner,
  key: { type: String, required: true, maxlength: 200 },
  date: { type: String, required: true },
  at: { type: Date, default: Date.now, expires: 4 * 86400 },
});
sentSchema.index({ owner: 1, key: 1 }, { unique: true });

const model = (name, schema, coll) => mongoose.models[name] || mongoose.model(name, schema, coll);

module.exports = {
  PushSub: model("OsPushSub", subSchema, "os_push_subs"),
  NotifySettings: model("OsNotifySettings", settingsSchema, "os_notify_settings"),
  PushSent: model("OsPushSent", sentSchema, "os_push_sent"),
};
