const crypto = require("crypto");
const cache = require("../../cache/memoryCache");
const { getPlayerPool } = require("./draftAssistant");
const {
  attachVorp,
  normalizeLeagueSettings,
} = require("../analytics/fantasyVorp");
const { finiteNumber, roundNullable } = require("../../utils/reshapeFantasy");

const TRADE_ANALYZER_TTL_MS = 5 * 60 * 1000;

function compactTradePlayer(player = {}) {
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    team: player.team,
    projectedTotal: player.projectedTotal,
    replacementBaseline: player.replacementBaseline,
    vorp: player.vorp,
    vorpRank: player.vorpRank,
    tier: player.tier,
  };
}

function summarizeSide(players = []) {
  return {
    playerCount: players.length,
    totalVorp: roundNullable(
      players.reduce(
        (sum, player) => sum + (finiteNumber(player.vorp) || 0),
        0,
      ),
      2,
    ),
    byPosition: players.reduce((summary, player) => {
      summary[player.position] = roundNullable(
        (summary[player.position] || 0) + (finiteNumber(player.vorp) || 0),
        2,
      );
      return summary;
    }, {}),
    players: players.map(compactTradePlayer),
  };
}

function classifyTrade(netVorp) {
  const delta = Math.abs(netVorp);
  if (delta <= 3) return "balanced";
  if (delta <= 12) return "slight_edge";
  return "clear_edge";
}

async function analyzeTrade(options = {}) {
  const {
    sideAIds = [],
    sideBIds = [],
    scoringId,
    season,
    leagueSettings = {},
    forceRefresh = false,
  } = options;
  const league = normalizeLeagueSettings(leagueSettings);
  const keySource = JSON.stringify({
    sideAIds: [...sideAIds].sort(),
    sideBIds: [...sideBIds].sort(),
    scoringId,
    season,
    league,
  });
  const cacheKey = `fantasy-trade:${crypto.createHash("sha1").update(keySource).digest("hex").slice(0, 16)}`;

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, _cache: "HIT" };
  }

  const pool = await getPlayerPool({ season, scoringId, forceRefresh });
  const { players, tiers, baselines } = attachVorp(pool.players, league);
  const byId = new Map(players.map((player) => [player.id, player]));
  const sideA = sideAIds.map((id) => byId.get(id)).filter(Boolean);
  const sideB = sideBIds.map((id) => byId.get(id)).filter(Boolean);
  const missingPlayerIds = [...sideAIds, ...sideBIds].filter(
    (id) => !byId.has(id),
  );
  const summaryA = summarizeSide(sideA);
  const summaryB = summarizeSide(sideB);
  const netVorpToA = roundNullable(summaryB.totalVorp - summaryA.totalVorp, 2);

  const result = {
    season: pool.season,
    scoringId,
    scoring: pool.scoring,
    leagueSettings: league,
    replacementBaselines: baselines,
    tiers,
    sideA: summaryA,
    sideB: summaryB,
    missingPlayerIds,
    netVorpToA,
    verdict: classifyTrade(netVorpToA || 0),
    decisionInsights:
      netVorpToA === 0
        ? "Both sides return the same projected value over replacement."
        : netVorpToA > 0
          ? `Side A gains ${netVorpToA} projected VORP from this trade.`
          : `Side B gains ${Math.abs(netVorpToA)} projected VORP from this trade.`,
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, result, TRADE_ANALYZER_TTL_MS);
  return { ...result, _cache: "MISS" };
}

module.exports = { analyzeTrade };
