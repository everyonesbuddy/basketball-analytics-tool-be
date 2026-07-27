const cache = require("../../cache/memoryCache");
const { endpoints } = require("../../config/espnEndpoints");
const { getJson } = require("./espnClient");

const PLAYER_OPTIONS_CACHE_TTL_MS = 15 * 60 * 1000;
const PLAYER_DIRECTORY_FETCH_LIMIT = 2000;

function normalizeSearchValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function buildPlayerOption(item) {
  const id = String(item?.id || "");
  const label = item?.displayName || item?.fullName || item?.shortName || null;

  if (!id || !label) {
    return null;
  }

  return {
    id,
    label,
  };
}

function playerOptionMatches(option, searchText) {
  if (!searchText) {
    return true;
  }

  const haystack = [option.id, option.label].join(" ").toLowerCase();
  return haystack.includes(searchText);
}

async function getAthleteOverview(athleteId) {
  return getJson(endpoints.athleteOverview(athleteId));
}

async function getAthleteStats(athleteId) {
  return getJson(endpoints.athleteStats(athleteId));
}

async function getAthleteSplits(athleteId, params = {}) {
  return getJson(endpoints.athleteSplits(athleteId), params);
}

async function getAthleteGamelog(athleteId) {
  return getJson(endpoints.athleteGamelog(athleteId));
}

async function getCoreAthleteProfile(athleteId) {
  return getJson(endpoints.coreAthleteById(athleteId));
}

async function getCoreAthleteStatistics(athleteId, params = {}) {
  return getJson(endpoints.coreAthleteStatistics(athleteId), params);
}

async function getAthleteSplitViews(athleteId) {
  const [regularSeason, career] = await Promise.all([
    getAthleteSplits(athleteId),
    getAthleteSplits(athleteId, { season: 0 }),
  ]);

  return {
    regularSeason,
    postSeason: null,
    career,
  };
}

async function getAthleteOptions(options = {}) {
  const {
    query = "",
    limit = 1000,
    offset = 0,
    forceRefresh = false,
  } = options;
  const normalizedQuery = normalizeSearchValue(query);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 2000));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const cacheKey = `player-options:${safeLimit}:${safeOffset}:${normalizedQuery}`;

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, _cache: "HIT" };
    }
  }

  const fetchLimit = Math.max(safeLimit, PLAYER_DIRECTORY_FETCH_LIMIT);
  const directory = await getJson(endpoints.allAthletes(fetchLimit));
  const items = Array.isArray(directory?.items) ? directory.items : [];

  const optionsList = items
    .map(buildPlayerOption)
    .filter(Boolean)
    .filter((option) => playerOptionMatches(option, normalizedQuery))
    .slice(safeOffset, safeOffset + safeLimit);

  const payload = {
    query: query || "",
    count: optionsList.length,
    options: optionsList,
    sourceCount: items.length,
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, payload, PLAYER_OPTIONS_CACHE_TTL_MS);

  return { ...payload, _cache: "MISS" };
}

async function getAthleteBundle(athleteId) {
  const [overview, stats, splits, gamelog, coreProfileResult, splitViews] =
    await Promise.all([
      getAthleteOverview(athleteId),
      getAthleteStats(athleteId),
      getAthleteSplits(athleteId),
      getAthleteGamelog(athleteId),
      getCoreAthleteProfile(athleteId)
        .then((value) => ({ ok: true, value }))
        .catch(() => ({ ok: false, value: null })),
      getAthleteSplitViews(athleteId).catch(() => ({
        regularSeason: null,
        postSeason: null,
        career: null,
      })),
    ]);

  return {
    overview,
    stats,
    splits,
    splitViews,
    gamelog,
    coreProfile: coreProfileResult.ok ? coreProfileResult.value : null,
  };
}

module.exports = {
  getAthleteOverview,
  getAthleteStats,
  getAthleteSplits,
  getAthleteGamelog,
  getCoreAthleteProfile,
  getCoreAthleteStatistics,
  getAthleteSplitViews,
  getAthleteOptions,
  getAthleteBundle,
};
