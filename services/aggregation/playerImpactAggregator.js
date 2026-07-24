const cache = require("../../cache/memoryCache");
const { endpoints } = require("../../config/espnEndpoints");
const { getJson } = require("../espn/espnClient");
const { getAthleteGamelog } = require("../espn/athletes.service");
const {
  aggregatePlayerPlusMinus,
  extractPlayerPlusMinusFromSummary,
} = require("../analytics/plusMinus");

const PLAYER_IMPACT_CACHE_TTL_MS = 3 * 60 * 1000;

function buildPlayerImpactCacheKey(athleteId, games, seasonType) {
  return `player-impact:${athleteId}:${games}:${seasonType}`;
}

function normalizeSeasonType(value) {
  const normalized = String(value || "all").toLowerCase();
  const allowed = new Set(["regular", "postseason", "all"]);
  return allowed.has(normalized) ? normalized : "all";
}

function isSeasonTypeMatch(seasonType, gameSeasonType) {
  if (seasonType === "all") {
    return true;
  }

  return String(gameSeasonType || "").toLowerCase() === seasonType;
}

function getRecentGamelogEntries(gamelog, limit) {
  const entries = Object.values(gamelog?.events || {})
    .filter((entry) => entry?.id)
    .sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate));

  return entries.slice(0, limit);
}

function getCompetitors(summary) {
  return summary?.header?.competitions?.[0]?.competitors || [];
}

function getTeamAndOpponent(summary, teamId) {
  const competitors = getCompetitors(summary);
  const team = competitors.find(
    (item) => String(item?.team?.id) === String(teamId),
  );
  const opponent = competitors.find(
    (item) => String(item?.team?.id) !== String(teamId),
  );

  return {
    team: team || null,
    opponent: opponent || null,
  };
}

function formatScoreline(teamCompetitor, opponentCompetitor) {
  const teamScore = Number(teamCompetitor?.score);
  const opponentScore = Number(opponentCompetitor?.score);

  if (!Number.isFinite(teamScore) || !Number.isFinite(opponentScore)) {
    return null;
  }

  return `${teamScore}-${opponentScore}`;
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

function extractSeasonMeta(summary, game = {}) {
  const summarySeason = summary?.header?.season || {};
  const gameSeason = game?.season || {};
  const seasonTypeCode =
    summarySeason?.type ??
    summarySeason?.typeId ??
    gameSeason?.type ??
    gameSeason?.typeId ??
    null;

  return {
    seasonYear:
      Number(summarySeason?.year ?? gameSeason?.year) ||
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

async function getPlayerImpact(athleteId, options = {}) {
  const { games = 10, seasonType = "all", forceRefresh = false } = options;
  const normalizedSeasonType = normalizeSeasonType(seasonType);
  const safeGames = Math.max(1, Math.min(Number(games) || 10, 100));
  const cacheKey = buildPlayerImpactCacheKey(
    athleteId,
    safeGames,
    normalizedSeasonType,
  );

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, _cache: "HIT" };
    }
  }

  const gamelog = await getAthleteGamelog(athleteId);
  const recentGames = getRecentGamelogEntries(gamelog, safeGames * 3);
  const summaries = await Promise.all(
    recentGames.map((game) =>
      getJson(endpoints.summaryByEvent(game.id)).catch(() => null),
    ),
  );

  const gamesWithImpact = recentGames
    .map((game, index) => {
      const summary = summaries[index];
      const impact = summary
        ? extractPlayerPlusMinusFromSummary(summary, athleteId)
        : null;

      if (!impact || impact.plusMinus === null) {
        return null;
      }

      const seasonMeta = extractSeasonMeta(summary, game);

      return {
        eventId: game.id,
        gameDate: game.gameDate,
        seasonYear: seasonMeta.seasonYear,
        seasonType: seasonMeta.seasonType,
        seasonTypeCode: seasonMeta.seasonTypeCode,
        season: {
          year: seasonMeta.seasonYear,
          type: seasonMeta.seasonTypeCode,
        },
        gameStatus: {
          state:
            summary?.header?.competitions?.[0]?.status?.type?.state || null,
          detail:
            summary?.header?.competitions?.[0]?.status?.type?.detail || null,
          shortDetail:
            summary?.header?.competitions?.[0]?.status?.type?.shortDetail ||
            null,
          completed:
            summary?.header?.competitions?.[0]?.status?.type?.completed ||
            false,
        },
        matchup:
          summary?.header?.competitions?.[0]?.shortName ||
          summary?.header?.competitions?.[0]?.name ||
          null,
        opponent: compactTeam(game.opponent || {}),
        result: game.gameResult || null,
        homeTeamId: game.homeTeamId || null,
        awayTeamId: game.awayTeamId || null,
        team: compactTeam(impact.team || game.team || {}),
        score: (() => {
          const { team, opponent } = getTeamAndOpponent(
            summary,
            impact?.team?.id,
          );
          const teamScore = Number(team?.score);
          const opponentScore = Number(opponent?.score);

          return {
            team: Number.isFinite(teamScore) ? teamScore : null,
            opponent: Number.isFinite(opponentScore) ? opponentScore : null,
            scoreLine: formatScoreline(team, opponent),
            result:
              Number.isFinite(teamScore) && Number.isFinite(opponentScore)
                ? teamScore > opponentScore
                  ? "W"
                  : teamScore < opponentScore
                    ? "L"
                    : "T"
                : null,
          };
        })(),
        boxScore: impact.boxScore || null,
        plusMinus: impact.plusMinus,
      };
    })
    .filter(Boolean)
    .filter((game) => isSeasonTypeMatch(normalizedSeasonType, game?.seasonType))
    .slice(0, safeGames);

  const payload = aggregatePlayerPlusMinus(athleteId, gamesWithImpact, 5);
  const seasonCoverage = buildSeasonCoverage(gamesWithImpact);

  payload.seasonTypeRequested = normalizedSeasonType;
  payload.seasonsCovered = seasonCoverage.seasonsCovered;
  payload.seasonTypesCovered = seasonCoverage.seasonTypesCovered;

  cache.set(cacheKey, payload, PLAYER_IMPACT_CACHE_TTL_MS);

  return { ...payload, _cache: "MISS" };
}

module.exports = {
  getPlayerImpact,
};
