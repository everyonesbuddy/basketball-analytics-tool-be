const mongoose = require("mongoose");

const owner = { type: mongoose.Schema.Types.ObjectId, ref: "OsUser", required: true };

/** Trading desk settings: watchlists, the weekly risk budget and how it splits across bases. One per owner. */
const settingsSchema = new mongoose.Schema(
  {
    owner: { ...owner, unique: true },
    stocks: { type: [String], default: undefined },
    crypto: { type: [String], default: undefined },
    weeklyRisk: { type: Number, min: 0, max: 1000000, default: 200 }, // $ you're OK losing in a bad week
    split: {
      single: { type: Number, min: 0, max: 100, default: 50 },
      double: { type: Number, min: 0, max: 100, default: 30 },
      triple: { type: Number, min: 0, max: 100, default: 15 },
      homeRun: { type: Number, min: 0, max: 100, default: 5 },
    },
    minScore: { type: Number, min: 0, max: 100, default: 45 }, // ideas below this aren't shown or sent
    alerts: { type: Boolean, default: true },
  },
  { timestamps: true },
);

/** The latest scan's ideas (replaced each scan). */
const scanSchema = new mongoose.Schema(
  {
    owner: { ...owner, unique: true },
    at: { type: Date, default: Date.now },
    kinds: { type: [String], default: [] }, // what this scan covered: stock, crypto
    ideas: { type: [mongoose.Schema.Types.Mixed], default: [] },
    skipped: { type: [mongoose.Schema.Types.Mixed], default: [] }, // symbols that failed, and why
    lastStockScan: { type: Date, default: null },
    lastCryptoScan: { type: Date, default: null },
    lastPlayCheck: { type: Date, default: null },
  },
  { timestamps: true },
);

/** A play you're tracking: from an idea or entered by hand. Never placed by the app. */
const playSchema = new mongoose.Schema(
  {
    owner,
    kind: { type: String, enum: ["stock", "option", "crypto"], required: true },
    symbol: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 }, // what's quoted: the share, coin or option contract
    underlying: { type: String, trim: true, uppercase: true, maxlength: 20, default: "" },
    direction: { type: String, enum: ["up", "down"], default: "up" },
    base: { type: String, enum: ["single", "double", "triple", "homeRun"], required: true },
    setup: { type: String, trim: true, maxlength: 60, default: "" },
    option: {
      type: { type: String, enum: ["call", "put", null], default: null },
      strike: { type: Number, default: null },
      expiration: { type: String, default: null }, // YYYY-MM-DD
    },
    entryPrice: { type: Number, required: true, min: 0 },
    qty: { type: Number, required: true, min: 0 },
    target: { type: Number, default: null, min: 0 },
    stop: { type: Number, default: null, min: 0 },
    underlyingTarget: { type: Number, default: null },
    underlyingStop: { type: Number, default: null },
    openedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    exitPrice: { type: Number, default: null, min: 0 },
    closedAt: { type: Date, default: null },
    exitReason: { type: String, enum: ["target", "stop", "manual", "expired", null], default: null },
    lastPrice: { type: Number, default: null },
    lastCheckedAt: { type: Date, default: null },
    hit: { type: String, enum: ["target", "stop", null], default: null }, // reached, waiting for you to close it
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { timestamps: true },
);
playSchema.index({ owner: 1, status: 1, openedAt: -1 });

module.exports = {
  TradingSettings: mongoose.model("OsTradingSettings", settingsSchema),
  TradeScan: mongoose.model("OsTradeScan", scanSchema),
  TradePlay: mongoose.model("OsTradePlay", playSchema),
};
