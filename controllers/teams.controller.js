const {
  getTeamEfficiency,
  getTeamNeedGap,
} = require("../services/aggregation/teamEfficiencyAggregator");
const { getAllTeams } = require("../services/espn/teams.service");

function parseForceRefresh(query) {
  return String(query.forceRefresh || "false").toLowerCase() === "true";
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSeasonType(value) {
  const normalized = String(value || "regular").toLowerCase();
  const allowed = new Set(["regular", "postseason", "all"]);
  return allowed.has(normalized) ? normalized : "regular";
}

function validateTeamId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error("teamId must be a positive integer");
    error.statusCode = 400;
    throw error;
  }

  return id;
}

async function getTeamEfficiencyController(req, res) {
  const teamId = validateTeamId(req.params.teamId);
  const forceRefresh = parseForceRefresh(req.query);
  const games = parsePositiveInteger(req.query.games, 5);
  const seasonType = parseSeasonType(req.query.seasonType);

  const data = await getTeamEfficiency(teamId, {
    games,
    forceRefresh,
    seasonType,
  });

  return res.status(200).json({
    success: true,
    data,
  });
}

async function getAllTeamsController(req, res) {
  const forceRefresh = parseForceRefresh(req.query);
  const query = String(req.query.query || "");

  const data = await getAllTeams({
    query,
    forceRefresh,
  });

  return res.status(200).json({
    success: true,
    data,
  });
}

async function getTeamNeedGapController(req, res) {
  const teamId = validateTeamId(req.params.teamId);
  const forceRefresh = parseForceRefresh(req.query);
  const games = parsePositiveInteger(req.query.games, 5);
  const seasonType = parseSeasonType(req.query.seasonType);

  const data = await getTeamNeedGap(teamId, {
    games,
    forceRefresh,
    seasonType,
  });

  return res.status(200).json({
    success: true,
    data,
  });
}

module.exports = {
  getAllTeamsController,
  getTeamEfficiencyController,
  getTeamNeedGapController,
};
