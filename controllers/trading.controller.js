/**
 * The trading desk: scans your watchlists for setups, turns them into
 * ideas by base (single, double, triple, home run) with an options ladder,
 * tracks the plays you take, and keeps your record. Ideas only: it never
 * places a trade. Data from Yahoo Finance.
 */
const mongoose = require("mongoose");
const { TradingSettings, TradeScan, TradePlay } = require("../models/tradingModels");
const T = require("../utils/os/trading");
const market = require("../services/os/market");
const plan = require("../utils/os/plan");

const fail = (res, status, message) => res.status(status).json({ success: false, error: { message } });
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));

/** Liquid names with busy option chains, plus the coins from the old Kraken bots. */
const DEFAULT_STOCKS = ["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AMD", "NFLX", "PLTR", "SOFI", "COIN", "MARA", "UBER", "BAC", "F", "INTC"];
const DEFAULT_CRYPTO = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "LTC-USD", "DOGE-USD", "AVAX-USD", "LINK-USD"];
const DISCLAIMER = "Ideas from price patterns and their history, not financial advice. Options can lose all of what you pay.";

async function settingsFor(owner) {
  const s = (await TradingSettings.findOne({ owner }).lean()) || {};
  return {
    stocks: s.stocks?.length ? s.stocks : DEFAULT_STOCKS,
    crypto: s.crypto?.length ? s.crypto : DEFAULT_CRYPTO,
    weeklyRisk: s.weeklyRisk ?? 200,
    split: { ...T.DEFAULT_SPLIT, ...(s.split || {}) },
    minScore: s.minScore ?? 45,
    alerts: s.alerts ?? true,
  };
}

const cleanSymbols = (list, max = 60) =>
  [...new Set((Array.isArray(list) ? list : String(list || "").split(/[\s,]+/)).map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z0-9.^=-]{1,15}$/.test(x)))].slice(0, max);

/**
 * Scan: ideas for every symbol in the chosen watchlists, with an options
 * ladder for stock ideas and a size for each. Replaces the last scan's
 * ideas for what it covered.
 */
async function scan(owner, { kinds = ["stock", "crypto"], now = new Date() } = {}) {
  const s = await settingsFor(owner);
  const list = [...(kinds.includes("stock") ? s.stocks.map((x) => [x, "stock"]) : []), ...(kinds.includes("crypto") ? s.crypto.map((x) => [x, "crypto"]) : [])];
  const ideas = [];
  const skipped = [];
  for (const [symbol, kind] of list) {
    try {
      const candles = await market.dailyCandles(symbol);
      for (const idea of T.ideasFor(symbol, candles, { kind })) {
        if (kind === "stock") {
          try {
            idea.options = T.optionLadder(idea, await market.optionChains(symbol), { now }).map((o) => ({ ...o, size: T.sizeFor({ base: o.base, kind: "option", premium: o.mid, lossPct: o.lossPct }, s) }));
          } catch (err) {
            idea.options = [];
            idea.optionsError = "Couldn't load the option chain.";
          }
        }
        if (!idea.optionsOnly) idea.size = T.sizeFor({ base: idea.base, kind, entry: idea.entry, stop: idea.stop }, s);
        idea.id = `${symbol}:${idea.setup}:${idea.asOf}`;
        ideas.push(idea);
      }
    } catch (err) {
      skipped.push({ symbol, why: err.message?.slice(0, 120) || "no data" });
    }
  }
  ideas.sort((a, b) => b.score - a.score);
  const prev = (await TradeScan.findOne({ owner }).lean()) || {};
  const keep = (prev.ideas || []).filter((i) => !kinds.includes(i.kind));
  const set = { at: now, kinds, ideas: [...ideas, ...keep].sort((a, b) => b.score - a.score), skipped };
  if (kinds.includes("stock")) set.lastStockScan = now;
  if (kinds.includes("crypto")) set.lastCryptoScan = now;
  await TradeScan.updateOne({ owner }, { $set: set }, { upsert: true });
  return { ideas, skipped, settings: s };
}

/** Prices for open plays; marks the ones that reached their target or stop. */
async function refreshPlays(owner, now = new Date()) {
  const open = await TradePlay.find({ owner, status: "open" });
  if (!open.length) return [];
  const q = await market.quotes(open.map((p) => p.symbol)).catch(() => ({}));
  const events = [];
  for (const p of open) {
    const price = q[p.symbol]?.price;
    if (!price) continue;
    p.lastPrice = price;
    p.lastCheckedAt = now;
    const hit = T.checkPlay(p, price);
    if (hit && p.hit !== hit) {
      p.hit = hit;
      events.push({ play: p, hit, price });
    }
    await p.save();
  }
  return events;
}

const playView = (p) => ({ ...p, returnPct: T.returnPct(p) === null ? null : Math.round(T.returnPct(p) * 10) / 10 });

// ── Routes ─────────────────────────────────────────────────────────────

/** GET /trading: settings, the latest ideas (above your minimum score), open plays and the record. */
exports.overview = async (req, res) => {
  const owner = req.user.id;
  const [s, scanDoc, plays] = await Promise.all([settingsFor(owner), TradeScan.findOne({ owner }).lean(), TradePlay.find({ owner }).sort({ openedAt: -1 }).limit(300).lean()]);
  const ideas = (scanDoc?.ideas || []).filter((i) => i.score >= s.minScore);
  res.json({
    success: true,
    settings: s,
    bases: T.BASES,
    scan: { at: scanDoc?.at || null, lastStockScan: scanDoc?.lastStockScan || null, lastCryptoScan: scanDoc?.lastCryptoScan || null, skipped: scanDoc?.skipped || [], hidden: (scanDoc?.ideas || []).length - ideas.length },
    ideas,
    plays: plays.map(playView),
    record: T.record(plays),
    disclaimer: DISCLAIMER,
  });
};

/** POST /trading/scan { kinds?: ["stock","crypto"] }: scan now. */
exports.scanNow = async (req, res) => {
  const kinds = (Array.isArray(req.body?.kinds) ? req.body.kinds : ["stock", "crypto"]).filter((k) => ["stock", "crypto"].includes(k));
  if (!kinds.length) return fail(res, 400, "Scan stocks, crypto or both.");
  const r = await scan(req.user.id, { kinds });
  res.json({ success: true, found: r.ideas.length, skipped: r.skipped });
};

/** GET /trading/symbol/:symbol: one symbol's ideas right now (for a look before adding it to a watchlist). */
exports.lookup = async (req, res) => {
  const symbol = cleanSymbols([req.params.symbol])[0];
  if (!symbol) return fail(res, 400, "Which symbol?");
  const kind = /-USD$/.test(symbol) ? "crypto" : "stock";
  let candles;
  try {
    candles = await market.dailyCandles(symbol);
  } catch {
    return fail(res, 404, `No price history for ${symbol}.`);
  }
  if (candles.length < 120) return fail(res, 404, `Not enough price history for ${symbol}.`);
  const s = await settingsFor(req.user.id);
  const ideas = T.ideasFor(symbol, candles, { kind });
  for (const idea of ideas) {
    if (kind === "stock") idea.options = T.optionLadder(idea, await market.optionChains(symbol).catch(() => [])).map((o) => ({ ...o, size: T.sizeFor({ base: o.base, kind: "option", premium: o.mid, lossPct: o.lossPct }, s) }));
    if (!idea.optionsOnly) idea.size = T.sizeFor({ base: idea.base, kind, entry: idea.entry, stop: idea.stop }, s);
  }
  const last = candles[candles.length - 1];
  res.json({ success: true, symbol, kind, price: last.close, asOf: last.date, ideas, candles: candles.slice(-120) });
};

/**
 * POST /trading/plays: track a play you took.
 * { kind, symbol, underlying?, direction?, base, setup?, option?: { type, strike, expiration },
 *   entryPrice, qty, target?, stop?, underlyingTarget?, underlyingStop?, notes? }
 */
exports.addPlay = async (req, res) => {
  const b = req.body || {};
  const kind = ["stock", "option", "crypto"].includes(b.kind) ? b.kind : null;
  if (!kind) return fail(res, 400, "Is it a stock, an option or crypto?");
  if (!T.BASES.some((x) => x.key === b.base)) return fail(res, 400, "Which base: single, double, triple or home run?");
  const symbol = String(b.symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,40}$/.test(symbol)) return fail(res, 400, "Which symbol?");
  const entryPrice = Number(b.entryPrice);
  const qty = Number(b.qty);
  if (!(entryPrice > 0)) return fail(res, 400, "What price did you get in at?");
  if (!(qty > 0)) return fail(res, 400, "How many?");
  const num = (v) => (v === undefined || v === null || v === "" || !(Number(v) > 0) ? null : Number(v));
  const play = await TradePlay.create({
    owner: req.user.id,
    kind,
    symbol,
    underlying: String(b.underlying || (kind === "option" ? "" : symbol)).toUpperCase().slice(0, 20),
    direction: b.direction === "down" ? "down" : "up",
    base: b.base,
    setup: String(b.setup || "").slice(0, 60),
    option: kind === "option" ? { type: b.option?.type === "put" ? "put" : "call", strike: num(b.option?.strike), expiration: /^\d{4}-\d{2}-\d{2}$/.test(b.option?.expiration || "") ? b.option.expiration : null } : undefined,
    entryPrice,
    qty,
    target: num(b.target),
    stop: num(b.stop),
    underlyingTarget: num(b.underlyingTarget),
    underlyingStop: num(b.underlyingStop),
    lastPrice: entryPrice,
    notes: String(b.notes || "").slice(0, 1000),
  });
  res.status(201).json({ success: true, play: playView(play.toObject()) });
};

/** PATCH /trading/plays/:id { close?: { price, reason }, target?, stop?, notes? } */
exports.updatePlay = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const p = await TradePlay.findOne({ _id: req.params.id, owner: req.user.id });
  if (!p) return fail(res, 404, "Not found");
  const b = req.body || {};
  if (b.close) {
    const price = Number(b.close.price);
    if (!(price >= 0)) return fail(res, 400, "What price did you get out at?");
    p.status = "closed";
    p.exitPrice = price;
    p.closedAt = new Date();
    p.exitReason = ["target", "stop", "manual", "expired"].includes(b.close.reason) ? b.close.reason : "manual";
  }
  if (b.reopen) {
    p.status = "open";
    p.exitPrice = null;
    p.closedAt = null;
    p.exitReason = null;
  }
  for (const k of ["target", "stop"]) if (b[k] !== undefined) p[k] = Number(b[k]) > 0 ? Number(b[k]) : null;
  if (b.notes !== undefined) p.notes = String(b.notes).slice(0, 1000);
  await p.save();
  res.json({ success: true, play: playView(p.toObject()) });
};

/** DELETE /trading/plays/:id */
exports.deletePlay = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  await TradePlay.deleteOne({ _id: req.params.id, owner: req.user.id });
  res.json({ success: true });
};

/** POST /trading/plays/refresh: latest prices for open plays. */
exports.refresh = async (req, res) => {
  const events = await refreshPlays(req.user.id);
  res.json({ success: true, hits: events.map((e) => ({ id: String(e.play._id), hit: e.hit, price: e.price })) });
};

/** PATCH /trading/settings { stocks?, crypto?, weeklyRisk?, split?, minScore?, alerts? } */
exports.updateSettings = async (req, res) => {
  const b = req.body || {};
  const set = {};
  if (b.stocks !== undefined) set.stocks = cleanSymbols(b.stocks).filter((x) => !/-USD$/.test(x));
  if (b.crypto !== undefined) set.crypto = cleanSymbols(b.crypto, 30).map((x) => (/-USD$/.test(x) ? x : `${x}-USD`));
  if (b.weeklyRisk !== undefined) set.weeklyRisk = Math.max(0, Math.min(1000000, Number(b.weeklyRisk) || 0));
  if (b.minScore !== undefined) set.minScore = Math.max(0, Math.min(100, Number(b.minScore) || 0));
  if (b.alerts !== undefined) set.alerts = Boolean(b.alerts);
  if (b.split) {
    const split = Object.fromEntries(["single", "double", "triple", "homeRun"].map((k) => [k, Math.max(0, Math.min(100, Number(b.split[k]) || 0))]));
    const total = Object.values(split).reduce((a, c) => a + c, 0);
    if (total !== 100) return fail(res, 400, `The base split has to add up to 100% (it's ${total}%).`);
    set.split = split;
  }
  await TradingSettings.updateOne({ owner: req.user.id }, { $set: set }, { upsert: true });
  res.json({ success: true, settings: await settingsFor(req.user.id) });
};

// ── Push: scheduled scans and play alerts ──────────────────────────────

const WEEKDAY = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

/**
 * Called on each push run (every 5 minutes): scans when due (stocks at 10:00
 * and 15:30 on weekdays, crypto every 4 hours) and checks open plays (every
 * 15 minutes). Returns notifications in the push runner's shape.
 */
async function pushDue(owner, now = new Date()) {
  const s = await settingsFor(owner);
  const { minutes, date, weekday } = plan.localParts(now);
  const scanDoc = (await TradeScan.findOne({ owner }).lean()) || {};
  const out = [];
  const marketHours = WEEKDAY.has(weekday) && minutes >= 9 * 60 + 30 && minutes <= 16 * 60;

  const kinds = [];
  const stockSlot = WEEKDAY.has(weekday) && [10 * 60, 15 * 60 + 30].some((t) => minutes >= t && minutes < t + 15);
  if (stockSlot && (!scanDoc.lastStockScan || now - new Date(scanDoc.lastStockScan) > 60 * 60 * 1000)) kinds.push("stock");
  if (!scanDoc.lastCryptoScan || now - new Date(scanDoc.lastCryptoScan) > 4 * 60 * 60 * 1000) kinds.push("crypto");
  if (kinds.length) {
    const r = await scan(owner, { kinds, now });
    const good = r.ideas.filter((i) => i.score >= s.minScore && !(i.history.n >= 5 && i.history.hitRate < 0.35));
    if (s.alerts && good.length) {
      const name = { single: "single", double: "double", triple: "triple", homeRun: "home run" };
      const list = good.slice(0, 3).map((i) => `${i.symbol} ${name[i.base]}${i.optionsOnly ? " (puts)" : i.kind === "stock" && i.options?.length ? " (shares or calls)" : ""}`);
      out.push({ key: `trade-ideas:${kinds.join("+")}:${date}:${Math.floor(minutes / 60)}`, kind: "trading", title: `${good.length} new play${good.length === 1 ? "" : "s"}`, body: `${list.join(", ")}${good.length > 3 ? ` and ${good.length - 3} more` : ""}.`, url: "/trading" });
    }
  }

  const lastCheck = scanDoc.lastPlayCheck ? new Date(scanDoc.lastPlayCheck) : null;
  const hasCrypto = await TradePlay.exists({ owner, status: "open", kind: "crypto" });
  if ((marketHours || hasCrypto) && (!lastCheck || now - lastCheck >= 15 * 60 * 1000)) {
    await TradeScan.updateOne({ owner }, { $set: { lastPlayCheck: now } }, { upsert: true });
    for (const e of await refreshPlays(owner, now)) {
      if (!s.alerts) continue;
      const p = e.play;
      const what = p.kind === "option" ? `${p.underlying} ${p.option?.strike} ${p.option?.type}` : p.symbol;
      out.push({
        key: `trade-hit:${p._id}:${e.hit}`,
        kind: "trading",
        title: e.hit === "target" ? `Target hit: ${what}` : `Stop hit: ${what}`,
        body: `${e.hit === "target" ? "Take the base" : "Time to get out"}: now ${e.price}, in at ${p.entryPrice}. Close it in the app when you sell.`,
        url: "/trading/plays",
      });
    }
  }

  // Options expiring in two days.
  if (s.alerts && minutes >= 9 * 60 && minutes < 9 * 60 + 15) {
    const soon = await TradePlay.find({ owner, status: "open", kind: "option", "option.expiration": { $ne: null } }).lean();
    for (const p of soon) {
      const days = Math.round((new Date(p.option.expiration) - new Date(date)) / 86400000);
      if (days === 2) out.push({ key: `trade-exp:${p._id}`, kind: "trading", title: `Expires in 2 days: ${p.underlying} ${p.option.strike} ${p.option.type}`, body: "Sell or roll it before it expires.", url: "/trading/plays" });
    }
  }
  return out;
}

exports.pushDue = pushDue;
exports.scan = scan;
exports._settingsFor = settingsFor;
exports.DEFAULT_STOCKS = DEFAULT_STOCKS;
exports.DEFAULT_CRYPTO = DEFAULT_CRYPTO;
