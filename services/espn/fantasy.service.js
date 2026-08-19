const axios = require("axios");
const { endpoints, SCORING_LABELS } = require("../../config/nflEndpoints");

const DEFAULT_TIMEOUT_MS = 20000;

const client = axios.create({
  timeout: DEFAULT_TIMEOUT_MS,
  // fantasy.espn.com redirects to an HTML page; following it would yield a 200
  // with a string body that looks like "player has no data" downstream.
  maxRedirects: 0,
  headers: {
    Accept: "application/json",
    "User-Agent": "basketball-analytics-tool-be/1.0",
    "X-Fantasy-Source": "kona",
    "X-Fantasy-Platform": "kona-PROD",
  },
});

function upstreamError(message, statusCode, url) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.isUpstreamError = true;
  error.url = url;
  return error;
}

function buildPlayerFilter(options = {}) {
  const { limit = 1000, sortValue = "PPR" } = options;

  return {
    players: {
      limit,
      sortDraftRanks: {
        sortPriority: 100,
        sortAsc: true,
        value: sortValue,
      },
    },
  };
}

async function fetchFantasyPlayers(year, scoringId, filter) {
  const url = endpoints.fantasyPlayers(year, scoringId);
  const appliedFilter = filter || buildPlayerFilter();

  let response;
  try {
    response = await client.get(url, {
      params: { view: "kona_player_info" },
      headers: { "X-Fantasy-Filter": JSON.stringify(appliedFilter) },
    });
  } catch (error) {
    if (error.response) {
      throw upstreamError(
        `ESPN fantasy request failed (${error.response.status}) for ${url}`,
        error.response.status,
        url,
      );
    }

    throw upstreamError(
      `ESPN fantasy request error for ${url}: ${error.message}`,
      502,
      url,
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw upstreamError(
      `ESPN fantasy endpoint redirected (${response.status}) to ${response.headers?.location || "unknown"} for ${url}; the reads host may have moved`,
      502,
      url,
    );
  }

  const payload = response.data;

  if (
    typeof payload === "string" ||
    payload === null ||
    typeof payload !== "object"
  ) {
    throw upstreamError(
      `ESPN fantasy returned a non-JSON body for ${url}`,
      502,
      url,
    );
  }

  if (!Array.isArray(payload.players)) {
    throw upstreamError(
      `ESPN fantasy response missing players array for ${url}`,
      502,
      url,
    );
  }

  return payload;
}

function describeScoring(scoringId) {
  return SCORING_LABELS[scoringId] || String(scoringId);
}

module.exports = {
  fetchFantasyPlayers,
  buildPlayerFilter,
  describeScoring,
};
