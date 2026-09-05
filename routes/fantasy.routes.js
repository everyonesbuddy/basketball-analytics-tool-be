const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const {
  getSeasonStateController,
  getDraftBoardController,
  getSleepersController,
  analyzeTradeController,
  getWaiverWireController,
  getConsistencyController,
  getStartSitController,
  compareFantasyPlayersController,
  compareFantasyTeamsController,
  getFantasyTeamGradeController,
} = require("../controllers/fantasy.controller");

const router = express.Router();

router.get("/season", asyncHandler(getSeasonStateController));
router.get("/draft-board", asyncHandler(getDraftBoardController));
router.get("/sleepers", asyncHandler(getSleepersController));
router.get(
  "/compare/head-to-head",
  asyncHandler(compareFantasyTeamsController),
);
router.get("/compare/players", asyncHandler(compareFantasyPlayersController));
router.get("/team-grade", asyncHandler(getFantasyTeamGradeController));
router.get("/trades/analyze", asyncHandler(analyzeTradeController));
router.get("/waivers", asyncHandler(getWaiverWireController));
router.get("/consistency", asyncHandler(getConsistencyController));
router.get("/start-sit", asyncHandler(getStartSitController));

module.exports = router;
