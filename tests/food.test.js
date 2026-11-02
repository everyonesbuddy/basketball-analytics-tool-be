const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../config/os/food");
const food = require("../utils/os/food");

test("library: no bread, every meal has what it needs, keys are unique", () => {
  const keys = new Set();
  const aisles = new Set(F.AISLES.map((a) => a.key));
  for (const m of F.MEALS) {
    assert.ok(!keys.has(m.key), `duplicate ${m.key}`);
    keys.add(m.key);
    assert.ok(F.CUISINES.includes(m.cuisine), `${m.key} cuisine`);
    assert.ok(m.slots.length && m.mins > 0 && m.search, m.key);
    assert.ok(["none", "low"].includes(m.sugar), m.key);
    for (const [name, aisle] of m.ing) {
      assert.ok(aisles.has(aisle), `${m.key}: ${name} → ${aisle}`);
      assert.ok(!/\b(bread|bun|buns|pita|naan|bagel|toast)\b/i.test(name), `${m.key} has ${name}`);
    }
  }
  for (const c of F.CUISINES) assert.ok(F.MEALS.some((m) => m.cuisine === c), `no ${c} meals`);
  assert.ok(F.MEALS.filter((m) => m.slots.includes("breakfast")).length >= 10);
});

test("settings filter: tortillas off, no sugar at all, cuisines, dislikes", () => {
  assert.ok(food.library({ settings: { tortillas: false } }).every((m) => !m.tortilla));
  assert.ok(food.library({ settings: { sugar: "none" } }).every((m) => m.sugar === "none"));
  assert.ok(food.library({ settings: { cuisines: ["Nigerian"] } }).every((m) => m.cuisine === "Nigerian"));
  assert.ok(!food.library({ settings: { dislikes: ["pho"] } }).some((m) => m.key === "pho"));
});

test("today: three to cook and three to order per meal, varied, no meal twice, rotates away from yesterday", () => {
  const d = food.suggestDay({ date: "2026-11-02" });
  const all = [];
  for (const slot of ["breakfast", "lunch", "dinner"]) {
    for (const mode of ["cook", "order"]) {
      const list = d.slots[slot][mode];
      assert.equal(list.length, 3, `${slot} ${mode}`);
      assert.equal(new Set(list.map((m) => m.cuisine)).size, 3, `${slot} ${mode} varied`);
      assert.ok(list.every((m) => m.slots.includes(slot)));
      assert.ok(list.every((m) => (mode === "cook" ? m.mode !== "order" : m.mode !== "cook")));
      assert.ok(list.every((m) => m.orderUrl.startsWith("https://www.google.com/maps/search/")));
      all.push(...list.map((m) => m.key));
    }
  }
  assert.equal(new Set(all).size, all.length);
  const top = d.slots.dinner.cook[0].key;
  const next = food.suggestDay({ date: "2026-11-02", recent: [{ date: "2026-11-01", slot: "dinner", key: top, cuisine: "x" }] });
  assert.notEqual(next.slots.dinner.cook[0].key, top);
});

test("today: tonight's planned dinner and last night's leftovers", () => {
  const plan = { days: [{ date: "2026-11-02", key: "egusi", mode: "cook" }, { date: "2026-11-01", key: "jollof_chicken", mode: "cook" }] };
  const d = food.suggestDay({ date: "2026-11-02", plan });
  assert.equal(d.planned.key, "egusi");
  assert.equal(d.leftovers.key, "jollof_chicken");
});

test("week plan: cook nights and order nights, no repeats, no cuisine two nights running, weeknights quick", () => {
  const p = food.planWeek({ weekStart: "2026-11-02", settings: { cookNights: 5, weeknightMax: 45 } });
  assert.equal(p.days.length, 7);
  assert.deepEqual(p.days.filter((d) => d.mode === "order").map((d) => d.weekday).sort(), ["Fri", "Sat"]);
  assert.equal(new Set(p.days.map((d) => d.key)).size, 7);
  const meals = new Map(F.MEALS.map((m) => [m.key, m]));
  for (let i = 1; i < 7; i += 1) assert.notEqual(meals.get(p.days[i].key).cuisine, meals.get(p.days[i - 1].key).cuisine);
  for (const d of p.days.filter((x) => x.mode === "cook" && !["Sat", "Sun"].includes(x.weekday))) assert.ok(meals.get(d.key).mins <= 45, d.key);
});

test("grocery: cook nights only, merged by item, staples last, ticks kept", () => {
  const days = [
    { date: "2026-11-02", mode: "cook", key: "jollof_chicken" },
    { date: "2026-11-03", mode: "cook", key: "fried_rice_ng" },
    { date: "2026-11-06", mode: "order", key: "pho" },
  ];
  const g = food.groceryFor(days, { previous: [{ name: "thyme", bought: true }] });
  assert.ok(!g.some((x) => x.name === "beef bones"));
  const thyme = g.find((x) => x.name === "thyme");
  assert.equal(thyme.for.length, 2);
  assert.equal(thyme.bought, true);
  assert.equal(g.at(-1).staple, true);
  const plan = food.withLeftovers(days);
  assert.equal(plan[1].lunch, "Leftovers: Jollof rice with chicken");
});

test("shellfish allergy: the library is shellfish-free, and your own shellfish meals are filtered out", () => {
  assert.deepEqual(F.MEALS.filter(food.mealHasShellfish).map((m) => m.key), []);
  for (const m of F.MEALS) for (const [name] of m.ing) assert.ok(!/^(shrimp|crayfish|oyster sauce|prawns?)$/i.test(name), `${m.key}: ${name}`);
  assert.equal(food.hasShellfish("ground crayfish"), true);
  assert.equal(food.hasShellfish("Periwinkle"), true);
  assert.equal(food.hasShellfish("smoked fish powder (not crayfish)"), false);
  assert.equal(food.hasShellfish("salmon fillets"), false);
  assert.equal(food.hasShellfish("scallions"), false);
  const custom = [{ _id: "a1", name: "Seafood okra", ingredients: "okra, periwinkle, palm oil" }, { _id: "a2", name: "Mum's fish stew", ingredients: "tilapia, tomatoes, peppers" }];
  const keys = food.library({ custom }).map((m) => m.key);
  assert.ok(!keys.includes("c_a1"));
  assert.ok(keys.includes("c_a2"));
  assert.ok(food.library({ custom, settings: { noShellfish: false } }).some((m) => m.key === "c_a1"));
});
