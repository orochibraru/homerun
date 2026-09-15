# Logging, notifications, stats, diagnostics

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory. These sections were split out of that file, so a "see X below/above"
in the text below may now point at a section living in a sibling note rather
than in this one.

## Setup diagnostics (`src/lib/services/admin.service.ts`)

`AdminService.runSetupChecks()`, read-only diagnostics (base domain/auth
secret/origin still at their defaults, Traefik container reachable, Docker
socket reachable, SMTP fully configured if enabled), each with a severity and
the env var that fixes it. Reads `config`, which already reflects any DB-backed
instance settings merged over the env defaults (see Config and Instance settings
below), these checks just report the effective value, they don't care which
layer it came from. DNS automation (Cloudflare/Pangolin, see below) is separate
from this check, `runSetupChecks()` doesn't currently flag an unset DNS
provider, that's an opt-in feature, not a base-instance misconfiguration.

There's no standalone `/setup` page anymore (removed, it duplicated what
`/settings` already does live). `AdminService.runSetupChecks()` now only backs
the dashboard's setup-issue banner, which deep-links straight into `/settings`
with the offending field(s) highlighted: `AdminService.SETUP_CHECK_FIELDS` (same
file) maps a check's id to the `/settings` field id(s) it corresponds to;
`(protected)/+page.server.ts` builds a `highlightFields` list from the current
issues and appends it as `?highlight=a,b,c`; `/settings` is now split into one
route per tab (see the tabs convention above), so its `+layout.server.ts`
redirects to whichever tab the first highlighted field actually lives on before
that tab's own page rings the matching fields amber and scrolls the first one
into view on mount. Two checks (`auth-secret`, env-only; `traefik`, a
live-container check) deliberately have no entry in the map, nothing to
highlight for either.

## System stats (`src/lib/services/system-stats.service.ts`)

`SystemStatsService.getSystemStats()`, host-level (not per-container)
CPU/RAM/disk via Node's `os` module + a shelled-out `df -Pk .`, plus a
best-effort GPU read via `nvidia-smi` (returns `gpu: null` when absent, the
common case, not an error; no other vendor supported). CPU% needs a delta
between two samples (`os.cpus()` gives cumulative counters since boot), so a
module-scope `lastCpuSample` is diffed on each call, first call after boot
always reads 0%. Polled by the dashboard's `/system-stats` endpoint every 5s.

## Recorded resource history (`stat_sample`, `StatSampleDTO`, `$lib/remote/stats.remote.ts`)

The live poll above keeps nothing, so the graphs read a recorded history
instead. `StatsSampler` (`$lib/services/stats/stats-sampler.ts`, a
`BaseScheduler`) writes one `stat_sample` row a minute for the host and one per
service with a running container (`DockerService.sampleContainerStats`, a
non-streaming `docker stats` read), and prunes past a year every sixtieth tick.
It's the one scheduler with `runOnStart = true`: without it a fresh instance
shows an empty chart for a full minute, and unlike the due-date schedulers
there's nothing to double-fire.

`StatSampleDTO.history(range, serviceId)` buckets that table per range at query
time (`live` 15min/1min … `all` 1-day buckets) rather than maintaining rollup
tables, averaging CPU and memory and turning the **cumulative** network counters
into a per-second rate across each bucket, clamped at zero because a container
restart resets its own counters. Two Postgres details are load-bearing: the
bucket width is `sql.raw`'d rather than bound, since dividing by an untyped bind
parameter makes Postgres reject the expression as an ambiguous operator (that
was a real "Couldn't load the history" bug), and `latestPerService` uses
`selectDistinctOn`. `serviceId` null is the host itself, so the dashboard's
chart and a service's own chart are the same query.

## Logging

Every module that mutates state (`page.server.ts` actions, the Docker layer,
cascade-delete helpers) instantiates `new Logger("Domain")` from
`src/lib/logger.ts` at module scope and calls `.info()`/`.warn()`/`.error()` on
start/success/failure of each operation, with entity + user ids for correlation.
`App.Locals.logger` is declared in `app.d.ts` but never populated, that's
dead/aspirational, don't use it; the per-module `Logger` instance is the real
pattern.

## In-app notifications (`notification` table, `NotificationDTO`, `notification-bell.svelte`)

A curated, per-user lifecycle event feed, deliberately separate from the
`app_log`/Errors-tab system above: written explicitly at each event site rather
than derived from logs, so it stays a short, meaningful list rather than every
warn/error the app produces. Shown via a bell icon
(`$lib/components/notification-bell.svelte`, a Popover-based dropdown) in the
protected layout's header, next to `$lib/components/profile-menu.svelte` (the
account/sign-out dropdown, pulled out of `+layout.svelte`'s previously-inline
markup as its own component alongside this feature).

- `notification` table: `id`, `userId` (FK, cascade delete), `serviceId`
  (nullable FK, cascade delete), `message`, `type` (enum:
  `deploy_success`/`deploy_failure`/`service_created`/`service_started`/
  `service_stopped`/`auto_redeploy`/`app_runtime_error`), `createdAt`, `readAt`
  (nullable, unread until set). Indexed on `(userId, createdAt)`.
- `NotificationDTO`: `listForUser(userId, limit=30)` (joins in the related
  service's slug so a feed entry can link straight to it),
  `unreadCount(userId)`, `markRead`/`markAllRead`/`delete(id, userId)` (owner-
  scoped, backs the bell dropdown's per-row remove button), and a
  fire-and-forget static `notify(input)` helper, never awaited, swallows its own
  errors, same posture as `Logger.warn`/`.error`'s `AppLogDTO` write, a
  notification call can't fail the operation it's attached to. `create`
  amortized-prunes each user back to their newest 200 rows on ~5% of writes,
  same convention as `AppLogDTO`'s 5000-row prune.
  `notifyServiceError(serviceId, message)` is the one unscoped-by-owner query on
  this DTO (same precedent as `ServiceDTO.listCronEnabled`), used by
  `Logger.error` to attribute a runtime error notification without threading a
  userId through every call site.
- Call sites: `deploy.service.ts` (deploy success, auto-redeploy, deploy
  failure), `$lib/logger.ts` (`Logger.error` → `notifyServiceError`),
  `services/new/+page.server.ts` (service created), the service Overview page's
  start/stop actions.
- `notification-bell.svelte` owns its own data end to end through
  `$lib/remote/notifications.remote.ts` (see Remote functions above) : one query
  for the feed plus unread count, and one command per
  mark-read/mark-all-read/delete, each refreshing that query server-side so the
  new feed comes back on the mutation's own response. It takes no props. This
  replaced fetching the feed in `(protected)/+layout.server.ts` (paid for on
  every protected page load, opened bell or not) and three one-line `+server.ts`
  routes each followed by a full-page `refreshAll()`.

This closes the "in-app lifecycle event feed" half of what Planned features
below used to list as unbuilt; outbound webhooks (Telegram/Discord/generic HTTP)
on the same events are still unbuilt, see below.
