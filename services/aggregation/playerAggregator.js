const cache = require("../../cache/memoryCache");
const { getAthleteBundle } = require("../espn/athletes.service");
const { getAthleteOptions } = require("../espn/athletes.service");
const { getAthleteOverview } = require("../espn/athletes.service");
const { getCoreAthleteProfile } = require("../espn/athletes.service");
const { getAllTeams } = require("../espn/teams.service");
const { normalizePlayerBundle } = require("../../utils/reshape");
const { getPlayerImpact } = require("./playerImpactAggregator");

const PLAYER_CACHE_TTL_MS = 3 * 60 * 1000;
const PLAYER_COMPS_CACHE_TTL_MS = 10 * 60 * 1000;
const PLAYER_TRAJECTORY_CACHE_TTL_MS = 5 * 60 * 1000;
const COMPS_STABILITY_GAME_TARGET = 25;
const COMPS_STABILITY_MINUTES_TARGET = 28;

function hasUsableIdentity(identity = {}) {
  return [
    identity.id,
    identity.displayName,
    identity.shortName,
    identity.headshot,
  ].some((value) => value !== null && value !== undefined && value !== "");
}

function buildPlayerCacheKey(athleteId) {
  return `player:${athleteId}`;
}

function buildPlayerCompsCacheKey(athleteId, limit, sampleSize, split) {
  return `player-comps:v6:${athleteId}:${limit}:${sampleSize}:${split}`;
}

function buildPlayerTrajectoryCacheKey(athleteId, games, window, seasonType) {
  return `player-trajectory:${athleteId}:${games}:${window}:${seasonType}`;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampNumber(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value)));
}

function parseMadeAttempted(value) {
  const text = String(value || "").trim();
  const [made, attempted] = text.split("-").map((part) => Number(part));

  if (!Number.isFinite(made) || !Number.isFinite(attempted)) {
    return { made: null, attempted: null };
  }

  return { made, attempted };
}

function average(values = []) {
  const valid = values.filter((value) => Number.isFinite(value));

  if (!valid.length) {
    return null;
  }

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function stdDev(values = []) {
  const mean = average(values);

  if (!Number.isFinite(mean)) {
    return null;
  }

  const variance = average(values.map((value) => (value - mean) ** 2));
  return Number.isFinite(variance) ? Math.sqrt(variance) : null;
}

function cosineSimilarity(vectorA = [], vectorB = []) {
  if (!vectorA.length || vectorA.length !== vectorB.length) {
    return null;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < vectorA.length; index += 1) {
    const a = Number(vectorA[index]);
    const b = Number(vectorB[index]);

    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return null;
    }

    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA <= 0 || normB <= 0) {
    return null;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function mapWithConcurrency(items = [], worker, concurrency = 10) {
  const results = new Array(items.length);
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      } catch (_error) {
        results[currentIndex] = null;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, items.length) }, () =>
      runWorker(),
    ),
  );

  return results;
}

function getSummaryRow(profile, preferredLabels = []) {
  const rows = Array.isArray(profile?.summary?.splits)
    ? profile.summary.splits
    : [];

  for (const label of preferredLabels) {
    const match = rows.find(
      (row) =>
        String(row?.displayName || "")
          .trim()
          .toLowerCase() ===
        String(label || "")
          .trim()
          .toLowerCase(),
    );

    if (match) {
      return match;
    }
  }

  return rows[0] || null;
}

function normalizeSplitLabel(label) {
  const text = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (text === "postseason") {
    return "post season";
  }

  return text;
}

function normalizeCompSplitBucket(label) {
  const normalized = normalizeSplitLabel(label);

  if (normalized.includes("regular")) {
    return "regular";
  }

  if (normalized.includes("post")) {
    return "postseason";
  }

  if (normalized.includes("career")) {
    return "career";
  }

  return normalized || null;
}

function normalizeSeasonType(value) {
  const normalized = String(value || "all").toLowerCase();
  const allowed = new Set(["regular", "postseason", "all"]);
  return allowed.has(normalized) ? normalized : "all";
}

function getSplitSelectionConfig(split = "auto") {
  const normalized = String(split || "auto").toLowerCase();

  if (normalized === "regular") {
    return {
      split,
      preferredLabels: ["Regular Season"],
      allowFallback: false,
    };
  }

  if (normalized === "postseason") {
    return {
      split,
      preferredLabels: ["Post Season", "Postseason"],
      allowFallback: false,
    };
  }

  if (normalized === "career") {
    return {
      split,
      preferredLabels: ["Career"],
      allowFallback: false,
    };
  }

  return {
    split: "auto",
    preferredLabels: ["Regular Season", "Career"],
    allowFallback: true,
  };
}

function pickOverviewSummaryRow(summary = {}, preferredLabels = []) {
  let allowFallback = true;
  let labels = preferredLabels;

  if (!Array.isArray(preferredLabels)) {
    labels = preferredLabels?.preferredLabels || [];
    allowFallback = preferredLabels?.allowFallback !== false;
  }

  const rows = Array.isArray(summary?.splits) ? summary.splits : [];

  for (const label of labels) {
    const normalizedLabel = normalizeSplitLabel(label);
    const match = rows.find(
      (row) => normalizeSplitLabel(row?.displayName) === normalizedLabel,
    );

    if (match) {
      return match;
    }
  }

  return allowFallback ? rows[0] || null : null;
}

function buildOverviewSnapshot(
  overview = {},
  candidateAthleteId = null,
  fallbackLabel = null,
  splitSelection = { preferredLabels: ["Regular Season", "Career"] },
) {
  const athlete = overview?.athlete || {};
  const summary = overview?.statistics || overview?.statSplit || {};
  const names = Array.isArray(summary?.names) ? summary.names : [];
  const row = pickOverviewSummaryRow(summary, splitSelection);
  const stats = Array.isArray(row?.stats) ? row.stats : [];
  const resolvedId =
    Number(athlete?.id) ||
    Number(overview?.id) ||
    Number(candidateAthleteId) ||
    null;

  return {
    identity: {
      id: resolvedId,
      displayName:
        athlete?.displayName || athlete?.fullName || fallbackLabel || null,
      shortName: athlete?.shortName || fallbackLabel || null,
      position:
        athlete?.position?.abbreviation || athlete?.position?.name || null,
      team:
        athlete?.team?.displayName || athlete?.team?.shortDisplayName || null,
      teamAbbreviation: athlete?.team?.abbreviation || null,
      headshot: athlete?.headshot?.href || athlete?.images?.[0]?.href || null,
    },
    summary: {
      names,
      rowLabel: row?.displayName || null,
      stats,
    },
  };
}

function buildPlayerFeatureVectorFromSnapshot(snapshot = {}) {
  const names = Array.isArray(snapshot?.summary?.names)
    ? snapshot.summary.names
    : [];
  const stats = Array.isArray(snapshot?.summary?.stats)
    ? snapshot.summary.stats
    : [];
  const indexByName = new Map();

  names.forEach((name, index) => {
    indexByName.set(String(name || "").trim(), index);
  });

  function stat(name) {
    const index = indexByName.get(name);
    if (index === undefined) {
      return null;
    }
    return toNumber(stats[index]);
  }

  const points = stat("avgPoints");
  const rebounds = stat("avgRebounds");
  const assists = stat("avgAssists");
  const fieldGoalPct = stat("fieldGoalPct");
  const threePointPct = stat("threePointPct");
  const freeThrowPct = stat("freeThrowPct");
  const steals = stat("avgSteals");
  const blocks = stat("avgBlocks");
  const turnovers = stat("avgTurnovers");
  const minutes = stat("avgMinutes");
  const gamesPlayed = stat("gamesPlayed");
  const pointsPerMinute =
    Number.isFinite(points) && Number.isFinite(minutes) && minutes > 0
      ? points / minutes
      : null;
  const efficiencyIndex = [
    points,
    rebounds,
    assists,
    steals,
    blocks,
    turnovers,
  ].every((value) => Number.isFinite(value))
    ? points + rebounds + assists + steals + blocks - turnovers
    : null;

  const vector = {
    avgPoints: points,
    avgRebounds: rebounds,
    avgAssists: assists,
    fieldGoalPct,
    threePointPct,
    freeThrowPct,
    avgSteals: steals,
    avgBlocks: blocks,
    avgTurnovers: turnovers,
    avgMinutes: minutes,
    pointsPerMinute,
    efficiencyIndex,
  };

  const validCount = Object.values(vector).filter((value) =>
    Number.isFinite(value),
  ).length;

  return {
    vector,
    rowLabel: snapshot?.summary?.rowLabel || null,
    gamesPlayed,
    validCount,
  };
}

function buildCompReliability(feature = {}) {
  const gamesPlayed = toNumber(feature?.gamesPlayed);
  const avgMinutes = toNumber(feature?.vector?.avgMinutes);
  const hasGames = Number.isFinite(gamesPlayed);
  const hasMinutes = Number.isFinite(avgMinutes);

  if (!hasGames && !hasMinutes) {
    return 1;
  }

  const gameFactor = hasGames
    ? clampNumber(gamesPlayed / COMPS_STABILITY_GAME_TARGET)
    : 1;
  const minutesFactor = hasMinutes
    ? clampNumber(avgMinutes / COMPS_STABILITY_MINUTES_TARGET)
    : 1;

  const blendedStability = 0.7 * gameFactor + 0.3 * minutesFactor;

  // Keep a floor so low-sample players are reduced, not hard-dropped.
  return 0.35 + 0.65 * blendedStability;
}

function parseTeamIdFromRef(ref) {
  const value = String(ref || "");
  const match = value.match(/\/teams\/(\d+)/i);
  return match?.[1] || null;
}

async function enrichCompsWithDetails(comps = []) {
  if (!Array.isArray(comps) || !comps.length) {
    return comps;
  }

  const teamsPayload = await getAllTeams({
    query: "",
    forceRefresh: false,
  }).catch(() => null);
  const teamsById = new Map(
    (teamsPayload?.teams || [])
      .map((team) => [String(team?.id || ""), team])
      .filter(([id]) => Boolean(id)),
  );

  const profiles = await mapWithConcurrency(
    comps,
    async (comp) => {
      const profile = await getCoreAthleteProfile(comp.athleteId).catch(
        () => null,
      );
      return {
        comp,
        profile,
      };
    },
    4,
  );

  return profiles.map((item) => {
    const comp = item?.comp || {};
    const profile = item?.profile || {};
    const teamId = parseTeamIdFromRef(profile?.team?.$ref);
    const team = teamsById.get(String(teamId || "")) || null;

    return {
      ...comp,
      displayName:
        comp.displayName || profile?.displayName || profile?.fullName || null,
      team: comp.team || team?.displayName || team?.shortDisplayName || null,
      teamAbbreviation: comp.teamAbbreviation || team?.abbreviation || null,
      position:
        comp.position ||
        profile?.position?.abbreviation ||
        profile?.position?.name ||
        null,
      headshot:
        comp.headshot ||
        profile?.headshot?.href ||
        profile?.images?.[0]?.href ||
        null,
    };
  });
}

async function getTargetVectorFallback(
  athleteId,
  splitSelection = { preferredLabels: ["Regular Season", "Career"] },
) {
  const profile = await getPlayerProfile(athleteId, {
    forceRefresh: false,
  }).catch(() => null);

  if (!profile) {
    return null;
  }

  const identity = profile?.identity || {};
  const feature = buildPlayerFeatureVector(profile, splitSelection);

  return {
    id: Number(identity.id) || Number(athleteId),
    identity,
    feature,
  };
}

function buildPlayerFeatureVector(
  profile = {},
  splitSelection = { preferredLabels: ["Regular Season", "Career"] },
) {
  const names = Array.isArray(profile?.summary?.names)
    ? profile.summary.names
    : [];
  const summaryRows = Array.isArray(profile?.summary?.splits)
    ? profile.summary.splits
    : [];
  const preferredLabels = splitSelection?.preferredLabels || [
    "Regular Season",
    "Career",
  ];
  const allowFallback = splitSelection?.allowFallback !== false;
  const row =
    preferredLabels
      .map((label) =>
        summaryRows.find(
          (item) =>
            normalizeSplitLabel(item?.displayName) ===
            normalizeSplitLabel(label),
        ),
      )
      .find(Boolean) || (allowFallback ? summaryRows[0] || null : null);
  const stats = Array.isArray(row?.stats) ? row.stats : [];
  const indexByName = new Map();

  names.forEach((name, index) => {
    indexByName.set(String(name || "").trim(), index);
  });

  function stat(name) {
    const index = indexByName.get(name);
    if (index === undefined) {
      return null;
    }
    return toNumber(stats[index]);
  }

  const points = stat("avgPoints");
  const rebounds = stat("avgRebounds");
  const assists = stat("avgAssists");
  const fieldGoalPct = stat("fieldGoalPct");
  const threePointPct = stat("threePointPct");
  const freeThrowPct = stat("freeThrowPct");
  const steals = stat("avgSteals");
  const blocks = stat("avgBlocks");
  const turnovers = stat("avgTurnovers");
  const minutes = stat("avgMinutes");
  const gamesPlayed = stat("gamesPlayed");
  const pointsPerMinute =
    Number.isFinite(points) && Number.isFinite(minutes) && minutes > 0
      ? points / minutes
      : null;
  const efficiencyIndex = [
    points,
    rebounds,
    assists,
    steals,
    blocks,
    turnovers,
  ].every((value) => Number.isFinite(value))
    ? points + rebounds + assists + steals + blocks - turnovers
    : null;

  const vector = {
    avgPoints: points,
    avgRebounds: rebounds,
    avgAssists: assists,
    fieldGoalPct,
    threePointPct,
    freeThrowPct,
    avgSteals: steals,
    avgBlocks: blocks,
    avgTurnovers: turnovers,
    avgMinutes: minutes,
    pointsPerMinute,
    efficiencyIndex,
  };

  const validCount = Object.values(vector).filter((value) =>
    Number.isFinite(value),
  ).length;

  return {
    vector,
    rowLabel: row?.displayName || null,
    gamesPlayed,
    validCount,
  };
}

async function getPlayerComps(athleteId, options = {}) {
  const {
    limit = 10,
    sampleSize = 100,
    split = "auto",
    forceRefresh = false,
  } = options;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 25));
  const safeSampleSize = Math.max(30, Math.min(Number(sampleSize) || 100, 120));
  const splitSelection = getSplitSelectionConfig(split);
  const cacheKey = buildPlayerCompsCacheKey(
    athleteId,
    safeLimit,
    safeSampleSize,
    splitSelection.split,
  );

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, _cache: "HIT" };
    }
  }

  const optionsPayload = await getAthleteOptions({
    query: "",
    limit: safeSampleSize,
    offset: 0,
    forceRefresh,
  });
  const optionIds = (optionsPayload?.options || [])
    .map((item) => Number(item?.id))
    .filter((value) => Number.isInteger(value) && value > 0);
  const optionLabelById = new Map(
    (optionsPayload?.options || [])
      .map((item) => [Number(item?.id), item?.label || null])
      .filter(([id]) => Number.isInteger(id) && id > 0),
  );
  const candidateIds = [...new Set([Number(athleteId), ...optionIds])];

  const snapshots = (
    await mapWithConcurrency(
      candidateIds,
      async (id) =>
        buildOverviewSnapshot(
          await getAthleteOverview(id),
          id,
          optionLabelById.get(Number(id)) || null,
          splitSelection,
        ),
      6,
    )
  ).filter(Boolean);

  const rawVectors = snapshots
    .map((snapshot) => {
      const identity = snapshot?.identity || {};
      const feature = buildPlayerFeatureVectorFromSnapshot(snapshot);

      if (!Number.isFinite(Number(identity?.id))) {
        return null;
      }

      return {
        id: Number(identity.id),
        identity,
        feature,
      };
    })
    .filter(Boolean);

  let target = rawVectors.find((item) => item.id === Number(athleteId));

  if (!target) {
    target = await getTargetVectorFallback(athleteId, splitSelection);
  }

  if (!target || target?.feature?.validCount < 4) {
    const payload = {
      athleteId: String(athleteId),
      comparedAgainst: 0,
      sampleSizeRequested: safeSampleSize,
      limit: safeLimit,
      sourceSplit: target?.feature?.rowLabel || null,
      comps: [],
      warning:
        splitSelection.split === "auto"
          ? "Insufficient stats to build reliable comps for this athlete right now"
          : `Requested split \"${splitSelection.split}\" is unavailable or insufficient for this athlete right now`,
      lastUpdatedAt: new Date().toISOString(),
    };

    cache.set(cacheKey, payload, PLAYER_COMPS_CACHE_TTL_MS);

    return { ...payload, _cache: "MISS" };
  }

  const profileVectors = rawVectors.filter(
    (item) => item.feature.validCount >= 4,
  );

  if (!profileVectors.some((item) => item.id === target.id)) {
    profileVectors.push(target);
  }

  const dimensions = Object.keys(target.feature.vector);
  const targetSplitBucket = normalizeCompSplitBucket(target.feature.rowLabel);
  const eligibleProfileVectors = targetSplitBucket
    ? profileVectors.filter(
        (item) =>
          normalizeCompSplitBucket(item.feature.rowLabel) === targetSplitBucket,
      )
    : profileVectors;

  if (!eligibleProfileVectors.some((item) => item.id === target.id)) {
    eligibleProfileVectors.push(target);
  }

  const statsByDimension = {};

  for (const dim of dimensions) {
    statsByDimension[dim] = {
      mean: average(
        eligibleProfileVectors
          .map((item) => item.feature.vector[dim])
          .filter((value) => Number.isFinite(value)),
      ),
      std: stdDev(
        eligibleProfileVectors
          .map((item) => item.feature.vector[dim])
          .filter((value) => Number.isFinite(value)),
      ),
    };
  }

  function toZVector(vector) {
    return dimensions.map((dim) => {
      const value = vector[dim];
      const mean = statsByDimension[dim]?.mean;
      const std = statsByDimension[dim]?.std;

      if (
        !Number.isFinite(value) ||
        !Number.isFinite(mean) ||
        !Number.isFinite(std) ||
        std === 0
      ) {
        return 0;
      }

      return (value - mean) / std;
    });
  }

  const targetZVector = toZVector(target.feature.vector);

  const comps = eligibleProfileVectors
    .filter((item) => item.id !== Number(athleteId))
    .map((item) => {
      const similarity = cosineSimilarity(
        targetZVector,
        toZVector(item.feature.vector),
      );
      const reliability = buildCompReliability(item.feature);
      const adjustedSimilarity =
        Number.isFinite(similarity) && Number.isFinite(reliability)
          ? similarity * reliability
          : null;

      return {
        athleteId: String(item.id),
        displayName: item.identity.displayName || null,
        team: item.identity.team || null,
        teamAbbreviation: item.identity.teamAbbreviation || null,
        position: item.identity.position || null,
        headshot: item.identity.headshot || null,
        similarityScore: Number.isFinite(adjustedSimilarity)
          ? Number(adjustedSimilarity.toFixed(4))
          : null,
        sampleStability: Number(reliability.toFixed(4)),
        gamesPlayed:
          Number.isFinite(item.feature.gamesPlayed) &&
          item.feature.gamesPlayed > 0
            ? Number(item.feature.gamesPlayed)
            : null,
        sourceSplit: item.feature.rowLabel,
      };
    })
    .filter((item) => Number.isFinite(item.similarityScore))
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, safeLimit);
  const enrichedComps = await enrichCompsWithDetails(comps);

  const payload = {
    athleteId: String(athleteId),
    splitRequested: splitSelection.split,
    comparedAgainst: Math.max(0, eligibleProfileVectors.length - 1),
    sampleSizeRequested: safeSampleSize,
    limit: safeLimit,
    sourceSplit: target.feature.rowLabel,
    comps: enrichedComps,
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, payload, PLAYER_COMPS_CACHE_TTL_MS);

  return { ...payload, _cache: "MISS" };
}

function calcTrueShootingPct(points, fga, fta) {
  if (
    !Number.isFinite(points) ||
    !Number.isFinite(fga) ||
    !Number.isFinite(fta)
  ) {
    return null;
  }

  const denominator = 2 * (fga + 0.44 * fta);
  if (denominator <= 0) {
    return null;
  }

  return Number(((points / denominator) * 100).toFixed(2));
}

function computeRolling(values = [], window = 5, decimals = 2) {
  const safeWindow = Math.max(1, Math.floor(window));

  return values.map((_value, index) => {
    const slice = values.slice(Math.max(0, index - safeWindow + 1), index + 1);
    const valid = slice.filter((item) => Number.isFinite(item));

    if (!valid.length) {
      return null;
    }

    const avg = valid.reduce((sum, item) => sum + item, 0) / valid.length;
    return Number(avg.toFixed(decimals));
  });
}

function buildTrendDirection(startValue, endValue, threshold = 0.3) {
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) {
    return null;
  }

  const delta = endValue - startValue;

  if (delta > threshold) {
    return "up";
  }

  if (delta < -threshold) {
    return "down";
  }

  return "flat";
}

async function getPlayerTrajectory(athleteId, options = {}) {
  const {
    games = 20,
    window = 5,
    seasonType = "all",
    forceRefresh = false,
  } = options;
  const normalizedSeasonType = normalizeSeasonType(seasonType);
  const safeGames = Math.max(5, Math.min(Number(games) || 20, 30));
  const safeWindow = Math.max(2, Math.min(Number(window) || 5, 20));
  const cacheKey = buildPlayerTrajectoryCacheKey(
    athleteId,
    safeGames,
    safeWindow,
    normalizedSeasonType,
  );

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, _cache: "HIT" };
    }
  }

  const impact = await getPlayerImpact(athleteId, {
    games: safeGames,
    seasonType: normalizedSeasonType,
    forceRefresh,
  });

  const trend = Array.isArray(impact?.trend) ? impact.trend : [];
  const gamesWithMetrics = trend.map((game) => {
    const byKey = game?.boxScore?.byKey || {};
    const points = toNumber(byKey.points);
    const rebounds = toNumber(byKey.rebounds);
    const assists = toNumber(byKey.assists);
    const steals = toNumber(byKey.steals);
    const blocks = toNumber(byKey.blocks);
    const turnovers = toNumber(byKey.turnovers);
    const minutes = toNumber(byKey.minutes);
    const fg = parseMadeAttempted(byKey["fieldGoalsMade-fieldGoalsAttempted"]);
    const ft = parseMadeAttempted(byKey["freeThrowsMade-freeThrowsAttempted"]);

    return {
      eventId: game.eventId,
      gameDate: game.gameDate,
      matchup: game.matchup || null,
      seasonYear: game.seasonYear || null,
      seasonType: game.seasonType || null,
      score: game.score || null,
      metrics: {
        points,
        rebounds,
        assists,
        steals,
        blocks,
        turnovers,
        minutes,
        plusMinus: toNumber(game.plusMinus),
        trueShootingPct: calcTrueShootingPct(
          points,
          fg.attempted,
          ft.attempted,
        ),
      },
    };
  });

  const pointsRolling = computeRolling(
    gamesWithMetrics.map((item) => item.metrics.points),
    safeWindow,
    2,
  );
  const assistsRolling = computeRolling(
    gamesWithMetrics.map((item) => item.metrics.assists),
    safeWindow,
    2,
  );
  const reboundsRolling = computeRolling(
    gamesWithMetrics.map((item) => item.metrics.rebounds),
    safeWindow,
    2,
  );
  const trueShootingRolling = computeRolling(
    gamesWithMetrics.map((item) => item.metrics.trueShootingPct),
    safeWindow,
    2,
  );

  const trajectory = gamesWithMetrics.map((item, index) => ({
    ...item,
    rolling: {
      points: pointsRolling[index],
      assists: assistsRolling[index],
      rebounds: reboundsRolling[index],
      trueShootingPct: trueShootingRolling[index],
    },
  }));

  const payload = {
    athleteId: String(athleteId),
    gamesRequested: safeGames,
    gamesAnalyzed: trajectory.length,
    window: safeWindow,
    seasonTypeRequested: normalizedSeasonType,
    seasonsCovered: impact?.seasonsCovered || [],
    seasonTypesCovered: impact?.seasonTypesCovered || [],
    trendDirection: {
      points: buildTrendDirection(
        pointsRolling[0],
        pointsRolling[pointsRolling.length - 1],
      ),
      assists: buildTrendDirection(
        assistsRolling[0],
        assistsRolling[assistsRolling.length - 1],
      ),
      rebounds: buildTrendDirection(
        reboundsRolling[0],
        reboundsRolling[reboundsRolling.length - 1],
      ),
      trueShootingPct: buildTrendDirection(
        trueShootingRolling[0],
        trueShootingRolling[trueShootingRolling.length - 1],
      ),
    },
    trajectory,
    lastUpdatedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, payload, PLAYER_TRAJECTORY_CACHE_TTL_MS);

  return { ...payload, _cache: "MISS" };
}

async function getPlayerProfile(athleteId, options = {}) {
  const { forceRefresh = false } = options;
  const cacheKey = buildPlayerCacheKey(athleteId);

  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached && hasUsableIdentity(cached.identity)) {
      return { ...cached, _cache: "HIT" };
    }
  }

  const [athleteBundle, impact] = await Promise.all([
    getAthleteBundle(athleteId),
    getPlayerImpact(athleteId, { games: 50, forceRefresh }),
  ]);
  const normalized = normalizePlayerBundle(athleteBundle, athleteId, impact);

  if (hasUsableIdentity(normalized.identity)) {
    cache.set(cacheKey, normalized, PLAYER_CACHE_TTL_MS);
  }

  return { ...normalized, _cache: "MISS" };
}

async function comparePlayers(playerAId, playerBId, options = {}) {
  const [playerA, playerB] = await Promise.all([
    getPlayerProfile(playerAId, options),
    getPlayerProfile(playerBId, options),
  ]);

  return {
    players: [playerA, playerB],
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  getPlayerProfile,
  comparePlayers,
  getPlayerImpact,
  getPlayerComps,
  getPlayerTrajectory,
};
