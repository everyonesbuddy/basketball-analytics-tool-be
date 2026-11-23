/**
 * ESPN data for bet ideas: scoreboards (games, scores and lines) for the
 * NBA and NFL, this season's results for ratings, team names, and futures.
 * Cached so a page load doesn't hit ESPN dozens of times.
 */
const espn = require("../espn/espnClient");
const getJson = (...a) => espn.getJson(...a); // looked up each call, so tests can stand in for ESPN
const B = require("../../utils/os/bets");
const P = require("../../utils/os/props");

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

/** One day's (or one range's) scoreboard, parsed. */
async function scoreboard(sport, dates, ttlMs) {
  const { path } = B.SPORTS[sport];
  const json = await cached(`sb:${sport}:${dates}`, ttlMs, () => getJson(`${SITE}/${path}/scoreboard`, { dates, limit: 500 }));
  return (json?.events || []).map((ev) => B.parseEvent(ev, sport)).filter(Boolean);
}

/**
 * Parsed games between two dates (inclusive). Asks ESPN for a week at a
 * time; if a week's request fails, asks day by day so one bad day doesn't
 * lose the rest. Throws only when nothing at all came back.
 */
async function games(sport, from, to, ttlMs = 10 * 60 * 1000) {
  const out = [];
  const errors = [];
  for (let start = new Date(from); start <= to; start = new Date(start.getTime() + 7 * 86400000)) {
    const end = new Date(Math.min(start.getTime() + 6 * 86400000, to.getTime()));
    const range = ymd(start) === ymd(end) ? ymd(start) : `${ymd(start)}-${ymd(end)}`;
    try {
      out.push(...(await scoreboard(sport, range, ttlMs)));
    } catch (err) {
      for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
        try {
          out.push(...(await scoreboard(sport, ymd(d), ttlMs)));
        } catch (e) {
          errors.push(e.message);
        }
      }
    }
  }
  if (!out.length && errors.length) throw new Error(errors[0]);
  const seen = new Set();
  return out.filter((g) => !seen.has(g.id) && seen.add(g.id));
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

const DRAFTKINGS = 100; // ESPN's odds provider id for DraftKings

/** DraftKings' main prop lines for one game, from ESPN (every page). */
async function propLines(sport, eventId) {
  const [p1, p2] = B.SPORTS[sport].path.split("/");
  return cached(`props:${sport}:${eventId}`, 15 * 60 * 1000, async () => {
    const items = [];
    for (let page = 1; page <= 10; page++) {
      const json = await getJson(`${CORE}/${p1}/leagues/${p2}/events/${eventId}/competitions/${eventId}/odds/${DRAFTKINGS}/propBets`, { lang: "en", region: "us", limit: 1000, page });
      items.push(...(json?.items || []));
      if (page >= Number(json?.pageCount || 1)) break;
    }
    return P.parsePropBets(items, sport);
  });
}

/** One finished game's box score, parsed (kept a day; finished games don't change). */
async function boxScore(sport, eventId) {
  return cached(`box:${sport}:${eventId}`, 24 * 60 * 60 * 1000, async () => P.boxScore(await getJson(`${SITE}/${B.SPORTS[sport].path}/summary`, { event: eventId }), sport));
}

/** Run `fn` over `list`, `n` at a time, keeping what worked. */
async function pool(list, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, list.length) }, async () => {
      while (i < list.length) {
        const item = list[i++];
        try {
          out.push(await fn(item));
        } catch {
          // one missing box score just means one game fewer in a player's log
        }
      }
    }),
  );
  return out;
}

/**
 * Recent game logs for every player on these teams: each team's last
 * `perTeam` finished games' box scores (NBA 15, NFL 8).
 */
async function playerLogs(sport, teamIds, now = new Date()) {
  const perTeam = sport === "nfl" ? 8 : 15;
  const yesterday = new Date(now.getTime() - 86400000);
  const played = (await games(sport, B.seasonStart(sport, now), yesterday, 3 * 60 * 60 * 1000)).filter((g) => g.completed);
  const want = new Map();
  for (const id of teamIds) {
    played
      .filter((g) => g.home.id === id || g.away.id === id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, perTeam)
      .forEach((g) => want.set(g.id, g.date));
  }
  const boxes = await pool([...want], 8, async ([eventId, date]) => ({ eventId, date, players: await boxScore(sport, eventId) }));
  return P.logsFrom(boxes);
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

module.exports = { games, seasonRatings, upcoming, teams, futures, finalsFor, propLines, boxScore, playerLogs, _clearCache: () => cache.clear() };
