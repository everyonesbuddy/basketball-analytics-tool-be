const express = require("express");
const playersRoutes = require("./players.routes");
const teamsRoutes = require("./teams.routes");
const fantasyRoutes = require("./fantasy.routes");
const nbaFantasyRoutes = require("./nbaFantasy.routes");
const osRoutes = require("./os.routes");

const router = express.Router();

router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Personal OS backend is running",
    timestamp: new Date().toISOString(),
  });
});

router.use("/players", playersRoutes);
router.use("/teams", teamsRoutes);
router.use("/fantasy/nba", nbaFantasyRoutes);
router.use("/fantasy", fantasyRoutes);

// The personal OS (signed in): goals, schedule, and the widgets to come.
router.use("/os", osRoutes);

module.exports = router;
