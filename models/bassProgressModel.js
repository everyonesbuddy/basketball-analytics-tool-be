const mongoose = require("mongoose");

/** Bass practice: best result per lesson, and minutes practiced per day. One per owner. */
const lessonSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 60 },
    best: { type: Number, min: 0, max: 100, default: 0 }, // best in-time score, %
    stars: { type: Number, min: 0, max: 3, default: 0 },
    attempts: { type: Number, min: 0, default: 0 },
    stepDone: { type: Boolean, default: false }, // finished it once in step-by-step mode
    bestBpm: { type: Number, min: 0, max: 300, default: 0 }, // fastest tempo with 2+ stars
    lastAt: { type: Date, default: null },
  },
  { _id: false },
);

const bassSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "OsUser", required: true, unique: true },
    lessons: { type: [lessonSchema], default: [] },
    days: { type: [{ date: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ }, minutes: { type: Number, min: 0, default: 0 } }], default: [] },
    sensitivity: { type: Number, min: 0.25, max: 4, default: 1 },
  },
  { timestamps: true },
);

module.exports = mongoose.models.OsBassProgress || mongoose.model("OsBassProgress", bassSchema, "os_bass_progress");
