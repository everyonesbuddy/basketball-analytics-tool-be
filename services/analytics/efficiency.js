function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStatValue(stat) {
  if (stat === null || stat === undefined) {
    return null;
  }

  if (typeof stat === "number") {
    return Number.isFinite(stat) ? stat : null;
  }

  const text = String(stat).trim();

  if (!text) {
    return null;
  }

  if (text.includes("-")) {
    const parts = text.split("-");
    const attempts = toNumber(parts[1]);
    return attempts;
  }

  return toNumber(text.replace(/,/g, ""));
}

function calculatePossessions({ fga, oreb, tov, fta }) {
  const fieldGoalAttempts = toNumber(fga);
  const offensiveRebounds = toNumber(oreb);
  const turnovers = toNumber(tov);
  const freeThrowAttempts = toNumber(fta);

  if (
    fieldGoalAttempts === null ||
    offensiveRebounds === null ||
    turnovers === null ||
    freeThrowAttempts === null
  ) {
    return null;
  }

  return (
    fieldGoalAttempts - offensiveRebounds + turnovers + 0.44 * freeThrowAttempts
  );
}

function calculateOffensiveRating(pointsScored, possessions) {
  const points = toNumber(pointsScored);
  const poss = toNumber(possessions);

  if (points === null || poss === null || poss <= 0) {
    return null;
  }

  return (points / poss) * 100;
}

function calculateDefensiveRating(pointsAllowed, possessions) {
  const points = toNumber(pointsAllowed);
  const poss = toNumber(possessions);

  if (points === null || poss === null || poss <= 0) {
    return null;
  }

  return (points / poss) * 100;
}

function calculateNetRating(offRtg, defRtg) {
  const offense = toNumber(offRtg);
  const defense = toNumber(defRtg);

  if (offense === null || defense === null) {
    return null;
  }

  return offense - defense;
}

function extractTeamStats(statistics = []) {
  const lookup = new Map();

  for (const stat of statistics) {
    if (stat?.name) {
      lookup.set(stat.name, stat);
    }
  }

  const fieldGoals = lookup.get("fieldGoalsMade-fieldGoalsAttempted");
  const freeThrows = lookup.get("freeThrowsMade-freeThrowsAttempted");

  return {
    fga: parseStatValue(fieldGoals?.displayValue),
    oreb: parseStatValue(lookup.get("offensiveRebounds")?.displayValue),
    tov: parseStatValue(
      lookup.get("totalTurnovers")?.displayValue ??
        lookup.get("turnovers")?.displayValue,
    ),
    fta: parseStatValue(freeThrows?.displayValue),
  };
}

function buildEfficiencyLine({
  pointsScored,
  pointsAllowed,
  fga,
  oreb,
  tov,
  fta,
}) {
  const possessions = calculatePossessions({ fga, oreb, tov, fta });
  const offRtg = calculateOffensiveRating(pointsScored, possessions);
  const defRtg = calculateDefensiveRating(pointsAllowed, possessions);

  return {
    possessions,
    offRtg,
    defRtg,
    netRtg: calculateNetRating(offRtg, defRtg),
  };
}

module.exports = {
  calculatePossessions,
  calculateOffensiveRating,
  calculateDefensiveRating,
  calculateNetRating,
  extractTeamStats,
  buildEfficiencyLine,
  parseStatValue,
};
