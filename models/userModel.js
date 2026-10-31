const mongoose = require("mongoose");

// The person (or people) who can sign in to the personal OS.
const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, trim: true, default: "" },
    passwordHash: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.models.OsUser || mongoose.model("OsUser", userSchema, "os_users");
