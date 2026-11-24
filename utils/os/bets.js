/**
 * Bet ideas from data, as plain functions (tested without the network).
 *
 *  - ratings: each team's strength from every game this season (a Simple
 *    Rating System: average margin adjusted for opponents and home court),
 *    plus points scored and allowed for totals
 *  - lines: ESPN's spread, total and moneylines for each game
 *  - ideas: our probability for each side, blended half and half with the
 *    market's (markets are sharp; this keeps us humble), the edge over the
 *    price, and the expected value
 *  - parlays: 2–3 legs from different games, only when each leg has an edge
 *  - futures: title odds against a rough model from the ratings
 *  - shopping: since you bet at your own book, not at ESPN's number, each
 *    pick says the worst line and the worst price it's still worth taking
 *  - settling: spread, total and moneyline results from the final score
 */

const SPORTS = {
  nba: { name: "NBA", path: "basketball/nba", homeEdge: 2.3, marginSd: 12.5, totalSd: 18, seasonStartMonth: 9, minGames: 5 },
  nfl: { name: "NFL", path: "football/nfl", homeEdge: 1.5, marginSd: 13.5, totalSd: 13, seasonStartMonth: 8, minGames: 3 },
};

const round = (n, d = 3) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

/** Standard normal CDF. */
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/** American odds → decimal payout (stake included) and break-even probability. */
const toDecimal = (american) => {
  const a = Number(american);
  if (!a) return null;
  return a > 0 ? 1 + a / 100 : 1 + 100 / -a;
};
const breakEven = (american) => {
  const d = toDecimal(american);
  return d ? 1 / d : null;
};
const toAmerican = (decimal) => (decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1)));

/** Two sides' prices → their probabilities with the bookmaker's cut taken out. */
function fairPair(a, b) {
  const pa = breakEven(a);
  const pb = breakEven(b);
  if (!pa || !pb) return null;
  return [pa / (pa + pb), pb / (pa + pb)];
}

/** Inverse of normCdf (by bisection; plenty precise for odds). */
function invNorm(p) {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity;
  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (normCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const KEY_NUMBERS = [-7, -3, 3, 7]; // NFL margins that land most often

/**
 * How far you can shop a pick and still have it worth taking: `keep` is the
 * smallest edge still worth a bet. Returns
 *  - worstOdds: at this line, the worst price to take (rounded to a nickel, the safe way)
 *  - worstLine: at -110, the worst line to take (half points, props whole points, up to 6 steps;
 *    NFL spreads never past 3 or 7), or null for moneylines
 * The chance at another line comes from the same blended view: the line
 * that makes it 50/50 stays put, and the spread (sd) is the model's.
 */
function shopRange(leg, sd, { keep = 0.015, sport = leg.sport } = {}) {
  if (!leg.prob || !leg.odds) return null;
  const maxBe = leg.prob - keep;
  let worstOdds = null;
  if (maxBe > 0.05 && maxBe < 0.97) {
    const a = toAmerican(1 / maxBe);
    worstOdds = Math.ceil(a / 5) * 5; // -127 → -125, +113 → +115: never looser than the math
    if (worstOdds > -100 && worstOdds < 100) worstOdds = worstOdds >= 0 ? 100 : -100;
  }
  if (leg.market === "moneyline" || leg.line === null || leg.line === undefined || !sd) return { worstOdds, worstLine: null };
  const be = breakEven(-110);
  // chance at line L, with c the 50/50 point implied by our chance at the posted line
  let chance;
  let step;
  if (leg.market === "spread") {
    const c = sd * invNorm(leg.prob) - leg.line;
    chance = (L) => normCdf((c + L) / sd);
    step = -0.5; // fewer points is worse
  } else if (leg.side === "over") {
    const c = leg.line + sd * invNorm(leg.prob);
    chance = (L) => normCdf((c - L) / sd);
    step = 0.5; // a higher number is worse for an over
  } else {
    const c = leg.line - sd * invNorm(leg.prob);
    chance = (L) => normCdf((L - c) / sd);
    step = -0.5;
  }
  if (chance(leg.line) - be < keep) return { worstOdds, worstLine: null }; // only works at this price
  if (leg.market === "prop") step *= 2; // prop lines move in whole points (24.5 → 25.5)
  let L = leg.line;
  for (let i = 0; i < 6; i++) {
    if (sport === "nfl" && leg.market === "spread" && KEY_NUMBERS.includes(L)) break;
    const next = L + step;
    if (chance(next) - be < keep) break;
    L = next;
  }
  return { worstOdds, worstLine: L };
}

// ── Ratings ────────────────────────────────────────────────────────────

/**
 * Team ratings from completed games [{ home, away, homeScore, awayScore }]
 * (team ids). SRS: rating = average margin (minus home edge at home, plus
 * on the road) + average opponent rating, solved by iteration. Early in
 * the season ratings are shrunk toward average (games / (games + 4)).
 */
function ratings(games, { homeEdge = 2.3 } = {}) {
  const teams = new Map();
  const team = (id) => {
    if (!teams.has(id)) teams.set(id, { id, games: [], pf: 0, pa: 0 });
    return teams.get(id);
  };
  for (const g of games) {
    if (!Number.isFinite(g.homeScore) || !Number.isFinite(g.awayScore)) continue;
    const m = g.homeScore - g.awayScore;
    const h = team(g.home);
    const a = team(g.away);
    h.games.push({ opp: g.away, adj: m - homeEdge });
    a.games.push({ opp: g.home, adj: -m + homeEdge });
    h.pf += g.homeScore;
    h.pa += g.awayScore;
    a.pf += g.awayScore;
    a.pa += g.homeScore;
  }
  const r = new Map([...teams.keys()].map((k) => [k, 0]));
  for (let it = 0; it < 200; it++) {
    const next = new Map();
    for (const t of teams.values()) next.set(t.id, t.games.reduce((s, g) => s + g.adj + r.get(g.opp), 0) / t.games.length);
    const mean = [...next.values()].reduce((a, b) => a + b, 0) / next.size;
    for (const [k, v] of next) r.set(k, v - mean);
  }
  const all = [...teams.values()];
  const totalGames = all.reduce((a, t) => a + t.games.length, 0);
  const league = totalGames ? all.reduce((a, t) => a + t.pf, 0) / totalGames : 0;
  return {
    league, // average points per team per game
    teams: Object.fromEntries(
      all.map((t) => {
        const n = t.games.length;
        const shrink = n / (n + 4);
        return [t.id, { rating: r.get(t.id) * shrink, games: n, ppg: t.pf / n, oppPpg: t.pa / n, avgMargin: (t.pf - t.pa) / n }];
      }),
    ),
  };
}

/** Projected home margin and total for a game. */
function project(rt, homeId, awayId, sport) {
  const S = SPORTS[sport];
  const h = rt.teams[homeId];
  const a = rt.teams[awayId];
  if (!h || !a) return null;
  const margin = h.rating - a.rating + S.homeEdge;
  const lg = rt.league;
  const homePts = lg + (h.ppg - lg) * 0.5 + (a.oppPpg - lg) * 0.5 + S.homeEdge / 2;
  const awayPts = lg + (a.ppg - lg) * 0.5 + (h.oppPpg - lg) * 0.5 - S.homeEdge / 2;
  return { margin, total: homePts + awayPts, games: Math.min(h.games, a.games) };
}

// ── ESPN lines ─────────────────────────────────────────────────────────

const num = (v) => {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/^[ou]/i, "").replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
};

/** One ESPN scoreboard event → teams, status, score and the lines (home perspective for the spread). */
function parseEvent(ev, sport) {
  const comp = ev?.competitions?.[0];
  if (!comp) return null;
  const side = (k) => comp.competitors?.find((c) => c.homeAway === k);
  const home = side("home");
  const away = side("away");
  if (!home || !away) return null;
  const teamOf = (c) => ({ id: String(c.team?.id), abbr: c.team?.abbreviation || "", name: c.team?.shortDisplayName || c.team?.displayName || "", logo: c.team?.logo || null, record: c.records?.[0]?.summary || "" });
  const status = comp.status?.type || ev.status?.type || {};
  const o = (comp.odds || [])[0];
  let lines = null;
  if (o) {
    const H = teamOf(home);
    let homeSpread = num(o.pointSpread?.home?.close?.line ?? o.pointSpread?.home?.open?.line);
    if (homeSpread === null && typeof o.details === "string") {
      const m = /^([A-Z]{2,4})\s+([+-]?\d+(\.\d+)?)$/.exec(o.details.trim());
      if (m) homeSpread = m[1] === H.abbr ? Number(m[2]) : -Number(m[2]);
      else if (/^(EVEN|PK|PICK)/i.test(o.details.trim())) homeSpread = 0;
    }
    if (homeSpread === null && Number.isFinite(o.spread)) homeSpread = o.homeTeamOdds?.favorite ? -Math.abs(o.spread) : o.awayTeamOdds?.favorite ? Math.abs(o.spread) : o.spread;
    const total = num(o.overUnder ?? o.total?.over?.close?.line);
    lines = {
      provider: o.provider?.name || "",
      details: o.details || "",
      homeSpread,
      homeSpreadOdds: num(o.pointSpread?.home?.close?.odds ?? o.homeTeamOdds?.spreadOdds) ?? -110,
      awaySpreadOdds: num(o.pointSpread?.away?.close?.odds ?? o.awayTeamOdds?.spreadOdds) ?? -110,
      total,
      overOdds: num(o.total?.over?.close?.odds ?? o.overOdds) ?? -110,
      underOdds: num(o.total?.under?.close?.odds ?? o.underOdds) ?? -110,
      homeMl: num(o.moneyline?.home?.close?.odds ?? o.homeTeamOdds?.moneyLine),
      awayMl: num(o.moneyline?.away?.close?.odds ?? o.awayTeamOdds?.moneyLine),
    };
  }
  return {
    id: String(ev.id),
    sport,
    date: ev.date,
    name: ev.shortName || ev.name || "",
    state: status.state || "pre", // pre | in | post
    completed: Boolean(status.completed),
    detail: status.shortDetail || status.detail || "",
    home: { ...teamOf(home), score: num(home.score) },
    away: { ...teamOf(away), score: num(away.score) },
    lines,
  };
}

/** Completed games from parsed events, in the shape ratings() wants. */
const finals = (events) => events.filter((e) => e.completed && e.home.score !== null && e.away.score !== null).map((e) => ({ home: e.home.id, away: e.away.id, homeScore: e.home.score, awayScore: e.away.score }));

// ── Ideas ──────────────────────────────────────────────────────────────

/**
 * For one upcoming game: our projection, and each side of the spread, total
 * and moneyline with our probability (blended with the market's), the edge
 * over the break-even price, and the expected value per $1.
 */
function analyzeGame(game, rt, { blend = 0.5 } = {}) {
  const S = SPORTS[game.sport];
  const proj = project(rt, game.home.id, game.away.id, game.sport);
  const L = game.lines;
  if (!proj || !L) return { ...game, projection: proj, legs: [] };
  const legs = [];
  const leg = (market, side, line, odds, model, marketFair, label) => {
    if (!odds || model === null) return;
    const prob = blend * model + (1 - blend) * (marketFair ?? breakEven(odds));
    const be = breakEven(odds);
    legs.push({
      eventId: game.id,
      sport: game.sport,
      date: game.date,
      matchup: `${game.away.abbr} @ ${game.home.abbr}`,
      market,
      side,
      line,
      odds,
      label,
      modelProb: round(model),
      marketProb: round(marketFair ?? be),
      prob: round(prob),
      edge: round(prob - be),
      ev: round(prob * toDecimal(odds) - 1),
    });
  };
  if (L.homeSpread !== null) {
    const pHome = normCdf((proj.margin + L.homeSpread) / S.marginSd);
    const fair = fairPair(L.homeSpreadOdds, L.awaySpreadOdds) || [0.5, 0.5];
    const fmt = (x) => (x > 0 ? `+${x}` : x === 0 ? "PK" : `${x}`);
    leg("spread", "home", L.homeSpread, L.homeSpreadOdds, pHome, fair[0], `${game.home.abbr} ${fmt(L.homeSpread)}`);
    leg("spread", "away", -L.homeSpread, L.awaySpreadOdds, 1 - pHome, fair[1], `${game.away.abbr} ${fmt(-L.homeSpread)}`);
  }
  if (L.total !== null) {
    const pOver = 1 - normCdf((L.total - proj.total) / S.totalSd);
    const fair = fairPair(L.overOdds, L.underOdds) || [0.5, 0.5];
    leg("total", "over", L.total, L.overOdds, pOver, fair[0], `Over ${L.total}`);
    leg("total", "under", L.total, L.underOdds, 1 - pOver, fair[1], `Under ${L.total}`);
  }
  if (L.homeMl && L.awayMl) {
    const pHome = normCdf(proj.margin / S.marginSd);
    const fair = fairPair(L.homeMl, L.awayMl);
    leg("moneyline", "home", null, L.homeMl, pHome, fair?.[0], `${game.home.abbr} to win`);
    leg("moneyline", "away", null, L.awayMl, 1 - pHome, fair?.[1], `${game.away.abbr} to win`);
  }
  const conf = (l) => (proj.games < S.minGames ? "low" : l.edge >= 0.06 ? "high" : l.edge >= 0.035 ? "medium" : "low");
  const sdOf = (l) => (l.market === "spread" ? S.marginSd : l.market === "total" ? S.totalSd : null);
  return {
    ...game,
    projection: { margin: round(proj.margin, 1), total: round(proj.total, 1), games: proj.games },
    explain: explainGame(game, rt, proj, { blend }),
    legs: legs.map((l) => ({ ...l, confidence: conf(l), shop: shopRange(l, sdOf(l)) })),
  };
}

const half = (x) => Math.round(x * 2) / 2;
const fmtSpread = (abbr, x) => `${abbr} ${x > 0 ? `+${x}` : x === 0 ? "PK" : x}`;
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const signed1 = (x) => `${x >= 0 ? "+" : "−"}${r1(Math.abs(x))}`;

/**
 * The game in words: our line and how we got it, the book's line, the
 * middle line we actually bet from (our chance blended with the book's),
 * and why the two might disagree.
 */
function explainGame(game, rt, proj, { blend = 0.5 } = {}) {
  const S = SPORTS[game.sport];
  const h = rt.teams[game.home.id];
  const a = rt.teams[game.away.id];
  const L = game.lines || {};
  const H = game.home.abbr;
  const A = game.away.abbr;
  const fav = (m) => (m >= 0 ? H : A);
  const ours = { spread: half(-proj.margin), total: half(proj.total), homeWin: round(normCdf(proj.margin / S.marginSd)) };
  const book = { spread: L.homeSpread ?? null, total: L.total ?? null, homeWin: L.homeMl && L.awayMl ? round(fairPair(L.homeMl, L.awayMl)?.[0]) : null };
  // The middle line: where our blended chance would be a coin flip.
  const middle = { spread: null, total: null, homeWin: ours.homeWin !== null && book.homeWin !== null ? round(blend * ours.homeWin + (1 - blend) * book.homeWin) : null };
  if (book.spread !== null) {
    const fair = fairPair(L.homeSpreadOdds, L.awaySpreadOdds)?.[0] ?? 0.5;
    const p = blend * normCdf((proj.margin + book.spread) / S.marginSd) + (1 - blend) * fair;
    middle.spread = half(-(S.marginSd * invNorm(p) - book.spread));
  }
  if (book.total !== null) {
    const fair = fairPair(L.overOdds, L.underOdds)?.[0] ?? 0.5;
    const p = blend * (1 - normCdf((book.total - proj.total) / S.totalSd)) + (1 - blend) * fair;
    middle.total = half(book.total + S.totalSd * invNorm(p));
  }
  const how = [
    `${H} rates ${signed1(h.rating)} and ${A} ${signed1(a.rating)}: how many points each beats an average team by on a neutral ${game.sport === "nfl" ? "field" : "floor"}, from this season's scores adjusted for who they played (${Math.min(h.games, a.games)} games each).`,
    `${r1(h.rating)} − (${r1(a.rating)}) = ${r1(h.rating - a.rating)}, plus ${S.homeEdge} for home ${game.sport === "nfl" ? "field" : "court"} → ${fav(proj.margin)} by ${r1(Math.abs(proj.margin))}, so our spread is ${fmtSpread(H, ours.spread)}.`,
    `Points: ${H} scores ${r1(h.ppg)} and allows ${r1(h.oppPpg)}; ${A} scores ${r1(a.ppg)} and allows ${r1(a.oppPpg)} (league ${r1(rt.league)}). Each side's offense against the other's defense → ${r1(proj.total)}, so our total is ${ours.total}.`,
  ];
  const why = [];
  if (book.spread !== null) {
    const gap = ours.spread - book.spread; // + means we like the away side more than the book does
    if (Math.abs(gap) < 1) why.push(`The book's spread (${fmtSpread(H, book.spread)}) is within a point of ours: no real disagreement.`);
    else why.push(`The book has ${fmtSpread(H, book.spread)}; we have ${fmtSpread(H, ours.spread)}. That's ${r1(Math.abs(gap))} points ${gap < 0 ? `more on ${H}` : `more on ${A}`} than the book.`);
  }
  if (book.total !== null) {
    const gap = ours.total - book.total;
    if (Math.abs(gap) >= 1.5) why.push(`The book's total is ${book.total}; ours is ${ours.total} (${gap > 0 ? "higher" : "lower"} by ${r1(Math.abs(gap))}).`);
  }
  const big = game.sport === "nfl" ? 4 : 6;
  if (book.spread !== null && Math.abs(ours.spread - book.spread) >= big)
    why.push(`A gap this big usually means news our numbers can't see: injuries, rest, a trade. Check the injury report before betting it.`);
  why.push(
    `Why books differ from us: they price in injuries, rest days, travel and recent form, and sharp bettors move their lines. We only see this season's scores. That's why we blend half and half with the book and bet from the middle line, not ours.`,
  );
  if (Math.min(h.games, a.games) < S.minGames) why.push(`Early season: ${Math.min(h.games, a.games)} games is a small sample, so treat our line loosely.`);
  return { ours, book, middle, how, why };
}

/** The ideas worth a look: legs with at least `minEdge` edge, best first, one per market per game. */
function pickIdeas(analyzed, { minEdge = 0.025 } = {}) {
  const out = [];
  for (const g of analyzed) {
    if (g.state !== "pre") continue;
    for (const market of ["spread", "total", "moneyline"]) {
      const best = g.legs.filter((l) => l.market === market && l.edge >= minEdge).sort((a, b) => b.edge - a.edge)[0];
      // Long-shot moneylines are mostly noise in a simple model.
      if (best && !(market === "moneyline" && best.odds > 250)) out.push(best);
    }
  }
  return out.sort((a, b) => b.ev - a.ev);
}

/**
 * Parlays of 2 and 3 legs from different games, each leg with an edge and
 * at least a 45% chance (no long-shot legs). Legs are treated as
 * independent. Best expected value first.
 */
function parlays(ideas, { max = 4 } = {}) {
  const bestPerGame = new Map();
  for (const l of ideas) if (l.prob >= 0.45 && l.ev > 0 && (!bestPerGame.has(l.eventId) || bestPerGame.get(l.eventId).ev < l.ev)) bestPerGame.set(l.eventId, l);
  const pool = [...bestPerGame.values()].sort((a, b) => b.ev - a.ev).slice(0, 8);
  const combos = [];
  const add = (legs) => {
    const prob = legs.reduce((p, l) => p * l.prob, 1);
    const decimal = legs.reduce((d, l) => d * toDecimal(l.odds), 1);
    combos.push({ legs, prob: round(prob), decimal: round(decimal, 2), odds: toAmerican(decimal), ev: round(prob * decimal - 1) });
  };
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++) {
      add([pool[i], pool[j]]);
      for (let k = j + 1; k < pool.length; k++) add([pool[i], pool[j], pool[k]]);
    }
  return combos
    .filter((c) => c.ev > 0)
    .sort((a, b) => b.ev - a.ev)
    .slice(0, max);
}

// ── Futures ────────────────────────────────────────────────────────────

/** ESPN futures JSON → [{ market, name, provider, entries: [{ teamId, odds }] }]. */
function parseFutures(json) {
  const out = [];
  for (const item of json?.items || []) {
    const f = (item.futures || [])[0];
    if (!f) continue;
    const entries = (f.books || [])
      .map((b) => ({ teamId: /teams\/(\d+)/.exec(b.team?.$ref || "")?.[1] || null, odds: num(b.value) }))
      .filter((e) => e.teamId && e.odds);
    if (entries.length) out.push({ market: item.type || "", name: item.displayName || item.name || "", provider: f.provider?.name || "", entries });
  }
  return out;
}

/**
 * A rough title chance from the ratings (stronger teams get exponentially
 * more of it), blended half and half with the market's fair odds. Shows
 * where the price looks generous. Rough: no schedule, injuries or bracket.
 */
function futuresValue(market, rt, sport, { blend = 0.5, spread = null } = {}) {
  const tau = spread ?? (sport === "nfl" ? 3.2 : 2.6);
  const entries = market.entries.filter((e) => rt.teams[e.teamId]);
  if (!entries.length) return [];
  const implied = entries.map((e) => breakEven(e.odds));
  const sumImplied = implied.reduce((a, b) => a + b, 0);
  const weights = entries.map((e) => Math.exp(rt.teams[e.teamId].rating / tau));
  const sumW = weights.reduce((a, b) => a + b, 0);
  return entries
    .map((e, i) => {
      const model = weights[i] / sumW;
      const fair = implied[i] / sumImplied;
      const prob = blend * model + (1 - blend) * fair;
      return { teamId: e.teamId, odds: e.odds, modelProb: round(model), marketProb: round(fair), prob: round(prob), ev: round(prob * toDecimal(e.odds) - 1) };
    })
    .sort((a, b) => b.ev - a.ev);
}

// ── Settling and the record ────────────────────────────────────────────

/** A leg's result from a final score: won, lost or push (null while not final). */
function settleLeg(leg, game) {
  if (!game?.completed || game.home.score === null || game.away.score === null) return null;
  const margin = game.home.score - game.away.score;
  if (leg.market === "spread") {
    const m = leg.side === "home" ? margin + leg.line : -margin + leg.line;
    return m > 0 ? "won" : m < 0 ? "lost" : "push";
  }
  if (leg.market === "total") {
    const t = game.home.score + game.away.score - leg.line;
    const r = leg.side === "over" ? t : -t;
    return r > 0 ? "won" : r < 0 ? "lost" : "push";
  }
  if (leg.market === "moneyline") return margin === 0 ? "push" : (leg.side === "home") === margin > 0 ? "won" : "lost";
  return null;
}

/** A bet's status and profit from its legs' results (pushes drop out of a parlay). */
function settleBet(bet) {
  const results = bet.legs.map((l) => l.result || "pending");
  if (results.includes("lost")) return { status: "lost", profit: -bet.stake };
  if (results.includes("pending")) return { status: "pending", profit: 0 };
  const live = bet.legs.filter((l) => l.result === "won");
  if (!live.length) return { status: "push", profit: 0 };
  const decimal = live.reduce((d, l) => d * toDecimal(l.odds), 1);
  return { status: "won", profit: Math.round(bet.stake * (decimal - 1) * 100) / 100 };
}

/** Won, lost, staked, profit and ROI, overall and by kind (straight, parlay, future) and market. */
function betRecord(bets) {
  const settled = bets.filter((b) => ["won", "lost", "push"].includes(b.status));
  const group = (list) => {
    const staked = list.filter((b) => b.status !== "push").reduce((a, b) => a + b.stake, 0);
    const profit = list.reduce((a, b) => a + (b.profit || 0), 0);
    return { bets: list.length, won: list.filter((b) => b.status === "won").length, lost: list.filter((b) => b.status === "lost").length, push: list.filter((b) => b.status === "push").length, staked: round(staked, 2), profit: round(profit, 2), roi: staked ? round(profit / staked, 3) : null };
  };
  const kindOf = (b) => (b.kind === "future" ? "future" : b.legs.length > 1 ? "parlay" : "straight");
  return {
    all: group(settled),
    byKind: Object.fromEntries(["straight", "parlay", "future"].map((k) => [k, group(settled.filter((b) => kindOf(b) === k))])),
    byMarket: Object.fromEntries(["spread", "total", "moneyline", "prop"].map((m) => [m, group(settled.filter((b) => kindOf(b) === "straight" && b.legs[0]?.market === m))])),
    pending: bets.filter((b) => b.status === "pending").length,
  };
}

/** When a season started (for "this season's games"). */
function seasonStart(sport, now = new Date()) {
  const m = SPORTS[sport].seasonStartMonth; // 0-based: Oct for the NBA, Sep for the NFL
  const y = now.getUTCMonth() >= m ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return new Date(Date.UTC(y, m, 1));
}

module.exports = { SPORTS, normCdf, invNorm, shopRange, explainGame, toDecimal, breakEven, toAmerican, fairPair, ratings, project, parseEvent, finals, analyzeGame, pickIdeas, parlays, parseFutures, futuresValue, settleLeg, settleBet, betRecord, seasonStart };
