const mongoose = require("mongoose");

const owner = { type: mongoose.Schema.Types.ObjectId, ref: "OsUser", required: true, index: true };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// What fits your kitchen: tortillas or not, sugar, cuisines, weeknight time, cook nights, likes.
const settingsSchema = new mongoose.Schema(
  {
    owner: { ...owner, unique: true },
    noShellfish: { type: Boolean, default: true }, // allergy: no shrimp, crab, crayfish…; fish is fine
    tortillas: { type: Boolean, default: true }, // corn tortillas are fine (not "bread")
    sugar: { type: String, enum: ["little", "none"], default: "little" },
    cuisines: [{ type: String, trim: true, maxlength: 40 }], // empty = all
    weeknightMax: { type: Number, min: 15, max: 180, default: 45 },
    cookNights: { type: Number, min: 0, max: 7, default: 5 },
    likes: [{ type: String, trim: true, maxlength: 60 }],
    dislikes: [{ type: String, trim: true, maxlength: 60 }],
  },
  { timestamps: true },
);

// What you ate, so ideas rotate.
const logSchema = new mongoose.Schema(
  {
    owner,
    date: { type: String, match: DATE, required: true },
    slot: { type: String, enum: ["breakfast", "lunch", "dinner"], required: true },
    key: { type: String, trim: true, maxlength: 60, required: true },
    name: { type: String, trim: true, maxlength: 200, default: "" },
    cuisine: { type: String, trim: true, maxlength: 40, default: "" },
    mode: { type: String, enum: ["cook", "order"], default: "cook" },
  },
  { timestamps: true },
);
logSchema.index({ owner: 1, date: -1 });

// A week of dinners and its grocery list.
const planSchema = new mongoose.Schema(
  {
    owner,
    weekStart: { type: String, match: DATE, required: true }, // the Monday
    days: [
      {
        _id: false,
        date: { type: String, match: DATE },
        weekday: String,
        mode: { type: String, enum: ["cook", "order"] },
        key: String,
        lunch: { type: String, default: null },
      },
    ],
    grocery: [
      {
        _id: false,
        name: String,
        aisle: String,
        for: [String],
        staple: Boolean,
        bought: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true },
);
planSchema.index({ owner: 1, weekStart: 1 }, { unique: true });

// A meal of your own (a family recipe, a go-to order).
const customSchema = new mongoose.Schema(
  {
    owner,
    name: { type: String, trim: true, maxlength: 200, required: true },
    cuisine: { type: String, trim: true, maxlength: 40, default: "Other" },
    slots: [{ type: String, enum: ["breakfast", "lunch", "dinner"] }],
    mins: { type: Number, min: 5, max: 600, default: 30 },
    mode: { type: String, enum: ["cook", "order", "both"], default: "both" },
    ingredients: { type: String, trim: true, maxlength: 1000, default: "" },
    link: { type: String, trim: true, maxlength: 2000, default: "" },
  },
  { timestamps: true },
);

const model = (name, schema, coll) => mongoose.models[name] || mongoose.model(name, schema, coll);

module.exports = {
  FoodSettings: model("OsFoodSettings", settingsSchema, "os_food_settings"),
  MealLog: model("OsMealLog", logSchema, "os_meal_logs"),
  MealPlan: model("OsMealPlan", planSchema, "os_meal_plans"),
  CustomMeal: model("OsCustomMeal", customSchema, "os_custom_meals"),
};
