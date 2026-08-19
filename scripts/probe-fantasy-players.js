/**
 * Throwaway probe: prints the real shape of the ESPN fantasy football
 * kona_player_info payload so parsing logic is written against real fields.
 * Run: node scripts/probe-fantasy-players.js [season]
 */
const axios = require("axios");
const util = require("util");

const season = Number(process.argv[2]) || new Date().getFullYear();

const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players`;
const legacyUrl = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players`;

const filter = {
  players: {
    limit: 5,
    sortPercOwned: { sortAsc: false, sortPriority: 1 },
  },
};

async function fetchPlayers(target) {
  const response = await axios.get(target, {
    timeout: 20000,
    params: { view: "kona_player_info", scoringPeriodId: 0 },
    headers: {
      Accept: "application/json",
      "User-Agent": "basketball-analytics-tool-be/1.0",
      "X-Fantasy-Filter": JSON.stringify(filter),
      "X-Fantasy-Source": "kona",
      "X-Fantasy-Platform": "kona-PROD",
    },
  });
  return response.data;
}

function describe(value, depth = 0, maxDepth = 4) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (depth >= maxDepth) return `[${typeof value[0]} x${value.length}]`;
    return {
      __arrayLength: value.length,
      __sample: describe(value[0], depth + 1, maxDepth),
    };
  }
  if (typeof value === "object") {
    if (depth >= maxDepth) return "{...}";
    const out = {};
    for (const key of Object.keys(value))
      out[key] = describe(value[key], depth + 1, maxDepth);
    return out;
  }
  return typeof value;
}

function print(label, value) {
  console.log(`\n===== ${label} =====`);
  console.log(
    util.inspect(value, { depth: null, colors: false, maxArrayLength: 40 }),
  );
}

(async () => {
  let data;
  try {
    data = await fetchPlayers(url);
    console.log(`Fetched from: ${url} (season ${season})`);
  } catch (error) {
    console.log(
      `Primary host failed: ${error.response?.status || error.message}. Trying legacy host...`,
    );
    data = await fetchPlayers(legacyUrl);
    console.log(`Fetched from: ${legacyUrl} (season ${season})`);
  }

  const players = Array.isArray(data) ? data : data?.players || [];
  console.log(`Top-level type: ${Array.isArray(data) ? "array" : typeof data}`);
  console.log(`Player entries returned: ${players.length}`);

  if (!players.length) {
    print("RAW (no players)", data);
    return;
  }

  const unwrap = (entry) => entry?.player || entry;
  const ranked = [...players].sort(
    (a, b) =>
      (unwrap(b)?.ownership?.percentOwned || 0) -
      (unwrap(a)?.ownership?.percentOwned || 0),
  );

  print(
    "ENTRY WRAPPING",
    players[0]?.player ? "wrapped: { player: {...} }" : "flat player object",
  );
  print("SHAPE OF TOP-OWNED ENTRY", describe(ranked[0]));
  print("TOP-OWNED ENTRY (full raw)", ranked[0]);
  print(
    "TOP 10 BY percentOwned",
    ranked.slice(0, 10).map((e) => {
      const x = unwrap(e);
      return {
        id: x.id,
        fullName: x.fullName,
        defaultPositionId: x.defaultPositionId,
        proTeamId: x.proTeamId,
        percentOwned: x.ownership?.percentOwned,
        percentStarted: x.ownership?.percentStarted,
        averageDraftPosition: x.ownership?.averageDraftPosition,
        auctionValueAverage: x.ownership?.auctionValueAverage,
        pprRank: x.draftRanksByRankType?.PPR?.rank,
        projectedTotals: (x.stats || [])
          .filter((s) => s.statSourceId === 1)
          .map((s) => ({
            scoringPeriodId: s.scoringPeriodId,
            statSplitTypeId: s.statSplitTypeId,
            appliedTotal: s.appliedTotal,
            appliedAverage: s.appliedAverage,
            statKeyCount: Object.keys(s.stats || {}).length,
          })),
      };
    }),
  );
  print(
    "RAW STAT KEYS ON TOP PLAYER (season projection entry)",
    (unwrap(ranked[0])?.stats || []).map((s) => ({
      id: s.id,
      statSourceId: s.statSourceId,
      statSplitTypeId: s.statSplitTypeId,
      scoringPeriodId: s.scoringPeriodId,
      appliedTotal: s.appliedTotal,
      appliedAverage: s.appliedAverage,
      stats: s.stats,
      appliedStats: s.appliedStats,
    })),
  );

  const p = unwrap(ranked[0]);
  print("CANDIDATE FIELDS", {
    id: p?.id,
    fullName: p?.fullName,
    defaultPositionId: p?.defaultPositionId,
    eligibleSlots: p?.eligibleSlots,
    proTeamId: p?.proTeamId,
    injuryStatus: p?.injuryStatus,
    ownership: p?.ownership,
    draftRanksAuction: p?.draftRanksByRankType,
    statEntryKeys: (p?.stats || []).map((s) => ({
      id: s.id,
      statSourceId: s.statSourceId,
      statSplitTypeId: s.statSplitTypeId,
      seasonId: s.seasonId,
      scoringPeriodId: s.scoringPeriodId,
      appliedTotal: s.appliedTotal,
      externalId: s.externalId,
    })),
  });
})().catch((error) => {
  console.error(
    "PROBE FAILED:",
    error.response?.status,
    error.response?.data || error.message,
  );
  process.exit(1);
});
