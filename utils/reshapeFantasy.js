// The shared usageValue.toNumber coerces null to 0 (Number(null) === 0), which would
// turn "no projection" into a real 0. Fantasy paths need absent to stay absent.
function finiteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundNullable(value, decimals = 2) {
  const parsed = finiteNumber(value);
  if (parsed === null) {
    return null;
  }

  return Number(parsed.toFixed(decimals));
}

const POSITION_BY_ID = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DST",
};

const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);

// ESPN keys stats[].stats by numeric stat id, and the id ranges are disjoint by
// position group (verified: QB 0-40, skill 23-119, K 74-88/198-216, D/ST 89-137).
const STAT_IDS = {
  passing: {
    passAttempts: 0,
    completions: 1,
    incompletions: 2,
    passingYards: 3,
    passingTouchdowns: 4,
    interceptions: 20,
  },
  rushing: {
    rushAttempts: 23,
    rushingYards: 24,
    rushingTouchdowns: 25,
  },
  receiving: {
    receptions: 53,
    receivingYards: 42,
    receivingTouchdowns: 43,
    targets: 58,
  },
};

const GAMES_PLAYED_STAT_ID = 210;

const STAT_GROUPS_BY_POSITION = {
  QB: ["passing", "rushing"],
  RB: ["rushing", "receiving"],
  WR: ["receiving", "rushing"],
  TE: ["receiving"],
  K: [],
  DST: [],
};

// ESPN caps ADP at ~170 for players outside the draftable pool, with small jitter.
// Anything in this band carries no usable draft signal.
const ADP_PLACEHOLDER_FLOOR = 169.5;

function resolvePosition(defaultPositionId) {
  return POSITION_BY_ID[Number(defaultPositionId)] || null;
}

function isPlaceholderAdp(value) {
  const adp = finiteNumber(value);
  return adp === null || adp <= 0 || adp >= ADP_PLACEHOLDER_FLOOR;
}

function findStatEntry(
  stats = [],
  { statSourceId, statSplitTypeId, seasonId },
) {
  if (!Array.isArray(stats)) {
    return null;
  }

  return (
    stats.find(
      (entry) =>
        Number(entry?.statSourceId) === statSourceId &&
        Number(entry?.statSplitTypeId) === statSplitTypeId &&
        (seasonId === undefined || Number(entry?.seasonId) === seasonId),
    ) || null
  );
}

function extractKeyStats(position, statMap = {}) {
  const groups = STAT_GROUPS_BY_POSITION[position];

  // K and D/ST use a wholly separate id range that is not mapped yet; exposing a
  // skill-position shape for them would be wrong, so callers get rawStats only.
  if (!groups || !groups.length) {
    return null;
  }

  if (!statMap || !Object.keys(statMap).length) {
    return null;
  }

  const keyStats = {};

  for (const group of groups) {
    const dictionary = STAT_IDS[group];
    if (!dictionary) {
      continue;
    }

    for (const [label, statId] of Object.entries(dictionary)) {
      keyStats[label] = roundNullable(statMap?.[statId], 1);
    }
  }

  return keyStats;
}

function normalizeWeeklySplits(stats = [], seasonId) {
  if (!Array.isArray(stats)) {
    return [];
  }

  return stats
    .filter(
      (entry) =>
        Number(entry?.statSplitTypeId) === 1 &&
        (seasonId === undefined || Number(entry?.seasonId) === seasonId),
    )
    .map((entry) => ({
      scoringPeriodId: finiteNumber(entry?.scoringPeriodId),
      isProjection: Number(entry?.statSourceId) === 1,
      appliedTotal: roundNullable(entry?.appliedTotal, 2),
    }))
    .filter((entry) => entry.scoringPeriodId !== null)
    .sort((a, b) => a.scoringPeriodId - b.scoringPeriodId);
}

function normalizePlayer(rawEntry = {}, options = {}) {
  const { seasonId, teamsById = null } = options;
  const player = rawEntry?.player || {};
  const id = finiteNumber(player?.id ?? rawEntry?.id);

  if (id === null) {
    return null;
  }

  const position = resolvePosition(player?.defaultPositionId);
  const ownership = player?.ownership || {};
  const stats = Array.isArray(player?.stats) ? player.stats : [];

  const projection = findStatEntry(stats, {
    statSourceId: 1,
    statSplitTypeId: 0,
    seasonId,
  });
  const actual = findStatEntry(stats, {
    statSourceId: 0,
    statSplitTypeId: 0,
    seasonId,
  });

  const proTeamId = finiteNumber(player?.proTeamId);
  const team = teamsById?.get(proTeamId) || null;
  const adp = finiteNumber(ownership?.averageDraftPosition);

  const actualStatMap = actual?.stats || {};
  const hasActualProduction = Object.keys(actualStatMap).length > 0;

  return {
    id,
    name: player?.fullName || null,
    position,
    isFlexEligible: FLEX_POSITIONS.has(position),
    team: {
      proTeamId,
      abbreviation: team?.abbreviation || null,
      displayName: team?.displayName || null,
    },
    injuryStatus: player?.injuryStatus || null,
    isInjured: Boolean(player?.injured),
    adp: roundNullable(adp, 2),
    adpIsPlaceholder: isPlaceholderAdp(adp),
    ownershipPct: roundNullable(ownership?.percentOwned, 2),
    startedPct: roundNullable(ownership?.percentStarted, 2),
    auctionValue: roundNullable(ownership?.auctionValueAverage, 2),
    projectedTotal: roundNullable(projection?.appliedTotal, 2),
    projectedAverage: roundNullable(projection?.appliedAverage, 2),
    projectedGames: finiteNumber(projection?.stats?.[GAMES_PLAYED_STAT_ID]),
    // Before kickoff ESPN sends an actuals row of 0; that is "not played yet", not a score.
    actualTotal: hasActualProduction
      ? roundNullable(actual?.appliedTotal, 2)
      : null,
    actualAverage: hasActualProduction
      ? roundNullable(actual?.appliedAverage, 2)
      : null,
    actualGames: hasActualProduction
      ? finiteNumber(actualStatMap?.[GAMES_PLAYED_STAT_ID])
      : null,
    draftRank: {
      ppr: finiteNumber(player?.draftRanksByRankType?.PPR?.rank),
      standard: finiteNumber(player?.draftRanksByRankType?.STANDARD?.rank),
    },
    positionalRanking: finiteNumber(
      rawEntry?.ratings?.["0"]?.positionalRanking,
    ),
    keyStats: {
      projected: extractKeyStats(position, projection?.stats || {}),
      actual: extractKeyStats(position, actualStatMap),
    },
    rawStats: {
      projected: projection?.stats || {},
      actual: actualStatMap,
    },
    weeklySplits: normalizeWeeklySplits(stats, seasonId),
  };
}

function normalizePlayerList(rawEntries = [], options = {}) {
  if (!Array.isArray(rawEntries)) {
    return [];
  }

  const normalized = [];

  for (const rawEntry of rawEntries) {
    // One malformed entry must not sink the whole pool.
    try {
      const player = normalizePlayer(rawEntry, options);
      if (player) {
        normalized.push(player);
      }
    } catch (_error) {
      continue;
    }
  }

  return normalized;
}

module.exports = {
  finiteNumber,
  roundNullable,
  POSITION_BY_ID,
  FLEX_POSITIONS,
  STAT_IDS,
  STAT_GROUPS_BY_POSITION,
  ADP_PLACEHOLDER_FLOOR,
  resolvePosition,
  isPlaceholderAdp,
  findStatEntry,
  extractKeyStats,
  normalizePlayer,
  normalizePlayerList,
};
