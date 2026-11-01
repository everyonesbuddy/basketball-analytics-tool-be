// Controller rules with the database stubbed out (no MongoDB needed).
const test = require("node:test");
const assert = require("node:assert/strict");
const Goal = require("../models/goalModel");
const GoalLog = require("../models/goalLogModel");
const c = require("../controllers/os.controller");

const chain = (v) => ({ lean: async () => v, sort: () => chain(v), limit: () => chain(v) });
const res = () => {
  const r = { statusCode: 200 };
  r.status = (s) => ((r.statusCode = s), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};
const user = { id: "64b000000000000000000001" };
const gid = "64b0000000000000000000aa";

test("one active goal per category", async () => {
  Goal.findOne = () => chain({ title: "Six pack" });
  const r = res();
  await c.createGoal({ user, body: { category: "P1", title: "Run a 5k" } }, r);
  assert.equal(r.statusCode, 409);
  assert.match(r.body.error.message, /Six pack/);
});

test("new goal gets its category's window", async () => {
  Goal.findOne = () => chain(null);
  let made;
  Goal.create = async (doc) => (made = doc);
  const r = res();
  await c.createGoal({ user, body: { category: "PF2", title: "Call 200 prospects", windowStart: "2026-07-01", obstacle: { kind: "tiered", bounded: false } } }, r);
  assert.equal(r.statusCode, 201);
  assert.equal(made.windowEnd, "2026-09-30");
  assert.equal(made.obstacle.kind, "tiered");
  assert.equal(made.obstacle.bounded, false);
});

test("logging a tiered session adds its %; Mode 1 remembers what's missing; getting it unlocks the goal", async () => {
  const g = { _id: gid, percent: 10, toolReady: null, toolNeeded: "", obstacle: { kind: "single" }, save: async () => {} };
  Goal.findOne = async () => g;
  GoalLog.create = async (doc) => doc;
  const r = res();
  await c.createLog({ user, body: { goal: gid, mode: "m2tiered", percentGained: 4.5 } }, r);
  assert.equal(r.statusCode, 201);
  assert.equal(g.percent, 14.5);
  assert.equal(g.obstacle.kind, "tiered");
  assert.equal(g.toolReady, true);
  await c.createLog({ user, body: { goal: gid, mode: "m1", missing: "a script" } }, res());
  assert.equal(g.toolReady, false);
  assert.equal(g.toolNeeded, "a script");
  await c.createLog({ user, body: { goal: gid, mode: "m1", toolAcquired: true } }, res());
  assert.equal(g.toolReady, true);
  assert.equal(g.toolNeeded, "");
});

test("rolling over after a ceiling starts the next window in Mode 1", async () => {
  const g = { _id: gid, owner: user.id, category: "P1", title: "Six pack", status: "active", windowEnd: "2026-11-30", obstacle: { kind: "tiered" }, toolReady: true, percent: 40, save: async () => {} };
  Goal.findOne = async () => g;
  const flat = [4, 4, 4, 0, 0, 0].map((p, i) => ({ mode: "m2tiered", date: `2026-11-0${i + 1}`, percentGained: p }));
  GoalLog.find = () => chain(flat);
  let next;
  Goal.create = async (doc) => (next = doc);
  const r = res();
  await c.closeGoal({ user, params: { id: gid }, body: { outcome: "rollover" } }, r);
  assert.equal(g.status, "rolled");
  assert.equal(next.toolReady, false);
  assert.equal(r.body.startsIn, "m1");
  assert.equal(next.percent, 40);
});

test("one-tap log: the outcome sets the mode, the block and the next step", async () => {
  const g = { _id: gid, percent: 10, toolReady: null, toolNeeded: "", nextStep: "old", obstacle: { kind: "tiered" }, save: async () => {} };
  Goal.findOne = async () => g;
  let made;
  GoalLog.create = async (doc) => (made = doc);
  await c.createLog({ user, body: { goal: gid, outcome: "progress", block: "08:30", percentGained: 5, nextStep: "Call the next 20" } }, res());
  assert.equal(made.mode, "m2tiered");
  assert.equal(made.block, "08:30");
  assert.equal(g.percent, 15);
  assert.equal(g.nextStep, "Call the next 20");
  await c.createLog({ user, body: { goal: gid, outcome: "blocked", missing: "a lead list" } }, res());
  assert.equal(made.mode, "m1");
  assert.equal(g.toolNeeded, "a lead list");
  await c.createLog({ user, body: { goal: gid, outcome: "cleared" } }, res());
  assert.equal(made.mode, "m2single");
  assert.equal(made.cleared, true);
  const r = res();
  await c.createLog({ user, body: { goal: gid } }, r);
  assert.equal(r.statusCode, 400);
});
