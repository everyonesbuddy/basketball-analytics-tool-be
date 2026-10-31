/**
 * One-off cleanup: remove what the personal OS wrote into the WiserShifts
 * database. Looks first (dry run), changes nothing unless you add --apply.
 * Delete this file once you've run it.
 *
 * Run it from the basketball-analytics-tool-be folder:
 *   PowerShell:
 *     $env:WS_URI="mongodb+srv://...the WiserShifts connection string..."
 *     node scripts/cleanup-wisershifts-db.js            # look only
 *     node scripts/cleanup-wisershifts-db.js --apply    # then clean up
 *
 * What it does with --apply:
 *  - drops goals, goallogs and reviews, but only if every document in them
 *    looks like a personal OS document (WiserShifts doesn't use these names)
 *  - deletes users with no tenantId (every WiserShifts user has one, so these
 *    can only be personal OS logins)
 *  - on a WiserShifts user the OS script touched (found by the email you give
 *    with --email), removes the OS-only fields. It can't restore the old
 *    password: reset that in WiserShifts.
 */
const mongoose = require("mongoose");

const apply = process.argv.includes("--apply");
const emailArg = process.argv.find((a) => a.startsWith("--email="));
const email = emailArg ? emailArg.slice(8).toLowerCase() : null;

const OS_SHAPES = {
  goals: (d) => d.owner && d.category && d.windowStart && d.windowEnd && !d.tenantId,
  goallogs: (d) => d.owner && d.goal && d.mode && !d.tenantId,
  reviews: (d) => d.owner && d.week && Array.isArray(d.entries) && !d.tenantId,
};
const OS_USER_FIELDS = ["active", "failedLogins", "lockedUntil", "lastLoginAt"];

async function main() {
  if (!process.env.WS_URI) {
    console.error('Set WS_URI first: $env:WS_URI="mongodb+srv://..."');
    process.exit(1);
  }
  await mongoose.connect(process.env.WS_URI);
  const db = mongoose.connection.db;
  console.log(`Connected to database "${db.databaseName}". ${apply ? "APPLYING changes." : "Dry run: nothing will change."}\n`);
  const names = new Set((await db.listCollections().toArray()).map((c) => c.name));

  // 1. The OS's own collections
  for (const [name, isOs] of Object.entries(OS_SHAPES)) {
    if (!names.has(name)) {
      console.log(`- ${name}: not here, nothing to do`);
      continue;
    }
    const docs = await db.collection(name).find({}).limit(5000).toArray();
    const foreign = docs.filter((d) => !isOs(d)).length;
    if (foreign) {
      console.log(`! ${name}: ${docs.length} documents, ${foreign} don't look like personal OS data. Left alone; tell Claude.`);
      continue;
    }
    console.log(`- ${name}: ${docs.length} personal OS documents → ${apply ? "dropping" : "would drop"}`);
    if (apply) await db.collection(name).drop();
  }

  // 2. Personal OS logins in users (no tenantId)
  const users = db.collection("users");
  const osUsers = await users.find({ tenantId: { $exists: false } }).project({ email: 1, name: 1 }).toArray();
  console.log(`\n- users without a tenantId (personal OS logins): ${osUsers.length}`);
  for (const u of osUsers) console.log(`    ${u.email} ${u.name ? `(${u.name})` : ""}`);
  if (apply && osUsers.length) {
    const r = await users.deleteMany({ _id: { $in: osUsers.map((u) => u._id) }, tenantId: { $exists: false } });
    console.log(`    deleted ${r.deletedCount}`);
  }

  // 3. A WiserShifts account the OS script may have changed
  if (email) {
    const touched = await users.find({ email, tenantId: { $exists: true }, $or: OS_USER_FIELDS.map((f) => ({ [f]: { $exists: true } })) }).project({ email: 1, name: 1, tenantId: 1 }).toArray();
    if (!touched.length) console.log(`\n- ${email}: no WiserShifts account was changed by the OS script`);
    for (const u of touched) {
      console.log(`\n! ${email} (${u.name}) is a WiserShifts account the OS script changed: its password is now the OS one-time password.`);
      console.log("  Reset it in WiserShifts (forgot password), or sign in with that one-time password and change it.");
      if (apply) {
        await users.updateOne({ _id: u._id }, { $unset: Object.fromEntries(OS_USER_FIELDS.map((f) => [f, ""])) });
        console.log("  removed the OS-only fields");
      }
    }
  } else {
    console.log('\n(Add --email="you@example.com" with the email you used in create-user.js to check your WiserShifts account too.)');
  }

  // 4. Email indexes on users: WiserShifts' own is partial
  const idx = (await users.indexes()).filter((i) => i.key && i.key.email === 1 && Object.keys(i.key).length === 1);
  console.log("\n- email indexes on users:");
  for (const i of idx) console.log(`    ${i.name}: unique=${Boolean(i.unique)} partial=${Boolean(i.partialFilterExpression)}${i.unique && !i.partialFilterExpression ? "  ← not WiserShifts', tell Claude" : ""}`);

  await mongoose.disconnect();
  console.log(apply ? "\nDone." : "\nDry run finished. Add --apply to make these changes.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
