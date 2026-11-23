/**
 * Technical indicators on plain arrays, matching pandas_ta (what the old
 * Python scanners used): EMA, RSI and ATR with Wilder smoothing, MACD,
 * Bollinger Bands (population standard deviation), Stochastic 14/3/3.
 * Values before an indicator has enough data are null.
 */

const sma = (values, n) => {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
};

/** EMA seeded with the SMA of the first n values (as pandas_ta does). */
function ema(values, n) {
  const out = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's moving average (RMA), seeded with an SMA. */
function rma(values, n, start = 0) {
  const out = new Array(values.length).fill(null);
  if (values.length - start < n) return out;
  let prev = values.slice(start, start + n).reduce((a, b) => a + b, 0) / n;
  out[start + n - 1] = prev;
  for (let i = start + n; i < values.length; i++) {
    prev = (prev * (n - 1) + values[i]) / n;
    out[i] = prev;
  }
  return out;
}

/** Exponential average with alpha 1/n from the first value (pandas ewm, adjust=False), as pandas_ta's RSI uses. */
function wilderEwm(values, n, start = 0) {
  const out = new Array(values.length).fill(null);
  let prev = null;
  for (let i = start; i < values.length; i++) {
    prev = prev === null ? values[i] : prev + (values[i] - prev) / n;
    out[i] = prev;
  }
  return out;
}

function rsi(close, n = 14) {
  const gains = [0];
  const losses = [0];
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  const g = wilderEwm(gains, n, 1);
  const l = wilderEwm(losses, n, 1);
  // Shown only once there are n changes, like any n-period average.
  return close.map((_, i) => (i < n || g[i] === null ? null : g[i] + l[i] === 0 ? 50 : (100 * g[i]) / (g[i] + l[i])));
}

/** MACD 12/26/9: line, signal and histogram. */
function macd(close, fast = 12, slow = 26, signal = 9) {
  const f = ema(close, fast);
  const s = ema(close, slow);
  const line = close.map((_, i) => (f[i] === null || s[i] === null ? null : f[i] - s[i]));
  const firstIdx = line.findIndex((v) => v !== null);
  const sig = new Array(close.length).fill(null);
  if (firstIdx >= 0) {
    const e = ema(line.slice(firstIdx), signal);
    e.forEach((v, j) => (sig[firstIdx + j] = v));
  }
  const hist = line.map((v, i) => (v === null || sig[i] === null ? null : v - sig[i]));
  return { line, signal: sig, hist };
}

/** Bollinger Bands 20/2 with the sample standard deviation (pandas_ta's default, ddof 1). */
function bbands(close, n = 20, k = 2) {
  const mid = sma(close, n);
  const upper = new Array(close.length).fill(null);
  const lower = new Array(close.length).fill(null);
  for (let i = n - 1; i < close.length; i++) {
    const w = close.slice(i - n + 1, i + 1);
    const m = mid[i];
    const sd = Math.sqrt(w.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1));
    upper[i] = m + k * sd;
    lower[i] = m - k * sd;
  }
  return { mid, upper, lower };
}

/** Stochastic %K/%D 14/3/3. */
function stoch(high, low, close, n = 14, smoothK = 3, smoothD = 3) {
  const raw = close.map((c, i) => {
    if (i < n - 1) return null;
    const hh = Math.max(...high.slice(i - n + 1, i + 1));
    const ll = Math.min(...low.slice(i - n + 1, i + 1));
    return hh === ll ? 50 : (100 * (c - ll)) / (hh - ll);
  });
  const smooth = (arr, m) => {
    const out = new Array(arr.length).fill(null);
    for (let i = 0; i < arr.length; i++) {
      const w = arr.slice(i - m + 1, i + 1);
      if (i >= m - 1 && w.every((v) => v !== null)) out[i] = w.reduce((a, b) => a + b, 0) / m;
    }
    return out;
  };
  const k = smooth(raw, smoothK);
  const d = smooth(k, smoothD);
  return { k, d };
}

/** Average True Range (Wilder, seeded with the SMA of the first n true ranges, as pandas_ta does). */
function atr(high, low, close, n = 14) {
  const tr = close.map((c, i) => (i === 0 ? high[i] - low[i] : Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]))));
  return rma(tr, n, 0);
}

/** Every indicator the setups use, on candles [{ date, open, high, low, close, volume }]. */
function indicators(candles) {
  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const volume = candles.map((c) => c.volume || 0);
  const volMa = sma(volume, 20);
  return {
    close,
    high,
    low,
    volume,
    ema20: ema(close, 20),
    ema50: ema(close, 50),
    ema100: ema(close, 100),
    rsi: rsi(close, 14),
    macd: macd(close),
    bb: bbands(close, 20, 2),
    stoch: stoch(high, low, close),
    atr: atr(high, low, close, 14),
    volRatio: volume.map((v, i) => (volMa[i] ? v / volMa[i] : null)),
  };
}

module.exports = { sma, ema, rma, rsi, macd, bbands, stoch, atr, indicators };
