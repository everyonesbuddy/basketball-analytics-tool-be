/**
 * Player props, as plain functions (tested without the network).
 *
 *  - lines: DraftKings' main line per player and stat, from ESPN's
 *    propBets feed (over and under come as an unlabeled pair of prices,
 *    so only the line is kept; with alternates, the most even pair wins)
 *  - logs: each player's stat in his team's recent games, from box scores
 *  - the model: a recent-weighted average and spread of those games, the
 *    chance he goes over, blended half and half with the market (50/50 at
 *    the main line), and how often he cleared it lately
 *  - settling: over/under from the final box score; no appearance is a push
 */
const { normCdf, invNorm, breakEven, toDecimal } = require("./bets");

const round = (n, d = 3) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

/** The stats we model, per sport, with their names. */
const STATS = {
  nba: { points: "points", rebounds: "rebounds", assists: "assists", threes: "threes", pra: "pts + reb + ast" },
  nfl: { passYds: "passing yards", rushYds: "rushing yards", recYds: "receiving yards", receptions: "receptions" },
};

/** Our stat for an ESPN prop type name ("Total Points", "Total Receiving Yards"…); null for everything else. */
function propStat(sport, typeName) {
  const t = String(typeName || "").toLowerCase();
  // Not modeled: milestone ladders, parts of a game, and stats too rare or lumpy for an average.
  if (/milestone|quarter|half|1st|2nd|3rd|4th|first|last|longest|double|steal|block|turnover|attempt|touchdown|completion|interception|kick/.test(t)) return null;
  if (sport === "nba") {
    if (/point/.test(t) && /rebound/.test(t) && /assist/.test(t)) return "pra";
    if (/\+|,|&| and /.test(t)) return null; // other combos
    if (/3-point|three/.test(t)) return "threes";
    if (/rebound/.test(t)) return "rebounds";
    if (/assist/.test(t)) return "assists";
    if (/point/.test(t)) return "points";
    return null;
  }
  if (sport === "nfl") {
    if (/\+|,|&| and /.test(t)) return null;
    if (/passing yard/.test(t)) return "passYds";
    if (/rushing yard/.test(t)) return "rushYds";
    if (/receiving yard/.test(t)) return "recYds";
    if (/reception/.test(t)) return "receptions";
  }
  return null;
}

/**
 * ESPN propBets items → [{ athleteId, stat, line }]: the main line per
 * player and stat. Main lines end in .5 (whole numbers are milestones or
 * in-game lines) and come as a pair; with alternates, the most even pair.
 */
function parsePropBets(items, sport) {
  const pairs = new Map();
  for (const it of items || []) {
    const stat = propStat(sport, it?.type?.name);
    const id = /\/athletes\/(\d+)/.exec(it?.athlete?.$ref || "")?.[1];
    const line = Number(it?.current?.target?.value);
    if (!stat || !id || !Number.isFinite(line) || Math.abs((line % 1) - 0.5) > 1e-9) continue;
    let dec = Number(it?.odds?.decimal?.value);
    if (!Number.isFinite(dec)) dec = toDecimal(Number(String(it?.odds?.american?.value ?? "").replace("+", ""))) ?? null;
    const key = `${id}:${stat}`;
    if (!pairs.has(key)) pairs.set(key, { athleteId: id, stat, lines: new Map() });
    const lines = pairs.get(key).lines;
    if (!lines.has(line)) lines.set(line, []);
    lines.get(line).push(dec);
  }
  const out = [];
  for (const { athleteId, stat, lines } of pairs.values()) {
    const two = [...lines].filter(([, d]) => d.length === 2);
    if (!two.length) continue;
    const gap = (d) => (d.every((x) => Number.isFinite(x)) ? Math.abs(d[0] - d[1]) : 9);
    two.sort((a, b) => gap(a[1]) - gap(b[1]) || a[0] - b[0]);
    out.push({ athleteId, stat, line: two[0][0] });
  }
  return out;
}

const statNum = (v) => {
  const n = parseFloat(String(v ?? "").split("-")[0]);
  return Number.isFinite(n) ? n : null;
};

/**
 * One game's box score (ESPN summary) → players who played:
 * [{ athleteId, name, teamId, stats: { points, rebounds… } }].
 */
function boxScore(summary, sport) {
  const out = new Map();
  for (const team of summary?.boxscore?.players || []) {
    const teamId = String(team?.team?.id || "");
    for (const group of team?.statistics || []) {
      const keys = group?.keys || [];
      const at = (k) => keys.indexOf(k);
      for (const row of group?.athletes || []) {
        const id = String(row?.athlete?.id || "");
        if (!id || row.didNotPlay || !Array.isArray(row.stats) || !row.stats.length) continue;
        const v = (k) => (at(k) >= 0 ? statNum(row.stats[at(k)]) : null);
        const p = out.get(id) || { athleteId: id, name: row.athlete.displayName || row.athlete.shortName || "", teamId, stats: {} };
        if (sport === "nba") {
          const min = v("minutes");
          if (min === 0) continue;
          const s = { points: v("points"), rebounds: v("rebounds"), assists: v("assists"), threes: v("threePointFieldGoalsMade-threePointFieldGoalsAttempted") };
          if (s.points !== null && s.rebounds !== null && s.assists !== null) s.pra = s.points + s.rebounds + s.assists;
          for (const [k, x] of Object.entries(s)) if (x !== null && x !== undefined) p.stats[k] = x;
        } else {
          const name = String(group?.name || "").toLowerCase();
          if (name === "passing" && v("passingYards") !== null) p.stats.passYds = v("passingYards");
          if (name === "rushing" && v("rushingYards") !== null) p.stats.rushYds = v("rushingYards");
          if (name === "receiving") {
            if (v("receivingYards") !== null) p.stats.recYds = v("receivingYards");
            if (v("receptions") !== null) p.stats.receptions = v("receptions");
          }
        }
        out.set(id, p);
      }
    }
  }
  // NFL: a player listed only in one group still played; fill the stats he had none of with 0.
  if (sport === "nfl") for (const p of out.values()) for (const k of ["rushYds", "recYds", "receptions"]) if (p.stats[k] === undefined && (p.stats.rushYds !== undefined || p.stats.recYds !== undefined)) p.stats[k] = 0;
  return [...out.values()];
}

/**
 * Players' recent values per stat from box scores [{ eventId, date, players }]:
 * athleteId → { name, teamId, games: [{ eventId, date, stats }] } newest first.
 */
function logsFrom(boxes) {
  const logs = new Map();
  for (const b of [...boxes].sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
    for (const p of b.players) {
      if (!logs.has(p.athleteId)) logs.set(p.athleteId, { name: p.name, teamId: p.teamId, games: [] });
      logs.get(p.athleteId).games.push({ eventId: b.eventId, date: b.date, stats: p.stats });
    }
  }
  return logs;
}

/**
 * What a player's recent games say about one stat and line: projection
 * (half the last 5, half the last 15), the spread of his games, the chance
 * of going over, and how often he cleared the line in his last 10.
 */
function propModel(values, line) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 5) return null;
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const last15 = v.slice(0, 15);
  const mean = 0.5 * avg(v.slice(0, 5)) + 0.5 * avg(last15);
  const m15 = avg(last15);
  const sd0 = Math.sqrt(last15.reduce((s, x) => s + (x - m15) ** 2, 0) / Math.max(1, last15.length - 1));
  // Floors: count stats vary at least like a Poisson; nothing is perfectly steady.
  const sd = Math.max(sd0, Math.sqrt(Math.max(mean, 0.5)), 0.2 * mean, 0.8);
  const last10 = v.slice(0, 10);
  return {
    avg5: round(avg(v.slice(0, 5)), 1),
    avg15: round(m15, 1),
    mean: round(mean, 1),
    sd: round(sd, 2),
    pOver: round(1 - normCdf((line - mean) / sd)),
    games: v.length,
    over10: last10.filter((x) => x > line).length,
    of10: last10.length,
    last5: v.slice(0, 5),
  };
}

/**
 * Prop legs for one game: [{ athleteId, stat, line }] lines + player logs →
 * over and under legs with our chance (model blended with the market's 50%),
 * edge against -110 and the player's recent record against the line.
 */
function analyzeProps(game, lines, logs, { blend = 0.5, odds = -110 } = {}) {
  const legs = [];
  const teamIds = new Set([game.home.id, game.away.id]);
  // The team's most recent game, to spot a player who sat it.
  const lastGame = {};
  for (const [, log] of logs) {
    const g = log.games[0];
    if (g && teamIds.has(log.teamId) && (!lastGame[log.teamId] || g.date > lastGame[log.teamId])) lastGame[log.teamId] = g.date;
  }
  for (const { athleteId, stat, line } of lines) {
    const log = logs.get(athleteId);
    if (!log) continue;
    const m = propModel(log.games.map((g) => g.stats[stat]), line);
    if (!m) continue;
    const name = STATS[game.sport][stat];
    const team = log.teamId === game.home.id ? game.home.abbr : log.teamId === game.away.id ? game.away.abbr : "";
    const missedLast = lastGame[log.teamId] && log.games[0].date < lastGame[log.teamId];
    const be = breakEven(odds);
    for (const side of ["over", "under"]) {
      const model = side === "over" ? m.pOver : 1 - m.pOver;
      const prob = blend * model + (1 - blend) * 0.5;
      const hits = side === "over" ? m.over10 : m.of10 - m.over10;
      legs.push({
        eventId: game.id,
        sport: game.sport,
        date: game.date,
        matchup: `${game.away.abbr} @ ${game.home.abbr}`,
        market: "prop",
        side,
        line,
        odds,
        stat,
        athleteId,
        player: log.name,
        team,
        label: `${log.name} ${side === "over" ? "over" : "under"} ${line} ${name}`,
        modelProb: round(model),
        marketProb: 0.5,
        prob: round(prob),
        edge: round(prob - be),
        ev: round(prob * toDecimal(odds) - 1),
        sd: m.sd,
        projection: m.mean,
        recent: { hits, of: m.of10, last5: m.last5, games: m.games },
        warning: missedLast ? `${log.name} sat his team's last game: check he's playing.` : null,
        explain: {
          ours: m.mean,
          book: line,
          middle: round(line + m.sd * invNorm(blend * m.pOver + (1 - blend) * 0.5), 1),
          how: [
            `Last 5 games he averaged ${m.avg5}; over his last ${Math.min(15, m.games)}, ${m.avg15}. Half of each → our line ${m.mean} ${name}.`,
            `His games swing about ±${m.sd} around that, so ${line} gives ${Math.round(m.pOver * 100)}% for the over.`,
            `He went over ${line} in ${m.over10} of his last ${m.of10}.`,
          ],
          why: [
            Math.abs(m.mean - line) < 1
              ? `DraftKings' ${line} is right on his recent average: no real disagreement.`
              : `DraftKings has ${line}; his recent games say ${m.mean} (${m.mean > line ? "higher" : "lower"} by ${round(Math.abs(m.mean - line), 1)}).`,
            `Books set props from the matchup, his minutes, injuries around him and where the money goes. We only see his recent box scores, so we blend half and half with the line.`,
          ],
        },
      });
    }
  }
  return legs;
}

/** The props worth a look: one side per player and stat, enough edge, and a recent record that agrees. */
function pickProps(legs, { minEdge = 0.03, max = 24 } = {}) {
  const best = new Map();
  for (const l of legs) {
    if (l.edge < minEdge || l.recent.hits < Math.ceil(l.recent.of / 2)) continue;
    const k = `${l.athleteId}:${l.stat}`;
    if (!best.has(k) || best.get(k).edge < l.edge) best.set(k, l);
  }
  const conf = (l) => (l.warning || l.recent.games < 8 ? "low" : l.edge >= 0.07 ? "high" : l.edge >= 0.045 ? "medium" : "low");
  return [...best.values()]
    .map((l) => ({ ...l, confidence: conf(l) }))
    .sort((a, b) => b.edge - a.edge)
    .slice(0, max);
}

/** A prop leg's result from the game's box score: won, lost, push (didn't play) or null. */
function settleProp(leg, players) {
  if (!players) return null;
  const p = players.find((x) => x.athleteId === String(leg.athleteId));
  const v = p?.stats?.[leg.stat];
  if (v === undefined || v === null) return "push";
  const d = v - leg.line;
  const r = leg.side === "over" ? d : -d;
  return r > 0 ? "won" : r < 0 ? "lost" : "push";
}

module.exports = { STATS, propStat, parsePropBets, boxScore, logsFrom, propModel, analyzeProps, pickProps, settleProp };
