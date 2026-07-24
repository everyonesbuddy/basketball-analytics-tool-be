function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function firstDefined(...values) {
  for (const value of values) {
    if (hasValue(value)) {
      return value;
    }
  }
  return null;
}

function pickTeamFromStats(stats) {
  const teams = stats?.teams;

  if (!teams) {
    return null;
  }

  if (Array.isArray(teams)) {
    return teams[0] || null;
  }

  if (typeof teams === "object") {
    const values = Object.values(teams);
    return values[0] || null;
  }

  return null;
}

function pickLatestGamelogTeam(gamelog) {
  const events = Object.values(gamelog?.events || {});

  if (!events.length) {
    return null;
  }

  const latest = events.sort(
    (a, b) => new Date(b.gameDate) - new Date(a.gameDate),
  )[0];
  return latest?.team || null;
}

function resolveTeamDisplayName(team = {}) {
  const linkHref = team?.links?.[0]?.href || "";
  const slugMatch = linkHref.match(/\/name\/[^/]+\/([^/?#]+)/i);
  const slugName = slugMatch?.[1]
    ? slugMatch[1]
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    : null;

  return (
    firstDefined(
      team?.displayName,
      team?.shortDisplayName,
      slugName,
      [team?.location, team?.name].filter(hasValue).join(" "),
      team?.name,
    ) || null
  );
}

function resolveCurrentTeam(latestGamelogTeam, athleteTeam, statsTeam) {
  const primary = latestGamelogTeam || athleteTeam || statsTeam || {};

  return {
    displayName:
      resolveTeamDisplayName(primary) ||
      resolveTeamDisplayName(athleteTeam || {}) ||
      resolveTeamDisplayName(statsTeam || {}),
    abbreviation:
      firstDefined(
        primary?.abbreviation,
        athleteTeam?.abbreviation,
        statsTeam?.abbreviation,
        statsTeam?.shortDisplayName,
      ) || null,
  };
}

function pickHeadshot(overview, coreProfile) {
  const links =
    overview?.athlete?.headshot?.href ||
    overview?.athlete?.images?.[0]?.href ||
    coreProfile?.headshot?.href ||
    coreProfile?.images?.[0]?.href;
  return links || null;
}

function pickAthleteSource(overview, coreProfile) {
  const overviewAthlete = overview?.athlete;

  if (hasValue(coreProfile?.id) || hasValue(coreProfile?.displayName)) {
    return coreProfile;
  }

  if (hasValue(overviewAthlete?.id) || hasValue(overviewAthlete?.displayName)) {
    return overviewAthlete;
  }

  return {};
}

function normalizeSplitView(view, key, label) {
  return {
    key,
    label,
    available: Boolean(view),
    data: view || null,
  };
}

function normalizeSplitTabs(
  splitViews,
  rawSplits,
  derivedPostSeasonRow = null,
) {
  const regularSeason = splitViews?.regularSeason || rawSplits || null;
  const postSeason =
    splitViews?.postSeason ||
    (derivedPostSeasonRow?.available
      ? {
          displayName: "Derived Post Season",
          labels: regularSeason?.labels || [],
          names: regularSeason?.names || [],
          displayNames: regularSeason?.displayNames || [],
          splitCategories: [
            {
              name: "split",
              displayName: "split",
              splits: [
                {
                  displayName: "Post Season",
                  stats: derivedPostSeasonRow.stats,
                },
              ],
            },
          ],
        }
      : null);
  const career = splitViews?.career || null;

  return {
    raw: rawSplits || null,
    tabs: [
      normalizeSplitView(regularSeason, "regularSeason", "Regular Season"),
      normalizeSplitView(postSeason, "postSeason", "Post Season"),
      normalizeSplitView(career, "career", "Career"),
    ],
  };
}

function pickPrimarySplitCategory(view) {
  const categories = Array.isArray(view?.splitCategories)
    ? view.splitCategories
    : [];

  if (!categories.length) {
    return null;
  }

  return (
    categories.find((category) =>
      ["split", "totals"].includes(String(category?.name || "").toLowerCase()),
    ) || categories[0]
  );
}

function pickPrimarySplitEntry(view) {
  const category = pickPrimarySplitCategory(view);
  const entries = Array.isArray(category?.splits) ? category.splits : [];

  if (!entries.length) {
    return null;
  }

  return (
    entries.find((entry) => {
      const label = String(entry?.displayName || "").toLowerCase();
      const abbr = String(entry?.abbreviation || "").toLowerCase();
      return (
        label.includes("all splits") || label === "career" || abbr === "total"
      );
    }) || entries[0]
  );
}

function normalizeStatKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function equivalentStatKeys(statName) {
  const normalized = normalizeStatKey(statName);
  const aliases = {
    threepointpct: ["threepointfieldgoalpct", "threepointpct"],
    fieldgoalpct: ["fieldgoalpct"],
    freethrowpct: ["freethrowpct"],
    avgrebounds: ["avgrebounds", "totalrebounds", "rebounds"],
    avgassists: ["avgassists", "assists"],
    avgblocks: ["avgblocks", "blocks"],
    avgsteals: ["avgsteals", "steals"],
    avgfouls: ["avgfouls", "fouls"],
    avgturnovers: ["avgturnovers", "turnovers"],
    avgpoints: ["avgpoints", "points"],
    avgminutes: ["avgminutes", "minutes"],
    gamesplayed: ["gamesplayed"],
  };

  return aliases[normalized] || [normalized];
}

function mapSplitStatsToTargetNames(view, stats, targetNames = []) {
  if (!Array.isArray(targetNames) || !targetNames.length) {
    return stats;
  }

  const sourceNames = Array.isArray(view?.names) ? view.names : [];

  if (!sourceNames.length || !Array.isArray(stats)) {
    return targetNames.map(() => null);
  }

  const indexByName = new Map();

  sourceNames.forEach((name, index) => {
    indexByName.set(normalizeStatKey(name), index);
  });

  return targetNames.map((targetName) => {
    const aliases = equivalentStatKeys(targetName);

    for (const alias of aliases) {
      const matchIndex = indexByName.get(alias);
      if (matchIndex !== undefined) {
        return stats[matchIndex] ?? null;
      }
    }

    return null;
  });
}

function buildSummaryRowFromSplitView(view, label, targetNames = []) {
  const primary = pickPrimarySplitEntry(view);

  if (!primary || !Array.isArray(primary?.stats)) {
    return null;
  }

  const mappedStats = mapSplitStatsToTargetNames(
    view,
    primary.stats,
    targetNames,
  );

  return {
    displayName: label,
    stats: mappedStats,
    abbreviation: primary.abbreviation || null,
  };
}

function parseMadeAttempted(value) {
  const text = String(value || "").trim();
  const [made, attempted] = text.split("-").map((part) => Number(part));

  if (!Number.isFinite(made) || !Number.isFinite(attempted)) {
    return { made: null, attempted: null };
  }

  return { made, attempted };
}

function safeAvg(total, count, decimals = 1) {
  if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0) {
    return null;
  }

  return Number((total / count).toFixed(decimals));
}

function safePct(made, attempted, decimals = 1) {
  if (!Number.isFinite(made) || !Number.isFinite(attempted) || attempted <= 0) {
    return null;
  }

  return Number(((made / attempted) * 100).toFixed(decimals));
}

function toNumeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildPostSeasonSummaryFromImpact(impact, expectedLength = 12) {
  const postseasonGames = (impact?.trend || []).filter(
    (game) => Number(game?.season?.type) === 3,
  );

  if (!postseasonGames.length) {
    return {
      displayName: "Post Season",
      stats: Array.from({ length: expectedLength }, () => null),
      available: false,
    };
  }

  const totals = {
    minutes: 0,
    rebounds: 0,
    assists: 0,
    blocks: 0,
    steals: 0,
    fouls: 0,
    turnovers: 0,
    points: 0,
    fgMade: 0,
    fgAtt: 0,
    tpMade: 0,
    tpAtt: 0,
    ftMade: 0,
    ftAtt: 0,
  };

  for (const game of postseasonGames) {
    const box = game?.boxScore?.byKey || {};

    const fg = parseMadeAttempted(box["fieldGoalsMade-fieldGoalsAttempted"]);
    const tp = parseMadeAttempted(
      box["threePointFieldGoalsMade-threePointFieldGoalsAttempted"],
    );
    const ft = parseMadeAttempted(box["freeThrowsMade-freeThrowsAttempted"]);

    totals.minutes += toNumeric(box.minutes) || 0;
    totals.rebounds += toNumeric(box.rebounds) || 0;
    totals.assists += toNumeric(box.assists) || 0;
    totals.blocks += toNumeric(box.blocks) || 0;
    totals.steals += toNumeric(box.steals) || 0;
    totals.fouls += toNumeric(box.fouls) || 0;
    totals.turnovers += toNumeric(box.turnovers) || 0;
    totals.points += toNumeric(box.points) || 0;
    totals.fgMade += fg.made || 0;
    totals.fgAtt += fg.attempted || 0;
    totals.tpMade += tp.made || 0;
    totals.tpAtt += tp.attempted || 0;
    totals.ftMade += ft.made || 0;
    totals.ftAtt += ft.attempted || 0;
  }

  const gameCount = postseasonGames.length;
  const stats = [
    String(gameCount),
    safeAvg(totals.minutes, gameCount),
    safePct(totals.fgMade, totals.fgAtt),
    safePct(totals.tpMade, totals.tpAtt),
    safePct(totals.ftMade, totals.ftAtt),
    safeAvg(totals.rebounds, gameCount),
    safeAvg(totals.assists, gameCount),
    safeAvg(totals.blocks, gameCount),
    safeAvg(totals.steals, gameCount),
    safeAvg(totals.fouls, gameCount),
    safeAvg(totals.turnovers, gameCount),
    safeAvg(totals.points, gameCount),
  ];

  return {
    displayName: "Post Season",
    stats,
    available: true,
  };
}

function normalizeSummarySplitLabel(label) {
  const normalized = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (!normalized) {
    return "";
  }

  if (normalized === "postseason" || normalized === "post season") {
    return "post season";
  }

  if (normalized === "regularseason" || normalized === "regular season") {
    return "regular season";
  }

  return normalized;
}

function mergeSummaryRows(baseRows = [], rowsToAppend = []) {
  const merged = [];
  const usedKeys = new Set();

  // Prefer normalized rows over raw overview rows when both represent
  // the same logical split.
  for (const row of [...rowsToAppend, ...baseRows]) {
    if (!row) {
      continue;
    }

    const key = normalizeSummarySplitLabel(row.displayName);

    if (!key || usedKeys.has(key)) {
      continue;
    }

    usedKeys.add(key);
    merged.push(row);
  }

  return merged;
}

function sortSummaryRows(rows = []) {
  const order = {
    "regular season": 1,
    "post season": 2,
    postseason: 2,
    career: 3,
  };

  return [...rows].sort((a, b) => {
    const aKey = normalizeSummarySplitLabel(a?.displayName || "");
    const bKey = normalizeSummarySplitLabel(b?.displayName || "");
    const aRank = order[aKey] || 99;
    const bRank = order[bKey] || 99;
    return aRank - bRank;
  });
}

function buildNormalizedSummary(overview, splitViews, rawSplits, impact) {
  const baseSummary = overview?.statistics || overview?.statSplit || null;
  const regularSeasonView = splitViews?.regularSeason || rawSplits || null;
  const postSeasonView = splitViews?.postSeason || null;
  const careerView = splitViews?.career || null;

  const targetNames =
    (Array.isArray(baseSummary?.names) && baseSummary.names.length
      ? baseSummary.names
      : regularSeasonView?.names) || [];

  const regularRow = buildSummaryRowFromSplitView(
    regularSeasonView,
    "Regular Season",
    targetNames,
  );
  const expectedLength =
    Array.isArray(baseSummary?.labels) && baseSummary.labels.length
      ? baseSummary.labels.length
      : 12;
  const derivedPostSeasonRow = buildPostSeasonSummaryFromImpact(
    impact,
    expectedLength,
  );
  const postSeasonRow =
    buildSummaryRowFromSplitView(postSeasonView, "Post Season", targetNames) ||
    derivedPostSeasonRow;
  const careerRow = buildSummaryRowFromSplitView(
    careerView,
    "Career",
    targetNames,
  );

  const baseRows = Array.isArray(baseSummary?.splits) ? baseSummary.splits : [];
  const mergedRows = sortSummaryRows(
    mergeSummaryRows(baseRows, [regularRow, postSeasonRow, careerRow]),
  );

  const labels =
    baseSummary?.labels ||
    regularSeasonView?.labels ||
    careerView?.labels ||
    rawSplits?.labels ||
    [];
  const names =
    baseSummary?.names ||
    regularSeasonView?.names ||
    careerView?.names ||
    rawSplits?.names ||
    [];
  const displayNames =
    baseSummary?.displayNames ||
    regularSeasonView?.displayNames ||
    careerView?.displayNames ||
    rawSplits?.displayNames ||
    [];

  if (!baseSummary && !mergedRows.length) {
    return null;
  }

  return {
    displayName:
      baseSummary?.displayName || regularSeasonView?.displayName || "Summary",
    labels,
    names,
    displayNames,
    splits: mergedRows,
  };
}

function extractPostSeasonSummaryRow(summary) {
  const rows = Array.isArray(summary?.splits) ? summary.splits : [];
  return (
    rows.find(
      (row) =>
        normalizeSummarySplitLabel(row?.displayName || "") === "post season",
    ) || null
  );
}

function normalizeAthleteIdentity(
  overview,
  stats,
  coreProfile,
  gamelog,
  requestedAthleteId,
) {
  const athlete = pickAthleteSource(overview, coreProfile);
  const statsTeam = pickTeamFromStats(stats);
  const latestGamelogTeam = pickLatestGamelogTeam(gamelog);
  const currentTeam = resolveCurrentTeam(
    latestGamelogTeam,
    athlete.team,
    statsTeam,
  );
  const displayName =
    firstDefined(
      athlete.displayName,
      athlete.fullName,
      overview?.athlete?.displayName,
      overview?.athlete?.fullName,
    ) ||
    [athlete.firstName, athlete.lastName].filter(hasValue).join(" ") ||
    null;

  const shortName =
    firstDefined(athlete.shortName, overview?.athlete?.shortName) ||
    (hasValue(athlete.firstName) && hasValue(athlete.lastName)
      ? `${athlete.firstName[0]}. ${athlete.lastName}`
      : null);

  const resolvedId =
    safeNumber(athlete.id) ||
    safeNumber(overview?.athlete?.id) ||
    safeNumber(coreProfile?.id) ||
    safeNumber(requestedAthleteId);

  return {
    id: resolvedId,
    displayName,
    shortName,
    position:
      firstDefined(
        athlete.position?.abbreviation,
        athlete.position?.name,
        overview?.athlete?.position?.abbreviation,
        overview?.athlete?.position?.name,
      ) || null,
    team: currentTeam.displayName,
    teamAbbreviation: currentTeam.abbreviation,
    jersey: firstDefined(athlete.jersey, overview?.athlete?.jersey),
    experienceYears:
      safeNumber(athlete.experience?.years) ||
      safeNumber(athlete.experience?.year) ||
      null,
    age: safeNumber(athlete.age) || null,
    headshot: pickHeadshot(overview, coreProfile),
  };
}

function normalizePlayerBundle(
  athleteBundle,
  requestedAthleteId = null,
  impact = null,
) {
  const { overview, stats, splits, splitViews, gamelog, coreProfile } =
    athleteBundle;

  const normalizedSummary = buildNormalizedSummary(
    overview,
    splitViews,
    splits,
    impact,
  );
  const derivedPostSeasonRow = extractPostSeasonSummaryRow(normalizedSummary);

  return {
    identity: normalizeAthleteIdentity(
      overview,
      stats,
      coreProfile,
      gamelog,
      requestedAthleteId,
    ),
    summary: normalizedSummary,
    stats: stats || null,
    splits: normalizeSplitTabs(splitViews, splits, derivedPostSeasonRow),
    plusMinusTrend: impact || null,
    gameLog: gamelog || null,
    lastUpdatedAt: new Date().toISOString(),
  };
}

module.exports = {
  normalizePlayerBundle,
};
