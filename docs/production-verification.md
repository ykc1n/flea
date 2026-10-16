# Production verification

Native deployment only. Evidence collected on Windows x64 on October 16, 2026.
Release readiness is not yet certified on both supported host platforms.

## Automated checks

Behavioral tests cover metadata, chronological processing, durable retry deadlines,
blocked error redaction over HTTP, paginated archive queries, malformed exports,
large exports, automatic acquisition integration, backup/restore, storage pressure,
and native subprocess success, timeout, log limits, and crash recovery.

The recovery test kills the worker-side driver while its engine tree is alive,
then verifies the persisted owner and terminates the orphaned descendant.
CI now targets Windows and Linux. A configured matrix is not evidence of a run.

## Real engine acquisition and Replay execution

- Exact engine: 2026.07.04, Windows x64 archive obtained from Zero-K.
- Bundled pr-downloader executes unattended. It acquired Zero-K v1.14.10.3,
  Absolution 2, and dependencies using individual-file Rapid transfers.
- The default streaming transfer stalled in this environment; individual-file
  transfer completed with certificate verification enabled. This is the selected
  acquisition mode; no TLS validation bypass is used.
- Battle 2524251 loaded its matching game and map in spring-headless.
- The export confirmed fullView=true and lobby identities 650912 and 578837.
- The first completed run exposed post-game shutdown events after game_over;
  validation correctly rejected it. The exporter now closes the file at GameOver.
- A second run through automatic acquisition and the default worker is in progress;
  update this record with the final outcome before claiming successful publication.

## Outstanding release checks

- Finish and inspect the corrected real Windows Replay result.
- Rehearse interruption and restart with the real engine, not only test processes.
- Inspect the real result and blocked states in the browser.
- Rehearse sign-in startup and removal of the Windows scheduled task.
- Run exact-dependency acquisition, Replay execution, interruption/restart, and
  hosting under Linux systemd. This host has no installed WSL/Linux runtime.
- Rehearse production backup/restore commands with the real published result;
  the automated snapshot/restore test already covers validated simulated Telemetry.

Reproduce real analysis in an independent directory with:

```sh
npm run build
npm run verify -- 2524251
```

The command prints the verification directory. Start the browser with FLEA_DATA
set to that directory to inspect its archive and details. Keep release evidence
distinct from simulated fixtures and from requirements that have not been tested.
