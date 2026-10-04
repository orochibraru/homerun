# The Go worker (`cmd/worker`, `internal/worker`, `internal/jobs`)

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory.

The homerun worker is a separate Go binary that does two jobs, not one: it
executes the heavy job types (deploys and builds, image scans, backups and
restores, cron jobs, Docker cleanups) leased from Postgres, **and** it's the
only process that holds the Docker socket at all, so it also serves a Docker
control HTTP API (`internal/workerapi`) that the SvelteKit app calls for
everything else. The app keeps the database and the business rules: it decides
_what_ to do, the worker only does it, over whichever of the two surfaces below
fits what's being asked. `notification_delivery` stays in-process in TypeScript
(light HTTP work, no Docker).

## Two surfaces, one reason each

**The job queue (Postgres) is for what must survive a restart.** A deploy, a
build, a backup, a cron run and a cleanup can each take anywhere from seconds to
minutes, and a browser tab closing or a redeploy of the worker itself must not
lose one mid-flight — see "Why Postgres, not HTTP" below for why that rules out
a plain request for these.

**The Docker control API (`internal/workerapi`, HTTP on `WORKER_PORT`) is for
what a page is waiting on right now, plus the three things that can't be a job
at all because they stream.** Reading a container's status, starting/stopping/
restarting it, listing networks/volumes, running `docker system df`/prune, swarm
init/inspect: none of these need to survive the worker restarting, they need to
answer _this request_, so a synchronous HTTP call with a real response body is
the right shape, not a queued row the caller would have to poll. Three things go
through it because they literally cannot be a job: **logs** and the **web
terminal** are open-ended streams a "job" with a start and an end can't model,
and **host stats** are a live snapshot, not a result to store. See `docker.md`'s
Docker integration section for the client side
(`src/lib/server/worker-client.ts`, `WorkerClient`) and Web terminal section for
the terminal specifically.

A job's own executor (`internal/jobs/<pkg>`) still talks to the daemon directly
through `internal/dockerapi`, same as before this split, it doesn't go back
through the worker's own HTTP API : the control API exists for the _app_, which
has no other way to reach Docker, not for code that's already running inside the
worker process.

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
| `progress_at`                       | when the execution last made progress, written with each heartbeat           |
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

**Cancelling a deploy** (the Overview's Cancel button) marks the deployment
failed and `JobDTO.cancelForDeployment` sets its job (matched on
`payload->>'deploymentId'`) and anything depending on it to `cancelled`. That's
the whole mechanism for every stage: a queued job is never claimed, a `prepare`
still waiting on status checks sees the failed deployment and stops, and an
`execute` loses its lease on the next heartbeat, which cancels the context the
Docker build or pull runs under and drops the result. `handOff` after a cancel
can still flip the stage to `execute`, harmlessly: the claim requires
`status = 'running'`.

**Restarts.** The app's `requeueOrphaned` (at boot, then every 30s for rows not
in the job worker's in-flight set) only requeues `running` rows with no stage or
`prepare`, puts `finalizing` back to `finalize`, and leaves `execute` to the Go
lease: any live worker re-claims an `execute` row whose heartbeat is over 60s
old (`TestPgStoreLeaseLifecycle`), so the app never requeues those. On SIGTERM
the worker stops claiming, gives in-flight jobs 60s, then cancels them and
releases their lease so the next worker re-executes them straight away. A job
sitting in `execute` with no live worker for over two minutes gets one warning
line per job from the app (no auto-fail), and shows as `stale`
(`queue/stale.ts`'s `isStaleJob`, same two minutes) in the self-update blockers
and `GET /api/v1/jobs`. So does one whose `progress_at` is over 15 minutes old
while it still heartbeats (see "Nothing Docker can hang a job forever" below): a
live heartbeat only proves the worker process is up, not that the job is moving.

**Timestamps.** Drizzle's `timestamp` columns hold UTC wall-clock time, so Go
writes `db.UTCNow` (`now() at time zone 'utc'`), never bare `now()`.

## Nothing Docker can hang a job forever

A dockerd deadlock can't be prevented from the client side, but the worker must
never wait on one forever (see the backup incident in `jobs-and-queue.md`).
Three layers, each a backstop for the one above:

- **Every control call has a deadline** (`internal/dockerapi`'s `request` →
  `bounded`): `ControlTimeout`, 60s (`WORKER_DOCKER_TIMEOUT`), covering headers
  and body; twice that for a stop, restart or swarm init; `SlowTimeout` (30m)
  for prunes, `system df` and image removal. A hijacked stream (terminal, helper
  attach) gets the same deadline on its upgrade answer. Running out returns a
  `*dockerapi.StallError` naming the call and the container it was about ("the
  daemon may be stuck on container abc… sudo systemctl restart docker"), never
  the caller's own cancellation, which stays itself.
- **Streams get a stall watchdog, not a deadline** (`stream`/`upload`, logs,
  attach, pull, push, save, load, exec output, a container wait): cancelled once
  no byte moved either way for `StallTimeout`, 10m
  (`WORKER_DOCKER_STALL_TIMEOUT`), so a huge backup that keeps streaming runs as
  long as it needs. A stream that's legitimately silent (a cron container
  sleeping, `tar -x` writing to disk, a `wait` on a long build) has a probe:
  every tenth of the window the watchdog inspects its container (or pings the
  daemon for swarm logs and image loads) and a running container counts as
  progress. The probe is exactly what hangs on a wedged container, so the stream
  is abandoned with a `StallError` instead of waiting on it.
- **A job-level no-progress watchdog** (`Worker.StallTimeout`, 15m,
  `WORKER_JOB_STALL_TIMEOUT`): each execution's context carries an
  `internal/activity.Tracker`, touched by every Docker call that answers, every
  byte a watched stream or the S3 client moves, and held open by `activity.Hold`
  around a remote agent build answered in one response. The heartbeat writes the
  last touch to `progress_at`, and a job quiet for the window is cancelled and
  fails through the normal retry/fail path (`worker.StalledError`), heartbeat or
  not.

A helper whose job failed that way is left to the janitor, not waited on:
`RunHelper`'s cleanup removes it on `ControlTimeout` and logs when it can't.

## Helper containers and the janitor

Every throwaway container the worker creates carries `homerun.helper=true` and
`homerun.helper.created` (RFC 3339) next to `homerun.managed`
(`dockerapi.HelperLabels`): backup/restore/wipe and compose-import extraction
(`dockerapi.RunHelper`), env file reads and the mirror copy (`deploy`'s
`runHelper`, same function), the readiness `/bin/sh` probe (now a started
`/bin/sh -c "exit 0"`, a start failure meaning no shell), the mirror loader, the
Trivy scanner, git clone and builder containers, and every `RunOneOff` (cron
jobs, the volume file browser, htpasswd writes). The self-updater's own
container is deliberately not one: it recreates the worker.

`internal/janitor` sweeps at boot and every 5 minutes: a stopped (or
never-started) helper older than 10 minutes, or a running one older than 25
hours (past the 24h cron job cap), is force-removed, one at a time, each on the
control timeout. A removal that times out marks the container **wedged**: logged
once, retried at most hourly (never in a loop), forgotten once the daemon
removes it or stops listing it (a dockerd restart). The list is `/v1/health`'s
`wedgedContainers: [{id, name, since}]`; the app's `CoreServicesWatch` turns
each newly wedged container into one `docker_wedged` notification
(`WedgedReporter`) and `AdminService`'s `docker-wedged` setup check into a
danger banner, both telling the operator to `sudo systemctl restart docker`.

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
`WORKER_CONCURRENCY` (3), `WORKER_DOCKER_TIMEOUT` (60s),
`WORKER_DOCKER_STALL_TIMEOUT` (10m), `WORKER_JOB_STALL_TIMEOUT` (15m, all Go
durations, see above), `WORKER_ID` (hostname-pid), `WORKER_PORT` (7430, where
the Docker control API listens, deliberately not the agent's 7420 since a host
can run both), `WORKER_TOKEN` (the bearer token the app must present to that
API; unset, both sides derive one from `AUTH_SECRET` via
`httpapi.DeriveToken`/`config.ts`'s `deriveWorkerToken`, same HMAC, so a fresh
install needs no extra secret to configure the pair). Flags: `--version`,
`--help`.

The binary ships inside the app image at `/usr/local/bin/homerun-worker`.
Production runs a second container from the same image with that as its
`command` (the image's `/entrypoint.sh` stays the entrypoint, so the Docker
socket group fixup and the drop to the `bun` user apply), the Docker socket
mounted, the image healthcheck disabled, and the label `homerun.role=worker`:
self-update finds the worker service by that label and recreates it with the
app. The app container itself mounts no Docker socket at all any more and talks
to this one over `WORKER_URL` (`http://worker:7430` between containers, see
`docker.md`). Locally: `go run ./cmd/worker` with the app's `.env` values,
alongside `bun run dev`/`bun run dev --only=app` (`bun run dev` starts both, see
Commands in `CLAUDE.md`). `tests/integration` and the e2e bootstrap spawn it too
(`spawnWorker`, `startWorkerContainer` when e2e runs against an image).
