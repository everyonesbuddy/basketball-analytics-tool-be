const mongoose = require("mongoose");

// A gift plan: a group (like December in Nigeria) or one person's hamper.
// `result` keeps the suggestion as it was worked out; the checklist tracks shopping and packing.
const giftPlanSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "OsUser", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    kind: { type: String, enum: ["group", "one"], required: true },
    date: { type: Date, default: null },
    status: { type: String, enum: ["planning", "shopping", "done"], default: "planning" },
    inputs: { type: mongoose.Schema.Types.Mixed, default: {} },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    person: { type: mongoose.Schema.Types.ObjectId, ref: "OsGiftPerson", default: null },
    checklist: [
      {
        key: String,
        name: { type: String, trim: true, maxlength: 200 },
        store: { type: String, trim: true, maxlength: 120 },
        packs: { type: Number, default: 1 },
        bought: { type: Boolean, default: false },
        packed: { type: Boolean, default: false },
      },
    ],
    notes: { type: String, trim: true, maxlength: 4000, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.models.OsGiftPlan || mongoose.model("OsGiftPlan", giftPlanSchema, "os_gift_plans");
