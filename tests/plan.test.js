const test = require("node:test");
const assert = require("node:assert/strict");
const plan = require("../utils/os/plan");
const { SCHEDULES, CATEGORIES } = require("../config/os/framework");

const goal = (over = {}) => ({ _id: "g1", category: "P1", title: "Six pack", status: "active", windowStart: "2026-11-01", windowEnd: "2026-11-30", obstacle: { kind: "single" }, toolReady: true, percent: 0, ...over });

test("schedules: weekdays alternate, weekend has the review, blocks run in order without gaps", () => {
  assert.equal(plan.dayType("Mon"), "v1");
  assert.equal(plan.dayType("Tue"), "v2");
  assert.equal(plan.dayType("Fri"), "v1");
  assert.equal(plan.dayType("Sun"), "weekend");
  for (const [k, s] of Object.entries(SCHEDULES)) {
    for (let i = 1; i < s.blocks.length; i += 1) assert.equal(s.blocks[i].start, s.blocks[i - 1].end, `${k} gap at ${s.blocks[i].start}`);
    assert.equal(s.blocks.at(-1).end, "24:00");
  }
  // Time allocations from the framework.
  const minutes = (key, cat) => SCHEDULES[key].blocks.filter((b) => b.goal === cat).reduce((m, b) => m + plan.toMin(b.end) - plan.toMin(b.start), 0);
  for (const key of ["v1", "v2"]) {
    assert.equal(minutes(key, "P1"), 45);
    assert.equal(minutes(key, "P2"), 90);
    assert.equal(minutes(key, "PF1"), 360);
    assert.equal(minutes(key, "PF2"), 150);
    assert.equal(minutes(key, "PC1"), 45);
    assert.equal(minutes(key, "PC2"), 45);
  }
  assert.ok(SCHEDULES.weekend.blocks.some((b) => b.review && b.start === "14:00"));
});

test("windows: each category's length, month ends clamp", () => {
  assert.deepEqual(plan.windowFor("P1", "2026-11-01"), { start: "2026-11-01", end: "2026-11-30" });
  assert.deepEqual(plan.windowFor("PF1", "2026-07-01"), { start: "2026-07-01", end: "2026-12-31" });
  assert.deepEqual(plan.windowFor("PF2", "2026-07-15"), { start: "2026-07-15", end: "2026-10-14" });
  assert.equal(plan.addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(CATEGORIES.length, 6);
});

test("mode follows the latest session: nothing yet → decide; missing tool → Mode 1; then clear it or chip away", () => {
  const L = (date, mode, o = {}) => ({ goal: "g1", date, mode, percentGained: 0, ...o });
  assert.equal(plan.modeFor(goal({ toolReady: null })).mode, null);
  assert.match(plan.modeFor(goal({ toolReady: null })).reason, /Decide when the block starts/);
  const m1 = plan.modeFor(goal(), [L("2026-11-02", "m1", { missing: "a gym membership" })]);
  assert.equal(m1.mode, "m1");
  assert.match(m1.reason, /gym membership/);
  assert.equal(plan.modeFor(goal(), [L("2026-11-02", "m1", { missing: "x" }), L("2026-11-03", "m1", { toolAcquired: true })]).mode, null);
  assert.equal(plan.modeFor(goal(), [L("2026-11-02", "m2single")]).mode, "m2single");
  assert.equal(plan.modeFor(goal(), [L("2026-11-02", "m2tiered", { percentGained: 3 })]).mode, "m2tiered");
  // Got the tool again after chipping away: back to chipping away.
  assert.equal(plan.modeFor(goal(), [L("2026-11-01", "m2tiered", { percentGained: 3 }), L("2026-11-02", "m1", { toolAcquired: true })]).mode, "m2tiered");
  // A rollover after a ceiling starts in Mode 1 before anything is logged.
  assert.equal(plan.modeFor(goal({ toolReady: false, toolNeeded: "a new routine" })).mode, "m1");
});

test("ceiling: flat % over the last 3 tiered sessions sends the goal back to Mode 1", () => {
  const log = (date, p) => ({ goal: "g1", date, mode: "m2tiered", percentGained: p });
  const steady = [1, 2, 3, 4, 5, 6].map((d) => log(`2026-11-0${d}`, 3));
  assert.equal(plan.ceilingCheck(steady).hit, false);
  const flat = [log("2026-11-01", 4), log("2026-11-02", 4), log("2026-11-03", 4), log("2026-11-04", 1), log("2026-11-05", 0), log("2026-11-06", 0.5)];
  const c = plan.ceilingCheck(flat);
  assert.equal(c.hit, true);
  const m = plan.modeFor(goal(), flat);
  assert.equal(m.mode, "m1");
  assert.match(m.reason, /Ceiling/);
  assert.equal(plan.ceilingCheck(flat.slice(0, 5)).hit, false, "needs 6 sessions");
});

test("window end: early, on time, roll over", () => {
  assert.equal(plan.windowStatus(goal({ status: "completed" }), "2026-11-10").next.scenario, "early");
  assert.equal(plan.windowStatus(goal({ obstacle: { kind: "tiered" }, percent: 100 }), "2026-12-02").next.scenario, "on-time");
  assert.equal(plan.windowStatus(goal(), "2026-12-01").next.scenario, "rollover");
  assert.equal(plan.windowStatus(goal(), "2026-11-20").next, null);
  assert.equal(plan.windowStatus(goal(), "2026-11-20").daysLeft, 10);
});

test("today: the block that's on now, its goal and mode, and what needs attention", () => {
  // Wednesday Nov 4 2026, 9:00 a.m. New York → v1, PF1 block 1.
  const at = new Date("2026-11-04T14:00:00Z");
  const goals = [goal(), goal({ _id: "g2", category: "PF1", title: "Basketball software job" })];
  const logs = [{ goal: "g2", date: "2026-11-03", mode: "m1", missing: "a portfolio project" }];
  const t = plan.buildToday({ goals, logs, at, tz: "America/New_York" });
  assert.equal(t.date, "2026-11-04");
  assert.equal(t.dayType, "v1");
  assert.equal(t.now.category, "PF1");
  assert.equal(t.now.mode, "m1");
  assert.match(t.now.reason, /portfolio project/);
  assert.equal(t.nextGoalBlock.category, "PF1"); // block 2 after lunch
  assert.equal(t.attention.filter((a) => a.kind === "missing").length, 4);
  assert.ok(t.quote.length > 10);
});

test("today on a weekend asks for the review until it's saved", () => {
  const at = new Date("2026-11-07T19:00:00Z"); // Saturday 2 p.m. New York
  const t = plan.buildToday({ goals: [], logs: [], at, tz: "America/New_York" });
  assert.equal(t.dayType, "weekend");
  assert.ok(t.now.review);
  assert.ok(t.attention.some((a) => a.kind === "review"));
  assert.ok(!plan.buildToday({ goals: [], logs: [], at, tz: "America/New_York", reviewDone: true }).attention.some((a) => a.kind === "review"));
});

test("review: this week's sessions and % per goal", () => {
  const g = goal({ obstacle: { kind: "tiered" }, percent: 20 });
  const logs = [
    { goal: "g1", date: "2026-11-02", mode: "m2tiered", percentGained: 5 },
    { goal: "g1", date: "2026-11-04", mode: "m2tiered", percentGained: 7 },
    { goal: "g1", date: "2026-10-28", mode: "m2tiered", percentGained: 8 },
  ];
  const [r] = plan.buildReview({ goals: [g], logs, date: "2026-11-07" });
  assert.equal(r.sessions, 2);
  assert.equal(r.percentThisWeek, 12);
  assert.equal(r.percentTotal, 20);
  assert.deepEqual(plan.weekOf("2026-11-07"), { start: "2026-11-02", end: "2026-11-08" });
});
