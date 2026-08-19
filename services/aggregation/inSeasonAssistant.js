const cache = require("../../cache/memoryCache");
const { getPlayerPool } = require("./draftAssistant");
const { getFantasySeasonState } = require("../espn/fantasySeason.service");
const { finiteNumber, roundNullable } = require("../../utils/reshapeFantasy");

const IN_SEASON_TTL_MS = 5 * 60 * 1000;
const DEFAULT_WINDOW = 4;

function average(values = []) {
  const valid = values
    .filter((value) => finiteNumber(value) !== null)
    .map(Number);
  return valid.length
    ? valid.reduce((sum, value) => sum + value, 0) / valid.length
    : null;
}

function standardDeviation(values = [], mean) {
  const valid = values
    .filter((value) => finiteNumber(value) !== null)
    .map(Number);
  if (!valid.length || mean === null) return null;
  return Math.sqrt(
    valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / valid.length,
  );
}

function buildWeeklyHistory(player = {}) {
  const byPeriod = new Map();
  for (const split of player.weeklySplits || []) {
    if (!byPeriod.has(split.scoringPeriodId))
      byPeriod.set(split.scoringPeriodId, {});
    const entry = byPeriod.get(split.scoringPeriodId);
    if (split.isProjection) entry.projected = split.appliedTotal;
    else entry.actual = split.appliedTotal;
  }
  return [...byPeriod.entries()]
    .map(([scoringPeriodId, values]) => ({ scoringPeriodId, ...values }))
    .sort((a, b) => a.scoringPeriodId - b.scoringPeriodId);
}

function evaluateRecentForm(player = {}, window = DEFAULT_WINDOW) {
  const history = buildWeeklyHistory(player);
  const completed = history
    .filter((week) => finiteNumber(week.actual) !== null)
    .slice(-window);
  const actuals = completed.map((week) => week.actual);
  const projections = completed.map((week) => week.projected);
  const actualAverage = average(actuals);
  const projectedAverage = average(projections);
  const delta =
    actualAverage !== null && projectedAverage !== null
      ? actualAverage - projectedAverage
      : null;
  const latest = completed[completed.length - 1]?.actual ?? null;
  const previous = completed[completed.length - 2]?.actual ?? null;

  return {
    gamesSample: completed.length,
    actualAverage: roundNullable(actualAverage, 2),
    projectedAverage: roundNullable(projectedAverage, 2),
    deltaFromProjection: roundNullable(delta, 2),
    standardDeviation: roundNullable(
      standardDeviation(actuals, actualAverage),
      2,
    ),
    lastActual: roundNullable(latest, 2),
    weekOverWeekDelta:
      finiteNumber(latest) !== null && finiteNumber(previous) !== null
        ? roundNullable(latest - previous, 2)
        : null,
    history,
  };
}

function inSeasonStatus(sample) {
  return sample.gamesSample >= 2 ? "ready" : "insufficient_sample";
}

async function getInSeasonContext(options = {}) {
  const { season, scoringId, forceRefresh = false } = options;
  const [pool, seasonState] = await Promise.all([
    getPlayerPool({ season, scoringId, forceRefresh }),
    getFantasySeasonState({ forceRefresh }),
  ]);
  return { pool, seasonState };
}

async function getWaiverWire(options = {}) {
  const {
    scoringId,
    season,
    forceRefresh = false,
    ownershipMax = 50,
    window = DEFAULT_WINDOW,
  } = options;
  const cacheKey = `fantasy-waivers:${season || "current"}:${scoringId}:${ownershipMax}:${window}`;
  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, _cache: "HIT" };
  }

  const { pool, seasonState } = await getInSeasonContext({
    season,
    scoringId,
    forceRefresh,
  });
  const candidates = pool.players
    .map((player) => ({
      ...player,
      recentForm: evaluateRecentForm(player, window),
    }))
    .filter(
      (player) =>
        finiteNumber(player.ownershipPct) !== null &&
        player.ownershipPct <= ownershipMax,
    )
    .filter((player) => player.recentForm.gamesSample >= 2)
    .filter(
      (player) => finiteNumber(player.recentForm.deltaFromProjection) !== null,
    )
    .sort(
      (a, b) =>
        finiteNumber(b.recentForm.deltaFromProjection) -
        finiteNumber(a.recentForm.deltaFromProjection),
    )
    .slice(0, 50)
    .map((player) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      team: player.team,
      ownershipPct: player.ownershipPct,
      startedPct: player.startedPct,
      projectedTotal: player.projectedTotal,
      actualTotal: player.actualTotal,
      recentForm: player.recentForm,
    }));

  const result = {
    season: pool.season,
    scoringId,
    scoring: pool.scoring,
    currentScoringPeriod: seasonState.currentScoringPeriod,
    ownershipMax,
    window,
    status: candidates.length ? "ready" : "insufficient_sample",
    candidates,
    decisionInsights: candidates.length
      ? `${candidates[0].name} has the largest recent outperformance versus ESPN projection among available players.`
      : "Actual game data is not sufficient yet to identify waiver trends.",
    lastUpdatedAt: new Date().toISOString(),
  };
  cache.set(cacheKey, result, IN_SEASON_TTL_MS);
  return { ...result, _cache: "MISS" };
}

async function getConsistencyLeaders(options = {}) {
  const {
    scoringId,
    season,
    forceRefresh = false,
    window = DEFAULT_WINDOW,
  } = options;
  const cacheKey = `fantasy-consistency:${season || "current"}:${scoringId}:${window}`;
  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, _cache: "HIT" };
  }

  const { pool, seasonState } = await getInSeasonContext({
    season,
    scoringId,
    forceRefresh,
  });
  const players = pool.players
    .map((player) => ({
      ...player,
      recentForm: evaluateRecentForm(player, window),
    }))
    .filter(
      (player) =>
        player.recentForm.gamesSample >= 3 &&
        finiteNumber(player.recentForm.actualAverage) !== null,
    )
    .map((player) => ({
      ...player,
      consistencyScore: roundNullable(
        player.recentForm.actualAverage -
          (player.recentForm.standardDeviation || 0),
        2,
      ),
    }))
    .sort(
      (a, b) =>
        finiteNumber(b.consistencyScore) - finiteNumber(a.consistencyScore),
    )
    .slice(0, 50)
    .map((player) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      team: player.team,
      ownershipPct: player.ownershipPct,
      consistencyScore: player.consistencyScore,
      recentForm: player.recentForm,
    }));

  const result = {
    season: pool.season,
    scoringId,
    scoring: pool.scoring,
    currentScoringPeriod: seasonState.currentScoringPeriod,
    window,
    status: players.length ? "ready" : "insufficient_sample",
    players,
    decisionInsights: players.length
      ? `${players[0].name} has the strongest recent floor after accounting for weekly volatility.`
      : "At least three completed games are required for consistency rankings.",
    lastUpdatedAt: new Date().toISOString(),
  };
  cache.set(cacheKey, result, IN_SEASON_TTL_MS);
  return { ...result, _cache: "MISS" };
}

async function getStartSit(options = {}) {
  const {
    playerIds = [],
    scoringId,
    season,
    forceRefresh = false,
    window = DEFAULT_WINDOW,
  } = options;
  const { pool, seasonState } = await getInSeasonContext({
    season,
    scoringId,
    forceRefresh,
  });
  const idSet = new Set(playerIds);
  const players = pool.players
    .filter((player) => idSet.has(player.id))
    .map((player) => {
      const recentForm = evaluateRecentForm(player, window);
      const latestCompletedPeriod = Math.max(
        0,
        ...recentForm.history
          .filter((week) => finiteNumber(week.actual) !== null)
          .map((week) => week.scoringPeriodId),
      );
      const nextPeriod =
        latestCompletedPeriod + 1 || seasonState.currentScoringPeriod || 1;
      const nextProjection =
        recentForm.history.find((week) => week.scoringPeriodId === nextPeriod)
          ?.projected || null;
      const ready = inSeasonStatus(recentForm) === "ready";
      const hasUpcomingProjection = finiteNumber(nextProjection) !== null;
      return {
        id: player.id,
        name: player.name,
        position: player.position,
        team: player.team,
        nextScoringPeriod: nextPeriod,
        nextProjection: roundNullable(nextProjection, 2),
        recentForm,
        recommendation: !ready
          ? "insufficient_sample"
          : !hasUpcomingProjection
            ? "no_upcoming_projection"
            : recentForm.deltaFromProjection >= 0
              ? "start"
              : "consider_sit",
      };
    })
    .sort(
      (a, b) => finiteNumber(b.nextProjection) - finiteNumber(a.nextProjection),
    );

  return {
    season: pool.season,
    scoringId,
    scoring: pool.scoring,
    currentScoringPeriod: seasonState.currentScoringPeriod,
    window,
    status: players.some((player) =>
      ["start", "consider_sit"].includes(player.recommendation),
    )
      ? "ready"
      : players.some(
            (player) => player.recommendation === "no_upcoming_projection",
          )
        ? "no_upcoming_projection"
        : "insufficient_sample",
    players,
    decisionInsights:
      "Recommendations combine ESPN's next-week projection with recent actual performance; matchup analysis is not included.",
    lastUpdatedAt: new Date().toISOString(),
    _cache: "MISS",
  };
}

module.exports = { getWaiverWire, getConsistencyLeaders, getStartSit };
