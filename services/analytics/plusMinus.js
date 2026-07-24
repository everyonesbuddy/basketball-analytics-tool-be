function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePlusMinusValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = String(value).replace(/\+/g, "").trim();
  const number = Number(parsed);
  return Number.isFinite(number) ? number : null;
}

function mapAthleteBoxScore(group = {}, row = {}) {
  const keys = Array.isArray(group.keys) ? group.keys : [];
  const labels = Array.isArray(group.labels) ? group.labels : [];
  const stats = Array.isArray(row.stats) ? row.stats : [];

  const byKey = {};
  const byLabel = {};

  for (let index = 0; index < stats.length; index += 1) {
    const key = keys[index] || `stat_${index}`;
    const label = labels[index] || key;
    const value = stats[index] ?? null;

    byKey[key] = value;
    byLabel[label] = value;
  }

  return {
    keys,
    labels,
    stats,
    byKey,
    byLabel,
  };
}

function calculateRollingAverage(values, windowSize = 5) {
  const series = values.filter((value) => Number.isFinite(Number(value)));

  if (!series.length) {
    return null;
  }

  const window = series.slice(-Math.max(1, windowSize));
  const total = window.reduce((sum, value) => sum + Number(value), 0);

  return Number((total / window.length).toFixed(2));
}

function aggregatePlayerPlusMinus(athleteId, games = [], windowSize = 5) {
  const orderedGames = [...games]
    .filter(Boolean)
    .sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));

  const trend = orderedGames.map((game, index) => {
    const recentWindow = orderedGames.slice(
      Math.max(0, index - windowSize + 1),
      index + 1,
    );
    const rollingAverage = calculateRollingAverage(
      recentWindow.map((item) => item.plusMinus),
      windowSize,
    );

    return {
      ...game,
      rollingAverage,
    };
  });

  const plusMinusValues = trend
    .map((item) => toNumber(item.plusMinus))
    .filter((value) => value !== null);
  const totalPlusMinus = plusMinusValues.reduce((sum, value) => sum + value, 0);
  const averagePlusMinus = plusMinusValues.length
    ? Number((totalPlusMinus / plusMinusValues.length).toFixed(2))
    : null;

  return {
    athleteId: String(athleteId),
    gamesPlayed: trend.length,
    totalPlusMinus,
    averagePlusMinus,
    rollingAverage: calculateRollingAverage(plusMinusValues, windowSize),
    trend,
    lastUpdatedAt: new Date().toISOString(),
  };
}

function extractPlayerPlusMinusFromSummary(summary, athleteId) {
  const playerSections = summary?.boxscore?.players;

  if (!Array.isArray(playerSections)) {
    return null;
  }

  for (const teamSection of playerSections) {
    for (const group of teamSection?.statistics || []) {
      const plusMinusIndex = Array.isArray(group?.keys)
        ? group.keys.indexOf("plusMinus")
        : -1;

      if (plusMinusIndex === -1) {
        continue;
      }

      for (const row of group?.athletes || []) {
        if (String(row?.athlete?.id) !== String(athleteId)) {
          continue;
        }

        return {
          athleteId: String(athleteId),
          plusMinus: parsePlusMinusValue(row?.stats?.[plusMinusIndex]),
          athlete: row.athlete,
          team: teamSection?.team || null,
          boxScore: mapAthleteBoxScore(group, row),
        };
      }
    }
  }

  return null;
}

module.exports = {
  aggregatePlayerPlusMinus,
  calculateRollingAverage,
  extractPlayerPlusMinusFromSummary,
  mapAthleteBoxScore,
  parsePlusMinusValue,
};
