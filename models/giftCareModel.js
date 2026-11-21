const mongoose = require("mongoose");

/**
 * Care for your wife and the gift circle: your settings and what you've
 * planned, done or skipped. One per owner.
 */
const entrySchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["care", "circle"], required: true },
    ideaKey: { type: String, trim: true, maxlength: 60, default: null }, // care idea (config/os/care.js), or null for your own
    size: { type: String, enum: ["small", "big", null], default: null },
    personId: { type: mongoose.Schema.Types.ObjectId, ref: "OsGiftPerson", default: null },
    title: { type: String, trim: true, maxlength: 200, default: "" },
    status: { type: String, enum: ["planned", "done", "skipped"], required: true },
    date: { type: Date, default: Date.now }, // when it was done, planned or skipped
    plannedFor: { type: Date, default: null },
    cost: { type: Number, min: 0, default: null },
    note: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { _id: true },
);

const giftCareSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "OsUser", required: true, unique: true },
    spouseId: { type: mongoose.Schema.Types.ObjectId, ref: "OsGiftPerson", default: null },
    spouseName: { type: String, trim: true, maxlength: 60, default: "" },
    likesKinds: { type: [String], default: [] },
    dislikes: { type: [String], default: [] },
    wishlist: { type: String, trim: true, maxlength: 2000, default: "" }, // things she's mentioned wanting
    budgetSmall: { type: Number, min: 0, max: 1000, default: 40 },
    budgetBig: { type: Number, min: 0, max: 5000, default: 150 },
    smallEveryDays: { type: Number, min: 3, max: 60, default: 7 },
    bigEveryDays: { type: Number, min: 7, max: 120, default: 30 },
    circleOn: { type: Boolean, default: true },
    circleEveryDays: { type: Number, min: 14, max: 180, default: 45 },
    circleBudget: { type: Number, min: 10, max: 2000, default: 50 },
    circleRelationships: { type: [String], default: [] }, // empty = the default circle
    log: { type: [entrySchema], default: [] },
  },
  { timestamps: true },
);

module.exports = mongoose.models.OsGiftCare || mongoose.model("OsGiftCare", giftCareSchema, "os_gift_care");
