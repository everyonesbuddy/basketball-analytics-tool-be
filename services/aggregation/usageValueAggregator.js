const cache = require("../../cache/memoryCache");
const {
  getAthleteOptions,
  getAthleteOverview,
  getCoreAthleteProfile,
  getCoreAthleteStatistics,
} = require("../espn/athletes.service");
const {
  toNumber,
  roundNullable,
  average,
  stdDev,
  buildInitialBuckets,
  mergeSparseBuckets,
  findBucketForUsage,
  computeBucketStats,
  classifyPlayer,
} = require("../analytics/usageValue");

const USAGE_VALUE_BASELINE_TTL_MS = 20 * 60 * 1000;
const USAGE_VALUE_PLAYER_TTL_MS = 5 * 60 * 1000;
const USAGE_VALUE_SAMPLE_LIMIT = 1000;
const USAGE_VALUE_MIN_GAMES = 15;
const USAGE_VALUE_MIN_MINUTES = 10;
const USAGE_VALUE_BUCKET_WIDTH = 5;
const USAGE_VALUE_MIN_BUCKET_SIZE = 20;
const USAGE_VALUE_TARGET_SPLIT = "Regular Season";
const ACTIONABLE_METRICS = [
  { key: "points", label: "points", preferLower: false, decimals: 1 },
  { key: "rebounds", label: "rebounds", preferLower: false, decimals: 1 },
  { key: "assists", label: "assists", preferLower: false, decimals: 1 },
  { key: "steals", label: "steals", preferLower: false, decimals: 1 },
  { key: "blocks", label: "blocks", preferLower: false, decimals: 1 },
  { key: "turnovers", label: "turnovers", preferLower: true, decimals: 1 },
  {
    key: "efficiencyIndex",
    label: "efficiencyIndex",
    preferLower: false,
    decimals: 1,
  },
];

function buildUsageValueBaselineCacheKey() {
  return `usage-value:baseline:v3:${USAGE_VALUE_SAMPLE_LIMIT}:${USAGE_VALUE_MIN_GAMES}:${USAGE_VALUE_MIN_MINUTES}:${USAGE_VALUE_BUCKET_WIDTH}:${USAGE_VALUE_MIN_BUCKET_SIZE}`;
}

function buildUsageValuePlayerCacheKey(athleteId) {
  return `usage-value:player:v3:${athleteId}`;
}

function normalizeSplitLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeStatKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findRegularSeasonRow(summary = {}) {
  const rows = Array.isArray(summary?.splits) ? summary.splits : [];
  return (
    rows.find(
      (row) => normalizeSplitLabel(row?.displayName) === "regular season",
    ) || null
  );
}

function usageAliases() {
  return [
    "usagerate",
    "usagepct",
    "usagepercentage",
    "playerusagerating",
    "usg",
    "usgpct",
  ];
}

function statAliases(statName) {
  const aliases = {
    gamesplayed: ["gamesplayed"],
    avgminutes: ["avgminutes", "minutes"],
    avgpoints: ["avgpoints", "points"],
    avgrebounds: ["avgrebounds", "rebounds", "totalrebounds"],
    avgassists: ["avgassists", "assists"],
    avgsteals: ["avgsteals", "steals"],
    avgblocks: ["avgblocks", "blocks"],
    avgturnovers: ["avgturnovers", "turnovers"],
  };

  return aliases[statName] || [statName];
}

function readStat(names = [], stats = [], aliases = []) {
  const indexByName = new Map();

  names.forEach((name, index) => {
    indexByName.set(normalizeStatKey(name), index);
  });

  for (const alias of aliases) {
    const index = indexByName.get(alias);
    if (index !== undefined) {
      return toNumber(stats[index]);
    }
  }

  return null;
}

function normalizeUsagePct(value) {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed <= 1 ? parsed * 100 : parsed;
}

function buildCoreStatIndex(coreStats = {}) {
  const index = new Map();
  const categories = Array.isArray(coreStats?.splits?.categories)
    ? coreStats.splits.categories
    : [];

  for (const category of categories) {
    const stats = Array.isArray(category?.stats) ? category.stats : [];

    for (const stat of stats) {
      const value = toNumber(stat?.value);
      if (!Number.isFinite(value)) {
        continue;
      }

      const keys = [stat?.name, stat?.abbreviation, stat?.shortDisplayName];
      for (const key of keys) {
        const normalized = normalizeStatKey(key);
        if (normalized) {
          index.set(normalized, value);
        }
      }
    }
  }

  return index;
}

function readCoreStat(coreStats = {}, aliases = []) {
  if (!aliases.length) {
    return null;
  }

  const index = buildCoreStatIndex(coreStats);
  for (const alias of aliases) {
    const value = index.get(normalizeStatKey(alias));
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function deriveUsageFromCoreStats(coreStats = {}) {
  const directUsage = normalizeUsagePct(
    readCoreStat(coreStats, usageAliases()),
  );
  if (Number.isFinite(directUsage)) {
    return directUsage;
  }

  const fieldGoalsAttempted = readCoreStat(coreStats, [
    "fieldGoalsAttempted",
    "fga",
  ]);
  const freeThrowsAttempted = readCoreStat(coreStats, [
    "freeThrowsAttempted",
    "fta",
  ]);
  const assists = readCoreStat(coreStats, ["assists", "ast"]);
  const turnovers = readCoreStat(coreStats, ["turnovers", "to"]);
  const minutes = readCoreStat(coreStats, ["minutes", "min"]);

  if (
    [
      fieldGoalsAttempted,
      freeThrowsAttempted,
      assists,
      turnovers,
      minutes,
    ].every((value) => Number.isFinite(value)) &&
    minutes > 0
  ) {
    return (
      ((fieldGoalsAttempted +
        0.44 * freeThrowsAttempted +
        0.33 * assists +
        turnovers) *
        40) /
      minutes
    );
  }

  return null;
}

function buildUsageSnapshot(
  overview = {},
  fallbackId = null,
  fallbackName = null,
  coreStats = null,
) {
  const athlete = overview?.athlete || {};
  const summary = overview?.statistics || overview?.statSplit || {};
  const names = Array.isArray(summary?.names) ? summary.names : [];
  const row = findRegularSeasonRow(summary);
  const stats = Array.isArray(row?.stats) ? row.stats : [];
  const gamesPlayed = readStat(names, stats, statAliases("gamesplayed"));
  const avgMinutes = readStat(names, stats, statAliases("avgminutes"));
  const points = readStat(names, stats, statAliases("avgpoints"));
  const rebounds = readStat(names, stats, statAliases("avgrebounds"));
  const assists = readStat(names, stats, statAliases("avgassists"));
  const steals = readStat(names, stats, statAliases("avgsteals"));
  const blocks = readStat(names, stats, statAliases("avgblocks"));
  const turnovers = readStat(names, stats, statAliases("avgturnovers"));
  const usagePctFromOverview = normalizeUsagePct(
    readStat(names, stats, usageAliases()),
  );
  const usagePct =
    usagePctFromOverview ?? deriveUsageFromCoreStats(coreStats || {});
  const efficiencyIndex = [
    points,
    rebounds,
    assists,
    steals,
    blocks,
    turnovers,
  ].every((value) => Number.isFinite(value))
    ? points + rebounds + assists + steals + blocks - turnovers
    : null;

  return {
    athleteId: String(
      Number(athlete?.id) || Number(overview?.id) || Number(fallbackId) || "",
    ),
    displayName:
      athlete?.displayName || athlete?.fullName || fallbackName || null,
    usagePct,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    turnovers,
    efficiencyIndex,
    gamesPlayed,
    avgMinutes,
    sourceSplit: row?.displayName || null,
  };
}

function isEligible(snapshot = {}) {
  return (
    snapshot?.sourceSplit === USAGE_VALUE_TARGET_SPLIT &&
    Number.isFinite(snapshot?.usagePct) &&
    Number.isFinite(snapshot?.efficiencyIndex) &&
    Number.isFinite(snapshot?.gamesPlayed) &&
    Number.isFinite(snapshot?.avgMinutes) &&
    snapshot.gamesPlayed >= USAGE_VALUE_MIN_GAMES &&
    snapshot.avgMinutes >= USAGE_VALUE_MIN_MINUTES
  );
}

function buildMetricSignal(
  actual,
  expectedLow,
  expectedHigh,
  preferLower = false,
) {
  if (
    !Number.isFinite(actual) ||
    !Number.isFinite(expectedLow) ||
    !Number.isFinite(expectedHigh)
  ) {
    return "insufficient_data";
  }

  if (preferLower) {
    if (actual < expectedLow) {
      return "better_than_expected";
    }
    if (actual > expectedHigh) {
      return "worse_than_expected";
    }
    return "within_expected_range";
  }

  if (actual > expectedHigh) {
    return "better_than_expected";
  }
  if (actual < expectedLow) {
    return "worse_than_expected";
  }

  return "within_expected_range";
}

function buildBucketActionableProfile(bucket = {}) {
  const players = Array.isArray(bucket?.players) ? bucket.players : [];
  const metrics = {};

  for (const metric of ACTIONABLE_METRICS) {
    const values = players
      .map((player) => toNumber(player?.[metric.key]))
      .filter((value) => Number.isFinite(value));
    const mean = average(values);
    const deviation = stdDev(values, mean);
    const expectedLow =
      Number.isFinite(mean) && Number.isFinite(deviation)
        ? mean - deviation
        : null;
    const expectedHigh =
      Number.isFinite(mean) && Number.isFinite(deviation)
        ? mean + deviation
        : null;

    metrics[metric.key] = {
      metric: metric.label,
      preferLower: metric.preferLower,
      expectedMean: roundNullable(mean, metric.decimals),
      stdDev: roundNullable(deviation, metric.decimals),
      expectedRange: {
        low: roundNullable(expectedLow, metric.decimals),
        high: roundNullable(expectedHigh, metric.decimals),
      },
      sampleSize: values.length,
    };
  }

  return {
    usageBucket: bucket?.label || null,
    metrics,
  };
}

function buildActionableStats(player = {}, bucketProfile = null) {
  if (!bucketProfile?.metrics) {
    return null;
  }

  const actionableStats = {};

  for (const metric of ACTIONABLE_METRICS) {
    const profile = bucketProfile.metrics[metric.key];
    if (!profile) {
      continue;
    }

    const actual = roundNullable(player?.[metric.key], metric.decimals);
    const expectedMean = roundNullable(profile.expectedMean, metric.decimals);
    const expectedLow = roundNullable(
      profile?.expectedRange?.low,
      metric.decimals,
    );
    const expectedHigh = roundNullable(
      profile?.expectedRange?.high,
      metric.decimals,
    );
    const deltaFromMean =
      Number.isFinite(actual) && Number.isFinite(expectedMean)
        ? roundNullable(actual - expectedMean, metric.decimals)
        : null;

    actionableStats[metric.key] = {
      metric: metric.label,
      actual,
      expectedMean,
      expectedRange: {
        low: expectedLow,
        high: expectedHigh,
      },
      deltaFromMean,
      signal: buildMetricSignal(
        actual,
        expectedLow,
        expectedHigh,
        profile.preferLower,
      ),
    };
  }

  return actionableStats;
}

function buildDecisionInsights(classification = {}, actionableStats = {}) {
  if (!classification || !actionableStats) {
    return null;
  }

  const usagePct = toNumber(classification?.usagePct);
  const zScore = toNumber(classification?.zScore);
  const points = actionableStats.points;
  const rebounds = actionableStats.rebounds;
  const assists = actionableStats.assists;
  const turnovers = actionableStats.turnovers;

  let usageContext = "Starter Role Player";
  if (Number.isFinite(usagePct)) {
    if (usagePct < 15) {
      usageContext = "Bench Player Usage";
    } else if (usagePct < 21) {
      usageContext = "Starter Role Player";
    } else if (usagePct < 27) {
      usageContext = "Secondary Option";
    } else {
      usageContext = "Primary Option";
    }
  }

  const usageLeadLabel = usageContext;

  let performanceLead = "performing in line with expectation";
  if (classification.status === "above_expected_range") {
    performanceLead = "performing above expectation";
  } else if (classification.status === "below_expected_range") {
    performanceLead = "performing below expectation";
  }

  let summary = `This is ${usageLeadLabel} and the player is ${performanceLead}.`;
  if (classification.status === "above_expected_range") {
    if (usageContext === "Bench Player Usage") {
      summary =
        "This is Bench Player Usage and the player is performing above expectation. There is potential to grow into a Starter Role Player.";
    } else if (usageContext === "Starter Role Player") {
      summary =
        "This is Starter Role Player usage and the player is performing above expectation. There is potential to grow into a Secondary Option.";
    } else if (usageContext === "Secondary Option") {
      summary =
        "This is Secondary Option usage and the player is performing above expectation. There is potential to grow into a Primary Option.";
    } else {
      summary =
        "This is Primary Option and the player is performing above expectation. This is superstar-level impact right now.";
    }
  } else if (classification.status === "below_expected_range") {
    if (usageContext === "Bench Player Usage") {
      summary =
        "This is Bench Player Usage and the player is performing below expectation. This is currently deep-bench impact.";
    } else if (usageContext === "Starter Role Player") {
      summary =
        "This is Starter Role Player usage and the player is performing below expectation. Output is trending closer to Bench Player Usage.";
    } else if (usageContext === "Secondary Option") {
      summary =
        "This is Secondary Option usage and the player is performing below expectation. Output is trending closer to Starter Role Player.";
    } else {
      summary =
        "This is Primary Option and the player is performing below expectation. Output is trending closer to Secondary Option.";
    }
  }

  const gm = [
    `This is ${usageLeadLabel} and the player is ${performanceLead}.`,
  ];
  const coach = [
    Number.isFinite(zScore)
      ? `This is ${usageLeadLabel} and the player is ${performanceLead} (zScore ${roundNullable(zScore, 2)}).`
      : `This is ${usageLeadLabel} and the player is ${performanceLead}.`,
  ];

  if (classification.status === "above_expected_range") {
    if (usageContext === "Bench Player Usage") {
      gm.push("Potential next step: test promotion toward Starter Role Player workload.");
    } else if (usageContext === "Starter Role Player") {
      gm.push("Potential next step: test growth toward Secondary Option usage.");
    } else if (usageContext === "Secondary Option") {
      gm.push("Potential next step: test short windows as a Primary Option.");
    } else {
      gm.push("Primary Option above expectation: this is superstar-level impact right now.");
    }
  } else if (classification.status === "below_expected_range") {
    if (usageContext === "Primary Option") {
      gm.push("Primary Option below expectation: consider a temporary shift toward Secondary Option-level load.");
    } else if (usageContext === "Secondary Option") {
      gm.push("Secondary Option below expectation: simplify role closer to Starter Role Player level until efficiency improves.");
    } else if (usageContext === "Starter Role Player") {
      gm.push("Starter Role Player below expectation: minutes/usage should trend closer to Bench Player Usage until output improves.");
    } else {
      gm.push("Bench Player Usage below expectation: keep as deep-bench/depth role for now.");
    }
  } else {
    gm.push("Make small matchup-based adjustments instead of major changes.");
  }

  if (points?.signal === "worse_than_expected") {
    coach.push(
      "Scoring is low for this role. Create easier shots and cleaner looks.",
    );
  } else if (points?.signal === "better_than_expected") {
    coach.push(
      "Scoring is strong for this role. Keep the current scoring actions.",
    );
  }

  if (assists?.signal === "worse_than_expected") {
    coach.push(
      "Playmaking is low. Add more on-ball reps and simple read-and-react passes.",
    );
  } else if (assists?.signal === "better_than_expected") {
    coach.push(
      "Playmaking is strong. Let this player initiate more offense in key stretches.",
    );
  }

  if (turnovers?.signal === "worse_than_expected") {
    coach.push("Turnovers are high. Simplify reads and cut risky passes.");
  } else if (turnovers?.signal === "better_than_expected") {
    coach.push(
      "Turnovers are under control. You can safely add a bit more creation load.",
    );
  }

  if (rebounds?.signal === "worse_than_expected") {
    coach.push("Rebounding is low. Emphasize positioning and team box-outs.");
  }

  if (!coach.length) {
    coach.push("No major red flags in the key stats. Keep the role steady.");
  }

  let contractSuggestion =
    "Contract option: keep to a fair market deal that matches the current role.";
  if (classification.status === "above_expected_range") {
    if (usageContext === "Primary Option") {
      contractSuggestion =
        "Contract option: prioritize long-term retention at lead-option value if the numbers stay stable.";
    } else if (usageContext === "Secondary Option") {
      contractSuggestion =
        "Contract option: consider a strong multi-year deal tied to current role value.";
    } else {
      contractSuggestion =
        "Contract option: consider a raise or extension above baseline role-player value.";
    }
  } else if (classification.status === "below_expected_range") {
    contractSuggestion =
      "Contract option: prefer short-term or team-friendly terms until production returns to expected range.";
  }

  let usageSuggestion =
    "Optional usage suggestion: keep usage near current level and adjust by matchup.";
  if (classification.status === "above_expected_range") {
    if (usageContext === "Bench Player Usage") {
      usageSuggestion =
        "Optional usage suggestion: test a small increase in touches and minutes to see if the efficiency holds.";
    } else if (usageContext === "Starter Role Player") {
      usageSuggestion =
        "Optional usage suggestion: add a small usage bump in selected lineups and re-check results.";
    } else if (usageContext === "Secondary Option") {
      usageSuggestion =
        "Optional usage suggestion: test short stretches as a primary creator while monitoring efficiency.";
    } else {
      usageSuggestion =
        "Optional usage suggestion: keep primary-option usage steady and protect it with strong spacing/support units.";
    }
  } else if (classification.status === "below_expected_range") {
    if (
      usageContext === "Primary Option" ||
      usageContext === "Secondary Option"
    ) {
      usageSuggestion =
        "Optional usage suggestion: trim usage slightly and redistribute creation until efficiency improves.";
    } else {
      usageSuggestion =
        "Optional usage suggestion: keep usage simple and focused on high-efficiency actions before expanding role.";
    }
  }

  gm.push(contractSuggestion);
  coach.push(usageSuggestion);

  return {
    summary,
    gm,
    coach,
  };
}

async function mapWithConcurrency(items = [], worker, concurrency = 10) {
  const results = new Array(items.length);
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      } catch (_error) {
        results[currentIndex] = null;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, items.length) }, () =>
      runWorker(),
    ),
  );

  return results;
}

async function buildUsageValueBaseline(forceRefresh = false) {
  const cacheKey = buildUsageValueBaselineCacheKey();

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const optionsPayload = await getAthleteOptions({
    query: "",
    limit: USAGE_VALUE_SAMPLE_LIMIT,
    offset: 0,
    forceRefresh,
  });

  const optionRows = optionsPayload?.options || [];
  const candidateIds = optionRows
    .map((item) => Number(item?.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  const labelById = new Map(
    optionRows
      .map((item) => [Number(item?.id), item?.label || null])
      .filter(([id]) => Number.isInteger(id) && id > 0),
  );

  const snapshots = (
    await mapWithConcurrency(
      candidateIds,
      async (id) => {
        const [overview, coreStats] = await Promise.all([
          getAthleteOverview(id),
          getCoreAthleteStatistics(id).catch(() => null),
        ]);

        return buildUsageSnapshot(
          overview,
          id,
          labelById.get(Number(id)) || null,
          coreStats,
        );
      },
      6,
    )
  ).filter(Boolean);

  const eligiblePlayers = snapshots.filter((snapshot) => isEligible(snapshot));
  const initialBuckets = buildInitialBuckets(
    eligiblePlayers,
    USAGE_VALUE_BUCKET_WIDTH,
  );
  const mergedBuckets = mergeSparseBuckets(
    initialBuckets,
    USAGE_VALUE_MIN_BUCKET_SIZE,
  );
  const bucketStats = computeBucketStats(mergedBuckets, "efficiencyIndex");
  const bucketStatsByLabel = new Map(
    bucketStats.map((item) => [item.label, item]),
  );
  const bucketActionableProfiles = Object.fromEntries(
    mergedBuckets.map((bucket) => [
      bucket.label,
      buildBucketActionableProfile(bucket),
    ]),
  );

  const classificationsByAthleteId = {};

  for (const player of eligiblePlayers) {
    const bucket = findBucketForUsage(player.usagePct, mergedBuckets);
    if (!bucket) {
      continue;
    }

    const stats = bucketStatsByLabel.get(bucket.label);
    if (!stats) {
      continue;
    }

    const classification = classifyPlayer(player, stats);
    const actionableProfile = bucketActionableProfiles[bucket.label] || null;
    const actionableStats = buildActionableStats(player, actionableProfile);
    const decisionInsights = buildDecisionInsights(
      {
        ...classification,
        usagePct: player.usagePct,
      },
      actionableStats,
    );

    classificationsByAthleteId[player.athleteId] = {
      athleteId: player.athleteId,
      displayName: player.displayName,
      usagePct: roundNullable(player.usagePct, 1),
      usageBucket: classification.usageBucket,
      expectedProduction: classification.expectedProduction,
      actualProduction: classification.actualProduction,
      zScore: classification.zScore,
      status: classification.status,
      bucketSampleSize: classification.bucketSampleSize,
      gamesPlayed: Number(player.gamesPlayed),
      avgMinutes: roundNullable(player.avgMinutes, 1),
      sourceSplit: player.sourceSplit,
      actionableStats,
      expectedStatRanges: actionableProfile?.metrics || null,
      decisionInsights,
    };
  }

  const payload = {
    splitUsed: USAGE_VALUE_TARGET_SPLIT,
    sampleSizeRequested: USAGE_VALUE_SAMPLE_LIMIT,
    sampleSizeEligible: eligiblePlayers.length,
    minGames: USAGE_VALUE_MIN_GAMES,
    minMinutes: USAGE_VALUE_MIN_MINUTES,
    bucketWidth: USAGE_VALUE_BUCKET_WIDTH,
    minBucketSize: USAGE_VALUE_MIN_BUCKET_SIZE,
    buckets: bucketStats.map((item) => ({
      usageBucket: item.label,
      lowerBound: item.low,
      upperBound: item.high,
      expectedProduction: roundNullable(item.mean, 1),
      stdDev: roundNullable(item.stdDev, 2),
      sampleSize: item.count,
      expectedStatRanges: bucketActionableProfiles[item.label]?.metrics || null,
    })),
    mergedBuckets,
    bucketActionableProfiles,
    classificationsByAthleteId,
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, payload, USAGE_VALUE_BASELINE_TTL_MS);

  return payload;
}

async function buildTargetFromOverview(athleteId) {
  const [overview, core, coreStats] = await Promise.all([
    getAthleteOverview(athleteId),
    getCoreAthleteProfile(athleteId).catch(() => null),
    getCoreAthleteStatistics(athleteId).catch(() => null),
  ]);

  const snapshot = buildUsageSnapshot(
    overview,
    athleteId,
    core?.displayName || core?.fullName || null,
    coreStats,
  );

  return {
    ...snapshot,
    displayName:
      snapshot.displayName || core?.displayName || core?.fullName || null,
  };
}

function classifyTargetAgainstBaseline(target = {}, baseline = {}) {
  if (
    !Number.isFinite(target?.usagePct) ||
    !Number.isFinite(target?.efficiencyIndex)
  ) {
    return null;
  }

  const bucket = findBucketForUsage(
    target.usagePct,
    baseline?.mergedBuckets || [],
  );
  if (!bucket) {
    return null;
  }

  const stats = (baseline?.buckets || []).find(
    (item) => item.usageBucket === bucket.label,
  );
  if (!stats) {
    return null;
  }

  const classified = classifyPlayer(target, {
    label: stats.usageBucket,
    mean: stats.expectedProduction,
    stdDev: stats.stdDev,
    count: stats.sampleSize,
  });
  const actionableProfile =
    baseline?.bucketActionableProfiles?.[stats.usageBucket] || null;
  const actionableStats = buildActionableStats(target, actionableProfile);
  const decisionInsights = buildDecisionInsights(
    {
      ...classified,
      usagePct: target.usagePct,
    },
    actionableStats,
  );

  return {
    athleteId: String(target.athleteId),
    displayName: target.displayName || null,
    usagePct: roundNullable(target.usagePct, 1),
    usageBucket: classified.usageBucket,
    expectedProduction: classified.expectedProduction,
    actualProduction: classified.actualProduction,
    zScore: classified.zScore,
    status: classified.status,
    bucketSampleSize: classified.bucketSampleSize,
    gamesPlayed: Number.isFinite(target.gamesPlayed)
      ? Number(target.gamesPlayed)
      : null,
    avgMinutes: roundNullable(target.avgMinutes, 1),
    sourceSplit: target.sourceSplit || null,
    actionableStats,
    expectedStatRanges: actionableProfile?.metrics || null,
    decisionInsights,
  };
}

async function getPlayerUsageValue(athleteId, options = {}) {
  const { forceRefresh = false } = options;
  const playerCacheKey = buildUsageValuePlayerCacheKey(athleteId);

  if (!forceRefresh) {
    const cached = cache.get(playerCacheKey);
    if (cached) {
      return { ...cached, _cache: "HIT" };
    }
  }

  const baseline = await buildUsageValueBaseline(forceRefresh);
  const cachedClassification =
    baseline.classificationsByAthleteId[String(athleteId)] || null;

  let classification = cachedClassification;
  let warning = null;

  if (!classification) {
    const target = await buildTargetFromOverview(athleteId);
    classification = classifyTargetAgainstBaseline(target, baseline);

    if (!classification) {
      warning =
        "Unable to classify this player for usage-value benchmark due to missing regular-season usage/production stats";
    }
  }

  const payload = {
    athleteId: String(athleteId),
    splitUsed: baseline.splitUsed,
    usagePct: classification?.usagePct || null,
    usageBucket: classification?.usageBucket || null,
    expectedProduction: classification?.expectedProduction || null,
    actualProduction: classification?.actualProduction || null,
    zScore: classification?.zScore || null,
    status: classification?.status || null,
    bucketSampleSize: classification?.bucketSampleSize || 0,
    gamesPlayed: classification?.gamesPlayed || null,
    avgMinutes: classification?.avgMinutes || null,
    sourceSplit: classification?.sourceSplit || null,
    actionableStats: classification?.actionableStats || null,
    expectedStatRanges: classification?.expectedStatRanges || null,
    decisionInsights: classification?.decisionInsights || null,
    benchmarkContext: {
      sampleSizeRequested: baseline.sampleSizeRequested,
      sampleSizeEligible: baseline.sampleSizeEligible,
      minGames: baseline.minGames,
      minMinutes: baseline.minMinutes,
      bucketWidth: baseline.bucketWidth,
      minBucketSize: baseline.minBucketSize,
    },
    warning,
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(playerCacheKey, payload, USAGE_VALUE_PLAYER_TTL_MS);

  return { ...payload, _cache: "MISS" };
}

module.exports = {
  getPlayerUsageValue,
};
