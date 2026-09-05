const cache = require("../../cache/memoryCache");
const { getAllTeams } = require("../espn/teams.service");
const {
  getTeamEfficiency,
  mapWithConcurrency,
} = require("./teamEfficiencyAggregator");
const { gradeTeam, compareTeams } = require("../analytics/teamGrade");

const TEAM_GRADE_TTL_MS = 10 * 60 * 1000;
const TEAM_COMPARE_TTL_MS = 5 * 60 * 1000;
const TEAM_LEAGUE_ROWS_TTL_MS = 10 * 60 * 1000;

function normalizeOptions(options = {}) {
  const games = Math.max(1, Math.min(Number(options.games) || 5, 15));
  const seasonType = ["regular", "postseason", "all"].includes(
    String(options.seasonType || "regular").toLowerCase(),
  )
    ? String(options.seasonType || "regular").toLowerCase()
    : "regular";

  return { games, seasonType, forceRefresh: Boolean(options.forceRefresh) };
}

async function getLeagueRows(options = {}) {
  const { games, seasonType, forceRefresh } = normalizeOptions(options);
  const cacheKey = `team-grade:league:${games}:${seasonType}`;

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const allTeams = await getAllTeams({ forceRefresh: false });
  const teamIds = (allTeams.teams || [])
    .map((team) => Number(team.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  const rows = (
    await mapWithConcurrency(
      teamIds,
      (teamId) =>
        getTeamEfficiency(teamId, {
          games,
          seasonType,
          forceRefresh: false,
        }).catch(() => null),
      6,
    )
  ).filter((row) => row?.aggregate);

  const result = {
    games,
    seasonType,
    rows,
    lastUpdatedAt: new Date().toISOString(),
  };
  cache.set(cacheKey, result, TEAM_LEAGUE_ROWS_TTL_MS);
  return result;
}

function compactGrade(grade) {
  return {
    score: grade.score,
    grade: grade.grade,
    metrics: grade.metrics,
    strengths: grade.strengths,
    weaknesses: grade.weaknesses,
    leagueSampleSize: grade.leagueSampleSize,
    gamesPlayed: grade.gamesPlayed,
  };
}

function compactTeamIdentity(teamPayload) {
  const team = teamPayload?.team || teamPayload || {};
  return {
    id: team.id ? String(team.id) : null,
    displayName: team.displayName || null,
    shortDisplayName: team.shortDisplayName || null,
    abbreviation: team.abbreviation || null,
    logo: team.logo || team.logos?.[0]?.href || null,
  };
}

async function getTeamGrade(teamId, options = {}) {
  const normalized = normalizeOptions(options);
  const cacheKey = `team-grade:${teamId}:${normalized.games}:${normalized.seasonType}`;

  if (!normalized.forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, _cache: "HIT" };
  }

  const [teamEfficiency, league] = await Promise.all([
    getTeamEfficiency(teamId, normalized),
    getLeagueRows(normalized),
  ]);
  const grade = gradeTeam(teamEfficiency, league.rows);
  const payload = {
    teamId: String(teamId),
    team: compactTeamIdentity(teamEfficiency.team),
    gamesRequested: normalized.games,
    gamesPlayed: teamEfficiency.gamesPlayed,
    seasonTypeRequested: normalized.seasonType,
    seasonsCovered: teamEfficiency.seasonsCovered,
    seasonTypesCovered: teamEfficiency.seasonTypesCovered,
    grade: compactGrade(grade),
    aggregate: teamEfficiency.aggregate,
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, payload, TEAM_GRADE_TTL_MS);
  return { ...payload, _cache: "MISS" };
}

async function compareTeamHeadToHead(teamAId, teamBId, options = {}) {
  const normalized = normalizeOptions(options);
  const orderedIds = [Number(teamAId), Number(teamBId)].sort((a, b) => a - b);
  const cacheKey = `team-compare:${orderedIds.join(":")}:${normalized.games}:${normalized.seasonType}`;

  if (!normalized.forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, _cache: "HIT" };
  }

  const [teamA, teamB, league] = await Promise.all([
    getTeamEfficiency(teamAId, normalized),
    getTeamEfficiency(teamBId, normalized),
    getLeagueRows(normalized),
  ]);
  const gradeA = gradeTeam(teamA, league.rows);
  const gradeB = gradeTeam(teamB, league.rows);
  const comparison = compareTeams(teamA, teamB);
  const payload = {
    teamA: {
      teamId: String(teamAId),
      team: compactTeamIdentity(teamA.team),
      aggregate: teamA.aggregate,
      grade: compactGrade(gradeA),
    },
    teamB: {
      teamId: String(teamBId),
      team: compactTeamIdentity(teamB.team),
      aggregate: teamB.aggregate,
      grade: compactGrade(gradeB),
    },
    gamesRequested: normalized.games,
    seasonTypeRequested: normalized.seasonType,
    comparison,
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, payload, TEAM_COMPARE_TTL_MS);
  return { ...payload, _cache: "MISS" };
}

module.exports = {
  TEAM_GRADE_TTL_MS,
  TEAM_COMPARE_TTL_MS,
  getTeamGrade,
  compareTeamHeadToHead,
};
