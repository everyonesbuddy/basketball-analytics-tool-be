const mongoose = require("mongoose");

const owner = { type: mongoose.Schema.Types.ObjectId, ref: "OsUser", required: true, index: true };

// Where you are and how far you'll go for a show.
const settingsSchema = new mongoose.Schema(
  {
    owner: { ...owner, unique: true },
    city: { type: String, trim: true, maxlength: 120, default: "" },
    lat: { type: Number, min: -90, max: 90, default: null },
    lon: { type: Number, min: -180, max: 180, default: null },
    radius: { type: Number, min: 5, max: 500, default: 50 },
  },
  { timestamps: true },
);

// An artist, team or show you follow (a Ticketmaster attraction).
const followSchema = new mongoose.Schema(
  {
    owner,
    tmId: { type: String, trim: true, maxlength: 60, required: true },
    name: { type: String, trim: true, maxlength: 200, required: true },
    image: { type: String, trim: true, maxlength: 2000, default: "" },
    segment: { type: String, trim: true, maxlength: 60, default: "" },
    genre: { type: String, trim: true, maxlength: 60, default: "" },
  },
  { timestamps: true },
);
followSchema.index({ owner: 1, tmId: 1 }, { unique: true });

// An event you've saved: interested, going (no tickets yet) or bought.
const savedSchema = new mongoose.Schema(
  {
    owner,
    tmId: { type: String, trim: true, maxlength: 60, required: true },
    name: { type: String, trim: true, maxlength: 300, required: true },
    url: { type: String, trim: true, maxlength: 2000, default: "" },
    image: { type: String, trim: true, maxlength: 2000, default: "" },
    date: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: null },
    time: { type: String, trim: true, maxlength: 10, default: null },
    venue: { type: String, trim: true, maxlength: 200, default: "" },
    city: { type: String, trim: true, maxlength: 120, default: "" },
    priceMin: { type: Number, default: null },
    priceMax: { type: Number, default: null },
    onsaleAt: { type: String, trim: true, maxlength: 40, default: null },
    status: { type: String, enum: ["interested", "going", "bought"], default: "interested" },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { timestamps: true },
);
savedSchema.index({ owner: 1, tmId: 1 }, { unique: true });

const model = (name, schema, coll) => mongoose.models[name] || mongoose.model(name, schema, coll);

module.exports = {
  Settings: model("OsEventSettings", settingsSchema, "os_event_settings"),
  Follow: model("OsEventFollow", followSchema, "os_event_follows"),
  Saved: model("OsSavedEvent", savedSchema, "os_saved_events"),
};
