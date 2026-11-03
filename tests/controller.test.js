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

test("rolling over starts a fresh window with the same goal", async () => {
  const g = { _id: gid, owner: user.id, category: "P1", title: "Six pack", status: "active", windowEnd: "2026-11-30", obstacle: { kind: "tiered" }, percent: 40, save: async () => {} };
  Goal.findOne = async () => g;
  let next;
  Goal.create = async (doc) => (next = doc);
  const r = res();
  await c.closeGoal({ user, params: { id: gid }, body: { outcome: "rollover" } }, r);
  assert.equal(g.status, "rolled");
  assert.equal(next.title, "Six pack");
  assert.equal(next.nextStep, undefined);
  assert.equal(next.percent, 40);
  assert.equal(r.body.startsIn, undefined);
});

test("check-in: moved it forward or cleared it (100%, undo puts the % back), with the block", async () => {
  const g = { _id: gid, percent: 10, obstacle: { kind: "tiered" }, save: async () => {} };
  Goal.findOne = async () => g;
  let made;
  GoalLog.create = async (doc) => (made = doc);
  await c.createLog({ user, body: { goal: gid, outcome: "progress", block: "08:30", nextStep: "ignored" } }, res());
  assert.equal(made.outcome, "progress");
  assert.equal(made.block, "08:30");
  assert.equal(g.percent, 10);
  assert.equal(g.nextStep, undefined, "check-ins are only moved forward or cleared");
  await c.createLog({ user, body: { goal: gid, outcome: "cleared" } }, res());
  assert.equal(made.outcome, "cleared");
  assert.equal(made.percentBefore, 10);
  assert.equal(g.percent, 100);
  for (const body of [{ goal: gid }, { goal: gid, outcome: "blocked" }, { goal: gid, mode: "m1" }]) {
    const r = res();
    await c.createLog({ user, body }, r);
    assert.equal(r.statusCode, 400);
  }
  // undo the cleared check-in
  let restored;
  GoalLog.findOneAndDelete = async () => ({ goal: gid, outcome: "cleared", percentBefore: 10 });
  Goal.updateOne = async (_q, u) => (restored = u);
  await c.deleteLog({ user, params: { id: "64b0000000000000000000bb" } }, res());
  assert.deepEqual(restored, { $set: { percent: 10 } });
});

test("notification button: a valid action token checks in; an expired or wrong one doesn't", async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-action-tokens";
  const jwt = require("jsonwebtoken");
  const pu = require("../controllers/push.controller");
  const { PushSent } = require("../models/pushModels");
  PushSent.create = async () => ({});
  const g = { _id: gid, percent: 0, toolReady: null, toolNeeded: "", obstacle: { kind: "single" }, save: async () => {} };
  Goal.findOne = async () => g;
  let made;
  GoalLog.create = async (doc) => (made = doc);
  const token = jwt.sign({ sub: user.id, g: gid, b: "08:30", d: "2026-11-02" }, process.env.JWT_SECRET, { audience: "personal-os-action", expiresIn: "18h" });
  const r = res();
  await pu.action({ body: { token, action: "progress" } }, r);
  assert.equal(r.statusCode, 201);
  assert.equal(made.outcome, "progress");
  assert.equal(made.block, "08:30");
  assert.equal(made.date, "2026-11-02");
  const bad = res();
  await pu.action({ body: { token: jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { audience: "personal-os" }), action: "progress" } }, bad);
  assert.equal(bad.statusCode, 401);
  const noRun = res();
  await pu.run({ headers: {}, query: { key: "nope" } }, noRun);
  assert.equal(noRun.statusCode, 401);
});
