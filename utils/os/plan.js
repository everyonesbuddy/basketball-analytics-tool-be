/**
 * The goal system's rules, as pure functions (no database), so they're easy
 * to test: which schedule today follows, which block is now, which mode each
 * goal is in and why, when a tiered goal has hit its ceiling, and what to do
 * when a window ends.
 */
const { CATEGORIES, SCHEDULES, MODES, QUOTES } = require("../../config/os/framework");

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_TZ = "America/New_York";
const zone = () => process.env.OS_TIMEZONE || DEFAULT_TZ;

/** Local date parts in the owner's time zone. */
function localParts(at = new Date(), tz = zone()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: parts.weekday, // Mon, Tue, …
  };
}

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};

/** v1 on Mon/Wed/Fri, v2 on Tue/Thu, weekend on Sat/Sun. */
function dayType(weekday) {
  if (["Sat", "Sun"].includes(weekday)) return "weekend";
  if (["Tue", "Thu"].includes(weekday)) return "v2";
  return "v1";
}

/** The block that holds `minutes` (the schedule runs 6:00 to midnight; before 6:00 is sleep). */
function blockAt(blocks, minutes) {
  return blocks.find((b) => minutes >= toMin(b.start) && minutes < toMin(b.end)) || null;
}

/** Add whole months to a YYYY-MM-DD date (clamped to the month's last day). */
function addMonths(date, months) {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** A category's window from a start date: ends the day before the same date N months later. */
function windowFor(category, start) {
  const cat = CATEGORIES.find((c) => c.key === category);
  if (!cat) throw new Error(`Unknown category ${category}`);
  const endExclusive = addMonths(start, cat.months);
  const end = new Date(Date.parse(`${endExclusive}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  return { start, end };
}

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/**
 * Ceiling check for a tiered goal: % gains have flattened despite steady
 * sessions. Needs at least 6 tiered sessions; flat when the last 3 earned
 * nothing, or under half of what the 3 before them earned.
 */
function ceilingCheck(logs = []) {
  const tiered = logs.filter((l) => l.mode === "m2tiered").sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (tiered.length < 6) return { hit: false, sessions: tiered.length };
  const gain = (xs) => xs.reduce((s, l) => s + (Number(l.percentGained) || 0), 0);
  const recent = gain(tiered.slice(-3));
  const before = gain(tiered.slice(-6, -3));
  const hit = recent === 0 || (before > 0 && recent < before * 0.5);
  return { hit, sessions: tiered.length, recent: round(recent), before: round(before) };
}

const round = (n) => Math.round(n * 10) / 10;

const byTime = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));

/**
 * Which mode a goal is in today, and the reason in plain words. The mode is
 * decided block by block ("Do I have what I need today?"), so it follows the
 * latest session logged. A tiered goal whose % has gone flat goes back to
 * Mode 1 (ceiling). With nothing logged yet, it's decided at the first block.
 */
function modeFor(goal, logs = []) {
  if (!goal) return null;
  const sorted = [...logs].sort(byTime);
  const last = sorted.at(-1);
  const missing = (last && last.missing) || goal.toolNeeded;
  if (!last) {
    if (goal.toolReady === false && goal.toolNeeded) return { mode: "m1", reason: `Get the tool first: ${goal.toolNeeded}.` };
    return { mode: null, reason: "Decide when the block starts: do you have what you need today? Then clear it in one go, or chip away." };
  }
  if (last.mode === "m1" && !last.toolAcquired) {
    return { mode: "m1", reason: missing ? `Get the tool first: ${missing}.` : "Get the tool first: name what's missing, then get it." };
  }
  // The tool is in hand: keep attacking the way you last did.
  const lastAttack = [...sorted].reverse().find((l) => l.mode !== "m1");
  if (last.mode === "m1" && last.toolAcquired && !lastAttack) {
    return { mode: null, reason: "You got the tool. Now attack the obstacle: clear it in one go, or chip away." };
  }
  if ((lastAttack && lastAttack.mode) === "m2tiered") {
    const ceiling = ceilingCheck(sorted);
    if (ceiling.hit) {
      return {
        mode: "m1",
        ceiling,
        reason: `Ceiling: your last 3 sessions earned ${ceiling.recent}% against ${ceiling.before}% the 3 before. The tool has stopped working; find the next one instead of repeating the same action.`,
      };
    }
    return { mode: "m2tiered", reason: `Chip away: attack today's instance and log the % you earn. ${round(goal.percent || 0)}% so far.` };
  }
  return { mode: "m2single", reason: "Clear it: attack the obstacle directly and try to finish it today." };
}

/** Where a goal stands in its window, and what the framework says to do at the end. */
function windowStatus(goal, today) {
  const total = daysBetween(goal.windowStart, goal.windowEnd) + 1;
  const left = daysBetween(today, goal.windowEnd);
  const done = goal.status === "completed" || (goal.obstacle?.kind === "tiered" && (goal.percent || 0) >= 100);
  let next = null;
  if (done && left > 0) next = { scenario: "early", text: "Done early: expand the scope to fill the window, or pull in a related tiered obstacle." };
  else if (left < 0 && done) next = { scenario: "on-time", text: "Window over and goal done: set the next goal and classify its obstacle." };
  else if (left < 0) next = { scenario: "rollover", text: "Window over and not done: roll it over one full window. If the tool hit a ceiling, start the rollover in Mode 1." };
  return { totalDays: total, daysLeft: Math.max(left, 0), ended: left < 0, done, next };
}

/** One quote per day, rotating. */
function quoteFor(date) {
  const n = daysBetween("2026-01-01", date);
  return QUOTES[((n % QUOTES.length) + QUOTES.length) % QUOTES.length];
}

/**
 * Today: the schedule with each block's goal, mode and reason, the block
 * that's on now and the next goal block, plus anything that needs a decision
 * (a missing goal, a window that ended, a ceiling, the weekly review).
 */
function buildToday({ goals = [], logs = [], at = new Date(), tz = zone(), reviewDone = false }) {
  const { date, minutes, weekday } = localParts(at, tz);
  const type = dayType(weekday);
  const schedule = SCHEDULES[type];
  const active = new Map(goals.filter((g) => g.status === "active").map((g) => [g.category, g]));
  const logsFor = (g) => logs.filter((l) => String(l.goal) === String(g._id));
  const loggedToday = (g) => logsFor(g).some((l) => l.date === date);

  const perGoal = new Map();
  for (const c of CATEGORIES) {
    const g = active.get(c.key);
    if (!g) continue;
    perGoal.set(c.key, { goal: g, ...modeFor(g, logsFor(g)), window: windowStatus(g, date), loggedToday: loggedToday(g) });
  }

  const blocks = schedule.blocks.map((b) => {
    const info = b.goal ? perGoal.get(b.goal) : null;
    return {
      ...b,
      now: minutes >= toMin(b.start) && minutes < toMin(b.end),
      past: minutes >= toMin(b.end),
      category: b.goal || null,
      goalId: info ? String(info.goal._id) : null,
      goalTitle: info?.goal.title || null,
      mode: info?.mode || null,
      modeName: info ? (info.mode ? MODES[info.mode].name : null) : null,
      reason: info?.reason || (b.goal ? "No active goal in this category yet." : null),
      loggedToday: info?.loggedToday || false,
    };
  });

  const attention = [];
  for (const c of CATEGORIES) {
    const info = perGoal.get(c.key);
    if (!info) {
      attention.push({ kind: "missing", category: c.key, text: `${c.name} has no active goal. Set one (${c.months}-month window).` });
      continue;
    }
    if (info.window.next) attention.push({ kind: info.window.next.scenario, category: c.key, goalId: String(info.goal._id), text: `${info.goal.title}: ${info.window.next.text}` });
    if (info.ceiling?.hit) attention.push({ kind: "ceiling", category: c.key, goalId: String(info.goal._id), text: `${info.goal.title}: ${info.reason}` });
  }
  if (type === "weekend" && !reviewDone) attention.push({ kind: "review", text: "Weekly goal review is due (2:00 to 2:30 PM): mode, %, ceiling check and next action for each goal." });

  const now = blockAt(schedule.blocks, minutes);
  const nextGoalBlock = blocks.find((b) => b.category && !b.past && !b.now) || null;
  return {
    date,
    weekday,
    dayType: type,
    scheduleName: schedule.name,
    now: now ? blocks.find((b) => b.start === now.start) : null,
    nextGoalBlock,
    blocks,
    goals: CATEGORIES.map((c) => {
      const info = perGoal.get(c.key);
      return {
        category: c.key,
        categoryName: c.name,
        goal: info?.goal || null,
        mode: info?.mode || null,
        modeName: info ? (info.mode ? MODES[info.mode].name : null) : null,
        reason: info?.reason || null,
        ceiling: info?.ceiling || null,
        window: info?.window || null,
        loggedToday: info?.loggedToday || false,
      };
    }),
    attention,
    quote: quoteFor(date),
  };
}

/** Week starting Monday, in the owner's time zone. */
function weekOf(date) {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(d.getTime() - dow * DAY).toISOString().slice(0, 10);
  const end = new Date(d.getTime() + (6 - dow) * DAY).toISOString().slice(0, 10);
  return { start, end };
}

/** The weekly review's numbers for each active goal. */
function buildReview({ goals = [], logs = [], date }) {
  const { start, end } = weekOf(date);
  return goals
    .filter((g) => g.status === "active")
    .map((g) => {
      const mine = logs.filter((l) => String(l.goal) === String(g._id));
      const week = mine.filter((l) => l.date >= start && l.date <= end);
      const m = modeFor(g, mine);
      return {
        goalId: String(g._id),
        category: g.category,
        title: g.title,
        mode: m.mode,
        modeName: m.mode ? MODES[m.mode].name : null,
        reason: m.reason,
        sessions: week.length,
        percentThisWeek: round(week.reduce((s, l) => s + (Number(l.percentGained) || 0), 0)),
        percentTotal: round(g.percent || 0),
        cleared: week.some((l) => l.cleared),
        toolAcquired: week.some((l) => l.toolAcquired),
        ceiling: m.ceiling || ceilingCheck(mine),
        window: windowStatus(g, date),
      };
    });
}

module.exports = { localParts, dayType, blockAt, addMonths, windowFor, ceilingCheck, modeFor, windowStatus, buildToday, buildReview, weekOf, quoteFor, toMin };
