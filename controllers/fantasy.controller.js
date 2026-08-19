const {
  getDraftBoard,
  getSleepers,
} = require("../services/aggregation/draftAssistant");
const {
  getFantasySeasonState,
} = require("../services/espn/fantasySeason.service");
const { analyzeTrade } = require("../services/aggregation/tradeAnalyzer");
const {
  getWaiverWire,
  getConsistencyLeaders,
  getStartSit,
} = require("../services/aggregation/inSeasonAssistant");
const { SCORING_IDS } = require("../config/nflEndpoints");

const ALLOWED_SCORING_IDS = new Set(Object.values(SCORING_IDS));
const ALLOWED_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DST", "FLEX"]);

function parseForceRefresh(query) {
  return String(query.forceRefresh || "false").toLowerCase() === "true";
}

function validateScoringId(value) {
  if (value === undefined || value === "") {
    return SCORING_IDS.PPR;
  }

  const scoringId = Number(value);
  if (!ALLOWED_SCORING_IDS.has(scoringId)) {
    const error = new Error(
      `scoringId must be one of ${[...ALLOWED_SCORING_IDS].join(", ")}`,
    );
    error.statusCode = 400;
    throw error;
  }

  return scoringId;
}

function validatePosition(value) {
  if (value === undefined || value === "") {
    return null;
  }

  const position = String(value).trim().toUpperCase();
  if (!ALLOWED_POSITIONS.has(position)) {
    const error = new Error(
      `position must be one of ${[...ALLOWED_POSITIONS].join(", ")}`,
    );
    error.statusCode = 400;
    throw error;
  }

  return position;
}

function validateSeason(value) {
  if (value === undefined || value === "") {
    return null;
  }

  const season = Number(value);
  if (!Number.isInteger(season) || season <= 2000) {
    const error = new Error("season must be a four-digit year after 2000");
    error.statusCode = 400;
    throw error;
  }

  return season;
}

function validateRosterSoFar(value) {
  if (value === undefined || value === "") {
    return [];
  }

  const rawIds = Array.isArray(value) ? value : String(value).split(",");

  return rawIds
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .map((entry) => {
      const id = Number(entry);
      if (!Number.isInteger(id) || id <= 0) {
        const error = new Error(
          "rosterSoFar must be a comma-separated list of positive integers",
        );
        error.statusCode = 400;
        throw error;
      }
      return id;
    });
}

function validatePlayerIds(value, label, required = false) {
  const ids = validateRosterSoFar(value);
  if (required && !ids.length) {
    const error = new Error(
      `${label} must contain at least one positive integer`,
    );
    error.statusCode = 400;
    throw error;
  }
  return ids;
}

function validateIntegerInRange(value, label, fallback, min, max) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    const error = new Error(
      `${label} must be an integer between ${min} and ${max}`,
    );
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function validateLeagueSettings(query = {}) {
  const teamCount = validateIntegerInRange(
    query.teamCount,
    "teamCount",
    12,
    2,
    32,
  );
  const starters = {};
  const raw = String(query.starters || "").trim();

  if (!raw) return { teamCount, starters };

  for (const entry of raw.split(",")) {
    const [position, count] = entry.split(":").map((part) => part.trim());
    if (!ALLOWED_POSITIONS.has(position) || !count) {
      const error = new Error(
        "starters must use QB,RB,WR,TE,FLEX,K,DST counts, e.g. QB:1,RB:2,WR:2,TE:1,FLEX:1",
      );
      error.statusCode = 400;
      throw error;
    }
    starters[position] = validateIntegerInRange(
      count,
      `starters.${position}`,
      0,
      0,
      10,
    );
  }

  return { teamCount, starters };
}

async function getDraftBoardController(req, res) {
  const scoringId = validateScoringId(req.query.scoringId);
  const position = validatePosition(req.query.position);
  const season = validateSeason(req.query.season);
  const rosterSoFar = validateRosterSoFar(req.query.rosterSoFar);
  const leagueSettings = validateLeagueSettings(req.query);
  const forceRefresh = parseForceRefresh(req.query);

  const data = await getDraftBoard({
    position,
    rosterSoFar,
    scoringId,
    season,
    leagueSettings,
    forceRefresh,
  });

  return res.status(200).json({
    success: true,
    data,
  });
}

async function getSeasonStateController(req, res) {
  const data = await getFantasySeasonState({
    forceRefresh: parseForceRefresh(req.query),
  });
  return res.status(200).json({ success: true, data });
}

async function getSleepersController(req, res) {
  const scoringId = validateScoringId(req.query.scoringId);
  const season = validateSeason(req.query.season);
  const forceRefresh = parseForceRefresh(req.query);

  const data = await getSleepers({ scoringId, season, forceRefresh });

  return res.status(200).json({
    success: true,
    data,
  });
}

async function analyzeTradeController(req, res) {
  const data = await analyzeTrade({
    sideAIds: validatePlayerIds(req.query.sideA, "sideA", true),
    sideBIds: validatePlayerIds(req.query.sideB, "sideB", true),
    scoringId: validateScoringId(req.query.scoringId),
    season: validateSeason(req.query.season),
    leagueSettings: validateLeagueSettings(req.query),
    forceRefresh: parseForceRefresh(req.query),
  });
  return res.status(200).json({ success: true, data });
}

async function getWaiverWireController(req, res) {
  const data = await getWaiverWire({
    scoringId: validateScoringId(req.query.scoringId),
    season: validateSeason(req.query.season),
    ownershipMax: validateIntegerInRange(
      req.query.ownershipMax,
      "ownershipMax",
      50,
      0,
      100,
    ),
    window: validateIntegerInRange(req.query.window, "window", 4, 2, 10),
    forceRefresh: parseForceRefresh(req.query),
  });
  return res.status(200).json({ success: true, data });
}

async function getConsistencyController(req, res) {
  const data = await getConsistencyLeaders({
    scoringId: validateScoringId(req.query.scoringId),
    season: validateSeason(req.query.season),
    window: validateIntegerInRange(req.query.window, "window", 4, 3, 10),
    forceRefresh: parseForceRefresh(req.query),
  });
  return res.status(200).json({ success: true, data });
}

async function getStartSitController(req, res) {
  const data = await getStartSit({
    playerIds: validatePlayerIds(req.query.playerIds, "playerIds", true),
    scoringId: validateScoringId(req.query.scoringId),
    season: validateSeason(req.query.season),
    window: validateIntegerInRange(req.query.window, "window", 4, 2, 10),
    forceRefresh: parseForceRefresh(req.query),
  });
  return res.status(200).json({ success: true, data });
}

module.exports = {
  getSeasonStateController,
  getDraftBoardController,
  getSleepersController,
  analyzeTradeController,
  getWaiverWireController,
  getConsistencyController,
  getStartSitController,
};
