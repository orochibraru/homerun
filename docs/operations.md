# Operations & maintenance

The day-two pages: what the dashboard tells you about its own health, where to
look when something's wrong, and the housekeeping tools that keep a long-running
host from filling up.

## The dashboard

`/` (Overview) is the landing page after sign-in:

- **Service counts**, how many services the instance has and how many are
  running.
- **Host resources**, live CPU, memory, disk and (if an NVIDIA card with
  `nvidia-smi` is present) GPU usage for the machine Homerun runs on, refreshed
  every five seconds. It loads behind a placeholder rather than blocking the
  page, so a slow `df` never holds the dashboard up. No card, or no
  `nvidia-smi`, just means the GPU block doesn't render, it isn't an error.
- **Resource usage history**, the same host CPU and memory as a chart, live or
  over the last hour, day, week, month, year or all of it, from a sample taken
  every minute and kept for a year, next to a **per-service usage** table of the
  five services using the most (sort it by CPU, memory or traffic). A stack's
  own page has the same table for its members, and a service's Overview tab has
  its own chart.
- **Recent deployments** across every service, each linking to the service it
  belongs to.
- **Recent errors**, the latest warn/error-level log lines, each linking to the
  service it mentions (or to System Logs when it mentions none). An admin sees
  the instance's most recent errors, including ones that mention no service; a
  developer only sees ones that mention a service.
- **Quick actions**, shortcuts to deploy a service and to the services list.
- **A setup-issues banner**, when applicable, see below.

## Search

The **Search…** button in the header, or `⌘K` / `Ctrl+K` anywhere, opens a
command palette. It jumps to any dashboard page by name, and once you've typed
two characters it also searches the instance's services, stacks, templates, cron
jobs, storage volumes, S3 destinations, remote hosts, build cache registries,
git providers, notification channels and status pages, plus users and
authentication providers for an admin.

## Setup diagnostics

Homerun runs a handful of read-only checks on every dashboard load: base domain,
Origin and auth secret still at their defaults, the Traefik container reachable,
the Docker socket reachable, and SMTP fully configured if you turned it on. Any
that aren't OK show up as a banner at the top of the dashboard.

The banner links straight into `/settings`, on whichever tab the offending field
lives, and rings the relevant fields so you can see what it's complaining about
rather than hunting for it. Two checks have nothing to deep-link to: the auth
secret is env-only (`AUTH_SECRET`, change it and restart), and the Traefik check
is about a live container rather than a setting.

There's no separate `/setup` page, the banner plus `/settings` is the whole
flow.

## System Logs

`/system-logs` (admin-only) live-streams the logs of the infrastructure Homerun
depends on, with the same push-based viewer the per-service
[logs panel](services.md#logs) uses.

- **This instance's stack** lists every container your compose file starts,
  Homerun itself, Postgres and Traefik included, with its state. Click one to
  open its live log. It only appears when Homerun runs as a Docker Compose
  service; run from source, the app's own output is whatever your terminal or
  process manager is already capturing.
- **Traefik** streams the Traefik container's stdout/stderr. This is where
  routing problems show up: a service that deployed fine but returns 404, a
  certificate that won't issue, a middleware that isn't attaching.

App-level warnings and errors that mention a specific service are also persisted
and surfaced on that service's [Observability tab](services.md#errors).

Two buttons sit on the Traefik panel, both behind a confirmation dialog:

- **Restart**, restarts the Traefik container in place. Useful after a change
  Traefik only reads at startup (its static config/flags).
- **Update**, pulls the image reference Traefik is already running
  (`traefik:v3`, or whatever tag your compose file pins) and, if that pull
  produced a genuinely newer image, recreates the container from it with the
  same configuration, restarting it if it was running. If the pull returns the
  image already in use, nothing is recreated and it tells you so. Pinning an
  exact version tag means this is a no-op by design, which is the point of
  pinning.

Neither button edits your compose file. A `docker compose up -d` later still
brings Traefik back with whatever that file says.

## Docker Cleanup

`/docker-cleanup` (admin-only) is `docker system df` and `docker system prune`
from the dashboard. **Unlike everything else in Homerun it is not scoped to
containers Homerun created**, that's the entire point of a cleanup tool: it can
see, and remove, anything on the host's Docker daemon.

The page previews what's actually reclaimable before you commit, unused images,
stopped containers, unreferenced volumes, unused networks (excluding Docker's
own three defaults and anything still attached), and unused build cache, with
the space each category would free. You can then prune each category on its own,
or use **Quick cleanup → Clean up now**, which prunes stopped containers,
dangling images, unused networks and build cache together, the same set as
`docker system prune`, and never touches volumes. Every action asks for
confirmation first.

- **Images** prunes only dangling images by default. Tick **Include tagged,
  unused images** to remove any image no container uses. The last few images of
  every service are kept either way, see
  [Revisions and rollback](services.md#revisions-and-rollback).
- **Networks** also offers **Reclaim orphaned stack networks**: the per-stack
  networks whose stack no longer exists, which Docker's own prune can't see
  while anything is still attached. A network with containers attached is left
  alone.

Two things worth knowing:

- **Pruning volumes deletes data.** An unreferenced Docker-managed volume is one
  no container currently mounts. A storage volume mounted into a Homerun service
  is always kept, even while that service is stopped or has no container at all,
  but a volume another tool created and no container uses is removed.
- **Pruning networks can remove the shared `homerun` network** once the last
  container detaches from it. That's harmless, Homerun recreates it on the next
  deploy rather than assuming it exists.

A cleanup runs through the same [job queue](services.md#the-job-queue) as
deploys, and holds the queue while it runs, so it can't delete an image or build
cache out from under a deploy in flight.

### Image mirror

The **Image mirror** panel shows how much disk the `homerun-mirror` registry
[image scanning](services.md#image-scanning) copies images into is using, and
**Clean up mirror** garbage-collects it. The same cleanup runs on its own every
day at 04:00 (postponed within that hour while a deploy or scan is queued or
running). It:

1. keeps, per service, the current `image:tag`, the digest of its last
   successful deploy and its last two scanned digests. An older kept version
   whose tag has moved on is re-tagged `homerun-keep-<digest>` so the next step
   doesn't sweep it;
2. deletes every other manifest through the registry API, which needs the
   registry started with `REGISTRY_STORAGE_DELETE_ENABLED=true`. A mirror
   created by an older Homerun without it is recreated once, its
   `homerun-mirror-data` volume stays;
3. runs `registry garbage-collect --delete-untagged` inside the container,
   removes the repositories nothing is left in, and restarts the registry so its
   in-memory blob cache doesn't claim a deleted layer still exists.

Like the other cleanups it is a queued job that holds the queue, and a deploy
that starts while it runs anyway skips the mirror and pulls directly. The job
result and the app log record how many manifests were deleted and the bytes
reclaimed.

## The Scheduling page

`/scheduling` is one instance-wide view of everything that runs on a timer or in
the background:

- **Cron redeploys**, every service with
  [scheduled redeploy](services.md#scheduled-redeploy) turned on, with its
  schedule and when it last fired.
- **Cron jobs**, every enabled [cron job](services.md#cron-jobs).
- **Backups**, every volume with a
  [backup schedule](storage-and-backups.md#s3-compatible-backups), and which S3
  destination it writes to.
- **The job queue**, what's running right now, what's waiting, and how the last
  handful of jobs finished, refreshing itself every few seconds while anything
  is active.

It's a read-only overview: edit a schedule on the thing that owns it (the
service's Settings tab, the cron job's own page, the volume's page).

## Notifications

The bell in the header is a per-account feed of lifecycle events on every
service, whoever created it (each account gets its own copy to read and clear),
deploy succeeded or failed, a build stopped by status checks, an unhealthy or
rolled back revision, service created, started, stopped, an auto-redeploy
firing, an image scan finding a critical vulnerability, and runtime errors
attributed to a service. Click an entry to jump to its service, mark everything
read from the dropdown, or hover a row and use the `x` to drop it.

It's deliberately a short curated list, not a log: everything Homerun logs at
warn or error level is persisted separately and shown on the relevant service's
[Observability tab](services.md#errors). Old notifications are trimmed
automatically, so the feed doesn't grow without bound.

**Notification channels** send the same kind of events outside the dashboard.
Add a Discord webhook, a Slack incoming webhook, a Telegram bot, a generic
webhook, or an email address under **Notification Channels** in the sidebar,
then pick which events each one gets under **Profile → Notifications**: build
succeeded/failed, a build stopped by failing
[status checks](services.md#required-status-checks), scheduled update
succeeded/failed, manual deploy succeeded/failed, a new revision found unhealthy
or [rolled back](services.md#revisions-and-rollback), an image scan finding
[critical vulnerabilities](services.md#image-scanning), and a service going down
or recovering (from its [uptime probe](services.md#uptime)). A new channel
starts subscribed to build and update failures, status checks failures,
unhealthy revisions and rollbacks; turn on the rest you want from that matrix. A
**Send test** button on each channel fires a sample notification so you can
check the destination actually works before relying on it. A delivery failure is
shown right on the channel rather than failing silently, and retried in the
background through the job queue: first after 30 seconds, then after 20, 40 and
80 more, four tries in all, visible as **Notification** jobs in the Scheduling
page's job queue. A retry is dropped once the channel is removed, disabled or
unsubscribed from that event, and a successful one clears the error. The test
button isn't retried. Email channels need SMTP configured first, see
[Configuration](configuration.md).

- **Slack**: create an
  [incoming webhook](https://api.slack.com/messaging/webhooks) for the channel
  and paste its `https://hooks.slack.com/services/…` URL.
- **Telegram**: create a bot with @BotFather, add it to the group or channel,
  then enter the bot token and the chat id (a number like `-1001234567890`, or a
  public channel's `@name`). The token is stored with the channel but never
  shown again, the list only shows the chat.

## Status pages

**Status Page** in the sidebar builds an uptime page out of your services'
[uptime probes](services.md#uptime). Each page has a name, a slug and an
optional description, and covers one of three sets: **every service**, **one
stack**, or **services you pick**. Its page in the dashboard shows each
service's recent heartbeats and uptime percentage.

Tick **Publish this page** to make it readable without signing in at
`/status/<slug>` on your dashboard's address; the page shows the copyable link.
A public page shows only service names, up/down, and uptime over the last 40
checks from the network probe: never images, ports, hostnames or probe errors.
An unpublished page is a 404 there.

## Upgrading Homerun itself

The sidebar shows the version you're running. Admins also see a notice there
when a newer GitHub release exists (checked at most once an hour). Clicking it
opens the update dialog:

- It refuses while a deployment is queued or running, or while any other job
  (backup, cron job, cleanup) is running. Wait, then **Check again**.
- **Update now** holds the job queue, so nothing new starts, then launches a
  short-lived `homerun-updater` container (`docker:cli`) with the Docker socket
  and your compose directory mounted. It runs `docker compose pull` then
  `docker compose up -d --no-deps` for the Homerun service only. Traefik and
  Postgres aren't touched.
- If your compose file or `.env` pins a version tag (`image: …:v1.0.20`, or
  `HOMERUN_VERSION=v1.0.20` with `compose.prod.yaml`), that tag is bumped to the
  new release first. `latest` is just pulled again.
- The dashboard is down for a few seconds and the page reloads itself once the
  new version answers. Jobs that were waiting run once it's back. If it doesn't
  come back, run `docker logs homerun-updater` on the host.

This only works when Homerun runs as a Docker Compose service, since it reads
its own container's compose labels to find the project. Anywhere else the dialog
explains that instead, and you upgrade by hand:

- **Docker Compose** (`compose.prod.yaml`, or the installer's generated file):
  `docker compose pull && docker compose up -d` from the directory holding it.
  Database migrations run automatically on boot, there's no separate migrate
  step.
- **The CLI** updates itself: `homerun update`, see
  [API & CLI](api-and-cli.md#cli).
- **The Homerun Agent** on a build server is a plain binary, replace it and
  restart its `systemd --user` unit, see
  [`packages/agent/README.md`](../packages/agent/README.md).

Take a Postgres dump before a major upgrade. Migrations are applied forward-only
and there's no downgrade path.

## Next steps

- [Configuration](configuration.md), what's settable and where.
- [Storage & backups](storage-and-backups.md), keeping your data.
- [FAQ & limitations](faq-and-limitations.md), what's a known gap.
