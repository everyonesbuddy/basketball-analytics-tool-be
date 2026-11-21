const test = require("node:test");
const assert = require("node:assert/strict");
const bass = require("../utils/os/bass");

test("bass: an attempt keeps the best score, stars and fastest 2-star tempo", () => {
  let r = bass.recordAttempt({ key: "spider" }, { score: 60, stars: 1, bpm: 60 });
  r = bass.recordAttempt(r, { score: 92, stars: 3, bpm: 70 });
  r = bass.recordAttempt(r, { score: 50, stars: 1, bpm: 90 });
  assert.deepEqual([r.best, r.stars, r.bestBpm, r.attempts], [92, 3, 70, 3]);
  r = bass.recordAttempt(r, { mode: "step" });
  assert.equal(r.stepDone, true);
  assert.equal(r.best, 92, "step mode doesn't change the score");
});

test("bass: minutes add up per day; streak counts back from today or yesterday", () => {
  let days = bass.addMinutes([], "2026-11-19", 10);
  days = bass.addMinutes(days, "2026-11-20", 5);
  days = bass.addMinutes(days, "2026-11-20", 7.5);
  assert.deepEqual(days, [{ date: "2026-11-19", minutes: 10 }, { date: "2026-11-20", minutes: 12.5 }]);
  assert.equal(bass.streak(days, "2026-11-21"), 2, "today not practiced yet: count from yesterday");
  assert.equal(bass.streak(bass.addMinutes(days, "2026-11-21", 3), "2026-11-21"), 3);
  assert.equal(bass.streak(days, "2026-11-23"), 0);
  assert.equal(bass.weekMinutes(days, "2026-11-21"), 23, "Mon Nov 16 to Sat Nov 21");
});
