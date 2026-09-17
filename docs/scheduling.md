# Scheduling and the job queue

Everything that runs on a timer or in the background: scheduled redeploys, cron
jobs, the Scheduling page that lists them, and the job queue behind all of it.

## Scheduled redeploy

Off by default, per service, the Settings tab's `cronEnabled` checkbox + a
standard 5-field cron schedule. Useful for an image tracking `:latest`, or a
git-mode service you want rebuilt on a schedule rather than manually. A due
schedule queues a deploy like any other trigger, so a redeploy that's still
waiting its turn is never queued twice.

## Cron jobs

**Cron Jobs** in the sidebar is the other half of scheduling: a task on a
schedule that isn't tied to a service. Each job runs one of two ways:

- **Container**: an image (plus optional tag, command override, env vars, and
  private-registry credentials) run as a throwaway container. Homerun pulls the
  image if it's missing, runs it to completion, keeps its stdout/stderr, and
  removes the container.
- **Host command**: a shell command run through `sh -c` on the Docker host
  itself, not inside Homerun's container: a throwaway privileged `alpine:3`
  helper sharing the host's PID namespace uses `nsenter` to step into the host's
  own namespaces, so the command sees the host's filesystem, network and
  processes as root. Only the job's own env vars are set. **Admin-only**. With
  rootless Docker "the host" is the rootless daemon's own namespace, and with
  Docker Desktop or OrbStack it's their Linux VM, not your Mac.

Give it a 5-field cron schedule, a timeout (default 900s, the job is killed past
it), and turn the schedule on or off without deleting the job. Runs go through
the same [job queue](#the-job-queue) as deploys and backups, so **Run now**
returns immediately and one job never runs twice concurrently. Each run's exit
code and captured output are kept on the job's page, and enabled jobs also show
up on the Scheduling page next to cron redeploys and backups.

## The Scheduling page

`/scheduling` is one instance-wide view of everything that runs on a timer or in
the background:

- **Cron redeploys**, every service with
  [scheduled redeploy](#scheduled-redeploy) turned on, with its schedule and
  when it last fired.
- **Cron jobs**, every enabled [cron job](#cron-jobs).
- **Backups**, every volume with a
  [backup schedule](backups.md#s3-compatible-backups), and which S3 destination
  it writes to.
- **The job queue**, what's running right now, what's waiting, and how the last
  handful of jobs finished, refreshing itself every few seconds while anything
  is active.

It's a read-only overview: edit a schedule on the thing that owns it (the
service's Settings tab, the cron job's own page, the volume's page).

## The job queue

Deploys, git builds, image scans, volume backups and Docker cleanups all run
through one background worker instead of inside the request that triggered them.
That buys four things worth knowing about as an operator:

- **Repeats collapse.** Queueing a deploy for a service that already has one
  waiting doesn't queue a second, it joins the one that's already there. Push
  five times in a minute to a git-based service on a redeploy schedule and you
  get one build, not five.
- **One deploy per service at a time.** Different services still deploy in
  parallel (up to three jobs at once); the same service never deploys twice
  concurrently.
- **Linked services keep their order.** Deploying a template that links a
  database or cache queues the companions first and the primary service behind
  them, and if a companion fails, the primary is cancelled rather than started
  against a missing dependency.
- **A Docker cleanup runs alone.** A host-wide prune waits for anything already
  running to finish and holds new work back while it runs, so it can't delete
  images or build cache out from under a deploy in flight. It does take
  precedence over deploys that are merely queued.

The **Scheduling** page has a Job queue panel showing what's running, what's
waiting, and how recent jobs finished. Work that was still running when the app
was restarted is put back on the queue at next boot.

A failed deploy is not retried automatically, you'll see it fail and decide;
backups get one retry.
