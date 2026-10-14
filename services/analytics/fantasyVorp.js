const { finiteNumber, roundNullable } = require("../../utils/reshapeFantasy");
const { NFL } = require("../../config/fantasySports");
const { attachTiers } = require("./fantasyValue");

const DEFAULT_LEAGUE_SETTINGS = NFL.defaultLeague;
const POSITIONS = NFL.positions;

function slotKeys(sport) {
  return [...sport.positions, ...Object.keys(sport.flexSlots)];
}

function normalizeLeagueSettings(input = {}, sport = NFL) {
  const teamCount = Number(input?.teamCount);
  const starters = {};

  for (const slot of slotKeys(sport)) {
    const value = Number(input?.starters?.[slot]);
    starters[slot] =
      Number.isInteger(value) && value >= 0
        ? value
        : sport.defaultLeague.starters[slot];
  }

  return {
    teamCount:
      Number.isInteger(teamCount) && teamCount >= 2 && teamCount <= 32
        ? teamCount
        : sport.defaultLeague.teamCount,
    starters,
  };
}

function playersByPosition(players = [], sport = NFL) {
  const groups = new Map(sport.positions.map((position) => [position, []]));

  for (const player of players) {
    if (
      !groups.has(player?.position) ||
      finiteNumber(player?.projectedTotal) === null
    ) {
      continue;
    }
    groups.get(player.position).push(player);
  }

  for (const playersAtPosition of groups.values()) {
    playersAtPosition.sort(
      (a, b) => finiteNumber(b.projectedTotal) - finiteNumber(a.projectedTotal),
    );
  }

  return groups;
}

// Flex slots are filled in declared order (most restrictive first) by whichever eligible
// position's next-best replacement candidate projects highest.
function allocateFlexSlots(groups, replacementRanks, league, sport) {
  for (const [slotName, eligiblePositions] of Object.entries(sport.flexSlots)) {
    const slotCount = league.teamCount * (league.starters[slotName] || 0);

    for (let slot = 0; slot < slotCount; slot += 1) {
      let bestPosition = null;
      let bestProjection = null;

      for (const position of eligiblePositions) {
        const player = groups.get(position)?.[replacementRanks[position]];
        const projection = finiteNumber(player?.projectedTotal);
        if (
          projection !== null &&
          (bestProjection === null || projection > bestProjection)
        ) {
          bestPosition = position;
          bestProjection = projection;
        }
      }

      if (!bestPosition) {
        break;
      }

      replacementRanks[bestPosition] += 1;
    }
  }
}

function buildReplacementBaselines(players = [], settings = {}, sport = NFL) {
  const league = normalizeLeagueSettings(settings, sport);
  const groups = playersByPosition(players, sport);
  const replacementRanks = {};

  for (const position of sport.positions) {
    replacementRanks[position] = league.teamCount * league.starters[position];
  }

  allocateFlexSlots(groups, replacementRanks, league, sport);

  const baselines = {};
  for (const position of sport.positions) {
    const playersAtPosition = groups.get(position) || [];
    const replacementPlayer =
      playersAtPosition[replacementRanks[position] - 1] || null;
    baselines[position] = {
      replacementRank: replacementRanks[position],
      replacementPlayerId: replacementPlayer?.id || null,
      replacementPlayerName: replacementPlayer?.name || null,
      projectedTotal: roundNullable(replacementPlayer?.projectedTotal, 2),
    };
  }

  return { league, baselines };
}

function attachVorp(players = [], settings = {}, sport = NFL) {
  const { league, baselines } = buildReplacementBaselines(
    players,
    settings,
    sport,
  );
  const withVorp = players.map((player) => {
    const projectedTotal = finiteNumber(player?.projectedTotal);
    const baseline = baselines[player?.position]?.projectedTotal;
    const replacement = finiteNumber(baseline);

    return {
      ...player,
      replacementBaseline: replacement,
      vorp:
        projectedTotal !== null && replacement !== null
          ? roundNullable(projectedTotal - replacement, 2)
          : null,
    };
  });

  const { players: tiered, tiers } = attachTiers(withVorp, {
    metricKey: "vorp",
  });
  const ranked = tiered
    .filter((player) => finiteNumber(player.vorp) !== null)
    .sort((a, b) => finiteNumber(b.vorp) - finiteNumber(a.vorp))
    .map((player, index) => ({ ...player, vorpRank: index + 1 }));

  return { league, baselines, players: ranked, tiers };
}

module.exports = {
  DEFAULT_LEAGUE_SETTINGS,
  POSITIONS,
  normalizeLeagueSettings,
  buildReplacementBaselines,
  attachVorp,
};
