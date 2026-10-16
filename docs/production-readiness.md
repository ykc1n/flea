# Production readiness decisions

These requirements were agreed during the implementation interview. Implementation
design and the final release gate still require a shared-understanding check.

## Product and deployment

- One operator runs a public, read-only replay explorer.
- Run directly on Windows and Linux; Docker is excluded. Share application logic
  and use platform-specific acquisition and process-control adapters where needed.
- A supported Node.js installation is a host prerequisite. Flea automatically
  acquires exact replay engines, games, maps, and their dependencies.
- Windows hosting starts at user sign-in through a scheduled task; launch does not
  require a Windows service or startup before sign-in. Retain Linux systemd hosting.
- Validate real replay execution and restart recovery natively on both hosts.
- Discover recent battles first; historical backfill is outside launch scope.
- Every discovered match is immediately browsable with metadata, regardless of
  whether analysis is available. Waiting analysis and blocked analysis are distinct.
- A blocked replay has a red frontend notice with an explanatory reason.

## Processing

- Process eligible matches oldest first by battle start time; battle ID breaks ties.
- No match scoring, rating acquisition for scheduling, or clustering at launch.
- Run one replay analysis at a time. Discovery and browsing continue independently.
- Ready requires a complete, validated export with explicit full spectator visibility.
- Automatically obtain exact replay engine, game, and map versions. Never silently
  substitute newer content. Validate an existing unattended downloader first and use
  Zero-K's existing acquisition mechanisms where necessary; the implementation
  choice remains pending that validation.
- Unavailable dependencies block the affected replay without stopping other jobs.
- Temporary acquisition failures retry after 5 minutes, then 30 minutes, then every
  6 hours. They do not consume processing attempts.
- Processing failures receive at most three attempts before remaining blocked.
- The operator can explicitly retry blocked work.
- After interruption, ensure the prior engine has terminated, discard partial
  exports, and retry under the processing attempt policy. Never publish a partial run.
- If an exact engine cannot run on the host, block that replay and continue
  processing compatible replays.

## Operations and recovery

- Provide a status view with the active replay, waiting and blocked counts, last
  successful discovery, managed disk usage, and acquisition pause reasons.
- Public errors are readable explanations. Detailed logs, internal paths, and
  command output remain operator-only.
- Document and test backup and restore for metadata and published analysis.
  Dependency caches are excluded from backups because they can be acquired again.

## Storage

- Configurable managed-storage budget, initially 50 GB.
- Pause acquisition when the budget is reached or free disk space falls below 5 GB.
- Clean disposable job files first; preserve published metadata and analysis.
- After validated analysis is saved, delete the downloaded replay and raw export;
  retain bounded diagnostic logs.
- Cache engines, maps, and games for reuse. Unused dependencies may be evicted;
  dependencies used by an active job cannot be evicted.

## Release evidence

- Process a known real replay and check its players and timeline.
- Interrupt processing, restart, and verify recovery without orphaned engines or
  corrupted results.
- Existing passing simulated-processor tests alone do not satisfy the release gate.
- Rehearse backup and restore before release.
