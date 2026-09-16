# Operations & maintenance

The day-two pages: what the dashboard tells you about its own health, where to
look when something's wrong, and the housekeeping tools that keep a long-running
host from filling up.

## The dashboard

`/` (Overview) is the landing page after sign-in:

- **Service counts**, how many services you own and how many are running.
- **Host resources**, live CPU, memory, disk and (if an NVIDIA card with
  `nvidia-smi` is present) GPU usage for the machine Homerun runs on, refreshed
  every five seconds. It loads behind a placeholder rather than blocking the
  page, so a slow `df` never holds the dashboard up. No card, or no
  `nvidia-smi`, just means the GPU block doesn't render, it isn't an error.
- **Recent deployments** across all your services, each linking to the service
  it belongs to.
- **A setup-issues banner**, when applicable, see below.

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

`/system-logs` live-streams the **Traefik** container's own stdout/stderr, the
same push-based stream the per-service [Logs tab](services.md#logs) uses. This
is where routing problems show up: a service that deployed fine but returns 404,
a certificate that won't issue, a middleware that isn't attaching.

Homerun's own server logs are deliberately **not** here. In the compose and
installer layouts the app runs as a container like any other, but in development
it runs directly on the host, so its output is whatever your process manager,
`docker compose logs`, systemd, or the terminal you started it from, is already
capturing. App-level warnings and errors that mention a specific service are
persisted and surfaced on that service's [Errors tab](services.md#errors)
instead.

Two admin-only buttons sit on the Traefik panel, both behind a confirmation
dialog:

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
or run all of them in sequence with **Run system prune**.

There is no confirmation dialog beyond that preview, so read what's listed
before clicking. Two things worth knowing:

- **Pruning volumes deletes data.** An unreferenced Docker-managed volume is one
  no container currently mounts, which includes a volume belonging to a service
  you stopped and meant to start again.
- **Pruning networks can remove the shared `homerun` network** once the last
  container detaches from it. That's harmless, Homerun recreates it on the next
  deploy rather than assuming it exists.

A cleanup runs through the same [job queue](services.md#the-job-queue) as
deploys, and holds the queue while it runs, so it can't delete an image or build
cache out from under a deploy in flight.

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

The bell in the header is a per-account feed of lifecycle events, deploy
succeeded or failed, service created, started, stopped, an auto-redeploy firing,
and runtime errors attributed to one of your services. Click an entry to jump to
its service, mark everything read from the dropdown, or hover a row and use the
`x` to drop it.

It's deliberately a short curated list, not a log: everything Homerun logs at
warn or error level is persisted separately and shown on the relevant service's
[Errors tab](services.md#errors). Old notifications are trimmed automatically,
so the feed doesn't grow without bound.

**Notification channels** send the same kind of events outside the dashboard.
Add a Discord webhook, a generic webhook, or an email address under
**Notification Channels** in the sidebar, then pick which events each one gets
under **Profile → Notifications**: build succeeded/failed, scheduled update
succeeded/failed, manual deploy succeeded/failed, and a service going down or
recovering. A new channel starts subscribed to build and update failures only,
turn on the rest you want from that matrix. A **Send test** button on each
channel fires a sample notification so you can check the destination actually
works before relying on it; a delivery failure is shown right on the channel
(and isn't retried automatically) rather than failing silently. Email channels
need SMTP configured first, see [Configuration](configuration.md).
Provider-shaped notifications beyond Discord (Telegram, Slack) aren't built yet,
see [FAQ & limitations](faq-and-limitations.md#planned-not-yet-built).

## Upgrading Homerun itself

Homerun has no in-app self-update. How you upgrade depends on how you installed
it:

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
