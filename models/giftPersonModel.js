const mongoose = require("mongoose");

const MD = /^\d{2}-\d{2}$/;

// Someone you give gifts to.
const giftPersonSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "OsUser", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    relationship: { type: String, trim: true, maxlength: 40, default: "friend" },
    group: { type: String, enum: ["child", "young", "adult", "elder"], default: "adult" },
    gender: { type: String, enum: ["man", "woman", null], default: null },
    tier: { type: String, enum: ["close", "thoughtful", "casual"], default: "thoughtful" },
    birthday: { type: String, match: MD, default: null }, // MM-DD
    dates: [{ label: { type: String, trim: true, maxlength: 60 }, md: { type: String, match: MD } }],
    sizes: { shirt: { type: String, trim: true, maxlength: 20, default: "" }, shoe: { type: String, trim: true, maxlength: 20, default: "" } },
    likes: { type: String, trim: true, maxlength: 500, default: "" },
    notes: { type: String, trim: true, maxlength: 2000, default: "" },
    gifts: [{ date: { type: Date, required: true }, what: { type: String, trim: true, maxlength: 300 }, cost: { type: Number, min: 0, default: null }, plan: { type: mongoose.Schema.Types.ObjectId, ref: "OsGiftPlan", default: null } }],
  },
  { timestamps: true },
);

module.exports = mongoose.models.OsGiftPerson || mongoose.model("OsGiftPerson", giftPersonSchema, "os_gift_people");
