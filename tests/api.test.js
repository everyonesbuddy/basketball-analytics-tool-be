const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-secret";
const app = require("../app");
const { requireAuth, signToken } = require("../middleware/auth");

const listen = (a) =>
  new Promise((resolve) => {
    const s = a.listen(0, () => resolve(s));
  });

test("the OS answers 503 when its database isn't connected; sports routes are untouched", async () => {
  const s = await listen(app);
  const base = `http://127.0.0.1:${s.address().port}`;
  const os = await fetch(`${base}/api/os/today`);
  assert.equal(os.status, 503);
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  s.close();
});

test("sign-in: no token → 401, wrong audience → 401, our token → through", async () => {
  const a = express();
  a.get("/x", requireAuth, (req, res) => res.json({ id: req.user.id }));
  const s = await listen(a);
  const url = `http://127.0.0.1:${s.address().port}/x`;
  assert.equal((await fetch(url)).status, 401);
  const other = jwt.sign({ sub: "u1" }, "test-secret", { audience: "something-else" });
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${other}` } })).status, 401);
  const ok = await fetch(url, { headers: { Authorization: `Bearer ${signToken({ _id: "u1", email: "a@b.c" })}` } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { id: "u1" });
  s.close();
});
