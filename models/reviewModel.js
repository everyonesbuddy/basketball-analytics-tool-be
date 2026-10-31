const mongoose = require("mongoose");

// The weekend review: one per week, with next actions per goal.
const reviewSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    week: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // the Monday
    entries: [
      {
        goal: { type: mongoose.Schema.Types.ObjectId, ref: "Goal" },
        nextAction: { type: String, trim: true, maxlength: 1000, default: "" },
        mode: { type: String, enum: ["m1", "m2single", "m2tiered"] },
      },
    ],
    notes: { type: String, trim: true, maxlength: 4000, default: "" },
  },
  { timestamps: true },
);
reviewSchema.index({ owner: 1, week: 1 }, { unique: true });

module.exports = mongoose.models.Review || mongoose.model("Review", reviewSchema);
