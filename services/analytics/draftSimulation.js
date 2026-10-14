const { selectLineup } = require("./fantasyLineup");
const { finiteNumber } = require("../../utils/reshapeFantasy");

const CANDIDATE_LIMIT = 30;
const BENCH_VALUE_WEIGHT = 0.05;
const MAX_ADP_NOISE_SD = 20;

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Snake draft: even rounds run 1..N, odd rounds run N..1.
function teamForPick(pickIndex, teamCount) {
  const round = Math.floor(pickIndex / teamCount);
  const slot = pickIndex % teamCount;
  return round % 2 === 0 ? slot : teamCount - 1 - slot;
}

function pickIndexForRound(teamIndex, round, teamCount) {
  const slot = round % 2 === 0 ? teamIndex : teamCount - 1 - teamIndex;
  return round * teamCount + slot;
}

function adpNoiseSd(baseRank) {
  return Math.min(MAX_ADP_NOISE_SD, 1 + 0.12 * baseRank);
}

function eligibleSlotsFor(position, sport) {
  const slots = [position];
  for (const [slot, eligible] of Object.entries(sport.flexSlots)) {
    if (eligible.includes(position)) slots.push(slot);
  }
  return slots;
}

function summarizeValues(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction) =>
    sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance =
    sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;

  return {
    mean,
    stdDev: Math.sqrt(variance),
    p10: at(0.1),
    p50: at(0.5),
    p90: at(0.9),
  };
}

/**
 * players: [{ id, name, position, vorp, projectedTotal, baseRank, inSim, ghost }]
 * inSim players can be drafted by anyone; ghosts (ADP but no projection) are drafted by
 * opponents only; non-inSim players exist so already-made picks can be replayed.
 */
function runDraft(
  context,
  strategy,
  order,
  availabilityTracker,
  forced = null,
) {
  const { players, byVorp, league, sport, ourTeam, rounds, priorPicks } =
    context;
  const { teamCount } = league;
  const caps = sport.draft.positionCaps;
  const lateCount = sport.draft.lateDraftPositions.length;
  const lateSet = new Set(sport.draft.lateDraftPositions);
  const totalPicks = teamCount * rounds;
  const slots = [...sport.positions, ...Object.keys(sport.flexSlots)];

  const taken = new Uint8Array(players.length);
  const teamCounts = Array.from({ length: teamCount }, () => ({}));
  const ourRoster = [];
  const ourPicks = [];

  const applyPick = (pickIndex, playerIndex) => {
    taken[playerIndex] = 1;
    const team = teamForPick(pickIndex, teamCount);
    const position = players[playerIndex].position;
    if (position) {
      teamCounts[team][position] = (teamCounts[team][position] || 0) + 1;
    }
    if (team === ourTeam) ourRoster.push(players[playerIndex]);
  };

  priorPicks.forEach((playerIndex, pickIndex) =>
    applyPick(pickIndex, playerIndex),
  );

  const chooseOurPick = (round) => {
    const remainingPicks = rounds - round + 1;
    const lineup = selectLineup(ourRoster, league, sport);
    const filled = {};
    for (const { slot } of lineup) filled[slot] = (filled[slot] || 0) + 1;

    const shortfall = {};
    let totalShortfall = 0;
    let fixedShortfall = 0;
    for (const slot of slots) {
      const missing = (league.starters[slot] || 0) - (filled[slot] || 0);
      if (missing > 0) {
        shortfall[slot] = missing;
        totalShortfall += missing;
        if (!sport.flexSlots[slot]) fixedShortfall += missing;
      }
    }

    // Once picks left no longer exceed open starting slots, every pick must fill one.
    let needPositions = null;
    if (totalShortfall >= remainingPicks) {
      needPositions = new Set();
      const fixedOpen = Object.keys(shortfall).filter(
        (slot) => !sport.flexSlots[slot],
      );
      const source = fixedShortfall > 0 ? fixedOpen : Object.keys(shortfall);
      for (const slot of source) {
        for (const position of sport.flexSlots[slot] || [slot]) {
          needPositions.add(position);
        }
      }
    }

    let strategyPositions = null;
    for (const target of strategy.targets) {
      const have = ourRoster.filter(
        (player) => player.position === target.position,
      ).length;
      if (round >= target.round && have < target.count) {
        strategyPositions = new Set([target.position]);
        break;
      }
    }
    if (!strategyPositions) {
      const planned = strategy.roundPositions[round - 1];
      if (planned && planned.length) strategyPositions = new Set(planned);
    }

    const ownCounts = {};
    for (const player of ourRoster) {
      if (player.position) {
        ownCounts[player.position] = (ownCounts[player.position] || 0) + 1;
      }
    }

    const collect = (useStrategy, useNeed) => {
      const found = [];
      for (const playerIndex of byVorp) {
        if (taken[playerIndex]) continue;
        const { position } = players[playerIndex];
        if (!position) continue;
        if ((ownCounts[position] || 0) >= (caps[position] ?? Infinity))
          continue;
        if (useNeed && needPositions && !needPositions.has(position)) continue;
        if (
          !(useNeed && needPositions) &&
          lateSet.has(position) &&
          remainingPicks > lateCount + 1
        ) {
          continue;
        }
        if (
          useStrategy &&
          strategyPositions &&
          !strategyPositions.has(position)
        ) {
          continue;
        }
        found.push(playerIndex);
        if (found.length >= CANDIDATE_LIMIT) break;
      }
      return found;
    };

    let candidates = collect(true, true);
    if (!candidates.length) candidates = collect(false, true);
    if (!candidates.length) candidates = collect(false, false);
    if (!candidates.length) return -1;

    let best = -1;
    let bestGain = -Infinity;
    for (const playerIndex of candidates) {
      const player = players[playerIndex];
      const vorp = Math.max(finiteNumber(player.vorp) || 0, 0);
      const eligibleSlots = eligibleSlotsFor(player.position, sport);
      const hasOpenSlot = eligibleSlots.some((slot) => shortfall[slot] > 0);

      let gain;
      if (hasOpenSlot) {
        gain = vorp;
      } else {
        let weakestStarter = Infinity;
        for (const entry of lineup) {
          if (eligibleSlots.includes(entry.slot)) {
            weakestStarter = Math.min(
              weakestStarter,
              finiteNumber(entry.player.vorp) || 0,
            );
          }
        }
        gain = Number.isFinite(weakestStarter)
          ? Math.max(0, vorp - weakestStarter)
          : vorp;
      }

      gain += BENCH_VALUE_WEIGHT * vorp;
      if (gain > bestGain) {
        bestGain = gain;
        best = playerIndex;
      }
    }

    return best;
  };

  let head = 0;
  let availabilityRecorded = false;
  let forcedHonored = false;

  for (
    let pickIndex = priorPicks.length;
    pickIndex < totalPicks;
    pickIndex += 1
  ) {
    const team = teamForPick(pickIndex, teamCount);
    let playerIndex = -1;

    if (team === ourTeam) {
      if (availabilityTracker && !availabilityRecorded) {
        availabilityTracker.counts.forEach((_, slot) => {
          if (!taken[availabilityTracker.indexes[slot]]) {
            availabilityTracker.counts[slot] += 1;
          }
        });
        availabilityRecorded = true;
      }
      if (
        forced &&
        pickIndex === forced.pickIndex &&
        !taken[forced.playerIndex]
      ) {
        playerIndex = forced.playerIndex;
        forcedHonored = true;
      } else {
        playerIndex = chooseOurPick(Math.floor(pickIndex / teamCount) + 1);
      }
    } else {
      while (head < order.length && taken[order[head]]) head += 1;
      for (let cursor = head; cursor < order.length; cursor += 1) {
        const candidate = order[cursor];
        if (taken[candidate]) continue;
        const { position } = players[candidate];
        if (
          position &&
          (teamCounts[team][position] || 0) >= (caps[position] ?? Infinity)
        ) {
          continue;
        }
        playerIndex = candidate;
        break;
      }
    }

    if (playerIndex < 0) break;
    applyPick(pickIndex, playerIndex);
    if (team === ourTeam) {
      ourPicks.push({
        pickIndex,
        round: Math.floor(pickIndex / teamCount) + 1,
        playerIndex,
      });
    }
  }

  return { ourRoster, ourPicks, forcedHonored };
}

function simulateStrategies(context, strategies, options = {}) {
  const { players, league, sport, ourTeam, rounds } = context;
  const { simulations = 150, seed = 1, availabilityIndexes = [] } = options;
  const rng = mulberry32(seed);
  const simIndexes = [];
  players.forEach((player, index) => {
    if (player.inSim) simIndexes.push(index);
  });

  const results = strategies.map((strategy) => ({
    strategy,
    starterVorp: [],
    lineupPoints: [],
    complete: 0,
    positionTotals: {},
    pickCounts: Array.from({ length: rounds }, () => new Map()),
  }));
  const availabilityTracker = {
    indexes: availabilityIndexes,
    counts: availabilityIndexes.map(() => 0),
  };
  const slotsRequired = [
    ...sport.positions,
    ...Object.keys(sport.flexSlots),
  ].reduce((sum, slot) => sum + (league.starters[slot] || 0), 0);

  for (let run = 0; run < simulations; run += 1) {
    // One noise draw per player per run, shared by every strategy.
    const perceived = new Float64Array(players.length);
    for (const index of simIndexes) {
      const { baseRank } = players[index];
      perceived[index] = Math.max(
        0.5,
        baseRank + adpNoiseSd(baseRank) * gaussian(rng),
      );
    }
    const order = [...simIndexes].sort((a, b) => perceived[a] - perceived[b]);

    strategies.forEach((strategy, strategyIndex) => {
      const { ourRoster, ourPicks } = runDraft(
        context,
        strategy,
        order,
        strategyIndex === 0 ? availabilityTracker : null,
      );
      const lineup = selectLineup(ourRoster, league, sport);
      const result = results[strategyIndex];

      result.starterVorp.push(
        lineup.reduce(
          (sum, { player }) => sum + (finiteNumber(player.vorp) || 0),
          0,
        ),
      );
      result.lineupPoints.push(
        lineup.reduce(
          (sum, { player }) => sum + (finiteNumber(player.projectedTotal) || 0),
          0,
        ),
      );
      if (lineup.length >= slotsRequired) result.complete += 1;

      for (const player of ourRoster) {
        if (player.position) {
          result.positionTotals[player.position] =
            (result.positionTotals[player.position] || 0) + 1;
        }
      }
      for (const pick of ourPicks) {
        const counter = result.pickCounts[pick.round - 1];
        counter.set(pick.playerIndex, (counter.get(pick.playerIndex) || 0) + 1);
      }
    });
  }

  return { results, availabilityTracker, simulations };
}

/**
 * Replays the same simulated drafts as simulateStrategies (same seed, same noise draws) but
 * forces each candidate at the next pick, then follows the baseline strategy afterwards.
 * Only runs where the candidate was still available count, and each is compared with the
 * baseline on the identical draft.
 */
function simulateForcedPicks(
  context,
  baselineStrategy,
  candidates,
  options = {},
) {
  const { players, league, sport } = context;
  const {
    simulations = 100,
    seed = 1,
    baselineValues = [],
    pickIndex,
  } = options;
  const rng = mulberry32(seed);
  const simIndexes = [];
  players.forEach((player, index) => {
    if (player.inSim) simIndexes.push(index);
  });

  const outcomes = candidates.map((playerIndex) => ({
    playerIndex,
    values: [],
    gains: [],
  }));

  for (let run = 0; run < simulations; run += 1) {
    const perceived = new Float64Array(players.length);
    for (const index of simIndexes) {
      const { baseRank } = players[index];
      perceived[index] = Math.max(
        0.5,
        baseRank + adpNoiseSd(baseRank) * gaussian(rng),
      );
    }
    const order = [...simIndexes].sort((a, b) => perceived[a] - perceived[b]);

    candidates.forEach((playerIndex, slot) => {
      const { ourRoster, forcedHonored } = runDraft(
        context,
        baselineStrategy,
        order,
        null,
        { pickIndex, playerIndex },
      );
      if (!forcedHonored) return;

      const value = selectLineup(ourRoster, league, sport).reduce(
        (sum, { player }) => sum + (finiteNumber(player.vorp) || 0),
        0,
      );
      outcomes[slot].values.push(value);
      outcomes[slot].gains.push(value - baselineValues[run]);
    });
  }

  return { outcomes, simulations };
}

module.exports = {
  mulberry32,
  teamForPick,
  pickIndexForRound,
  adpNoiseSd,
  summarizeValues,
  simulateStrategies,
  simulateForcedPicks,
};
