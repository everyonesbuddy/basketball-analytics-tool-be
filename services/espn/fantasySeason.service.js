const cache = require("../../cache/memoryCache");
const { endpoints } = require("../../config/nflEndpoints");
const { getJson } = require("./espnClient");

const FANTASY_SEASON_STATE_TTL_MS = 15 * 60 * 1000;

async function getFantasySeasonState(options = {}) {
  const { forceRefresh = false } = options;
  const cacheKey = "fantasy-season-state";

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, _cache: "HIT" };
    }
  }

  const url = endpoints.fantasyGame();
  const payload = await getJson(url);
  const season = payload?.currentSeason;
  const seasonId = Number(season?.id);

  if (!Number.isInteger(seasonId) || seasonId <= 2000) {
    const error = new Error(
      `ESPN fantasy response missing current season for ${url}`,
    );
    error.statusCode = 502;
    error.isUpstreamError = true;
    error.url = url;
    throw error;
  }

  const result = {
    season: seasonId,
    name: season?.name || null,
    active: Boolean(season?.active),
    currentScoringPeriod: Number(season?.currentScoringPeriod?.id) || null,
    startDate: season?.startDate
      ? new Date(season.startDate).toISOString()
      : null,
    endDate: season?.endDate ? new Date(season.endDate).toISOString() : null,
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, result, FANTASY_SEASON_STATE_TTL_MS);
  return { ...result, _cache: "MISS" };
}

module.exports = {
  FANTASY_SEASON_STATE_TTL_MS,
  getFantasySeasonState,
};
