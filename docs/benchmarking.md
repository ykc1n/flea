# Replay processing benchmarks

Recorded baseline: [October 16, 2026 Windows results](benchmark-results-2026-10-16.md).

The current runner uses an exporter-only widget profile and 60-second position
sampling. The recorded baseline predates those changes; do not mix the two
profiles when comparing repeated runs.

On Windows, run `npm run benchmark`. Defaults are battle 2524251 (a verified duel)
and 2525057 (a larger team match), twice each, sequentially. This is real engine
execution, not a synthetic load generator. It does not change the running site's
database or your personal Zero-K installation.

Each invocation creates `data/benchmarks/<timestamp>/`, with its own dependency
cache, per-case SQLite databases, engine logs, JSON results, and CSV resource
samples. New runs also retain raw telemetry before validation so rejected exports
remain diagnosable. Battle metadata is fetched from Zero-K before each case. The default
first case starts with an empty cache; later cases reuse that session's cache.
Successful repeats redownload the small replay and invoke the content downloader.
A failed attempt may retain its replay for the next case; replayAlreadyCached and
the presence or absence of replayDownload timing identify that reuse.

To reuse existing downloaded dependencies without changing their source:

```powershell
npm run benchmark -- -SeedCache 'C:\path\to\existing\Flea\zero-k'
```

The seed directory's engine, games, maps, packages, pool, and rapid directories
are copied. Personal lobby configuration and widgets are excluded. Seed copying
is outside measured case times. A seeded run is not a cold-download benchmark.
Default exact-engine cache layout is Flea's hashed version directories; a personal
lobby's differently arranged engine directories may be downloaded again.

For custom replay IDs, build once and invoke the sampler directly:

```powershell
npm run build
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& ./scripts/benchmark.ps1 -BattleIds 2524251,2525057 -Repeats 2"
```

Read `results.json` for stage timings (metadata, replay download, dependency
acquisition, engine, and whole pipeline), actual simulated duration, completed
units, full-view validation, cache size/growth, and resource measurements.
An engine speed ratio of 10 means ten simulated seconds per wall-clock second.
Stage `engine` includes native process startup, engine execution, and export copy;
validation/publication occurs afterward within `pipeline`. Durations exclude the
final recursive cache measurement and initial seed copy. Disk growth measures
retained bytes, not network transfer or maximum temporary disk usage.

Memory is sampled across the benchmark Node process and all discovered descendant
processes, including the engine, downloader and process owner. The CSV also
records the engine's OS-reported lifetime peak working set. Tree working sets can
double-count shared memory; private bytes are a separate estimate of committed
private memory. Samples default to one second plus collection overhead. Short
processes and brief peaks can be missed, and sampled CPU time is a lower bound.
The PowerShell sampler itself is excluded from measured tree resources but adds
some host load. Run while other heavy applications are idle for comparable data.

These are Windows measurements on this PC. They do not establish Linux hosting
compatibility, minimum memory, or throughput on a shared cloud CPU. Hosting
estimates should include acquisition, startup, validation, uploads, and retries,
and should not equate simulated match duration with processing time.

The engine runner uses local-only replay playback (no replay-server listening
socket), an exclusive settings file, and an isolated data directory. Engine base
assets are copied from the exact acquired version into that directory so the
isolated scanner can load them. This allows benchmarking alongside a live worker
without sharing its replay port or depending on personal lobby settings. CPU and
memory contention with that worker can still affect measurements.
