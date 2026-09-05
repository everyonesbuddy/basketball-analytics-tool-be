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

`GET /api/players/:athleteId/usage-value`

- Benchmarks player production against league peers in the same usage-rate bucket.
- Uses regular-season eligible sample (`minGames`, `minMinutes`) and z-score classification.
- Usage is sourced from ESPN usage fields when available; otherwise a core-statistics usage-load proxy is derived from FGA, FTA, AST, TO, and MIN.
- Optional query: `forceRefresh=true`.

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

`GET /api/teams/:teamId/grade?games=5&seasonType=regular`

- Returns a recent team grade normalized against the league using offensive
  rating, defensive rating, net rating, and recent win rate.
- `games` controls the recent completed-game sample and is clamped to `1-15`.
- `seasonType` supports `regular`, `postseason`, and `all`.
- The grade is a relative snapshot for the requested sample, not a permanent
  team quality label.

`GET /api/teams/compare/head-to-head?teamAId=17&teamBId=20&games=5&seasonType=regular`

- Compares two teams across the same four metrics used by team grading.
- Returns each team's aggregate efficiency and grade, per-metric advantages,
  and an overall `teamA`, `teamB`, or `tie` result.
- `teamAId` and `teamBId` must be positive, different team ids.

Team grade scoring is relative to the available league sample. Higher offensive
rating, net rating, and win rate are better; lower defensive rating is better.
The weighted score is `netRtg 40%`, `offRtg 25%`, `defRtg 25%`, and `winRate 10%`.
Each metric is standardized against the league mean and standard deviation, then
mapped to a bounded 0-100 score and letter grade: `A >= 85`, `B >= 70`,
`C >= 55`, `D >= 40`, otherwise `F`.

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

## Player Usage Value Output

Player usage value output includes:

- `athleteId`
- `splitUsed` (currently `Regular Season`)
- `usagePct`, `usageBucket`
- `expectedProduction`, `actualProduction`
- `zScore`, `status`
- `bucketSampleSize`
- `gamesPlayed`, `avgMinutes`
- `sourceSplit`
- `actionableStats` (actual vs expected ranges for tracked raw stats)
- `expectedStatRanges` (bucket-level expected means/ranges for points, rebounds, assists, steals, blocks, turnovers, efficiencyIndex)
- `decisionInsights` (summary + GM/coach action suggestions)
- `benchmarkContext` (sample and bucket construction settings)
- `warning` when classification cannot be produced
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

- `GET /api/players/:athleteId/usage-value`
  - Path: `athleteId`.
  - Query: `forceRefresh`.

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
  - Usage-value baseline: `usage-value:baseline:v3:...` (20 minutes).
  - Usage-value player result: `usage-value:player:v3:{athleteId}` (5 minutes).
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

### Player Usage Value Variable Map

- Sample eligibility variables:
  - `minGames` (default 15)
  - `minMinutes` (default 10)
  - `splitUsed` (current implementation uses `Regular Season` rows)

- Usage derivation variables:
  - `usagePct` prefers direct usage aliases (`usageRate`, `usagePct`, `USG`) when present and positive.
  - If direct usage is missing/zero, fallback derives usage load from core stats:
    - `usageLoad = ((FGA + 0.44 * FTA + 0.33 * AST + TO) * 40) / MIN`.

- Bucket construction variables:
  - `bucketWidth = 5` usage-percentage points.
  - Initial buckets are usage ranges like `10-15`, `15-20`, etc.
  - Sparse buckets are merged until each merged bucket reaches `minBucketSize` (default 20) where possible.

- Production benchmark variables:
  - `actualProduction` uses `efficiencyIndex`:
    - `efficiencyIndex = points + rebounds + assists + steals + blocks - turnovers`.
  - `expectedProduction` is bucket mean of `efficiencyIndex`.
  - `zScore = (actualProduction - expectedProduction) / bucketStdDev`.

- Actionable stat benchmark variables:
  - `expectedStatRanges` are computed per usage bucket for:
    - `points`, `rebounds`, `assists`, `steals`, `blocks`, `turnovers`, `efficiencyIndex`.
  - Each stat includes:
    - `expectedMean`
    - `stdDev`
    - `expectedRange.low` and `expectedRange.high` (mean +/- 1 std dev).
  - `actionableStats` adds player-level comparison for each tracked stat:
    - `actual`, `expectedMean`, `expectedRange`, `deltaFromMean`, `signal`.
  - `signal` semantics:
    - `better_than_expected`, `within_expected_range`, `worse_than_expected`.
    - For `turnovers`, lower values are treated as better.

- Classification variable:
  - `status = above_expected_range` when `zScore > 1`.
  - `status = below_expected_range` when `zScore < -1`.
  - `status = in_expected_range` otherwise.

- Decision insight variables:
  - `decisionInsights.summary` gives the high-level usage-adjusted value read.
  - `decisionInsights.gm[]` gives roster/role strategy suggestions.
  - `decisionInsights.coach[]` gives on-court adjustment suggestions tied to stat signals.

- Output context variables:
  - `usagePct`, `usageBucket`, `bucketSampleSize`.
  - `benchmarkContext` returns sample and bucket settings used for the benchmark.

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

## NFL Fantasy Tools

The NFL fantasy API uses ESPN's public `kona_player_info` data through the
`lm-api-reads.fantasy.espn.com` reads host. It is unauthenticated and uses ESPN
projections, public ownership, and public ADP data. All NFL fantasy routes are
mounted under `/api/fantasy`.

### Common Fantasy Inputs

- `scoringId` selects the scoring format used when ESPN calculates fantasy
  projections:
  - `1`: Standard
  - `3`: PPR (default)
  - `4`: Half-PPR
- `season` is the ESPN fantasy season year. When omitted, the backend uses
  ESPN's authoritative active fantasy season rather than a calendar guess.
- `forceRefresh=true` bypasses the process-local cache.
- `teamCount` and `starters` affect replacement-level calculations for the
  draft board and trade analyzer. Defaults are a 12-team league with
  `QB:1,RB:2,WR:2,TE:1,FLEX:1,K:1,DST:1`.
- `starters` is serialized as a comma-separated query value, for example:
  `QB:1,RB:2,WR:2,TE:1,FLEX:1,K:1,DST:1`.

The frontend must refetch a feature when its relevant settings change. In
particular, PPR results must not be reused after a user changes to Standard or
Half-PPR.

### Fantasy Season State

`GET /api/fantasy/season`

Returns the current ESPN fantasy season and current scoring period:

```json
{
  "success": true,
  "data": {
    "season": 2026,
    "active": true,
    "currentScoringPeriod": 1,
    "startDate": "2026-03-25T07:00:00.000Z"
  }
}
```

Use this endpoint at application startup to set default season context and to
decide whether draft or in-season tools are currently actionable.

### VORP Draft Board

`GET /api/fantasy/draft-board?scoringId=3&teamCount=12&starters=QB:1,RB:2,WR:2,TE:1,FLEX:1,K:1,DST:1`

Optional query values:

- `position=QB|RB|WR|TE|K|DST|FLEX`
- `rosterSoFar=4429795,4426515` (comma-separated ESPN player IDs to exclude)
- `season`
- `forceRefresh`

The board ranks players by value over replacement player (VORP), not raw
projected points:

```text
VORP = projectedTotal - replacementBaseline
```

The replacement baseline is the projected total of the player at the replacement
rank for each position. That rank is derived from league size, required starters,
and FLEX allocation. This prevents raw QB projections from incorrectly
dominating RB/WR draft recommendations.

Important response fields:

- `tierMetric`: always `vorp`; tier `high`, `low`, `mean`, and `stdDev` values
  use VORP, not fantasy points.
- `replacementBaselines`: per-position replacement rank, player, and projected
  total used for calculations.
- Candidate `vorp`: projected value above replacement; higher is better.
- Candidate `vorpRank`: overall rank by VORP among available players.
- Candidate `tier`: natural-break VORP tier; a tier drop indicates scarcity.
- Candidate `projectedTotal`: ESPN full-season projected fantasy points.

Use VORP and tiers as the primary draft UI. Keep `projectedTotal` as supporting
context. Re-query with `rosterSoFar` as players are drafted so available tiers
and rankings reflect the live board.

### Sleepers / Draft Values

`GET /api/fantasy/sleepers?scoringId=3&season=2026`

This is a draft-season feature. It compares ESPN ADP rank to projection rank
within each position, then standardizes that gap among positional peers:

```text
adpDelta = positional ADP rank - positional projection rank
sleeperScore = z-score of adpDelta within the position
```

Positive `adpDelta` and positive `sleeperScore` indicate a player ESPN projects
better than their draft cost. Show this as a draft-value signal, not a guarantee.

When ESPN no longer supplies usable ADP (normally after drafts), the API excludes
placeholder ADP values and may return zero evaluated players. The frontend should
show a draft-values-unavailable state instead of an error.

### Trade Analyzer

`GET /api/fantasy/trades/analyze?sideA=4429795,4426515&sideB=4362628&scoringId=3&teamCount=12&starters=QB:1,RB:2,WR:2,TE:1,FLEX:1,K:1,DST:1`

Required query values:

- `sideA`: comma-separated ESPN player IDs.
- `sideB`: comma-separated ESPN player IDs.

The analyzer applies the same league-aware VORP baselines as the draft board,
sums VORP on both sides, and returns:

- `sideA.totalVorp`, `sideB.totalVorp`: summed player VORP.
- `netVorpToA`: `sideB.totalVorp - sideA.totalVorp`.
- `verdict`: `balanced`, `slight_edge`, or `clear_edge`.
- `byPosition`: each side's VORP contribution by position.
- `missingPlayerIds`: requested IDs not present in the available player pool.

The UI should make the side convention explicit, such as “You Give” and “You
Receive.” Present VORP totals and positional breakdown together; a verdict alone
does not capture roster construction needs.

### Fantasy Roster Head-to-Head

`GET /api/fantasy/compare/head-to-head?rosterA=4429795,4362628&rosterB=4430807,4360310&scoringId=3&teamCount=12&starters=QB:1,RB:2,WR:2,TE:1,FLEX:1,K:1,DST:1`

- Compares two complete fantasy rosters, not individual players.
- `rosterA` and `rosterB` are comma-separated ESPN fantasy player IDs.
- Selects the best starting lineup from each roster using the configured per-team
  starter slots, then compares starter VORP and lineup coverage.
- Returns each roster's full players, suggested starters, starter VORP, position
  breakdown, missing IDs, and the overall `rosterA`, `rosterB`, or `tie` result.
- This is projected roster value, not a game matchup win probability.

Use visible UI labels such as “Your roster” and “Opponent roster.” The endpoint is
useful for comparing fantasy teams, dynasty roster strength, and hypothetical
lineups. `teamCount` affects league-wide VORP replacement baselines; starter slots
determine which players are selected from each individual roster.

### Fantasy Player Head-to-Head

`GET /api/fantasy/compare/players?playerAId=4429795&playerBId=4362628&scoringId=3&teamCount=12&starters=QB:1,RB:2,WR:2,TE:1,FLEX:1,K:1,DST:1`

Use this route when the UI needs to compare two individual players. It returns
projected points, VORP, ADP, projected positional rank, actual totals, and
projected/actual key stats for both players.

The comparison is useful for draft decisions, waiver choices, lineup choices, and
trade discussions. VORP is the primary cross-position value signal; raw projected
points and ADP provide supporting context.

### Fantasy Team / Roster Grade

`GET /api/fantasy/team-grade?roster=4429795,4362628,4430807,4360310,3116365,4869461,-16024&scoringId=3&teamCount=12&starters=QB:1,RB:2,WR:2,TE:1,FLEX:1,K:1,DST:1`

- `roster` is a required comma-separated list of ESPN fantasy player IDs.
- Uses the selected scoring format and league settings.
- Selects the best possible starting lineup from the submitted roster using the
  per-team starter slots. `teamCount` is used only for league-wide VORP
  replacement baselines.
- `valueScore` measures the roster's selected-starter quality relative to the
  league's positional starter/replacement ranges. It no longer divides by the
  absolute best lineup in the entire player pool, which made realistic A grades
  effectively impossible.
- `marketScore` measures how strongly the roster's starters are valued by current
  public ADP relative to each position's replacement rank. It is the available
  market signal, not private league draft history.
- `coverageScore` measures how much of the configured lineup the roster can fill.
- When usable ADP exists, the final score weights league-relative starter value `50%`, public ADP
  market value `25%`, and lineup coverage `25%`.
- When ADP is unavailable or placeholder-only, the final score falls back to
  starter VORP `70%` and lineup coverage `30%`.
- Returns `grade` (`A` through `F`), `score`, `suggestedStarters`, roster player
  details, `missingStarterSlots`, replacement baselines, and missing IDs.

`valueScore` maps a player at replacement level to approximately 50 and elite
players toward 100 within each position. This makes the score league-relative:
an 8-team roster is judged against 8-team starter demand, not against the top
three players at every position.

Use this as a roster-construction snapshot, not a prediction of wins or an exact
copy of ESPN's proprietary draft grade. ESPN's grade may use private league draft
history and internal ranking logic; this API uses public ESPN ADP, projections,
league size, starter slots, and VORP. A roster with elite players but missing
required positions can still score lower because coverage is part of the grade.
Recalculate after roster changes or when scoring/league settings change.

### Waiver Wire

`GET /api/fantasy/waivers?scoringId=3&ownershipMax=50&window=4`

Optional query values:

- `ownershipMax`: maximum public ESPN ownership percentage, default `50`.
- `window`: recent completed-game sample, default `4`, allowed `2-10`.

The waiver tool requires at least two actual games and ranks eligible players by:

```text
recentForm.deltaFromProjection = recent actual average - recent projected average
```

Use it to identify lower-owned players outperforming ESPN expectations. Pair a
positive delta with `ownershipPct` and `recentForm.standardDeviation`: high delta
signals a breakout, while lower standard deviation indicates a steadier profile.

Before enough games are complete, `status` is `insufficient_sample` with an empty
candidate array. This is expected and should render as an informative empty state.

### Consistency Leaders

`GET /api/fantasy/consistency?scoringId=3&window=4`

This feature requires at least three completed games. It ranks recent floor using:

```text
consistencyScore = recent actual average - weekly standard deviation
```

Higher scores indicate players combining recent production with lower volatility.
Use this for floor-sensitive lineup decisions, not as a ceiling ranking. Show
`actualAverage`, `standardDeviation`, and `consistencyScore` together.

### Start / Sit

`GET /api/fantasy/start-sit?playerIds=4429795,4426515&scoringId=3&window=4`

Required query value:

- `playerIds`: comma-separated ESPN player IDs.

For each player, the API combines ESPN's next scoring-period projection with
recent actual weekly results. The recommendation is:

- `start`: enough actual-game sample and recent form is at or above projection.
- `consider_sit`: enough sample but recent form is below projection.
- `insufficient_sample`: fewer than two actual games.
- `no_upcoming_projection`: ESPN has no next-week projection, such as after a
  completed season.

The UI should prioritize `nextProjection`, then show `recentForm.actualAverage`,
`recentForm.deltaFromProjection`, and recent weekly history. These
recommendations do not yet include opponent matchups, weather, or late injury
news.

### Fantasy Player Data Contract

The normalized fantasy player contract distinguishes projections from actuals:

```json
{
  "projectedTotal": 364.87,
  "actualTotal": null,
  "keyStats": {
    "projected": {
      "rushAttempts": 283.1,
      "rushingYards": 1372.6,
      "rushingTouchdowns": 14.5
    },
    "actual": null
  }
}
```

- All `projected*` values and `keyStats.projected` are ESPN expectations for the
  selected season and scoring format. Fractional volume or touchdown values are
  normal projections.
- `actual*` values and `keyStats.actual` are completed-game production. They are
  `null` before the player has real production, rather than a misleading zero.
- `weeklySplits[]` holds both weekly actual and projected scoring values. Use
  `isProjection` to distinguish them.
- `adpIsPlaceholder=true` means ESPN's ADP is not actionable and should be hidden
  from draft-value UI.
- Friendly `keyStats` are available for QB/RB/WR/TE. Kicker and D/ST friendly
  stat maps are currently `null`; their source maps remain in `rawStats`.

### Fantasy Cache Behavior

- Normalized player pool: 15 minutes.
- Draft board: 5 minutes.
- Trade analyzer: 5 minutes.
- Sleepers: 10 minutes.
- Season state: 15 minutes.
- Waiver and consistency results: 5 minutes.

Use `forceRefresh=true` only for an explicit user refresh or debugging; normal UI
navigation should rely on cached responses.

Default port is `5000`.
