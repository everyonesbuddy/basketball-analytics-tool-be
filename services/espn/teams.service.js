const cache = require("../../cache/memoryCache");
const { endpoints } = require("../../config/espnEndpoints");
const { getJson } = require("./espnClient");

const TEAMS_CACHE_TTL_MS = 15 * 60 * 1000;

function compactTeam(team = {}) {
  return {
    id: team?.id ? String(team.id) : null,
    displayName: team?.displayName || null,
    shortDisplayName: team?.shortDisplayName || null,
    abbreviation: team?.abbreviation || null,
    location: team?.location || null,
    name: team?.name || null,
    logo: team?.logo || team?.logos?.[0]?.href || null,
    isActive: Boolean(team?.isActive),
  };
}

function matchesQuery(team, query) {
  if (!query) {
    return true;
  }

  const normalizedQuery = String(query).trim().toLowerCase();
  const haystack = [
    team.displayName,
    team.shortDisplayName,
    team.abbreviation,
    team.location,
    team.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

async function getAllTeams(options = {}) {
  const { query = "", forceRefresh = false } = options;
  const normalizedQuery = String(query || "")
    .trim()
    .toLowerCase();
  const cacheKey = `teams:all:${normalizedQuery}`;

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, _cache: "HIT" };
    }
  }

  const payload = await getJson(endpoints.teams());
  const teams =
    payload?.sports?.[0]?.leagues?.[0]?.teams
      ?.map((item) => compactTeam(item?.team || {}))
      .filter((item) => item.id && item.displayName)
      .filter((team) => matchesQuery(team, normalizedQuery))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)) || [];

  const result = {
    query,
    count: teams.length,
    teams,
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, result, TEAMS_CACHE_TTL_MS);

  return { ...result, _cache: "MISS" };
}

async function getTeamProfile(teamId) {
  return getJson(endpoints.teamById(teamId));
}

async function getTeamRoster(teamId) {
  return getJson(endpoints.teamRoster(teamId));
}

async function getTeamSchedule(teamId, params = {}) {
  return getJson(endpoints.teamSchedule(teamId), params);
}

module.exports = {
  getAllTeams,
  getTeamProfile,
  getTeamRoster,
  getTeamSchedule,
};
