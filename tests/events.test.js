const test = require("node:test");
const assert = require("node:assert/strict");
const tm = require("../utils/os/ticketmaster");

const raw = {
  id: "Z7r9jZ1A7",
  name: "Burna Boy: I Told Them Tour",
  url: "https://www.ticketmaster.com/event/Z7r9jZ1A7",
  images: [{ ratio: "3_2", width: 305, url: "small.jpg" }, { ratio: "16_9", width: 640, url: "wide640.jpg" }, { ratio: "16_9", width: 2048, url: "wide2048.jpg" }],
  dates: { start: { localDate: "2026-12-05", localTime: "20:00:00" }, status: { code: "onsale" } },
  sales: { public: { startDateTime: "2026-10-01T14:00:00Z" }, presales: [{ name: "Fan presale", startDateTime: "2026-09-28T14:00:00Z", endDateTime: "2026-09-30T03:00:00Z" }] },
  priceRanges: [{ min: 59.5, max: 250, currency: "USD" }],
  classifications: [{ segment: { name: "Music" }, genre: { name: "R&B" } }],
  _embedded: { venues: [{ name: "State Farm Arena", city: { name: "Atlanta" }, state: { stateCode: "GA" }, location: { latitude: "33.7573", longitude: "-84.3963" } }], attractions: [{ id: "K8vZ9171ob7" }] },
};

test("normalizes a Ticketmaster event: wide image, venue, price, on-sale, distance", () => {
  const e = tm.normalizeEvent(raw, { lat: 33.749, lon: -84.388 });
  assert.equal(e.image, "wide640.jpg");
  assert.equal(e.venue, "State Farm Arena");
  assert.equal(e.city, "Atlanta, GA");
  assert.equal(e.time, "20:00:00");
  assert.equal(e.priceMin, 59.5);
  assert.equal(e.genre, "R&B");
  assert.equal(e.distance, 1);
  assert.deepEqual(e.attractions, ["K8vZ9171ob7"]);
  assert.equal(tm.normalizeEvent({ id: "x", name: "TBA", dates: { start: { localDate: "2027-01-01", timeTBA: true } } }).time, null);
});

test("geohash and miles", () => {
  assert.equal(tm.geohash(57.64911, 10.40744, 11), "u4pruydqqvj");
  const nyc = { lat: 40.7128, lon: -74.006 };
  const atl = { lat: 33.749, lon: -84.388 };
  assert.ok(Math.abs(tm.miles(nyc, atl) - 748) < 10);
});

test("reminders: going in the next 3 days, and tickets going on sale soon", () => {
  const now = new Date("2026-11-01T15:00:00Z");
  const saved = [
    { _id: "a", name: "Hawks vs Celtics", date: "2026-11-03", venue: "State Farm Arena", status: "going" },
    { _id: "b", name: "Far show", date: "2026-11-20", status: "bought" },
    { _id: "c", name: "Tems", date: "2027-02-01", status: "interested", onsaleAt: "2026-11-02T15:00:00Z" },
    { _id: "d", name: "Old onsale", date: "2027-02-01", status: "interested", onsaleAt: "2026-10-01T15:00:00Z" },
  ];
  const r = tm.eventReminders({ saved, now });
  assert.equal(r.length, 2);
  assert.match(r[0].text, /Hawks vs Celtics is in 2 days at State Farm Arena\. Get tickets/);
  assert.match(r[1].text, /Tickets for Tems go on sale soon/);
});

test("without the key, Ticketmaster calls say what to add", async () => {
  const before = process.env.TICKETMASTER_API_KEY;
  delete process.env.TICKETMASTER_API_KEY;
  assert.equal(tm.configured(), false);
  await assert.rejects(() => tm.searchAttractions("burna"), (err) => err.statusCode === 503 && /TICKETMASTER_API_KEY/.test(err.message));
  if (before) process.env.TICKETMASTER_API_KEY = before;
});
