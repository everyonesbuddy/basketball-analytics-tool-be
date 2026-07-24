# Basketball Analytics Tool Backend

This service is the backend API for your NBA dashboard. It pulls data from ESPN, normalizes inconsistent payloads, and returns stable contracts for player and team analytics.

## Why This Exists

ESPN responses are useful but inconsistent across endpoints and athletes. This backend handles those inconsistencies so the frontend does not have to.

What it does for you:

- Combines multiple ESPN endpoints into one frontend-friendly response.
- Normalizes player identity and current team data.
- Provides stable split rows for Regular Season, Post Season, and Career when possible.
- Adds explicit season metadata tags to game-level analytics rows.
- Supports short-lived in-memory caching to improve response speed.

## API Base

All routes are mounted under `/api`.

## Available Endpoints

### Health

`GET /api/health`

Returns service status and timestamp.

### Players

`GET /api/players/:athleteId`

- Returns normalized player profile.
- Optional query: `forceRefresh=true`.

`GET /api/players/compare/head-to-head?playerAId=...&playerBId=...`

- Compares two player profiles.
- Optional query: `forceRefresh=true`.

`GET /api/players/options?query=&limit=1000&offset=0`

- Returns searchable player options list.
- Optional query: `forceRefresh=true`.

`GET /api/players/all`

- Returns full player list (current implementation requests up to 2000 records).
- Optional query: `forceRefresh=true`.

`GET /api/players/:athleteId/impact?games=10`

- Returns plus-minus trend and rolling analytics.
- Optional query: `forceRefresh=true`.
- Optional query: `seasonType=regular|postseason|all`.

`GET /api/players/:athleteId/comps?limit=10&sampleSize=100`

- Returns top similar players based on normalized stat vectors.
- Top results are enriched with team, position, and headshot metadata using bounded lightweight lookups.
- Optional query: `forceRefresh=true`.
- Optional query: `split=auto|regular|postseason|career`.

`GET /api/players/:athleteId/trajectory?games=20&window=5`

- Returns within-season development curve with rolling scoring and efficiency signals.
- Optional query: `forceRefresh=true`.
- Optional query: `seasonType=regular|postseason|all`.

### Teams

`GET /api/teams?query=`

- Returns searchable teams list.
- Optional query: `forceRefresh=true`.

`GET /api/teams/:teamId/efficiency?games=5&seasonType=regular`

- Returns recent team efficiency trend and aggregate ratings.
- Supported `seasonType`: `regular`, `postseason`, `all`.
- Optional query: `forceRefresh=true`.

`GET /api/teams/:teamId/needs?games=5&seasonType=regular`

- Returns team-vs-league gap analysis based on the same efficiency metrics.
- Supported `seasonType`: `regular`, `postseason`, `all`.
- Optional query: `forceRefresh=true`.

## Response Envelope

Successful responses use the same envelope:

```json
{
  "success": true,
  "data": {}
}
```

Validation errors return HTTP 400 with a descriptive message, such as `athleteId must be a positive integer`.

## What Is Normalized

### Player Profile Normalization

Player profile data is merged from multiple ESPN sources and returned as a stable contract:

- `identity`: id, displayName, shortName, position, team, teamAbbreviation, jersey, experienceYears, age, headshot.
- `summary`: normalized summary with consistent split rows.
- `splits.tabs`: stable tabs for `regularSeason`, `postSeason`, and `career`.
- `plusMinusTrend`: embedded player impact analytics.
- `stats`, `gameLog`: raw ESPN structures for deeper UI use.

### Split Consistency Behavior

The backend attempts to keep summary rows consistent across players:

- `Regular Season`
- `Post Season`
- `Career`

If ESPN does not provide a full postseason split view for a player, postseason summary values can be derived from recent impact game data when available.

### Team Identity Coherence

The backend resolves current team information using the freshest available data source and keeps team name and abbreviation coherent in the same identity object.

## Season Tagging Contract

To support reliable frontend tagging, game-level analytics now include explicit season metadata.

### Per-game tags (player impact and team efficiency rows)

Each game row includes:

- `seasonYear`: number, for example `2026`.
- `seasonType`: `regular` or `postseason`.
- `seasonTypeCode`: ESPN numeric code (`2` regular, `3` postseason).

### Response-level season metadata

Analytics responses include:

- `seasonTypeRequested`: normalized request bucket.
- `seasonsCovered`: distinct season years in returned rows.
- `seasonTypesCovered`: distinct season buckets in returned rows.

Notes:

- For team efficiency, `seasonTypeRequested` mirrors query input after normalization.
- For player impact and trajectory, `seasonTypeRequested` mirrors query input after normalization.

## Team Efficiency Output

Team efficiency output includes:

- `teamId`, `team`
- `seasonTypeRequested`, `seasonsCovered`, `seasonTypesCovered`
- `gamesRequested`, `gamesPlayed`
- `recentGames` with matchup, score, team/opponent metadata, box score stats, and calculated `offRtg`, `defRtg`, `netRtg`
- `aggregate` totals and ratings
- `lastUpdatedAt`, `_cache`

## Team Need Gap Output

Team need gap output includes:

- `teamId`, `team`
- `seasonTypeRequested`, `gamesRequested`
- `benchmarkTeamsCount`
- `seasonsCovered`, `seasonTypesCovered`
- `teamAggregate`
- `leagueAverage`
- `deltaFromLeague`
- `strengths` (top positive deltas)
- `gaps` (top negative deltas)
- `lastUpdatedAt`, `_cache`

## Player Impact Output

Player impact output includes:

- `athleteId`
- `seasonTypeRequested`, `seasonsCovered`, `seasonTypesCovered`
- `gamesPlayed`, `totalPlusMinus`, `averagePlusMinus`, `rollingAverage`
- `trend` rows with matchup, score, status, team/opponent metadata, box score map, plus-minus, and rolling average
- `lastUpdatedAt`, `_cache`

## Player Comps Output

Player comps output includes:

- `athleteId`
- `comparedAgainst`
- `sampleSizeRequested`
- `limit`
- `sourceSplit` (the split used to build the target vector)
- `comps[]` with identity snippets and `similarityScore`
- `lastUpdatedAt`, `_cache`

## Player Trajectory Output

Player trajectory output includes:

- `athleteId`
- `gamesRequested`, `gamesAnalyzed`
- `window` (rolling window size)
- `seasonTypeRequested`, `seasonsCovered`, `seasonTypesCovered`
- `trendDirection` for points, assists, rebounds, and TS%
- `trajectory[]` per game with raw metrics and rolling metrics
- `lastUpdatedAt`, `_cache`

## Interpretation Notes

- Value comps represent statistical profile similarity, not exact play-style identity.
- Results depend on request context (`sampleSize`, `games`, `seasonType`, and cache state).
- Upstream ESPN payload variability can affect both availability and precision of derived outputs.

## Variable And Derivation Reference

This section is a full reference for request variables, internal variables, cache behavior, and derived metrics used across the app.

### Core Runtime Variables

- `PORT`:
  - Source: environment variable `PORT`.
  - Fallback: `5000`.
  - Used by server startup.

- `DEFAULT_TIMEOUT_MS`:
  - Value: `12000`.
  - Used by ESPN HTTP client for upstream request timeout.

- `SPORT` and `LEAGUE`:
  - Values: `basketball` and `nba`.
  - Used to build ESPN endpoint URLs.

### Common Controller Parsing Rules

- `forceRefresh`:
  - Parsed as true only when query value is string `"true"` (case-insensitive).
  - Purpose: bypass in-memory cache for the request.

- `parsePositiveInteger(value, fallback)`:
  - Returns parsed value only if it is a positive integer.
  - Otherwise returns fallback default.

- `validateAthleteId` and `validateTeamId`:
  - Require positive integers.
  - On failure return HTTP 400.

- `seasonType` normalization:
  - Allowed: `regular`, `postseason`, `all`.
  - Fallback: `regular`.

### Endpoint Input Variables

#### Players

- `GET /api/players/:athleteId`
  - Path: `athleteId`.
  - Query: `forceRefresh`.

- `GET /api/players/compare/head-to-head`
  - Query: `playerAId`, `playerBId`, `forceRefresh`.

- `GET /api/players/options`
  - Query: `query`, `limit`, `offset`, `forceRefresh`.
  - Defaults: `limit=1000`, `offset=0`.

- `GET /api/players/all`
  - Query: `forceRefresh`.
  - Internally fixed to options request with `query=""`, `limit=2000`, `offset=0`.

- `GET /api/players/:athleteId/impact`
  - Path: `athleteId`.
  - Query: `games`, `seasonType`, `forceRefresh`.
  - Default: `games=10`, `seasonType=all`.

- `GET /api/players/:athleteId/comps`
  - Path: `athleteId`.
  - Query: `limit`, `sampleSize`, `split`, `forceRefresh`.
  - Defaults: `limit=10`, `sampleSize=100`, `split=auto`.

- `GET /api/players/:athleteId/trajectory`
  - Path: `athleteId`.
  - Query: `games`, `window`, `seasonType`, `forceRefresh`.
  - Defaults: `games=20`, `window=5`, `seasonType=all`.

#### Teams

- `GET /api/teams`
  - Query: `query`, `forceRefresh`.

- `GET /api/teams/:teamId/efficiency`
  - Path: `teamId`.
  - Query: `games`, `seasonType`, `forceRefresh`.
  - Defaults: `games=5`, `seasonType=regular`.

- `GET /api/teams/:teamId/needs`
  - Path: `teamId`.
  - Query: `games`, `seasonType`, `forceRefresh`.
  - Defaults: `games=5`, `seasonType=regular`.

### Input Clamping Used In Aggregators

- Player impact:
  - `safeGames = clamp(games, 1, 100)`.

- Player comps:
  - `safeLimit = clamp(limit, 1, 25)`.
  - `safeSampleSize = clamp(sampleSize, 30, 120)`.

- Player trajectory:
  - `safeGames = clamp(games, 5, 30)`.
  - `safeWindow = clamp(window, 2, 20)`.

- Team efficiency and team needs:
  - `safeGames = clamp(games, 1, 15)`.
  - `normalizedSeasonType in {regular, postseason, all}`.

### Cache Keys And TTLs

- Global cache implementation:
  - In-memory `Map` with per-item `expiresAt` timestamp.
  - Expired entries are removed on read.

- Key patterns and TTL:
  - Player profile: `player:{athleteId}` (3 minutes).
  - Player impact: `player-impact:{athleteId}:{games}:{seasonType}` (3 minutes).
  - Player comps: `player-comps:v6:{athleteId}:{limit}:{sampleSize}:{split}` (10 minutes).
  - Player trajectory: `player-trajectory:{athleteId}:{games}:{window}:{seasonType}` (5 minutes).
  - Teams list: `teams:all:{normalizedQuery}` (15 minutes).
  - Player options: `player-options:{limit}:{offset}:{normalizedQuery}` (15 minutes).
  - Team efficiency: `team-efficiency:{teamId}:{games}:{seasonType}` (5 minutes).
  - Team needs: `team-needs:{teamId}:{games}:{seasonType}` (20 minutes).
  - Team needs league baseline: `team-needs:league-baseline:{games}:{seasonType}` (20 minutes).

### Normalization Variables (Player Profile)

- Identity normalization output fields:
  - `id`, `displayName`, `shortName`, `position`, `team`, `teamAbbreviation`, `jersey`, `experienceYears`, `age`, `headshot`.

- Identity source priority:
  - Prefer core athlete profile when available.
  - Fallback to overview athlete payload.
  - Team resolution prefers latest gamelog team, then athlete team, then stats team.

- Summary split normalization:
  - Normalized split rows target `Regular Season`, `Post Season`, `Career` ordering.
  - Duplicate labels like `Postseason` and `Post Season` are canonicalized and deduplicated.
  - If postseason split is unavailable, a derived postseason row can be synthesized from postseason impact games.

### Player Impact Variable Map

- Selection variables:
  - `recentGames`: most recent completed entries from athlete gamelog limited by `safeGames`.
  - `summaries`: ESPN event summaries fetched per selected game.

- Per-game output variables:
  - `eventId`, `gameDate`, `matchup`, `gameStatus`, `team`, `opponent`, `score`, `boxScore`, `plusMinus`.
  - Season tags: `seasonYear`, `seasonType`, `seasonTypeCode`.

- Plus-minus extraction:
  - Uses player boxscore groups to find `plusMinus` column by key.
  - Converts values like `+7` into numeric `7`.

- Rolling variables:
  - `rollingAverage` per game uses trailing window of 5 in impact aggregation.
  - Top-level `rollingAverage` is the latest trailing-window average over full plus-minus series.

- Aggregate variables:
  - `gamesPlayed`, `totalPlusMinus`, `averagePlusMinus`, `trend[]`.

### Player Comps Variable Map

- Candidate pool variables:
  - `optionIds`: ids from player directory options request.
  - `candidateIds`: unique set including target athlete and sampled options.
  - `snapshots`: lightweight overview snapshots for vectorization.

- Summary row selection for vectorization:
  - Preferred split labels: `Regular Season`, then `Career`.

- Feature vector dimensions:
  - `avgPoints`
  - `avgRebounds`
  - `avgAssists`
  - `fieldGoalPct`
  - `threePointPct`
  - `freeThrowPct`
  - `avgSteals`
  - `avgBlocks`
  - `avgTurnovers`
  - `avgMinutes`
  - `pointsPerMinute`
  - `efficiencyIndex`

- Derived vector fields:
  - `pointsPerMinute = avgPoints / avgMinutes` when `avgMinutes > 0`.
  - `efficiencyIndex = points + rebounds + assists + steals + blocks - turnovers`.

- Reliability variables:
  - `validCount`: count of finite vector dimensions.
  - Minimum target threshold: 4 valid dimensions.
  - If below threshold, returns empty comps with warning.

- Standardization variables:
  - For each dimension: `mean` and `std` computed across eligible sample vectors.
  - Z-score per dimension:
    - `z = (value - mean) / std`.
    - If value/mean/std invalid or `std=0`, the z-value is set to `0`.

- Similarity variables:
  - Cosine similarity between target z-vector and candidate z-vector:
    - `cos(theta) = (A dot B) / (||A|| * ||B||)`.
  - Same-split enforcement:
    - Candidate players are only compared when their vector source split bucket matches the target split bucket.
    - Split bucket examples: `regular`, `postseason`, `career`.
    - If target is Regular Season, Career-only candidate vectors are excluded from scoring.
  - Stability smoothing is applied to reduce volatility from tiny samples:
    - `gameFactor = clamp(gamesPlayed / 25, 0, 1)`.
    - `minutesFactor = clamp(avgMinutes / 28, 0, 1)`.
    - `sampleStability = 0.35 + 0.65 * (0.7 * gameFactor + 0.3 * minutesFactor)`.
    - `similarityScore = cosineSimilarity * sampleStability`.
  - `similarityScore` rounded to 4 decimals.
  - Non-finite scores are dropped.
  - Results sorted descending and sliced to `safeLimit`.

- Enrichment variables for top comps:
  - Enriches `displayName`, `team`, `teamAbbreviation`, `position`, `headshot` using core athlete profile and teams index.

- Output variables:
  - `athleteId`, `splitRequested`, `comparedAgainst`, `sampleSizeRequested`, `limit`, `sourceSplit`, `comps[]`, `lastUpdatedAt`, `_cache`.
  - `comparedAgainst` reflects only candidates from the same split bucket as the target.
  - Each comp row also includes:
    - `sampleStability` (0.35 to 1.0 reliability factor used in score adjustment).
    - `gamesPlayed` (from the split used for comparison, when available).

### Player Trajectory Variable Map

- Input control variables:
  - `gamesRequested` comes from `safeGames`.
  - `window` comes from `safeWindow`.

- Source data variables:
  - Uses trend rows returned by player impact service.
  - Pulls raw stat values from `boxScore.byKey`.

- Per-game raw metrics:
  - `points`, `rebounds`, `assists`, `steals`, `blocks`, `turnovers`, `minutes`, `plusMinus`, `trueShootingPct`.

- True shooting derivation:
  - `TS% = points / (2 * (FGA + 0.44 * FTA)) * 100`.
  - `FGA` and `FTA` are parsed from made-attempted strings.
  - Null when denominator is invalid.

- Rolling metrics:
  - Rolling averages computed for `points`, `assists`, `rebounds`, `trueShootingPct`.
  - For each index, rolling uses trailing `window` slice up to current game.

- Trend direction variables:
  - `trendDirection.points`
  - `trendDirection.assists`
  - `trendDirection.rebounds`
  - `trendDirection.trueShootingPct`

- Trend direction rule:
  - `delta = endRollingValue - startRollingValue`.
  - `up` when `delta > 0.3`.
  - `down` when `delta < -0.3`.
  - `flat` otherwise.

- Important distinction:
  - `recent games` controls how many games are included.
  - `rolling window` controls how many games are averaged per trajectory point.

### Team Efficiency Variable Map

- Event selection variables:
  - Builds schedule set by `seasonType`:
    - `regular` uses regular season schedule.
    - `postseason` uses postseason schedule.
    - `all` merges both.
  - Keeps completed events only.
  - Uses newest `safeGames` completed events.
  - Falls back to prior season when no events are available.

- Per-game extracted variables:
  - `pointsScored`, `pointsAllowed`.
  - Team possession inputs from team boxscore stats:
    - `fga`, `oreb`, `tov`, `fta`.

- Efficiency derivations:
  - `possessions = FGA - OREB + TOV + 0.44 * FTA`.
  - `offRtg = (pointsScored / possessions) * 100`.
  - `defRtg = (pointsAllowed / possessions) * 100`.
  - `netRtg = offRtg - defRtg`.

- Per-game output variables:
  - `matchup`, `status`, `team`, `opponent`, `score`, `teamStats`, `opponentStats`, `boxScore`, plus efficiency fields.

- Aggregate output variables:
  - `aggregate.pointsScored`.
  - `aggregate.pointsAllowed`.
  - `aggregate.possessions`.
  - `aggregate.offRtg`, `aggregate.defRtg`, `aggregate.netRtg`.

- Season coverage variables:
  - `seasonsCovered` and `seasonTypesCovered` from included games.

### Team Need Gap Variable Map

- Baseline variables:
  - `benchmarkTeamsCount` is number of teams with valid efficiency rows used in league baseline.
  - `leagueAverage` includes averaged and rounded values for:
    - `pointsScored`, `pointsAllowed`, `possessions`, `offRtg`, `defRtg`, `netRtg`.

- Target aggregate variables:
  - `teamAggregate` has the same six fields as `leagueAverage`, rounded.

- Delta derivations:
  - `offRtg delta = team.offRtg - league.offRtg`.
  - `netRtg delta = team.netRtg - league.netRtg`.
  - `defRtg delta = league.defRtg - team.defRtg` (inverted so positive is better defense).
  - `pointsScored delta = team.pointsScored - league.pointsScored`.
  - `pointsAllowed delta = league.pointsAllowed - team.pointsAllowed` (inverted so positive is better defense).
  - `possessions delta = team.possessions - league.possessions`.

- Signal classification variables:
  - `status` by metric:
    - `above_league_avg` if delta > 0
    - `below_league_avg` if delta < 0
    - `at_league_avg` if delta = 0

- Ranked outputs:
  - `strengths`: top 3 positive deltas.
  - `gaps`: top 3 negative deltas.

### Season Metadata Variables

- `seasonTypeCode` mapping:
  - `2 -> regular`
  - `3 -> postseason`

- `seasonYear`, `seasonType`, and `seasonTypeCode` are extracted from event summary season metadata with fallback to schedule/game season metadata.

### Player Options And Teams Search Variables

- Player options:
  - `query` is normalized with trim + lowercase for filtering.
  - Matching is substring on concatenated `id + label`.
  - Output includes `query`, `count`, `options`, `sourceCount`, `lastUpdatedAt`, `_cache`.

- Teams search:
  - `query` is normalized with trim + lowercase for filtering.
  - Matching checks team name/abbreviation/location fields.
  - Output includes `query`, `count`, `teams`, `lastUpdatedAt`, `_cache`.

### Error Envelope Variables

- Success responses:
  - `{ "success": true, "data": ... }`

- Not found responses:
  - `{ "success": false, "error": { "message", "path" } }`

- Error handler responses:
  - `{ "success": false, "error": { "message", "statusCode", "upstreamUrl" } }`

- Upstream error behavior:
  - If ESPN returns HTTP status, backend preserves that status in error object.
  - Network-level ESPN failures are surfaced as `502`.

### Internal Utility Variables Worth Knowing

- `mapWithConcurrency(items, worker, concurrency)`:
  - Used in heavy fan-out tasks.
  - Keeps bounded parallelism and fail-soft behavior for individual task errors.

- `roundNullable(value, decimals)`:
  - Returns rounded number or `null` if non-finite.

- `toNumber`, `safeNumber`, `toNumeric` patterns:
  - Convert values to numeric safely.
  - Return `null` when conversion is invalid.

- `parseMadeAttempted("X-Y")` pattern:
  - Used for shooting stats extraction.
  - Returns object with `made` and `attempted` numbers or null components.

## Caching

This service currently uses in-memory caching.

- Cache survives per running process only.
- Cache resets on server restart.
- Use `forceRefresh=true` to bypass cache for a request.

## Project Structure

- `app.js`: Express app and middleware wiring.
- `server.js`: HTTP server startup.
- `routes/`: API route definitions.
- `controllers/`: validation and request handling.
- `services/espn/`: ESPN API clients.
- `services/aggregation/`: analytics and merged payload shaping.
- `services/analytics/`: calculation helpers.
- `utils/reshape.js`: player normalization contract.
- `cache/`: in-memory cache implementation.

## Local Development

```bash
npm install
npm run dev
```

Default port is `5000`.

## Known Scope Limits

- Five-man lineup net rating is out of scope with current ESPN public payloads because possession-level on-court lineup tracking is not provided.
- Upstream ESPN payload shape can change; normalization logic is the primary adaptation layer.
