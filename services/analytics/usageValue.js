function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundNullable(value, decimals = 2) {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Number(parsed.toFixed(decimals));
}

function average(values = []) {
  const valid = values.filter((value) => Number.isFinite(Number(value)));
  if (!valid.length) {
    return null;
  }

  const total = valid.reduce((sum, value) => sum + Number(value), 0);
  return total / valid.length;
}

function stdDev(values = [], mean = null) {
  const mu = Number.isFinite(Number(mean)) ? Number(mean) : average(values);
  if (!Number.isFinite(mu)) {
    return null;
  }

  const valid = values.filter((value) => Number.isFinite(Number(value)));
  if (!valid.length) {
    return null;
  }

  const variance =
    valid.reduce((sum, value) => sum + (Number(value) - mu) ** 2, 0) /
    valid.length;

  return Math.sqrt(variance);
}

function buildUsageBucketLabel(low, high) {
  return `${low}-${high}`;
}

function buildInitialBuckets(players = [], width = 5) {
  const bucketsByLow = new Map();

  for (const player of players) {
    const usagePct = toNumber(player?.usagePct);
    if (!Number.isFinite(usagePct)) {
      continue;
    }

    const low = Math.floor(usagePct / width) * width;
    const high = low + width;

    if (!bucketsByLow.has(low)) {
      bucketsByLow.set(low, {
        low,
        high,
        players: [],
      });
    }

    bucketsByLow.get(low).players.push(player);
  }

  return [...bucketsByLow.values()].sort((a, b) => a.low - b.low);
}

function mergeTwoBuckets(bucketA, bucketB) {
  return {
    low: Math.min(bucketA.low, bucketB.low),
    high: Math.max(bucketA.high, bucketB.high),
    players: [...bucketA.players, ...bucketB.players],
  };
}

function mergeSparseBuckets(initialBuckets = [], minSize = 20) {
  const buckets = initialBuckets
    .map((bucket) => ({
      low: bucket.low,
      high: bucket.high,
      players: [...bucket.players],
    }))
    .sort((a, b) => a.low - b.low);

  if (!buckets.length) {
    return [];
  }

  while (buckets.length > 1) {
    const sparseIndex = buckets.findIndex(
      (bucket) => bucket.players.length < minSize,
    );

    if (sparseIndex === -1) {
      break;
    }

    let mergeIndex;
    if (sparseIndex === 0) {
      mergeIndex = 1;
    } else if (sparseIndex === buckets.length - 1) {
      mergeIndex = buckets.length - 2;
    } else {
      const leftCount = buckets[sparseIndex - 1].players.length;
      const rightCount = buckets[sparseIndex + 1].players.length;
      mergeIndex = leftCount <= rightCount ? sparseIndex - 1 : sparseIndex + 1;
    }

    const left = Math.min(sparseIndex, mergeIndex);
    const right = Math.max(sparseIndex, mergeIndex);
    const merged = mergeTwoBuckets(buckets[left], buckets[right]);

    buckets[left] = merged;
    buckets.splice(right, 1);
  }

  return buckets
    .sort((a, b) => a.low - b.low)
    .map((bucket) => ({
      ...bucket,
      label: buildUsageBucketLabel(bucket.low, bucket.high),
    }));
}

function findBucketForUsage(usagePct, buckets = []) {
  const usage = toNumber(usagePct);
  if (!Number.isFinite(usage) || !buckets.length) {
    return null;
  }

  const found = buckets.find(
    (bucket) => usage >= bucket.low && usage < bucket.high,
  );
  if (found) {
    return found;
  }

  const last = buckets[buckets.length - 1];
  if (usage >= last.low) {
    return last;
  }

  return null;
}

function computeBucketStats(buckets = [], productionKey = "efficiencyIndex") {
  return buckets.map((bucket) => {
    const values = bucket.players
      .map((player) => toNumber(player?.[productionKey]))
      .filter((value) => Number.isFinite(value));
    const mean = average(values);
    const deviation = stdDev(values, mean);

    return {
      label: bucket.label,
      low: bucket.low,
      high: bucket.high,
      count: values.length,
      mean,
      stdDev: deviation,
    };
  });
}

function classifyPlayer(player = {}, bucketStats = {}) {
  const actualProduction = toNumber(player?.efficiencyIndex);
  const expectedProduction = toNumber(bucketStats?.mean);
  const deviation = toNumber(bucketStats?.stdDev);

  let z = 0;
  if (
    Number.isFinite(actualProduction) &&
    Number.isFinite(expectedProduction) &&
    Number.isFinite(deviation) &&
    deviation > 0
  ) {
    z = (actualProduction - expectedProduction) / deviation;
  }

  let status = "in_expected_range";
  if (z > 1) {
    status = "above_expected_range";
  } else if (z < -1) {
    status = "below_expected_range";
  }

  return {
    usageBucket: bucketStats?.label || null,
    expectedProduction: roundNullable(expectedProduction, 1),
    actualProduction: roundNullable(actualProduction, 1),
    zScore: roundNullable(z, 2),
    status,
    bucketSampleSize: Number(bucketStats?.count) || 0,
  };
}

module.exports = {
  toNumber,
  roundNullable,
  average,
  stdDev,
  buildUsageBucketLabel,
  buildInitialBuckets,
  mergeSparseBuckets,
  findBucketForUsage,
  computeBucketStats,
  classifyPlayer,
};
