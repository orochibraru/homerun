# Services, templates, git builds

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory. These sections were split out of that file, so a "see X below/above"
in the text below may now point at a section living in a sibling note rather
than in this one.

## Linking and grouping from the services list

A right-click on a service row offers **Link to…** and **group/ungroup**
(`services/+page.server.ts`'s `link` and `group` actions). Linking writes the
target's connection variables into the source's env — the same `buildLinkEnv`
output the wizard's link picker produces, so a URL, a JDBC URL or separate vars
depending on the target's image — and optionally puts both on one stack network,
since two services only reach each other by slug once they share one. It moves
them into whichever stack either is already in, and creates one named after the
source otherwise.

## Where creating something lands you

Every create path ends on the thing it just made, not on a list: the wizard's
**Create service** and **Create and deploy** both redirect to `/services/<id>`,
and a template's **Quick Deploy** does the same from both the catalog and the
template's own detail page. The one exception is a create that produced
_companions_ (a template pulling in its linked services, see Template links
below): those land on `/stacks/<id>`, where all of them are visible together,
which is the only view that shows the whole thing that was just created. The
catalog's Quick Deploy used to return an `href` and offer a "View" button on its
toast instead; the redirect now happens server-side, the same way the detail
page always did.

## Shared deploy pipeline (`src/lib/services/deploy.service.ts`)

`DeploymentService.deployService(svc, userId, clientDeploymentId?)` is the one
pull-or-build→create-container→start implementation, used by the service
Overview page's `deploy` action, `POST /api/v1/services/[serviceId]/deploy`, and
the cron redeploy scheduler (below). Returns
`{success, deploymentId, containerId?, error?}` rather than throwing, callers
decide how to surface failure (a SvelteKit `fail()`, a JSON error body, a
scheduler log line). Don't reimplement this inline in a new call site; extend
the shared method instead.

**The legal combinations are a union, resolved once up front.** The first thing
the pipeline does (the `config` phase, before volumes, pulls, builds or any
Docker call) is `#loadDeployPlan`: it loads the instance's `orchestrationMode`,
the cache registry row and the build server target, then hands plain data to
`resolveDeployPlan()` in `src/lib/services/deploy/plan.ts`, a pure function
(covered by `tests/unit/app/deploy-plan.test.ts`) returning a `DeployPlan`:

- `image: ImagePlan`, one of `pull` (`svc.image`/`tag`/`pullPolicy`),
  `local-build` (optional cache registry as a layer cache), `docker-build` (a
  remote Docker build server, registry required) or `agent-build` (an agent
  build server, registry required), or `revision` (a rollback, see Revisions and
  rollback below). Every git variant carries the `GitSource`
  (url/ref/context/Dockerfile) with `gitUrl` already non-null.
- `workload: WorkloadPlan`, either `container` (carries `networkMode`) or
  `swarm` (carries `replicas`).

Illegal combinations throw a `DeployPlanError` there, so they fail the
deployment with a clear message before anything happens: a git service without a
URL, an image service without an image, a build server without a cache registry
or that didn't resolve, and host networking under swarm (swarm services only
join the overlay, this used to be silently dropped). Leftover
`buildServerRemoteHostId`/`buildCacheRegistryId` on an image-source service are
ignored and never loaded. Each pipeline step (`#resolveImage`, `#buildGitImage`,
`#startWorkload`) is a `switch` over the variant's `kind` with a
`default: return unreachable(plan)` (`never`) arm, so adding a variant is a type
error until every step handles it. This exists because the old shape branched on
`buildSource` × build target kind × `orchestrationMode` inline and rejected bad
combinations with a `throw` deep in the pipeline (the old remote-deploy-target +
swarm check only ran after the image was already built or pulled). Add a new
axis or combination to the union, not an `if` in a step.

A git build writes the resulting ref back to `svc.image`/`svc.tag` _before_ the
workload starts, so the container step never needs to know which path produced
the image; a cross-host build (`docker-build`/`agent-build`) pushes to
`<registry>/homerun-build-<slug>:<tag>` and pulls that published ref back onto
this host first.

## Required status checks (`$lib/status-checks.ts`, `StatusCheckService`, `deploy/status-check-step.ts`)

`service.requireStatusChecks` + `requiredStatusChecks` gate a git build. In
`#resolveImage`, before `#buildGitImage`, `enforceStatusChecks` resolves the
branch to a SHA through the provider API, logs it, writes `gitCommit`/`gitRef`
on the deployment and runs `waitForChecks`. Everything provider-shaped is pure
in `$lib/status-checks.ts`, covered by `tests/unit/app/status-checks.test.ts`
with a fake fetch: `repoPathFromGitUrl` (https, scp-style, nested GitLab groups,
a self-hosted base path), `providerApiBase` (also what `git-provider.service.ts`
`endpoints()` uses now), the per-provider paths (`commitsPath`, `checkSources`)
and mappers into `CheckResult {name, state: pending|success|failure}`, and
`StatusCheckClient` (fetch injectable, like `MirrorRegistryClient`).

- GitHub: `commits?sha=<ref>&per_page=1` for the SHA, then check runs
  (`filter=latest`; not completed is pending, `success`/`neutral`/`skipped`
  pass, anything else fails) merged with the combined commit status.
- GitLab: project path URL-encoded, commit job statuses (`all=false`, latest per
  name; an `allow_failure` failure and an allowed manual job pass, other manual
  jobs stay pending) plus the latest pipeline for the SHA as a check named
  `pipeline`.
- Gitea/Forgejo: `commits?sha=<ref>&limit=1`, then the combined status
  (`warning` passes), already one row per context.
- Bitbucket: `commits/<ref>?pagelen=1`, statuses keyed by `key` (not `name`,
  which Pipelines rewrites per run), `STOPPED` fails.

`mergeChecks` keeps the most pessimistic state for a name reported twice.
`evaluateChecks(required, results, graceExpired)` fails on any failed required
check, waits on pending ones, and treats a required check with no result as
pending until everything else on the commit has finished **and**
`STATUS_CHECK_GRACE_MS` (3 min) passed, then as failed. `waitForChecks` polls
every 20s for up to 30 min (clock and sleep injectable), logs only when the
summary changes, retries transient API errors, rethrows permanent ones
(`StatusCheckApiError.permanent`: 401/403/404/422), and stops when `isCancelled`
sees the deployment row `failed`/`stopped` or the service gone.

Any failure throws `StatusChecksFailedError`, which `#recordFailure` recognises:
the service status is re-synced from Docker instead of being set to `failed`
(the previous revision is still running, untouched), and
`notifyStatusChecksFailed` sends `build_checks_failed` + `build.checks_failed`
instead of the generic build failure (nothing on cancellation). Credentials
(`StatusCheckService.targetFor`): the provider configured for the URL's host
plus the service owner's connection, else a token embedded in the clone URL,
else unauthenticated for a well-known host (`inferProviderKind`). The checked
SHA goes to `buildFromGit` as `commit`: when the shallow clone's HEAD differs (a
push landed while waiting), `#checkoutCommit` runs
`git fetch --depth 1 origin <sha>` and `checkout --detach` in the workspace, so
the build is the checked commit or fails. Agent builds can't be pinned and say
so in the log.

The Source tab's picker (`status-check-picker.svelte`) loads names through
`listStatusCheckNames` (`$lib/remote/status-checks.remote.ts`, distinct names
over the last 5 commits of the branch) as a one-shot `$state` promise and posts
the selection as repeated `requiredStatusChecks` hidden inputs, read with
`formData.getAll` since the route's zod parse goes through `Object.fromEntries`.
**Verified live**, read-only: github.com/orochibraru/homerun unauthenticated
(real check-run names, a HEAD commit with no checks yet) and a Forgejo instance
answering 403 without a token (a permanent error). **Not verified**: GitLab and
Bitbucket against real instances, and a full deploy blocked by a real failing
check.

## Revisions and rollback (`$lib/revisions.ts`, `RevisionService`, `RevisionHealthService`, `deploy/revision-step.ts`)

A revision is a `deployment` row (see `data-and-config.md`), recorded by
`#recordSuccess`: `imageRef` from the resolved `image:tag` with any `@digest`
split off into `imageDigest`, `imageId` from inspecting the run ref, and
`health: "watching"`. Pure logic in `$lib/revisions.ts`, covered by
`tests/unit/app/revisions.test.ts`: `previousRevision` (newest older revision
whose image key, `imageId` then digest then ref, differs from the current one,
skipping `unhealthy`/`rolled_back`), `retainedRevisions` (newest 5 distinct
images per service), `revisionImageRefs` (what the Docker keep list resolves)
and `healthVerdict`.

**Rollback** is `enqueueDeploy({rollbackOfDeploymentId})`: the row carries the
target, the job is deduped on `rollback:<id>` (so it never coalesces into a
queued normal deploy), and `deployService` turns the row into a `RevisionSource`
for `resolveDeployPlan`, whose `revision` input short-circuits to the `revision`
image variant (no git URL check, no cache registry or build server load).
`resolveRevisionImage` skips build, upstream pull and scan: with a digest it
runs `image:tag@digest` (verified: `docker create` and a dockerode pull both
accept that form), pulling by digest only if it's gone locally, and swarm just
gets the pinned ref; without one it needs the local `image:tag` to still be the
recorded `imageId`, and otherwise fails saying to redeploy. It writes the
revision's `image`/`tag` back onto the service. Env, volumes, networking and
resources are deliberately **not** snapshotted: a rollback undoes a bad image,
config edits are intentional, and a snapshot would copy every secret into every
deployment row.

**Health watch.** `DeploymentService.watchHealth` hands every successful deploy
to `RevisionHealthService.watch`, an in-process fire-and-forget loop (not a
queue job: a 90s+ watch would hold one of the worker's 3 slots), deduplicated on
`globalThis` so HMR doesn't double it; `hooks.server.ts` calls
`resumeHealthWatches()` at boot for rows still `watching`. Every 5s it stops,
clearing `health`, if the service is gone or stopped, has a newer deployment
row, or runs a different container/swarm service; otherwise it samples
(`containerHealthSample`/`swarmHealthSample`, the `docker/revisions.ts` mixin)
and asks `healthVerdict`. Unhealthy at once on an exit, 2+ restarts since the
baseline, a missing container, Docker health `unhealthy`, or 2 failed swarm
tasks created since the deploy; healthy once `HEALTH_WINDOW.windowMs` (90s)
passed, extended while health is `starting` or replicas are missing up to
`maxWaitMs` (5 min), after which it's unhealthy. The service's
`healthcheckCommand` runs every 30s with a 30s start period and 3 retries, so a
failing one turns unhealthy after about two minutes, inside that bound. On
unhealthy, with `autoRollback` on, the revision not itself a rollback and a
`previousRevision` found: `rolled_back`, a rollback deploy and
`deploy.rolled_back`. Otherwise `unhealthy` and `deploy.unhealthy`, with the
reason nothing was rolled back. The rollback enqueuer is passed in by
`DeploymentService` rather than imported, since `RevisionService` imports
`deploy.service.ts`.

UI: the Revisions tab (`RevisionService.annotate` adds `current`/`previous`/
`retained`) with a per-row **Deploy this revision** (`ConfirmDialog`, a hidden
form, the `deployRevision` action with `enhanceToast`, then Overview for the
progress panel), and **Auto-rollback** on the Settings tab. API:
`GET /services/{id}/revisions` and
`POST /services/{id}/revisions/{revisionId}/deploy` (`previous` accepted, waits
like `deploy`); CLI `services revisions` and `services rollback`.
`tests/integration/revisions.test.ts` covers two image deploys plus a rollback
by digest, the 404/400 cases, auto-rollback of a restart-looping revision, and
marking without auto-rollback.

## Image scanning in the pipeline (`image_scan`, `ImageScanService`, `deploy/pull-step.ts`)

Scanning happens inside the `image` phase, before `#startWorkload`, on every
path that reaches `deployService` (Overview, API/CLI, cron, stack/template
deploys, the queue). `ImageScanService.policyFor(svc)` combines
`instance_settings.imageScanEnabled` (null = on) with `service.imageScanEnabled`
(default true) and carries `imageScanBlockSeverity` (null = off, `CRITICAL`,
`HIGH`). When off, a `skipped` row is recorded and the pull is the plain one.

- **Pull plans** go through `pullForDeploy` (`deploy/pull-step.ts`, split out of
  `deploy.service.ts` to stay under the 680-line file limit). A pull policy that
  skips the pull scans the local image (`--image-src docker`). Otherwise
  `ImageScanService.deployThroughMirror`: `DockerService.copyToMirror` (skopeo)
  → scan the mirror copy (`--image-src remote --insecure`) → **pull only after
  the scan**, so a blocked image never lands in the host's image store →
  `pullFromMirror` pulls `127.0.0.1:5055/<registry>/<repo>:<tag>` and re-tags it
  as the upstream `image:tag`, so the container, `pullPolicy: missing` and every
  other reader keep seeing the normal name. Swarm skips the host pull and
  returns `tag@digest` (`pinnedToDigest`), since workers can't reach a loopback
  registry; the swarm pre-pull and `createService` both accept that ref.
- **Fallbacks, all logged into the deployment log**: copy fails → `null`, the
  caller does the normal pull and a local scan. Scan succeeds but the loopback
  pull fails → plain upstream pull, no second scan.
- **Git plans** scan after the build and before `svc.image`/`tag` are written
  back (`buildScanTargets`, `deploy/scan-targets.ts`): the local tag for
  `local-build`, the pushed cache-registry ref with its credentials then the
  local pull for `docker-build`/`agent-build`.
- `ImageScanService.scan(ctx, targets, {blockSeverity})` tries targets in order,
  records one `image_scan` row (`ok` with counts + top 200 findings, or `failed`
  with every target's error), appends the summary and the first five
  CRITICAL/HIGH findings to the log, notifies on CRITICAL (`image_scan_critical`
  bell row + the `image.vulnerable` channel event), then throws
  `ImageScanBlockedError` if `blockReason()` says so, which `#recordFailure`
  turns into a normal failed deploy. **A scanner failure never blocks**, even
  with a block policy set: only real findings do.
- The Security tab's **Scan now** is an `image_scan` job (dedupe/lock
  `image_scan:<serviceId>`) running `ImageScanService.scanDeployed`: Trivy with
  `--image-src docker,remote` against `svc.image:svc.tag` and the service's
  registry credentials, never blocking.

Verified live on OrbStack against the dev database: a real deploy of
`nginx:1.27-alpine` through the mirror (copy, scan with 2 critical/35 high,
loopback pull, re-tag, container up), a `CRITICAL` block on `alpine:3.18.0`
failing before the pull, a per-service opt-out, and a `missing` pull policy
scanning the local image. **Not verified live**: swarm pinning, git-build scans,
cross-host registry scans, rootless Docker's fallback, and the Scan now job
through the worker.

## Compose import (`$lib/compose-import.ts`, `$lib/services/compose-import.service.ts`, `(protected)/services/import/`)

Paste a `docker-compose.yaml`, get Homerun rows. Two halves, deliberately split:
`$lib/compose-import.ts` is a **pure parser** (the `yaml` package, no DB, no
Docker) turning compose text into a `ComposeImportPlan`
(`services: ComposeServiceDraft[]`, plus file-level `warnings`/`networkNames`/
`volumeNames`), covered directly by `tests/unit/app/compose-import.test.ts`;
`compose-import.service.ts` is the row-creating half (`ComposeImportService`, a
plain instance singleton) that turns a plan into `StackDTO`/`ServiceDTO`/
`StorageVolumeDTO`/`ServiceVolumeDTO` rows. The route
(`services/import/+page.server.ts`) has a `preview` action (parse, return the
plan) and an `import` action that **re-parses the pasted text server-side**
rather than trusting a plan round-tripped through the client.

What maps: `image` (split via `splitImageRef`, which handles a registry port and
strips a digest), `environment` in both the map and `KEY=VALUE` list forms,
`ports`/`expose` (the _container_ side; `parsePortEntry` handles
`"8080:80/udp"`, `"127.0.0.1:8080:80"`, a bare number, and the long
`{target, protocol}` form), `restart` (`on-failure:3` → `on-failure`), `volumes`
(short and long syntax), `depends_on`, `network_mode: host`, `container_name`,
`deploy.resources.limits.cpus`/`memory` (and the legacy `cpus`/`mem_limit`).
Everything else is a **warning on the preview, not a silent drop**: `build:`,
`command`, `entrypoint`, `healthcheck`, `env_file`, `labels`, capabilities,
devices, `privileged`, secrets/configs, top-level extra networks, relative bind
mounts (Homerun needs an absolute host path), anonymous volumes, and the host
side of every port mapping.

Two mapping decisions worth not re-litigating: **`dnsResolvable` is true only
when the compose service published a host port** (`ports:`), false when it only
`expose`d one, which is the closest honest translation of "this one was meant to
be reachable from outside"; and **one compose file maps onto one Homerun
stack**, since a stack already _is_ a Docker network here, so a file's own
multiple `networks:` can't be reproduced and says so in a warning.

`orderByDependencies` topologically sorts the drafts (falling back to file order
on a cycle rather than throwing), which is what makes "Import and deploy" queue
the stack in `depends_on` order : the last service is passed to
`DeploymentService.enqueueStackDeploy` as the primary and the rest as its
dependency chain, reusing the template-links machinery rather than a second
ordering implementation. Storage volumes are de-duplicated against the user's
existing ones by `(kind, source)`, so importing two files that share a named
volume mounts the same row twice instead of creating a duplicate.

## Smart service links on create (`$lib/service-link.ts`, `service-link-picker.svelte`)

The Environment step of `services/new` has a "Link a service" picker next to
"Paste .env": pick any service the user already owns (**regardless of stack**,
which is the whole point : every bridge-mode service is on the shared network
and reachable at `<slug>:<port>` anyway, so linking is purely about generating
the env vars, there's no networking to set up) and it writes connection env rows
into the existing key/value editor.

`$lib/service-link.ts` is a pure, tested module
(`tests/unit/app/service-link.test.ts`), no DB or Docker:
`detectLinkEngine(image)` matches the image ref against a small table (postgres
incl. timescale/postgis, mysql/percona, mariadb, mongo, redis/valkey/dragonfly,
rabbitmq, else `generic`), `credentialsFor` reads that engine's own conventional
env vars off the linked service's stored `envVars`
(`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`, `MYSQL_*`/`MARIADB_*`
including the root-password fallback, `MONGO_INITDB_*`, `REDIS_PASSWORD`,
`RABBITMQ_DEFAULT_USER`/`_PASS`), and
`buildLinkEnv({format, prefix, target, urlKey})` produces the rows. Three
formats: `"url"` (a URI, `postgres://user:pass@slug:5432/db`), `"jdbc"`
(relational engines only, credentials as query params, `supportsJdbc` on the
engine gates the option), and `"vars"`
(`<PREFIX>_HOST`/`_PORT`/`_USER`/`_PASSWORD`/`_DB`, only emitting the ones that
exist). Every key name is a **default, not a rule**: the picker exposes the URL
variable name and the variable prefix as editable inputs
(`defaultUrlKey`/`defaultVarPrefix`, e.g. `POSTGRES_URL` / `POSTGRES`, or
`<SLUG>_URL` / `<SLUG>` for a generic service), which is what the TODO item
asked for. Values are URL-encoded, so a password with a space or an `@` survives
the round trip.

The picker merges into `envRows` through the same `mergeEnvRows` helper
`EnvPasteButton` uses, so an existing key is overwritten in place rather than
duplicated. It's a preview-then-add dialog, not an async mutation, which is why
it's one of the documented `toast.success` exceptions rather than a promise
toast.

## Live progress: SSE, streams, and why not WebSockets

**This stack has no WebSocket route API.** SvelteKit 2.70 (the latest stable,
checked) has no `socket`/upgrade export for `+server.ts`, and grep confirms the
string "websocket" doesn't appear anywhere in the installed `@sveltejs/kit`;
`@orochibraru/svelte-smol` is ready for one (`getHandler()` forwards a
`server.websocket()` to `Bun.serve`, printing "WebSocket: disabled" when the
framework doesn't provide one), so the gap is SvelteKit's, not the adapter's.
Kit 3.0.0-next exists but adopting a `next` major for this isn't worth it. So
the transport ladder here is, in order of preference:

- **A `ReadableStream` response** for one-way server→client byte streams that
  aren't event-shaped : container logs (`services/[serviceId]/logs/+server.ts`)
  and the terminal's output channel. Already push-based, **not polling**,
  despite what TODO.md assumed.
- **Server-sent events** for one-way server→client _event_ streams : deploy
  progress (below). `text/event-stream` is the one content type
  `@orochibraru/svelte-smol` auto-exempts from Bun's `idleTimeout`, so an SSE
  route needs no `allowLongRequest()` call, which is a real advantage over a
  bare chunked stream here.
- **Chunked HTTP both ways** where a client→server channel is genuinely needed :
  only the web terminal, which already does this (`terminal/[sessionId]/input`),
  and which needed its own raw `Bun.connect()` hijack anyway (see Web terminal).
- **A remote `query`/`command`** (see Remote functions below) for any
  dashboard-only request/response call that isn't a stream : a panel that loads
  behind a skeleton, a poll, a small mutation the bell or a picker fires. This
  is what replaced the hand-written `fetch` + internal `+server.ts` pairs those
  surfaces used to need.
- **Plain REST/form actions** for everything else. The REST API stays the CLI's
  contract and the OpenAPI document's source of truth, and remote functions
  deliberately don't touch it : they're an internal dashboard transport, not a
  second public API. A form that mutates real state still goes through a form
  action with `enhanceToast`, not a command.

**Deploy progress is SSE** (`$lib/server/deploy-progress-stream.ts`, served by
`services/[serviceId]/deployments/[deploymentId]/events/+server.ts`), replacing
the Overview tab's 1s `fetch` poll. The server-side loop still reads the
`deployment` row on an interval, but only _pushes_ when the serialized snapshot
actually changes, so a client sees a new line the moment it lands instead of up
to a second later, over one connection instead of one request per second. Two
details are load-bearing: the stream **waits for the deployment row to appear**
(up to 60s) instead of 404ing, because the Overview tab starts listening before
its own deploy POST has been handled and an `EventSource` treats an HTTP error
as fatal and never reconnects; and the client's `onerror` **falls back to the
old polling loop** (`pollProgress`, still there, still the resilient path)
rather than leaving the panel stuck, for a buffering proxy or a dropped
connection. The JSON `progress/+server.ts` endpoint stays for exactly that
fallback.

**Deploy phases** (`$lib/deploy-phases.ts`) give that panel structure instead of
a raw log tail: `deployService` appends a marker line (`phaseLine(id)`, rendered
`▸ Fetching image`) as it enters each of `config`/`volumes`/`image`/`container`/
`network`/`ready`, and `deployPhaseStates(log, status)` derives per-phase
`done`/`active`/`failed`/`pending` from the last marker in the log plus the
deployment's status. The markers are ordinary log lines, so the deployment
history's raw-log panel keeps working untouched and nothing else in the pipeline
had to learn about phases. There is deliberately **no "checking container
health" phase**: health-gated rollout isn't built (see Planned features), and a
phase that always passes instantly would be a lie. Health is watched _after_ the
deploy finishes instead (see Revisions and rollback above) and shows on the
Revisions tab.

## Remote functions (`src/lib/remote/*.remote.ts`, `$lib/server/remote-auth.ts`)

SvelteKit's remote functions are enabled
(`kit.experimental.remoteFunctions: true`, set inline in `vite.config.ts`, which
is where this repo's whole Kit config lives, there is no `svelte.config.js`).
They're the transport for dashboard data that a page doesn't need in order to
render : a panel that can come in behind a skeleton, a poll, a picker's
on-demand lookup, and the small mutations those surfaces fire. Every one lives
in `src/lib/remote/`, and Svelte's `compilerOptions.experimental.async` is
deliberately **not** enabled, nothing here needs `await` in a template.

**What is and isn't allowed to move here.** Anything a page's own correctness
depends on stays in `load` : the signed-in user, their role/`isAdmin`, their
appearance preferences, instance settings, and every entity list a route
renders. What moved is only data whose absence for a few hundred milliseconds is
a skeleton rather than a broken page. Concretely:

- `system-stats.remote.ts`, `getSystemStats` : the dashboard's Host Resources
  panel, which used to be fetched in the dashboard's `load` (blocking the whole
  page on a `df` + `nvidia-smi` shell-out) _and_ re-fetched every 5s from
  `/api/v1/system-stats`. `$lib/components/host-resources.svelte` owns the query
  and the poll now. The REST route stays : it's in the OpenAPI document and is a
  public API surface, unrelated to the dashboard's own rendering.
- `notifications.remote.ts`, `getNotifications` + the
  `markNotificationRead`/`markAllNotificationsRead`/`deleteNotification`
  commands : the bell's feed. It used to be fetched in
  `(protected)/+layout.server.ts` (so **every** protected page load paid for 20
  notifications plus an unread count, whether or not anyone opened the bell) and
  mutated through three one-line `+server.ts` routes each followed by a
  `refreshAll()`, which re-ran every `load` on the page. Each command now calls
  `getNotifications().refresh()` on the server, so the updated feed rides back
  on the mutation's own response.
- `jobs.remote.ts`, `getJobQueue` : the Scheduling page's job-queue panel. Its
  3s poll used to be a `refreshAll()`, re-running that page's entire (large)
  `load` every tick to update one panel.
- `git-repos.remote.ts`, `listProviderRepos`/`hasDockerfile`, and
  `image-check.remote.ts`, `checkImage` : the git repo picker and the
  image-exists warning, both of which were duplicated verbatim between
  `services/new` and the service Source tab. They're now one shared component
  each (`git-repo-picker.svelte`, `image-check-warning.svelte`) over one shared
  query.
- **Every remaining Docker round-trip that used to sit in a `load`.** This was
  the single biggest source of "the app feels sluggish": a navigation couldn't
  paint until the daemon answered, and a slow or unreachable daemon stalled the
  page rather than one panel of it.
  - `service-status.remote.ts`, `syncServiceStatuses` : the status
    reconciliation that ran in the services list's `load` (one `inspect` per
    deployed service, every visit) and again in
    `services/[serviceId]/+layout.server.ts` (once per tab navigation). Both
    pages render the stored `currentStatus` immediately and patch it when this
    lands, so a stale badge corrects itself instead of a blank page waiting.
  - `setup.remote.ts`, `getSetupStatus`/`getNewtContainer` : the setup
    diagnostics (which ping the daemon and the Traefik container) behind the
    dashboard's banner and `/settings`' per-field warnings, plus the Newt lookup
    on the Networking tab. `getSetupStatus` returns `issuesByField` ready-made,
    so the three settings tabs that highlight a field just read it.
  - `docker-infra.remote.ts`, `getCleanupPreview`/`getInfraStatus`/
    `getUnknownHostVolumes` : Docker Cleanup's `system df` preview, System Logs'
    Traefik + compose-stack lookup, and the volumes tab's host-volume picker.

  This is the one category where a _page's own subject_ moved out of `load`, and
  it's allowed for the reason the rule exists: none of it is the page's
  correctness, it's a live reading _about_ what the page already rendered from
  the database. The entity lists themselves still come from `load`.

**Auth is not inherited.** A remote function is its own endpoint : the
`(protected)` layout's `load` guard never runs for one, exactly like a
`+server.ts` route. Every query/command starts with `requireUser()`
(`$lib/server/remote-auth.ts`), which reads `getRequestEvent().locals.user` and
`error(401)`s otherwise. `hooks.server.ts` populates `locals` for these requests
the same as any other, so cookie sessions and API keys both work. Admin-only
ones use `requireAdmin()` from the same module, which is `requireUser()` plus a
`locals.isAdmin` check and a `error(403)` — `getCleanupPreview` and
`getInfraStatus` back admin-only pages, so the guard has to be on the function,
not only on the route that happens to call it.

**Arguments are validated, not cast.** A query/command taking an argument passes
a zod schema as its first parameter (`query(z.string(), ...)`), the same "one
schema, real runtime validation" posture as the REST API's own
`$lib/server/validation/api.ts`. Don't reach for `"unchecked"`.

**Two consumption patterns, and the difference matters.** A `RemoteQuery` is a
promise, but it's a _stable_ object : `{#await someQuery}` renders once and will
**not** re-render when `refresh()` lands, because the awaited expression never
changes identity. So:

- A query that refreshes in place (a poll, a command's single-flight update) is
  read through its reactive accessors, `query.ready`/`query.current`/
  `query.error`, with the pending branch rendering
  `$lib/components/skeleton.svelte`. `host-resources.svelte`,
  `job-queue-panel.svelte` and `notification-bell.svelte` are the reference
  shapes. **`$lib/components/async-block.svelte` is that whole triple as one
  component** — `<AsyncBlock {query}>` with a `pending` snippet and a
  `children(value)` snippet, rendering an `Alert` with a working **Retry**
  (`query.refresh()`) on failure. Prefer it to hand-rolling the three branches
  again; the hand-rolled ones above predate it and each invented their own
  failure wording with no retry. `tests/unit/app/async-block.test.ts` covers all
  three branches.
- **A query whose argument is reactive must be _called_ inside a `$derived`**,
  not created once: `const q = $derived(someQuery(ids))`. Calling it at the top
  level pins the first argument value forever.
- A one-shot, user-triggered lookup assigns a fresh promise to `$state` and
  `{#await}`s that, which is what makes the block re-run per invocation.
  `git-repo-picker.svelte` (a "List repos" click, then a Dockerfile check for
  the picked repo) is the reference shape.

**A background load through a remote query is still one of the documented
`toast.promise` exceptions** (see Conventions above) : it renders its own inline
spinner/skeleton and reports failure inline, it doesn't narrate itself through a
toast. Mutations that a user deliberately submits still belong in a form action
with `enhanceToast`, not a command.

## Template links (`template_link` table, `TemplateLinkDTO`, `$lib/services/template-links.ts`)

A template can link to other templates so deploying it deploys its companions
too, e.g. a WordPress-shaped template linking to a "MySQL" template, or a worker
linking to a "Redis" one : `templates/new`'s "Linked containers" section lets a
template owner check any other _leaf_ template (built-in or their own, shown
with its image/tag/port/env vars so there's enough to decide by) to link it,
with an optional alias (defaults to the linked template's own slugified name
when left blank). Deliberately two levels deep only, not a general DAG :
`TemplateLinkDTO.create`'s caller (`templates/new/+page.server.ts`) rejects
linking to a template that itself already has links, so a link's target is
always a leaf. This keeps env-var token resolution (below) simple, one level of
substitution, no cycle detection needed.

An env var on the _primary_ template can reference a linked template via
`{{alias}}` (resolves to the linked service's generated slug, its internal DNS
hostname on the shared network regardless of stack, same `http://<slug>:<port>`
addressing every service already gets) or `{{alias.ENV_KEY}}` (resolves to that
linked service's own resolved value for that env var, e.g.
`{{db.POSTGRES_PASSWORD}}`). Resolution (`$lib/services/template-links.ts`'s
`resolveLinkTokens`) leaves an unknown token untouched rather than stripping it,
so a typo'd alias fails loud (visible literally in the deployed env var) instead
of silently producing an empty value. Linked templates' own env vars are used
as-is, not further resolved : only the primary can reference `{{alias}}` tokens,
not link-to-link.

Deploying from a linked template (`services/new`'s `create`/`createAndDeploy`
actions, via `buildTemplateLinkContext`/`createLinkedServices`) : if the service
being created has no stack yet, one is auto-created (named after it) so the
whole stack shows up grouped ; each linked service gets a deterministic slug
(`<primary-slug>-<alias>`, de-duplicated against existing services) and deploys
from its own template's image/tag/port/envVars/resources, created
`dnsResolvable: false` by default (a database/cache/worker doesn't usually want
a public subdomain). `createAndDeploy` deploys every linked service before the
primary, same "bring up dependencies before dependents" ordering
`docker compose`'s `depends_on` implies, though nothing here actually waits for
a linked service to be _healthy_, just created and started.

## Built-in template catalog and gallery (`builtin-templates.ts`, `builtin-templates-apps.ts`, `template-icon.svelte`, `templates/[templateId]/`)

69 built-in templates (up from the original 8), split across two data files
purely to stay under `noExcessiveLinesPerFile`'s 680-line limit:
`src/lib/server/db/builtin-templates.ts` (the original 8 infra templates plus
Media/Network/Dashboard/Productivity/Finance category entries, also exports the
`BuiltinTemplate`/`BuiltinTemplateLink` interfaces both files use) and
`src/lib/server/db/builtin-templates-apps.ts` (the rest, Analytics/Monitoring/
Development/other categories, including Penombre, Nextcloud, Home Assistant,
Mealie, Memos, Paperless-ngx, Beszel, Kavita, code-server, the Docker registry
itself, Ollama, Open WebUI and Duplicati). `src/lib/server/db/seed.ts` is a thin
orchestrator importing both arrays plus `BUILTIN_TEMPLATE_LINKS` (4 entries:
WordPress→MySQL, Umami→Postgres, Miniflux→Postgres, Paperless-ngx→Redis, wiring
the Template links feature above into real built-ins). Every image was verified
real via `docker manifest inspect <image>:<tag>` (fast, no full pull) before
being added, not just guessed from a stack's README.

**The seed upserts rather than `onConflictDoNothing()`, and it has to.** A
built-in is code, not user data (`ownerId` null, and `TemplateDTO.owned()`
refuses to hand one to an edit/delete route), so an instance that seeded once
would otherwise keep the first version of every row forever : adding `tags` to
the catalog changed nothing on any existing install, which is exactly how it was
caught. `seedBuiltinTemplates()` now writes every display field back from
`excluded.*` on conflict, so a boot re-syncs the catalog to whatever the code
says. It deliberately doesn't touch `createdAt` or `ownerId`.

**Adding a built-in can push an existing one off the gallery's first page**,
which is how a green local run still failed CI: the built-in list is paginated
at 24, ordered by name, and the docs-screenshot spec used to wait for
`/Jellyfin/i` on `/templates` before capturing. Thirteen new templates moved
Jellyfin to page two and the shot timed out. That expectation is now
`/New Template/i` — present on the page whatever the catalog holds, and absent
from the sidebar, so it still proves the page rendered. Don't anchor a
screenshot (or a test) on a template name.

**Tags (`template.tags`, `text[]`)** are the search keywords a category can't
be: a category is one bucket per template, tags are many and overlap ("sql",
"arr", "self-hosted"). `TemplateDTO.listPaged` ORs a `tagSearchCondition` over
the existing name/description/image `searchCondition` —
`array_to_string(tags, ' ') ILIKE '%q%'` rather than a column list, since
`searchCondition` only takes text columns and this one is an array. The Tags
field on `templates/new` is comma-separated text run through `parseTags`
(`$lib/server/validation/template.ts`: trimmed, lowercased, de-duplicated, 12
tags of 30 chars max, so one paste can't fill the column), and every built-in
carries its own set, checked by a test that fails on an untagged one.

Every template row (`template.category`/`sourceUrl`/`websiteUrl`, the latter two
added to `schema.ts` and `TemplateDTO.NewTemplateInput` alongside the
pre-existing `icon`) can carry a source-code and a website link, shown as
external-link buttons on the template details page (below); either can be `null`
(some projects genuinely have no separate marketing site).

**Icons are real bundled app logos, not generic per-category lucide icons.**
`static/template-icons/` holds the downloaded SVG/PNG files (named
`<id-without-builtin->.{svg,png}`, e.g. `redis.svg`, `ghost.png`), sourced from
[selfh.st/icons](https://selfh.st/icons/) (the de facto self-hosted-app icon
set, also used by Homepage/Dashy/Homarr), CC BY 4.0, bundled locally rather than
hotlinked from its CDN for the same "self-hosted app shouldn't need outbound
internet to render" reasoning as the Swagger UI docs page (see API Docs page
below) — attribution credited in the templates gallery's own footer. A
template's `icon` column holds a bundled filename (`"redis.svg"`) when a real
logo exists, or `null`/a legacy category string for one that predates this
(anything without a `.` in it). `$lib/components/template-icon.svelte` is the
one place that renders a template's icon anywhere in the app (the gallery, the
details page, template-linking pickers on `templates/new`/`services/new`):
`icon.includes(".")` picks the bundled `<img>` path (`/template-icons/<icon>`),
otherwise it falls back to
`templateCategoryIcon(category)`/`templateCategoryColor(category)`
(`$lib/constants.ts`, `TEMPLATE_CATEGORY_ICONS`/`TEMPLATE_CATEGORY_COLORS`,
keyed by the `category` column) — one lucide icon and one accent color per
category (e.g. media is rose, database is emerald, monitoring is cyan), not a
flat single fallback color, so an app without an official logo is still visually
distinguishable at a glance from its neighbors. `templateIcon()`/
`TEMPLATE_ICONS` (the old flat category→icon map this replaced) no longer exist.

The gallery (`templates/+page.svelte`) uses the shared list-page toolkit (see
Shared UI components above) for its search (matches name/description/image) and
category filter (pills built from whatever categories are actually present
rather than a hardcoded list, `TemplateDTO.listCategories`), plus a list/card
`ViewModeToggle` (`new ViewMode("templates", "card")`, card is the default here,
unlike every other list page). This replaced the page's own earlier bespoke
search-input-plus-`Drawer` implementation (`$lib/components/ui/drawer`,
vaul-svelte's `direction` prop), now generalized into `entity-toolbar.svelte`
and shared with every other list page instead of being templates-only. The
built-in and custom sections paginate **independently**, 24 per page each,
`TemplateDTO.listPaged(userId, "builtin" | "mine", query)` called twice with two
separate `ListQuery`s (`pageParam: "bpage"` / `"mpage"`, see Server-side list
pagination above), one shared search/category toolbar filtering both, two
`<Pagination>` footers reading their own param. Each card/row links to
`templates/[templateId]/`, a details page (`+page.server.ts` guards via
`TemplateDTO.usable`, same built-in-or-owned rule every deploy-from-template
path uses) showing the full description, container port/CPU/memory/env vars, the
source/website links, any linked companion templates (below), and the GitHub
repo panel/readme (below). Every card and the details page carry two actions
instead of one: **Quick Deploy** (primary) calls a `quickDeploy` form action
(`$lib/services/template-links.ts`'s `quickDeployFromTemplate()`, shared by both
routes) that creates the service straight from the template's defaults
(name/slug auto-generated via `slugify`) and deploys it immediately, no wizard;
**Configure** (secondary) is the old single "Deploy" button, renamed since it
only navigates into `services/new` (carrying `templateId`, and `stackId` when
arrived at from a stack) to let the user tweak first. The gallery's
`quickDeploy` action returns a plain success object (not a redirect) so
`use:enhance` can show a `toast.success` with a "View" button instead of yanking
the user out of the grid mid-browse, letting several templates get
quick-deployed back to back; the details page's own action still `redirect()`s
straight to the new service, no grid to lose there.

**GitHub repo enrichment** (`$lib/services/github-repo.service.ts`): when a
template's `sourceUrl` is a `github.com` URL, the details page's `load` calls
`getGitHubRepoInfo()`, which resolves owner/repo from the URL and hits
`api.github.com`'s repo/releases/readme endpoints (unauthenticated, so the usual
public 60 req/hr-per-IP limit applies) for star count, last-push time, latest
release tag, and the rendered readme. Returned **without being awaited** in
`load()`, SvelteKit streams it, so a slow/rate-limited GitHub response doesn't
block the rest of the page; `+page.svelte` renders it via
`{#await data.github then repo}`. Every fetch has an 8s `AbortSignal.timeout`
and the whole thing is wrapped in try/catch, GitHub being slow or down never
breaks the page, `getGitHubRepoInfo()` just resolves to `null` and the panel/
readme sections don't render. Results are cached in-memory per `owner/repo` (1h
TTL, HMR-safe `globalThis` singleton, same pattern as the db client) since every
viewer of the same template would otherwise re-hit the same three endpoints. The
readme is rendered with `marked` (already a dependency) through a custom
renderer that resolves relative image/link paths against the repo's default
branch (`raw.githubusercontent.com` for images, a `blob/<branch>/` GitHub URL
for links), then run through `sanitize-html` (a new dependency, added
specifically for this) before being sent to the client and rendered via
`{@html}`. This sanitization step is load-bearing, not decorative: a template's
`sourceUrl` is user-settable (a developer can save any service as a template
with any source URL), so a malicious template could point at a repo whose README
is crafted to exploit gaps in GitHub's own rendering; sanitizing server-side
means the client only ever receives an already-restricted tag/attribute
allowlist, regardless of what GitHub returned.

## Status pages (`status_page`)

A status page groups services and answers one question — is this up? — for an
audience that may not be signed in. Three shapes, set by `scope`:

- `global` : every service the owner has.
- `stack` : that stack's services.
- `custom` : a hand-picked list, the only one that reads `status_page_service`.

**`global` and `stack` resolve live** (`StatusPageDTO.serviceIds()` queries
`service` on every read) so deploying a new service puts it on the page without
anyone re-editing it. That's the whole reason the join table isn't used for all
three.

`/status-pages` is the operator's view: health of every service and the pages
themselves, with a link out to `/notification-channels`. `/status/<slug>` is the
public one, and the routing and disclosure rules for it are in `routing.md`:
read that before touching either.

**Alerts fire on a state change, not on a state.** `uptime-probe.ts`'s tick
reads the previous beat per probe before recording the new one and
`detectTransitions` diffs them, so a service that's been down for an hour
doesn't re-alert every minute, and a probe with no previous beat never alerts at
all (otherwise the first tick after a deploy, or after `prune()` cleared the
window, would alert on everything at once). A transition no longer needs a
status page at all : it's dispatched straight to every account-wide channel
subscribed to `service.down`/`service.up`, see Outbound notification channels in
`observability.md` for the channel model (`notification_channel`,
`NotificationChannelService`) and `tests/unit/app/status-alert.test.ts` for the
transition logic itself.

## Git-based builds (`src/lib/services/docker/git-build.ts`)

A service's `buildSource` is `"image"` (bring-your-own, the default) or `"git"`,
set on the new-service form or edited later on the Source tab, both share the
same "Deploy from" toggle UI.

**The clone runs in a container, into a Docker volume — never on the host.**
`buildFromGit()` creates a throwaway `homerun-build-<uuid>` volume, runs
`alpine/git` against it (`clone --depth 1 --branch <ref> --single-branch` into
`/workspace/repo`, then a second container for `rev-parse HEAD`), reads the
build context back out as a tar stream, and hands that stream to dockerode's
`buildImage()`. The result is tagged `homerun-build-<slug>:<timestamp>`, a fresh
tag every build, same "never reuse a name across deploys" precedent as container
names. Progress lines stream into the deployment log exactly like `pullImage`'s
layer-status events (filtered to status changes, not every line, build output is
chattier than a pull). The volume and both containers are always removed
afterward (`finally`), success or failure. A bare commit SHA doesn't work
(shallow clone by branch/tag only, not by arbitrary ref).

This replaced `execFile("git", ...)` into an `mkdtemp()` directory, and it was a
**production bug fix, not a refactor**: the runtime image is `oven/bun:1-alpine`
plus `ca-certificates` and `su-exec` (see the `app` stage of the `Dockerfile`),
which has no `git`, so the old code failed with ENOENT and git-based builds only
ever worked in dev. Verified by running the base image: `command -v git` finds
nothing. The temp directory was the second problem — inside the container it was
the container's own ephemeral writable layer, not a volume, so a large clone
grew the container unboundedly and vanished on restart.

Four things about this shape are load-bearing:

- **It stays on one daemon.** A real Docker-in-Docker sidecar would build on a
  _different_ daemon, and the image would then need a cache registry to get back
  to the deploy target — the same constraint `deploy.service.ts` already
  enforces for build servers. Streaming the context to the existing daemon
  avoids inheriting that.
- **The archive path ends in `/.`.** `getArchive({path: "/workspace/repo"})`
  prefixes every tar entry with `repo/`, and the daemon then can't find the
  Dockerfile at the context root; `"/workspace/repo/."` roots the entries at
  `./`. Verified live both ways.
- **Argv is passed directly, never through `sh -c`.** The repo URL and ref are
  user input.
- **Container output is demuxed, not stripped.** Docker frames non-TTY output
  with an 8-byte header whose big-endian length bytes are often printable ASCII
  — a 41-byte frame carries `)`. A "drop control characters" pass left that `)`
  glued to the front of the commit SHA (a real, observed
  `Building commit )68c1b9`), so `demuxDockerFrames` walks the frames properly
  and `extractCommitSha` matches `\b[0-9a-f]{40}\b` rather than slicing. Both
  are pure and unit-tested in `tests/unit/app/git-build.test.ts`.

`packages/agent/docker.ts` still shells out to `git` for agent-dispatched builds
and its image has no `git` either : same latent bug, tracked in `TODO.md`.

Any git-clone-able HTTPS URL works, this is what makes it "Git providers,
including self-hosted Gitea" without any provider-specific API integration for
the clone/build step itself: cloning is provider-agnostic at the URL level, so
GitHub/GitLab/a self-hosted Gitea instance/anything else all just work the same
way. There's still no webhook/auto-deploy-on-push, a git-mode service is
redeployed the same way an image-mode one is (manually, or via its own
`cronSchedule` for `:latest`-tracking-equivalent auto-rebuilds). There **is**
now a repo-browsing UI and OAuth-based private-repo access, see Git provider
connections below; a private repo can still fall back to a token embedded in the
URL (`https://TOKEN@host/...`) without connecting a provider at all.

**Build cache and build servers** (`build_cache_registry`,
`service.buildCacheRegistryId`/`buildServerRemoteHostId`,
`/build-cache-registries`): a git-mode service can name a registry credential to
use purely as a layer cache, `git-build.ts` pulls `<registry>/<cache ref>`
before the build, passes it as `cachefrom`, and pushes the fresh layers back
afterward. Both directions are best-effort: a missing cache image or a failed
push logs and continues, it never fails the build. **Real, tested finding**: the
classic (non-BuildKit) build API this app uses wants `cachefrom` as a
JSON-encoded _array string_ despite `@types/dockerode` typing it as a plain
string, a bare string 400s with `error reading cache-from: invalid character`;
and `BUILDKIT_INLINE_CACHE` is a BuildKit-only concept the classic builder warns
about and ignores, real reuse comes from the cache image's own layers (verified
live, a repeat build showed "Using cache" for every step).
`buildServerRemoteHostId` picks a _different_ host to build on than the one the
service deploys to (any registered Remote Host, see Build servers below);
`deploy.service.ts` rejects that combination outright unless a cache registry is
configured too, since publishing through that registry is the only way the built
image reaches the deploy target.

## Git provider connections (`instance_settings.gitProviders`, `git_connection` table, `$lib/services/git-provider.service.ts`, `/git-providers`)

Separate from the git-clone-based builds above, this is what makes the Source
tab's "Browse repos" picker possible instead of pasting a raw URL. Two layers,
matching how OAuth generally works: an **OAuth App** registered once per
provider (GitHub/GitLab/self-hosted Gitea/Bitbucket) on that provider's own
site, configured on the `/git-providers` page (admin-only to add/remove,
DB-backed, `instance_settings.gitProviders` jsonb array, same "settings stored
in the DB via a form" convention as SMTP/OAuth-login providers, not env-only);
and a **connection**, one user's own OAuth authorization against one configured
provider (`git_connection` table, `userId` + `providerId`, AES-256-GCM-encrypted
access/refresh token), every developer connects their own account from the same
page, admin-configuring-the-app is a one-time step separate from each user's own
connect.

`GitProviderService` (`$lib/services/git-provider.service.ts`) implements one
standard OAuth2 authorization-code flow, parameterized per provider kind
(`endpoints()`, authorize/token/API base URLs and scope differ; Bitbucket
authenticates its token exchange via HTTP Basic instead of body params,
everything else is uniform). `createState()`/`verifyState()` sign a stateless
CSRF state param with `config.auth.secret` (HMAC + `timingSafeEqual`) rather
than a DB-backed state table, nothing to clean up, verified purely from the
value itself. The OAuth round-trip lives under
`/api/v1/git-providers/[providerId]/{connect,callback}` (outside `(protected)/`
for the same reason the REST API is, a provider's own redirect can't carry
cookies through a page-load auth guard the same way). The Source tab's repo
picker (`$lib/components/git-repo-picker.svelte`) lists the connected account's
repos and checks for a `Dockerfile` at a given ref through
`$lib/remote/git-repos.remote.ts`, not a `+server.ts` route, see Remote
functions below; both go through `GitProviderService.listRepos`/`hasDockerfile`,
which branch per-kind the same way `endpoints()` does.

**Not live-tested against a real registered OAuth App**, unlike everything else
in this document's "real, tested" notes, this one couldn't be verified
end-to-end in the session that built it: doing so requires an admin to actually
register an OAuth App on GitHub/GitLab/Gitea/Bitbucket's own site first, with a
real callback URL, which nothing server-side can do standalone. Built carefully
from each provider's own standard, well-documented OAuth2 + REST API shapes;
verify the first real connect by hand once an OAuth App exists.

## Migrating from Dokploy or Coolify (`settings/migrate/`)

Admin-only tab under `/settings`: `settings/migrate/+page.svelte` picks the
source, `settings/migrate/dokploy/` and `settings/migrate/coolify/` are one
route each, both rendering `$lib/components/migrate-panel.svelte` with actions
from `migrationActions(source)` (`$lib/server/migrate-actions.ts`). One form
carries URL + token; `?/preview` reads and returns a secret-free
`MigrationPreview`, the "Import" button posts the same form to `?/import`
(`formaction`) with the ticked ids as repeated `ids` fields. **The import
re-reads the source for just those ids** rather than trusting a plan JSON sent
back from the browser, so env values and passwords never reach the client and
the token is never stored.

Layering: `$lib/migrate/common.ts` (types, `MigrationHttpClient`, env/compose
helpers, `previewEntries`), `$lib/migrate/dokploy.ts` and
`$lib/migrate/coolify.ts` (pure raw-JSON → `MigrationEntry` mappers, no DB),
`DokployService`/`CoolifyService` (the HTTP walk) and `MigrationService`
(`$lib/services/migration.service.ts`, preview slug check + import). Every entry
is expressed as `ComposeServiceDraft[]` and imported through
`ComposeImportService.importPlan`, one call per entry, into a stack matched or
created by the source project's name, so volumes, slug uniqueness and
notifications are the compose importer's, not a second copy.

**Dokploy, verified against a live instance (Dokploy with environments):**

- `GET /api/project.all` with `x-api-key` answers a **bare array**, no
  `result.data` wrapper. The resources are **not** on the project: they're under
  `project.environments[]` (`applications`, `compose`, `postgres`, `mysql`,
  `mariadb`, `mongo`, `redis`, `libsql`), and each is only a summary
  (`applicationId`/`name`/`applicationStatus`, a database is just
  `{ postgresId }`). The previous client read `project.applications`, found
  nothing, and rendered an empty dry run with a disabled Import button, which is
  the "does absolutely nothing" bug. `dokployRefs` still falls back to a flat
  project for older versions.
- The detail comes from `GET /api/<type>.one?<type>Id=` (`application.one`,
  `compose.one`, `postgres.one`, ...), fetched 6 at a time.
- Application: `sourceType` is `docker` (`dockerImage`, `username`/`registryUrl`
  for a private registry) or `github`/`gitlab`/`gitea`/`bitbucket`/`git`, with
  per-provider fields (`owner`/`repository`/`branch`/`buildPath` for GitHub,
  `giteaOwner`/`giteaRepository`/`giteaBranch`/`giteaBuildPath` plus the host in
  the nested `gitea.giteaUrl`, `customGitUrl`/`customGitBranch` for plain git).
  `buildType` is `dockerfile`/`nixpacks`/`static`/`railpack`/..., only
  `dockerfile` is importable (`dockerfile`, `dockerContextPath`). `env` is a
  `.env` blob or `null`. There's no port field: the port is `domains[].port`
  (`ports[]` is published ports). `mounts[]` is
  `{ type: "volume"|"bind"|"file", volumeName, hostPath, mountPath }`, and a
  read-only bind carries `:ro` inside `mountPath`. `memoryLimit`/`cpuLimit` are
  strings or null.
- Compose: `composeFile` holds the YAML only for `sourceType: "raw"`;
  `domains[].serviceName` names the compose service a domain routes to, used to
  mark it public with that port. `env` is used for `${VAR}` substitution.
  Dokploy runs stacks as `docker compose -p <appName>`, so a named volume on
  disk is `<appName>_<key>` : `dokployComposeVolume` rewrites each draft's
  volume source to that, unless the top-level declaration has `name:` (used
  as-is) or `external` (left plain). Checked against the live instance: every
  stack had `randomize: false` and `isolatedDeployment: false`, which Dokploy
  uses to suffix names further; those aren't handled.
- Databases: `dockerImage`, `databaseName`/`databaseUser`/`databasePassword`/
  `databaseRootPassword`, `externalPort`, and `mounts[]` including the
  auto-created data volume. The Redis password is applied by Dokploy through the
  start command, so it only produces a warning here.

**Coolify is not verified against a live instance.** Built from the documented
v4 API: `Authorization: Bearer`, `GET /api/v1/projects` (+
`/api/v1/projects/{uuid}` for `environments[].id`, which maps an app's
`environment_id` to its project name), `/api/v1/applications`,
`/api/v1/services`, `/api/v1/databases`, and
`/api/v1/{applications,services}/ {uuid}/envs` for env (non-preview rows,
`real_value` over `value`). Application `build_pack` drives the mapping:
`dockerimage` (`docker_registry_image_name`/`_tag`), `dockerfile` with
`git_repository` (`base_directory`, `dockerfile_location`, a bare `owner/repo`
is assumed to be GitHub), `dockercompose` (`docker_compose_raw`); everything
else is blocked. Ports come from `ports_exposes`, public from `fqdn`. Services
are compose (`docker_compose_raw`, env substituted so `SERVICE_FQDN_*` resolve).
Databases map `database_type` +
`postgres_*`/`mysql_*`/`mariadb_*`/`mongo_initdb_*` fields. The parsing accepts
a bare array or a `data` wrapper. Persistent storage isn't read (warned). First
real Coolify migration is the real test.
