# Windows replay benchmark, October 16, 2026

Hardware: Intel Core i7-8700K, 6 physical cores / 12 logical processors,
17,106,395,136 bytes physical RAM; Windows; Node v23.10.0.
Engine 2026.07.04, Zero-K v1.14.10.3. Dependencies were seeded from an existing
Flea cache, then reused. These are not cold-download measurements.

| Battle / run | Outcome | Engine wall seconds | End-to-end seconds | Peak tree resident GiB | Peak tree private GiB | Sampled CPU seconds |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 2524251 / 1 | Ready | 158.0 | 178.9 | 5.18 | 5.96 | 355.8 |
| 2524251 / 2 | Ready | 153.5 | 174.5 | 5.10 | 5.92 | 346.0 |
| 2525057 / 1 | Interrupted by free-disk reserve | 82.7, partial | 108.4 | 5.26 | 6.21 | 132.5 |
| 2525057 / 2 | Engine exited successfully; export rejected | 588.6 | 608.4 | 5.44 | 7.00 | 1249.9 |

The two duel results validated full spectator visibility, 1,063.40002 simulated
seconds, and 405 completed units. Engine-stage speed ratios were 6.73 and 6.93
simulated seconds per wall-clock second, including startup and export copying.
Cached dependency checks took about 11 seconds per duel. The cache grew from
796,941,109 to 807,123,712 bytes across the batch; this measures retained disk
growth, not downloaded network bytes or maximum temporary usage.

The team match's second engine run exited normally, but ingestion raised
`InvalidExport: Invalid position`. No ready analysis was published. Its engine
time and resource usage are observations of that execution, not a successful
end-to-end processing benchmark. The first team attempt raised
`StoragePaused: Host free-space reserve reached`; it is not a complete run.
The retained failed source replay was reused on the second team attempt.

## Limitations and findings

- Another site's native replay worker ran concurrently. Windows showed memory
  pressure and pagefile usage during the team attempt. Timings are contended
  measurements, not idle-host throughput or cloud predictions.
- Resident memory is sampled concurrent process-tree working set, which can
  double-count shared pages. Private memory is committed private bytes, not
  necessarily resident RAM. CPU totals are sampled lower bounds. The sampler
  itself is excluded but adds host load.
- Source metadata listed 10 team-match players; the live export contained 15
  player records. Participant count needs reconciliation before using it as an
  authoritative workload size. This report therefore identifies the battle by ID.
- Preliminary attempts exposed a replay-port collision with the existing worker.
  The native runner now uses local-only playback, exclusive configuration, and
  an isolated data directory with the exact engine's base assets. Both duel runs
  passed with that change.
- Production cleanup removed the rejected raw team export before its precise bad
  record could be inspected. The benchmark now preserves raw telemetry before
  ingestion; it does not relax the validator to make a benchmark pass. Diagnose
  the invalid position with preserved evidence in a subsequent run.
- Later sampler revisions additionally record free RAM/disk minima and generate
  a Markdown report. Those fields were not collected in this original batch.
- Linux memory and performance remain unmeasured. These results do not establish
  a safe minimum VM size. They do show that the present Windows configuration
  exceeds 1–2 GiB memory budgets even for the verified duel.

Raw artifacts remain locally in `data/benchmarks/20261016-132345/`: `machine.json`,
`results.json`, per-case results/logs/databases, and per-case `.samples.csv` files.
Earlier failed setup attempts remain separately in `data/benchmarks/20261016-132019/`.
Raw artifacts are ignored by Git; only this summary is tracked.

TypeScript build, PowerShell syntax checks, and all 23 automated tests passed
after the benchmark tooling and runner changes. The original four-case batch
preceded the later raw-export retention and free-memory sampling additions.

See [benchmark instructions](benchmarking.md) to repeat the experiment.
