const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../utils/os/bets");

const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("odds: decimal, break-even, back to American, and removing the bookmaker's cut", () => {
  near(B.toDecimal(-110), 1.9091);
  near(B.toDecimal(150), 2.5);
  near(B.breakEven(-110), 0.5238);
  assert.equal(B.toAmerican(2.5), 150);
  assert.equal(B.toAmerican(1.5), -200);
  const [a, b] = B.fairPair(-110, -110);
  near(a, 0.5);
  near(b, 0.5);
  const [fav] = B.fairPair(-200, 170);
  near(fav, (2 / 3) / (2 / 3 + 100 / 270), 1e-6);
});

test("ratings recover known team strengths from a season of games", () => {
  // Four teams with true strengths; each pair plays home and away 10 times, scores exactly as expected.
  const strength = { A: 8, B: 2, C: -3, D: -7 };
  const games = [];
  const ids = Object.keys(strength);
  for (let r = 0; r < 10; r++)
    for (const h of ids)
      for (const a of ids) {
        if (h === a) continue;
        const margin = strength[h] - strength[a] + 2.3;
        games.push({ home: h, away: a, homeScore: 110 + margin / 2, awayScore: 110 - margin / 2 });
      }
  const rt = B.ratings(games, { homeEdge: 2.3 });
  const shrink = 60 / 64; // each team played 60 games
  for (const id of ids) near(rt.teams[id].rating, strength[id] * shrink, 1e-6);
  near(rt.league, 110);
  const p = B.project(rt, "A", "D", "nba");
  near(p.margin, 15 * shrink + 2.3, 1e-6);
});

test("ESPN lines: spread from the details text (home perspective), totals and moneylines", () => {
  const ev = {
    id: "401",
    date: "2026-11-24T00:30Z",
    competitions: [
      {
        status: { type: { state: "pre", completed: false, shortDetail: "7:30 PM" } },
        competitors: [
          { homeAway: "home", team: { id: "2", abbreviation: "BOS", shortDisplayName: "Celtics" }, score: "0", records: [{ summary: "12-4" }] },
          { homeAway: "away", team: { id: "20", abbreviation: "PHI", shortDisplayName: "76ers" }, score: "0" },
        ],
        odds: [{ provider: { name: "ESPN BET" }, details: "PHI -3.5", overUnder: 221.5, homeTeamOdds: { moneyLine: 140 }, awayTeamOdds: { moneyLine: -165, favorite: true } }],
      },
    ],
  };
  const g = B.parseEvent(ev, "nba");
  assert.equal(g.home.abbr, "BOS");
  assert.equal(g.lines.homeSpread, 3.5, "PHI -3.5 means the home team gets +3.5");
  assert.equal(g.lines.total, 221.5);
  assert.equal(g.lines.homeMl, 140);
  assert.equal(g.lines.homeSpreadOdds, -110, "-110 when the spread price isn't given");
  const withClose = JSON.parse(JSON.stringify(ev));
  withClose.competitions[0].odds[0].pointSpread = { home: { close: { line: "+4", odds: "-105" } }, away: { close: { line: "-4", odds: "-115" } } };
  const g2 = B.parseEvent(withClose, "nba");
  assert.equal(g2.lines.homeSpread, 4);
  assert.equal(g2.lines.homeSpreadOdds, -105);
});

test("a game's legs: cover, over and win probabilities, edge over the price, expected value", () => {
  const rt = { league: 112, teams: { H: { rating: 6, games: 20, ppg: 118, oppPpg: 110 }, A: { rating: -2, games: 20, ppg: 110, oppPpg: 114 } } };
  const game = { id: "g1", sport: "nba", state: "pre", date: "2026-11-24", home: { id: "H", abbr: "HOM" }, away: { id: "A", abbr: "AWY" }, lines: { homeSpread: -6.5, homeSpreadOdds: -110, awaySpreadOdds: -110, total: 222.5, overOdds: -110, underOdds: -110, homeMl: -260, awayMl: 210 } };
  const a = B.analyzeGame(game, rt);
  near(a.projection.margin, 10.3, 0.05);
  const home = a.legs.find((l) => l.market === "spread" && l.side === "home");
  near(home.modelProb, B.normCdf((10.3 - 6.5) / 12.5), 1e-3);
  near(home.prob, 0.5 * home.modelProb + 0.5 * 0.5, 1e-3);
  near(home.edge, home.prob - B.breakEven(-110), 1e-3);
  assert.equal(home.label, "HOM -6.5");
  const away = a.legs.find((l) => l.market === "spread" && l.side === "away");
  assert.equal(away.label, "AWY +6.5");
  near(home.modelProb + away.modelProb, 1);
  const ideas = B.pickIdeas([a]);
  assert.ok(ideas.every((l) => l.edge >= 0.025));
  assert.ok(ideas.some((l) => l.label === "HOM -6.5"), "the home cover is the spread idea");
  assert.ok(ideas.length <= 3, "one per market per game");
});

test("parlays: legs from different games with an edge, probability and payout multiplied", () => {
  const leg = (id, prob, odds) => ({ eventId: id, prob, odds, ev: prob * B.toDecimal(odds) - 1, label: id });
  const ideas = [leg("g1", 0.58, -110), leg("g1", 0.6, -110), leg("g2", 0.57, -110), leg("g3", 0.56, -105), leg("g4", 0.3, 300)];
  const ps = B.parlays(ideas);
  assert.ok(ps.length > 0);
  for (const p of ps) {
    assert.equal(new Set(p.legs.map((l) => l.eventId)).size, p.legs.length, "never two legs from one game");
    assert.ok(p.legs.every((l) => l.prob >= 0.45), "no long-shot legs");
    near(p.prob, p.legs.reduce((a, l) => a * l.prob, 1), 1e-3);
  }
  const two = ps.find((p) => p.legs.length === 2 && p.legs.some((l) => l.eventId === "g1") && p.legs.some((l) => l.eventId === "g2"));
  near(two.decimal, 1.9091 * 1.9091, 0.01);
  assert.equal(two.odds, 264);
});

test("futures: parse ESPN's markets and find value against the ratings", () => {
  const json = { items: [{ type: "winLeague", displayName: "NBA Championship", futures: [{ provider: { name: "ESPN BET" }, books: [{ team: { $ref: "http://x/teams/1?lang=en" }, value: "+300" }, { team: { $ref: "http://x/teams/2" }, value: "+400" }, { team: { $ref: "http://x/teams/3" }, value: "+5000" }] }] }] };
  const [m] = B.parseFutures(json);
  assert.equal(m.market, "winLeague");
  assert.deepEqual(m.entries.map((e) => e.teamId), ["1", "2", "3"]);
  const rt = { teams: { 1: { rating: 6 }, 2: { rating: 9 }, 3: { rating: -4 } } };
  const v = B.futuresValue(m, rt, "nba");
  assert.equal(v[0].teamId, "2", "the strongest team at the longer price is the value");
  near(v.reduce((a, x) => a + x.prob, 0), 1, 0.003);
});

test("settling legs and bets from final scores; the record", () => {
  const game = { completed: true, home: { score: 110 }, away: { score: 104 } };
  assert.equal(B.settleLeg({ market: "spread", side: "home", line: -5.5 }, game), "won");
  assert.equal(B.settleLeg({ market: "spread", side: "away", line: 5.5 }, game), "lost");
  assert.equal(B.settleLeg({ market: "spread", side: "home", line: -6 }, game), "push");
  assert.equal(B.settleLeg({ market: "total", side: "over", line: 213.5 }, game), "won");
  assert.equal(B.settleLeg({ market: "moneyline", side: "away" }, game), "lost");
  assert.equal(B.settleLeg({ market: "spread", side: "home", line: -5.5 }, { completed: false, home: {}, away: {} }), null);

  assert.deepEqual(B.settleBet({ stake: 10, legs: [{ odds: -110, result: "won" }] }), { status: "won", profit: 9.09 });
  assert.deepEqual(B.settleBet({ stake: 10, legs: [{ odds: -110, result: "won" }, { odds: -110, result: "push" }] }), { status: "won", profit: 9.09 }, "a pushed leg drops out of the parlay");
  assert.equal(B.settleBet({ stake: 10, legs: [{ odds: -110, result: "won" }, { odds: -110, result: "lost" }] }).status, "lost");
  assert.equal(B.settleBet({ stake: 10, legs: [{ odds: -110, result: "won" }, { odds: -110 }] }).status, "pending");

  const r = B.betRecord([
    { status: "won", stake: 10, profit: 9.09, legs: [{ market: "spread" }] },
    { status: "lost", stake: 10, profit: -10, legs: [{ market: "total" }] },
    { status: "won", stake: 5, profit: 13.2, legs: [{}, {}] },
    { status: "pending", stake: 5, legs: [{}] },
  ]);
  assert.equal(r.all.bets, 3);
  assert.equal(r.all.profit, 12.29);
  near(r.all.roi, 12.29 / 25);
  assert.equal(r.byKind.parlay.won, 1);
  assert.equal(r.byMarket.spread.won, 1);
  assert.equal(r.pending, 1);
});

test("season start: October for the NBA, September for the NFL", () => {
  assert.equal(B.seasonStart("nba", new Date("2026-11-23")).toISOString().slice(0, 10), "2026-10-01");
  assert.equal(B.seasonStart("nba", new Date("2027-03-01")).toISOString().slice(0, 10), "2026-10-01");
  assert.equal(B.seasonStart("nfl", new Date("2027-01-10")).toISOString().slice(0, 10), "2026-09-01");
});

test("board from ESPN data: ratings from last results, today's games analyzed, ideas and parlays", async () => {
  const espn = require("../services/espn/espnClient");
  const orig = espn.getJson;
  // Season so far: BOS beats everyone by a lot; today BOS hosts PHI as only a 3.5-point favorite.
  const teams = { 2: "BOS", 20: "PHI", 5: "CLE", 9: "GSW" };
  const ev = (id, date, h, a, hs, as, state = "post", odds) => ({
    id,
    date,
    competitions: [
      {
        status: { type: { state, completed: state === "post" } },
        competitors: [
          { homeAway: "home", team: { id: h, abbreviation: teams[h] }, score: String(hs) },
          { homeAway: "away", team: { id: a, abbreviation: teams[a] }, score: String(as) },
        ],
        odds: odds ? [odds] : [],
      },
    ],
  });
  const past = [];
  let n = 0;
  for (let w = 0; w < 6; w++)
    for (const [h, a, hs, as] of [["2", "20", 120, 104], ["2", "5", 118, 108], ["5", "20", 110, 108], ["9", "2", 104, 116], ["20", "9", 109, 111], ["9", "5", 112, 110]])
      past.push(ev(`p${n++}`, "2026-10-25T00:00Z", h, a, hs, as));
  const today = ev("t1", new Date().toISOString(), "2", "20", 0, 0, "pre", { details: "BOS -3.5", overUnder: 221.5, homeTeamOdds: { moneyLine: -170 }, awayTeamOdds: { moneyLine: 145 } });
  espn.getJson = async (url, params) => ({ events: /-/.test(params?.dates || "") && !String(params.dates).startsWith(new Date().toISOString().slice(0, 10).replace(/-/g, "")) ? past : [today] });
  const ctl = require("../controllers/sports.controller");
  let body;
  try {
    await ctl.board({ query: { sport: "nba" } }, { json: (b) => (body = b), status: () => ({ json: (b) => (body = b) }) });
  } finally {
    espn.getJson = orig;
  }
  assert.equal(body.success, true, JSON.stringify(body));
  assert.equal(body.ratings.table[0].id, "2", "Boston rates best");
  const g = body.games.find((x) => x.id === "t1");
  assert.ok(g.projection.margin > 3.5, "we project Boston by more than the line");
  assert.ok(body.ideas.some((l) => l.label === "BOS -3.5"), "so Boston -3.5 is an idea");
});

test("board: when ESPN refuses date ranges it asks day by day; when results fail it still shows games", async () => {
  const espn = require("../services/espn/espnClient");
  const orig = espn.getJson;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const ev = (id, state) => ({ id, date: new Date().toISOString(), competitions: [{ status: { type: { state, completed: state === "post" } }, competitors: [{ homeAway: "home", team: { id: "1", abbreviation: "AAA" }, score: "100" }, { homeAway: "away", team: { id: "2", abbreviation: "BBB" }, score: "90" }], odds: [{ details: "AAA -3", overUnder: 210 }] }] });
  const ctl = require("../controllers/sports.controller");
  require("../services/os/sportsData")._clearCache();
  const call = async () => {
    let body;
    let status = 200;
    await ctl.board({ query: { sport: "nfl" } }, { json: (b) => (body = b), status: (s) => ((status = s), { json: (b) => (body = b) }) });
    return { body, status };
  };
  try {
    // Ranges fail; single days work: past days have a final, today has a game to bet.
    espn.getJson = async (url, params) => {
      if (/teams$/.test(url)) return {};
      if (String(params.dates).includes("-")) throw new Error("ESPN request failed (400)");
      return { events: [params.dates === today ? ev(`t${params.dates}`, "pre") : ev(`p${params.dates}`, "post")] };
    };
    const a = await call();
    assert.equal(a.body.success, true, JSON.stringify(a.body));
    assert.ok(a.body.games.some((g) => g.state === "pre"), "today's game is there");
    assert.ok(a.body.ratings.teams >= 2, "ratings came from the day-by-day results");

    // Everything fails: a 502 with ESPN's own reason.
    require("../services/os/sportsData")._clearCache();
    espn.getJson = async () => {
      throw new Error("ESPN request error: getaddrinfo ENOTFOUND");
    };
    const b = await call();
    assert.equal(b.status, 502);
    assert.match(b.body.error.detail, /ENOTFOUND/);
  } finally {
    espn.getJson = orig;
  }
});
