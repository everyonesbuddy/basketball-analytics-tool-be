const mongoose = require("mongoose");

const owner = { type: mongoose.Schema.Types.ObjectId, ref: "OsUser", required: true, index: true };
const SLOTS = ["top", "bottom", "layer", "shoe"];

// Where you are, so the outfit can follow the weather.
const profileSchema = new mongoose.Schema(
  {
    owner: { ...owner, unique: true },
    city: { type: String, trim: true, maxlength: 120, default: "" },
    lat: { type: Number, min: -90, max: 90, default: null },
    lon: { type: Number, min: -180, max: 180, default: null },
  },
  { timestamps: true },
);

// A piece you own.
const wardrobeSchema = new mongoose.Schema(
  {
    owner,
    name: { type: String, trim: true, maxlength: 160, required: true },
    slot: { type: String, enum: SLOTS, required: true },
    color: { type: String, trim: true, maxlength: 30, required: true },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    link: { type: String, trim: true, maxlength: 2000, default: "" },
    image: { type: String, trim: true, maxlength: 2000, default: "" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// What you wore, so suggestions rotate.
const outfitLogSchema = new mongoose.Schema(
  {
    owner,
    date: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, required: true },
    occasion: { type: String, trim: true, maxlength: 30, default: "everyday" },
    lookKey: { type: String, trim: true, maxlength: 60, default: "" },
    structure: { type: String, trim: true, maxlength: 30, default: "" },
    family: { type: String, trim: true, maxlength: 30, default: null },
    name: { type: String, trim: true, maxlength: 200, default: "" },
    items: [{ type: mongoose.Schema.Types.ObjectId, ref: "OsWardrobeItem" }],
  },
  { timestamps: true },
);
outfitLogSchema.index({ owner: 1, date: -1 });

// Something you want to buy (or bought), usually from a product link.
const shopSchema = new mongoose.Schema(
  {
    owner,
    url: { type: String, trim: true, maxlength: 2000, default: "" },
    title: { type: String, trim: true, maxlength: 300, default: "" },
    image: { type: String, trim: true, maxlength: 2000, default: "" },
    price: { type: Number, min: 0, default: null },
    site: { type: String, trim: true, maxlength: 120, default: "" },
    slot: { type: String, enum: [...SLOTS, null], default: null },
    color: { type: String, trim: true, maxlength: 30, default: null },
    core: { type: String, trim: true, maxlength: 60, default: null },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
    status: { type: String, enum: ["want", "bought"], default: "want" },
  },
  { timestamps: true },
);

const model = (name, schema, coll) => mongoose.models[name] || mongoose.model(name, schema, coll);

module.exports = {
  SLOTS,
  Profile: model("OsStyleProfile", profileSchema, "os_style_profiles"),
  Wardrobe: model("OsWardrobeItem", wardrobeSchema, "os_wardrobe"),
  OutfitLog: model("OsOutfitLog", outfitLogSchema, "os_outfit_logs"),
  Shop: model("OsShopItem", shopSchema, "os_shop"),
};
