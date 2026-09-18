# The Go worker (`cmd/worker`, `internal/worker`, `internal/jobs`)

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory.

The homerun worker is a separate Go binary that executes the heavy job types
(deploys and builds, image scans, backups and restores, cron jobs, Docker
cleanups). The SvelteKit app keeps the database, the queue and the business
rules: it decides _what_ to do, the worker only does it. `notification_delivery`
stays in-process in TypeScript (light HTTP work).

## Why Postgres, not HTTP

Jobs travel through the existing `job` table, not a request to the worker. Every
stage is a committed row, so a restart of either process never loses a job, its
output or its result: an HTTP hand-off would lose a job the moment the worker
restarted mid-call, with no stored log.

## The stage protocol

The `job` row stays `status = 'running'` through all of it, so `lockKey`,
`exclusive` and `dependsOnJobId` in `JobDTO.claimNext` keep working unchanged
(an executing deploy still holds its service's lock).

| Column                              | Meaning                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `stage`                             | null (in-process job) / `prepare` / `execute` / `finalize` / `finalizing`    |
| `spec`                              | `encryptSecret(JSON.stringify(spec))`, may carry secrets, cleared at the end |
| `worker_id`, `heartbeat_at`         | the Go worker's lease                                                        |
| `log`                               | executor output lines for types without their own log column (`AppendLog`)   |
| `executor_result`, `executor_error` | what the Go executor returned                                                |

1. **Prepare (TS).** `JobWorker` claims a queued job exactly as before. If
   `workerJobs[type]` (`src/lib/services/queue/worker-jobs/index.ts`) is
   non-null, `runJob` calls its `prepare(job)` and `job.handOff(spec)` stores
   the spec encrypted and sets `stage = 'execute'`. The in-process slot frees
   immediately. A throwing `prepare` takes the normal retry/fail path.
2. **Execute (Go).** Every second, up to `WORKER_CONCURRENCY` times, the worker
   leases one `running`/`execute` row with no worker or a heartbeat older than
   60s (`for update skip locked`, priority then age), heartbeats every 10s, and
   runs `internal/worker.Executors[type]` with the decrypted spec. A heartbeat
   that no longer matches (cancelled, or taken over) cancels the execution and
   nothing is written. The outcome lands as `stage = 'finalize'` plus
   `executor_result`/`executor_error`, lease cleared.
3. **Finalize (TS).** Each tick, `JobDTO.claimFinalize()` moves `finalize` rows
   to `finalizing` and `JobWorker.finalizeJob` runs the type's
   `finalize(job, result, error)`; its return value marks the job succeeded, a
   throw goes through the same retry (back to `queued`, stages cleared) or
   permanent-fail logic as an in-process handler.

**Restarts.** The app's boot-time `requeueOrphaned` only requeues `running` rows
with no stage or `prepare`, puts `finalizing` back to `finalize`, and leaves
`execute` to the Go lease. On SIGTERM the worker stops claiming, gives in-flight
jobs 60s, then cancels them and releases their lease so the next worker
re-executes them straight away. A job sitting in `execute` with no live worker
for over two minutes gets one warning line per job from the app (no auto-fail).

**Timestamps.** Drizzle's `timestamp` columns hold UTC wall-clock time, so Go
writes `db.UTCNow` (`now() at time zone 'utc'`), never bare `now()`.

## Porting a job type

- TS: fill in `src/lib/services/queue/worker-jobs/<type>.ts`
  (`export const <camel>WorkerJob: WorkerJob | null`). `prepare` resolves
  everything the executor needs (network names, labels, env, registry auth,
  remote host connection, retention lists) so Go never re-implements app config
  or business rules. `finalize` does the DB bookkeeping the old handler did.
- Go: implement `Run(ctx context.Context, job jobs.Job) (map[string]any, error)`
  in `internal/jobs/<pkg>`, already registered in `internal/worker/registry.go`.
  `jobs.Job` has `ID`, `Type`, `Attempts`, `Spec`, `DockerSocket`,
  `DecodeSpec(&v)`, `AppendLog(line)` and `DB()` (the pgx pool, for direct
  writes to `deployment.log`/`deployment.status`/`service.current_status`, which
  the progress UI polls). `jobs.Recorder(type, spec)` builds a database-less Job
  for tests. Docker goes through `internal/dockerapi`.
- `jobs.Job` lives in `internal/jobs`, not `internal/worker`, because the
  registry imports every executor package.

## Config, packaging, running it

Env: `DATABASE_URL` (required), `AUTH_SECRET` (else `BETTER_AUTH_SECRET`, else
`default-secret`, the same resolution as the app, and it must match the app's,
since `internal/secrets` derives the same scrypt key), `DOCKER_SOCKET_PATH`
(else `internal/dockersocket` detection, shared with the agent),
`WORKER_CONCURRENCY` (3), `WORKER_ID` (hostname-pid). Flags: `--version`,
`--help`.

The binary ships inside the app image at `/usr/local/bin/homerun-worker`.
Production runs a second container from the same image with that as its
`command` (the image's `/entrypoint.sh` stays the entrypoint, so the Docker
socket group fixup and the drop to the `bun` user apply), the Docker socket
mounted, the image healthcheck disabled, and the label `homerun.role=worker`:
self-update finds the worker service by that label and recreates it with the
app. Locally: `go run ./cmd/worker` with the app's `.env` values.
`tests/integration` and the e2e bootstrap spawn it too (`spawnWorker`,
`startWorkerContainer` when e2e runs against an image).
