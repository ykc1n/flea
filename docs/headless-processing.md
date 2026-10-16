# Minimal replay processing profile

The native runner refreshes `worker/headless-settings.cfg` and
`worker/headless-config.lua` into its isolated write directory for every replay.
It does not edit the operator's personal Zero-K installation.

The engine profile disables optional model preloading, the texture bitmap memory
pool, sound, shadows, grass, and presentation particles. Required models may
still load on demand. The matching game's simulation, LuaRules, LuaGaia, and
required engine assets remain enabled; this is not a replacement simulation.

Zero-K loads its local widget configuration before enumerating widgets. The
profile temporarily restricts that enumeration to `flea_export.lua`, then restores
the normal directory-list function. This retains the game's call-in dispatcher
without loading Chili, effects, camera controls, or other game widgets. It also
disables automatic mod widget activation and resets persisted widget order.
The configuration is refreshed because Zero-K rewrites it at shutdown.

This startup integration was checked against the actual acquired Zero-K
v1.14.10.3 package. Future games that change their widget loader need fresh
verification. The profile does not enable engine Lua developer mode or modify
the replay's recorded simulation settings.

Positions are recorded at frame zero and every 60 simulated seconds. Creation,
completion, destruction, factory, and end-of-game events retain exact timestamps.
The exporter writes `positionSampleSeconds: 60` into its metadata. The browser
uses this cadence for its position labels and marker/trail lifetime, falling back
to the original five-second behavior for older stored analyses.

## Real replay verification

Windows benchmark `data/benchmarks/20261016-135027/`, battle 2524251:

- Only `Flea Replay Export` appeared in the loaded-widget log.
- Export validated full view, 405 completed units, and 1,063.40002 simulated
  seconds, matching the earlier baseline.
- Both first factories and their timestamps matched the baseline exactly.
- Movement records fell from 8,483 to 691 (91.85% fewer); every new position
  timestamp was divisible by 60.
- Sampled peak process-tree resident memory was 3.67 GiB, versus 5.18 GiB in the
  earlier baseline. Private committed memory was 4.54 GiB, versus 5.96 GiB.
- Engine time was 210.8 seconds and end-to-end time 245.0 seconds. Another
  benchmark ran concurrently and free physical RAM fell to about 513 MiB.
  These runs do not demonstrate a speed improvement or a safe cloud VM minimum.

Raw telemetry, resource samples, logs, results, and a `comparison.json` assertion
summary are retained in the local benchmark directory. The large team match's
earlier position-validation problem has not been diagnosed or claimed fixed.
