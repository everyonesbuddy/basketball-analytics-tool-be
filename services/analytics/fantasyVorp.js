const { finiteNumber, roundNullable } = require("../../utils/reshapeFantasy");
const { attachTiers } = require("./fantasyValue");

const DEFAULT_LEAGUE_SETTINGS = {
  teamCount: 12,
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 },
};

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"];
const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);

function normalizeLeagueSettings(input = {}) {
  const teamCount = Number(input?.teamCount);
  const starters = {};

  for (const position of [...POSITIONS, "FLEX"]) {
    const value = Number(input?.starters?.[position]);
    starters[position] =
      Number.isInteger(value) && value >= 0
        ? value
        : DEFAULT_LEAGUE_SETTINGS.starters[position];
  }

  return {
    teamCount:
      Number.isInteger(teamCount) && teamCount >= 2 && teamCount <= 32
        ? teamCount
        : DEFAULT_LEAGUE_SETTINGS.teamCount,
    starters,
  };
}

function playersByPosition(players = []) {
  const groups = new Map(POSITIONS.map((position) => [position, []]));

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

function allocateFlexSlots(groups, replacementRanks, flexSlots) {
  for (let slot = 0; slot < flexSlots; slot += 1) {
    let bestPosition = null;
    let bestProjection = null;

    for (const position of FLEX_POSITIONS) {
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

function buildReplacementBaselines(players = [], settings = {}) {
  const league = normalizeLeagueSettings(settings);
  const groups = playersByPosition(players);
  const replacementRanks = {};

  for (const position of POSITIONS) {
    replacementRanks[position] = league.teamCount * league.starters[position];
  }

  allocateFlexSlots(
    groups,
    replacementRanks,
    league.teamCount * league.starters.FLEX,
  );

  const baselines = {};
  for (const position of POSITIONS) {
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

function attachVorp(players = [], settings = {}) {
  const { league, baselines } = buildReplacementBaselines(players, settings);
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
