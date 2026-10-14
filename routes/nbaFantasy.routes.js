const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const {
  getSeasonStateController,
  getDraftSimulatorController,
  getDraftBoardController,
  getSleepersController,
  analyzeTradeController,
  compareFantasyPlayersController,
  compareFantasyTeamsController,
  getFantasyTeamGradeController,
} = require("../controllers/fantasy.controller");

const router = express.Router();

router.use((req, _res, next) => {
  req.fantasySport = "nba";
  next();
});

router.get("/season", asyncHandler(getSeasonStateController));
router.get("/draft-board", asyncHandler(getDraftBoardController));
router.get("/draft-simulator", asyncHandler(getDraftSimulatorController));
router.get("/sleepers", asyncHandler(getSleepersController));
router.get(
  "/compare/head-to-head",
  asyncHandler(compareFantasyTeamsController),
);
router.get("/compare/players", asyncHandler(compareFantasyPlayersController));
router.get("/team-grade", asyncHandler(getFantasyTeamGradeController));
router.get("/trades/analyze", asyncHandler(analyzeTradeController));

module.exports = router;
