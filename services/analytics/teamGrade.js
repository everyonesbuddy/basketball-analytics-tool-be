const { average, stdDev } = require("./usageValue");
const { finiteNumber, roundNullable } = require("../../utils/reshapeFantasy");

const METRIC_DEFINITIONS = [
  { key: "netRtg", label: "Net rating", direction: 1, weight: 0.4 },
  { key: "offRtg", label: "Offensive rating", direction: 1, weight: 0.25 },
  { key: "defRtg", label: "Defensive rating", direction: -1, weight: 0.25 },
  { key: "winRate", label: "Win rate", direction: 1, weight: 0.1 },
];

function buildTeamMetrics(efficiency = {}) {
  const games = Array.isArray(efficiency?.recentGames)
    ? efficiency.recentGames
    : [];
  const wins = games.filter((game) => game?.score?.result === "W").length;

  return {
    netRtg: finiteNumber(efficiency?.aggregate?.netRtg),
    offRtg: finiteNumber(efficiency?.aggregate?.offRtg),
    defRtg: finiteNumber(efficiency?.aggregate?.defRtg),
    winRate: games.length ? wins / games.length : null,
    gamesPlayed: games.length,
  };
}

function buildMetricDistributions(rows = []) {
  const distributions = {};

  for (const definition of METRIC_DEFINITIONS) {
    const values = rows
      .map((row) => finiteNumber(row?.metrics?.[definition.key]))
      .filter((value) => value !== null);
    const mean = average(values);
    distributions[definition.key] = {
      mean,
      stdDev: stdDev(values, mean),
      sampleSize: values.length,
    };
  }

  return distributions;
}

function scoreMetric(value, definition, distribution) {
  const parsed = finiteNumber(value);
  const mean = finiteNumber(distribution?.mean);
  const deviation = finiteNumber(distribution?.stdDev);

  if (parsed === null || mean === null || deviation === null) {
    return null;
  }

  const zScore =
    deviation > 0 ? ((parsed - mean) / deviation) * definition.direction : 0;
  const score = Math.max(0, Math.min(100, 50 + zScore * 15));

  return {
    key: definition.key,
    label: definition.label,
    value: roundNullable(parsed, 2),
    leagueAverage: roundNullable(mean, 2),
    zScore: roundNullable(zScore, 2),
    score: roundNullable(score, 1),
    direction:
      definition.direction === 1 ? "higher_is_better" : "lower_is_better",
    sampleSize: distribution.sampleSize,
  };
}

function scoreToGrade(score) {
  if (score === null) return "N/A";
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function gradeTeam(efficiency, leagueRows = []) {
  const target = { metrics: buildTeamMetrics(efficiency) };
  const rows = leagueRows.map((row) => ({
    teamId: row.teamId,
    team: row.team,
    metrics: buildTeamMetrics(row),
  }));
  const distributions = buildMetricDistributions(rows);
  const metricScores = METRIC_DEFINITIONS.map((definition) =>
    scoreMetric(
      target.metrics[definition.key],
      definition,
      distributions[definition.key],
    ),
  ).filter(Boolean);

  const totalWeight = metricScores.reduce(
    (sum, metric) =>
      sum +
      (METRIC_DEFINITIONS.find((item) => item.key === metric.key)?.weight || 0),
    0,
  );
  const weightedScore = totalWeight
    ? metricScores.reduce(
        (sum, metric) =>
          sum +
          metric.score *
            (METRIC_DEFINITIONS.find((item) => item.key === metric.key)
              ?.weight || 0),
        0,
      ) / totalWeight
    : null;

  const sorted = [...metricScores].sort((a, b) => b.score - a.score);

  return {
    score: roundNullable(weightedScore, 1),
    grade: scoreToGrade(weightedScore),
    metrics: metricScores,
    strengths: sorted.slice(0, 2).map((metric) => metric.label),
    weaknesses: sorted
      .slice(-2)
      .reverse()
      .map((metric) => metric.label),
    leagueSampleSize: rows.length,
    gamesPlayed: target.metrics.gamesPlayed,
  };
}

function compareTeams(efficiencyA, efficiencyB) {
  const metricsA = buildTeamMetrics(efficiencyA);
  const metricsB = buildTeamMetrics(efficiencyB);
  const metrics = METRIC_DEFINITIONS.map((definition) => {
    const valueA = finiteNumber(metricsA[definition.key]);
    const valueB = finiteNumber(metricsB[definition.key]);
    const difference =
      valueA !== null && valueB !== null
        ? (valueA - valueB) * definition.direction
        : null;

    return {
      key: definition.key,
      label: definition.label,
      teamA: roundNullable(valueA, 2),
      teamB: roundNullable(valueB, 2),
      difference: roundNullable(difference, 2),
      advantage:
        difference === null
          ? null
          : difference > 0
            ? "teamA"
            : difference < 0
              ? "teamB"
              : "tie",
      direction:
        definition.direction === 1 ? "higher_is_better" : "lower_is_better",
    };
  });

  const available = metrics.filter((metric) => metric.difference !== null);
  const teamAScore = available.reduce(
    (sum, metric) => sum + Math.max(0, metric.difference),
    0,
  );
  const teamBScore = available.reduce(
    (sum, metric) => sum + Math.max(0, -metric.difference),
    0,
  );
  const advantage =
    teamAScore === teamBScore
      ? "tie"
      : teamAScore > teamBScore
        ? "teamA"
        : "teamB";

  return {
    metrics,
    advantage,
    teamAScore: roundNullable(teamAScore, 2),
    teamBScore: roundNullable(teamBScore, 2),
    decisionInsights:
      advantage === "tie"
        ? "The teams are even across the available efficiency metrics."
        : `${advantage === "teamA" ? "Team A" : "Team B"} leads across the available efficiency metrics.`,
  };
}

module.exports = {
  METRIC_DEFINITIONS,
  buildTeamMetrics,
  buildMetricDistributions,
  scoreToGrade,
  gradeTeam,
  compareTeams,
};
