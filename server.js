require("dotenv").config();

const cron = require("node-cron");
const app = require("./app");
const { connectDb, dbReady } = require("./config/db");

const PORT = Number(process.env.PORT) || 5000;

connectDb();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Push notifications: every 5 minutes while the server is awake. An outside
// pinger hitting /api/os/push/run keeps it awake and on time; each
// notification is only ever sent once.
cron.schedule("*/5 * * * *", () => {
  if (!dbReady()) return;
  require("./controllers/push.controller")
    .runAll()
    .catch((err) => console.error("Push run failed:", err.message));
});
