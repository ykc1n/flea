# flea

A Zero-K replay explorer with hourly discovery, durable oldest-first processing,
and engine-derived match timelines. Runs directly on Windows and Linux x64.
Node.js 22.16 or newer is required. Native hosting does not require Docker.
An optional [Cloud Run Jobs worker](docs/cloud-run.md) uses a container built by
Google Cloud Build, with private Cloud Storage results.

Windows resource benchmarks: `npm run benchmark`. See [benchmarking](docs/benchmarking.md)
for replay selection, warm-cache runs, and measurement limitations.

## Run

~~~sh
npm ci
npm run build
npm run host
~~~

Open http://127.0.0.1:8080. The host supervises the browser and worker, with
rotating logs under data/logs. Alternatively run npm run server and npm run worker
separately. The worker discovers up to three recent listing pages every hour;
use npm run worker -- --pages N to change that bounded window, or --once for a
single discovery and drain of currently eligible work. Discovery continues during
analysis. An explicitly empty FLEA_PROCESSOR disables analysis for metadata-only use.

Every discovered Battle is browsable immediately. Waiting Replays show their
metadata and source/download links. Blocked Replays show a red explanatory notice.
Only complete, explicitly full-spectator-view Telemetry becomes ready. The archive
searches metadata (including players, maps, and Battle IDs), not raw Telemetry.
Archive listings are paginated without loading full analyses.

Use npm run demo for clearly labeled synthetic demonstration data. Real Battle
metadata is never supplemented with invented Telemetry.

## Automatic engine and content acquisition

Flea obtains the Replay's exact engine archive from Zero-K's engine distribution.
It uses the pr-downloader executable included in that archive to acquire the
requested game, map, and dependencies. Rapid's individual-file mode is used with
TLS certificate checking enabled. No newer engine or game is silently substituted.
Missing content or incompatible historical binaries block only the affected job.

The dedicated write directory defaults to data/zero-k, inside FLEA_DATA.
Never point this at a personal Zero-K installation. Flea installs its original
LuaUI exporter and an exporter-only widget profile there. Optional model
preloading, texture-memory preallocation, sound, and presentation effects are
disabled. The exact game's simulation and required game rules remain enabled.
Profiles are refreshed before each replay; personal lobby settings are untouched.
Positions are sampled every 60 simulated seconds; unit lifecycle and factory
events retain their exact simulation timestamps. Sampling cadence is stored in
telemetry metadata, so existing five-second analyses still display correctly.
Downloaded executables run
as the worker's user: use a dedicated unprivileged account for public hosting.
Linux hosts must supply the shared libraries required by their matching engine;
loader failures remain blocked with private diagnostic logs.

Only one analysis runs at a time. Jobs sort by Battle start time, then Battle ID.
The recorded UTC timestamp in Replay filenames supplies absolute chronology
where the archive displays relative dates; missing/unparseable dates sort last by ID.

Acquisition retries after 5 minutes, then 30 minutes, then every 6 hours.
Acquisition failures do not consume processing attempts. Transient processing
failures retry after one minute, up to three attempts. Invalid exports and
exhausted processing require an explicit operator retry:

~~~sh
npm run requeue -- 2524251
~~~

Engine ownership is recorded before execution. Windows uses Job Objects with
atomic child association and confirmed empty-job cleanup; Linux uses an owned
process group. Custom processors must not daemonize or escape that Linux group.
Timeout and cancellation terminate the owned processes; restart verifies the persisted owner's identity before
terminating it. Partial exports are discarded. Full engine logs stay private in
data/jobs/<battle-id>; public responses contain readable explanations only.

The runner can also use a custom FLEA_PROCESSOR JSON argv array, executed without
a shell. Placeholders: {id}, {replay}, {output}, {work}, {engine}, {game}.
The command must block, exit successfully, and produce JSONL at {output}.
Required evidence includes one meta record with positive map dimensions and
fullView:true, valid identities for player/unit events, nonnegative event times,
and a final game_over record. The original exporter is worker/flea_export.lua.
Ingestion is limited to 64 MB, 500,000 records, and 65,536 characters per line.

## Storage

Defaults: 50 GB managed data budget and 5 GB free host space reserve, measured in
decimal bytes. Acquisition pauses visibly at the budget or below the reserve.
In-process transfers check space while writing; external downloader/engine writes
are monitored periodically and terminated on pressure, so native buffered writes
can briefly exceed a configured threshold. Keep the free-space reserve.

Validated analysis is saved before downloaded Replay and raw export files are
deleted. Each job's diagnostic logs are capped at 1 MB and retained seven days.
Host logs rotate at about 1 MB per file. Published metadata and analysis are never
evicted. If cleanup cannot clear pressure, the entire idle dependency cache may
be evicted as one coherent set; active dependencies are protected. Cache content
is acquired again when needed.

## Native hosting

### Windows

~~~powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-hosting.ps1
~~~

This builds the app and registers Flea Replay Explorer for the current user at
sign-in. It starts immediately and supervises both processes. It does not start
before sign-in. Remove startup with deploy/windows/uninstall-hosting.ps1;
application data is preserved. Persist desired environment settings for the
sign-in user before installing.

### Linux

Install at /opt/flea, build with npm ci and npm run build, and create an
unprivileged flea user with write access to /opt/flea/data. Install the units in
deploy/ and configure /etc/flea.env as needed. Enable:

~~~sh
sudo systemctl enable --now flea-worker flea-web
~~~

Set both processes to use the same absolute FLEA_DB and FLEA_DATA. Retain the
systemd process-group cleanup behavior. Use a TLS reverse proxy for public
hosting; bindings default to localhost. Public mutation endpoints are absent.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| FLEA_DATA | data | Managed downloads, caches, jobs, logs |
| FLEA_DB | FLEA_DATA/flea.sqlite3 | Shared SQLite WAL database |
| FLEA_HOST | 127.0.0.1 | Browser bind address |
| FLEA_PORT | 8080 | Browser port |
| FLEA_ZK_ROOT | FLEA_DATA/zero-k | Dedicated cache inside managed data |
| FLEA_PROCESSOR | automatic acquisition and runner | Optional JSON argv override; empty disables |
| FLEA_PROCESS_TIMEOUT | 3600 | Processing deadline, seconds |
| FLEA_STORAGE_BYTES | 50000000000 | Managed storage budget |
| FLEA_RESERVE_BYTES | 5000000000 | Host free-space reserve |

Keep the database inside managed storage if its size should count toward the budget.

## Backup and restore

~~~sh
npm run backup -- create /absolute/path/flea-backup.sqlite
npm run backup -- restore /absolute/path/flea-backup.sqlite /new/path/flea.sqlite3
~~~

Backup uses SQLite's consistent online backup operation and includes metadata and
published Telemetry. Caches are intentionally excluded. Restore verifies database
integrity and refuses to overwrite an existing destination or WAL. Stop both
processes before switching FLEA_DB to the restored path; restart the worker to
recover interrupted jobs. Never copy a live SQLite database without its WAL.

## Verification

~~~sh
npm test
npm run verify -- 2524251
~~~

The verification command creates an independent data directory, acquires exact
dependencies, processes one real Replay, and prints identities, full-view evidence,
duration, production count, and first factories. It requires network access and
may download hundreds of MB. It refuses to overwrite an existing verification
directory. Rehearse interruption, restart, and restore on both native host platforms
before claiming release readiness. See docs/production-verification.md for actual
evidence and outstanding host-specific checks.

## Public requests

- GET /api/replays?q=&mode=&status=&offset=0: metadata/card summaries, 24 per page.
- GET /api/replays/<id>: metadata and full analysis when ready.
- GET /api/status: queue counts, active Replay, discovery and storage status.

## Sources and credits

[Zero-K battle archive](https://zero-k.info/Battles) supplies public metadata and
Replay downloads. The favicon is the [Flea portrait](https://github.com/ZeroK-RTS/Zero-K/blob/master/unitpics/spiderscout.png).
Artwork remains under [upstream licensing](https://github.com/ZeroK-RTS/Zero-K/blob/master/LICENSE).
[Gex](https://github.com/Varunda/gex) provided product inspiration;
[ZK Stats](https://github.com/esainane/zkstats) is a reference for engine-driven extraction.

Flea's original source is MIT licensed. Upstream artwork, binaries, and public
test fixtures retain their respective upstream licenses. Flea is independent of
and unaffiliated with the Zero-K team.
