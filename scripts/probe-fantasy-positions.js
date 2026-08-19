/**
 * Probe C: which stat ids appear per defaultPositionId, so the reshape layer
 * can branch by position instead of assuming a flat stat shape.
 */
const axios = require("axios");
const util = require("util");

const season = Number(process.argv[2]) || 2026;

const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3`;

const filter = {
  players: {
    limit: 400,
    sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "PPR" },
  },
};

function print(label, value) {
  console.log(`\n===== ${label} =====`);
  console.log(
    util.inspect(value, { depth: null, maxArrayLength: 200, colors: false }),
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

  const entries = data?.players || [];
  console.log(`entries: ${entries.length}`);

  const byPos = new Map();
  const placeholderAdp = new Map();

  for (const entry of entries) {
    const p = entry.player || {};
    const pos = p.defaultPositionId;
    if (!byPos.has(pos)) {
      byPos.set(pos, {
        count: 0,
        statIds: new Set(),
        example: null,
        withProj: 0,
        eligibleSlots: new Set(),
      });
    }
    const bucket = byPos.get(pos);
    bucket.count += 1;
    (p.eligibleSlots || []).forEach((s) => bucket.eligibleSlots.add(s));

    const proj = (p.stats || []).find(
      (s) =>
        s.statSourceId === 1 &&
        s.statSplitTypeId === 0 &&
        s.seasonId === season,
    );
    if (Number.isFinite(proj?.appliedTotal)) bucket.withProj += 1;
    Object.keys(proj?.stats || {}).forEach((k) =>
      bucket.statIds.add(Number(k)),
    );
    if (!bucket.example && proj) {
      bucket.example = {
        name: p.fullName,
        appliedTotal: proj.appliedTotal,
        stats: proj.stats,
      };
    }

    const adp = p.ownership?.averageDraftPosition;
    placeholderAdp.set(adp, (placeholderAdp.get(adp) || 0) + 1);
  }

  print(
    "POSITION SUMMARY",
    [...byPos.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([pos, b]) => ({
        defaultPositionId: pos,
        players: b.count,
        withProjection: b.withProj,
        eligibleSlots: [...b.eligibleSlots].sort((x, y) => x - y),
        statIdCount: b.statIds.size,
        statIds: [...b.statIds].sort((x, y) => x - y),
        exampleName: b.example?.name,
      })),
  );

  for (const [pos, b] of [...byPos.entries()].sort((a, b) => a[0] - b[0])) {
    print(
      `EXAMPLE PROJECTION — defaultPositionId ${pos} (${b.example?.name})`,
      b.example,
    );
  }

  print(
    "ADP VALUE FREQUENCY (top repeated values -> placeholder detection)",
    [...placeholderAdp.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([adp, count]) => ({ adp, count })),
  );
})().catch((error) => {
  console.error(
    "PROBE FAILED:",
    error.response?.status,
    error.response?.data || error.message,
  );
  process.exit(1);
});
