/**
 * Sanity checks for the draft simulator against live data: ordering, determinism, speed,
 * strategy behaviour, and mid-draft replay.
 * Run: node scripts/test-draft-sim.js [nfl|nba]
 */
const {
  getDraftSimulation,
} = require("../services/aggregation/draftSimulator");

const sport = process.argv[2] || "nfl";
const scoringId = sport === "nba" ? 2 : 3;
const results = [];

function check(label, passed, detail) {
  results.push(passed);
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
}

async function run(extra = {}) {
  const started = Date.now();
  const data = await getDraftSimulation({
    sport,
    scoringId,
    draftPosition: 5,
    simulations: 150,
    forceRefresh: true,
    ...extra,
  });
  return { data, ms: Date.now() - started };
}

(async () => {
  const { data, ms } = await run();
  console.log(
    `\n${sport.toUpperCase()} pick 5 of 12, ${data.situation.totalPicks} total picks, ${ms}ms\n`,
  );
  console.log(
    "Your picks:",
    data.situation.yourPicks.slice(0, 8).join(", "),
    "...",
  );

  console.table(
    data.strategies.map((s) => ({
      rank: s.rank,
      strategy: s.label,
      vorp: s.starterVorp.mean,
      p10: s.starterVorp.p10,
      p90: s.starterVorp.p90,
      vsBest: s.vsBestValue?.meanDifference ?? "-",
      beatsBV: s.vsBestValue ? `${s.vsBestValue.beatsBestValuePct}%` : "-",
      complete: `${s.lineupCompletePct}%`,
    })),
  );

  console.log("Insights:");
  data.decisionInsights.forEach((line) => console.log(" -", line));

  const bestValue = data.strategies.find((s) => s.key === "best_value");
  console.log("\nBest value first 6 picks:");
  console.table(
    bestValue.pickPlan.slice(0, 6).map((p) => ({
      round: p.round,
      pick: p.overallPick,
      top: p.topChoices.map((c) => `${c.name} ${c.pct}%`).join(" | "),
    })),
  );

  console.log("Availability at your next pick:");
  console.table(
    data.nextPickAvailability.players.slice(0, 8).map((p) => ({
      name: p.name,
      pos: p.position,
      vorp: p.vorp,
      adp: p.adp,
      available: `${p.availabilityPct}%`,
    })),
  );

  check("completes quickly (<8s)", ms < 8000, `${ms}ms`);
  check(
    "best value is the baseline",
    data.strategies.some((s) => s.key === "best_value"),
  );
  check(
    "pick numbers follow snake order",
    data.situation.yourPicks[0] === 5 &&
      data.situation.yourPicks[1] === 20 &&
      data.situation.yourPicks[2] === 29,
    data.situation.yourPicks.slice(0, 4).join(","),
  );

  const again = await getDraftSimulation({
    sport,
    scoringId,
    draftPosition: 5,
    simulations: 150,
    forceRefresh: true,
  });
  check(
    "deterministic for identical inputs",
    JSON.stringify(again.strategies.map((s) => s.starterVorp)) ===
      JSON.stringify(data.strategies.map((s) => s.starterVorp)),
  );

  const early = (data.strategies.find((s) => s.positionMix) || {}).positionMix;
  check(
    "rosters stay within position caps",
    Object.values(early).every((n) => n <= 8),
    JSON.stringify(early),
  );
  check(
    "most simulated lineups fill every slot",
    data.strategies.every((s) => s.lineupCompletePct >= 90),
    data.strategies.map((s) => `${s.key}:${s.lineupCompletePct}%`).join(" "),
  );

  if (sport === "nfl") {
    const zero = data.strategies.find((s) => s.key === "zero_rb");
    const rbHeavy = data.strategies.find((s) => s.key === "rb_heavy");
    const earlyRbs = (s) =>
      s.pickPlan.slice(0, 5).filter((p) => p.topChoices[0]?.position === "RB")
        .length;
    check(
      "Zero RB avoids RBs early while RB-heavy takes them",
      earlyRbs(zero) === 0 && earlyRbs(rbHeavy) >= 2,
      `zero_rb early RBs=${earlyRbs(zero)}, rb_heavy=${earlyRbs(rbHeavy)}`,
    );
    const lateKick = bestValue.pickPlan
      .slice(0, bestValue.pickPlan.length - 3)
      .every((p) => !["K", "DST"].includes(p.topChoices[0]?.position));
    check("K and D/ST are not drafted before the final rounds", lateKick);
  }

  // Mid-draft replay: use picks the sim projected for the first round, as if they had happened.
  const first = await run({ picks: [] });
  const top = first.data.nextPickAvailability.players
    .filter((p) => p.availabilityPct >= 50)
    .slice(0, 4);
  const ids = first.data.nextPickAvailability.players
    .slice(0, 4)
    .map((p) => p.id);
  const live = await run({ picks: ids });
  check(
    "live mode re-plans from the picks already made",
    live.data.situation.picksMade === 4 &&
      !live.data.nextPickAvailability.players.some((p) => ids.includes(p.id)),
    `next pick still #${live.data.situation.yourNextPick.overallPick}`,
  );

  const late = await run({ draftPosition: 12 });
  check(
    "different draft position changes the plan",
    late.data.situation.yourPicks[0] === 12 &&
      late.data.strategies[0].starterVorp.mean !==
        data.strategies[0].starterVorp.mean,
    `pick 12 best: ${late.data.strategies[0].label}`,
  );

  const bad = [];
  for (const attempt of [
    { draftPosition: 13 },
    { draftPosition: 0 },
    { picks: [1, 1] },
    { picks: [999999999] },
    { strategies: ["nope"], strategyKeys: ["nope"] },
  ]) {
    try {
      await getDraftSimulation({
        sport,
        scoringId,
        draftPosition: 5,
        ...attempt,
      });
      bad.push(JSON.stringify(attempt));
    } catch (error) {
      if (error.statusCode !== 400)
        bad.push(`${JSON.stringify(attempt)} -> ${error.statusCode}`);
    }
  }
  check("invalid input returns 400", bad.length === 0, bad.join("; "));

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exit(1);
})().catch((error) => {
  console.error("FAILED:", error.statusCode || "", error.message);
  console.error(error.stack.split("\n").slice(0, 4).join("\n"));
  process.exit(1);
});
