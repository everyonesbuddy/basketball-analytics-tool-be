/**
 * Market data from Yahoo Finance (the yahoo-finance2 package: free, no
 * account, unofficial, so it can break or rate-limit). Daily candles,
 * quotes (shares, crypto like BTC-USD, and option contracts), and option
 * chains. Cached briefly so a scan doesn't ask twice.
 */
const cache = new Map();
let client = null;

function yf() {
  if (!client) {
    const mod = require("yahoo-finance2");
    const YahooFinance = mod.default || mod;
    client = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
  }
  return client;
}

async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, until: Date.now() + ttlMs });
  return value;
}

/** Daily candles for about two years: [{ date, open, high, low, close, volume }], oldest first. */
async function dailyCandles(symbol, { days = 730 } = {}) {
  return cached(`candles:${symbol}:${days}`, 30 * 60 * 1000, async () => {
    const r = await yf().chart(symbol, { period1: new Date(Date.now() - days * 86400000), interval: "1d" });
    return (r.quotes || [])
      .filter((q) => q.close !== null && q.high !== null && q.low !== null)
      .map((q) => ({ date: new Date(q.date).toISOString().slice(0, 10), open: q.open ?? q.close, high: q.high, low: q.low, close: q.close, volume: q.volume ?? 0 }));
  });
}

/** Last prices for shares, crypto and option contracts: { SYMBOL: { price, change, name } }. */
async function quotes(symbols) {
  const list = [...new Set(symbols.filter(Boolean))];
  if (!list.length) return {};
  const out = {};
  for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40);
    const rows = await cached(`quote:${chunk.join(",")}`, 60 * 1000, () => yf().quote(chunk, { return: "array" }));
    for (const q of [].concat(rows || [])) {
      const price = q.regularMarketPrice ?? q.postMarketPrice ?? q.bid ?? null;
      out[q.symbol] = { price, change: q.regularMarketChangePercent ?? null, name: q.shortName || q.longName || q.symbol, bid: q.bid ?? null, ask: q.ask ?? null, time: q.regularMarketTime || null };
    }
  }
  return out;
}

/**
 * Option chains for the expirations that matter (about 1 to 10 weeks out):
 * [{ expiration, calls, puts }] in Yahoo's contract shape.
 */
async function optionChains(symbol, { minDays = 6, maxDays = 75, max = 4 } = {}) {
  return cached(`chains:${symbol}`, 15 * 60 * 1000, async () => {
    const first = await yf().options(symbol);
    const now = Date.now();
    const wanted = (first.expirationDates || []).filter((d) => {
      const days = (new Date(d) - now) / 86400000;
      return days >= minDays && days <= maxDays;
    });
    // A short one (home runs), and a spread of 3–8 weeks out.
    const pick = [];
    const short = wanted.find((d) => (new Date(d) - now) / 86400000 <= 30);
    if (short) pick.push(short);
    for (const target of [35, 50]) {
      const best = wanted.reduce((a, d) => (!a || Math.abs((new Date(d) - now) / 86400000 - target) < Math.abs((new Date(a) - now) / 86400000 - target) ? d : a), null);
      if (best && !pick.some((p) => +new Date(p) === +new Date(best))) pick.push(best);
    }
    const chains = [];
    for (const date of pick.slice(0, max)) {
      const r = await yf().options(symbol, { date });
      for (const o of r.options || []) chains.push({ expiration: o.expirationDate, calls: o.calls || [], puts: o.puts || [] });
    }
    return chains;
  });
}

/** Yahoo's most active US stocks today: [{ symbol, price, volume, name }]. */
async function mostActive(count = 100) {
  return cached(`actives:${count}`, 60 * 60 * 1000, async () => {
    const r = await yf().screener({ scrIds: "most_actives", count });
    return (r.quotes || []).map((q) => ({ symbol: q.symbol, price: q.regularMarketPrice ?? null, volume: q.regularMarketVolume ?? q.averageDailyVolume3Month ?? null, name: q.shortName || q.longName || q.symbol }));
  });
}

module.exports = { dailyCandles, quotes, optionChains, mostActive };
