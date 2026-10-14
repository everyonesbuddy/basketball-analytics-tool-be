const crypto = require("crypto");
const cache = require("../../cache/memoryCache");
const { getPlayerPool } = require("./draftAssistant");
const {
  attachVorp,
  normalizeLeagueSettings,
} = require("../analytics/fantasyVorp");
const {
  simulateStrategies,
  simulateForcedPicks,
  summarizeValues,
  pickIndexForRound,
} = require("../analytics/draftSimulation");
const { getSport } = require("../../config/fantasySports");
const { finiteNumber, roundNullable } = require("../../utils/reshapeFantasy");

const DRAFT_SIMULATION_TTL_MS = 5 * 60 * 1000;
const AVAILABILITY_CANDIDATES = 40;
const AVAILABILITY_RESULTS = 15;
const PICK_PLAN_CHOICES = 3;
const PICK_OPTION_LIMIT = 8;
const PICK_OPTION_MIN_AVAILABILITY = 20;
const PICK_OPTION_MIN_SAMPLE = 10;

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function hashKey(value) {
  return crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

function compactSimPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    team: player.team?.abbreviation || null,
    vorp: player.vorp ?? null,
    projectedTotal: player.projectedTotal ?? null,
    adp: player.adpIsPlaceholder ? null : player.adp,
  };
}

// Players with a projection are draftable by anyone. Players with a real ADP but no
// projection are drafted by opponents only, so the pool does not shift around injured stars.
function buildSimPlayers(poolPlayers, rankedPlayers) {
  const vorpById = new Map(rankedPlayers.map((player) => [player.id, player]));

  const players = poolPlayers.map((player) => {
    const ranked = vorpById.get(player.id);
    const hasUsableAdp =
      !player.adpIsPlaceholder && finiteNumber(player.adp) !== null;
    const merged = ranked
      ? { ...player, ...ranked }
      : { ...player, vorp: null };

    return {
      ...merged,
      ghost: !ranked && hasUsableAdp,
      inSim: Boolean(ranked) || hasUsableAdp,
      hasUsableAdp,
      baseRank: Infinity,
    };
  });

  const withAdp = players.filter(
    (player) => player.inSim && player.hasUsableAdp,
  );
  const maxAdp = withAdp.reduce((max, player) => Math.max(max, player.adp), 0);
  for (const player of withAdp) player.baseRank = player.adp;

  // Without a usable ADP, order by projection so the tail of the board still behaves sensibly.
  players
    .filter((player) => player.inSim && !player.hasUsableAdp)
    .sort(
      (a, b) =>
        (finiteNumber(b.projectedTotal) || 0) -
        (finiteNumber(a.projectedTotal) || 0),
    )
    .forEach((player, index) => {
      player.baseRank = maxAdp + 1 + index;
    });

  return { players, adpSourcedCount: withAdp.length };
}

function buildPickSchedule({
  ourTeam,
  teamCount,
  rounds,
  picksMade,
  players,
  priorPicks,
}) {
  const schedule = [];
  for (let round = 0; round < rounds; round += 1) {
    const pickIndex = pickIndexForRound(ourTeam, round, teamCount);
    const made = pickIndex < picksMade;
    schedule.push({
      round: round + 1,
      overallPick: pickIndex + 1,
      status: made ? "made" : "upcoming",
      player: made ? compactSimPlayer(players[priorPicks[pickIndex]]) : null,
    });
  }
  return schedule;
}

function describeSituation({
  draftPosition,
  teamCount,
  rounds,
  picksMade,
  schedule,
  adpSourcedCount,
}) {
  const next = schedule.find((entry) => entry.status === "upcoming") || null;
  return {
    draftPosition,
    teamCount,
    rounds,
    format: "snake",
    picksMade,
    totalPicks: teamCount * rounds,
    yourNextPick: next
      ? {
          round: next.round,
          overallPick: next.overallPick,
          picksUntilYou: next.overallPick - 1 - picksMade,
        }
      : null,
    yourPicks: schedule.map((entry) => entry.overallPick),
    playersWithAdp: adpSourcedCount,
  };
}

function buildInsights({
  ranked,
  baseline,
  next,
  availability,
  pickOptions,
  backToBack,
}) {
  const insights = [];
  const best = ranked[0];
  const second = ranked[1];

  if (pickOptions.length) {
    const top = pickOptions[0];
    const runnerUp = pickOptions[1];
    if (top.isDefaultPick) {
      insights.push(
        `Best pick at #${next.overallPick}: ${top.name} (${top.position}), also the default value pick, available in ${top.availabilityPct}% of simulated drafts.`,
      );
      if (runnerUp && runnerUp.vsBestValue.meanDifference < 0) {
        insights.push(
          `The next best option, ${runnerUp.name}, costs about ${Math.abs(runnerUp.vsBestValue.meanDifference)} lineup VORP.`,
        );
      }
    } else {
      insights.push(
        `Best pick at #${next.overallPick}: ${top.name} (${top.position}), worth ${top.vsBestValue.meanDifference >= 0 ? "+" : ""}${top.vsBestValue.meanDifference} lineup VORP versus the default pick, available in ${top.availabilityPct}% of simulated drafts.`,
      );
    }
    if (backToBack) {
      insights.push(
        `You also pick at #${next.overallPick + 1}, right after, so the order of these two picks matters little.`,
      );
    }
    if (
      runnerUp &&
      top.expectedLineupVorp - runnerUp.expectedLineupVorp <
        Math.max(5, Math.abs(top.expectedLineupVorp) * 0.005)
    ) {
      insights.push(
        `${top.name} and ${runnerUp.name} are close at this pick; either is reasonable.`,
      );
    }
  }

  if (best.key === baseline.key) {
    insights.push(
      `Taking the best value at each pick is your strongest approach here; no position-first plan beat it.`,
    );
  } else {
    insights.push(
      `${best.label} gives the highest expected lineup value (${best.starterVorp.mean} VORP, ${best.vsBestValue.meanDifference} vs Best value) and beats Best value in ${best.vsBestValue.beatsBestValuePct}% of simulated drafts.`,
    );
  }

  if (second) {
    const margin = best.starterVorp.mean - second.starterVorp.mean;
    const spread = (best.starterVorp.stdDev + second.starterVorp.stdDev) / 2;
    const effect = spread > 0 ? margin / spread : 0;
    if (effect < 0.12) {
      insights.push(
        `${best.label} and ${second.label} are effectively tied, so choose between them by which players you would rather own.`,
      );
    }
  }

  const worst = ranked[ranked.length - 1];
  if (worst.key !== best.key) {
    const gap = best.starterVorp.mean - worst.starterVorp.mean;
    if (gap > best.starterVorp.stdDev * 0.25) {
      insights.push(
        `${worst.label} is the weakest direction, about ${roundNullable(gap, 0)} VORP behind ${best.label}.`,
      );
    }
  }

  if (next && availability.length) {
    const gone = availability.filter((player) => player.availabilityPct < 10);
    const likely = availability.filter(
      (player) => player.availabilityPct >= 50,
    );
    if (gone.length) {
      insights.push(
        `By pick ${next.overallPick}, ${gone
          .slice(0, 4)
          .map((player) => player.name)
          .join(
            ", ",
          )} ${gone.length === 1 ? "is" : "are"} very unlikely to be available.`,
      );
    }
    if (likely.length) {
      insights.push(
        `Likely still there at pick ${next.overallPick}: ${likely
          .slice(0, 4)
          .map((player) => `${player.name} (${player.availabilityPct}%)`)
          .join(", ")}.`,
      );
    }
  }

  return insights;
}

async function getDraftSimulation(options = {}) {
  const {
    sport: sportKey = "nfl",
    scoringId,
    season,
    leagueSettings = {},
    draftPosition,
    rounds,
    simulations = 150,
    picks = [],
    strategyKeys = null,
    forceRefresh = false,
  } = options;

  const sport = getSport(sportKey);
  const league = normalizeLeagueSettings(leagueSettings, sport);
  const { teamCount } = league;
  const totalRounds = rounds || sport.draft.defaultRounds;

  if (
    !Number.isInteger(draftPosition) ||
    draftPosition < 1 ||
    draftPosition > teamCount
  ) {
    throw badRequest(
      `draftPosition must be an integer between 1 and ${teamCount}`,
    );
  }
  if (picks.length >= teamCount * totalRounds) {
    throw badRequest("The draft is already complete for the given picks");
  }
  if (new Set(picks).size !== picks.length) {
    throw badRequest("picks must not contain the same player twice");
  }

  const available = sport.draft.strategies;
  const selected = strategyKeys
    ? available.filter(
        (strategy) =>
          strategy.key === "best_value" || strategyKeys.includes(strategy.key),
      )
    : available;
  const unknown = (strategyKeys || []).filter(
    (key) => !available.some((strategy) => strategy.key === key),
  );
  if (unknown.length) {
    throw badRequest(
      `strategies must be among ${available.map((strategy) => strategy.key).join(", ")}`,
    );
  }

  const cacheKey = `${sport.cachePrefix}-draft-sim:${hashKey({
    scoringId,
    season,
    league,
    draftPosition,
    totalRounds,
    simulations,
    picks,
    strategies: selected.map((strategy) => strategy.key),
  }).slice(0, 20)}`;

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, _cache: "HIT" };
  }

  const pool = await getPlayerPool({
    season,
    scoringId,
    forceRefresh,
    sport: sport.key,
  });
  const { players: ranked, baselines } = attachVorp(
    pool.players,
    league,
    sport,
  );
  const { players, adpSourcedCount } = buildSimPlayers(pool.players, ranked);

  const indexById = new Map(players.map((player, index) => [player.id, index]));
  const unknownPicks = picks.filter((id) => !indexById.has(id));
  if (unknownPicks.length) {
    throw badRequest(`Unknown player ids in picks: ${unknownPicks.join(", ")}`);
  }
  const priorPicks = picks.map((id) => indexById.get(id));

  const ourTeam = draftPosition - 1;
  const schedule = buildPickSchedule({
    ourTeam,
    teamCount,
    rounds: totalRounds,
    picksMade: picks.length,
    players,
    priorPicks,
  });
  const next = schedule.find((entry) => entry.status === "upcoming");
  if (!next) {
    throw badRequest("Your team has no picks remaining in this draft");
  }

  const byVorp = players
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => player.inSim && !player.ghost)
    .sort((a, b) => b.player.vorp - a.player.vorp)
    .map(({ index }) => index);
  const priorSet = new Set(priorPicks);
  const availabilityIndexes = byVorp
    .filter((index) => !priorSet.has(index))
    .slice(0, AVAILABILITY_CANDIDATES);

  const seed = parseInt(hashKey({ cacheKey }).slice(0, 8), 16);
  const context = {
    players,
    byVorp,
    league,
    sport,
    ourTeam,
    rounds: totalRounds,
    priorPicks,
  };
  const { results, availabilityTracker } = simulateStrategies(
    context,
    selected,
    {
      simulations,
      seed,
      availabilityIndexes,
    },
  );

  const baselineResult = results[0];

  const availableForOptions = availabilityIndexes
    .map((index, slot) => ({
      index,
      pct: (availabilityTracker.counts[slot] / simulations) * 100,
    }))
    .filter((entry) => entry.pct >= PICK_OPTION_MIN_AVAILABILITY)
    .slice(0, PICK_OPTION_LIMIT);

  const forced = availableForOptions.length
    ? simulateForcedPicks(
        context,
        selected[0],
        availableForOptions.map((entry) => entry.index),
        {
          simulations,
          seed,
          baselineValues: baselineResult.starterVorp,
          pickIndex: next.overallPick - 1,
        },
      )
    : { outcomes: [] };

  const defaultPickIndex = [
    ...baselineResult.pickCounts[next.round - 1].entries(),
  ].sort((a, b) => b[1] - a[1])[0]?.[0];

  const pickOptions = forced.outcomes
    .map((outcome, slot) => {
      if (outcome.values.length < PICK_OPTION_MIN_SAMPLE) return null;
      const values = summarizeValues(outcome.values);
      const gains = summarizeValues(outcome.gains);
      const wins =
        outcome.gains.filter((gain) => gain > 1e-9).length +
        0.5 * outcome.gains.filter((gain) => Math.abs(gain) <= 1e-9).length;

      return {
        ...compactSimPlayer(players[outcome.playerIndex]),
        isDefaultPick: outcome.playerIndex === defaultPickIndex,
        availabilityPct: roundNullable(availableForOptions[slot].pct, 0),
        expectedLineupVorp: roundNullable(values.mean, 1),
        vsBestValue: {
          meanDifference: roundNullable(gains.mean, 1),
          beatsBestValuePct: roundNullable(
            (wins / outcome.gains.length) * 100,
            0,
          ),
        },
        sampleSize: outcome.values.length,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.expectedLineupVorp - a.expectedLineupVorp);
  const strategies = results.map((result, position) => {
    const values = summarizeValues(result.starterVorp);
    const beats =
      position === 0
        ? null
        : result.starterVorp.reduce((sum, value, run) => {
            const other = baselineResult.starterVorp[run];
            if (Math.abs(value - other) < 1e-9) return sum + 0.5;
            return sum + (value > other ? 1 : 0);
          }, 0) / simulations;

    const positionMix = {};
    for (const [pos, total] of Object.entries(result.positionTotals)) {
      positionMix[pos] = roundNullable(total / simulations, 1);
    }

    const pickPlan = schedule.map((entry) => {
      if (entry.status === "made") {
        return { ...entry, topChoices: [] };
      }
      const counter = result.pickCounts[entry.round - 1];
      const topChoices = [...counter.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, PICK_PLAN_CHOICES)
        .map(([index, count]) => ({
          ...compactSimPlayer(players[index]),
          pct: roundNullable((count / simulations) * 100, 0),
        }));
      return { ...entry, status: "projected", topChoices };
    });

    return {
      key: result.strategy.key,
      label: result.strategy.label,
      description: result.strategy.description,
      starterVorp: {
        mean: roundNullable(values.mean, 1),
        stdDev: roundNullable(values.stdDev, 1),
        p10: roundNullable(values.p10, 1),
        p50: roundNullable(values.p50, 1),
        p90: roundNullable(values.p90, 1),
      },
      expectedLineupPoints: roundNullable(
        result.lineupPoints.reduce((sum, value) => sum + value, 0) /
          simulations,
        0,
      ),
      lineupCompletePct: roundNullable(
        (result.complete / simulations) * 100,
        0,
      ),
      vsBestValue:
        position === 0
          ? null
          : {
              meanDifference: roundNullable(
                values.mean - summarizeValues(baselineResult.starterVorp).mean,
                1,
              ),
              beatsBestValuePct: roundNullable(beats * 100, 0),
            },
      positionMix,
      pickPlan,
    };
  });

  const ranking = [...strategies]
    .sort((a, b) => b.starterVorp.mean - a.starterVorp.mean)
    .map((strategy, index) => ({ ...strategy, rank: index + 1 }));
  const rankByKey = new Map(
    ranking.map((strategy) => [strategy.key, strategy.rank]),
  );
  const ordered = strategies.map((strategy) => ({
    ...strategy,
    rank: rankByKey.get(strategy.key),
  }));
  ordered.sort((a, b) => a.rank - b.rank);

  const availability = availabilityIndexes
    .map((index, slot) => ({
      ...compactSimPlayer(players[index]),
      availabilityPct: roundNullable(
        (availabilityTracker.counts[slot] / simulations) * 100,
        0,
      ),
    }))
    .slice(0, AVAILABILITY_RESULTS);

  const payload = {
    sport: sport.key,
    season: pool.season,
    scoringId,
    scoring: pool.scoring,
    leagueSettings: league,
    simulations,
    situation: describeSituation({
      draftPosition,
      teamCount,
      rounds: totalRounds,
      picksMade: picks.length,
      schedule,
      adpSourcedCount,
    }),
    yourPicks: schedule,
    nextPickAvailability: {
      overallPick: next.overallPick,
      round: next.round,
      players: availability,
    },
    replacementBaselines: baselines,
    pickOptions: {
      overallPick: next.overallPick,
      round: next.round,
      players: pickOptions,
    },
    strategies: ordered,
    decisionInsights: buildInsights({
      ranked: ordered,
      baseline: ordered.find((strategy) => strategy.key === "best_value"),
      next,
      availability,
      pickOptions,
      backToBack: schedule.some(
        (entry) => entry.overallPick === next.overallPick + 1,
      ),
    }),
    assumptions: [
      "Other teams draft by ADP with noise that grows with pick number, capped by position limits.",
      "Your picks favor the player who most improves your starting lineup; K and D/ST wait for the final rounds.",
      "Position-first strategies are constraints, so on projected value alone they rarely beat Best value; their worth is showing what a plan costs and what it builds.",
      "Results are projection-based expectations from many simulated drafts, not predictions of a single draft.",
    ],
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, payload, DRAFT_SIMULATION_TTL_MS);
  return { ...payload, _cache: "MISS" };
}

module.exports = { getDraftSimulation };
