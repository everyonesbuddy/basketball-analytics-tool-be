const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../utils/os/bets");
const P = require("../utils/os/props");

const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

const item = (athlete, type, line, dec) => ({ athlete: { $ref: `http://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2027/athletes/${athlete}?lang=en` }, type: { name: type }, current: { target: { value: line } }, odds: { decimal: { value: dec } } });

test("prop lines: the main line per player and stat; milestones, quarters and lone prices dropped", () => {
  const items = [
    // Points: an alternate pair at 26.5 (lopsided) and the main pair at 24.5.
    item(1, "Total Points", 26.5, 2.4), item(1, "Total Points", 26.5, 1.55),
    item(1, "Total Points", 24.5, 1.91), item(1, "Total Points", 24.5, 1.91),
    item(1, "Points Milestones", 25, 2.0),
    item(1, "1st Quarter Points", 6.5, 1.9), item(1, "1st Quarter Points", 6.5, 1.9),
    item(1, "Total Rebounds", 8.5, 1.87), // only one side: skipped
    item(2, "Total 3-Point Field Goals", 2.5, 1.8), item(2, "Total 3-Point Field Goals", 2.5, 2.0),
    item(2, "Total Points, Rebounds, and Assists", 30.5, 1.9), item(2, "Total Points, Rebounds, and Assists", 30.5, 1.9),
    item(2, "Total Assists", 7, 1.9), item(2, "Total Assists", 7, 1.9), // whole number: not a main line
  ];
  const got = P.parsePropBets(items, "nba").sort((a, b) => a.athleteId.localeCompare(b.athleteId) || a.stat.localeCompare(b.stat));
  assert.deepEqual(got, [
    { athleteId: "1", stat: "points", line: 24.5 },
    { athleteId: "2", stat: "pra", line: 30.5 },
    { athleteId: "2", stat: "threes", line: 2.5 },
  ]);
  assert.equal(P.propStat("nfl", "Total Receiving Yards"), "recYds");
  assert.equal(P.propStat("nfl", "Longest Reception"), null);
});

test("box scores: NBA stats by key, DNPs skipped; NFL groups merged", () => {
  const nba = {
    boxscore: {
      players: [
        {
          team: { id: "2" },
          statistics: [
            {
              keys: ["minutes", "points", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted", "rebounds", "assists"],
              athletes: [
                { athlete: { id: "1", displayName: "Jay Star" }, stats: ["36", "31", "11-20", "4-9", "8", "5"] },
                { athlete: { id: "3", displayName: "Bench Guy" }, didNotPlay: true, stats: [] },
              ],
            },
          ],
        },
      ],
    },
  };
  assert.deepEqual(P.boxScore(nba, "nba"), [{ athleteId: "1", name: "Jay Star", teamId: "2", stats: { points: 31, rebounds: 8, assists: 5, threes: 4, pra: 44 } }]);
  const nfl = {
    boxscore: {
      players: [
        {
          team: { id: "9" },
          statistics: [
            { name: "rushing", keys: ["rushingAttempts", "rushingYards"], athletes: [{ athlete: { id: "7", displayName: "Back" }, stats: ["18", "92"] }] },
            { name: "receiving", keys: ["receptions", "receivingYards"], athletes: [{ athlete: { id: "8", displayName: "Wideout" }, stats: ["6", "71"] }] },
          ],
        },
      ],
    },
  };
  const got = P.boxScore(nfl, "nfl");
  assert.deepEqual(got.find((p) => p.athleteId === "7").stats, { rushYds: 92, recYds: 0, receptions: 0 });
  assert.deepEqual(got.find((p) => p.athleteId === "8").stats, { recYds: 71, receptions: 6, rushYds: 0 });
});

test("the prop model: recent-weighted average, a floor on the spread, and the last-10 record", () => {
  const vals = [30, 28, 32, 29, 31, 22, 24, 23, 25, 21, 24, 22, 23, 25, 24, 40]; // newest first; the 16th is ignored
  const m = P.propModel(vals, 24.5);
  near(m.mean, 0.5 * 30 + 0.5 * (vals.slice(0, 15).reduce((a, b) => a + b, 0) / 15), 0.05);
  assert.ok(m.pOver > 0.6, "he's been well over lately");
  assert.equal(m.over10, 6); // 30, 28, 32, 29, 31 and 25
  assert.equal(m.of10, 10);
  assert.equal(P.propModel([10, 12, 11], 10.5), null, "fewer than 5 games: no call");
  // A steady player still gets a spread of at least sqrt(mean).
  assert.ok(P.propModel([5, 5, 5, 5, 5, 5], 4.5).sd >= Math.sqrt(5) - 1e-9);
});

test("prop ideas: edge against -110, the side his recent games agree with, and settling from the box score", () => {
  const game = { id: "g1", sport: "nba", date: "2026-11-24T00:00Z", home: { id: "2", abbr: "BOS" }, away: { id: "20", abbr: "PHI" } };
  const logs = P.logsFrom(
    Array.from({ length: 12 }, (_, i) => ({
      eventId: `e${i}`,
      date: `2026-11-${String(22 - i).padStart(2, "0")}`,
      players: [
        { athleteId: "1", name: "Jay Star", teamId: "2", stats: { points: 30 + (i % 3) } },
        { athleteId: "4", name: "Role Guy", teamId: "20", stats: { points: 10 + (i % 2) } },
      ],
    })),
  );
  const legs = P.analyzeProps(game, [{ athleteId: "1", stat: "points", line: 24.5 }, { athleteId: "4", stat: "points", line: 10.5 }], logs);
  assert.equal(legs.length, 4);
  const ideas = P.pickProps(legs);
  assert.equal(ideas.length, 1, "only the star's over has an edge; the coin-flip role player doesn't");
  const [i] = ideas;
  assert.equal(i.label, "Jay Star over 24.5 points");
  assert.equal(i.team, "BOS");
  assert.equal(i.recent.hits, 10);
  near(i.edge, i.prob - B.breakEven(-110));
  assert.equal(P.settleProp(i, [{ athleteId: "1", stats: { points: 27 } }]), "won");
  assert.equal(P.settleProp({ ...i, side: "under" }, [{ athleteId: "1", stats: { points: 27 } }]), "lost");
  assert.equal(P.settleProp(i, [{ athleteId: "9", stats: { points: 3 } }]), "push", "didn't play: void");
  assert.equal(P.settleProp(i, null), null);
});

test("shopping: worst price and worst line still worth it, NFL spreads stop at 3 and 7", () => {
  near(B.invNorm(0.975), 1.96, 1e-3);
  // BOS -5.5 at a 58.4% chance (NBA): -130 or better, fine to -6.5, skip at -7.
  assert.deepEqual(B.shopRange({ market: "spread", side: "home", line: -5.5, odds: -110, prob: 0.584, sport: "nba" }, 12.5), { worstOdds: -130, worstLine: -6.5 });
  // NFL -2.5 at 62%: the math would allow -4, but never past the key number 3.
  assert.equal(B.shopRange({ market: "spread", side: "home", line: -2.5, odds: -110, prob: 0.62, sport: "nfl" }, 13.5).worstLine, -3);
  // Over 220.5: a higher number is worse; under 44.5: a lower number is worse.
  assert.equal(B.shopRange({ market: "total", side: "over", line: 220.5, odds: -110, prob: 0.57, sport: "nba" }, 18).worstLine, 221.5);
  assert.equal(B.shopRange({ market: "total", side: "under", line: 44.5, odds: -110, prob: 0.57, sport: "nfl" }, 13).worstLine, 43.5);
  // Moneylines: price only, rounded to the safe side.
  assert.deepEqual(B.shopRange({ market: "moneyline", side: "away", line: null, odds: 160, prob: 0.42 }), { worstOdds: 150, worstLine: null });
  // An edge that only exists at a plus price: no room to move the line.
  assert.equal(B.shopRange({ market: "spread", side: "away", line: 3.5, odds: 105, prob: 0.51, sport: "nba" }, 12.5).worstLine, null);
});

test("GET /sports/props: DraftKings lines via ESPN against players' recent box scores", async () => {
  const espn = require("../services/espn/espnClient");
  const data = require("../services/os/sportsData");
  data._clearCache();
  const orig = espn.getJson;
  const teams = { 2: "BOS", 20: "PHI" };
  const ev = (id, date, state) => ({
    id,
    date,
    competitions: [{ status: { type: { state, completed: state === "post" } }, competitors: [{ homeAway: "home", team: { id: "2", abbreviation: "BOS" }, score: "110" }, { homeAway: "away", team: { id: "20", abbreviation: teams[20] }, score: "100" }], odds: [] }],
  });
  const past = Array.from({ length: 10 }, (_, i) => ev(`p${i}`, new Date(Date.now() - (i + 2) * 86400000).toISOString(), "post"));
  const upcoming = ev("t1", new Date(Date.now() + 3 * 3600000).toISOString(), "pre");
  const box = (i) => ({
    boxscore: {
      players: [
        { team: { id: "2" }, statistics: [{ keys: ["minutes", "points", "rebounds", "assists"], athletes: [{ athlete: { id: "1", displayName: "Jay Star" }, stats: ["35", String(29 + (i % 4)), "7", "6"] }] }] },
      ],
    },
  });
  const calls = [];
  espn.getJson = async (url, params) => {
    calls.push(url);
    if (url.endsWith("/propBets")) return { pageCount: 1, items: [item(1, "Total Points", 24.5, 1.91), item(1, "Total Points", 24.5, 1.91)] };
    if (url.endsWith("/summary")) return box(Number(params.event.slice(1)));
    const start = String(params?.dates || "").slice(0, 8);
    const todayYmd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return { events: start >= todayYmd ? [upcoming] : past };
  };
  const ctl = require("../controllers/sports.controller");
  let body;
  try {
    await ctl.props({ query: { sport: "nba" } }, { json: (b) => (body = b), status: () => ({ json: (b) => (body = b) }) });
  } finally {
    espn.getJson = orig;
    data._clearCache();
  }
  assert.equal(body.success, true, JSON.stringify(body));
  assert.ok(calls.some((u) => u.includes("/events/t1/competitions/t1/odds/100/propBets")), "asks for DraftKings' props");
  assert.equal(body.ideas.length, 1, JSON.stringify(body.ideas));
  const [i] = body.ideas;
  assert.equal(i.label, "Jay Star over 24.5 points");
  assert.ok(i.shop.worstLine >= 24.5 && i.shop.worstOdds < -110, JSON.stringify(i.shop));
});
