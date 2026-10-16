# Hosted frontend and local processing

Target: the public website and its API run on Vercel. Only replay processing runs
on the operator's computer. The current native deployment is an interim setup;
it uses a local SQLite database and cannot simply be deployed unchanged to Vercel.

## Components

- Vercel serves `web/`, public replay APIs, a bounded discovery endpoint invoked
  by a hosted scheduler, and authenticated worker endpoints.
- Hosted Postgres stores battle metadata, summaries, queue state, retry times,
  attempts, leases, and worker heartbeats.
- Object storage holds immutable validated analysis exports. Public detail APIs
  return analysis URLs; archive cards read only small database summaries.
- The native worker polls the hosted API, downloads exact replay dependencies,
  runs the engine, validates telemetry, uploads analysis, and reports completion.
  Engine binaries, maps, game packages, and temporary replay files remain local.

## Job lifecycle

1. Hosted discovery upserts metadata and queues jobs independently of the worker.
2. An authenticated worker claims the oldest eligible battle atomically. Unknown
   battle times sort last; battle ID breaks ties. One processing lease is active.
3. The worker heartbeats its lease while acquiring assets and processing.
4. Acquisition retries retain their separate backoff and attempt accounting.
5. A validated export is uploaded under an immutable object key. Completion checks
   the current lease token and publishes its summary and object reference in one
   database transaction. A stale worker cannot overwrite newer results.
6. Expired leases recover interrupted jobs using the existing attempt policy.
   Unreferenced uploads can be garbage-collected after a grace period.

The website remains available when the worker is offline. New matches stay
browsable and queued; previously published results remain accessible.

## Authentication and network

The worker initiates outbound HTTPS only. No router port forwarding, inbound SSH,
or tunnel is required for production processing. A revocable worker credential
is stored on the worker and verified by Vercel's API. Database credentials and
storage signing credentials stay in server environment variables, never browser
JavaScript. Upload URLs are short-lived and scoped to the claimed job.

## Implementation sequence

1. Add Postgres migrations and an asynchronous repository interface; retain local
   SQLite as an optional standalone mode.
2. Move discovery to a bounded hosted function with idempotent upserts and a
   scheduler appropriate to the selected hosting plan.
3. Add authenticated claim, heartbeat, retry, upload, and complete endpoints with
   lease fencing and request size limits.
4. Add the worker's remote API transport, preserving native execution ownership,
   storage limits, validation, and retry behavior.
5. Adapt public replay APIs and the frontend detail loader to object-backed
   analysis, then add Vercel configuration and migrate existing metadata/results.
6. Verify an actual replay end-to-end, worker interruption, stale completion
   rejection, and website availability while the worker is offline.

Provider accounts, credentials, and Vercel project configuration are still needed
before this architecture can be provisioned. No cloud infrastructure is created
by this document.

Vercel's function filesystem is read-only except temporary scratch space, so a
local SQLite file is not the shared production database:
https://vercel.com/docs/functions/runtimes
