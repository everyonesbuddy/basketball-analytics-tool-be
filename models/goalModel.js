const mongoose = require("mongoose");

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// One goal in one category, with its window and how its obstacle is classified.
const goalSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "OsUser", required: true, index: true },
    category: { type: String, enum: ["P1", "P2", "PF1", "PF2", "PC1", "PC2"], required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    outcome: { type: String, trim: true, maxlength: 1000, default: "" }, // what "done" looks like
    status: { type: String, enum: ["active", "completed", "rolled", "archived"], default: "active", index: true },
    windowStart: { type: String, required: true, match: DATE },
    windowEnd: { type: String, required: true, match: DATE },
    obstacle: {
      text: { type: String, trim: true, maxlength: 1000, default: "" },
      kind: { type: String, enum: ["single", "tiered"], default: "single" },
      bounded: { type: Boolean, default: null }, // tiered only: a finite number of instances
      parallel: { type: Boolean, default: null }, // tiered only: several instances at once
    },
    // Kept in step with the latest session (the mode is decided block by block).
    toolReady: { type: Boolean, default: null }, // had what was needed last time
    toolNeeded: { type: String, trim: true, maxlength: 500, default: "" }, // what's missing (Mode 1)
    percent: { type: Number, min: 0, max: 100, default: 0 }, // tiered: accumulated %
    nextStep: { type: String, trim: true, maxlength: 500, default: "" }, // what to do at the next block
    notes: { type: String, trim: true, maxlength: 4000, default: "" },
    rolledFrom: { type: mongoose.Schema.Types.ObjectId, ref: "OsGoal", default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.models.OsGoal || mongoose.model("OsGoal", goalSchema, "os_goals");
