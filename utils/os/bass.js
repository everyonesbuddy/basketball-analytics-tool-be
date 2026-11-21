/**
 * Bass practice records, as pure functions (tested): keeping the best
 * result per lesson, minutes per day, and the practice streak.
 */
const DAY = 24 * 60 * 60 * 1000;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Fold one attempt into a lesson's record. */
function recordAttempt(prev, { score = 0, stars = 0, mode = "time", bpm = 0, at = new Date() }) {
  const r = { key: prev?.key, best: prev?.best || 0, stars: prev?.stars || 0, attempts: (prev?.attempts || 0) + 1, stepDone: Boolean(prev?.stepDone), bestBpm: prev?.bestBpm || 0, lastAt: at };
  if (mode === "step") r.stepDone = true;
  else {
    r.best = Math.max(r.best, Math.round(score));
    r.stars = Math.max(r.stars, stars);
    if (stars >= 2) r.bestBpm = Math.max(r.bestBpm, Math.round(bpm));
  }
  return r;
}

/** Add practice minutes to a day (keeps the last 400 days). */
function addMinutes(days, date, minutes) {
  const out = (days || []).map((d) => ({ date: d.date, minutes: d.minutes }));
  const d = out.find((x) => x.date === date);
  if (d) d.minutes = Math.round((d.minutes + minutes) * 10) / 10;
  else out.push({ date, minutes: Math.round(minutes * 10) / 10 });
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(-400);
}

/** Days in a row with practice, ending today (or yesterday, if today isn't done yet). */
function streak(days, today) {
  const set = new Set((days || []).filter((d) => d.minutes > 0).map((d) => d.date));
  let day = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(day)) {
    n += 1;
    day = addDays(day, -1);
  }
  return n;
}

/** This week's minutes (Monday to today). */
function weekMinutes(days, today) {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const from = addDays(today, -dow);
  return Math.round((days || []).filter((d) => d.date >= from && d.date <= today).reduce((n, d) => n + d.minutes, 0));
}

module.exports = { recordAttempt, addMinutes, streak, weekMinutes };
