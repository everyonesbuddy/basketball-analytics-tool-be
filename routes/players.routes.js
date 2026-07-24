const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const {
  getPlayerProfileController,
  comparePlayersController,
  getPlayerOptionsController,
  getAllPlayersController,
  getPlayerImpactController,
  getPlayerCompsController,
  getPlayerTrajectoryController,
} = require("../controllers/players.controller");

const router = express.Router();

router.get("/compare/head-to-head", asyncHandler(comparePlayersController));
router.get("/all", asyncHandler(getAllPlayersController));
router.get("/options", asyncHandler(getPlayerOptionsController));
router.get("/:athleteId/impact", asyncHandler(getPlayerImpactController));
router.get("/:athleteId/comps", asyncHandler(getPlayerCompsController));
router.get(
  "/:athleteId/trajectory",
  asyncHandler(getPlayerTrajectoryController),
);
router.get("/:athleteId", asyncHandler(getPlayerProfileController));

module.exports = router;
