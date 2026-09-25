# Logging, notifications, stats, diagnostics

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory. These sections were split out of that file, so a "see X below/above"
in the text below may now point at a section living in a sibling note rather
than in this one.

## Setup diagnostics (`src/lib/services/admin.service.ts`)

`AdminService.runSetupChecks()`, read-only diagnostics (base domain/auth
secret/origin still at their defaults, Traefik container reachable, the Go
worker and its Docker socket reachable, SMTP fully configured if enabled), each
with a severity and the env var that fixes it. **The Docker check is really two,
reported apart on purpose**: `#dockerCheck()` first asks the worker's own
`GET /v1/health` (is the worker process even up), then, only if that answered,
`GET /v1/info` (is Docker answering _the worker_). The app holds no socket of
its own any more, so "nothing deploys" now has two different causes with two
different fixes (`WORKER_URL` pointing nowhere, vs. a live worker whose
`DOCKER_SOCKET_PATH` is wrong), and collapsing them into one "Docker socket"
line used to send the operator to check a socket the app doesn't even open.
Reads `config`, which already reflects any DB-backed instance settings merged
over the env defaults (see Config and Instance settings below), these checks
just report the effective value, they don't care which layer it came from. DNS
automation (Cloudflare/Pangolin, see below) is separate from this check,
`runSetupChecks()` doesn't currently flag an unset DNS provider, that's an
opt-in feature, not a base-instance misconfiguration.

**`dashboard-router` is the one check that reads this app's own container.**
`DockerService.selfContainerLabels()` inspects it (Docker sets a container's
hostname to its own short id, which is what makes self-inspection possible) and
`hasTraefikRouterFor(labels, host)` looks for an enabled router whose rule
carries the Dashboard URL's host. **Real, reproduced case**: an instance
installed before the app container got its `DASHBOARD_DOMAIN` router had no
Traefik labels at all, so the dashboard answered on `:3000` and Traefik returned
its own 404 for the configured hostname, with nothing anywhere saying why —
labels are only read when a container is **created**, so editing the Dashboard
URL in `/settings` can never fix it, only regenerating the compose file and
recreating the container can. The check skips itself when the origin carries an
explicit port (that instance is reached directly on that port, not through
Traefik : the installer's own IP-mode default) and when self-inspection fails
(dev, or not running in a container).

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

## System stats (`src/lib/services/system-stats.service.ts`, `internal/hoststats`)

`SystemStatsService.getSystemStats()` is a thin call to the Go worker's
`GET /v1/host/stats`, not a local read any more : the app may itself be a
container, and its own `os`/`df` readings would describe that container's limits
rather than the real machine's, which is exactly why this moved.
`internal/hoststats`'s `StatsSampler` (Go, not to be confused with the
`$lib/services/stats/stats-sampler.ts` one below; shared with the agent, see
`packages-and-release.md`, so a remote host's row on the dashboard renders from
the identical shape as the local one) reads `/proc/stat` and `/proc/meminfo`
directly and shells out to `df -Pk .` for disk and `nvidia-smi` for a
best-effort GPU read (`gpu: null` when absent, the common case, not an error; no
other vendor supported). CPU% needs a delta between two samples, so the sampler
keeps the last one as an instance field and diffs on each call, the first call
after the **worker** starts (not the app) always reads 0%. Polled by the
dashboard's `/system-stats` endpoint every 5s, which now round-trips through the
worker on every poll rather than reading in-process.

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

A curated lifecycle event feed, one copy per account, deliberately separate from
the `app_log`/Errors-tab system above: written explicitly at each event site
rather than derived from logs, so it stays a short, meaningful list rather than
every warn/error the app produces. Shown via a bell icon
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
  notification call can't fail the operation it's attached to. `notify` goes
  through `broadcast(input)`, which inserts one row per account (resources are
  shared, so every account hears about every event, and each reads and clears
  its own copy) and amortized-prunes each feed back to its newest 200 rows on
  ~5% of writes, same convention as `AppLogDTO`'s 5000-row prune.
  `notifyServiceError(serviceId, message)` broadcasts too, used by
  `Logger.error` to attribute a runtime error notification to a service.
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
below used to list as unbuilt; outbound channels on the same events now exist
too, see Outbound notification channels next.

## Outbound notification channels (`notification_channel`, `NotificationChannelDTO`, `notification-channel.service.ts`)

The account-wide counterpart to the in-app feed above: a `notification_channel`
row is a `kind` (`"webhook"` generic JSON POST, `"discord"` embed, `"slack"`
incoming-webhook attachment, `"telegram"` Bot API `sendMessage`, or `"email"`)
plus a `target` and an `events` jsonb column (`NotificationEvent[]`, DB default
and DTO default
`["build.failed","build.checks_failed","update.failed","deploy.unhealthy","deploy.rolled_back"]`),
managed on `/notification-channels` (create/test/delete) with the events matrix
itself edited on `/profile/notifications`.

`NotificationEvent` (`$lib/types.ts`) and its catalog
(`$lib/notification-events.ts`, `NOTIFICATION_EVENTS`,
labels/groups/descriptions for the settings matrix) cover four pairs:
`build.failed`/`build.succeeded` (a git-source service, any trigger),
`update.failed`/`update.succeeded` (an image service redeployed by its own cron
schedule, i.e. pull + restart), `deploy.failed`/`deploy.succeeded` (a manual
image deploy), and `service.down`/`service.up` (an uptime probe transition, see
Uptime probes below), plus three that aren't pairs: `build.checks_failed`
(`statusChecksMessage`, sent by `notifyStatusChecksFailed` in
`deploy/status-check-step.ts` _instead of_ `build.failed` when a git build is
stopped by required status checks), `deploy.unhealthy` and `deploy.rolled_back`
(`revisionHealthMessage`, sent by `RevisionHealthService`). The bell gets the
matching `build_checks_failed`/`deploy_unhealthy`/`deploy_rolled_back` rows.
`isFailureEvent` lists all three explicitly, since `build.checks_failed` doesn't
end in `.failed`. `deployEvent(buildSource, trigger, ok)` picks the right one of
the first three from what `deploy.service.ts` already knows; `isFailureEvent` is
what colors a Discord embed red vs. green.

`NotificationChannelService.dispatch(message)` fans a message out to every
account's enabled channels subscribed to that event
(`NotificationChannelDTO.listSubscribed`, filtered in code, not with jsonb `@>`,
see the jsonb trap in `data-and-config.md`), one delivery attempt per channel
via `Promise.all`; a channel that throws is caught, logged and written to its
own `lastError` rather than aborting the others, same posture as
`status-alert.service.ts` below. **A failed delivery is retried through the job
queue** (see `jobs-and-queue.md`): `#send` enqueues
`deliveryRetryJob(channel, message)`, a `notification_delivery` job owned by the
channel's user carrying `{channelId, message}` (`notificationDeliveryJobPayload`
re-validates it, including the event name), `runAt` 30s out and `maxAttempts` 4,
so the worker's own `10s * 2^attempts` backoff spaces the rest. Its handler
calls `NotificationChannelService.retryDelivery`, which loads the channel
unscoped (`NotificationChannelDTO.getForDelivery`), returns `{delivered: false}`
for a channel deleted, disabled or unsubscribed since, and otherwise rethrows a
failure after writing `lastError` so the worker schedules the next try.
`sendTest` stays a single direct attempt. `notify`/ `notifyDeploy` are
fire-and-forget (never awaited) so a channel outage can't fail the deploy or
probe tick that triggered it. `deploy.service.ts` calls `notifyDeploy` from both
`#recordFailure` and its success path; `status-alert.service.ts`'s
`StatusAlertService.dispatch` calls the shared `dispatch` directly for uptime
transitions, it no longer has its own delivery code (that used to be scoped to a
status page's channels, see Status pages in `services-and-templates.md` for why
it isn't anymore). Email requires SMTP configured and says so instead of failing
opaquely; a Discord target is validated to look like
`https://discord.com/api/webhooks/...` (or the `discordapp.com`/`canary`/`ptb`
variants) and a Slack one to be an https
`hooks.slack.com/services|triggers|workflows/` URL before it's saved
(`validateChannelTarget`, `$lib/server/validation/notification-channel.ts`). **A
Telegram channel has two secrets and one `target` column**: the create form
posts `telegramBotToken`/`telegramChatId`, `channelTargetFromForm` packs them as
`<bot token>/<chat id>` (`$lib/notification-channel-target.ts`, split back with
`parseTelegramTarget` on the last `/`), validated as `\d+:[\w-]{30,}` and a
numeric chat id or `@name`. `/notification-channels`' `load` swaps every target
for `channelTargetLabel`, so a Telegram row reaches the browser as `Chat <id>`
and the token never does; a Telegram error reports Telegram's own `description`,
never the request URL that carries the token. The payload builders
(`messageSubject`/`messageBody`/`discordPayload`/
`slackPayload`/`telegramPayload`) and `deployEvent`/`isFailureEvent` are pure
and unit-tested in `tests/unit/app/notification-channel.test.ts`.

**A message is built once, in `notification-messages.ts`, and every channel
renders the same shape**: `title`, `detail`, a list of `fields` (name/value) and
a dashboard `link` (only when `auth.origin` is set). `deployMessage` fills the
fields from the finished deployment row: stack, trigger (Manual/ Scheduled),
image and short digest or repository/branch/short commit, duration, and the
public URL on success; a failure's `detail` is the error plus the last 15 log
lines (ANSI and phase markers stripped), since the error alone is often just
"Build failed.". `uptimeMessage` adds the probe kind and, for the external
probe, the host. Discord shows the fields as embed fields (inline when short)
and keeps the _end_ of an oversized detail, where the error is; Slack does the
same as a coloured attachment; Telegram sends escaped HTML (bold labels, a
`<pre>` detail tail) and falls back to the plain-text body when the rendered
message would pass its 4096-character limit; email lists them as `Name: value`
lines; a generic webhook gets the message object as-is. `notifyDeploy` loads the
stack itself, so both deploy exits pass the same `{dep, ok, svc, trigger}`.

## Uptime probes (`uptime_check`, `UptimeCheckDTO`, `$lib/services/uptime/uptime-probe.ts`)

Two probes a minute per service with `uptimeEnabled` (default true, toggled by
the Observability tab's `?/setUptime` action or `uptimeEnabled` on the REST
PATCH) and a live container, run by another `BaseScheduler`:

- **internal** — asks the container itself, on the Docker network
  (`DockerService.containerAddress`) and its container port. This is what a
  sibling service sees, and it catches a dead process inside a container the
  daemon still reports as running.
- **external** — HTTP to the hostname Traefik publishes (`primaryHostname()`:
  the service's chosen main domain, else `<slug>.<baseDomain>`). It fails for
  entirely different reasons: DNS, a missing router, a tunnel that isn't up.

**An untrusted certificate is not an outage, and treating it as one reported
healthy services as down.** The probe's own comment always claimed a self-signed
certificate was the normal case behind a tunnel, but nothing implemented it:
Bun's `fetch` verifies by default, so a service sitting behind a Pangolin tunnel
whose edge hadn't issued a certificate for that subdomain showed
`TLS failed: unable to verify the first certificate` and 0% uptime while serving
200s perfectly well. The probe now tries verified first and, **only** when the
failure is a certificate one (`isCertificateError`), retries with
`tls: {rejectUnauthorized: false}` : a success on the retry is `ok` with
`certificate not trusted` appended to the detail, so the cert problem stays
visible without being an outage, and a connection refused or a timeout still
fails on the first attempt as before.

**The healthcheck detail is stripped of ANSI escapes** (`stripAnsi`,
`$lib/ansi`) before it's stored. A container whose `HEALTHCHECK` prints coloured
output put raw `\x1b[32m` sequences into the uptime row, which the panel renders
as plain text : they showed up on screen as `[32mStatus: 200`.

**A swarm service gets an internal probe too.** It used to be skipped outright
(`containerId` is null in swarm mode), so its "From the network" row sat on "No
beats recorded yet" forever with no hint why. The probe now resolves the
service's running task on this node (`getRunningTaskContainerId`) for the
healthcheck, and aims TCP/HTTP at the overlay alias `<slug>:<port>` rather than
a container IP. That only resolves because `enableSwarmMode` attaches this app's
own container to the overlay (re-asserted on every boot by `CoreServicesWatch`).
No running task on this node records a failure. For that attach to be
idempotent, the worker's `/v1/containers/{id}/connect` passes the daemon's
status through (403 already attached, 404 missing) instead of a blanket 500,
which had also made every re-assert after the first fail on Traefik's
already-attached overlay.

**The internal probe isn't always HTTP**, and
`internalProbeMethod(image, hasHealthcheck)` picks between three, in this order:

1. `healthcheck` — the image declares its own `HEALTHCHECK`, read back off
   `State.Health` by `DockerService.containerHealth`. Always preferred: the
   image author knows what ready means for that software, and it's the only one
   of the three that can tell a Postgres mid-recovery from a ready one.
   `starting` counts as up (the container is inside its own start period), only
   `unhealthy` is a failure.
2. `tcp` — a datastore (`isDatabaseImage`, i.e. anything `detectLinkEngine`
   recognises) with no healthcheck of its own. "The port accepts a connection"
   is the honest liveness signal there and nothing more is claimed.

   **`Bun.connect` needs real socket handlers.**
   `Bun.connect({hostname, port, socket: {}})` throws
   `Expected at least "data" or "drain" callback` synchronously, before it opens
   anything — so the first version of this probe failed for _every_ database and
   stored that sentence as the outage reason. `tcpConnect` passes
   `open`/`data`/`error`/`connectError` and resolves from `open`, racing a
   `TIMEOUT_MS` timer. It's covered against a real `Bun.listen` socket (open
   port, closed port, unroutable address) in
   `tests/unit/app/uptime-probe.test.ts`, deliberately not with a mock: a mock
   would have accepted the broken call too.

3. `http` — everything else, where a status code means something.

That hierarchy exists because speaking HTTP at a Postgres is how a perfectly
healthy database read as **down** in the uptime panel, with Bun's own "pass
`verbose: true` in the second argument to fetch()" hint shown to the user as the
reason it was down. `probeErrorMessage` strips that tail and collapses the cases
people actually hit (timeout/abort, refused, TLS) into one actionable sentence;
both it and `internalProbeMethod` are pure and unit-tested in
`tests/unit/app/uptime-probe.test.ts`.

**Any HTTP response under 500 counts as up**, including 401/403 (a service
behind the login wall is alive, it's just refusing the prober) and 404 (it
answered, it just has no route at `/`). A 5xx is down: it's either the app
saying it isn't ready (AIOMetadata answers every route with 503 while it waits
forever for its Redis) or Traefik's 502/503/504 for a backend that isn't there,
and counting those as up showed a broken service green for hours. A transport
error or the 5s timeout is a failure too, and `redirect: "manual"` keeps a
redirect from being chased.

**The external probe is skipped, not failed, when the hostname is a loopback
one** (`externalProbeSkipReason`: `localhost`, `127.0.0.1`, `::1`, `0.0.0.0`,
`*.localhost`). A `localhost` base domain is the dev/first-boot default, so the
"public" hostname resolves to this machine and probing it proves nothing about
whether anyone else can reach the service — reporting that as an outage would be
noise, reporting it as up would be a lie. The panel says why instead.

Results are **appended, one row per probe** (`id` primary key), not upserted:
the panel renders the last `BEAT_WINDOW` (40) as a heartbeat strip, which needs
the history. `UptimeCheckDTO.beats(serviceId, kind)` returns them oldest-first
for the strip, `latest` uses a `selectDistinctOn` for the "now" view, and
`prune()` drops anything past a 7-day retention, amortized one tick in 60. The
service Observability tab renders both probes with per-probe troubleshooting
steps when one fails; the dashboard shows a banner listing every failing probe,
linking into the service that owns it. `$lib/components/heartbeat-strip.svelte`
is the shared strip, also used by both status-page surfaces.

**A state change also fires alerts** (`status-alert.service.ts`). The tick reads
`UptimeCheckDTO.latestByProbe` _before_ recording its own results, and
`detectTransitions` compares the two: a probe with no previous beat is
deliberately not a transition, or the first tick after a deploy (or after
`prune()` cleared the window) would alert on every service at once. Each
transition is handed to `NotificationChannelService.dispatch` (`service.down`/
`service.up`), which fans it out to every channel account-wide subscribed to
that event, see Outbound notification channels above, no longer scoped to a
status page. A channel that throws is caught, logged and written to its own
`lastError`, never allowed to abort the tick.
