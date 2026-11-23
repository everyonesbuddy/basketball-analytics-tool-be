/**
 * Sports bets: today's games with our projection, the best ideas (spreads,
 * totals, moneylines), parlays and futures from ESPN's lines; and a tracker
 * for the bets you place, settled from final scores. Ideas only: the app
 * never places bets.
 */
const mongoose = require("mongoose");
const SportsBet = require("../models/sportsBetModel");
const B = require("../utils/os/bets");
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
  let rt;
  let games;
  try {
    [rt, games] = await Promise.all([data.seasonRatings(sport), data.upcoming(sport)]);
  } catch (err) {
    return fail(res, 502, `Couldn't reach ESPN for ${B.SPORTS[sport].name} games right now.`);
  }
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
    disclaimer: DISCLAIMER,
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
  let settled = 0;
  for (const b of pending) {
    let changed = false;
    for (const l of b.legs) {
      if (l.result !== "pending") continue;
      const r = B.settleLeg(l, finals[l.eventId]);
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
    market: ["spread", "total", "moneyline", "future"].includes(l.market) ? l.market : kind === "future" ? "future" : "moneyline",
    side: String(l.side || "").slice(0, 20),
    line: Number.isFinite(Number(l.line)) && l.line !== null && l.line !== "" ? Number(l.line) : null,
    odds: Number(l.odds),
    label: String(l.label || "").trim().slice(0, 120),
  }));
  if (!legs.length || legs.some((l) => !l.odds || !l.label)) return fail(res, 400, "Each pick needs a label and odds.");
  if (kind === "straight" && legs.length !== 1) return fail(res, 400, "A straight bet has one pick.");
  if (kind === "parlay" && legs.length < 2) return fail(res, 400, "A parlay needs two or more picks.");
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
