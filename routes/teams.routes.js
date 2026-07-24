const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const {
  getAllTeamsController,
  getTeamEfficiencyController,
  getTeamNeedGapController,
} = require("../controllers/teams.controller");

const router = express.Router();

router.get("/", asyncHandler(getAllTeamsController));
router.get("/:teamId/efficiency", asyncHandler(getTeamEfficiencyController));
router.get("/:teamId/needs", asyncHandler(getTeamNeedGapController));

module.exports = router;
