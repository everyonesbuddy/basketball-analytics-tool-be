/**
 * Create (or reset) a personal OS login and print a one-time password.
 *   node scripts/create-user.js you@example.com "Your Name"
 *   node scripts/create-user.js you@example.com --disable
 * On Heroku: heroku run node scripts/create-user.js you@example.com "Your Name"
 */
require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/userModel");

async function main() {
  const [email, nameOrFlag] = process.argv.slice(2);
  if (!email || !email.includes("@")) {
    console.error('Usage: node scripts/create-user.js you@example.com "Your Name"');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  if (nameOrFlag === "--disable") {
    const r = await User.updateOne({ email: email.toLowerCase() }, { $set: { active: false } });
    console.log(r.matchedCount ? `Disabled ${email}.` : `No user ${email}.`);
  } else {
    const password = crypto.randomBytes(12).toString("base64url");
    const passwordHash = await bcrypt.hash(password, 12);
    await User.findOneAndUpdate(
      { email: email.toLowerCase() },
      { $set: { passwordHash, active: true, failedLogins: 0, lockedUntil: null, ...(nameOrFlag ? { name: nameOrFlag } : {}) } },
      { upsert: true, new: true },
    );
    console.log(`Login ready for ${email}.`);
    console.log(`One-time password: ${password}`);
    console.log("Sign in, then change it under Settings.");
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
