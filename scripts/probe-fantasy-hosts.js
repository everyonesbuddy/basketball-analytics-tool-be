/**
 * Compares host (fantasy.espn.com vs lm-api-reads) x path (/players vs
 * /segments/0/leaguedefaults/3) to isolate which one actually matters.
 */
const axios = require("axios");

const season = Number(process.argv[2]) || 2026;

const hosts = [
  "https://fantasy.espn.com",
  "https://lm-api-reads.fantasy.espn.com",
];
const paths = [
  `/apis/v3/games/ffl/seasons/${season}/players`,
  `/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3`,
];

const filter = {
  players: {
    limit: 3,
    sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "PPR" },
  },
};

async function probe(host, path) {
  const url = `${host}${path}`;
  const started = Date.now();
  try {
    const res = await axios.get(url, {
      timeout: 20000,
      params: { view: "kona_player_info" },
      headers: {
        Accept: "application/json",
        "User-Agent": "basketball-analytics-tool-be/1.0",
        "X-Fantasy-Filter": JSON.stringify(filter),
        "X-Fantasy-Source": "kona",
        "X-Fantasy-Platform": "kona-PROD",
      },
      maxRedirects: 0,
      validateStatus: () => true,
    });

    if (res.status >= 300 && res.status < 400) {
      return { url, status: res.status, redirectTo: res.headers.location };
    }
    if (res.status >= 400) {
      return {
        url,
        status: res.status,
        body: JSON.stringify(res.data).slice(0, 160),
      };
    }

    const data = res.data;
    const entries = Array.isArray(data) ? data : data?.players || [];
    const first = entries[0]?.player || entries[0] || {};
    const proj = (first.stats || []).find(
      (s) => s.statSourceId === 1 && s.statSplitTypeId === 0,
    );

    return {
      url,
      status: res.status,
      ms: Date.now() - started,
      shape: Array.isArray(data)
        ? "bare array"
        : `object{${Object.keys(data)}}`,
      wrapped: Boolean(entries[0]?.player),
      count: entries.length,
      limitHonored: entries.length === filter.players.limit,
      firstPlayer: first.fullName,
      adp: first.ownership?.averageDraftPosition,
      projectedTotal: proj?.appliedTotal ?? null,
    };
  } catch (error) {
    return { url, error: error.message };
  }
}

(async () => {
  for (const host of hosts) {
    for (const path of paths) {
      console.log(await probe(host, path));
      console.log("---");
    }
  }
})();
