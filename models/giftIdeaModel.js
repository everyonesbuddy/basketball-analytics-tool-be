const mongoose = require("mongoose");

// A saved gift idea: usually a product link, with the picture, title and price pulled from the page.
const giftIdeaSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "OsUser", required: true, index: true },
    url: { type: String, trim: true, maxlength: 2000, default: "" },
    title: { type: String, trim: true, maxlength: 300, default: "" },
    image: { type: String, trim: true, maxlength: 2000, default: "" },
    price: { type: Number, min: 0, default: null },
    site: { type: String, trim: true, maxlength: 120, default: "" },
    person: { type: mongoose.Schema.Types.ObjectId, ref: "OsGiftPerson", default: null },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: "OsGiftPlan", default: null },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.models.OsGiftIdea || mongoose.model("OsGiftIdea", giftIdeaSchema, "os_gift_ideas");
