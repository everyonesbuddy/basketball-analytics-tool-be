const test = require("node:test");
const assert = require("node:assert/strict");
const care = require("../utils/os/care");
const C = require("../config/os/care");
const G = require("../config/os/gifting");
const { dueNotifications } = require("../utils/os/notify");

const TODAY = "2026-11-21";
const daysAgo = (n) => new Date(Date.parse(`${TODAY}T12:00:00Z`) - n * 86400000);

test("care ideas: every idea is well formed", () => {
  const keys = new Set();
  for (const i of C.CARE_IDEAS) {
    assert.ok(!keys.has(i.key), `duplicate ${i.key}`);
    keys.add(i.key);
    assert.ok(["small", "big"].includes(i.size), i.key);
    assert.ok(C.KINDS[i.kind], `${i.key} kind`);
    assert.ok(i.price >= 0 && i.lead >= 0 && i.how, i.key);
  }
  for (const want of ["pedicure", "massage", "spin", "book_club"]) assert.ok(keys.has(want), want);
});

test("care: suggests her liked kinds first, leaves out dislikes, recent ones and recent skips", () => {
  const log = [
    { kind: "care", ideaKey: "massage", size: "big", status: "done", date: daysAgo(10) },
    { kind: "care", ideaKey: "facial", size: "big", status: "skipped", date: daysAgo(3) },
  ];
  const prefs = { likesKinds: ["active"], dislikes: ["pedicure"], budgetBig: 150 };
  const out = care.suggestCare({ prefs, log, today: TODAY, size: "big", count: 40 });
  const keys = out.map((i) => i.key);
  assert.ok(!keys.includes("pedicure"), "dislike left out");
  assert.ok(!keys.includes("massage"), "done 10 days ago, rests 60");
  assert.ok(!keys.includes("facial"), "skipped 3 days ago, rests 14");
  assert.equal(out[0].kind, "active", "liked kind first");
  assert.ok(out.every((i) => i.size === "big"));
  const spin = out.find((i) => i.key === "spin");
  assert.ok(spin.links.some((l) => l.url.includes("google.com/maps")), "has a find-nearby link");
});

test("care: same suggestions all day, different over days", () => {
  const a = care.suggestCare({ today: TODAY, size: "small", count: 3 }).map((i) => i.key);
  const b = care.suggestCare({ today: TODAY, size: "small", count: 3 }).map((i) => i.key);
  assert.deepEqual(a, b);
  const week = new Set();
  for (let d = 1; d <= 7; d++) week.add(care.suggestCare({ today: `2026-11-${String(20 + d).padStart(2, "0")}`, size: "small", count: 1 })[0].key);
  assert.ok(week.size > 1, "rotates over a week");
});

test("care: due weekly and monthly from the last one done; a plan holds it", () => {
  const empty = care.careDue({ today: TODAY });
  assert.equal(empty.small.due, true, "nothing done yet: due now");
  const log = [
    { kind: "care", ideaKey: "walk", size: "small", status: "done", date: daysAgo(3) },
    { kind: "care", ideaKey: "massage", size: "big", status: "done", date: daysAgo(35) },
  ];
  const d = care.careDue({ log, today: TODAY });
  assert.equal(d.small.due, false);
  assert.equal(d.small.nextOn, "2026-11-25");
  assert.equal(d.big.due, true);
  const planned = care.careDue({ log: [...log, { _id: "x", kind: "care", ideaKey: "spin", size: "big", title: "Book her a spin class", status: "planned", date: daysAgo(1), plannedFor: new Date("2026-11-23T15:00:00Z") }], today: TODAY });
  assert.equal(planned.big.due, false, "a plan coming up holds the reminder");
  assert.equal(planned.big.planned.on, "2026-11-23");
});

test("gift circle: longest since a gift goes first, never-gifted before that; spouse and skipped people wait", () => {
  const people = [
    { _id: "wife", name: "Ada", relationship: "wife", gifts: [] },
    { _id: "uncle", name: "Uncle Tunde", relationship: "uncle", tier: "thoughtful", gifts: [{ date: daysAgo(200) }] },
    { _id: "mum", name: "Mum", relationship: "mother", tier: "close", gifts: [{ date: daysAgo(20) }] },
    { _id: "gma", name: "Grandma", relationship: "grandmother", tier: "close", gifts: [] },
    { _id: "friend", name: "Seyi", relationship: "friend", tier: "casual", gifts: [] },
    { _id: "boss", name: "Boss", relationship: "colleague", inCircle: false, gifts: [] },
  ];
  const log = [{ kind: "circle", personId: "friend", status: "skipped", date: daysAgo(2) }];
  const c = care.circle({ people, log, today: TODAY, prefs: { spouseId: "wife", circleBudget: 50 } });
  const order = c.next.map((n) => n.personId);
  assert.equal(order[0], "gma", "never gifted first");
  assert.ok(!order.includes("wife") && !order.includes("boss"), "not the spouse; not someone taken out of the circle");
  assert.ok(order.indexOf("uncle") < order.indexOf("mum"), "200 days before 20 days");
  assert.equal(order.at(-1), "friend", "skipped recently goes to the back");
  assert.equal(c.due, true, "never done a circle gift: due");
  assert.ok(c.next[0].hamper.total <= 50, "hamper fits the budget");
  assert.equal(c.next[1].hamper.name, "Grooming and gadget", "uncle gets an uncle hamper");
});

test("gift circle: due again after the interval from the last circle gift", () => {
  const people = [{ _id: "mum", name: "Mum", relationship: "mother", gifts: [] }];
  const log = [{ kind: "circle", personId: "mum", status: "done", date: daysAgo(10) }];
  const c = care.circle({ people, log, today: TODAY, prefs: { circleEveryDays: 45 } });
  assert.equal(c.due, false);
  assert.equal(c.nextOn, "2026-12-26");
  assert.equal(c.next[0].last, "2026-11-11", "a done circle gift counts as their last gift");
});

test("new relationships work in the hamper builder (uncle, aunt, grandparents, cousin)", () => {
  for (const r of ["uncle", "aunt", "grandmother", "grandfather", "cousin"]) {
    assert.ok(G.RELATIONSHIPS.some((x) => x.key === r), r);
    assert.ok(G.HAMPER_FOR[r]?.length, r);
  }
  for (const r of C.CIRCLE_RELATIONSHIPS) assert.ok(G.RELATIONSHIPS.some((x) => x.key === r), `circle relationship ${r} exists in gifting`);
});

test("care reminders: suggestion when due, plan the day before and on the day, circle; and they notify at 9", () => {
  const prefs = { spouseName: "Ada" };
  const people = [{ _id: "uncle", name: "Uncle Tunde", relationship: "uncle", gifts: [] }];
  const rs = care.careReminders({ prefs, log: [], people, today: TODAY });
  assert.ok(rs.some((r) => r.kind === "care" && r.size === "big" && /Ada/.test(r.text)));
  assert.ok(rs.some((r) => r.kind === "care" && r.size === "small"));
  assert.ok(rs.some((r) => r.kind === "circle" && /Uncle Tunde/.test(r.text)));
  assert.ok(rs.every((r) => r.priority === 1));

  const tomorrow = care.careReminders({ prefs, log: [{ _id: "p", kind: "care", ideaKey: "spin", size: "big", title: "Spin class", status: "planned", date: daysAgo(2), plannedFor: new Date("2026-11-22T15:00:00Z") }], people: [], today: TODAY });
  assert.ok(tomorrow.some((r) => /Tomorrow for Ada: Spin class/.test(r.text)));

  const today = { date: TODAY, weekday: "Sat", dayType: "weekend", blocks: [], reviewDone: true };
  const sent = dueNotifications({ today, minutes: 9 * 60, raw: { gifts: rs }, settings: { gifts: true, brief: false, quietStart: "22:00", quietEnd: "07:00" }, window: 15 });
  assert.ok(sent.some((n) => n.title === "For her" && n.url === "/gifting/care"));
  assert.ok(sent.some((n) => n.title === "Gift circle" && n.url === "/gifting/circle"));
});
