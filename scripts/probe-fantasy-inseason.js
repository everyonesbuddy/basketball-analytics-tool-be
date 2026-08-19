/**
 * Compares a completed season (2025) against the upcoming one (2026) through our
 * own normalizer, to show which fields change once games are played.
 */
const { getPlayerPool } = require("../services/aggregation/draftAssistant");
const { getSleepers } = require("../services/aggregation/draftAssistant");

const scoringId = 3;

function summarize(pool) {
  const withActual = pool.players.filter(
    (p) => p.actualTotal !== null && p.actualTotal > 0,
  );
  const withProj = pool.players.filter((p) => p.projectedTotal !== null);
  const usableAdp = pool.players.filter((p) => !p.adpIsPlaceholder);
  const weekly = pool.players.filter((p) => p.weeklySplits.length > 0);
  const actualWeekly = pool.players.filter((p) =>
    p.weeklySplits.some((w) => !w.isProjection),
  );

  return {
    season: pool.season,
    players: pool.count,
    withProjection: withProj.length,
    withActualTotal: withActual.length,
    withUsableAdp: usableAdp.length,
    withAnyWeeklySplits: weekly.length,
    withActualWeeklySplits: actualWeekly.length,
  };
}

(async () => {
  const upcoming = await getPlayerPool({ season: 2026, scoringId });
  const completed = await getPlayerPool({ season: 2025, scoringId });

  console.table([summarize(upcoming), summarize(completed)]);

  const cmc2026 = upcoming.players.find(
    (p) => p.name === "Christian McCaffrey",
  );
  const cmc2025 = completed.players.find(
    (p) => p.name === "Christian McCaffrey",
  );

  console.log("\n--- Christian McCaffrey, 2026 (pre-season) ---");
  console.log({
    adp: cmc2026?.adp,
    adpIsPlaceholder: cmc2026?.adpIsPlaceholder,
    projectedTotal: cmc2026?.projectedTotal,
    actualTotal: cmc2026?.actualTotal,
    keyStats: cmc2026?.keyStats,
    weeklySplitCount: cmc2026?.weeklySplits.length,
    weeklySample: cmc2026?.weeklySplits.slice(0, 3),
  });

  console.log("\n--- Christian McCaffrey, 2025 (completed) ---");
  console.log({
    adp: cmc2025?.adp,
    adpIsPlaceholder: cmc2025?.adpIsPlaceholder,
    projectedTotal: cmc2025?.projectedTotal,
    actualTotal: cmc2025?.actualTotal,
    keyStats: cmc2025?.keyStats,
    weeklySplitCount: cmc2025?.weeklySplits.length,
    weeklySample: cmc2025?.weeklySplits.slice(0, 3),
  });

  const sleepers2025 = await getSleepers({ season: 2025, scoringId });
  console.log("\n--- getSleepers on the completed season ---");
  console.log({
    evaluatedCount: sleepers2025.evaluatedCount,
    excludedForPlaceholderAdp: sleepers2025.excludedForPlaceholderAdp,
    returned: sleepers2025.sleepers.length,
    insight: sleepers2025.decisionInsights,
  });
})().catch((error) => {
  console.error("FAILED:", error.statusCode || "", error.message);
  process.exit(1);
});
