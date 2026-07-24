const {
  getPlayerProfile,
  comparePlayers,
  getPlayerImpact,
  getPlayerComps,
  getPlayerTrajectory,
} = require("../services/aggregation/playerAggregator");
const {
  getAthleteOptions: getPlayerOptions,
} = require("../services/espn/athletes.service");

function parseForceRefresh(query) {
  return String(query.forceRefresh || "false").toLowerCase() === "true";
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSeasonType(value) {
  const normalized = String(value || "all").toLowerCase();
  const allowed = new Set(["regular", "postseason", "all"]);
  return allowed.has(normalized) ? normalized : "all";
}

function parseCompSplit(value) {
  const normalized = String(value || "auto").toLowerCase();
  const allowed = new Set(["auto", "regular", "postseason", "career"]);
  return allowed.has(normalized) ? normalized : "auto";
}

function validateAthleteId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error(`${label} must be a positive integer`);
    error.statusCode = 400;
    throw error;
  }
  return id;
}

async function getPlayerProfileController(req, res) {
  const athleteId = validateAthleteId(req.params.athleteId, "athleteId");
  const forceRefresh = parseForceRefresh(req.query);

  const data = await getPlayerProfile(athleteId, { forceRefresh });

  return res.status(200).json({
    success: true,
    data,
  });
}

async function comparePlayersController(req, res) {
  const playerAId = validateAthleteId(req.query.playerAId, "playerAId");
  const playerBId = validateAthleteId(req.query.playerBId, "playerBId");
  const forceRefresh = parseForceRefresh(req.query);

  const data = await comparePlayers(playerAId, playerBId, { forceRefresh });

  return res.status(200).json({
    success: true,
    data,
  });
}

async function getPlayerOptionsController(req, res) {
  const forceRefresh = parseForceRefresh(req.query);
  const limit = parsePositiveInteger(req.query.limit, 1000);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const query = String(req.query.query || "");

  const data = await getPlayerOptions({
    query,
    limit,
    offset,
    forceRefresh,
  });

  return res.status(200).json({
    success: true,
    data,
  });
}

async function getAllPlayersController(req, res) {
  const forceRefresh = parseForceRefresh(req.query);

  const data = await getPlayerOptions({
    query: "",
    limit: 2000,
    offset: 0,
    forceRefresh,
  });

  return res.status(200).json({
    success: true,
    data,
  });
}

async function getPlayerImpactController(req, res) {
  const athleteId = validateAthleteId(req.params.athleteId, "athleteId");
  const forceRefresh = parseForceRefresh(req.query);
  const games = parsePositiveInteger(req.query.games, 10);
  const seasonType = parseSeasonType(req.query.seasonType);

  const data = await getPlayerImpact(athleteId, {
    games,
    seasonType,
    forceRefresh,
  });

  return res.status(200).json({
    success: true,
    data,
  });
}

async function getPlayerCompsController(req, res) {
  const athleteId = validateAthleteId(req.params.athleteId, "athleteId");
  const forceRefresh = parseForceRefresh(req.query);
  const limit = parsePositiveInteger(req.query.limit, 10);
  const sampleSize = parsePositiveInteger(req.query.sampleSize, 100);
  const split = parseCompSplit(req.query.split);

  const data = await getPlayerComps(athleteId, {
    limit,
    sampleSize,
    split,
    forceRefresh,
  });

  return res.status(200).json({
    success: true,
    data,
  });
}

async function getPlayerTrajectoryController(req, res) {
  const athleteId = validateAthleteId(req.params.athleteId, "athleteId");
  const forceRefresh = parseForceRefresh(req.query);
  const games = parsePositiveInteger(req.query.games, 20);
  const window = parsePositiveInteger(req.query.window, 5);
  const seasonType = parseSeasonType(req.query.seasonType);

  const data = await getPlayerTrajectory(athleteId, {
    games,
    window,
    seasonType,
    forceRefresh,
  });

  return res.status(200).json({
    success: true,
    data,
  });
}

module.exports = {
  getPlayerProfileController,
  comparePlayersController,
  getPlayerOptionsController,
  getAllPlayersController,
  getPlayerImpactController,
  getPlayerCompsController,
  getPlayerTrajectoryController,
};
