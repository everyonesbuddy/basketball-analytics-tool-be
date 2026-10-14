const { finiteNumber } = require("../../utils/reshapeFantasy");

function sortedByVorp(players = []) {
  return [...players].sort(
    (a, b) => (finiteNumber(b.vorp) || 0) - (finiteNumber(a.vorp) || 0),
  );
}

// Fixed positions fill first, then flex slots in declared order (most restrictive first).
function selectLineup(players = [], league, sport) {
  const remaining = [...players];
  const lineup = [];

  const take = (slot, eligiblePositions, count) => {
    const eligible = sortedByVorp(
      remaining.filter((player) => eligiblePositions.includes(player.position)),
    ).slice(0, count);
    const takenIds = new Set(eligible.map((player) => player.id));
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (takenIds.has(remaining[index].id)) remaining.splice(index, 1);
    }
    lineup.push(...eligible.map((player) => ({ player, slot })));
  };

  for (const position of sport.positions) {
    take(position, [position], league.starters[position] || 0);
  }

  for (const [slot, eligiblePositions] of Object.entries(sport.flexSlots)) {
    take(slot, eligiblePositions, league.starters[slot] || 0);
  }

  return lineup;
}

function selectStarters(players, league, sport) {
  return selectLineup(players, league, sport).map(({ player }) => player);
}

function requiredStarterCount(league, sport) {
  return [...sport.positions, ...Object.keys(sport.flexSlots)].reduce(
    (sum, slot) => sum + (league.starters[slot] || 0),
    0,
  );
}

module.exports = {
  sortedByVorp,
  selectLineup,
  selectStarters,
  requiredStarterCount,
};
