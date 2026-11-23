const mongoose = require("mongoose");

/** A bet you placed (the app never places bets): a straight bet, a parlay, or a future. */
const legSchema = new mongoose.Schema(
  {
    eventId: { type: String, default: "" },
    sport: { type: String, enum: ["nba", "nfl"], required: true },
    date: { type: String, default: "" }, // game day, YYYY-MM-DD (US Eastern)
    matchup: { type: String, trim: true, maxlength: 60, default: "" },
    market: { type: String, enum: ["spread", "total", "moneyline", "prop", "future"], required: true },
    stat: { type: String, default: "" }, // props: points, rebounds, recYds…
    athleteId: { type: String, default: "" }, // props: ESPN athlete id
    side: { type: String, trim: true, maxlength: 20, default: "" }, // home | away | over | under
    line: { type: Number, default: null },
    odds: { type: Number, required: true },
    label: { type: String, trim: true, maxlength: 120, required: true },
    result: { type: String, enum: ["pending", "won", "lost", "push"], default: "pending" },
  },
  { _id: false },
);

const betSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "OsUser", required: true },
    kind: { type: String, enum: ["straight", "parlay", "future"], required: true },
    legs: { type: [legSchema], default: [] },
    stake: { type: Number, required: true, min: 0 },
    odds: { type: Number, default: null }, // the whole bet's American odds
    status: { type: String, enum: ["pending", "won", "lost", "push"], default: "pending" },
    profit: { type: Number, default: 0 },
    fromIdea: { type: Boolean, default: false },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    placedAt: { type: Date, default: Date.now },
    settledAt: { type: Date, default: null },
  },
  { timestamps: true },
);
betSchema.index({ owner: 1, status: 1, placedAt: -1 });

module.exports = mongoose.model("OsSportsBet", betSchema);
