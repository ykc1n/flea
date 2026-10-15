# flea

A Zero-K replay explorer with hourly discovery, a durable processing queue, and engine-derived match timelines. The favicon is the [Flea unit portrait](https://github.com/ZeroK-RTS/Zero-K/blob/master/unitpics/spiderscout.png).

## Run locally

Python 3.11+; the web app and worker use only the Python standard library. No Node or package installation is needed.

```bash
python3 -m flea.server
# In a second terminal, from the same directory:
python3 -m flea.worker
```

Open **http://127.0.0.1:8080**. The worker discovers recent battles immediately and every hour thereafter. The default is three listing pages per discovery; use `--pages N` to change the bounded discovery window. `python3 -m flea.worker --once` performs one discovery and drains eligible jobs. Keep the worker running under the supplied systemd service for unattended hourly ingestion. Simply uploading this repository does not start a hosted service.

The archive starts empty. For an optional, explicitly labeled illustrative match that exercises the timeline and map controls:

```bash
python3 scripts/demo.py
```

Demo telemetry is synthetic, stored only in your local database, and labeled in the archive and match detail. Real battle metadata is never supplemented with invented telemetry.

## Features

- Replay archive with search, game-mode and processing-state filters, pagination, and source/download links.
- Battle maps, players, original rank badge identifiers, duration, game mode, game and engine versions.
- First completed factory per engine team, mapped to players by lobby ID or name.
- Completed unit production totals, construction/destruction events, and team elimination events.
- Filterable event timeline, event-to-time navigation, playback speed, JSON export, and sampled movement trails over the minimap.
- SQLite WAL storage, deduplicated discovery, persistent processing states, three bounded retries, worker singleton lock, and crash recovery.
- A pipeline view showing queue state, discovery errors, and processor configuration.

## Engine setup

**Replay analysis requires executing the replay in its matching Zero-K engine.** An `.sdfz` demo records simulation inputs; it is not a ready-made list of units and positions. Metadata discovery works without an engine; those replays remain queued until the processor is configured.

1. Install a dedicated Zero-K portable installation on your worker host. Provision the matching engine versions, game archives, maps, and required shared libraries. Use the game lobby/content tooling to obtain the assets for each replay. Flea does not automatically install arbitrary engine binaries or game content.
2. Run the installation once and enable **local widgets** in `LuaUI/Config/ZK_data.lua` (`["Local Widgets Config"] = { localWidgets = true, localWidgetsFirst = false }`). Ensure **Flea Replay Export** is enabled after the runner installs it. A headless engine must support LuaUI; a dedicated server binary without LuaUI will not export events.
3. Configure an engine-version-to-executable map and the argv-based runner, using absolute paths:

```bash
export FLEA_ZK_ROOT=/var/lib/flea/Zero-K
export FLEA_ENGINES='{"2026.07.04":"/var/lib/flea/Zero-K/engine/2026.07.04/spring-headless"}'
export FLEA_PROCESSOR='["python3","/opt/flea/scripts/run_engine.py","--replay","{replay}","--output","{output}","--engine","{engine}","--game","{game}"]'
python3 -m flea.worker
```

Adjust the paths and versions to your installed engine. These are configuration examples, not bundled executables. Each battle carries its required engine and game version. The replay selects its game archive; missing/incompatible content produces a failed job with a visible error. Run the web process with the same processor environment if you want the pipeline view to report it as configured.

`worker/flea_export.lua` is original code. It exports JSONL for metadata, player identities, unit creation/completion/destruction, team elimination, five-second movement samples, and a final `game_over` marker. Full spectator view is requested. `scripts/run_engine.py` copies the widget into the dedicated installation, runs the selected headless engine, and copies its export to the job directory. Only one worker may use a given database, and each deployment must use a dedicated game write directory. Keep this directory outside any personal game installation.

The analyzer rejects incomplete exports. First factory means the first **completed** factory; completed structures are included in production counts. Movement paths are sampled, not exact per-frame recordings. Rank identifiers are the original Zero-K badge values, not estimated Elo. Battle-page team numbers and engine team IDs are distinct and are joined through player identities. Automated mode classification uses the visible teams/player/bot metadata; unusual missions or custom modes may need a richer classifier.

**Verification limit:** metadata parsing has been checked against a real Zero-K battle page. Automated tests cover event aggregation and the worker using a simulated processor. A full real-engine replay has not been executed in the development environment; validate your headless installation and widget visibility against a known replay before relying on telemetry in production.

### Custom processor contract

`FLEA_PROCESSOR` is a JSON array of arguments, executed without a shell. Supported placeholders: `{id}`, `{replay}`, `{output}`, `{work}`, `{engine}`, `{game}`. The command must block until completion, exit successfully, and write JSONL to `{output}`. Required records:

```json
{"type":"meta","mapWidth":8192,"mapHeight":8192}
{"type":"player","team":0,"name":"Player","lobbyId":123}
{"type":"finished","time":25,"team":0,"unitId":42,"unit":"factoryspider","name":"Spider Factory","factory":true,"x":1024,"z":2048}
{"type":"position","time":30,"team":0,"unitId":43,"x":1100,"z":2100}
{"type":"game_over","time":900}
```

Also supported: `created`, `destroyed`, `team_died`. Event times are seconds. Positions use engine map coordinates. The final marker prevents partial/crashed exports being marked ready.

## Deployment

```bash
docker compose up --build -d
```

The supplied Compose configuration starts the browser and metadata discovery worker with shared persistent storage. For engine analysis, mount your dedicated Zero-K installation into the worker, install its runtime libraries in an extended image, and provide the processor environment above. The standard Python image intentionally does not contain a game engine. Bindings default to localhost; use a TLS reverse proxy for public hosting. There are no public mutation endpoints.

For a Linux host, install the app at `/opt/flea`, create a `flea` service user and writable `/opt/flea/data` and `/var/lib/flea/Zero-K` directories, configure `/etc/flea.env`, and install the units in `deploy/`. Enable with `systemctl enable --now flea-worker flea-web`. The worker itself schedules hourly discovery; no extra cron job is needed. Logs go to the systemd journal, with per-job engine logs under `data/jobs/<battle-id>/processor.log`.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `FLEA_DB` | `data/flea.sqlite3` | Shared SQLite database |
| `FLEA_DATA` | `data` | Download/job directory |
| `FLEA_PROCESSOR` | unset | JSON argv array for analysis |
| `FLEA_PROCESS_TIMEOUT` | `3600` | Maximum processor duration in seconds |
| `FLEA_ZK_ROOT` | unset | Dedicated writable Zero-K install |
| `FLEA_ENGINES` | `{}` | Installed version-to-executable JSON mapping |

Failed jobs retry at most three times. After fixing a content/setup issue, requeue one battle with:

```bash
python3 scripts/requeue.py 2524251
```

Use an independent database and Zero-K write directory for a second deployment. Back up SQLite with its backup API or stop both services before copying the database; preserve the WAL if copying live files.

## API

- `GET /api/replays?q=&mode=&status=&offset=0` — up to 24 results plus total.
- `GET /api/replays/<id>` — replay metadata and full analysis, or `null` analysis while queued.
- `GET /api/status` — counts, last discovery, latest scrape error, configuration state.

## Validation

```bash
python3 -m unittest discover -s tests -v
node --check web/app.js  # optional local JS syntax check; also runs in CI
```

Tests use public battle-page fixtures and simulated engine output. They verify real metadata extraction, deduplication, state preservation, first factory and production aggregation, movement samples, incomplete exports, successful processing, retry limits, and an unconfigured worker.

## Sources and credits

- [Zero-K battle archive](https://zero-k.info/Battles): replay metadata, ranks, minimaps, demo downloads.
- [Zero-K](https://github.com/ZeroK-RTS/Zero-K): Flea portrait and game. Artwork remains under its upstream license; see [upstream licensing](https://github.com/ZeroK-RTS/Zero-K/blob/master/LICENSE).
- [Gex](https://github.com/Varunda/gex) and the [provided match timeline](https://gex.honu.pw/match/60f7cf6a6cc93fb2be4b7ce4dbf84436): product inspiration.
- [ZK Stats](https://github.com/esainane/zkstats): reference for engine-driven replay extraction. No code copied.

Flea's original source is MIT licensed. Upstream artwork and public test fixtures are excluded from that grant. Flea is an independent community tool and is not affiliated with the Zero-K team.
