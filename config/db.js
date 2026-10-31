const mongoose = require("mongoose");

// The personal OS keeps its data in MongoDB (Atlas free tier is enough).
// The sports tools don't need it, so the server still starts without it.
let connecting = null;

function dbConfigured() {
  return Boolean(process.env.MONGODB_URI);
}

function connectDb() {
  if (!dbConfigured()) {
    console.warn("MONGODB_URI is not set: the personal OS is off, sports tools still work.");
    return Promise.resolve(null);
  }
  if (!connecting) {
    connecting = mongoose.connect(process.env.MONGODB_URI).then(
      (m) => {
        console.log("MongoDB connected");
        return m;
      },
      (err) => {
        console.error("MongoDB connection failed:", err.message);
        connecting = null;
        return null;
      },
    );
  }
  return connecting;
}

const dbReady = () => mongoose.connection.readyState === 1;

module.exports = { connectDb, dbConfigured, dbReady };
