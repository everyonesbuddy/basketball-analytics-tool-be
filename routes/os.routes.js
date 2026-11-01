const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { dbReady } = require("../config/db");
const c = require("../controllers/os.controller");
const g = require("../controllers/gifting.controller");

const router = express.Router();

// The personal OS needs its database; say so plainly instead of hanging.
router.use((req, res, next) => {
  if (!dbReady()) return res.status(503).json({ success: false, error: { message: "The personal OS database isn't connected (MONGODB_URI)." } });
  return next();
});

router.post("/auth/login", asyncHandler(c.login));
router.use(requireAuth);
router.get("/auth/me", asyncHandler(c.me));
router.post("/auth/password", asyncHandler(c.changePassword));

router.get("/framework", c.framework);
router.get("/today", asyncHandler(c.today));

router.get("/goals", asyncHandler(c.listGoals));
router.post("/goals", asyncHandler(c.createGoal));
router.patch("/goals/:id", asyncHandler(c.updateGoal));
router.delete("/goals/:id", asyncHandler(c.deleteGoal));
router.post("/goals/:id/close", asyncHandler(c.closeGoal));

router.get("/logs", asyncHandler(c.listLogs));
router.post("/logs", asyncHandler(c.createLog));
router.delete("/logs/:id", asyncHandler(c.deleteLog));

router.get("/review", asyncHandler(c.getReview));
router.post("/review", asyncHandler(c.saveReview));

// Gifting
router.get("/gifting", asyncHandler(g.overview));
router.post("/gifting/people", asyncHandler(g.createPerson));
router.patch("/gifting/people/:id", asyncHandler(g.updatePerson));
router.delete("/gifting/people/:id", asyncHandler(g.deletePerson));
router.post("/gifting/people/:id/gifts", asyncHandler(g.logGift));
router.post("/gifting/plans/preview", asyncHandler(g.previewPlan));
router.post("/gifting/plans", asyncHandler(g.createPlan));
router.patch("/gifting/plans/:id", asyncHandler(g.updatePlan));
router.delete("/gifting/plans/:id", asyncHandler(g.deletePlan));
router.post("/gifting/link-preview", asyncHandler(g.linkPreview));
router.post("/gifting/ideas", asyncHandler(g.createIdea));
router.patch("/gifting/ideas/:id", asyncHandler(g.updateIdea));
router.delete("/gifting/ideas/:id", asyncHandler(g.deleteIdea));

module.exports = router;
