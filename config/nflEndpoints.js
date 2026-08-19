const SPORT = "football";
const LEAGUE = "nfl";

const SITE_V2_BASE = `https://site.api.espn.com/apis/site/v2/sports/${SPORT}/${LEAGUE}`;
const COMMON_V3_BASE = `https://site.web.api.espn.com/apis/common/v3/sports/${SPORT}/${LEAGUE}`;
const CORE_V2_BASE = `https://sports.core.api.espn.com/v2/sports/${SPORT}/leagues/${LEAGUE}`;

// Reads host only. fantasy.espn.com 302s every /apis/v3 request to the marketing site.
const FANTASY_READS_BASE =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

const SCORING_IDS = {
  STANDARD: 1,
  PPR: 3,
  HALF_PPR: 4,
};

const SCORING_LABELS = {
  1: "standard",
  3: "ppr",
  4: "half_ppr",
};

const endpoints = {
  teams: () => `${SITE_V2_BASE}/teams`,
  teamRoster: (teamId) => `${SITE_V2_BASE}/teams/${teamId}/roster`,

  athleteOverview: (athleteId) =>
    `${COMMON_V3_BASE}/athletes/${athleteId}/overview`,
  coreAthleteStatistics: (athleteId) =>
    `${CORE_V2_BASE}/athletes/${athleteId}/statistics`,

  // kona_player_info is only honoured on the leaguedefaults route, which evaluates
  // projections against a public scoring profile. /seasons/{year}/players ignores it.
  fantasyPlayers: (season, scoringId) =>
    `${FANTASY_READS_BASE}/seasons/${season}/segments/0/leaguedefaults/${scoringId}`,
  fantasyGame: () => FANTASY_READS_BASE,
};

module.exports = {
  SPORT,
  LEAGUE,
  SCORING_IDS,
  SCORING_LABELS,
  endpoints,
};
