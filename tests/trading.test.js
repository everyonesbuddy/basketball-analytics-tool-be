const test = require("node:test");
const assert = require("node:assert/strict");
const ta = require("../utils/os/ta");
const T = require("../utils/os/trading");

const close = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

/** Daily candles from a list of closes, with a small range around each. */
const candles = (closes, start = new Date("2025-01-01")) =>
  closes.map((c, i) => ({ date: new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1e6 }));

test("indicators match pandas_ta (what the old Python scanners used)", () => {
  const { candles: cs, ref } = require("./fixtures/pandas_ta_reference.json");
  const I = ta.indicators(cs);
  const same = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === null || b[i] === null) continue;
      n++;
      close(a[i], b[i], 1e-8);
    }
    assert.ok(n > 200);
  };
  same(I.rsi, ref.rsi);
  same(I.ema50, ref.ema50);
  same(I.macd.hist, ref.macdh);
  same(I.bb.lower, ref.bbl);
  same(I.bb.upper, ref.bbu);
  same(I.stoch.k, ref.k);
  same(I.stoch.d, ref.d);
  same(I.atr, ref.atr);
});

test("Black-Scholes matches the textbook example", () => {
  const c = T.blackScholes({ S: 100, K: 100, T: 1, sigma: 0.2, r: 0.05, type: "call" });
  const p = T.blackScholes({ S: 100, K: 100, T: 1, sigma: 0.2, r: 0.05, type: "put" });
  close(c.price, 10.4506);
  close(p.price, 5.5735);
  close(c.delta, 0.6368);
  close(p.delta, -0.3632);
  close(T.normCdf(1.96), 0.975, 1e-4);
  assert.equal(T.blackScholes({ S: 110, K: 100, T: 0, sigma: 0.2, type: "call" }).price, 10, "at expiry: intrinsic value");
});

test("bases: the gain that makes a single, double, triple or home run", () => {
  assert.equal(T.baseFor(1.5), null, "too small to bother");
  assert.equal(T.baseFor(4), "single");
  assert.equal(T.baseFor(7), "double");
  assert.equal(T.baseFor(15), "triple");
  assert.equal(T.baseFor(40), "homeRun");
  assert.equal(T.baseFor(20, "option"), "single");
  assert.equal(T.baseFor(35, "option"), "double");
  assert.equal(T.baseFor(80, "option"), "triple");
  assert.equal(T.baseFor(250, "option"), "homeRun");
  const split = Object.values(T.DEFAULT_SPLIT).reduce((a, b) => a + b, 0);
  assert.equal(split, 100);
});

test("a pullback in an uptrend: the rule, from indicator values", () => {
  // Two candles of indicators: yesterday and today.
  const I = {
    close: [104, 101],
    ema20: [102, 101.5],
    ema50: [98, 98.2],
    rsi: [48, 41],
    macd: { hist: [-0.6, -0.4] },
    stoch: { k: [18, 24], d: [20, 21] },
    bb: { lower: [100, 100], upper: [110, 110] },
    volRatio: [1, 0.9],
  };
  const found = T.setupsAt(I, 1).find((s) => s.key === "pullback");
  assert.ok(found);
  assert.equal(found.direction, "up");
  assert.equal(found.strength, 100, "uptrend, RSI cooled, at the lower band, stochastic turning up, MACD improving");
  assert.ok(found.reasons.includes("stochastic turning up"));
  // Not in an uptrend: no pullback, whatever else lines up.
  const down = { ...I, ema50: [106, 106] };
  assert.equal(T.setupsAt(down, 1).find((s) => s.key === "pullback"), undefined);
});

test("an idea from real-looking prices: a plan, a base, options only when bearish, and the setup's history", () => {
  // A zig-zag where every breakdown reverses: the history should say so.
  const closes = [];
  let p = 100;
  for (let i = 0; i < 252; i++) {
    p *= i % 12 >= 8 ? 0.97 : 1.015;
    closes.push(p);
  }
  const ideas = T.ideasFor("TEST", candles(closes));
  const idea = ideas.find((x) => x.setup === "breakdown");
  assert.ok(idea);
  assert.equal(idea.direction, "down");
  assert.equal(idea.optionsOnly, true, "a bearish stock idea is a put idea");
  assert.ok(idea.stop > idea.entry && idea.target < idea.entry);
  assert.ok(idea.rewardRisk >= 1.5);
  assert.equal(idea.base, "double");
  assert.ok(idea.history.n >= 10);
  assert.equal(idea.history.hitRate, 0, "this setup failed every time on this chart");
  assert.equal(T.ideasFor("BTC-USD", candles(closes), { kind: "crypto" }).filter((x) => x.direction === "down").length, 0, "crypto: long only");
});

test("history counts wins, losses and timeouts without double counting", () => {
  const closes = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 3) * 5);
  const cs = candles(closes);
  const I = ta.indicators(cs);
  const h = T.history(cs, I, "pullback", 3, 2);
  assert.equal(h.n, h.wins + h.losses + h.timeouts);
});

test("support and resistance from swing points", () => {
  const closes = [10, 11, 12, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 13, 12, 11, 12, 13, 14, 15, 16, 15, 14, 13, 12];
  const { supports, resistances } = T.levels(candles(closes));
  assert.ok(supports.some((s) => Math.abs(s - 9 * 0.99) < 0.01), "the 9 low");
  assert.ok(resistances.some((r) => Math.abs(r - 14 * 1.01) < 0.01), "the 14 high");
});

test("option ladder: one contract per base from the chain, priced and projected", () => {
  const now = new Date("2026-11-23T15:00:00Z");
  const idea = { direction: "up", price: 100, target: 108, stop: 96 };
  const exp35 = new Date(now.getTime() + 35 * 86400000);
  const exp14 = new Date(now.getTime() + 14 * 86400000);
  const chainFor = (exp) => {
    const T_ = (exp - now) / 86400000 / 365;
    return {
      expiration: exp,
      calls: [80, 85, 90, 95, 100, 105, 110, 115, 120].map((K) => {
        const mid = T.blackScholes({ S: 100, K, T: T_, sigma: 0.35, type: "call" }).price;
        return { contractSymbol: `TEST${K}C${exp.toISOString().slice(5, 10)}`, strike: K, bid: mid * 0.97, ask: mid * 1.03, impliedVolatility: 0.35, openInterest: 500, volume: 40 };
      }),
      puts: [],
    };
  };
  const picks = T.optionLadder(idea, [chainFor(exp35), chainFor(exp14)], { now });
  const by = Object.fromEntries(picks.map((p) => [p.intent, p]));
  assert.ok(by.single && by.double && by.triple && by.homeRun, "a contract for each base");
  assert.ok(by.single.strike < 100 && by.double.strike >= 95 && by.triple.strike > 100, "deeper in the money for safer bases");
  assert.equal(by.homeRun.days, 14, "the home run is short-dated");
  assert.ok(by.single.gainPct < by.double.gainPct && by.double.gainPct < by.triple.gainPct, "more upside, further out");
  assert.ok(by.homeRun.gainPct >= 100, "the home run more than doubles at the target");
  assert.ok(by.single.lossPct < by.homeRun.lossPct, "and the safer pick loses less at the stop");
  assert.equal(by.single.type, "call");
  close(by.double.cost, by.double.mid * 100, 1);
});

test("sizing: a stop-out loses about the base's share of the weekly risk", () => {
  const s = T.sizeFor({ base: "single", kind: "stock", entry: 100, stop: 95 }, { weeklyRisk: 200 });
  assert.equal(s.budget, 100);
  assert.equal(s.qty, 20, "$100 risk at $5 a share");
  const hr = T.sizeFor({ base: "homeRun", kind: "option", premium: 0.5 }, { weeklyRisk: 400 });
  assert.equal(hr.qty, 0, "a $50 contract doesn't fit a $20 home-run budget");
  const hr2 = T.sizeFor({ base: "homeRun", kind: "option", premium: 0.15 }, { weeklyRisk: 400 });
  assert.equal(hr2.qty, 1);
});

test("tracked plays: target and stop checks, returns and the record by base", () => {
  const open = { status: "open", kind: "stock", direction: "up", entryPrice: 100, target: 108, stop: 96 };
  assert.equal(T.checkPlay(open, 109), "target");
  assert.equal(T.checkPlay(open, 95), "stop");
  assert.equal(T.checkPlay(open, 101), null);
  const put = { status: "open", kind: "option", direction: "down", entryPrice: 2, target: 3, stop: 1 };
  assert.equal(T.checkPlay(put, 3.2), "target", "a put's premium rises when the stock falls");
  const plays = [
    { status: "closed", base: "single", kind: "stock", direction: "up", entryPrice: 100, exitPrice: 104, qty: 10 },
    { status: "closed", base: "single", kind: "stock", direction: "up", entryPrice: 100, exitPrice: 97, qty: 10 },
    { status: "closed", base: "homeRun", kind: "option", direction: "up", entryPrice: 0.5, exitPrice: 2, qty: 2 },
    { status: "open", base: "double", kind: "crypto", direction: "up", entryPrice: 1, qty: 1 },
  ];
  const r = T.record(plays);
  assert.equal(r.open, 1);
  assert.equal(r.byBase.single.plays, 2);
  assert.equal(r.byBase.single.hitRate, 0.5);
  assert.equal(r.byBase.single.pl, 10);
  assert.equal(r.byBase.homeRun.avgReturnPct, 300);
  assert.equal(r.byBase.homeRun.pl, 300, "2 contracts × 100 × $1.50");
  assert.equal(r.all.pl, 310);
});

test("push run: stocks scan at 10:00 on a weekday and alert; open plays that hit their target alert once", async () => {
  const market = require("../services/os/market");
  const { TradingSettings, TradeScan, TradePlay } = require("../models/tradingModels");
  const ctl = require("../controllers/trading.controller");
  const closes = [];
  let p = 100;
  for (let i = 0; i < 252; i++) {
    p *= i % 12 >= 8 ? 0.97 : 1.015;
    closes.push(p);
  }
  const series = candles(closes);
  const orig = { dc: market.dailyCandles, oc: market.optionChains, q: market.quotes, sf: TradingSettings.findOne, tf: TradeScan.findOne, tu: TradeScan.updateOne, pf: TradePlay.find, pe: TradePlay.exists };
  const lean = (v) => ({ lean: async () => v });
  let saved = null;
  const play = { _id: "p1", kind: "stock", symbol: "AAPL", underlying: "AAPL", status: "open", direction: "up", entryPrice: 100, target: 108, stop: 96, hit: null, save: async () => {} };
  market.dailyCandles = async () => series;
  market.optionChains = async () => [];
  market.quotes = async () => ({ AAPL: { price: 109 } });
  TradingSettings.findOne = () => lean({ stocks: ["AAPL"], crypto: [], minScore: 0, alerts: true });
  TradeScan.findOne = () => lean(saved);
  TradeScan.updateOne = async (q, u) => {
    saved = { ...(saved || {}), ...u.$set };
  };
  TradePlay.find = (q) => (q.kind === "option" ? lean([]) : Promise.resolve([play]));
  TradePlay.exists = async () => null;
  try {
    // Monday 2026-11-23, 10:05 in New York.
    const now = new Date("2026-11-23T15:05:00Z");
    const out = await ctl.pushDue("owner1", now);
    assert.ok(saved.lastStockScan, "stocks were scanned in the 10:00 slot");
    assert.ok(saved.ideas.some((i) => i.symbol === "AAPL"), "the scan's ideas are saved");
    const hit = out.find((n) => n.key === "trade-hit:p1:target");
    assert.ok(hit, "the play's target hit is announced");
    assert.match(hit.title, /Target hit: AAPL/);
    assert.equal(play.hit, "target");
    // The breakdown idea on this chart has a poor history, so it doesn't trigger an "ideas" alert.
    assert.equal(out.filter((n) => n.key.startsWith("trade-ideas")).length, 0);
    // Ten minutes later: no new scan, no repeat alert.
    const again = await ctl.pushDue("owner1", new Date(now.getTime() + 10 * 60000));
    assert.equal(again.length, 0);
  } finally {
    Object.assign(market, { dailyCandles: orig.dc, optionChains: orig.oc, quotes: orig.q });
    TradingSettings.findOne = orig.sf;
    TradeScan.findOne = orig.tf;
    TradeScan.updateOne = orig.tu;
    TradePlay.find = orig.pf;
    TradePlay.exists = orig.pe;
  }
});
