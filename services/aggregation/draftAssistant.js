const crypto = require("crypto");
const cache = require("../../cache/memoryCache");
const {
  fetchFantasyPlayers,
  buildPlayerFilter,
  describeScoring,
} = require("../espn/fantasy.service");
const { getNflTeamsById } = require("../espn/nfl/teams.service");
const { getFantasySeasonState } = require("../espn/fantasySeason.service");
const {
  normalizePlayerList,
  FLEX_POSITIONS,
  finiteNumber,
  roundNullable,
} = require("../../utils/reshapeFantasy");
const {
  attachSleeperScores,
  attachTiers,
  hasProjection,
} = require("../analytics/fantasyValue");
const {
  attachVorp,
  normalizeLeagueSettings,
} = require("../analytics/fantasyVorp");

const FANTASY_POOL_TTL_MS = 15 * 60 * 1000;
const FANTASY_DRAFT_BOARD_TTL_MS = 5 * 60 * 1000;
const FANTASY_SLEEPERS_TTL_MS = 10 * 60 * 1000;
const FANTASY_POOL_LIMIT = 1000;
const SLEEPER_MIN_PROJECTION = 1;

async function resolveSeason(season, forceRefresh = false) {
  const parsed = finiteNumber(season);
  if (Number.isInteger(parsed) && parsed > 2000) {
    return parsed;
  }

  const state = await getFantasySeasonState({ forceRefresh });
  return state.season;
}

function buildPoolCacheKey(season, scoringId) {
  return `fantasy-players:${season}:${scoringId}`;
}

function buildDraftBoardCacheKey(position, scoringId, rosterHash, leagueHash) {
  return `fantasy-draft-board:${position || "any"}:${scoringId}:${rosterHash}:${leagueHash}`;
}

function buildSleepersCacheKey(scoringId) {
  return `fantasy-sleepers:${scoringId}`;
}

function hashRoster(rosterSoFar = []) {
  const ids = [...new Set(rosterSoFar.map((id) => Number(id)))]
    .filter((id) => Number.isFinite(id))
    .sort((a, b) => a - b);

  if (!ids.length) {
    return "empty";
  }

  return crypto
    .createHash("sha1")
    .update(ids.join(","))
    .digest("hex")
    .slice(0, 12);
}

async function getPlayerPool(options = {}) {
  const { season, scoringId, forceRefresh = false } = options;
  const resolvedSeason = await resolveSeason(season, forceRefresh);
  const cacheKey = buildPoolCacheKey(resolvedSeason, scoringId);

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, _cache: "HIT" };
    }
  }

  const filter = buildPlayerFilter({ limit: FANTASY_POOL_LIMIT });
  const payload = await fetchFantasyPlayers(resolvedSeason, scoringId, filter);

  let teamsById = null;
  try {
    teamsById = await getNflTeamsById({ forceRefresh });
  } catch (_error) {
    // Team enrichment is cosmetic; the pool is still usable without it.
    teamsById = null;
  }

  const players = normalizePlayerList(payload.players, {
    seasonId: resolvedSeason,
    teamsById,
  });

  const withAdp = players.filter((player) => !player.adpIsPlaceholder).length;

  const result = {
    season: resolvedSeason,
    scoringId,
    scoring: describeScoring(scoringId),
    count: players.length,
    playersWithUsableAdp: withAdp,
    playersWithProjection: players.filter(hasProjection).length,
    players,
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, result, FANTASY_POOL_TTL_MS);

  return { ...result, _cache: "MISS" };
}

function matchesPosition(player, position) {
  if (!position) {
    return true;
  }

  if (position === "FLEX") {
    return FLEX_POSITIONS.has(player.position);
  }

  return player.position === position;
}

function buildBoardInsights(candidates = [], tiers = []) {
  if (!candidates.length) {
    return "No available players matched the requested position and roster filters.";
  }

  const top = candidates[0];
  const topTier = tiers.find((tier) => tier.tier === top.tier);
  const tierRunway = topTier ? topTier.count : null;
  const undervalued = candidates.filter(
    (player) => player.status === "undervalued",
  ).length;

  const parts = [
    `${top.name} leads the board at ${roundNullable(top.vorp, 1)} value over replacement.`,
  ];

  if (Number.isFinite(tierRunway)) {
    parts.push(
      tierRunway > 1
        ? `Tier ${top.tier} still has ${tierRunway} players, so the drop-off is not immediate.`
        : `Tier ${top.tier} has only ${tierRunway} player left, so waiting risks a tier drop-off.`,
    );
  }

  if (undervalued > 0) {
    parts.push(
      `${undervalued} candidate${undervalued === 1 ? " is" : "s are"} going later than projection implies.`,
    );
  }

  return parts.join(" ");
}

async function getDraftBoard(options = {}) {
  const {
    position = null,
    rosterSoFar = [],
    leagueSettings = {},
    scoringId,
    season,
    forceRefresh = false,
  } = options;

  const rosterHash = hashRoster(rosterSoFar);
  const league = normalizeLeagueSettings(leagueSettings);
  const leagueHash = crypto
    .createHash("sha1")
    .update(JSON.stringify(league))
    .digest("hex")
    .slice(0, 12);
  const cacheKey = buildDraftBoardCacheKey(
    position,
    scoringId,
    rosterHash,
    leagueHash,
  );

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, _cache: "HIT" };
    }
  }

  const pool = await getPlayerPool({ season, scoringId, forceRefresh });

  const draftedIds = new Set(
    rosterSoFar.map((id) => Number(id)).filter((id) => Number.isFinite(id)),
  );

  const available = pool.players.filter(
    (player) => !draftedIds.has(player.id) && matchesPosition(player, position),
  );

  // Score and tier against the available pool so both reflect who is actually left.
  const { players: scored } = attachSleeperScores(available);
  const { players: tiered, tiers, baselines } = attachVorp(scored, league);

  const candidates = tiered
    .filter(hasProjection)
    .sort((a, b) => {
      const tierA = a.tier ?? Number.MAX_SAFE_INTEGER;
      const tierB = b.tier ?? Number.MAX_SAFE_INTEGER;
      if (tierA !== tierB) {
        return tierA - tierB;
      }
      return finiteNumber(b.vorp) - finiteNumber(a.vorp);
    })
    .map((player) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      team: player.team,
      injuryStatus: player.injuryStatus,
      tier: player.tier,
      adp: player.adp,
      adpIsPlaceholder: player.adpIsPlaceholder,
      ownershipPct: player.ownershipPct,
      auctionValue: player.auctionValue,
      projectedTotal: player.projectedTotal,
      projectedAverage: player.projectedAverage,
      replacementBaseline: player.replacementBaseline,
      vorp: player.vorp,
      vorpRank: player.vorpRank,
      draftRank: player.draftRank,
      projectedRank: player.projectedRank,
      projectedPositionRank: player.projectedPositionRank,
      adpPositionRank: player.adpPositionRank,
      adpDelta: player.adpDelta,
      sleeperScore: player.sleeperScore,
      status: player.status,
      keyStats: player.keyStats,
    }));

  const payload = {
    season: pool.season,
    scoringId,
    scoring: pool.scoring,
    leagueSettings: league,
    position: position || "ALL",
    rosterSize: draftedIds.size,
    excludedFromRoster: pool.players.filter((player) =>
      draftedIds.has(player.id),
    ).length,
    poolSize: pool.count,
    availableCount: candidates.length,
    tierMetric: "vorp",
    replacementBaselines: baselines,
    tiers,
    candidates,
    decisionInsights: buildBoardInsights(candidates, tiers),
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, payload, FANTASY_DRAFT_BOARD_TTL_MS);

  return { ...payload, _cache: "MISS" };
}

function buildSleeperInsights(sleepers = [], excludedCount = 0) {
  if (!sleepers.length) {
    return excludedCount > 0
      ? `No usable ADP signal: ${excludedCount} players carried placeholder ADP values.`
      : "No players currently project meaningfully ahead of their draft cost.";
  }

  const top = sleepers[0];

  return `${top.name} is the largest gap: drafted as ${top.position}${top.adpPositionRank} (pick ${top.adp}) while projecting as ${top.position}${top.projectedPositionRank} — ${top.adpDelta} positional spots of surplus.`;
}

async function getSleepers(options = {}) {
  const { scoringId, season, forceRefresh = false, limit = 50 } = options;
  const cacheKey = buildSleepersCacheKey(scoringId);

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, _cache: "HIT" };
    }
  }

  const pool = await getPlayerPool({ season, scoringId, forceRefresh });
  const { players: scored, distributionByPosition } = attachSleeperScores(
    pool.players,
  );

  const eligible = scored.filter(
    (player) =>
      !player.adpIsPlaceholder &&
      finiteNumber(player.sleeperScore) !== null &&
      finiteNumber(player.projectedTotal) >= SLEEPER_MIN_PROJECTION,
  );

  const sleepers = eligible
    .sort((a, b) => finiteNumber(b.sleeperScore) - finiteNumber(a.sleeperScore))
    .slice(0, limit)
    .map((player) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      team: player.team,
      adp: player.adp,
      ownershipPct: player.ownershipPct,
      projectedTotal: player.projectedTotal,
      projectedRank: player.projectedRank,
      projectedPositionRank: player.projectedPositionRank,
      adpPositionRank: player.adpPositionRank,
      adpDelta: player.adpDelta,
      sleeperScore: player.sleeperScore,
      peerSampleSize: player.peerSampleSize,
      status: player.status,
    }));

  const excludedCount = scored.length - eligible.length;

  const payload = {
    season: pool.season,
    scoringId,
    scoring: pool.scoring,
    poolSize: pool.count,
    evaluatedCount: eligible.length,
    excludedCount,
    excludedForPlaceholderAdp: scored.filter(
      (player) => player.adpIsPlaceholder,
    ).length,
    peerDistributions: [...distributionByPosition.values()].map((entry) => ({
      position: entry.position,
      meanAdpDelta: roundNullable(entry.mean, 2),
      stdDevAdpDelta: roundNullable(entry.stdDev, 2),
      sampleSize: entry.sampleSize,
    })),
    sleepers,
    decisionInsights: buildSleeperInsights(sleepers, excludedCount),
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, payload, FANTASY_SLEEPERS_TTL_MS);

  return { ...payload, _cache: "MISS" };
}

module.exports = {
  FANTASY_POOL_TTL_MS,
  FANTASY_DRAFT_BOARD_TTL_MS,
  FANTASY_SLEEPERS_TTL_MS,
  resolveSeason,
  getPlayerPool,
  getDraftBoard,
  getSleepers,
};
