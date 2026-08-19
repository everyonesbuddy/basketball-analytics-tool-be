/**
 * Probe B: the leaguedefaults kona_player_info route, which is where ESPN
 * actually serves projections (appliedTotal) + real ADP for public use.
 * Run: node scripts/probe-fantasy-kona.js [season] [scoringId]
 *   scoringId: 1=standard, 3=PPR, 4=half-PPR
 */
const axios = require("axios");
const util = require("util");

const season = Number(process.argv[2]) || new Date().getFullYear();
const scoringId = Number(process.argv[3]) || 3;

const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/${scoringId}`;

const filter = {
  players: {
    filterStatsForTopScoringPeriodIds: {
      value: 5,
      additionalValue: [
        `00${season}`,
        `10${season}`,
        `11${season}`,
        `02${season}`,
      ],
    },
    limit: 8,
    sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "PPR" },
  },
};

function print(label, value) {
  console.log(`\n===== ${label} =====`);
  console.log(
    util.inspect(value, { depth: null, maxArrayLength: 60, colors: false }),
  );
}

(async () => {
  const { data } = await axios.get(url, {
    timeout: 20000,
    params: { view: "kona_player_info" },
    headers: {
      Accept: "application/json",
      "User-Agent": "basketball-analytics-tool-be/1.0",
      "X-Fantasy-Filter": JSON.stringify(filter),
      "X-Fantasy-Source": "kona",
      "X-Fantasy-Platform": "kona-PROD",
    },
  });

  console.log(`Fetched: ${url} (season ${season}, scoringId ${scoringId})`);
  print("TOP-LEVEL KEYS", Object.keys(data));

  const entries = data?.players || [];
  console.log(`players[] length: ${entries.length}`);
  if (!entries.length) return print("RAW", data);

  print("ENTRY WRAPPER KEYS", Object.keys(entries[0]));
  print("FIRST ENTRY (full raw, minus per-week stats)", {
    ...entries[0],
    player: {
      ...entries[0].player,
      stats: (entries[0].player?.stats || []).map((s) => ({
        id: s.id,
        externalId: s.externalId,
        seasonId: s.seasonId,
        scoringPeriodId: s.scoringPeriodId,
        statSourceId: s.statSourceId,
        statSplitTypeId: s.statSplitTypeId,
        appliedTotal: s.appliedTotal,
        appliedAverage: s.appliedAverage,
        statKeyCount: Object.keys(s.stats || {}).length,
        appliedStatsKeyCount: Object.keys(s.appliedStats || {}).length,
      })),
    },
  });

  print(
    "DRAFT BOARD FIELDS (top 8 by PPR draft rank)",
    entries.map((e) => {
      const p = e.player || {};
      const seasonProj = (p.stats || []).find(
        (s) =>
          s.statSourceId === 1 &&
          s.statSplitTypeId === 0 &&
          s.seasonId === season,
      );
      const seasonActual = (p.stats || []).find(
        (s) =>
          s.statSourceId === 0 &&
          s.statSplitTypeId === 0 &&
          s.seasonId === season,
      );
      return {
        id: p.id,
        fullName: p.fullName,
        defaultPositionId: p.defaultPositionId,
        proTeamId: p.proTeamId,
        injuryStatus: p.injuryStatus,
        averageDraftPosition: p.ownership?.averageDraftPosition,
        auctionValueAverage: p.ownership?.auctionValueAverage,
        percentOwned: p.ownership?.percentOwned,
        percentStarted: p.ownership?.percentStarted,
        pprDraftRank: p.draftRanksByRankType?.PPR?.rank,
        stdDraftRank: p.draftRanksByRankType?.STANDARD?.rank,
        projectedSeasonTotal: seasonProj?.appliedTotal,
        actualSeasonTotal: seasonActual?.appliedTotal,
        entryLevelDraftAuctionValue: e.draftAuctionValue,
        ratingsKeys: e.ratings ? Object.keys(e.ratings) : null,
      };
    }),
  );

  const sample = entries[0].player;
  const projEntry = (sample.stats || []).find(
    (s) => s.statSourceId === 1 && s.statSplitTypeId === 0,
  );
  print("SEASON PROJECTION ENTRY (raw stat-id map + appliedStats)", projEntry);
})().catch((error) => {
  console.error(
    "PROBE FAILED:",
    error.response?.status,
    error.response?.data || error.message,
  );
  process.exit(1);
});
