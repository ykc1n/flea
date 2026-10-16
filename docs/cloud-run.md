# Cloud Run Jobs worker

This is a manually invoked, one-battle job, not the hosted global queue. It does
not run the website or discovery loop. The native Windows deployment remains
available; the container is specifically for Cloud Run Jobs.

## Storage

| Data | Local deployment | Cloud Run execution |
| --- | --- | --- |
| Metadata, queue, published analyses | `data/flea.sqlite3` and SQLite WAL files | Per-task SQLite under `/scratch/battle-*/`, discarded at exit |
| Exact engines, maps, game packages | `data/zero-k/` reusable cache | Task-local `/scratch/battle-*/zero-k/`, discarded at exit |
| Validated replay result | Inside SQLite | Private `gs://PROJECT-flea-results/results/BATTLE/UUID/replay.json.gz` |
| Completion/failure marker | SQLite job state | Same object prefix, `manifest.json`, written last |
| Diagnostics | `data/logs/`, `data/jobs/ID/` | Private bounded per-job logs in result bucket plus Cloud Logging |
| Benchmark copies | `data/benchmarks/TIMESTAMP/` | Not included in image or uploaded |

The compressed result contains `{schemaVersion: 1, replay: ReplayView}`, including
the validated analysis. Objects are immutable and use generation-match-zero
creation. A ready manifest references an already-uploaded result; consumers must
read manifests rather than treating any result object as published. Failed
uploads never produce a ready manifest. If the process is forcibly killed, a
manifest may be absent: the Cloud Run execution status remains authoritative.

The result bucket is private, with public access prevention. The runtime service
account can create objects there, but cannot list, read, overwrite, or delete
them. Operator credentials or a separate application identity are needed to
read results. No downloaded engine/game cache is retained in Cloud Storage in
this first version, so each execution reacquires dependencies.

## Deploy

Requires an existing Google Cloud project with billing enabled, an authenticated
current Google Cloud CLI with the beta component, and provisioning permissions.
Docker does not need to be installed locally: Cloud Build builds the image.

```powershell
gcloud auth login
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deploy/cloud-run/deploy.ps1 -ProjectId YOUR_PROJECT -Execute
```

The script creates fresh private result/source buckets, scoped runtime/build
service accounts, an Artifact Registry repository, and the job. It uses an
explicit project on every operation, never edits your default CLI project, and
stops on errors. A conflicting existing resource name stops first-time setup;
inspect partial provisioning rather than blindly using the update switch.
Use `-ExistingInfrastructure` only after those resources and permissions exist.
Build-source objects under `source/` expire after seven days. Result objects and
container images do not have automatic deletion policies.

The pilot configuration is 2 vCPUs, 8 GiB RAM, one task, 90-minute task timeout,
and zero automatic retries. It uses a **10 GiB ephemeral disk** mounted at
`/scratch` (currently a Cloud Run preview feature). That disk is separate from
the default RAM-backed writable filesystem. If the project cannot use it,
deployment must fail rather than silently moving caches into memory. The disk
also incurs usage charges. The image's managed scratch budget is 8 decimal GB
with a 1 decimal GB filesystem reserve. Sizes are starting test values, not a
guarantee that every replay fits or that usage remains free.

Run a different battle explicitly:

```powershell
gcloud run jobs execute flea-worker --project=YOUR_PROJECT --region=us-central1 --args=2524251 --wait
gcloud run jobs executions list --job=flea-worker --project=YOUR_PROJECT --region=us-central1
gcloud storage ls --recursive gs://YOUR_PROJECT-flea-results/results/
```

The execution log prints the exact manifest URI. A successful deployment alone
does not prove processing works: require a successful execution, a ready
manifest, and a readable validated bundle for the reference duel. The image
build additionally smoke-tests loading reference engine 2026.07.04 on Linux.
Historical engine versions can require other libraries and remain job-specific
failures. The existing large-team position-validation issue is not fixed here.

Cloud Run ADC supplies the runtime credentials; do not bake service-account keys
or `.env` files into the image. Build uploads explicitly exclude local data,
credentials and caches. The image includes only application sources/runtime
dependencies, worker assets, and system libraries.

## Vercel integration still needed

The public site currently reads local SQLite. Cloud results will not magically
appear there, and no shared database or oldest-first scheduler is provisioned by
this script. A later hosted coordinator must discover metadata, claim the oldest
eligible battle, enforce a single global lease across executions, ingest ready
manifests, persist attempts/retry deadlines, and serve results to Vercel.
`--parallelism=1` only limits tasks within an execution; independent executions
can overlap. Do not enable automatic scheduling before that coordinator exists.
See [hosted architecture](hosted-architecture.md).

## Verification status

The one-battle publication workflow is tested locally with injected engine and
storage boundaries, including invalid telemetry and upload failures. Actual
container build, Linux engine execution and GCS upload remain unverified until
the Google project and authenticated CLI are available. No cloud resources have
been created by the local tests.

References: [Cloud Run job setup](https://docs.cloud.google.com/run/docs/quickstarts/jobs/create-execute),
[ephemeral disk](https://docs.cloud.google.com/run/docs/configuring/jobs/ephemeral-disk),
[service identity](https://docs.cloud.google.com/run/docs/configuring/jobs/service-identity).
