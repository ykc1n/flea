# Production-ready replay discovery and analysis

October 16 addendum: the operator requested an optional Cloud Run Jobs worker.
Container deployment is now permitted for that path; the native deployment
requirements below remain unchanged. See [Cloud Run implementation](../cloud-run.md)
for its pilot scope and remaining hosted queue/frontend integration.

Publication status: local draft for GitHub Issues in ykc1n/flea; use the agreed ready-for-agent label after review.
Review status: native deployment requirements and testing seams accepted for implementation by the subsequent implement request. Release evidence is tracked separately.

## Problem Statement

People need to browse recent Zero-K Battles and trust the Telemetry attached to
them. Today Flea requires manually provisioned engines and content, has no verified
real-engine production path, and has gaps in shutdown, recovery, bounded storage,
and operational visibility. Passing tests with a simulated processor does not
establish that unattended use is reliable.

## Solution

Provide a public, read-only explorer operated by one person, running directly
on Linux or Windows without Docker. A supported Node.js installation is required;
Windows hosting starts at sign-in. Discover recent Battles and immediately expose
their metadata. Automatically acquire exact Replay dependencies and analyze
eligible Replays oldest first, one at a time. Publish Telemetry only after full
validation. Explain blocked work visibly, recover safely from interruption, and
keep disk use bounded without deleting published analysis.

## User Stories

1. As a visitor, I want discovered Battles to appear immediately, so that I can browse them before analysis finishes.
2. As a visitor, I want metadata and source/download links without Telemetry, so that an unanalyzed Replay remains useful.
3. As a visitor, I want waiting analysis distinguished from blocked analysis, so that I understand its availability.
4. As a visitor, I want a red notice with readable explanatory text for a Blocked Replay, so that the obstacle is clear without relying on color alone.
5. As a visitor, I want only complete, validated Telemetry published, so that timelines are trustworthy.
6. As a visitor, I want Ready Replays to have explicit full spectator visibility, so that hidden observations do not misrepresent the Battle.
7. As a visitor, I want archive search, filters, pagination, and details to remain usable as the archive grows, so that browsing does not degrade with stored Telemetry volume.
8. As an operator, I want deployment on Windows and Linux without Docker, so that I can run Flea directly on my host.
9. As an operator, I want recent Battles discovered automatically, so that the archive stays current.
10. As an operator, I want exact engines, games, maps, and their dependencies acquired automatically, so that ordinary processing needs no manual provisioning.
11. As an operator, I want unavailable dependencies to block only affected Replays, so that other work continues.
12. As an operator, I want incompatible historical engines isolated as blocked work, so that compatibility failures do not stop the archive.
13. As an operator, I want eligible Replays processed by Battle start time, so that queue order is predictable.
14. As an operator, I want one active analysis while discovery and browsing continue, so that resource use is controlled without stopping ingestion.
15. As an operator, I want transient acquisition failures retried automatically, so that temporary outages recover without intervention.
16. As an operator, I want acquisition failures excluded from processing attempt counts, so that unavailable content does not exhaust analysis retries.
17. As an operator, I want processing attempts bounded at three, so that broken work cannot loop indefinitely.
18. As an operator, I want to explicitly retry blocked work after fixing its cause, so that recoverable Replays are not abandoned.
19. As an operator, I want engine descendants stopped before interrupted work resumes, so that separate jobs cannot interfere.
20. As a visitor, I want partial exports discarded after interruption, so that a crashed run never appears ready.
21. As an operator, I want a configurable disk budget and free-space reserve, so that downloads cannot fill the host unnoticed.
22. As an operator, I want disposable files cleaned before acquisition pauses, so that reclaimable storage is reused.
23. As an operator, I want shared dependency caches reused and unused content evictable, so that repeat analysis avoids unnecessary downloads.
24. As an operator, I want active-job dependencies protected from eviction, so that cleanup cannot break processing.
25. As an operator, I want published metadata and analysis preserved during cleanup, so that storage pressure does not remove visitor results.
26. As an operator, I want bounded diagnostic logs, so that failures are diagnosable without unbounded storage growth.
27. As an operator, I want active work, queue counts, discovery freshness, disk use, and pause reasons visible, so that I can assess system health.
28. As a visitor, I want readable public errors without internal paths or command output, so that failure messages are useful and appropriate for public display.
29. As an operator, I want a tested backup and restore procedure for metadata and published analysis, so that a host failure is recoverable.
30. As an operator, I want real Replay execution and restart recovery demonstrated on both supported host platforms, so that release claims have evidence.

## Implementation Decisions

- Keep the current TypeScript migration as the implementation baseline; preserve unrelated working-tree changes. Retain SQLite unless validated implementation constraints require revisiting that decision.
- Run directly on Windows and Linux; Docker is excluded. Share application logic and use platform-specific acquisition and process-control adapters where needed. Real native replay execution on each supported host remains a release prerequisite.
- Require a supported Node.js installation on the host. Flea automatically acquires exact Replay engines, games, maps, and their dependencies.
- Windows hosting uses a scheduled task at user sign-in, rather than requiring a Windows service or startup before sign-in. Retain Linux systemd hosting. Preserve existing native deployment paths while adding safe engine ownership and shutdown behavior.
- Maintain one active analysis. Discovery must progress independently of analysis duration; browser requests must remain available.
- Order eligible work by Battle start time ascending, then Battle ID ascending. Blocked work that is not retry-eligible must not hold up other work. Missing or invalid timestamps need an explicit deterministic policy before implementation acceptance; do not silently interpret them in host-local time.
- Concentrate claim, retry eligibility, outcome, interruption recovery, and explicit requeue policy in a durable Replay job module. Persist eligibility and attempts across restarts; an interrupted final attempt must not leave an ineligible Replay labeled as waiting forever.
- Separate acquisition retries from processing attempts. Retry transient acquisition failures after 5 minutes, then 30 minutes, then every 6 hours. Processing failures receive at most three attempts. Invalid exports and exhausted failures remain blocked pending operator intervention. Operator retry is an operator command, not a public mutation endpoint.
- Validate an existing unattended acquisition tool against a known Replay before choosing the acquisition adapter. Reuse existing Zero-K download mechanisms where needed. Acquire exact engine, game, map, and transitive dependencies into deployment-owned storage; never substitute newer content silently.
- Keep acquisition and engine execution behind internal seams where external behavior actually varies. Avoid committing to a generic framework or an unverified downloader executable.
- Give managed execution ownership of the runner and engine descendants, timeout, cancellation, log completion, and confirmed termination. Do not release shared execution resources until prior engine ownership is resolved.
- Before publishing a Ready Replay, validate export structure, required event fields, completion, explicit full-view evidence, and resource limits. Bound ingestion work; avoid whole-event argument spreading for duration. Discard partial exports after interruption.
- Preserve the existing archive/detail request interface where practical. Keep list queries bounded and avoid reading or parsing every full analysis to render a page. Explicitly resolve existing JSON-wide search semantics during query design rather than silently changing them.
- Represent waiting, active, ready, and blocked conditions consistently in durable state and public responses. A Blocked Replay has a readable reason and red notice; low queue priority alone is not a block. Public explanations exclude private diagnostic details.
- Default managed storage budget to 50 GB and reserve to 5 GB; make both configurable. Pause new acquisition at the budget or below the free-space reserve. Enforce limits during acquisition as well as before it; partial downloads cannot bypass storage policy.
- Clean disposable job files first. After analysis is durably saved and validated, remove its downloaded Replay and raw export; retain bounded diagnostic logs. Reuse dependency caches and evict only unused dependencies. Protect active-job dependencies and published metadata/analysis.
- Expose operational status: active Replay, waiting and blocked counts, last successful discovery, disk usage, and acquisition pause reasons. Keep detailed logs operator-only.
- Back up metadata and published analysis using a consistent SQLite snapshot procedure; exclude reacquirable dependency caches. Document and rehearse restoration.

## Testing Decisions

- Test the running explorer through public HTTP requests and observe durable outcomes of discovery and worker execution. Supplement this with existing export ingestion and native process execution interfaces for malformed-export and descendant-cleanup checks that HTTP alone cannot isolate. Use native Windows and Linux rehearsals for real acquisition and engine compatibility.
- Assert observable outcomes, not private call order, SQL text, or module organization. Reuse existing real SQLite tests, public Battle fixtures, and export fixtures as prior art; strengthen their guarantees rather than duplicating implementation-shaped tests.
- Test chronological eligibility, Battle ID tie-breaks, blocked-job skipping, retry schedules, restart persistence, attempt exhaustion, explicit requeue, and interruption on the final attempt.
- Use controlled acquisition adapters and clocks for deterministic unavailable-content and retry tests; validate the chosen real acquisition adapter separately against upstream exact-version content.
- Test managed execution through actual small child processes, including a spawned descendant: success, missing executable, timeout, cancellation, log-write failure, and confirmed cleanup before a subsequent job.
- Feed complete and malformed exports through the same ingestion interface used by production. Cover absent visibility evidence, invalid dimensions and identities, truncation, oversized records, and large valid exports.
- Exercise public archive and detail requests with many Replays and large analyses. Verify correct totals, filters, stable pagination, metadata-only availability, status text, and private-error redaction; confirm card listing avoids full Telemetry loading.
- Exercise budget exhaustion, free-space reserve, partial-download cleanup, cache eviction, active dependency protection, and preservation of published analysis using controlled storage conditions.
- Verify browsers show waiting and red blocked explanations correctly, including a readable textual reason. Verify status reports acquisition pauses and discovery freshness.
- Before release, run a known real Replay with automatically acquired exact dependencies directly on Linux and Windows. Check player identities, full visibility, production summaries, and timeline plausibility against the known Battle.
- On both host platforms, interrupt real processing and restart; verify no surviving prior engine, no published partial result, and correct durable recovery. Demonstrate discovery and browsing continue during analysis.
- Rehearse backup and restore and verify recovered metadata and published analysis through the explorer. A passing simulated processor suite is necessary regression evidence, not sufficient release evidence.

## Out of Scope

- Historical archive backfill at launch.
- Match scoring, numeric rating acquisition for scheduling, rating clusters, and score-based priority.
- Multiple concurrent analyses or distributed workers.
- Docker and container deployment.
- Windows service installation and startup before user sign-in at launch.
- Public mutation endpoints, visitor accounts, or user-uploaded Replays.
- Guaranteeing every historical engine remains downloadable or executable.
- Keeping all raw exports, downloaded Replays, logs, and cached dependencies forever.
- Selecting a downloader without a compatibility rehearsal.

## Further Notes

- This spec synthesizes the agreed interview requirements; it does not assert that production readiness has been implemented or verified.
- Preliminary upstream inspection found Chobby download-only and launch operations, exact engine acquisition, Rapid game acquisition, and named map acquisition. A standalone downloader also exists, but support for the required Zero-K engine identifiers must be demonstrated.
- Relevant upstream references: [Chobby download/launch handlers](https://github.com/ZeroK-RTS/Zero-K-Infrastructure/blob/master/ChobbyLauncher/ChobbylaLocalListener.cs), [engine downloads](https://github.com/ZeroK-RTS/Zero-K-Infrastructure/blob/master/Shared/PlasmaDownloader/EngineDownload.cs), [resource downloads](https://github.com/ZeroK-RTS/Zero-K-Infrastructure/blob/master/Shared/PlasmaDownloader/PlasmaDownloader.cs), and [standalone downloader](https://github.com/spring/pr-downloader).
- Downloader selection, missing-date policy, exact resource caps, processing retry timing, cache eviction order, and log retention sizes remain implementation details to resolve and document. They must preserve the agreed guarantees above.
- The user selected GitHub Issues in ykc1n/flea and the default triage labels: needs-triage, needs-info, ready-for-agent, ready-for-human, and wontfix. Repository configuration files have not yet been written; this does not reopen those choices. The agent instruction filename remains undecided.
