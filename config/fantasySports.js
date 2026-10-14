// Per-sport fantasy settings. Every value here was verified against live ESPN kona payloads.
const NFL = {
  key: "nfl",
  gameKey: "ffl",
  cachePrefix: "fantasy",
  positions: ["QB", "RB", "WR", "TE", "K", "DST"],
  positionById: { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST" },
  // Flex slots are listed most-specific first; replacement and lineup fill follow this order.
  flexSlots: { FLEX: ["RB", "WR", "TE"] },
  defaultLeague: {
    teamCount: 12,
    starters: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1, FLEX: 1 },
  },
  scoring: {
    ids: { STANDARD: 1, PPR: 3, HALF_PPR: 4 },
    labels: { 1: "standard", 3: "ppr", 4: "half_ppr" },
    defaultId: 3,
  },
  sortValue: "PPR",
  // ESPN pads ADP to ~170 (with jitter) for players outside the draftable pool.
  adpPlaceholderFloor: 169.5,
  // statSplitTypeId 1 = one entry per NFL week.
  gameSplitTypeId: 1,
  gamesPlayedStatId: 210,
  requirePositiveProjection: false,
  perGameStats: null,
  // VORP magnitude differs by sport, so verdict cutoffs are expressed in each sport's own units.
  tradeVerdictThresholds: { balanced: 3, slightEdge: 12 },
  statIds: {
    passing: {
      passAttempts: 0,
      completions: 1,
      incompletions: 2,
      passingYards: 3,
      passingTouchdowns: 4,
      interceptions: 20,
    },
    rushing: { rushAttempts: 23, rushingYards: 24, rushingTouchdowns: 25 },
    receiving: {
      receptions: 53,
      receivingYards: 42,
      receivingTouchdowns: 43,
      targets: 58,
    },
  },
  statGroupsByPosition: {
    QB: ["passing", "rushing"],
    RB: ["rushing", "receiving"],
    WR: ["receiving", "rushing"],
    TE: ["receiving"],
    K: [],
    DST: [],
  },
};

const NBA_POSITIONS = ["PG", "SG", "SF", "PF", "C"];

const NBA = {
  key: "nba",
  gameKey: "fba",
  cachePrefix: "fantasy-nba",
  positions: NBA_POSITIONS,
  positionById: { 1: "PG", 2: "SG", 3: "SF", 4: "PF", 5: "C" },
  flexSlots: {
    G: ["PG", "SG"],
    F: ["SF", "PF"],
    UTIL: NBA_POSITIONS,
  },
  defaultLeague: {
    teamCount: 12,
    starters: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 3 },
  },
  // Only scoringId 2 returns a points total; 1 and 3 are category formats with no appliedTotal.
  scoring: {
    ids: { POINTS: 2 },
    labels: { 2: "points" },
    defaultId: 2,
  },
  sortValue: "STANDARD",
  // Real ADP thins out near 131; beyond that ESPN packs filler values into 131-141.
  adpPlaceholderFloor: 131,
  // statSplitTypeId 5 = one entry per game; 1-3 are rolling last-7/15/30 windows.
  gameSplitTypeId: 5,
  gamesPlayedStatId: 42,
  // Unprojected NBA players come back as appliedTotal 0 rather than missing.
  requirePositiveProjection: true,
  tradeVerdictThresholds: { balanced: 40, slightEdge: 170 },
  perGameStats: [
    "points",
    "rebounds",
    "assists",
    "steals",
    "blocks",
    "turnovers",
    "threePointersMade",
    "minutes",
  ],
  statIds: {
    counting: {
      points: 0,
      rebounds: 6,
      assists: 3,
      steals: 2,
      blocks: 1,
      turnovers: 11,
      threePointersMade: 17,
    },
    shooting: {
      fieldGoalsMade: 13,
      fieldGoalsAttempted: 14,
      freeThrowsMade: 15,
      freeThrowsAttempted: 16,
    },
    volume: { minutes: 40 },
  },
  statGroupsByPosition: {
    PG: ["counting", "shooting", "volume"],
    SG: ["counting", "shooting", "volume"],
    SF: ["counting", "shooting", "volume"],
    PF: ["counting", "shooting", "volume"],
    C: ["counting", "shooting", "volume"],
  },
};

const SPORTS = { nfl: NFL, nba: NBA };

function getSport(key = "nfl") {
  const sport = SPORTS[String(key).toLowerCase()];
  if (!sport) {
    throw new Error(`Unknown fantasy sport: ${key}`);
  }
  return sport;
}

function slotNames(sport) {
  return [...sport.positions, ...Object.keys(sport.flexSlots)];
}

module.exports = { NFL, NBA, SPORTS, getSport, slotNames };
