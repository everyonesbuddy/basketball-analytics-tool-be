const mongoose = require("mongoose");

// A check-in: what happened in one block (moved it forward, or cleared it).
const goalLogSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "OsUser", required: true, index: true },
    goal: { type: mongoose.Schema.Types.ObjectId, ref: "OsGoal", required: true, index: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    block: { type: String, match: /^\d{2}:\d{2}$/, default: null }, // which block (start time), when logged from one
    outcome: { type: String, enum: ["progress", "cleared"], required: true }, // moved it forward / cleared for the period
    percentBefore: { type: Number, default: null }, // the goal's % before a "cleared" check-in (restored on undo)
    note: { type: String, trim: true, maxlength: 2000, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.models.OsGoalLog || mongoose.model("OsGoalLog", goalLogSchema, "os_goal_logs");
