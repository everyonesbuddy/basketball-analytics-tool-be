const axios = require("axios");

const DEFAULT_TIMEOUT_MS = 12000;

const client = axios.create({
  timeout: DEFAULT_TIMEOUT_MS,
  headers: {
    Accept: "application/json",
    "User-Agent": "basketball-analytics-tool-be/1.0",
  },
});

async function getJson(url, params = {}) {
  try {
    const response = await client.get(url, { params });
    return response.data;
  } catch (error) {
    if (error.response) {
      const upstreamError = new Error(
        `ESPN request failed (${error.response.status}) for ${url}`,
      );

      upstreamError.statusCode = error.response.status;
      upstreamError.isUpstreamError = true;
      upstreamError.url = url;

      throw upstreamError;
    }

    const networkError = new Error(
      `ESPN request error for ${url}: ${error.message}`,
    );
    networkError.statusCode = 502;
    networkError.isUpstreamError = true;
    networkError.url = url;

    throw networkError;
  }
}

module.exports = {
  getJson,
};
