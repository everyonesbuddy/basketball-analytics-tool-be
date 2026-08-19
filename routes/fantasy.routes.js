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
} = require("../controllers/fantasy.controller");

const router = express.Router();

router.get("/season", asyncHandler(getSeasonStateController));
router.get("/draft-board", asyncHandler(getDraftBoardController));
router.get("/sleepers", asyncHandler(getSleepersController));
router.get("/trades/analyze", asyncHandler(analyzeTradeController));
router.get("/waivers", asyncHandler(getWaiverWireController));
router.get("/consistency", asyncHandler(getConsistencyController));
router.get("/start-sit", asyncHandler(getStartSitController));

module.exports = router;
