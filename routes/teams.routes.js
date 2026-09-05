const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const {
  getAllTeamsController,
  getTeamEfficiencyController,
  getTeamNeedGapController,
  getTeamGradeController,
  compareTeamsController,
} = require("../controllers/teams.controller");

const router = express.Router();

router.get("/", asyncHandler(getAllTeamsController));
router.get("/compare/head-to-head", asyncHandler(compareTeamsController));
router.get("/:teamId/efficiency", asyncHandler(getTeamEfficiencyController));
router.get("/:teamId/needs", asyncHandler(getTeamNeedGapController));
router.get("/:teamId/grade", asyncHandler(getTeamGradeController));

module.exports = router;
