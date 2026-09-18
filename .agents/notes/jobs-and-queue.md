# Job queue, schedulers, backups

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory. These sections were split out of that file, so a "see X below/above"
in the text below may now point at a section living in a sibling note rather
than in this one.

## Job queue and worker (`job` table, `JobDTO`, `$lib/services/queue.service.ts`, `$lib/services/queue/`)

Every long-running, side-effecting operation in this app, deploys (including git
builds), volume backups, user-defined cron jobs, and host-wide Docker cleanups,
goes through one DB-backed queue drained by one in-process worker, instead of
running inline in whichever request or scheduler tick happened to trigger it.
That's what makes "five pushes in a minute" collapse into one build, what stops
two deploys of the same service racing each other, and what keeps a
`docker prune` from sweeping layers out from under a running build.

- **`job` table / `JobDTO`** (`src/lib/dto/job-dto.ts`) is the queue itself.
  Beyond the obvious (`type`, `payload` jsonb, `status`, `attempts`/
  `maxAttempts`, `runAt`, `error`, `result`, `title` for the UI), four columns
  carry the whole scheduling policy, and `JobDTO.claimNext()` is the one place
  they're interpreted:
  - **`dedupeKey`** collapses repeats. A partial unique index
    (`job_type_dedupeKey_queued_uidx`, `where status = 'queued'`) makes it a
    real DB-level constraint, not a check-then-insert race : a second
    `deploy:<serviceId>` while one is still waiting its turn is rejected by
    Postgres, and `QueueService.enqueue()` returns the already-queued job
    instead. Once that job starts running the key frees up, so a push landing
    mid-build still queues a follow-up build rather than being lost.
  - **`lockKey`** serialises. Only one _running_ job may hold a given key, so
    `service:<id>` means one deploy per service at a time while other services
    deploy in parallel.
  - **`dependsOnJobId`** orders a chain. A job is only claimable once its
    dependency has actually `succeeded`; if that dependency fails permanently,
    `JobDTO.cancelDependents()` cancels the rest of the chain transitively
    rather than leaving it queued behind something that will never finish. This
    is what replaced the sequential `await deployService()` loop that used to
    bring a template's linked stack up in order inside the request handler (see
    `DeploymentService.enqueueStackDeploy`).
  - **`exclusive`** is the host-wide barrier, used by Docker cleanup. An
    exclusive job runs alone (nothing else is claimed while it runs, and it
    waits for whatever is already running), and while one is _queued_ nothing
    else is claimed either, so it can't starve behind a steady trickle of
    deploys. The deliberate consequence, verified rather than assumed: a queued
    prune takes precedence over already-queued deploys, and only waits on
    in-flight ones. The reverse rule would block a waiting admin behind an
    unbounded deploy backlog.

  The claim itself is one `for update skip locked` select inside a transaction,
  so two concurrent claimers pick two different rows rather than racing for the
  same one.

- **`QueueService`** (`$lib/services/queue.service.ts`) is the enqueue/wait API
  every caller uses : `enqueue()` (with the coalescing described above),
  `wait(jobId)` (poll to a terminal status, for the two callers that must keep
  their synchronous contract), plus the list helpers the Scheduling page reads.
- **`JobWorker`** (`$lib/services/queue/worker.ts`) is a fourth `BaseScheduler`
  subclass alongside the three cron schedulers, overriding `intervalMs` to a 1s
  poll (`BaseScheduler` gained both that knob and a non-overlapping-tick guard
  for this). Started from `hooks.server.ts`'s `init()`. Each tick claims up to
  `MAX_CONCURRENT_JOBS` (3) jobs, claiming _serially_ so each claim sees the
  previous one's committed `running` row (a parallel batch of claims would each
  run in its own uncommitted transaction and could hand out two jobs sharing a
  `lockKey`). On the very first tick it calls `JobDTO.requeueOrphaned()` : this
  app runs one worker, so any row still `running` at boot was left there by a
  process that died, and is put back on the queue. `runJob()` is public
  specifically so `tests/unit/app/queue.test.ts` can drive the
  succeed/retry/permanently-fail decision without an interval.
- **Go-executed job types** skip their in-process handler: a non-null module in
  `$lib/services/queue/worker-jobs/` makes `runJob` run its `prepare` step and
  hand the job to the Go worker, and the tick's finalize pass runs its
  `finalize` step once the worker reports back. See `worker.md`.
- **`$lib/services/queue/handlers.ts`** maps a `JobType` to its handler
  (`deploy` → `DeploymentService.deployService`, `backup` →
  `S3BackupService.backupVolume`, `cron_job` → `CronJobService.runJob`,
  `docker_cleanup` → the matching `DockerService.prune*` (unused now, the Go
  worker runs it, see `worker.md`), `notification_delivery` →
  `NotificationChannelService.retryDelivery`), each parsing its own payload
  through a zod schema in `queue/payloads.ts` rather than casting : a payload
  written by an older version of the app fails as a clean job error instead of
  deep inside dockerode. Throwing is how a handler reports failure. Kept in its
  own module so `QueueService` stays importable from `deploy.service.ts` without
  an import cycle (`handlers` → `deploy.service` → `queue.service`, and `worker`
  → `handlers`, so `hooks.server.ts` imports the worker directly).

**What changed at each trigger point.** `DeploymentService.deployService()` is
unchanged as the actual pipeline and is still the single source of truth; what
moved is _who calls it_. `DeploymentService.enqueueDeploy()` creates the
`deployment` row up front with status `"pending"` (and sets the service's
`currentStatus` to match) and queues the job, so the Overview tab's existing
progress polling, which already treated `pending` as in-flight and already
resumes from `svc.currentStatus` after a reload, works unchanged for a deploy
that hasn't started yet. `deployService()` now reuses an existing deployment row
when handed its id instead of always creating one.

**The Overview tab's progress polling had to grow two things for this**, both
real bugs found by driving a template quick-deploy in a real browser rather than
by reading the code. It now `refreshAll()`s on every status transition and once
more at the end : the header status pill and the deployment-history rows come
from `load`, not from the progress endpoint, so a deploy started _somewhere
else_ (a quick-deploy, the create wizard, cron) left them frozen at whatever
they were when the page loaded, and only a manual reload caught up. And
`onMount` resumes from the latest deployment row's own `status`, not just
`svc.currentStatus` : on a redeploy the layout's `syncServiceStatus` inspects
the still-running _old_ container and writes `"running"` back over the in-flight
`"pending"`, so the service-level check alone could miss a deploy that really
was in flight. The progress panel also renders while
`pendingAction === "deploy"` even with zero log lines yet (a queued job, or a
pull that hasn't emitted a status change), showing "Waiting for the deploy to
start…" rather than nothing, and the "this service hasn't been deployed yet"
banner is suppressed during a first deploy.

- Service Overview's `deploy` action, `services/new`'s `createAndDeploy`, the
  templates gallery's `quickDeploy` and the cron redeploy scheduler all enqueue
  and return immediately. The two create-a-service-and-deploy-it paths no longer
  block the request on a real image pull at all, which is what makes the
  redirect land on the service page with live progress instead of a spinning
  button.
- `POST /api/v1/services/<id>/deploy` enqueues _and_ `QueueService.wait()`s, so
  its "returns once the deploy is done" contract (and therefore
  `homerun services deploy`) is unchanged, verified by `tests/integration/`'s
  real deploy tests still passing untouched.
- The Docker Cleanup page's six actions likewise enqueue-and-wait (via
  `$lib/services/docker-cleanup-queue.ts`, split out of the route file so the
  route keeps no manual typing), since the page renders the reclaimed-space
  summary. They also gained `allowLongRequest()`, which they were missing.
- Backups (`/backups`'s and `storage/[volumeId]`'s "Run now", plus the backup
  scheduler) enqueue and return : a tar-and-upload could comfortably outlive
  Bun's idle timeout, and neither route called `allowLongRequest()`. The
  `backup_run` row is still written by `S3BackupService.backupVolume()` when the
  job actually starts.

**Retries** are per job type (`maxAttempts`, default 1) with exponential backoff
: backups get 2 attempts, a notification channel delivery retry gets 4 (queued
30s after the inline attempt failed, see Outbound notification channels in
`observability.md`), deploys and cleanups get one, since a failed deploy is
something the user should see and decide about rather than have silently
retried. Finished rows are amortized-pruned after 7 days on ~2% of inserts, the
same convention as `AppLogDTO`/`NotificationDTO`.

**Visibility** is the Scheduling page's new "Job queue" section
(`$lib/components/job-queue-panel.svelte`, which loads itself through
`$lib/remote/jobs.remote.ts` rather than taking props off that page's `load`,
running/queued plus the last 15 finished, refreshing itself every 3s while
anything is active).

**Verified against real Postgres**, not just reasoned about : a throwaway
database driven through `JobDTO` directly covered dedupe/coalescing, the lock
key skipping a same-service job while claiming another, dependency gating and
transitive cancellation, both directions of the exclusive barrier, priority
ordering, `runAt` gating and retry rescheduling, orphan requeue, and eight
racing `claimNext()` calls handing out five jobs exactly once each. The
browser-level flow was verified live too : a real template quick-deploy against
an isolated instance, driven through Playwright, lands on the service page with
the progress panel already streaming, no stale "not deployed yet" banner, and
the status pill reaching RUNNING with no manual reload. The API-level end-to-end
path is covered by `tests/integration/` (real image pulls, real containers,
local deploys, git builds, and the failure path) passing unchanged through the
queue, and the policy layer by `tests/unit/app/queue.test.ts`.

## Schedulers (`src/lib/services/cron.service.ts`, `src/lib/services/cron/`)

`CronService` (`cron.service.ts`) composes three instances of one generic
`DueScheduler<T>` (`cron/due-scheduler.ts`), one per scheduled concern: cron
redeploy (`ServiceDTO.listCronEnabled()` → `DeploymentService.enqueueDeploy`),
S3 backup (`StorageVolumeDTO.listBackupEnabled()` → `enqueueVolumeBackup`) and
user cron jobs (`CronJobDTO.listEnabled()` → `enqueueCronJobRun`, see Cron jobs
above). All three were separate near-identical classes before; the config object
(`list`/`schedule`/`lastRunAt`/`markRun`/`fire`/`describe`/`label`) is the only
thing that actually differed. Each `list()` is unscoped by user, since a
scheduler isn't running on behalf of a request. Due-checking is
`cronMatches(schedule, now)` plus a `sameMinute(lastRunAt, now)` guard against a
double-fire within one matching minute.

A fourth scheduler doesn't fit `DueScheduler` and extends `BaseScheduler`
directly: `StatsSampler` (`$lib/services/stats/stats-sampler.ts`) has no
schedule expression and no per-row `lastRunAt`, it just samples every tick, see
Recorded resource history in `observability.md`. It's also the only one with
`runOnStart = true`.

`DueScheduler` extends `BaseScheduler` (`cron/base-scheduler.ts`), which owns
the shared "60s `setInterval`, HMR-safe via a `globalThis`-backed registry keyed
on `label`, non-overlapping ticks, idempotent `start()`" boilerplate. **Keyed on
`label`, not `constructor.name`**: three instances of the same class would
collide on the latter. `JobWorker` (`queue/worker.ts`) is the fourth subclass,
overriding `intervalMs` to a 1s poll, see Job queue and worker above.
`CronService.startCronScheduler()`/`startBackupScheduler()`/
`startCronJobScheduler()` (all called from `hooks.server.ts`'s `init()`) just
call `.start()` on the composed instance.

`cron/cron-expression.ts` holds the small dependency-free 5-field cron matcher
(wildcard/number/range/list/step, minute resolution, server-local time, no
external cron package, matching this app's generally dependency-light posture)
as plain exported functions (`parseCronSchedule`/`cronMatches`/`sameMinute`),
pure and stateless, so it stays outside the class hierarchy, same "pure
transform doesn't need an instance" precedent as `docker/labels.ts`;
`CronService.parseCronSchedule`/`cronMatches` just delegate to it, and two
route-level validation call sites call those directly. Day-of-month and weekday
follow the standard cron OR rule: when **both** fields are restricted a date
matches if **either** does (`0 0 1 * 1` fires on the 1st _and_ every Monday);
when one is a wildcard only the other applies. "Restricted" means the field
doesn't start with `*`, matching Vixie cron's own star flag, so `*/2` counts as
unrestricted. Covered by `tests/unit/app/cron-expression.test.ts`.

## Cron jobs (`cron_job`/`cron_job_run` tables, `CronJobDTO`, `$lib/services/cron-job.service.ts`, `/cron-jobs`)

A user-defined scheduled task that isn't tied to a service, unlike
`service.cronSchedule` (which redeploys an existing service). Two kinds:

- **`kind: "image"`** runs a throwaway container via `DockerService.runOneOff`
  (see the one-off mixin under Docker integration): image + tag, an optional
  command override, env vars, and optional private-registry credentials
  (`registryPasswordEnc`, same AES-256-GCM scheme as everything else). The
  command override is parsed by `$lib/command-parse.ts`'s `parseCommand`, a
  small pure tokenizer (quotes group, backslash escapes, and a leading `[` is
  taken as Docker-style JSON exec form), tested in
  `tests/unit/app/command-parse.test.ts`.
- **`kind: "exec"`** ("Host command") runs on the Docker host itself, not in the
  app's container: `DockerService.runOneOff` with `privileged: true`,
  `pidMode: "host"` and a throwaway `alpine:3` helper whose command is
  `nsenter -t 1 -m -u -i -n -p -- sh -c <command>` (`docker/host-command.ts`'s
  `hostCommandArgs`, busybox ships `nsenter`). It used to be `execFile` inside
  the app container, which is not the host at all once Homerun runs from
  compose, and handed the app's own environment (`AUTH_SECRET`, `DATABASE_URL`)
  to the command; now only `job.envVars` reach it, output streams through the
  same `OutputFlusher` as image jobs, and the timeout is `runOneOff`'s kill.
  Verified by hand: `docker run --rm --privileged --pid=host alpine:3` running
  that `nsenter` line with `hostname` prints the host's (OrbStack VM's)
  hostname. Under rootless Docker PID 1 of the daemon's PID namespace is
  rootlesskit's, so "host" there means the rootless user namespace.
  **Admin-only, enforced in `$lib/server/cron-job-form.ts`** (shared by both the
  create and edit actions, so neither can skip it) rather than only hidden in
  the UI : it is root on the host, the same class of power the Docker socket
  already gives.

`CronJobService.runJob(job)` is the single entry point both the scheduler and
the manual "Run now" funnel through, and it writes one `cron_job_run` row per
attempt on every path including a thrown runner, same shape as
`S3BackupService.backupVolume`. A run keeps `exitCode`, `success`, `error`, and
the captured stdout+stderr (`CronJobRunDTO.finish` keeps the **last** 64k
characters rather than the first, since a failure's useful output is at the
end).

Wiring follows the existing patterns exactly rather than inventing anything:
`JobType` gains `"cron_job"` (`$lib/types.ts` + `JOB_TYPE_LABELS`), with its own
zod payload (`queue/payloads.ts`) and handler (`queue/handlers.ts`), an
`enqueueCronJobRun` helper (`cron-job-queue.ts`, mirroring `backup-queue.ts`)
keyed `cron_job:<id>` for both dedupe and lock so one job never runs twice
concurrently, and a third `DueScheduler<T>` instance (`cronJobScheduler` in
`cron.service.ts`, started from `hooks.server.ts`) with the same due-check plus
same-minute double-fire guard as the redeploy and backup schedulers. Routes are
the usual list/new/detail trio (`/cron-jobs`, `new/`, `[cronJobId]/`) sharing
one form component (`$lib/components/cron-job-fields.svelte`) and one
server-side parser (`$lib/server/cron-job-form.ts`); enabled jobs also render on
the Scheduling page next to cron redeploys and backups.

**Executed by the Go worker** (`worker-jobs/cron_job.ts`,
`internal/jobs/cronjob`). `CronJobService.prepareRun` creates the run row and
resolves the spec (image ref or the `nsenter` helper, parsed command, env,
labels, registry auth, and for an image job on a `"docker"` build server its
`tcp://` connection; `ssh://` hosts are rejected by the worker, agent hosts by
prepare). Go runs it through `dockerapi.RunOneOff`, appends output to
`cron_job_run.output` at most once a second, and returns
`{exitCode, output, timedOut}`; `CronJobService.finishRun` maps that onto the
outcome (same messages as before) and finishes the run. `CronJobService.runJob`
is the old in-process path, dead while the worker job is on.

## S3 backups (`src/lib/services/s3-backup.service.ts`, `/backups`, `/s3-destinations`)

Per-volume, off by default. The destination itself is a separate, named,
reusable row (`s3_destination`, `S3DestinationDTO`, managed on
`/s3-destinations`) that a volume points at via `storageVolume.s3DestinationId`,
so several volumes can share one bucket/credential pair; the volume only owns
`backupEnabled`/`backupSchedule`/`backupPrefix`, edited on `storage/[volumeId]`.
Every attempt, scheduled or manual, writes a `backup_run` row (`BackupRunDTO`,
created before the attempt and finalized on every return path, including
validation failure), and `/backups` is the page over that history, plus a "Run
now" action per volume, the same one `storage/[volumeId]` offers.
`S3BackupService` (`s3-backup.service.ts`) holds the whole tar-then-upload
pipeline (`backupVolume()` → `attemptBackup()`: open the run row, validate
config, resolve+decrypt the named destination, tar the volume, finalize the run
row, return the result) plus restore (`listBackups()`/`restoreVolume()`), over a
hand-rolled AWS Signature V4 client (`putObject`/`signedRequest`, module
functions) (single-request PUT, no multipart, no SDK dependency, verified
end-to-end against a local MinIO container during development) that works
against any S3-compatible endpoint (AWS S3, MinIO, R2, B2, etc.) via path-style
addressing. `S3BackupService.backupVolume(volume)` (a singleton instance,
`export const S3BackupService = new S3BackupServiceClass()`) is the callable
entry point every route/scheduler uses; it PUTs the tarball as
`<prefix/>volumeName-<timestamp>.tar.gz`. **Both volume kinds are supported**:
`kind: "bind"` is tar'd straight off the host (`execFile("tar", ...)`), and
`kind: "volume"` (Docker-managed, whose content isn't visible on the host
filesystem the same way) is mounted read-only into a throwaway `alpine:3`
container that tars it to stdout, via `DockerService.runOneOff` (see the one-off
mixin under Docker integration below). Both paths produce the same bytes, so
only `S3BackupService`'s private `archiveHostPath()`/`archiveNamedVolume()`
branch, `attemptBackup` and every caller are kind-agnostic. A non-zero exit from
the helper fails the run with the helper's own stderr attached, rather than
uploading a truncated/empty tarball. Scheduled backups are one `DueScheduler`
config over `StorageVolumeDTO.listBackupEnabled()`, see Schedulers above.
Restore is `S3BackupService.restoreVolume()`, run as a `backup_restore` job, see
Restoring an S3 backup below.

**Quiescing** lives in `$lib/services/backup/volume-services.ts`
(`VolumeServices`). `storage_volume.backupStopServices` wraps the tar (not the
upload) in `whileStopped`: services mounting the volume
(`ServiceVolumeDTO.serviceIdsForVolume`) that a live `syncServiceStatus` says
are running get `ServiceLifecycleService.stopService`'d one by one, and every
one that was stopped is started again in a `finally`, a failed start logged
rather than thrown. The ordering policy is the pure `stopAroundWork`, covered by
`tests/unit/app/volume-services.test.ts`. `backupPreCommand` runs first, while
everything is still up, through `/bin/sh -c` via `DockerService.execInContainer`
(one-off mixin, a hijacked exec with a 15 minute wait cap) inside
`backupPreCommandServiceId`'s container (swarm: the running task's container),
or the first running service using the volume when none is picked. A non-zero
exit fails the run with the output tail, before anything is tarred. Both are
per-volume, which is also per-schedule, since a volume has one schedule.

## Cron jobs on another daemon, and live output

`cron_job.remoteHostId` (nullable FK to `remote_host`, "Run on" on the job form)
picks which daemon a kind `image` job runs its container on;
`RemoteHostDTO.resolveBuildTarget` resolves it the same way a build server is
resolved, and an **agent** host is refused with a message rather than silently
running locally : the agent has no one-off run endpoint. Kind `exec` ignores it
by definition, it's a shell command on the host of this app's own Docker daemon.

**Output arrives while the job runs, not after it.** `runOneOff` takes an
`onOutput` callback fed from the same demuxed stdout/stderr streams it already
collects, and `CronJobService`'s `OutputFlusher` batches those chunks into
`CronJobRunDTO.appendOutput` once a second (one write a second, not one per
chunk). The job's page re-reads `getCronJobRuns` every 2s while any run has no
`finishedAt`, so a long job shows progress instead of a spinner and then a wall
of text.

## Restoring an S3 backup

`S3BackupService.listBackups(volume)` is ListObjectsV2 against the volume's own
prefix (same hand-rolled SigV4 as the upload, `signedRequest` shared between GET
and LIST), and `restoreVolume(volume, key, { wipe, stopServices })` downloads
one and unpacks it back into the volume.

**It's a queue job**, `backup_restore` (`enqueueVolumeRestore` in
`backup-queue.ts`, payload `backupRestoreJobPayload`), deduped on
`restore:<volumeId>`, sharing `volume:<volumeId>` as its lock with backups so a
restore never races a tar of the same volume, and `maxAttempts: 1` (retrying a
half-applied restore isn't something to do silently). It writes a `backup_run`
row with `kind: "restore"` and the object `key` (backups now record their
uploaded `key` too), so the run log and `/backups` (Kind filter) show both. The
download happens before `whileStopped`, so services are down only for the
optional `VolumeServices.wipe` (a helper `find <mount> -mindepth 1 -delete`) and
the unpack. **Docker's own archive endpoint does the unpacking**
(`DockerService.extractIntoVolume` → `putArchive` into a stopped helper
container with the target mounted): it accepts a gzipped tar directly, needs no
`tar` on this host, no stdin plumbing into a running container, and works
against a remote daemon. One path covers both volume kinds, since a bind's
source is as mountable as a named volume.

Without `wipe` it's a **restore-over** : files in the archive replace what's on
disk and anything else is left alone. `stopServices` defaults to on in the UI;
the confirm dialog's text follows both toggles.
