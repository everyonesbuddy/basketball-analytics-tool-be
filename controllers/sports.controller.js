/**
 * Sports bets: today's games with our projection, the best ideas (spreads,
 * totals, moneylines), parlays and futures from ESPN's lines; and a tracker
 * for the bets you place, settled from final scores. Ideas only: the app
 * never places bets.
 */
const mongoose = require("mongoose");
const SportsBet = require("../models/sportsBetModel");
const B = require("../utils/os/bets");
const P = require("../utils/os/props");
const data = require("../services/os/sportsData");
const plan = require("../utils/os/plan");

const fail = (res, status, message) => res.status(status).json({ success: false, error: { message } });
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const sportOf = (v) => (B.SPORTS[v] ? v : "nba");
const DISCLAIMER = "Ideas from a simple model blended with the betting market, not a sure thing. Bet only what you're fine losing.";
const easternDate = (iso) => plan.localParts(new Date(iso)).date;

/** GET /sports/board?sport=nba|nfl: games, our projection and lines, the best ideas and parlays. */
exports.board = async (req, res) => {
  const sport = sportOf(req.query.sport);
  // Show what we can: games without projections if the season's results fail, or ratings without games.
  const [r1, r2] = await Promise.allSettled([data.seasonRatings(sport), data.upcoming(sport)]);
  if (r1.status === "rejected" && r2.status === "rejected") {
    return res.status(502).json({ success: false, error: { message: `Couldn't reach ESPN for ${B.SPORTS[sport].name} games right now.`, detail: String(r2.reason?.message || r1.reason?.message || "") } });
  }
  const rt = r1.status === "fulfilled" ? r1.value : { league: 0, teams: {} };
  const games = r2.status === "fulfilled" ? r2.value : [];
  const problems = [r1.status === "rejected" && `Season results didn't load (${r1.reason?.message}), so there are no projections yet.`, r2.status === "rejected" && `Upcoming games didn't load (${r2.reason?.message}).`].filter(Boolean);
  const names = await data.teams(sport).catch(() => ({}));
  const analyzed = games.map((g) => B.analyzeGame(g, rt));
  const ideas = B.pickIdeas(analyzed);
  const teamCount = Object.keys(rt.teams).length;
  const top = Object.entries(rt.teams)
    .sort((a, b) => b[1].rating - a[1].rating)
    .map(([id, t]) => ({ id, abbr: names[id]?.abbr || "", name: names[id]?.name || "", ...t, rating: Math.round(t.rating * 10) / 10 }));
  res.json({
    success: true,
    sport,
    name: B.SPORTS[sport].name,
    games: analyzed.map((g) => ({ ...g, date: g.date, day: easternDate(g.date) })),
    ideas: ideas.map((l) => ({ ...l, day: easternDate(l.date) })),
    parlays: B.parlays(ideas),
    ratings: { teams: teamCount, league: Math.round(rt.league * 10) / 10, table: top },
    problems,
    disclaimer: DISCLAIMER,
  });
};

/**
 * GET /sports/props?sport=: player prop ideas for games that haven't
 * started (NBA: today and tomorrow; NFL: the week), DraftKings' main lines
 * against each player's recent games.
 */
exports.props = async (req, res) => {
  const sport = sportOf(req.query.sport);
  let games;
  try {
    games = (await data.upcoming(sport)).filter((g) => g.state === "pre");
  } catch (err) {
    return res.status(502).json({ success: false, error: { message: `Couldn't reach ESPN for ${B.SPORTS[sport].name} games right now.`, detail: String(err.message || "") } });
  }
  games = games.sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, sport === "nfl" ? 16 : 12);
  const lines = await Promise.allSettled(games.map((g) => data.propLines(sport, g.id)));
  const withLines = games.map((g, i) => ({ g, lines: lines[i].status === "fulfilled" ? lines[i].value : [] })).filter((x) => x.lines.length);
  const problems = [];
  const failed = lines.filter((r) => r.status === "rejected").length;
  if (failed) problems.push(`Prop lines didn't load for ${failed} game${failed === 1 ? "" : "s"} (${lines.find((r) => r.status === "rejected").reason?.message}).`);
  let logs = new Map();
  if (withLines.length) {
    try {
      logs = await data.playerLogs(sport, [...new Set(withLines.flatMap(({ g }) => [g.home.id, g.away.id]))]);
    } catch (err) {
      problems.push(`Players' recent games didn't load (${err.message}).`);
    }
  }
  const legs = withLines.flatMap(({ g, lines: l }) => P.analyzeProps(g, l, logs));
  const ideas = P.pickProps(legs).map((l) => ({ ...l, day: easternDate(l.date), shop: B.shopRange(l, l.sd, { keep: 0.03 }) })); // props: a rougher model, so a bigger cushion
  res.json({
    success: true,
    sport,
    stats: P.STATS[sport],
    games: games.map((g) => ({ id: g.id, name: g.name, date: g.date, day: easternDate(g.date), props: withLines.find((x) => x.g.id === g.id)?.lines.length || 0 })),
    lines: legs.length / 2,
    ideas,
    problems,
    note: "Lines are DraftKings' main lines via ESPN, priced as -110; your book may differ. The model is each player's last 15 games (the last 5 count double), blended half and half with the line. It doesn't know injuries, minutes limits or matchups.",
  });
};

/** GET /sports/futures?sport=: each futures market with the best value first, team names attached. */
exports.futures = async (req, res) => {
  const sport = sportOf(req.query.sport);
  let markets;
  let rt;
  let names;
  try {
    [markets, rt, names] = await Promise.all([data.futures(sport), data.seasonRatings(sport), data.teams(sport)]);
  } catch {
    return fail(res, 502, "Couldn't load futures from ESPN right now.");
  }
  const wanted = markets.filter((m) => /league|conference|champ|super/i.test(`${m.market} ${m.name}`)).slice(0, 4);
  res.json({
    success: true,
    sport,
    markets: wanted.map((m) => ({ market: m.market, name: m.name, provider: m.provider, teams: B.futuresValue(m, rt, sport).map((t) => ({ ...t, ...(names[t.teamId] || { abbr: t.teamId, name: t.teamId }) })) })),
    note: "Rough: title chances from team ratings only (no injuries, schedule or bracket), blended with the market.",
  });
};

/** Settle pending bets whose games are final. */
async function settlePending(owner) {
  const pending = await SportsBet.find({ owner, status: "pending", kind: { $ne: "future" } });
  if (!pending.length) return 0;
  const today = plan.localParts().date;
  const need = {};
  for (const b of pending) for (const l of b.legs) if (l.result === "pending" && l.date && l.date <= today && l.eventId) (need[l.sport] ||= []).push(l.date);
  const finals = {};
  for (const [sport, dates] of Object.entries(need)) Object.assign(finals, await data.finalsFor(sport, dates).catch(() => ({})));
  // Props settle from the box score once the game is final.
  const boxes = {};
  for (const b of pending)
    for (const l of b.legs)
      if (l.result === "pending" && l.market === "prop" && finals[l.eventId]?.completed && !(l.eventId in boxes)) boxes[l.eventId] = await data.boxScore(l.sport, l.eventId).catch(() => null);
  let settled = 0;
  for (const b of pending) {
    let changed = false;
    for (const l of b.legs) {
      if (l.result !== "pending") continue;
      const r = l.market === "prop" ? (finals[l.eventId]?.completed ? P.settleProp(l, boxes[l.eventId]) : null) : B.settleLeg(l, finals[l.eventId]);
      if (r) {
        l.result = r;
        changed = true;
      }
    }
    if (!changed) continue;
    const s = B.settleBet(b.toObject());
    b.status = s.status;
    b.profit = s.profit;
    if (s.status !== "pending") {
      b.settledAt = new Date();
      settled += 1;
    }
    await b.save();
  }
  return settled;
}

/** GET /sports/bets: your bets (pending ones settled first, when their games are final) and the record. */
exports.bets = async (req, res) => {
  await settlePending(req.user.id).catch(() => 0);
  const bets = await SportsBet.find({ owner: req.user.id }).sort({ placedAt: -1 }).limit(300).lean();
  const weekAgo = Date.now() - 7 * 86400000;
  res.json({ success: true, bets, record: B.betRecord(bets), stakedThisWeek: bets.filter((b) => new Date(b.placedAt) >= weekAgo).reduce((a, b) => a + b.stake, 0), disclaimer: DISCLAIMER });
};

/**
 * POST /sports/bets: track a bet you placed.
 * { kind: "straight"|"parlay"|"future", stake, legs: [{ eventId, sport, date, matchup, market, side, line, odds, label }], fromIdea?, note? }
 */
exports.addBet = async (req, res) => {
  const b = req.body || {};
  const kind = ["straight", "parlay", "future"].includes(b.kind) ? b.kind : null;
  if (!kind) return fail(res, 400, "Is it a straight bet, a parlay or a future?");
  const stake = Number(b.stake);
  if (!(stake > 0)) return fail(res, 400, "How much did you bet?");
  const legs = (Array.isArray(b.legs) ? b.legs : []).slice(0, 12).map((l) => ({
    eventId: String(l.eventId || "").slice(0, 30),
    sport: sportOf(l.sport),
    date: /^\d{4}-\d{2}-\d{2}$/.test(l.date || "") ? l.date : l.date ? easternDate(l.date) : "",
    matchup: String(l.matchup || "").slice(0, 60),
    market: ["spread", "total", "moneyline", "prop", "future"].includes(l.market) ? l.market : kind === "future" ? "future" : "moneyline",
    stat: l.market === "prop" ? String(l.stat || "").slice(0, 20) : "",
    athleteId: l.market === "prop" ? String(l.athleteId || "").slice(0, 20) : "",
    side: String(l.side || "").slice(0, 20),
    line: Number.isFinite(Number(l.line)) && l.line !== null && l.line !== "" ? Number(l.line) : null,
    odds: Number(l.odds),
    label: String(l.label || "").trim().slice(0, 120),
  }));
  if (!legs.length || legs.some((l) => !l.odds || !l.label)) return fail(res, 400, "Each pick needs a label and odds.");
  if (kind === "straight" && legs.length !== 1) return fail(res, 400, "A straight bet has one pick.");
  if (kind === "parlay" && legs.length < 2) return fail(res, 400, "A parlay needs two or more picks.");
  if (legs.some((l) => l.market === "prop" && (!l.stat || !l.athleteId || l.line === null))) return fail(res, 400, "A prop needs the player, the stat and the line.");
  const decimal = legs.reduce((d, l) => d * B.toDecimal(l.odds), 1);
  const bet = await SportsBet.create({ owner: req.user.id, kind, legs, stake, odds: B.toAmerican(decimal), fromIdea: Boolean(b.fromIdea), note: String(b.note || "").slice(0, 500) });
  res.status(201).json({ success: true, bet });
};

/** PATCH /sports/bets/:id { result?: "won"|"lost"|"push" (settle by hand: futures, or a game ESPN missed), note? } */
exports.updateBet = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  const bet = await SportsBet.findOne({ _id: req.params.id, owner: req.user.id });
  if (!bet) return fail(res, 404, "Not found");
  const b = req.body || {};
  if (b.result) {
    if (!["won", "lost", "push", "pending"].includes(b.result)) return fail(res, 400, "Won, lost or push?");
    for (const l of bet.legs) if (b.result === "pending" || l.result === "pending" || bet.legs.length === 1) l.result = b.result;
    const s = B.settleBet(bet.toObject());
    bet.status = s.status;
    bet.profit = s.profit;
    bet.settledAt = s.status === "pending" ? null : new Date();
  }
  if (b.note !== undefined) bet.note = String(b.note).slice(0, 500);
  await bet.save();
  res.json({ success: true, bet });
};

/** DELETE /sports/bets/:id */
exports.deleteBet = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found");
  await SportsBet.deleteOne({ _id: req.params.id, owner: req.user.id });
  res.json({ success: true });
};

exports._settlePending = settlePending;
