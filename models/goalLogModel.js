const mongoose = require("mongoose");

// What happened in one block: the mode worked, and the result.
const goalLogSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "OsUser", required: true, index: true },
    goal: { type: mongoose.Schema.Types.ObjectId, ref: "OsGoal", required: true, index: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    mode: { type: String, enum: ["m1", "m2single", "m2tiered"], required: true },
    percentGained: { type: Number, min: 0, max: 100, default: 0 }, // Mode 2-Tiered
    cleared: { type: Boolean, default: false }, // Mode 2-Single: obstacle (or milestone) cleared
    toolAcquired: { type: Boolean, default: false }, // Mode 1: got the tool
    missing: { type: String, trim: true, maxlength: 500, default: "" }, // Mode 1: what's missing
    note: { type: String, trim: true, maxlength: 2000, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.models.OsGoalLog || mongoose.model("OsGoalLog", goalLogSchema, "os_goal_logs");
