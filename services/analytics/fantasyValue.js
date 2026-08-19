const { average, stdDev } = require("./usageValue");
const { finiteNumber, roundNullable } = require("../../utils/reshapeFantasy");

const DEFAULT_TIER_COUNT = 8;
const DEFAULT_MIN_TIER_SIZE = 3;
const MIN_PEER_SAMPLE = 5;

function hasProjection(player) {
  return finiteNumber(player?.projectedTotal) !== null;
}

function hasUsableAdp(player) {
  return !player?.adpIsPlaceholder && finiteNumber(player?.adp) !== null;
}

function groupByPosition(players = []) {
  const byPosition = new Map();

  for (const player of players) {
    const position = player?.position || "UNKNOWN";
    if (!byPosition.has(position)) {
      byPosition.set(position, []);
    }
    byPosition.get(position).push(player);
  }

  return byPosition;
}

/**
 * Ranks are computed within position as well as overall. Raw point projections are
 * not comparable across positions (a QB out-scores every RB yet is drafted far
 * later), so position is the peer bucket for any value judgement.
 */
function rankByProjection(players = []) {
  const overallRankById = new Map();
  const positionRankById = new Map();

  const projectable = players.filter(hasProjection);

  [...projectable]
    .sort(
      (a, b) => finiteNumber(b.projectedTotal) - finiteNumber(a.projectedTotal),
    )
    .forEach((player, index) => {
      overallRankById.set(player.id, index + 1);
    });

  for (const [, group] of groupByPosition(projectable)) {
    [...group]
      .sort(
        (a, b) =>
          finiteNumber(b.projectedTotal) - finiteNumber(a.projectedTotal),
      )
      .forEach((player, index) => {
        positionRankById.set(player.id, index + 1);
      });
  }

  return { overallRankById, positionRankById };
}

function rankByAdp(players = []) {
  const positionAdpRankById = new Map();

  for (const [, group] of groupByPosition(players.filter(hasUsableAdp))) {
    [...group]
      .sort((a, b) => finiteNumber(a.adp) - finiteNumber(b.adp))
      .forEach((player, index) => {
        positionAdpRankById.set(player.id, index + 1);
      });
  }

  return positionAdpRankById;
}

function buildSleeperDistribution(players = [], ranks = {}) {
  const { positionRankById = new Map(), positionAdpRankById = new Map() } =
    ranks;
  const deltasByPosition = new Map();

  for (const player of players) {
    const projectedPositionRank = positionRankById.get(player?.id);
    const adpPositionRank = positionAdpRankById.get(player?.id);

    if (!projectedPositionRank || !adpPositionRank) {
      continue;
    }

    const position = player?.position || "UNKNOWN";
    if (!deltasByPosition.has(position)) {
      deltasByPosition.set(position, []);
    }
    deltasByPosition
      .get(position)
      .push(adpPositionRank - projectedPositionRank);
  }

  const distributionByPosition = new Map();

  for (const [position, deltas] of deltasByPosition) {
    const mean = average(deltas);
    distributionByPosition.set(position, {
      position,
      mean,
      stdDev: stdDev(deltas, mean),
      sampleSize: deltas.length,
    });
  }

  return distributionByPosition;
}

/**
 * Actual (positional ADP) vs expected (positional projection rank). A positive
 * delta means the market drafts the player later than the projection warrants.
 */
function computeSleeperScore(player = {}, context = {}) {
  const {
    positionRankById = new Map(),
    positionAdpRankById = new Map(),
    distributionByPosition = new Map(),
  } = context;

  const projectedPositionRank = positionRankById.get(player?.id) ?? null;

  const base = {
    projectedPositionRank,
    adpPositionRank: positionAdpRankById.get(player?.id) ?? null,
    adpDelta: null,
    sleeperScore: null,
    peerSampleSize: 0,
  };

  if (player?.adpIsPlaceholder) {
    return {
      ...base,
      status: "no_adp_signal",
      excludedReason: "placeholder_adp",
    };
  }

  if (projectedPositionRank === null) {
    return {
      ...base,
      status: "insufficient_data",
      excludedReason: "missing_projection",
    };
  }

  if (base.adpPositionRank === null) {
    return {
      ...base,
      status: "insufficient_data",
      excludedReason: "missing_adp",
    };
  }

  const distribution = distributionByPosition.get(
    player?.position || "UNKNOWN",
  );
  const sampleSize = distribution?.sampleSize || 0;

  if (sampleSize < MIN_PEER_SAMPLE) {
    return {
      ...base,
      peerSampleSize: sampleSize,
      status: "insufficient_peers",
      excludedReason: "small_position_sample",
    };
  }

  const adpDelta = base.adpPositionRank - projectedPositionRank;
  const mean = finiteNumber(distribution?.mean);
  const deviation = finiteNumber(distribution?.stdDev);

  let z = 0;
  if (mean !== null && deviation !== null && deviation > 0) {
    z = (adpDelta - mean) / deviation;
  }

  let status = "valued_as_expected";
  if (z > 1) {
    status = "undervalued";
  } else if (z < -1) {
    status = "overvalued";
  }

  return {
    ...base,
    adpDelta: roundNullable(adpDelta, 1),
    sleeperScore: roundNullable(z, 2),
    peerSampleSize: sampleSize,
    status,
    excludedReason: null,
  };
}

function attachSleeperScores(players = []) {
  const { overallRankById, positionRankById } = rankByProjection(players);
  const positionAdpRankById = rankByAdp(players);
  const distributionByPosition = buildSleeperDistribution(players, {
    positionRankById,
    positionAdpRankById,
  });

  const context = {
    positionRankById,
    positionAdpRankById,
    distributionByPosition,
  };

  const scored = players.map((player) => ({
    ...player,
    projectedRank: overallRankById.get(player.id) ?? null,
    ...computeSleeperScore(player, context),
  }));

  return { players: scored, distributionByPosition };
}

/**
 * Natural-break tiering on projectedTotal: split at the largest value gaps rather
 * than fixed widths, then merge undersized tiers the same way usage buckets do.
 */
function buildTiers(players = [], options = {}) {
  const {
    tierCount = DEFAULT_TIER_COUNT,
    minTierSize = DEFAULT_MIN_TIER_SIZE,
    metricKey = "projectedTotal",
  } = options;

  const sorted = players
    .filter((player) => finiteNumber(player?.[metricKey]) !== null)
    .sort((a, b) => finiteNumber(b[metricKey]) - finiteNumber(a[metricKey]));

  if (!sorted.length) {
    return [];
  }

  const gaps = [];
  for (let index = 1; index < sorted.length; index += 1) {
    gaps.push({
      index,
      size:
        finiteNumber(sorted[index - 1][metricKey]) -
        finiteNumber(sorted[index][metricKey]),
    });
  }

  const breakIndexes = gaps
    .sort((a, b) => b.size - a.size)
    .slice(0, Math.max(0, tierCount - 1))
    .map((gap) => gap.index)
    .sort((a, b) => a - b);

  const groups = [];
  let start = 0;
  for (const breakIndex of [...breakIndexes, sorted.length]) {
    if (breakIndex > start) {
      groups.push(sorted.slice(start, breakIndex));
      start = breakIndex;
    }
  }

  while (groups.length > 1) {
    const sparseIndex = groups.findIndex((group) => group.length < minTierSize);
    if (sparseIndex === -1) {
      break;
    }

    const mergeIndex = sparseIndex === 0 ? 1 : sparseIndex - 1;
    const left = Math.min(sparseIndex, mergeIndex);
    const right = Math.max(sparseIndex, mergeIndex);

    groups[left] = [...groups[left], ...groups[right]];
    groups.splice(right, 1);
  }

  return groups.map((group, index) => {
    const values = group.map((player) => finiteNumber(player[metricKey]));
    const mean = average(values);

    return {
      tier: index + 1,
      count: group.length,
      high: roundNullable(values[0], 2),
      low: roundNullable(values[values.length - 1], 2),
      mean: roundNullable(mean, 2),
      stdDev: roundNullable(stdDev(values, mean), 2),
      playerIds: group.map((player) => player.id),
    };
  });
}

function attachTiers(players = [], options = {}) {
  const tiers = buildTiers(players, options);
  const tierById = new Map();

  for (const tier of tiers) {
    for (const playerId of tier.playerIds) {
      tierById.set(playerId, tier.tier);
    }
  }

  const tiered = players.map((player) => ({
    ...player,
    tier: tierById.get(player.id) ?? null,
  }));

  return {
    players: tiered,
    tiers: tiers.map(({ playerIds, ...summary }) => summary),
  };
}

module.exports = {
  DEFAULT_TIER_COUNT,
  DEFAULT_MIN_TIER_SIZE,
  MIN_PEER_SAMPLE,
  hasProjection,
  hasUsableAdp,
  rankByProjection,
  rankByAdp,
  buildSleeperDistribution,
  computeSleeperScore,
  attachSleeperScores,
  buildTiers,
  attachTiers,
};
