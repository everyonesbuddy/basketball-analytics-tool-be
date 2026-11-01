const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../utils/os/gifting");
const G = require("../config/os/gifting");
const { parsePreview, assertPublic, isPrivate } = require("../utils/os/linkPreview");

test("catalog and packages are consistent", () => {
  for (const [k, p] of Object.entries(G.PACKAGES)) {
    for (const s of p.slots) for (const item of s.item ? [s.item] : Object.values(s.split)) assert.ok(G.ITEMS[item], `${k} → ${item}`);
  }
  for (const [rel, keys] of Object.entries(G.HAMPER_FOR)) for (const k of keys) assert.ok(G.HAMPERS[k], `${rel} → ${k}`);
  for (const r of G.RELATIONSHIPS) assert.ok(G.HAMPER_FOR[r.key], r.key);
});

test("group plan: 30 people on $150 fits the budget, everyone gets a package, multipacks are counted by the pack", () => {
  const p = g.planGroup({ budget: 150, counts: { child: 12, young: 5, adult: 8, elder: 3 }, special: 2, suitcases: 1 });
  assert.equal(p.people, 30);
  assert.equal(p.packages.reduce((s, x) => s + x.count, 0), 30);
  assert.ok(p.totals.total <= 150, `total ${p.totals.total}`);
  assert.equal(p.over, false);
  const socks = p.shopping.find((s) => s.key === "socks_adult_12");
  assert.equal(socks.packs, Math.ceil(socks.qty / 12));
  assert.equal(socks.cost, Math.round(socks.packs * 9.84 * 100) / 100);
  assert.ok(p.weight.fits);
  assert.ok(p.cautions.some((c) => /Nigeria Customs/.test(c)));
});

test("group plan: a generous budget keeps the full packages; an impossible one says it's over", () => {
  const rich = g.planGroup({ budget: 1000, counts: { adult: 10, child: 5 }, special: 3 });
  assert.deepEqual(rich.steps, []);
  assert.equal(rich.packages.find((x) => x.group === "adult").name, "Clothing package");
  const poor = g.planGroup({ budget: 20, counts: { adult: 40 } });
  assert.equal(poor.over, true);
  assert.ok(poor.totals.left < 0);
  assert.equal(g.planGroup({ budget: 50, counts: {} }).people, 0);
});

test("hamper: picks by relationship and stays within budget", () => {
  const h = g.planHamper({ relationship: "mother_in_law", budget: 60, likes: "gospel music" });
  assert.equal(h.best.name, "Comfort and care");
  assert.ok(h.best.total <= 60);
  assert.ok(h.best.items.length >= 3);
  assert.ok(h.alternatives.some((a) => a.name === "Self-care evening"));
  assert.match(h.tips[0], /gospel music/);
  assert.equal(g.planHamper({ relationship: "father", budget: 80 }).best.name, "Grooming and gadget");
  assert.equal(g.planHamper({ relationship: "wife", budget: 15 }).best.items.length < 2, true);
});

test("reminders: dates coming up, close people not gifted lately, shopping and packing due, and the weekly nudge", () => {
  const today = "2026-11-01";
  const people = [
    { _id: "a", name: "Mum", tier: "close", birthday: "11-05", gifts: [{ date: "2026-03-01" }] },
    { _id: "b", name: "Tobi", tier: "thoughtful", dates: [{ label: "wedding anniversary", md: "12-30" }], gifts: [] },
    { _id: "c", name: "Ada", tier: "casual", gifts: [] },
  ];
  const plans = [{ _id: "p1", title: "December in Nigeria", status: "planning", date: "2026-12-10", checklist: [{ bought: true }, { bought: false }] }];
  const r = g.reminders({ people, plans, today });
  assert.ok(r.find((x) => x.kind === "date" && /Mum's birthday is in 4 days/.test(x.text)));
  assert.ok(r.find((x) => x.kind === "overdue" && /Mum/.test(x.text)));
  assert.ok(r.find((x) => x.kind === "shop" && /39 days to go, 1 of 2 bought/.test(x.text)));
  const nudge = r.find((x) => x.kind === "nudge");
  assert.match(nudge.text, /Tobi or Mum|Mum or Tobi|Tobi/);
  assert.ok(!/Ada/.test(nudge.text), "casual people aren't nudged");
  assert.equal(g.daysUntil("01-02", "2026-12-31"), 2);
  assert.equal(g.daysUntil("02-29", "2026-03-01"), 364); // Feb 28, 2027
  assert.equal(g.daysUntil("13-01", "2026-03-01"), null);
});

test("link preview: reads Open Graph title, image and price; blocks private addresses", async () => {
  const html = `<html><head><title>Fallback</title><meta property="og:title" content="Hanes Men&#39;s Socks, 12-Pack"><meta property="og:image" content="/img/socks.jpg"><meta property="product:price:amount" content="9.84"><meta property="og:site_name" content="Walmart.com"></head></html>`;
  const p = parsePreview(html, "https://www.walmart.com/ip/123");
  assert.equal(p.title, "Hanes Men's Socks, 12-Pack");
  assert.equal(p.image, "https://www.walmart.com/img/socks.jpg");
  assert.equal(p.price, 9.84);
  assert.equal(p.site, "Walmart.com");
  assert.equal(parsePreview(`<title>Just a title</title><script>{"price": "19.88"}</script>`, "https://shop.example.com/x").price, 19.88);
  assert.ok(isPrivate("10.0.0.5") && isPrivate("127.0.0.1") && isPrivate("192.168.1.2") && isPrivate("::1") && !isPrivate("8.8.8.8"));
  await assert.rejects(assertPublic("http://localhost:5000/api"), /isn't allowed/);
  await assert.rejects(assertPublic("http://169.254.169.254/latest"), /isn't allowed/);
  await assert.rejects(assertPublic("file:///etc/passwd"), /Only http/);
});
