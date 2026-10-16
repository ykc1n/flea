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
The final local npm test run passed all 23 tests, TypeScript compilation, and
browser JavaScript syntax checking.

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
- The corrected default worker run automatically acquired its exact engine and
  published the Replay as ready on the first processing attempt. Previously
  downloaded game/map content was reused by the native downloader.
- Result: 405 completed units, 1,063.40002 seconds, and Cloakbot Factories at
  8.63333321 seconds (FitRaptor) and 7.5999999 seconds (joseph52626).
- Browser inspection confirmed both players, first factories, production totals,
  the map, and event-to-timeline navigation. Battle-page duration is rounded;
  analysis duration comes from the actual engine terminal record.
- A separate browser check confirmed the real rejected export remains browsable
  with a visibly red blocked notice and readable operator-retry explanation.
- A separate real-engine run was interrupted by killing its worker-side driver
  after partial Telemetry appeared. Recovery terminated the persisted Windows
  owner, discarded the export, and produced a Ready Replay on attempt two.
- Backed up the real published result using the operator command, restored into
  a new database, and verified ready/full-view/405 units through HTTP.
- Windows execution now uses an atomically assigned Job Object and waits for zero
  active processes before releasing ownership. Regression tests include a command
  that exits after spawning a detached descendant, plus worker-death recovery.
- The existing Flea Replay Explorer scheduled task was observed running. It was
  not replaced or restarted during this verification.

## Outstanding release checks

- Rehearse a fresh Windows sign-in/startup and installer removal without
  disturbing an existing deployment.
- Run exact-dependency acquisition, Replay execution, interruption/restart, and
  hosting under Linux systemd. This host has no installed WSL/Linux runtime.

## Code review

Separate standards and spec reviews found and resolved Windows descendant ownership,
termination-confirmation, and deferred-download cleanup gaps. Failure policy was
concentrated in one decision result. Follow-up review found no remaining blockers
in those changes; Linux execution and recovery are still required release evidence.

Reproduce real analysis in an independent directory with:

```sh
npm run build
npm run verify -- 2524251
```

The command prints the verification directory. Start the browser with FLEA_DATA
set to that directory to inspect its archive and details. Keep release evidence
distinct from simulated fixtures and from requirements that have not been tested.
