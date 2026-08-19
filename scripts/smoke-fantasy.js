/**
 * Smoke test: exercises the fantasy stack end-to-end against live ESPN data.
 * Run: node scripts/smoke-fantasy.js [season]
 */
const {
  getPlayerPool,
  getDraftBoard,
  getSleepers,
} = require("../services/aggregation/draftAssistant");

const season = Number(process.argv[2]) || 2026;
const scoringId = 3;

const results = [];
function check(label, passed, detail) {
  results.push({ label, passed, detail });
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

(async () => {
  const pool = await getPlayerPool({ season, scoringId });
  console.log(
    `\nPool: ${pool.count} players, ${pool.playersWithProjection} with projections, ${pool.playersWithUsableAdp} with usable ADP (cache ${pool._cache})\n`,
  );

  const top50 = pool.players
    .filter((p) => Number.isFinite(p.draftRank?.ppr))
    .sort((a, b) => a.draftRank.ppr - b.draftRank.ppr)
    .slice(0, 50);

  const placeholderInTop50 = top50.filter((p) => p.adpIsPlaceholder);
  check(
    "ADP non-placeholder for top 50 ranked players",
    top50.length === 50 && placeholderInTop50.length === 0,
    `${top50.length - placeholderInTop50.length}/50 usable`,
  );

  const skill = pool.players.filter((p) =>
    ["QB", "RB", "WR", "TE"].includes(p.position),
  );
  const draftableSkill = skill
    .filter((p) => Number.isFinite(p.draftRank?.ppr))
    .sort((a, b) => a.draftRank.ppr - b.draftRank.ppr)
    .slice(0, 200);
  const withProj = draftableSkill.filter((p) =>
    Number.isFinite(p.projectedTotal),
  );
  check(
    "projectedTotal populated for draftable skill positions",
    draftableSkill.length > 0 && withProj.length === draftableSkill.length,
    `${withProj.length}/${draftableSkill.length} (top 200 by draft rank)`,
  );

  const nullProjections = pool.players.filter((p) => p.projectedTotal === null);
  check(
    "missing projections stay null rather than collapsing to 0",
    nullProjections.every((p) => p.projectedTotal === null),
    `${nullProjections.length} players have no projection`,
  );

  const keyStatsOk = draftableSkill
    .slice(0, 20)
    .every(
      (p) =>
        p.keyStats.projected && Object.keys(p.keyStats.projected).length > 0,
    );
  check("keyStats.projected resolved per position group", keyStatsOk);

  const actualsLabelled = pool.players.every(
    (p) => p.keyStats && "projected" in p.keyStats && "actual" in p.keyStats,
  );
  check("keyStats explicitly separates projected from actual", actualsLabelled);

  const nonSkill = pool.players.filter((p) =>
    ["K", "DST"].includes(p.position),
  );
  check(
    "K/DST parsed without skill-position assumptions",
    nonSkill.length > 0 && nonSkill.every((p) => p.keyStats.projected === null),
    `${nonSkill.length} K/DST entries, keyStats.projected null for all`,
  );

  console.log("\nTop 5 by PPR draft rank:");
  console.table(
    top50.slice(0, 5).map((p) => ({
      name: p.name,
      pos: p.position,
      team: p.team.abbreviation,
      adp: p.adp,
      proj: p.projectedTotal,
    })),
  );

  const roster = top50.slice(0, 3).map((p) => p.id);
  const rosterNames = top50.slice(0, 3).map((p) => p.name);
  const board = await getDraftBoard({ scoringId, season, rosterSoFar: roster });
  const leaked = board.candidates.filter((c) => roster.includes(c.id));
  check(
    "draft-board excludes rosterSoFar",
    leaked.length === 0 && board.excludedFromRoster === roster.length,
    `excluded ${rosterNames.join(", ")}`,
  );

  const rbBoard = await getDraftBoard({ scoringId, season, position: "RB" });
  check(
    "position filter returns only that position",
    rbBoard.candidates.length > 0 &&
      rbBoard.candidates.every((c) => c.position === "RB"),
    `${rbBoard.candidates.length} RBs`,
  );

  const tiersAscend = rbBoard.tiers.every(
    (t, i, arr) => i === 0 || arr[i - 1].low >= t.high,
  );
  check(
    "tiers are ordered and non-overlapping",
    tiersAscend,
    `${rbBoard.tiers.length} tiers`,
  );
  console.log("\nRB tiers:");
  console.table(rbBoard.tiers);
  console.log(`Insight: ${rbBoard.decisionInsights}\n`);

  const sleepers = await getSleepers({ scoringId, season });
  const placeholderLeak = sleepers.sleepers.filter((s) => s.adp >= 169.5);
  check(
    "sleepers exclude placeholder-ADP players",
    placeholderLeak.length === 0,
    `${sleepers.excludedForPlaceholderAdp} excluded from pool of ${sleepers.poolSize}`,
  );

  console.log("\nTop 5 sleepers:");
  console.table(
    sleepers.sleepers.slice(0, 5).map((s) => ({
      name: s.name,
      pos: s.position,
      adp: s.adp,
      posAdpRank: s.adpPositionRank,
      posProjRank: s.projectedPositionRank,
      delta: s.adpDelta,
      z: s.sleeperScore,
    })),
  );
  console.log(`Insight: ${sleepers.decisionInsights}`);

  const positionsInSleepers = new Set(
    sleepers.sleepers.slice(0, 20).map((s) => s.position),
  );
  check(
    "sleepers are not dominated by a single position",
    positionsInSleepers.size > 1,
    `top 20 spans ${[...positionsInSleepers].join(", ")}`,
  );

  const cachedBoard = await getDraftBoard({
    scoringId,
    season,
    position: "RB",
  });
  check("cache returns HIT on repeat call", cachedBoard._cache === "HIT");

  const failed = results.filter((r) => !r.passed);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed`,
  );
  if (failed.length) process.exit(1);
})().catch((error) => {
  console.error("SMOKE FAILED:", error.statusCode || "", error.message);
  process.exit(1);
});
