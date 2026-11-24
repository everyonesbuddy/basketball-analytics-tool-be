/**
 * The trading desk's thinking, as plain functions (no network, so it's
 * tested with made-up prices). It suggests and tracks; it never trades.
 *
 *  - setups: the signals from the old Python scanners, cleaned up and run on
 *    daily candles: pullbacks in an uptrend, breakouts, oversold bounces,
 *    and their bearish mirrors (for puts)
 *  - plans: entry, stop (support or 1.5 ATR) and target (resistance or ATR),
 *    and which "base" that is: single, double, triple or home run
 *  - history: how often the same setup on the same symbol hit its target
 *    before its stop in the last couple of years
 *  - options: for one idea, a ladder of contracts from a safer in-the-money
 *    single to a cheap out-of-the-money home run, priced with Black-Scholes
 *  - sizing and the record by base
 */
const ta = require("./ta");

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TARGET_ATR = 4; // targets no further than 4 average daily ranges

/**
 * 0–100: how much the setup lines up (strength), the reward for the risk,
 * and above all how it's done before on this symbol (hit rate and average
 * result). A setup that usually failed here scores low whatever else it has.
 */
function scoreFor(strength, rewardRisk, h) {
  const fit = strength * 0.3 + Math.min(rewardRisk, 3) * 8; // up to 54
  const past = h.n >= 5 ? (h.hitRate ?? 0) * 40 + Math.max(-5, Math.min(5, h.avgReturnPct ?? 0)) * 2 : h.n >= 2 ? 14 : 10; // up to 50
  return Math.max(0, Math.min(100, Math.round(fit + past)));
}

/** The four bases: the target gain that makes a play each one. Options move more than shares. */
const BASES = [
  { key: "single", name: "Single", stock: [2.5, 5], option: [12, 25] },
  { key: "double", name: "Double", stock: [5, 10], option: [25, 50] },
  { key: "triple", name: "Triple", stock: [10, 20], option: [50, 100] },
  { key: "homeRun", name: "Home run", stock: [20, Infinity], option: [100, Infinity] },
];
const DEFAULT_SPLIT = { single: 50, double: 30, triple: 15, homeRun: 5 };

/** Which base a target gain (in %) is, or null when it's too small to bother. */
function baseFor(gainPct, kind = "stock") {
  const key = kind === "option" ? "option" : "stock";
  for (const b of BASES) if (gainPct >= b[key][0] && gainPct < b[key][1]) return b.key;
  return null;
}

const round = (n, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0);

// ── Setups ──────────────────────────────────────────────────────────────

/**
 * The setups firing on candle i, each with a direction ("up" / "down"),
 * a strength (how many confirmations, 0–100) and plain reasons.
 */
function setupsAt(I, i) {
  const v = (arr) => arr[i];
  const close = v(I.close);
  const prevClose = I.close[i - 1];
  const ema20 = v(I.ema20);
  const ema50 = v(I.ema50);
  const rsi = v(I.rsi);
  const hist = v(I.macd.hist);
  const prevHist = I.macd.hist[i - 1];
  const k = v(I.stoch.k);
  const d = v(I.stoch.d);
  const prevK = I.stoch.k[i - 1];
  const prevD = I.stoch.d[i - 1];
  const lower = v(I.bb.lower);
  const upper = v(I.bb.upper);
  const volRatio = v(I.volRatio) ?? 1;
  if ([close, ema20, ema50, rsi, hist, k, d, lower, upper, prevClose].some((x) => x === null || x === undefined)) return [];

  const crossUp = prevK !== null && prevD !== null && prevK <= prevD && k > d;
  const crossDown = prevK !== null && prevD !== null && prevK >= prevD && k < d;
  const prior20 = I.close.slice(Math.max(0, i - 20), i);
  const high20 = Math.max(...prior20);
  const low20 = Math.min(...prior20);
  const out = [];
  const add = (key, name, direction, checks, need, style) => {
    const passed = checks.filter(([ok]) => ok);
    if (passed.length >= need && checks[0][0]) {
      out.push({ key, name, direction, style, strength: Math.round((passed.length / checks.length) * 100), reasons: passed.map(([, why]) => why) });
    }
  };

  // Long setups.
  add(
    "pullback",
    "Pullback in an uptrend",
    "up",
    [
      [close > ema50 && ema20 > ema50, "uptrend: price above the 50-day, 20-day above 50-day"],
      [rsi < 45, `RSI cooled off to ${Math.round(rsi)}`],
      [close <= lower * 1.02, "at the lower Bollinger band"],
      [k < 30 || crossUp, crossUp ? "stochastic turning up" : `stochastic low (${Math.round(k)})`],
      [hist > prevHist, "MACD momentum improving"],
    ],
    3,
    "mean reversion",
  );
  add(
    "breakout",
    "Breakout to a 20-day high",
    "up",
    [
      [close > high20, "closed at a new 20-day high"],
      [volRatio >= 1.3, `volume ${volRatio.toFixed(1)}x normal`],
      [rsi >= 55 && rsi <= 75, `RSI ${Math.round(rsi)}: strong, not stretched`],
      [hist > 0 && hist > prevHist, "MACD positive and rising"],
      [close > ema20 && ema20 > ema50, "trend lined up (price > 20-day > 50-day)"],
    ],
    4,
    "momentum",
  );
  add(
    "bounce",
    "Oversold bounce",
    "up",
    [
      [rsi < 32, `RSI oversold (${Math.round(rsi)})`],
      [close < lower, "closed below the lower Bollinger band"],
      [crossUp || k < 15, crossUp ? "stochastic turning up" : `stochastic very low (${Math.round(k)})`],
      [close > prevClose, "first up day"],
      [hist > prevHist, "MACD momentum improving"],
    ],
    3,
    "reversal (against the trend)",
  );

  // Bearish mirrors, for puts.
  add(
    "rally-fade",
    "Rally in a downtrend",
    "down",
    [
      [close < ema50 && ema20 < ema50, "downtrend: price below the 50-day, 20-day below 50-day"],
      [rsi > 55, `RSI bounced to ${Math.round(rsi)}`],
      [close >= upper * 0.98, "at the upper Bollinger band"],
      [k > 70 || crossDown, crossDown ? "stochastic turning down" : `stochastic high (${Math.round(k)})`],
      [hist < prevHist, "MACD momentum fading"],
    ],
    3,
    "mean reversion",
  );
  add(
    "breakdown",
    "Breakdown to a 20-day low",
    "down",
    [
      [close < low20, "closed at a new 20-day low"],
      [volRatio >= 1.3, `volume ${volRatio.toFixed(1)}x normal`],
      [rsi <= 45 && rsi >= 25, `RSI ${Math.round(rsi)}: weak, not washed out`],
      [hist < 0 && hist < prevHist, "MACD negative and falling"],
      [close < ema20 && ema20 < ema50, "trend lined up down"],
    ],
    4,
    "momentum",
  );
  return out;
}

// ── Support and resistance ─────────────────────────────────────────────

/** Swing highs and lows (a bar higher/lower than `side` bars each way), merged when within 2%. */
function levels(candles, upTo = candles.length - 1, side = 5) {
  const supports = [];
  const resistances = [];
  for (let i = side; i <= upTo - side; i++) {
    const lo = candles[i].low;
    const hi = candles[i].high;
    let isLow = true;
    let isHigh = true;
    for (let j = i - side; j <= i + side; j++) {
      if (j === i) continue;
      if (candles[j].low < lo) isLow = false;
      if (candles[j].high > hi) isHigh = false;
    }
    if (isLow) supports.push(lo);
    if (isHigh) resistances.push(hi);
  }
  const merge = (arr) => {
    const out = [];
    for (const x of [...arr].sort((a, b) => a - b)) if (!out.some((y) => Math.abs(x - y) / y < 0.02)) out.push(x);
    return out;
  };
  return { supports: merge(supports), resistances: merge(resistances) };
}

// ── The plan for one setup ─────────────────────────────────────────────

/**
 * Entry, stop and target for a setup on candle i. Up: stop under the nearest
 * support (or 1.5 ATR), target the nearest resistance at least 1.5 ATR away
 * (or 2.5 ATR). Down is the mirror. Needs at least 1.5 reward for 1 risk.
 */
function planFor(candles, I, i, direction) {
  const entry = I.close[i];
  const atr = I.atr[i];
  if (!entry || !atr) return null;
  const { supports, resistances } = levels(candles, i);
  let stop;
  let target;
  if (direction === "up") {
    const sup = supports.filter((s) => s < entry).pop();
    stop = Math.max(sup ? sup * 0.99 : -Infinity, entry - 1.5 * atr);
    if (entry - stop < 0.75 * atr) stop = entry - 0.75 * atr;
    const res = resistances.find((r) => r >= entry + 1.5 * atr);
    // Resistance can be far away; about 4 ATR is what a swing realistically gives in a few weeks.
    target = Math.min(res ?? entry + 2.5 * atr, entry + MAX_TARGET_ATR * atr);
  } else {
    const res = resistances.find((r) => r > entry);
    stop = Math.min(res ? res * 1.01 : Infinity, entry + 1.5 * atr);
    if (stop - entry < 0.75 * atr) stop = entry + 0.75 * atr;
    const sup = [...supports].reverse().find((s) => s <= entry - 1.5 * atr);
    target = Math.max(sup ?? entry - 2.5 * atr, entry - MAX_TARGET_ATR * atr);
  }
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (!risk || reward / risk < 1.5) return null;
  return { entry, stop, target, gainPct: Math.abs(pct(target, entry)), lossPct: Math.abs(pct(stop, entry)), rewardRisk: reward / risk, atr };
}

/**
 * How the same setup did on this symbol before: each time it fired (not
 * overlapping), did price reach the same % gain before the same % loss
 * within `horizon` days? Same-day touches count as a loss, to be safe.
 */
function history(candles, I, setupKey, gainPct, lossPct, { horizon = 20, upTo = candles.length - 1 } = {}) {
  let wins = 0;
  let losses = 0;
  let timeouts = 0;
  const returns = [];
  for (let i = 60; i < upTo - 1; i++) {
    const s = setupsAt(I, i).find((x) => x.key === setupKey);
    if (!s) continue;
    const entry = candles[i].close;
    const up = s.direction === "up";
    const tgt = up ? entry * (1 + gainPct / 100) : entry * (1 - gainPct / 100);
    const stp = up ? entry * (1 - lossPct / 100) : entry * (1 + lossPct / 100);
    let outcome = null;
    let j = i + 1;
    for (; j <= Math.min(upTo, i + horizon); j++) {
      const c = candles[j];
      const hitStop = up ? c.low <= stp : c.high >= stp;
      const hitTarget = up ? c.high >= tgt : c.low <= tgt;
      if (hitStop) {
        outcome = "loss";
        break;
      }
      if (hitTarget) {
        outcome = "win";
        break;
      }
    }
    if (outcome === "win") {
      wins += 1;
      returns.push(gainPct);
    } else if (outcome === "loss") {
      losses += 1;
      returns.push(-lossPct);
    } else {
      timeouts += 1;
      const last = candles[Math.min(upTo, i + horizon)].close;
      returns.push(up ? pct(last, entry) : -pct(last, entry));
    }
    i = j; // don't count the same move twice
  }
  const n = wins + losses + timeouts;
  return {
    n,
    wins,
    losses,
    timeouts,
    hitRate: n ? wins / n : null,
    avgReturnPct: n ? returns.reduce((a, b) => a + b, 0) / n : null,
  };
}

/**
 * Today's ideas for one symbol from its daily candles: every setup firing on
 * the last candle with a plan, its base and its history.
 */
function ideasFor(symbol, candles, { kind = "stock" } = {}) {
  if (!candles || candles.length < 120) return [];
  const I = ta.indicators(candles);
  const i = candles.length - 1;
  const out = [];
  for (const s of setupsAt(I, i)) {
    // Shares and crypto: long only. Bearish setups are for puts.
    if (s.direction === "down" && kind === "crypto") continue;
    const plan = planFor(candles, I, i, s.direction);
    if (!plan) continue;
    const base = baseFor(plan.gainPct, "stock");
    if (!base) continue;
    const h = history(candles, I, s.key, plan.gainPct, plan.lossPct);
    const last = candles[i];
    out.push({
      symbol,
      kind,
      // A bearish setup on a stock is a put idea: we don't short shares.
      optionsOnly: s.direction === "down",
      setup: s.key,
      setupName: s.name,
      style: s.style,
      direction: s.direction,
      strength: s.strength,
      reasons: s.reasons,
      asOf: last.date,
      price: round(plan.entry, 4),
      entry: round(plan.entry, 4),
      stop: round(plan.stop, 4),
      target: round(plan.target, 4),
      gainPct: round(plan.gainPct, 1),
      lossPct: round(plan.lossPct, 1),
      rewardRisk: round(plan.rewardRisk, 2),
      base,
      history: { ...h, hitRate: round(h.hitRate, 3), avgReturnPct: round(h.avgReturnPct, 2) },
      warning: h.n >= 5 && h.hitRate < 0.35 ? `This setup reached its target only ${h.wins} of ${h.n} times on ${symbol} in the last two years.` : h.n < 3 ? `Only ${h.n} past example${h.n === 1 ? "" : "s"} on ${symbol}: not much history to go on.` : null,
      // A simple score: strength, reward for the risk, and how it's done before.
      score: scoreFor(s.strength, plan.rewardRisk, h),
      indicators: { rsi: round(I.rsi[i], 1), stochK: round(I.stoch.k[i], 1), macdHist: round(I.macd.hist[i], 4), atr: round(I.atr[i], 4), volRatio: round(I.volRatio[i], 2), ema50: round(I.ema50[i], 4) },
    });
  }
  return out;
}

// ── Options: Black-Scholes and the ladder ──────────────────────────────

/** Standard normal CDF (Abramowitz–Stegun, accurate to about 1e-7). */
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/** Black-Scholes price and delta. S spot, K strike, T years, sigma (0.3 = 30%), r rate. */
function blackScholes({ S, K, T, sigma, r = 0.04, type = "call" }) {
  if (T <= 0 || sigma <= 0) {
    const intrinsic = type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
    return { price: intrinsic, delta: type === "call" ? (S > K ? 1 : 0) : S < K ? -1 : 0 };
  }
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (type === "call") return { price: S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2), delta: normCdf(d1) };
  return { price: K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1), delta: normCdf(d1) - 1 };
}

/** What each base looks for in a contract: how far in the money (delta) and how long. */
const LADDER = [
  { base: "single", delta: [0.68, 0.85], days: [25, 70], maxSpread: 0.12, note: "in the money: moves almost like the stock, loses less if wrong" },
  { base: "double", delta: [0.48, 0.62], days: [21, 60], maxSpread: 0.12, note: "at the money: the balanced pick" },
  { base: "triple", delta: [0.3, 0.45], days: [21, 50], maxSpread: 0.15, note: "a little out of the money: needs the move, pays more" },
  { base: "homeRun", delta: [0.12, 0.28], days: [7, 30], maxSpread: 0.25, note: "cheap and out of the money: often goes to zero, sometimes pays big" },
];

/**
 * For one idea, the best contract for each base from the option chains
 * [{ expiration (Date|ISO), calls: [...], puts: [...] }] (Yahoo's shape).
 * Each is priced at the mid, and projected at the stock's target and stop
 * about `holdDays` from now (or halfway to expiry, if sooner) with the same
 * implied volatility.
 *
 * With `maxCost` ($ per contract), each base takes the best contract that
 * fits under it; a base with none that fits keeps its best, marked
 * overBudget. If fewer than two bases fit, a "budget" pick is added: the
 * contract under maxCost that pays best for its risk at the target.
 */
function optionLadder(idea, chains, { now = new Date(), holdDays = 14, r = 0.04, maxCost = null } = {}) {
  const type = idea.direction === "up" ? "call" : "put";
  const S = idea.price;
  // Every quoted, liquid contract with its days and delta.
  const all = [];
  for (const chain of chains || []) {
    const exp = new Date(chain.expiration ?? chain.expirationDate);
    const days = (exp - now) / DAY_MS;
    if (!(days >= 5)) continue;
    for (const c of (type === "call" ? chain.calls : chain.puts) || []) {
      const bid = Number(c.bid) || 0;
      const ask = Number(c.ask) || 0;
      const iv = Number(c.impliedVolatility) || 0;
      if (!(bid > 0 && ask > 0 && iv > 0.01)) continue;
      if ((Number(c.openInterest) || 0) < 50) continue;
      const mid = (bid + ask) / 2;
      const { delta } = blackScholes({ S, K: c.strike, T: days / 365, sigma: iv, r, type });
      all.push({ c, mid, iv, days, delta, exp, spread: (ask - bid) / mid });
    }
  }
  const price = (best, intent, note) => {
    const Tleft = Math.max((best.days - Math.min(holdDays, best.days / 2)) / 365, 1 / 365);
    const atTarget = blackScholes({ S: idea.target, K: best.c.strike, T: Tleft, sigma: best.iv, r, type }).price;
    const atStop = blackScholes({ S: idea.stop, K: best.c.strike, T: Tleft, sigma: best.iv, r, type }).price;
    const gainPct = pct(atTarget, best.mid);
    const lossPct = -pct(atStop, best.mid);
    const breakeven = type === "call" ? best.c.strike + best.mid : best.c.strike - best.mid;
    const cost = round(best.mid * 100, 0);
    return {
      intent,
      base: baseFor(gainPct, "option"),
      note,
      contract: best.c.contractSymbol,
      type,
      strike: best.c.strike,
      expiration: best.exp.toISOString().slice(0, 10),
      days: Math.round(best.days),
      bid: round(Number(best.c.bid), 2),
      ask: round(Number(best.c.ask), 2),
      mid: round(best.mid, 2),
      cost,
      overBudget: maxCost ? cost > maxCost : false,
      iv: round(best.iv, 3),
      delta: round(best.delta, 2),
      openInterest: Number(best.c.openInterest) || 0,
      volume: Number(best.c.volume) || 0,
      atTarget: round(atTarget, 2),
      atStop: round(atStop, 2),
      gainPct: round(gainPct, 0),
      lossPct: round(Math.min(lossPct, 100), 0),
      breakevenAtExpiry: round(breakeven, 2),
    };
  };
  const fits = (x) => !maxCost || x.mid * 100 <= maxCost;
  const picks = [];
  for (const rung of LADDER) {
    const center = (rung.delta[0] + rung.delta[1]) / 2;
    const mid = (rung.days[0] + rung.days[1]) / 2;
    const inRung = all
      .filter((x) => x.days >= rung.days[0] && x.days <= rung.days[1] && x.spread <= rung.maxSpread && Math.abs(x.delta) >= rung.delta[0] && Math.abs(x.delta) <= rung.delta[1])
      .map((x) => ({ ...x, fit: Math.abs(Math.abs(x.delta) - center) + Math.abs(x.days - mid) / 365 }))
      .sort((a, b) => a.fit - b.fit);
    const best = inRung.find(fits) || inRung[0];
    if (best) picks.push(price(best, rung.base, rung.note));
  }
  const good = (p) => p.base && p.gainPct > 0;
  if (maxCost && picks.filter((p) => good(p) && !p.overBudget).length < 2) {
    // The contract under budget that pays best for its risk if the stock gets to the target.
    let budget = null;
    for (const x of all) {
      if (!fits(x) || x.spread > 0.25 || x.days > 75 || Math.abs(x.delta) < 0.12 || Math.abs(x.delta) > 0.9) continue;
      const p = price(x, "budget", `the best contract under $${maxCost}`);
      if (!good(p) || picks.some((q) => q.contract === p.contract)) continue;
      const ratio = p.gainPct / Math.max(p.lossPct, 1);
      if (!budget || ratio > budget.ratio) budget = { ...p, ratio };
    }
    if (budget) {
      const { ratio, ...p } = budget; // eslint-disable-line no-unused-vars
      picks.push(p);
    }
  }
  return picks.filter(good);
}

/**
 * How our setups have done on this symbol: every time any setup fired in
 * the candles, planned the usual way (stop, target), did it reach the target
 * before the stop within 20 days? One trade at a time per setup.
 */
function symbolFit(candles, { horizon = 20 } = {}) {
  if (!candles || candles.length < 120) return null;
  const I = ta.indicators(candles);
  const last = candles.length - 1;
  const busyUntil = {};
  let wins = 0;
  let losses = 0;
  let timeouts = 0;
  const returns = [];
  for (let i = 60; i < last - 1; i++) {
    for (const s of setupsAt(I, i)) {
      if ((busyUntil[s.key] ?? -1) >= i) continue;
      const plan = planFor(candles, I, i, s.direction);
      if (!plan) continue;
      const up = s.direction === "up";
      let outcome = null;
      let j = i + 1;
      for (; j <= Math.min(last, i + horizon); j++) {
        const c = candles[j];
        if (up ? c.low <= plan.stop : c.high >= plan.stop) {
          outcome = "loss";
          break;
        }
        if (up ? c.high >= plan.target : c.low <= plan.target) {
          outcome = "win";
          break;
        }
      }
      busyUntil[s.key] = j;
      if (outcome === "win") {
        wins += 1;
        returns.push(plan.gainPct);
      } else if (outcome === "loss") {
        losses += 1;
        returns.push(-plan.lossPct);
      } else {
        timeouts += 1;
        const end = candles[Math.min(last, i + horizon)].close;
        returns.push(up ? pct(end, plan.entry) : -pct(end, plan.entry));
      }
    }
  }
  const n = wins + losses + timeouts;
  return {
    n,
    wins,
    losses,
    timeouts,
    hitRate: n ? round(wins / n, 3) : null,
    avgReturnPct: n ? round(returns.reduce((a, b) => a + b, 0) / n, 2) : null,
  };
}

/** About what an at-the-money contract costs (3–7 weeks out, delta near 0.5): { cost, strike, expiration } or null. */
function atmCost(price, chains, { now = new Date(), r = 0.04 } = {}) {
  let best = null;
  for (const chain of chains || []) {
    const exp = new Date(chain.expiration ?? chain.expirationDate);
    const days = (exp - now) / DAY_MS;
    if (!(days >= 14 && days <= 60)) continue;
    for (const c of chain.calls || []) {
      const bid = Number(c.bid) || 0;
      const ask = Number(c.ask) || 0;
      const iv = Number(c.impliedVolatility) || 0;
      if (!(bid > 0 && ask > 0 && iv > 0.01)) continue;
      const { delta } = blackScholes({ S: price, K: c.strike, T: days / 365, sigma: iv, r, type: "call" });
      const fit = Math.abs(delta - 0.5) + Math.abs(days - 35) / 365;
      if (!best || fit < best.fit) best = { fit, cost: round(((bid + ask) / 2) * 100, 0), strike: c.strike, expiration: exp.toISOString().slice(0, 10), openInterest: Number(c.openInterest) || 0 };
    }
  }
  if (!best) return null;
  const { fit, ...rest } = best; // eslint-disable-line no-unused-vars
  return rest;
}

// ── Sizing and the record ──────────────────────────────────────────────

/**
 * How much to put on so a stop-out loses about this base's share of the
 * weekly risk budget. Home runs risk the whole premium.
 */
function sizeFor({ base, kind, entry, stop, premium, lossPct }, { weeklyRisk = 200, split = DEFAULT_SPLIT } = {}) {
  const budget = (weeklyRisk * (split[base] ?? 0)) / 100;
  if (!budget) return { maxLoss: 0, qty: 0 };
  if (kind === "option") {
    const perContractLoss = premium * 100 * (base === "homeRun" ? 1 : Math.max((lossPct || 50) / 100, 0.2));
    const qty = Math.max(0, Math.floor(budget / perContractLoss));
    return { maxLoss: round(qty * perContractLoss, 0), qty, unit: "contract", budget: round(budget, 0) };
  }
  const perUnit = Math.abs(entry - stop);
  const qty = perUnit ? budget / perUnit : 0;
  return { maxLoss: round(budget, 0), qty: kind === "crypto" ? round(qty, 6) : Math.floor(qty), unit: kind === "crypto" ? "coin" : "share", budget: round(budget, 0) };
}

/** A tracked play's return so far (or at exit), in %, for its direction. */
function returnPct(play, price = play.exitPrice ?? play.lastPrice) {
  if (!price || !play.entryPrice) return null;
  const r = pct(price, play.entryPrice);
  // Shares shorted would flip; options and long shares/crypto gain when price rises.
  return play.kind !== "option" && play.direction === "down" ? -r : r;
}

/** Has an open play hit its target or stop at this price? */
function checkPlay(play, price) {
  if (!price || play.status !== "open") return null;
  const up = play.kind === "option" || play.direction !== "down";
  if (play.target && (up ? price >= play.target : price <= play.target)) return "target";
  if (play.stop && (up ? price <= play.stop : price >= play.stop)) return "stop";
  return null;
}

/** The record: hit rate, average return and P/L by base and by kind, from closed plays. */
function record(plays) {
  const closed = plays.filter((p) => p.status === "closed" && p.exitPrice);
  const group = (list) => {
    const rets = list.map((p) => returnPct(p)).filter((x) => x !== null);
    const pl = list.reduce((a, p) => a + (p.exitPrice - p.entryPrice) * p.qty * (p.kind === "option" ? 100 : 1) * (p.kind !== "option" && p.direction === "down" ? -1 : 1), 0);
    return {
      plays: list.length,
      wins: rets.filter((x) => x > 0).length,
      hitRate: rets.length ? round(rets.filter((x) => x > 0).length / rets.length, 3) : null,
      avgReturnPct: rets.length ? round(rets.reduce((a, b) => a + b, 0) / rets.length, 1) : null,
      pl: round(pl, 2),
      best: rets.length ? round(Math.max(...rets), 1) : null,
      worst: rets.length ? round(Math.min(...rets), 1) : null,
    };
  };
  const byBase = Object.fromEntries(BASES.map((b) => [b.key, group(closed.filter((p) => p.base === b.key))]));
  const byKind = Object.fromEntries(["stock", "option", "crypto"].map((k) => [k, group(closed.filter((p) => p.kind === k))]));
  return { all: group(closed), byBase, byKind, open: plays.filter((p) => p.status === "open").length };
}

module.exports = { BASES, DEFAULT_SPLIT, LADDER, MAX_TARGET_ATR, scoreFor, baseFor, setupsAt, levels, planFor, history, ideasFor, normCdf, blackScholes, optionLadder, symbolFit, atmCost, sizeFor, returnPct, checkPlay, record };
