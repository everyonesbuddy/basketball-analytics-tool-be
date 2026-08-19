const cache = require("../../../cache/memoryCache");
const { endpoints } = require("../../../config/nflEndpoints");
const { getJson } = require("../espnClient");

const NFL_TEAMS_CACHE_TTL_MS = 15 * 60 * 1000;

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

async function getNflTeams(options = {}) {
  const { forceRefresh = false } = options;
  const cacheKey = "nfl-teams:all";

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
      .sort((a, b) => a.displayName.localeCompare(b.displayName)) || [];

  const result = {
    count: teams.length,
    teams,
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, result, NFL_TEAMS_CACHE_TTL_MS);

  return { ...result, _cache: "MISS" };
}

/** ESPN's fantasy proTeamId matches the NFL site API team id. */
async function getNflTeamsById(options = {}) {
  const { teams } = await getNflTeams(options);
  const index = new Map();

  for (const team of teams) {
    index.set(Number(team.id), team);
  }

  return index;
}

module.exports = {
  getNflTeams,
  getNflTeamsById,
};
