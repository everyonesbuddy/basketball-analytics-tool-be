const crypto = require("crypto");
const cache = require("../../cache/memoryCache");
const { getPlayerPool } = require("./draftAssistant");
const {
  attachVorp,
  normalizeLeagueSettings,
} = require("../analytics/fantasyVorp");
const { getSport } = require("../../config/fantasySports");
const { finiteNumber, roundNullable } = require("../../utils/reshapeFantasy");

const FANTASY_COMPARE_TTL_MS = 5 * 60 * 1000;
const FANTASY_TEAM_GRADE_TTL_MS = 5 * 60 * 1000;

function hashKey(value) {
  return crypto
    .createHash("sha1")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

function compactPlayer(player = {}) {
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    team: player.team,
    projectedTotal: player.projectedTotal,
    projectedAverage: player.projectedAverage,
    actualTotal: player.actualTotal,
    vorp: player.vorp,
    vorpRank: player.vorpRank,
    projectedRank: player.projectedRank,
    projectedPositionRank: player.projectedPositionRank,
    adp: player.adp,
    tier: player.tier,
    injuryStatus: player.injuryStatus,
    keyStats: player.keyStats,
  };
}

function compareMetric(label, valueA, valueB, higherIsBetter = true) {
  const parsedA = finiteNumber(valueA);
  const parsedB = finiteNumber(valueB);
  const difference =
    parsedA !== null && parsedB !== null ? parsedA - parsedB : null;
  const directionalDifference =
    difference === null ? null : higherIsBetter ? difference : -difference;

  return {
    label,
    playerA: roundNullable(parsedA, 2),
    playerB: roundNullable(parsedB, 2),
    difference: roundNullable(difference, 2),
    advantage:
      directionalDifference === null
        ? null
        : directionalDifference > 0
          ? "playerA"
          : directionalDifference < 0
            ? "playerB"
            : "tie",
  };
}

async function compareFantasyPlayers(options = {}) {
  const {
    playerAId,
    playerBId,
    scoringId,
    season,
    leagueSettings = {},
    forceRefresh = false,
    sport: sportKey = "nfl",
  } = options;
  const sport = getSport(sportKey);
  const league = normalizeLeagueSettings(leagueSettings, sport);
  const cacheKey = `${sport.cachePrefix}-player-compare:${hashKey({
    playerAId,
    playerBId,
    scoringId,
    season,
    league,
  })}`;

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, _cache: "HIT" };
  }

  const pool = await getPlayerPool({
    season,
    scoringId,
    forceRefresh,
    sport: sport.key,
  });
  const { players } = attachVorp(pool.players, league, sport);
  const byId = new Map(players.map((player) => [player.id, player]));
  const playerA = byId.get(Number(playerAId));
  const playerB = byId.get(Number(playerBId));

  if (!playerA || !playerB) {
    const missing = [
      playerA ? null : playerAId,
      playerB ? null : playerBId,
    ].filter(Boolean);
    const error = new Error(`Fantasy player not found: ${missing.join(", ")}`);
    error.statusCode = 404;
    throw error;
  }

  const metrics = [
    compareMetric(
      "Projected points",
      playerA.projectedTotal,
      playerB.projectedTotal,
    ),
    compareMetric("VORP", playerA.vorp, playerB.vorp),
    compareMetric("ADP", playerA.adp, playerB.adp, false),
    compareMetric(
      "Projected positional rank",
      playerA.projectedPositionRank,
      playerB.projectedPositionRank,
      false,
    ),
  ];
  const vorpDifference =
    finiteNumber(playerA.vorp) - finiteNumber(playerB.vorp);
  const payload = {
    sport: sport.key,
    season: pool.season,
    scoringId,
    scoring: pool.scoring,
    leagueSettings: league,
    playerA: compactPlayer(playerA),
    playerB: compactPlayer(playerB),
    metrics,
    advantage:
      vorpDifference > 0 ? "playerA" : vorpDifference < 0 ? "playerB" : "tie",
    decisionInsights:
      vorpDifference === 0
        ? "The players have equal projected VORP in this league format."
        : `${vorpDifference > 0 ? playerA.name : playerB.name} provides more projected value over replacement in this league format.`,
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, payload, FANTASY_COMPARE_TTL_MS);
  return { ...payload, _cache: "MISS" };
}

function sortedByVorp(players = []) {
  return [...players].sort(
    (a, b) => (finiteNumber(b.vorp) || 0) - (finiteNumber(a.vorp) || 0),
  );
}

// Fixed positions fill first, then flex slots in declared order (most restrictive first).
function selectLineup(players = [], league, sport) {
  const remaining = [...players];
  const lineup = [];

  const take = (slot, eligiblePositions, count) => {
    const eligible = sortedByVorp(
      remaining.filter((player) => eligiblePositions.includes(player.position)),
    ).slice(0, count);
    const takenIds = new Set(eligible.map((player) => player.id));
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (takenIds.has(remaining[index].id)) remaining.splice(index, 1);
    }
    lineup.push(...eligible.map((player) => ({ player, slot })));
  };

  for (const position of sport.positions) {
    take(position, [position], league.starters[position] || 0);
  }

  for (const [slot, eligiblePositions] of Object.entries(sport.flexSlots)) {
    take(slot, eligiblePositions, league.starters[slot] || 0);
  }

  return lineup;
}

function selectStarters(players, league, sport) {
  return selectLineup(players, league, sport).map(({ player }) => player);
}

function requiredStarterCount(league, sport) {
  return [...sport.positions, ...Object.keys(sport.flexSlots)].reduce(
    (sum, slot) => sum + (league.starters[slot] || 0),
    0,
  );
}

function scoreToGrade(score) {
  if (score === null) return "N/A";
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function buildAdpPositionRanks(players = []) {
  const ranks = new Map();
  const groups = new Map();

  for (const player of players) {
    const adp = finiteNumber(player.adp);
    if (player.adpIsPlaceholder || adp === null) continue;
    if (!groups.has(player.position)) groups.set(player.position, []);
    groups.get(player.position).push(player);
  }

  for (const [, group] of groups) {
    group
      .sort((a, b) => finiteNumber(a.adp) - finiteNumber(b.adp))
      .forEach((player, index) => ranks.set(player.id, index + 1));
  }

  return ranks;
}

function calculateMarketScore(
  starters = [],
  adpRanks = new Map(),
  baselines = {},
) {
  const values = starters
    .map((player) => {
      const adpRank = adpRanks.get(player.id);
      const replacementRank = baselines[player.position]?.replacementRank;
      if (
        !adpRank ||
        !Number.isInteger(replacementRank) ||
        replacementRank <= 1
      ) {
        return null;
      }

      return Math.max(
        0,
        Math.min(
          100,
          ((replacementRank - adpRank) / (replacementRank - 1)) * 100,
        ),
      );
    })
    .filter((value) => value !== null);

  return {
    score: values.length
      ? roundNullable(
          values.reduce((sum, value) => sum + value, 0) / values.length,
          1,
        )
      : null,
    sampleSize: values.length,
  };
}

function calculateLeagueRelativeValueScore(
  starters = [],
  players = [],
  baselines = {},
) {
  const ranksByPosition = new Map();

  for (const player of players) {
    if (!ranksByPosition.has(player.position)) {
      ranksByPosition.set(player.position, []);
    }
    ranksByPosition.get(player.position).push(player);
  }

  for (const group of ranksByPosition.values()) {
    group.sort(
      (a, b) => (finiteNumber(b.vorp) || 0) - (finiteNumber(a.vorp) || 0),
    );
  }

  const scores = starters
    .map((player) => {
      const group = ranksByPosition.get(player.position) || [];
      const rank =
        group.findIndex((candidate) => candidate.id === player.id) + 1;
      const replacementRank = baselines[player.position]?.replacementRank;

      if (!rank || !Number.isInteger(replacementRank) || replacementRank <= 1) {
        return null;
      }

      // Replacement level is the league midpoint; elite players score toward 100.
      const relativePosition = (rank - 1) / (replacementRank - 1);
      return Math.max(0, Math.min(100, 100 - relativePosition * 50));
    })
    .filter((score) => score !== null);

  return scores.length
    ? roundNullable(
        scores.reduce((sum, score) => sum + score, 0) / scores.length,
        1,
      )
    : null;
}

function summarizeRoster(rosterPlayers, lineup, league, sport) {
  const starters = lineup.map(({ player }) => player);
  const starterVorp = starters.reduce(
    (sum, player) => sum + (finiteNumber(player.vorp) || 0),
    0,
  );
  const required = requiredStarterCount(league, sport);
  const coverageScore = required
    ? Math.min(100, (starters.length / required) * 100)
    : null;
  const byPosition = starters.reduce((result, player) => {
    result[player.position] = roundNullable(
      (result[player.position] || 0) + (finiteNumber(player.vorp) || 0),
      2,
    );
    return result;
  }, {});

  return {
    rosterSize: rosterPlayers.length,
    starterCount: starters.length,
    starterVorp: roundNullable(starterVorp, 2),
    coverageScore: roundNullable(coverageScore, 1),
    byPosition,
    starters: lineup.map(({ player, slot }) => ({
      ...compactPlayer(player),
      lineupSlot: slot,
    })),
    players: rosterPlayers.map(compactPlayer),
  };
}

async function compareFantasyTeams(options = {}) {
  const {
    rosterAIds = [],
    rosterBIds = [],
    scoringId,
    season,
    leagueSettings = {},
    forceRefresh = false,
    sport: sportKey = "nfl",
  } = options;
  const sport = getSport(sportKey);
  const league = normalizeLeagueSettings(leagueSettings, sport);
  const rosterA = [...new Set(rosterAIds.map(Number))].sort((a, b) => a - b);
  const rosterB = [...new Set(rosterBIds.map(Number))].sort((a, b) => a - b);
  const cacheKey = `${sport.cachePrefix}-team-compare:${hashKey({
    rosterA,
    rosterB,
    scoringId,
    season,
    league,
  })}`;

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, _cache: "HIT" };
  }

  const pool = await getPlayerPool({
    season,
    scoringId,
    forceRefresh,
    sport: sport.key,
  });
  const { players } = attachVorp(pool.players, league, sport);
  const byId = new Map(players.map((player) => [player.id, player]));
  const resolveRoster = (ids) => ({
    players: ids.map((id) => byId.get(id)).filter(Boolean),
    missingPlayerIds: ids.filter((id) => !byId.has(id)),
  });
  const resolvedA = resolveRoster(rosterA);
  const resolvedB = resolveRoster(rosterB);
  const summaryA = summarizeRoster(
    resolvedA.players,
    selectLineup(resolvedA.players, league, sport),
    league,
    sport,
  );
  const summaryB = summarizeRoster(
    resolvedB.players,
    selectLineup(resolvedB.players, league, sport),
    league,
    sport,
  );
  const vorpDifference = summaryA.starterVorp - summaryB.starterVorp;
  const coverageDifference = summaryA.coverageScore - summaryB.coverageScore;

  const payload = {
    sport: sport.key,
    season: pool.season,
    scoringId,
    scoring: pool.scoring,
    leagueSettings: league,
    rosterA: summaryA,
    rosterB: summaryB,
    missingPlayerIds: {
      rosterA: resolvedA.missingPlayerIds,
      rosterB: resolvedB.missingPlayerIds,
    },
    comparison: {
      starterVorpDifference: roundNullable(vorpDifference, 2),
      coverageDifference: roundNullable(coverageDifference, 1),
      advantage:
        vorpDifference > 0 ? "rosterA" : vorpDifference < 0 ? "rosterB" : "tie",
      decisionInsights:
        vorpDifference === 0
          ? "Both rosters have equal projected starter VORP."
          : `${vorpDifference > 0 ? "Roster A" : "Roster B"} has more projected starter value over replacement.`,
    },
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, payload, FANTASY_COMPARE_TTL_MS);
  return { ...payload, _cache: "MISS" };
}

async function getFantasyTeamGrade(options = {}) {
  const {
    rosterIds = [],
    scoringId,
    season,
    leagueSettings = {},
    forceRefresh = false,
    sport: sportKey = "nfl",
  } = options;
  const sport = getSport(sportKey);
  const league = normalizeLeagueSettings(leagueSettings, sport);
  const roster = [...new Set(rosterIds.map(Number))].sort((a, b) => a - b);
  const cacheKey = `${sport.cachePrefix}-team-grade:v2:${hashKey({
    roster,
    scoringId,
    season,
    league,
  })}`;

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, _cache: "HIT" };
  }

  const pool = await getPlayerPool({
    season,
    scoringId,
    forceRefresh,
    sport: sport.key,
  });
  const { players, baselines } = attachVorp(pool.players, league, sport);
  const byId = new Map(players.map((player) => [player.id, player]));
  const rosterPlayers = roster.map((id) => byId.get(id)).filter(Boolean);
  const missingPlayerIds = roster.filter((id) => !byId.has(id));
  const lineup = selectLineup(rosterPlayers, league, sport);
  const starters = lineup.map(({ player }) => player);
  const ideal = selectStarters(players, league, sport);
  const starterVorp = starters.reduce(
    (sum, player) => sum + (finiteNumber(player.vorp) || 0),
    0,
  );
  const idealVorp = ideal.reduce(
    (sum, player) => sum + (finiteNumber(player.vorp) || 0),
    0,
  );
  const valueScore = calculateLeagueRelativeValueScore(
    starters,
    players,
    baselines,
  );
  const market = calculateMarketScore(
    starters,
    buildAdpPositionRanks(players),
    baselines,
  );
  const required = requiredStarterCount(league, sport);
  const coverageScore = required
    ? Math.min(100, (starters.length / required) * 100)
    : null;
  const scoreWeights =
    market.score === null
      ? { starterValue: 0.7, marketValue: 0, coverage: 0.3 }
      : { starterValue: 0.5, marketValue: 0.25, coverage: 0.25 };
  const score =
    valueScore !== null && coverageScore !== null
      ? valueScore * scoreWeights.starterValue +
        (market.score || 0) * scoreWeights.marketValue +
        coverageScore * scoreWeights.coverage
      : (valueScore ?? market.score ?? coverageScore);
  const counts = rosterPlayers.reduce((result, player) => {
    result[player.position] = (result[player.position] || 0) + 1;
    return result;
  }, {});

  const filledBySlot = lineup.reduce((result, { slot }) => {
    result[slot] = (result[slot] || 0) + 1;
    return result;
  }, {});
  const missingSlots = {};
  for (const slot of [...sport.positions, ...Object.keys(sport.flexSlots)]) {
    const shortfall = (league.starters[slot] || 0) - (filledBySlot[slot] || 0);
    if (shortfall > 0) missingSlots[slot] = shortfall;
  }

  const starterIds = new Set(starters.map((player) => player.id));
  const payload = {
    sport: sport.key,
    season: pool.season,
    scoringId,
    scoring: pool.scoring,
    leagueSettings: league,
    rosterSize: rosterPlayers.length,
    missingPlayerIds,
    grade: scoreToGrade(score),
    score: roundNullable(score, 1),
    valueScore: roundNullable(valueScore, 1),
    marketScore: market.score,
    marketSampleSize: market.sampleSize,
    coverageScore: roundNullable(coverageScore, 1),
    scoreWeights,
    starterVorp: roundNullable(starterVorp, 2),
    idealStarterVorp: roundNullable(idealVorp, 2),
    valueScoreMethod: "league_relative_position_value",
    replacementBaselines: baselines,
    roster: rosterPlayers.map((player) => ({
      ...compactPlayer(player),
      isStarter: starterIds.has(player.id),
    })),
    suggestedStarters: lineup.map(({ player, slot }) => ({
      ...compactPlayer(player),
      lineupSlot: slot,
    })),
    positionCounts: counts,
    missingStarterSlots: missingSlots,
    decisionInsights: missingPlayerIds.length
      ? `The roster includes ${missingPlayerIds.length} player ID${missingPlayerIds.length === 1 ? "" : "s"} not found in the current pool.`
      : `This roster grades ${scoreToGrade(score)} from starter VORP, public ADP market value, and lineup coverage for the selected league format.`,
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, payload, FANTASY_TEAM_GRADE_TTL_MS);
  return { ...payload, _cache: "MISS" };
}

module.exports = {
  compareFantasyPlayers,
  compareFantasyTeams,
  getFantasyTeamGrade,
};
