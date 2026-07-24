const express = require("express");
const playersRoutes = require("./players.routes");
const teamsRoutes = require("./teams.routes");

const router = express.Router();

router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Basketball analytics backend is running",
    timestamp: new Date().toISOString(),
  });
});

router.use("/players", playersRoutes);
router.use("/teams", teamsRoutes);

module.exports = router;
