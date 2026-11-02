const test = require("node:test");
const assert = require("node:assert/strict");
const plan = require("../utils/os/plan");
const { SCHEDULES, CATEGORIES } = require("../config/os/framework");

const goal = (over = {}) => ({ _id: "g1", category: "P1", title: "Six pack", status: "active", windowStart: "2026-11-01", windowEnd: "2026-11-30", obstacle: { kind: "single" }, percent: 0, ...over });

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

test("mode is a hint from the goal: chip-away goals are Mode 2 in %, others Mode 2 clear it", () => {
  assert.equal(plan.modeFor(goal()).mode, "m2single");
  assert.match(plan.modeFor(goal()).reason, /Start on the next step/);
  const tiered = plan.modeFor(goal({ obstacle: { kind: "tiered" }, percent: 20 }));
  assert.equal(tiered.mode, "m2tiered");
  assert.match(tiered.reason, /20% so far/);
  assert.equal(plan.modeFor(null), null);
});

test("window end: early, on time, roll over", () => {
  assert.equal(plan.windowStatus(goal({ status: "completed" }), "2026-11-10").next.scenario, "early");
  assert.equal(plan.windowStatus(goal({ obstacle: { kind: "tiered" }, percent: 100 }), "2026-12-02").next.scenario, "on-time");
  assert.equal(plan.windowStatus(goal(), "2026-12-01").next.scenario, "rollover");
  assert.equal(plan.windowStatus(goal(), "2026-11-20").next, null);
  assert.equal(plan.windowStatus(goal(), "2026-11-20").daysLeft, 10);
});

test("today: the block that is on now, its goal and next step, and what needs attention", () => {
  // Wednesday Nov 4 2026, 9:00 a.m. New York: v1, PF1 block 1.
  const at = new Date("2026-11-04T14:00:00Z");
  const goals = [goal(), goal({ _id: "g2", category: "PF1", title: "Basketball software job", nextStep: "Finish the portfolio project" })];
  const logs = [{ goal: "g2", date: "2026-11-03", outcome: "progress" }];
  const t = plan.buildToday({ goals, logs, at, tz: "America/New_York" });
  assert.equal(t.date, "2026-11-04");
  assert.equal(t.dayType, "v1");
  assert.equal(t.now.category, "PF1");
  assert.equal(t.now.nextStep, "Finish the portfolio project");
  assert.equal(t.now.loggedToday, false);
  assert.equal(t.nextGoalBlock.category, "PF1"); // block 2 after lunch
  assert.equal(t.attention.filter((a) => a.kind === "missing").length, 4);
  assert.ok(!t.attention.some((a) => a.kind === "ceiling"));
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

test("review: this week's check-ins per goal, days worked, and whether it was cleared", () => {
  const g = goal({ obstacle: { kind: "tiered" }, percent: 20 });
  const logs = [
    { goal: "g1", date: "2026-11-02", outcome: "progress", block: "06:15" },
    { goal: "g1", date: "2026-11-02", outcome: "progress", block: "18:30" },
    { goal: "g1", date: "2026-11-04", outcome: "cleared" },
    { goal: "g1", date: "2026-10-28", outcome: "progress" },
  ];
  const [r] = plan.buildReview({ goals: [g], logs, date: "2026-11-07" });
  assert.equal(r.sessions, 3);
  assert.equal(r.daysWorked, 2);
  assert.equal(r.cleared, true);
  assert.equal(r.percentThisWeek, undefined);
  assert.deepEqual(plan.weekOf("2026-11-07"), { start: "2026-11-02", end: "2026-11-08" });
});

test("focus: always one answer, and what's next across days", () => {
  const goals = [
    { _id: "g1", category: "P1", title: "Run 5k under 25", status: "active", windowStart: "2026-10-01", windowEnd: "2026-10-31", obstacle: { kind: "tiered" }, percent: 20, nextStep: "Intervals 6x400" },
    { _id: "g2", category: "PF1", title: "Ship v2", status: "active", windowStart: "2026-10-01", windowEnd: "2027-03-31", obstacle: { kind: "single" }, nextStep: "" },
  ];
  const tz = "America/New_York";
  const at = (iso, extra = {}) => plan.buildToday({ goals, logs: [], at: new Date(iso), tz, ...extra }).focus;

  // Saturday night: free time; next is the review (Sunday's slot)
  let f = at("2026-10-31T23:30:00-04:00");
  assert.equal(f.state, "free");
  assert.equal(f.next.review, true);
  assert.equal(f.next.day, "Tomorrow");

  // Sunday 3 AM: off schedule, next is today's review
  f = at("2026-11-01T03:26:00-05:00");
  assert.equal(f.state, "off");
  assert.equal(f.next.day, "Today");
  assert.equal(f.next.start, "14:00");

  // Review done: next skips it and lands on Monday's first goal block with its next step
  f = at("2026-11-01T03:26:00-05:00", { reviewDone: true });
  assert.equal(f.next.day, "Tomorrow");
  assert.equal(f.next.goalTitle, "Run 5k under 25");
  assert.equal(f.next.nextStep, "Intervals 6x400");

  // Sunday after the slot, not done: still due
  assert.equal(at("2026-11-01T16:00:00-05:00").state, "review");
  assert.equal(at("2026-11-01T16:00:00-05:00", { reviewDone: true }).state, "free");

  // Monday in a goal block, then a break pointing to the next one
  f = at("2026-11-02T06:20:00-05:00");
  assert.equal(f.state, "goal");
  assert.equal(f.block.goalTitle, "Run 5k under 25");
  assert.equal(f.block.nextStep, "Intervals 6x400");
  assert.equal(f.next.goalTitle, "Ship v2");
  f = at("2026-11-02T07:10:00-05:00");
  assert.equal(f.state, "break");
  assert.equal(f.next.start, "08:30");
});

test("a log counts for the block it names; PF1's second block isn't marked done by the first", () => {
  const goals = [{ _id: "g2", category: "PF1", title: "Ship v2", status: "active", windowStart: "2026-10-01", windowEnd: "2027-03-31", obstacle: { kind: "single" } }];
  const logs = [{ goal: "g2", date: "2026-11-02", block: "08:30", outcome: "progress" }];
  const t = plan.buildToday({ goals, logs, at: new Date("2026-11-02T13:00:00-05:00"), tz: "America/New_York" });
  const pf = t.blocks.filter((b) => b.category === "PF1");
  assert.deepEqual(pf.map((b) => b.loggedToday), [true, false]);
});

test("today's check-in is shown back as what was tapped", () => {
  const goals = [{ _id: "g2", category: "PF1", title: "Ship v2", status: "active", windowStart: "2026-10-01", windowEnd: "2027-03-31", obstacle: { kind: "single" } }];
  const logs = [{ goal: "g2", date: "2026-11-02", block: "08:30", outcome: "cleared" }];
  const t = plan.buildToday({ goals, logs, at: new Date("2026-11-02T13:00:00-05:00"), tz: "America/New_York" });
  assert.equal(t.blocks.find((b) => b.start === "08:30").outcomeToday, "cleared");
  assert.equal(t.blocks.find((b) => b.start === "12:30").outcomeToday, null);
  assert.equal(t.goals.find((g) => g.category === "PF1").outcomeToday, "cleared");
});
