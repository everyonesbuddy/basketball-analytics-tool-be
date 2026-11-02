const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { dbReady } = require("../config/db");
const c = require("../controllers/os.controller");
const g = require("../controllers/gifting.controller");
const st = require("../controllers/style.controller");
const ev = require("../controllers/events.controller");
const fd = require("../controllers/food.controller");
const pu = require("../controllers/push.controller");

const router = express.Router();

// The personal OS needs its database; say so plainly instead of hanging.
router.use((req, res, next) => {
  if (!dbReady()) return res.status(503).json({ success: false, error: { message: "The personal OS database isn't connected (MONGODB_URI)." } });
  return next();
});

router.post("/auth/login", asyncHandler(c.login));
// Push: the runner (outside pinger, secret key) and notification buttons (action token) don't use the sign-in token.
router.all("/push/run", asyncHandler(pu.run));
router.post("/push/action", asyncHandler(pu.action));
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
router.delete("/gifting/people/:id/gifts/:giftId", asyncHandler(g.deleteGift));
router.post("/gifting/plans/preview", asyncHandler(g.previewPlan));
router.post("/gifting/plans", asyncHandler(g.createPlan));
router.patch("/gifting/plans/:id", asyncHandler(g.updatePlan));
router.delete("/gifting/plans/:id", asyncHandler(g.deletePlan));
router.post("/gifting/link-preview", asyncHandler(g.linkPreview));
router.post("/gifting/ideas", asyncHandler(g.createIdea));
router.patch("/gifting/ideas/:id", asyncHandler(g.updateIdea));
router.delete("/gifting/ideas/:id", asyncHandler(g.deleteIdea));

// Style
router.get("/style", asyncHandler(st.overview));
router.post("/style/suggest", asyncHandler(st.suggest));
router.put("/style/profile", asyncHandler(st.saveProfile));
router.post("/style/wardrobe", asyncHandler(st.addItem));
router.patch("/style/wardrobe/:id", asyncHandler(st.updateItem));
router.delete("/style/wardrobe/:id", asyncHandler(st.deleteItem));
router.post("/style/worn", asyncHandler(st.logOutfit));
router.delete("/style/worn/:id", asyncHandler(st.deleteLog));
router.post("/style/shop", asyncHandler(st.addShop));
router.patch("/style/shop/:id", asyncHandler(st.updateShop));
router.delete("/style/shop/:id", asyncHandler(st.deleteShop));

// Events & concerts
router.get("/events", asyncHandler(ev.overview));
router.put("/events/settings", asyncHandler(ev.saveSettings));
router.get("/events/search", asyncHandler(ev.searchAttractions));
router.post("/events/follows", asyncHandler(ev.follow));
router.delete("/events/follows/:id", asyncHandler(ev.unfollow));
router.get("/events/following", asyncHandler(ev.following));
router.get("/events/nearby", asyncHandler(ev.nearby));
router.post("/events/saved", asyncHandler(ev.save));
router.patch("/events/saved/:id", asyncHandler(ev.updateSaved));
router.delete("/events/saved/:id", asyncHandler(ev.removeSaved));

// Food
router.get("/food", asyncHandler(fd.overview));
router.post("/food/suggest", asyncHandler(fd.suggest));
router.put("/food/settings", asyncHandler(fd.saveSettings));
router.post("/food/vote", asyncHandler(fd.vote));
router.post("/food/ate", asyncHandler(fd.ate));
router.delete("/food/ate/:id", asyncHandler(fd.unate));
router.post("/food/plan/preview", asyncHandler(fd.previewPlan));
router.post("/food/plan", asyncHandler(fd.savePlan));
router.patch("/food/plan/:id", asyncHandler(fd.tickGrocery));
router.delete("/food/plan/:id", asyncHandler(fd.deletePlan));
router.post("/food/meals", asyncHandler(fd.addMeal));
router.delete("/food/meals/:id", asyncHandler(fd.deleteMeal));

// Push notifications
router.get("/push/key", asyncHandler(pu.key));
router.post("/push/subscribe", asyncHandler(pu.subscribe));
router.get("/push/devices", asyncHandler(pu.devices));
router.delete("/push/devices/:id", asyncHandler(pu.removeDevice));
router.get("/push/settings", asyncHandler(pu.getSettings));
router.put("/push/settings", asyncHandler(pu.saveSettings));
router.post("/push/test", asyncHandler(pu.test));

module.exports = router;
