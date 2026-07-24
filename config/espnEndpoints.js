const SPORT = "basketball";
const LEAGUE = "nba";

const SITE_V2_BASE = `https://site.api.espn.com/apis/site/v2/sports/${SPORT}/${LEAGUE}`;
const SITE_STANDINGS_BASE = `https://site.api.espn.com/apis/v2/sports/${SPORT}/${LEAGUE}`;
const COMMON_V3_BASE = `https://site.web.api.espn.com/apis/common/v3/sports/${SPORT}/${LEAGUE}`;
const CORE_V2_BASE = `https://sports.core.api.espn.com/v2/sports/${SPORT}/leagues/${LEAGUE}`;
const CORE_V3_BASE = `https://sports.core.api.espn.com/v3/sports/${SPORT}/${LEAGUE}`;

const endpoints = {
  teams: () => `${SITE_V2_BASE}/teams`,
  teamById: (teamId) => `${SITE_V2_BASE}/teams/${teamId}`,
  teamRoster: (teamId) => `${SITE_V2_BASE}/teams/${teamId}/roster`,
  teamSchedule: (teamId) => `${SITE_V2_BASE}/teams/${teamId}/schedule`,
  teamInjuries: (teamId) => `${SITE_V2_BASE}/teams/${teamId}/injuries`,

  scoreboard: () => `${SITE_V2_BASE}/scoreboard`,
  summaryByEvent: (eventId) => `${SITE_V2_BASE}/summary?event=${eventId}`,
  standings: () => `${SITE_STANDINGS_BASE}/standings`,

  athleteOverview: (athleteId) =>
    `${COMMON_V3_BASE}/athletes/${athleteId}/overview`,
  athleteStats: (athleteId) => `${COMMON_V3_BASE}/athletes/${athleteId}/stats`,
  athleteSplits: (athleteId) =>
    `${COMMON_V3_BASE}/athletes/${athleteId}/splits`,
  athleteGamelog: (athleteId) =>
    `${COMMON_V3_BASE}/athletes/${athleteId}/gamelog`,

  coreAthleteById: (athleteId) => `${CORE_V2_BASE}/athletes/${athleteId}`,
  coreAthleteStatistics: (athleteId) =>
    `${CORE_V2_BASE}/athletes/${athleteId}/statistics`,
  coreAthleteEventlog: (athleteId) =>
    `${CORE_V2_BASE}/athletes/${athleteId}/eventlog`,

  allAthletes: (limit = 1000) => `${CORE_V3_BASE}/athletes?limit=${limit}`,
};

module.exports = {
  SPORT,
  LEAGUE,
  endpoints,
};
