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
depending on the target's image — and optionally puts both on one project
network, since two services only reach each other by slug once they share one.
It moves them into whichever project either is already in, and creates one named
after the source otherwise.

## Where creating something lands you

Every create path ends on the thing it just made, not on a list: the wizard's
**Create service** and **Create and deploy** both redirect to `/services/<id>`,
and a template's **Quick Deploy** does the same from both the catalog and the
template's own detail page. The one exception is a create that produced
_companions_ (a template pulling in its linked services, see Template links
below): those land on `/projects/<id>`, where all of them are visible together,
which is the only view that shows the whole thing that was just created. The
catalog's Quick Deploy used to return an `href` and offer a "View" button on its
toast instead; the redirect now happens server-side, the same way the detail
page always did.

## Shared deploy pipeline (`src/lib/services/deploy.service.ts`)

`DeploymentService.deployService(svc, userId, clientDeploymentId?)` is the one
pull-or-build→create-container→start implementation, used by the service
Overview page's `deploy` action, `POST /api/v1/services/[serviceId]/deploy`, and
the cron redeploy scheduler (below). Branches on `svc.buildSource` right at the
top: `"image"` pulls as before; `"git"` calls `DockerService.buildFromGit()`
(below) and overwrites `svc.image`/`svc.tag` with the resulting local tag
_before_ `createAndStartContainer` runs, so the container step never needs to
know which path produced the image. Returns
`{success, deploymentId, containerId?, error?}` rather than throwing, callers
decide how to surface failure (a SvelteKit `fail()`, a JSON error body, a
scheduler log line). Don't reimplement this inline in a new call site; extend
the shared method instead.

## Compose import (`$lib/compose-import.ts`, `$lib/services/compose-import.service.ts`, `(protected)/services/import/`)

Paste a `docker-compose.yaml`, get Homerun rows. Two halves, deliberately split:
`$lib/compose-import.ts` is a **pure parser** (the `yaml` package, no DB, no
Docker) turning compose text into a `ComposeImportPlan`
(`services: ComposeServiceDraft[]`, plus file-level `warnings`/`networkNames`/
`volumeNames`), covered directly by `tests/unit/app/compose-import.test.ts`;
`compose-import.service.ts` is the row-creating half (`ComposeImportService`, a
plain instance singleton) that turns a plan into `ProjectDTO`/`ServiceDTO`/
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
project**, since a project already _is_ a Docker network here, so a file's own
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
"Paste .env": pick any service the user already owns (**regardless of project**,
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
phase that always passes instantly would be a lie.

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
hostname on the shared network regardless of project, same
`http://<slug>:<port>` addressing every service already gets) or
`{{alias.ENV_KEY}}` (resolves to that linked service's own resolved value for
that env var, e.g. `{{db.POSTGRES_PASSWORD}}`). Resolution
(`$lib/services/template-links.ts`'s `resolveLinkTokens`) leaves an unknown
token untouched rather than stripping it, so a typo'd alias fails loud (visible
literally in the deployed env var) instead of silently producing an empty value.
Linked templates' own env vars are used as-is, not further resolved : only the
primary can reference `{{alias}}` tokens, not link-to-link.

Deploying from a linked template (`services/new`'s `create`/`createAndDeploy`
actions, via `buildTemplateLinkContext`/`createLinkedServices`) : if the service
being created has no project yet, one is auto-created (named after it) so the
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
being added, not just guessed from a project's README.

**The seed upserts rather than `onConflictDoNothing()`, and it has to.** A
built-in is code, not user data (`ownerId` null, and `TemplateDTO.owned()`
refuses to hand one to an edit/delete route), so an instance that seeded once
would otherwise keep the first version of every row forever : adding `tags` to
the catalog changed nothing on any existing install, which is exactly how it was
caught. `seedBuiltinTemplates()` now writes every display field back from
`excluded.*` on conflict, so a boot re-syncs the catalog to whatever the code
says. It deliberately doesn't touch `createdAt` or `ownerId`.

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
only navigates into `services/new` (carrying `templateId`, and `projectId` when
arrived at from a project) to let the user tweak first. The gallery's
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

## Status pages and alerting (`status_page`, `notification_channel`, `status-alert.service.ts`)

A status page groups services and answers one question — is this up? — for an
audience that may not be signed in. Three shapes, set by `scope`:

- `global` : every service the owner has.
- `project` : that project's services.
- `custom` : a hand-picked list, the only one that reads `status_page_service`.

**`global` and `project` resolve live** (`StatusPageDTO.serviceIds()` queries
`service` on every read) so deploying a new service puts it on the page without
anyone re-editing it. That's the whole reason the join table isn't used for all
three.

`/status-pages` is the operator's view: health of every service, the pages
themselves, and the notification channels. `/status/<slug>` is the public one,
and the routing and disclosure rules for it are in `routing.md` — read that
before touching either.

**Alerts fire on a state change, not on a state.** `uptime-probe.ts`'s tick
reads the previous beat per probe before recording the new one and
`detectTransitions` diffs them, so a service that's been down for an hour
doesn't re-alert every minute, and a probe with no previous beat never alerts at
all (otherwise the first tick after a deploy, or after `prune()` cleared the
window, would alert on everything at once). Each transition reaches the channels
of every page covering that service : `listForStatusPage` returns that page's
own channels plus every account-wide one (`statusPageId` null).

A channel is a generic JSON `POST` or an email. Failures are contained — caught
per channel, logged, and stored on `notification_channel.lastError` so a
silently-broken webhook is visible in the UI instead of just never firing. Email
needs SMTP configured and says so rather than failing opaquely. The payload
shape and the two formatters (`alertSubject`/`alertBody`) are pure and
unit-tested in `tests/unit/app/status-alert.test.ts`, along with the transition
logic.

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
