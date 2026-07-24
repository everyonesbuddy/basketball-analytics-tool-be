const cache = require("../../cache/memoryCache");
const { endpoints } = require("../../config/espnEndpoints");
const { getJson } = require("../espn/espnClient");
const { getTeamProfile, getTeamSchedule } = require("../espn/teams.service");
const { getAllTeams } = require("../espn/teams.service");
const {
  buildEfficiencyLine,
  calculateDefensiveRating,
  calculateNetRating,
  calculateOffensiveRating,
  extractTeamStats,
  parseStatValue,
} = require("../analytics/efficiency");

const TEAM_EFFICIENCY_CACHE_TTL_MS = 5 * 60 * 1000;
const TEAM_NEEDS_CACHE_TTL_MS = 20 * 60 * 1000;
const TEAM_NEEDS_LEAGUE_BASELINE_TTL_MS = 20 * 60 * 1000;

function buildTeamEfficiencyCacheKey(teamId, games, seasonType) {
  return `team-efficiency:${teamId}:${games}:${seasonType}`;
}

function buildTeamNeedsCacheKey(teamId, games, seasonType) {
  return `team-needs:${teamId}:${games}:${seasonType}`;
}

function buildTeamNeedsLeagueBaselineCacheKey(games, seasonType) {
  return `team-needs:league-baseline:${games}:${seasonType}`;
}

function pickCompletedEvents(schedule = {}, games = 5) {
  const events = Array.isArray(schedule?.events) ? schedule.events : [];

  return events
    .filter((event) => {
      const status = event?.competitions?.[0]?.status?.type;
      return (
        event?.id &&
        (status?.completed === true ||
          String(status?.state || "").toLowerCase() === "post")
      );
    })
    .slice(-Math.max(1, games))
    .reverse();
}

function extractCompetitor(summary, teamId) {
  const competitors = summary?.header?.competitions?.[0]?.competitors || [];
  return (
    competitors.find(
      (competitor) => String(competitor?.team?.id) === String(teamId),
    ) || null
  );
}

function extractOpponentCompetitor(summary, teamId) {
  const competitors = summary?.header?.competitions?.[0]?.competitors || [];
  return (
    competitors.find(
      (competitor) => String(competitor?.team?.id) !== String(teamId),
    ) || null
  );
}

function extractTeamBoxscore(summary, teamId) {
  const teamSections = summary?.boxscore?.teams || [];
  return (
    teamSections.find(
      (section) => String(section?.team?.id) === String(teamId),
    ) || null
  );
}

function extractOpponentBoxscore(summary, teamId) {
  const teamSections = summary?.boxscore?.teams || [];
  return (
    teamSections.find(
      (section) => String(section?.team?.id) !== String(teamId),
    ) || null
  );
}

function mapTeamStatistics(statistics = []) {
  const byName = {};

  for (const stat of statistics) {
    if (!stat?.name) {
      continue;
    }

    byName[stat.name] = stat.displayValue ?? null;
  }

  return byName;
}

function compactTeam(team = {}) {
  return {
    id: team?.id ? String(team.id) : null,
    displayName: team?.displayName || null,
    shortDisplayName: team?.shortDisplayName || null,
    abbreviation: team?.abbreviation || null,
    logo: team?.logo || team?.logos?.[0]?.href || null,
  };
}

function toSeasonTypeLabel(value) {
  const numeric = Number(value);

  if (numeric === 3) {
    return "postseason";
  }

  if (numeric === 2) {
    return "regular";
  }

  const normalized = String(value || "").toLowerCase();

  if (normalized.includes("post")) {
    return "postseason";
  }

  if (normalized.includes("reg")) {
    return "regular";
  }

  return null;
}

function extractSeasonMeta(summary, event = {}) {
  const summarySeason = summary?.header?.season || {};
  const eventSeason = event?.season || {};
  const seasonTypeCode =
    summarySeason?.type ??
    summarySeason?.typeId ??
    eventSeason?.type ??
    eventSeason?.typeId ??
    null;

  return {
    seasonYear:
      Number(summarySeason?.year ?? eventSeason?.year) ||
      Number(summarySeason?.displayYear) ||
      null,
    seasonTypeCode: Number(seasonTypeCode) || null,
    seasonType: toSeasonTypeLabel(seasonTypeCode),
  };
}

function buildSeasonCoverage(games = []) {
  const years = new Set();
  const types = new Set();

  for (const game of games) {
    if (Number.isInteger(game?.seasonYear)) {
      years.add(game.seasonYear);
    }

    if (game?.seasonType) {
      types.add(game.seasonType);
    }
  }

  return {
    seasonsCovered: [...years].sort((a, b) => a - b),
    seasonTypesCovered: [...types].sort(),
  };
}

function normalizeSeasonType(value) {
  const allowed = new Set(["regular", "postseason", "all"]);
  const normalized = String(value || "regular").toLowerCase();
  return allowed.has(normalized) ? normalized : "regular";
}

function pickSchedulesBySeasonType(
  seasonType,
  regularSchedule,
  postseasonSchedule,
) {
  if (seasonType === "postseason") {
    return [postseasonSchedule];
  }

  if (seasonType === "all") {
    return [regularSchedule, postseasonSchedule];
  }

  return [regularSchedule];
}

function collectCompletedEventsFromSchedules(schedules = [], games = 5) {
  const mergedEvents = schedules
    .filter(Boolean)
    .flatMap((schedule) => schedule?.events || []);

  const unique = new Map();

  for (const event of mergedEvents) {
    if (!event?.id) {
      continue;
    }

    if (!unique.has(event.id)) {
      unique.set(event.id, event);
    }
  }

  return [...unique.values()]
    .filter((event) => {
      const status = event?.competitions?.[0]?.status?.type;
      return (
        status?.completed === true ||
        String(status?.state || "").toLowerCase() === "post"
      );
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, Math.max(1, games));
}

async function mapWithConcurrency(items = [], worker, concurrency = 10) {
  const results = new Array(items.length);
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      } catch (_error) {
        results[currentIndex] = null;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, items.length) }, () =>
      runWorker(),
    ),
  );

  return results;
}

function average(values = []) {
  const valid = values.filter((value) => Number.isFinite(Number(value)));

  if (!valid.length) {
    return null;
  }

  const total = valid.reduce((sum, value) => sum + Number(value), 0);
  return total / valid.length;
}

function roundNullable(value, decimals = 2) {
  if (!Number.isFinite(Number(value))) {
    return null;
  }

  return Number(Number(value).toFixed(decimals));
}

function buildTeamNeedSignals(teamAggregate = {}, leagueAverage = {}) {
  const offGap =
    Number.isFinite(teamAggregate?.offRtg) &&
    Number.isFinite(leagueAverage?.offRtg)
      ? teamAggregate.offRtg - leagueAverage.offRtg
      : null;
  const netGap =
    Number.isFinite(teamAggregate?.netRtg) &&
    Number.isFinite(leagueAverage?.netRtg)
      ? teamAggregate.netRtg - leagueAverage.netRtg
      : null;
  const defGap =
    Number.isFinite(teamAggregate?.defRtg) &&
    Number.isFinite(leagueAverage?.defRtg)
      ? leagueAverage.defRtg - teamAggregate.defRtg
      : null;
  const pointsScoredGap =
    Number.isFinite(teamAggregate?.pointsScored) &&
    Number.isFinite(leagueAverage?.pointsScored)
      ? teamAggregate.pointsScored - leagueAverage.pointsScored
      : null;
  const pointsAllowedGap =
    Number.isFinite(teamAggregate?.pointsAllowed) &&
    Number.isFinite(leagueAverage?.pointsAllowed)
      ? leagueAverage.pointsAllowed - teamAggregate.pointsAllowed
      : null;
  const possessionsGap =
    Number.isFinite(teamAggregate?.possessions) &&
    Number.isFinite(leagueAverage?.possessions)
      ? teamAggregate.possessions - leagueAverage.possessions
      : null;

  const dimensions = [
    {
      metric: "offRtg",
      description: "Offensive Rating",
      delta: offGap,
      higherIsBetter: true,
    },
    {
      metric: "defRtg",
      description: "Defensive Rating",
      delta: defGap,
      higherIsBetter: true,
    },
    {
      metric: "netRtg",
      description: "Net Rating",
      delta: netGap,
      higherIsBetter: true,
    },
    {
      metric: "pointsScored",
      description: "Points Scored",
      delta: pointsScoredGap,
      higherIsBetter: true,
    },
    {
      metric: "pointsAllowed",
      description: "Points Allowed",
      delta: pointsAllowedGap,
      higherIsBetter: true,
    },
    {
      metric: "possessions",
      description: "Pace/Possessions",
      delta: possessionsGap,
      higherIsBetter: true,
    },
  ]
    .filter((item) => Number.isFinite(item.delta))
    .map((item) => ({
      ...item,
      delta: roundNullable(item.delta),
      status:
        item.delta > 0
          ? "above_league_avg"
          : item.delta < 0
            ? "below_league_avg"
            : "at_league_avg",
    }));

  const strengths = dimensions
    .filter((item) => item.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);

  const gaps = dimensions
    .filter((item) => item.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 3);

  return {
    deltaFromLeague: {
      offRtg: roundNullable(offGap),
      defRtg: roundNullable(defGap),
      netRtg: roundNullable(netGap),
      pointsScored: roundNullable(pointsScoredGap),
      pointsAllowed: roundNullable(pointsAllowedGap),
      possessions: roundNullable(possessionsGap),
    },
    strengths,
    gaps,
  };
}

async function getTeamEfficiency(teamId, options = {}) {
  const { games = 5, forceRefresh = false, seasonType = "regular" } = options;
  const normalizedSeasonType = normalizeSeasonType(seasonType);
  const safeGames = Math.max(1, Math.min(Number(games) || 5, 15));
  const cacheKey = buildTeamEfficiencyCacheKey(
    teamId,
    safeGames,
    normalizedSeasonType,
  );

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, _cache: "HIT" };
    }
  }

  const [teamProfile, schedule] = await Promise.all([
    getTeamProfile(teamId),
    getTeamSchedule(teamId),
  ]);

  const currentSeasonYear = Number(
    schedule?.requestedSeason?.year ||
      schedule?.season?.year ||
      new Date().getFullYear(),
  );

  const [regularSchedule, postseasonSchedule] = await Promise.all([
    getTeamSchedule(teamId, { season: currentSeasonYear, seasontype: 2 }).catch(
      () => null,
    ),
    getTeamSchedule(teamId, { season: currentSeasonYear, seasontype: 3 }).catch(
      () => null,
    ),
  ]);

  let eventList = collectCompletedEventsFromSchedules(
    pickSchedulesBySeasonType(
      normalizedSeasonType,
      regularSchedule,
      postseasonSchedule,
    ),
    safeGames,
  );

  if (!eventList.length) {
    const previousSeason = Math.max(2003, currentSeasonYear - 1);
    const [fallbackRegularSchedule, fallbackPostseasonSchedule] =
      await Promise.all([
        getTeamSchedule(teamId, {
          season: previousSeason,
          seasontype: 2,
        }).catch(() => null),
        getTeamSchedule(teamId, {
          season: previousSeason,
          seasontype: 3,
        }).catch(() => null),
      ]);

    eventList = collectCompletedEventsFromSchedules(
      pickSchedulesBySeasonType(
        normalizedSeasonType,
        fallbackRegularSchedule,
        fallbackPostseasonSchedule,
      ),
      safeGames,
    );
  }
  const summaries = await Promise.all(
    eventList.map((event) =>
      getJson(endpoints.summaryByEvent(event.id)).catch(() => null),
    ),
  );

  const recentGames = summaries
    .map((summary, index) => {
      if (!summary) {
        return null;
      }

      const teamSection = extractTeamBoxscore(summary, teamId);
      const opponentSection = extractOpponentBoxscore(summary, teamId);
      const competitor = extractCompetitor(summary, teamId);
      const opponent = extractOpponentCompetitor(summary, teamId);

      if (!teamSection || !opponentSection || !competitor || !opponent) {
        return null;
      }

      const seasonMeta = extractSeasonMeta(summary, eventList[index]);

      const teamStats = extractTeamStats(teamSection.statistics || []);
      const opponentStats = extractTeamStats(opponentSection.statistics || []);
      const pointsScored = parseStatValue(competitor?.score);
      const pointsAllowed = parseStatValue(opponent?.score);

      if (pointsScored === null || pointsAllowed === null) {
        return null;
      }

      return {
        eventId: eventList[index].id,
        gameDate: eventList[index].date,
        seasonYear: seasonMeta.seasonYear,
        seasonType: seasonMeta.seasonType,
        seasonTypeCode: seasonMeta.seasonTypeCode,
        matchup:
          summary?.header?.competitions?.[0]?.shortName ||
          summary?.header?.competitions?.[0]?.name ||
          null,
        status: {
          state:
            summary?.header?.competitions?.[0]?.status?.type?.state || null,
          detail:
            summary?.header?.competitions?.[0]?.status?.type?.detail || null,
          completed:
            summary?.header?.competitions?.[0]?.status?.type?.completed ||
            false,
        },
        team: compactTeam(competitor.team),
        homeAway: competitor.homeAway || null,
        opponent: compactTeam(opponent.team),
        score: {
          team: pointsScored,
          opponent: pointsAllowed,
          scoreLine: `${pointsScored}-${pointsAllowed}`,
          result:
            pointsScored > pointsAllowed
              ? "W"
              : pointsScored < pointsAllowed
                ? "L"
                : "T",
        },
        pointsScored,
        pointsAllowed,
        teamStats,
        opponentStats,
        boxScore: {
          team: mapTeamStatistics(teamSection.statistics || []),
          opponent: mapTeamStatistics(opponentSection.statistics || []),
        },
        ...buildEfficiencyLine({
          pointsScored,
          pointsAllowed,
          ...teamStats,
        }),
      };
    })
    .filter(Boolean);

  const aggregatePossessions = recentGames.reduce(
    (sum, game) => sum + (game.possessions || 0),
    0,
  );
  const aggregatePointsScored = recentGames.reduce(
    (sum, game) => sum + (game.pointsScored || 0),
    0,
  );
  const aggregatePointsAllowed = recentGames.reduce(
    (sum, game) => sum + (game.pointsAllowed || 0),
    0,
  );
  const aggregateOffRtg = calculateOffensiveRating(
    aggregatePointsScored,
    aggregatePossessions,
  );
  const aggregateDefRtg = calculateDefensiveRating(
    aggregatePointsAllowed,
    aggregatePossessions,
  );
  const aggregateNetRtg = calculateNetRating(aggregateOffRtg, aggregateDefRtg);
  const seasonCoverage = buildSeasonCoverage(recentGames);

  const payload = {
    teamId: String(teamId),
    team: teamProfile,
    seasonType: normalizedSeasonType,
    seasonTypeRequested: normalizedSeasonType,
    seasonsCovered: seasonCoverage.seasonsCovered,
    seasonTypesCovered: seasonCoverage.seasonTypesCovered,
    gamesRequested: safeGames,
    gamesPlayed: recentGames.length,
    recentGames,
    aggregate: {
      pointsScored: aggregatePointsScored,
      pointsAllowed: aggregatePointsAllowed,
      possessions: aggregatePossessions,
      offRtg: aggregateOffRtg,
      defRtg: aggregateDefRtg,
      netRtg: aggregateNetRtg,
    },
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, payload, TEAM_EFFICIENCY_CACHE_TTL_MS);

  return { ...payload, _cache: "MISS" };
}

async function getTeamNeedGap(teamId, options = {}) {
  const { games = 5, forceRefresh = false, seasonType = "regular" } = options;
  const normalizedSeasonType = normalizeSeasonType(seasonType);
  const safeGames = Math.max(1, Math.min(Number(games) || 5, 15));
  const cacheKey = buildTeamNeedsCacheKey(
    teamId,
    safeGames,
    normalizedSeasonType,
  );

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, _cache: "HIT" };
    }
  }

  const targetTeamEfficiency = await getTeamEfficiency(teamId, {
    games: safeGames,
    forceRefresh,
    seasonType: normalizedSeasonType,
  });

  const leagueBaselineCacheKey = buildTeamNeedsLeagueBaselineCacheKey(
    safeGames,
    normalizedSeasonType,
  );

  let leagueBaseline = forceRefresh ? null : cache.get(leagueBaselineCacheKey);

  if (!leagueBaseline) {
    const allTeamsPayload = await getAllTeams({
      query: "",
      forceRefresh: false,
    });
    const teamIds = (allTeamsPayload?.teams || [])
      .map((team) => Number(team?.id))
      .filter((id) => Number.isInteger(id) && id > 0);

    const leagueRows = (
      await mapWithConcurrency(
        teamIds,
        (id) =>
          getTeamEfficiency(id, {
            games: safeGames,
            forceRefresh: false,
            seasonType: normalizedSeasonType,
          }).catch(() => null),
        6,
      )
    ).filter(Boolean);

    leagueBaseline = {
      benchmarkTeamsCount: leagueRows.length,
      leagueAverage: {
        pointsScored: roundNullable(
          average(leagueRows.map((row) => row?.aggregate?.pointsScored)),
        ),
        pointsAllowed: roundNullable(
          average(leagueRows.map((row) => row?.aggregate?.pointsAllowed)),
        ),
        possessions: roundNullable(
          average(leagueRows.map((row) => row?.aggregate?.possessions)),
        ),
        offRtg: roundNullable(
          average(leagueRows.map((row) => row?.aggregate?.offRtg)),
        ),
        defRtg: roundNullable(
          average(leagueRows.map((row) => row?.aggregate?.defRtg)),
        ),
        netRtg: roundNullable(
          average(leagueRows.map((row) => row?.aggregate?.netRtg)),
        ),
      },
      lastUpdatedAt: new Date().toISOString(),
    };

    cache.set(
      leagueBaselineCacheKey,
      leagueBaseline,
      TEAM_NEEDS_LEAGUE_BASELINE_TTL_MS,
    );
  }

  if (!leagueBaseline?.benchmarkTeamsCount) {
    const error = new Error("Unable to build league baseline for team needs");
    error.statusCode = 503;
    throw error;
  }

  const { benchmarkTeamsCount, leagueAverage } = leagueBaseline;

  const teamAggregate = {
    pointsScored: roundNullable(targetTeamEfficiency?.aggregate?.pointsScored),
    pointsAllowed: roundNullable(
      targetTeamEfficiency?.aggregate?.pointsAllowed,
    ),
    possessions: roundNullable(targetTeamEfficiency?.aggregate?.possessions),
    offRtg: roundNullable(targetTeamEfficiency?.aggregate?.offRtg),
    defRtg: roundNullable(targetTeamEfficiency?.aggregate?.defRtg),
    netRtg: roundNullable(targetTeamEfficiency?.aggregate?.netRtg),
  };

  const needSignals = buildTeamNeedSignals(teamAggregate, leagueAverage);

  const payload = {
    teamId: String(teamId),
    team: targetTeamEfficiency?.team || null,
    seasonTypeRequested: normalizedSeasonType,
    gamesRequested: safeGames,
    benchmarkTeamsCount,
    seasonsCovered: targetTeamEfficiency?.seasonsCovered || [],
    seasonTypesCovered: targetTeamEfficiency?.seasonTypesCovered || [],
    teamAggregate,
    leagueAverage,
    deltaFromLeague: needSignals.deltaFromLeague,
    strengths: needSignals.strengths,
    gaps: needSignals.gaps,
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, payload, TEAM_NEEDS_CACHE_TTL_MS);

  return { ...payload, _cache: "MISS" };
}

module.exports = {
  getTeamEfficiency,
  getTeamNeedGap,
};
