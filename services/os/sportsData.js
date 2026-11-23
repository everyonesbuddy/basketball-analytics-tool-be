/**
 * ESPN data for bet ideas: scoreboards (games, scores and lines) for the
 * NBA and NFL, this season's results for ratings, team names, and futures.
 * Cached so a page load doesn't hit ESPN dozens of times.
 */
const { getJson } = require("../espn/espnClient");
const B = require("../../utils/os/bets");

const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const CORE = "https://sports.core.api.espn.com/v2/sports";
const cache = new Map();

async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, until: Date.now() + ttlMs });
  return value;
}

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

/** Parsed games between two dates (inclusive), in 30-day chunks. */
async function games(sport, from, to, ttlMs = 10 * 60 * 1000) {
  const { path } = B.SPORTS[sport];
  const out = [];
  for (let start = new Date(from); start <= to; start = new Date(start.getTime() + 30 * 86400000)) {
    const end = new Date(Math.min(start.getTime() + 29 * 86400000, to.getTime()));
    const range = ymd(start) === ymd(end) ? ymd(start) : `${ymd(start)}-${ymd(end)}`;
    const json = await cached(`sb:${sport}:${range}`, ttlMs, () => getJson(`${SITE}/${path}/scoreboard`, { dates: range, limit: 1000 }));
    for (const ev of json?.events || []) {
      const g = B.parseEvent(ev, sport);
      if (g) out.push(g);
    }
  }
  return out;
}

/** This season's ratings (cached for 3 hours: results only change once a day). */
async function seasonRatings(sport, now = new Date()) {
  return cached(`ratings:${sport}:${ymd(now)}`, 3 * 60 * 60 * 1000, async () => {
    const yesterday = new Date(now.getTime() - 86400000);
    const played = await games(sport, B.seasonStart(sport, now), yesterday, 3 * 60 * 60 * 1000);
    return B.ratings(B.finals(played), { homeEdge: B.SPORTS[sport].homeEdge });
  });
}

/** Today and the next few days' games (NBA: 2 days; NFL: the week). */
async function upcoming(sport, now = new Date()) {
  const days = sport === "nfl" ? 7 : 2;
  return games(sport, now, new Date(now.getTime() + days * 86400000), 5 * 60 * 1000);
}

/** Team id → { abbr, name, logo }. */
async function teams(sport) {
  return cached(`teams:${sport}`, 24 * 60 * 60 * 1000, async () => {
    const json = await getJson(`${SITE}/${B.SPORTS[sport].path}/teams`);
    const list = json?.sports?.[0]?.leagues?.[0]?.teams || [];
    return Object.fromEntries(list.map(({ team: t }) => [String(t.id), { abbr: t.abbreviation, name: t.shortDisplayName || t.displayName, logo: t.logos?.[0]?.href || null }]));
  });
}

/** Futures markets for the current season (ESPN numbers NBA seasons by the year they end). */
async function futures(sport, now = new Date()) {
  const start = B.seasonStart(sport, now).getUTCFullYear();
  const season = sport === "nba" ? start + 1 : start;
  const { path } = B.SPORTS[sport];
  const [p1, p2] = path.split("/");
  return cached(`futures:${sport}:${season}`, 6 * 60 * 60 * 1000, async () => B.parseFutures(await getJson(`${CORE}/${p1}/leagues/${p2}/seasons/${season}/futures`, { limit: 50 })));
}

/** Final results for these games (by date), to settle bets. */
async function finalsFor(sport, dates) {
  const out = {};
  for (const d of [...new Set(dates)]) {
    const day = new Date(`${d}T12:00:00Z`);
    for (const g of await games(sport, day, day, 10 * 60 * 1000)) out[g.id] = g;
  }
  return out;
}

module.exports = { games, seasonRatings, upcoming, teams, futures, finalsFor };
