const test = require("node:test");
const assert = require("node:assert/strict");
const plan = require("../utils/os/plan");
const notify = require("../utils/os/notify");

const tz = "America/New_York";
const goals = [
  { _id: "g1", category: "P1", title: "Run a 5k under 25", status: "active", windowStart: "2026-10-01", windowEnd: "2026-10-31", obstacle: { kind: "tiered" }, percent: 20 },
  { _id: "g2", category: "PF1", title: "Sign 3 facilities", status: "active", windowStart: "2026-10-01", windowEnd: "2027-03-31", obstacle: { kind: "single" } },
];
const at = (iso, logs = [], reviewDone = false) => {
  const now = new Date(iso);
  const today = { ...plan.buildToday({ goals, logs, at: now, tz, reviewDone }), reviewDone };
  return { today, minutes: plan.localParts(now, tz).minutes, now };
};
const keys = (list) => list.map((n) => n.key);

test("morning brief at the chosen time, with the first block and tonight's dinner", () => {
  const n = notify.dueNotifications({ ...at("2026-11-02T06:03:00-05:00"), dinner: { name: "Jollof Rice & Chicken", mode: "cook" } });
  const brief = n.find((x) => x.kind === "brief");
  assert.ok(brief);
  assert.match(brief.title, /Monday/);
  assert.match(brief.body, /6:15 AM: Run a 5k under 25$/m);
  assert.doesNotMatch(brief.body, /Intervals/, "no next steps");
  assert.match(brief.body, /Dinner: Jollof/);
  assert.ok(!notify.dueNotifications({ ...at("2026-11-02T06:03:00-05:00"), settings: { brief: false } }).some((x) => x.kind === "brief"));
});

test("block start; block end check-in with buttons; nothing once checked in", () => {
  const start = notify.dueNotifications(at("2026-11-02T08:31:00-05:00"));
  const b = start.find((x) => x.kind === "blocks");
  assert.equal(b.title, "Now: PF1 · Sign 3 facilities");
  assert.match(b.body, /^Until \d{1,2}:\d{2} [AP]M\. Move it forward\.$/);
  const end = notify.dueNotifications(at("2026-11-02T07:02:00-05:00"));
  const c = end.find((x) => x.kind === "checkin");
  assert.equal(c.checkin.goalId, "g1");
  assert.deepEqual(c.actions.map((a) => a.action), ["progress", "cleared"]);
  const logged = notify.dueNotifications(at("2026-11-02T07:02:00-05:00", [{ goal: "g1", date: "2026-11-02", block: "06:15", mode: "m2tiered", outcome: "progress" }]));
  assert.ok(!logged.some((x) => x.kind === "checkin"));
  // breaks never notify
  assert.deepEqual(keys(notify.dueNotifications(at("2026-11-02T12:01:00-05:00"))).filter((k) => !k.startsWith("checkin")), []);
});

test("weekly review at its slot and Sunday evening, not when done", () => {
  assert.ok(notify.dueNotifications(at("2026-11-01T14:02:00-05:00")).some((x) => x.key === "review:2026-11-01"));
  assert.ok(notify.dueNotifications(at("2026-11-01T18:04:00-05:00")).some((x) => x.key === "review-late:2026-11-01"));
  assert.ok(!notify.dueNotifications(at("2026-11-01T18:04:00-05:00", [], true)).some((x) => x.kind === "review"));
});

test("gifts only at milestones (7, 1, 0 days), events, quiet hours and the cap", () => {
  const base = at("2026-11-02T09:05:00-05:00");
  const raw = { gifts: [{ kind: "date", personId: "p1", days: 7, text: "Mum's birthday is in 7 days." }, { kind: "date", personId: "p2", days: 5, text: "Dad's birthday is in 5 days." }], shows: [{ kind: "event", savedId: "s1", text: "Hawks vs Celtics is tomorrow." }] };
  const n = notify.dueNotifications({ ...base, raw });
  assert.deepEqual(n.filter((x) => x.kind === "gifts").map((x) => x.body), ["Mum's birthday is in 7 days."]);
  assert.ok(n.some((x) => x.kind === "events"));
  assert.equal(notify.dueNotifications({ ...base, raw, sentToday: 12 }).length, 0);
  assert.equal(notify.inQuiet(23 * 60 + 30, "23:00", "06:00"), true);
  assert.equal(notify.inQuiet(5 * 60, "23:00", "06:00"), true);
  assert.equal(notify.inQuiet(7 * 60, "23:00", "06:00"), false);
  // the 22:15 PC2 block start is fine, but at 23:15 quiet hours hold everything
  assert.equal(notify.dueNotifications(at("2026-11-02T23:01:00-05:00")).length, 0);
});

test("tickets on sale: one heads-up about 30 minutes before", () => {
  const now = new Date("2026-11-06T14:30:00Z");
  const base = { ...at("2026-11-06T09:30:00-05:00"), now };
  const raw = { shows: [{ kind: "onsale", savedId: "t1", at: "2026-11-06T15:00:00Z", text: "Tickets for Tems go on sale soon." }] };
  assert.ok(notify.dueNotifications({ ...base, raw }).some((x) => x.key === "onsale:t1"));
  assert.ok(!notify.dueNotifications({ ...base, raw, now: new Date("2026-11-06T13:30:00Z") }).some((x) => x.key === "onsale:t1"));
});
