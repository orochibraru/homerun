# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What this is

Homerun, a self-hosted, single-user PaaS for deploying Docker containers with a
click-config form (a minimal Dokploy/Cloud-Run alternative). Point at an image
(or a git repo, see below), fill in env vars/port/resources, deploy, Traefik
auto-routes it to `<slug>.<baseDomain>` with TLS. Single host, local Docker
socket only; no multi-node orchestration. A service is either
"bring-your-own-image" (the original/default) or "build from a git repo"
(clones + builds a Dockerfile locally, no registry involved), see Git-based
builds below.

Stack: SvelteKit 2 (Svelte 5 runes) + Bun runtime, better-auth, Drizzle ORM over
Postgres (via Bun's built-in `SQL` client, `drizzle-orm/bun-sql`, no `pg`
dependency needed), Tailwind v4 + shadcn-svelte ("vega" style), dockerode.

## Commands

```bash
bun run dev              # vite dev
bun run build            # vite build
bun run start             # bun run ./build/index.js (serve the built app)
bun run check            # svelte-kit sync && svelte-check --fail-on-warnings, the real gate, see note below
bun run lint             # biome check ., rustywind is a listed dependency but not currently wired into any script (real drift exists, see note below if you're about to fix that)
bun run lint:fix         # biome check . --write --unsafe
bun run db:generate      # drizzle-kit generate, regenerate migrations from src/lib/server/db/schema.ts
bun run component:add    # shadcn-svelte add <name>, installs a UI primitive into src/lib/components/ui/
docker compose up -d     # bootstraps Traefik + Postgres (see compose.yaml), required, the app has no fallback DB
bun run release          # semantic-release, normally CI-only (.github/workflows/publish.yaml), see Release automation below
```

```bash
bun test              # bun test tests, unit tests for agent/installer/cli (see below), the SvelteKit app itself still has none
bun test:agent        # bun test tests/agent
bun test:cli          # bun test tests/cli
bun test:installer    # bun test tests/installer
```

`agent/`, `installer/`, and `cli/` are separate standalone Bun/TypeScript
sub-projects (their own `tsconfig.json`, checked via the root `check:agent`/
`check:cli`/`check:installer` scripts and compiled via
`scripts/build-packages.ts`, **not** their own `package.json`/`bun install`,
they share the root one), not part of the SvelteKit app above, see "Homerun
Agent + installer" and "Homerun CLI" below for what they are.

### Unit tests (`tests/`)

Bun's native test runner (`bun:test`), covering `agent/`, `installer/`, and
`cli/`, the SvelteKit app itself has no test coverage yet beyond a
`tests/app/svelte-loader.ts` Svelte-compiling preload helper staged for future
component tests. Tests live under a root `tests/<package>/` tree, **not** next
to the source files they cover (`tests/agent/token.test.ts` tests
`agent/token.ts`, etc.), mirroring `tests/app/`'s existing layout rather than
giving each standalone sub-project its own `tests/` folder.

**Module mocks are process-global, not per-file**, `bun:test`'s
`mock.module(specifier, factory)` replaces that specifier's registry entry for
the rest of the whole `bun test` run (every file shares one module registry),
and it does so retroactively : code that already imported the real module before
the mock call still sees the new value, since named imports are live bindings
onto the same object `mock.module` mutates in place. Two test files that
`mock.module` the _same_ specifier with different fakes will collide regardless
of which order they happen to run in (there's no reliable "restore after this
file" boundary the way there is per-`describe`/`it`). Two patterns avoid this:

- **A plain mutable singleton** (`agent/config.ts`'s `config` object) : save the
  fields you're about to override, mutate them directly, restore in `afterEach`.
  No module registry involved at all.
- **A handful of named functions on an otherwise-real module**
  (`agent/docker.ts`'s functions, as faked out for `http.test.ts`;
  `cli/output.ts`'s `fail`) :
  `spyOn(moduleNamespace, "fnName").mockImplementation(...)`, restored via
  `mock.restore()` in `afterEach`. This only patches the specific functions
  used, so it doesn't collide with another file needing the _real_
  implementation of the same module (`docker.test.ts` needs the real
  `agent/docker.ts`, backed by a mocked `dockerode`, at the same time
  `http.test.ts` fakes `agent/docker.ts`'s functions out from under
  `agent/http.ts` : `mock.module("../../agent/docker", ...)` in one file would
  have broken the other regardless of run order, `spyOn` doesn't).

`mock.module` wholesale (replacing an entire module) is still the right tool
when nothing else in the suite touches that specifier at all, `docker.test.ts`
mocks `dockerode` itself this way since agent/docker.ts is the only importer of
it in this whole repo.

**`cli/config.ts` resolves its config file path from `os.homedir()` once, at
module load**, and `os.homedir()` itself is fixed for the life of the process
(reads the real OS environment at process start, verified : changing
`process.env.HOME` mid-run does _not_ change what it returns on Bun 1.4.0), so
an ordinary per-file `mock.module("node:os", ...)` can't reliably help either
(same "process-global, whoever imports first wins" problem as above).
`tests/support/homedir-preload.ts`, loaded via `bunfig.toml`'s `[test].preload`
(guaranteed to run before _any_ test file's own imports, once, for the whole
run), mocks `node:os`'s `homedir()` to a fresh scratch directory while passing
every other export through unchanged (`agent/stats.ts`'s real
`cpus()`/`totalmem()` usage still works). This is what actually keeps
`tests/cli/`'s config/client/login tests off a real developer's
`~/.config/homerun/config.json` : a completely bare `bun test`, no wrapper
script or env var needed, already lands in the scratch directory. Every test
file that touches `cli/config.ts` (directly or via
`cli/client.ts`/`cli/login.ts`) still guards against this invariant ever
breaking (`if (!homedir().startsWith(tmpdir())) throw ...`) rather than silently
writing to a real developer's config if the preload entry is ever removed.

**Coverage** is on by default for every `bun test` run (`bunfig.toml`'s
`[test].coverage = true`, `coverageReporter = ["text", "lcov"]`,
`coveragePathIgnorePatterns` scoped away from `tests/**` and
`cli/generated/**`), reporting only on whatever files the tests that actually
ran touched (scoping to one package via `bun test:agent` shows just that
package, not a 0%-everywhere table for the rest of the repo). No
`coverageThreshold` is enforced yet, this suite is new; add one once coverage
has stabilized if regression protection is wanted.

**Real, tested finding from writing these tests**:
`Bun.write(path, data, { mode: 0o600 })`'s `mode` option is silently a no-op on
Bun 1.4.0, the file still lands as whatever the umask produces (0644 under the
common 022 umask), verified directly. `agent/token.ts`'s persisted agent token,
a full-access API credential, was affected by exactly this : it landed
group/other-readable on a shared host despite the code explicitly asking
for 0600. Fixed by calling `node:fs/promises`'s `chmod()` explicitly after
`Bun.write` (verified : `node:fs`'s own `mode` option, unlike Bun's, is
honored). If a future change writes another secret to disk via `Bun.write`,
don't trust its `mode` option either, `chmod` afterward.

**`bun run check` now works and is a hard gate, zero errors, zero warnings,
across the whole repo, after every change.** This used to be documented as
broken (a stale `typescript@^7.0.2`/`--tsgo` mismatch), that's since been fixed
(plain `typescript: ~6`, no `--tsgo`), and the script now runs
`svelte-check --fail-on-warnings`, so a warning fails the command exactly like
an error does. **"After every change" means run it after every change, not just
once at the end of a session, and it means the whole repo, `bun run check`'s own
scope is already the full `src/` tree regardless of which files you touched, so
don't rationalize a red result as "unrelated to what I changed" without first
confirming that by actually reading the failing file.** The three standalone
sub-projects (`agent/`, `installer/`, `cli/`) aren't covered by this script
(separate `tsconfig.json`s, no SvelteKit), typecheck each with its own
`bunx tsc --noEmit -p tsconfig.json` if you touch one. Same bar for
`bun run lint` (`biome check .`), zero errors. Both are enforced by
`.husky/pre-commit` (see below) so a violating commit is rejected locally, not
just caught in CI.

Biome formats with tabs + double quotes; svelte/vue/astro files have
`useConst`/`useImportType`/unused-import rules turned off (Svelte 5
`$state`/`$props` destructuring trips them). Note: the IDE's inline diagnostics
have proven frequently stale/phantom in this repo (showing parse errors that
don't reflect the real file), `bunx biome check <file>` is ground truth, always
verify against it before trusting an IDE-reported error.

## AI-assisted development (`.claude/agents/`, `.claude/skills/` → `.agents/skills/`)

This repo has Claude Code skills and subagents encoding the workflows below in
executable detail, not just prose, use them instead of re-deriving the steps by
hand:

- Skills (invoke directly, or they trigger on a matching request): `check-repo`
  (the `bun run check`/`bun run lint`/per-subproject-typecheck gate above, as a
  runnable checklist), `new-dto-route` (schema → DTO → route, with the
  no-manual-typing/no-raw-Drizzle/toJSON rules below baked in),
  `new-docker-mixin` (adding a concern to `DockerService`'s mixin chain, with
  the load-bearing ordering rule), `migration-workflow` (`schema.ts` →
  `db:generate` → apply, with the NOT-NULL-on-existing-rows gotcha).
- Subagents (`.claude/agents/*.md`): `repo-gate` (final review gate before
  calling a change done, scans for this file's own hard rules),
  `scaffold-feature` (adds a new table+DTO+route end to end), `subproject-sync`
  (keeps `agent/`'s hand-reimplemented Docker/stats logic in sync with the main
  app, regenerates `cli/`'s OpenAPI-derived types).

Skill content lives under `.agents/skills/<name>/SKILL.md` with a symlink from
`.claude/skills/`, matching the existing `shadcn-svelte` skill's layout, keep
that pattern for any new skill.

## Conventions (strict, apply to every change)

- **Never manually type anything in a route file**, `+page.svelte`,
  `+layout.svelte`, `+page.server.ts`, `+layout.server.ts`, `+server.ts`. This
  covers `$props()` (`data`/`form`/`children`/`params`) in the `.svelte` files
  _and_ `load`/`actions`/`GET`/`POST` in `.server.ts`/`+server.ts` files. All of
  it is inferred by SvelteKit's tooling from the route's generated `./$types`,
  based on file location, that's the framework working as designed, don't fight
  it. Concretely:
  - `.svelte`: `const { data } = $props();`, never `: { data: PageData }`, never
    `: PageProps`. No
    `PageData`/`LayoutData`/`ActionData`/`PageProps`/`LayoutProps` type name
    appears in a route component at all.
  - `.server.ts` / `+server.ts`:
    `export const load = async ({ locals, parent }) => {...}`, never
    `: PageServerLoad`/`: LayoutServerLoad`. `export const actions = {...}`,
    never `: Actions`. `export const GET = async ({ params, locals }) => {...}`,
    never `: RequestHandler`. No `import type {...} from "./$types"` for any of
    these at all.
  - This rule is specific to route files. Non-route components
    (`$lib/components/**`) and shared server modules (`$lib/services/**`,
    `$lib/server/db/**`, `$lib/server/validation/**`, `$lib/dto/**`) are normal
    TypeScript/Svelte code and should still be typed explicitly as usual,
    there's no route-based inference for those.
- **Nested `load` functions under `(protected)/` must not re-check
  `!locals.user`.** The parent `+layout.server.ts` already redirects
  unauthenticated users before any child `load` runs, so re-checking is dead
  code. Use `const { user } = await parent();` instead. **This does not apply to
  `actions`**, form action submissions don't go through the parent layout's
  `load` at all, so every action keeps its own explicit
  `if (!locals.user) throw redirect(...)` guard.
- **No raw Drizzle queries in route files.** Every table has a corresponding DTO
  class in `src/lib/dto/` (see below), routes call DTO methods, never
  `db.select()/.insert()/.update()/.delete()` directly.
- No unused variables or imports. No lint errors, anywhere in the repo,
  `bun run lint` must be clean before considering a change done.
- **No type errors and no type-check warnings left after any change, anywhere in
  the repo, not just the files touched, `bun run check` must exit clean (0
  errors, 0 warnings, it fails on warnings too, see the note above) before
  considering a change done.** This isn't optional or best-effort: run it for
  real after every change and read what it reports, rather than assuming an
  untouched file's error is pre-existing and therefore not your problem, confirm
  that by actually looking, and fix it either way if it's cheap and unambiguous.
- **Prefer real OOP over a static-only class that just re-exports imported
  functions (or is `static` throughout for no reason beyond habit).** A
  `class Foo { static bar = importedBar; }` barrel (the shape
  `docker.service.ts` and `database.service.ts` used to have, the latter was
  pure dead code duplicating `db/lib.ts` and was deleted outright rather than
  "fixed") isn't real OOP, it's a namespace with extra syntax, and neither is
  `class Foo { static bar() {...} }` once there's no actual reason for `bar` to
  be static. Three reference shapes now exist, pick whichever fits the module:
  - **Plain instance singleton**, the default, and the most common case: a class
    was `static`-only for no real reason (`AdminService`, `ApiService`,
    `DeploymentService`, `GitProviderService`, `SystemStatsService`,
    `UserService`, `S3BackupService`, all under `$lib/services/`). Drop every
    `static`, instantiate once, export the instance under the _same_ name the
    class used to export
    (`class AdminServiceClass {...}; export const AdminService = new AdminServiceClass();`).
    `SystemStatsService` is the clearest win from this: its CPU% delta sample
    (`#lastCpuSample`) used to be an awkward module-scope `let` purely because
    the class had no instance to hang it off, it's now a real private instance
    field. `BaseDockerService`/`BaseScheduler`-style abstract bases stay
    exported as classes, not instances (they're meant to be extended, e.g.
    `BackupService`, not instantiated directly).
  - **Mixin-merge**, when several concerns need to call into each other and
    external code should keep addressing one flat symbol,
    `$lib/services/docker.service.ts`: each concern (containers, networks,
    terminal, reconcile, git-build, custom-ssl, core-services,
    `src/lib/services/docker/*.ts`) is a real class extending
    `BaseDockerService` (`docker/base.ts`), merged into one `DockerService` via
    the TS mixin pattern (each file exports a `SomethingMixin(Base)` function;
    `docker.service.ts` chains them and instantiates once,
    `export const DockerService = new DockerServiceClass()`), and one concern
    calling another's method uses real inheritance (`this.inspectStatus(...)`),
    not a cross-module import.
  - **Composition**, when the pieces are independent and don't call each other,
    `$lib/services/cron.service.ts`: `CronService` composes one instance each of
    `CronRedeployScheduler`/`BackupScheduler`/`AutoscaleScheduler`
    (`src/lib/services/cron/*.ts`), every one extending `BaseScheduler` for its
    shared tick/HMR-guard boilerplate, and a `CronService` static method just
    calls `.start()` on the instance it owns rather than being
    `static start = importedStart`.

    Across all three, a genuinely pure/stateless transform (`docker/labels.ts`,
    `cron/cron-expression.ts`, `api.service.ts`'s
    `parseImageRef`/`parseWwwAuthenticate`, `git-provider.service.ts`'s
    `endpoints`/`authHeader`) is fine left as a plain module-scope function,
    it's the _stateful, side-effecting, or genuinely-multi-concern_ modules this
    convention targets, not every last helper. Every one of these examples keeps
    external call sites unchanged
    (`DockerService.pullImage(...)`/`CronService.startCronScheduler()`/`AdminService.hasAnyUser()`
    all read identically whether the symbol is a class-with-statics or a
    singleton/facade instance), so refactoring a module to this shape doesn't
    have to ripple into routes/DTOs that already call through it. Apply this
    opportunistically when you're already touching a static-barrel module, not
    as a blanket rewrite mandate, same posture as the shared-UI-components note
    above. DTOs (`$lib/dto/*`) are a deliberate exception, not an oversight:
    their `static get()`/`.list()`/`.create()` finders returning per-row
    instances with instance methods (`svc.update()`) is already a correct,
    intentional Repository/Active-Record split, see the DTO layer section below,
    don't "fix" it.

## Architecture

### The DTO layer (`src/lib/dto/`)

Every table is wrapped by a DTO class extending `BaseDTO<TRow>` (`base-dto.ts`):
a thin instance around one DB row that owns its own queries. Route files call
`ServiceDTO.get(id, userId)`, `svc.update({...})`, `svc.delete()` etc. instead
of writing Drizzle inline, this is what "no raw SQL in page.server.ts" means in
practice, and it's also the layer a future REST/CLI API would sit on top of (not
yet built).

- `service-dto.ts`, `ServiceDTO`:
  `get`/`list`/`listByProject`/`listWithProjectNames` (joins in `project.name`
  for the grouped services list)/`slugTaken`/`create`/`update`/`delete`.
- `project-dto.ts`, `ProjectDTO`:
  `get`/`list`/`listWithServiceCounts`/`create`/`update`/`delete` (row-only)
  /`cascadeDelete()` (stops+removes every member container, deletes
  deployments/services, deletes the project row, then removes the project's
  Docker network, the real "delete a project" operation, see
  `projects/[projectId]/+page.server.ts`'s `delete` action).
- `template-dto.ts`, `TemplateDTO`: `usable(id, userId)` (built-in OR owned, for
  deploy-from-template), `owned(id, userId)` (owned only), `listForUser`,
  `create`. Built-ins have `ownerId: null` and are seeded on boot (see below).
- `deployment-dto.ts`, `DeploymentDTO`:
  `get`/`listForService`/`listRecentForUser` (joins in service name/slug, for
  the dashboard)/`create`/`update`/`appendLog(line)` (appends to the live
  progress log, see below).
- `storage-volume-dto.ts`, `StorageVolumeDTO`: `get`/`list`/`create`/`delete`,
  for the `/storage` page's volume sources.
- `service-volume-dto.ts`, `ServiceVolumeDTO`: `listForService` (joined with the
  volume's name/kind/source), `attach`/`detach`, the mounts of a StorageVolume
  into a service, shown on the service's Volumes tab.
- `remote-host-dto.ts`, `RemoteHostDTO`:
  `get`/`list`/`create`/`update`/`delete`, `toConnection()` (decrypts TLS
  material into what `DockerService.getDocker()` wants), and the static
  `connectionFor(svc, userId)` helper every route/module uses instead of calling
  `getDocker()` bare, see Remote hosts below.

**`toJSON()` before returning from `load`**: DTO instances are server-only;
SvelteKit serializes `load` return values with devalue, which can't serialize a
class instance. Every `load` maps DTOs to plain objects via `.toJSON()` (or
`.map(d => d.toJSON())`) before returning.

### Shared UI components (`src/lib/components/`)

Not exhaustive, this app doesn't have (and this session didn't attempt) a full
componentized design system, just the handful of genuinely-duplicated patterns
that got pulled out as they were touched: `status-badge.svelte` (pre-existing),
`empty-state.svelte` (icon/title/subtitle + optional CTA snippet, used on
Storage and Remote Hosts so far, other list pages still have their empty state
inlined), `form-styles.ts` (the `inputClass`/`labelClass`/`errorClass` Tailwind
strings almost every form page redefines identically, imported directly as class
strings, not a wrapper component, so it doesn't force a markup shape change on
pages that predate it; wired into Remote Hosts and the service Networking tab so
far), `stepper.svelte` (the step-indicator-bar-plus-Back/Next chrome and
unlocked-step gating every multi-step form needs, extracted while building the
onboarding wizard, see Onboarding below; not yet retrofitted onto
`services/new`'s own inlined equivalent). If you're touching a page with an
inline empty-state or the same three class-string literals, prefer wiring in the
shared version over copy-pasting again, but this is opportunistic, not a mandate
to refactor unrelated pages.

### Routing: dashboard-only, no public pages

`src/routes/(protected)/` is a route group living at `/` itself (not
`/dashboard`), its `+layout.server.ts` is the single auth guard, redirecting to
`/auth/sign-in` (or `/auth/sign-up` on a blank instance) when signed out,
**and** the single onboarding guard (see Onboarding below), both directions live
in that one `load`. There is no public marketing page. `src/routes/auth/**` is
the only unauthenticated surface.

Top-level sections (sidebar nav): **Overview** (dashboard stats + recent
deployments), **Services**, **Projects**, **Templates**, **Storage**, **Remote
Hosts**, **Users** (admin-only), **Settings** (admin-only), **System Logs**.
`(protected)/+layout.svelte` filters the nav array on
`data.user.role === "admin"` before rendering, a developer sees everything else
unchanged (their own services/projects, already isolated per-user by every DTO's
`userId` scoping). `/setup` was removed (see Setup diagnostics below) in favor
of the dashboard banner deep-linking into `/settings`.

`src/routes/(protected)/services/`:

- `+page.svelte`, list, grouped by project (with an "Ungrouped" bucket when more
  than one group exists), inline start/stop/restart/delete actions
- `new/+page.svelte`, click-config create form, a 4-step wizard (Basic info /
  Networking / Environment / Compute, one `<form>` throughout, steps hidden via
  a CSS class rather than `{#if}` so field state survives navigating between
  them); accepts `?projectId=` and/or `?templateId=` query params to pre-fill
  from a project or template context (does **not** deploy, just persists
  config). "Deploy from" toggles between a Docker image and a git repo (see
  Git-based builds below), same toggle repeated on Settings for editing after
  creation.
- `[serviceId]/+layout.server.ts`, ownership guard (id **and** userId must
  match, else 404) + syncs live Docker status on every visit. Tabs: **Overview**
  (deploy/start/stop/restart, live deploy progress panel, deployment history
  with expandable per-deployment logs, plus an embedded `LiveLogViewer`, see
  Logs below, shown once deployed so recent output is visible without switching
  tabs), **Source** (Deploy-from image/git toggle, image+tag or git repo fields,
  private registry, `updateSourceSchema`, its own `updateSource` action; split
  off Settings so "what gets deployed" has its own tab), **Logs** (live-streamed
  via a `+server.ts` GET returning a chunked `ReadableStream`, rendered through
  `$lib/components/live-log-viewer.svelte`, the same component embedded in
  Overview), **Env Vars**, **Volumes** (mount/unmount StorageVolumes, including
  a "New volume" modal, `$lib/components/new-volume-fields.svelte` shared with
  `/storage/new`, so a volume can be created and mounted without leaving the
  service), **Networking** (custom domain mapping + the auth-gate toggle; a
  **Network** section holds container port, protocol (tcp/udp/both), network
  mode (bridge/host, see below), and DNS-resolvability, `updatePortsSchema`, its
  own `updatePorts` action, moved off Settings; SSL section is a read-only
  explainer for the automatic-vs-custom-cert split, host ports are still never
  _published_/mapped by design even though host network mode now exists, see
  below), **Compute** (cpu/memory limits + the autoscale-eligible opt-in toggle,
  `updateComputeSchema`, its own `updateCompute` action, moved off Settings; see
  Autoscaling below for what the toggle actually does and its own instance-wide
  config), **Terminal** (interactive shell into the live container, see below),
  **Errors** (failed deployments + a live "container currently down" banner +
  "Application errors", persisted app-level warn/error `Logger` output
  attributed to this service, see `app_log`/`AppLogDTO` in Data model below),
  **Settings** (name/slug/restart-policy, move between projects/remote deploy
  target, save-as-template, auto-redeploy cron schedule, danger-zone delete,
  image/git/registry, port/network, and cpu/memory/autoscale fields all moved to
  their own tabs, see Source/Networking/Compute above)
- `[serviceId]/deployments/[deploymentId]/progress/+server.ts`, polled by the
  Overview tab while a deploy is in flight; returns `{log, status}` JSON. The
  client pre-generates the deployment id itself (`crypto.randomUUID()`, set on
  the form via `formData.set("deploymentId", ...)` in `use:enhance`'s pre-submit
  callback) so it can start polling _before_ the deploy request even resolves.
  Polling is status-driven (stops once the deployment reaches a terminal
  status), which is also what makes resuming the progress view after a
  mid-deploy page reload work, `onMount` checks `svc.currentStatus` and resumes
  polling the latest deployment if it's still in-flight.

`src/routes/(protected)/projects/`, `templates/`, `storage/` mirror this pattern
(list + `new/` create route + `[id]` detail where applicable). `system-logs/`
streams the Traefik container's own logs (see Docker integration below).

### REST API (`src/routes/api/v1/`)

Lives outside `(protected)/`, that group's guard is a page-`load` redirect,
wrong for a JSON API that should 401 instead. Every handler starts with its own
`if (!locals.user) return json({error:"Unauthorized"}, {status:401})`;
`locals.user` is populated for both cookie sessions and `x-api-key`/`Bearer`
requests by `hooks.server.ts` (see Auth below), so the same handlers serve the
dashboard's own `fetch` calls and external API-key clients alike.

- `services/`, `GET` list, `POST` create (zod-validated body, not the
  FormData-shaped schema `$lib/server/validation/service.ts`, that one's
  checkbox/`envKey[]`/`envValue[]` preprocessing is form-specific).
- `services/[serviceId]/`, `GET`, `PATCH` (partial update; `registryPassword` in
  the body re-encrypts, omitted means unchanged), `DELETE` (stops/removes the
  container first, same as the Settings danger-zone action).
- `services/[serviceId]/{deploy,start,stop,restart}/`, `POST`. `deploy` awaits
  the full pull→create→start pipeline via `deployService()` (see below) and
  returns once it's done, no separate polling endpoint for API clients (the
  dashboard's own progress-polling UI is unrelated, cookie-session only).
- `projects/`, `templates/`, read/create, same pattern, thinner (no lifecycle
  actions).
- `system-stats/`, `GET`, host CPU/RAM/disk/GPU stats
  (`SystemStatsService.getSystemStats()`). Moved here from a bare
  `(protected)/system-stats/+server.ts`, that route lived directly in the pages
  directory even though it's pure JSON with no page, which is what
  `(protected)/` is otherwise exclusively for; the dashboard's own 5s poll
  (`(protected)/+page.svelte`) now fetches `/api/v1/system-stats` instead.
- `openapi.json/`, `GET`, public/unauthenticated (the spec describes shapes, not
  data; every documented route still enforces its own auth independently).
  Serves the OpenAPI 3.1 document built by `$lib/openapi/build.ts`, see below.

This is deliberately a thin JSON wrapper over the DTO layer, not a new
abstraction, the `cli/` sub-project talks to this (see below).

### OpenAPI (`$lib/openapi/`, `$lib/server/validation/api.ts`)

`GET /api/v1/openapi.json` serves a real OpenAPI 3.1 document, generated (not
hand-written) from `$lib/openapi/build.ts` + `registry.ts`. Request bodies are
the _actual_ zod schemas that validate each request at runtime
(`$lib/server/validation/api.ts`,
`createServiceApiBody`/`updateServiceApiBody`/`createProjectApiBody`, imported
by both the route files and `registry.ts`), converted to JSON Schema via zod
v4's native `z.toJSONSchema()`, one schema instance drives both validation and
docs, so they can't silently drift apart the way a hand-maintained spec would.
`$lib/server/validation/api.ts` is deliberately separate from
`$lib/server/validation/service.ts`, that one's checkbox/`envKey[]`/`envValue[]`
preprocessing is FormData-specific, these are the JSON-body shapes the REST API
actually receives.

Response schemas (`$lib/openapi/schemas.ts`) are _hand-mirrored_ from
`src/lib/server/db/schema.ts`'s columns, not generated, every route's response
is a DTO's `.toJSON()` (the raw DB row), not something validated by a zod schema
at runtime, so there's no single source of truth to generate from the way there
is for requests (a `drizzle-zod`-generated version was tried first and
abandoned, see below). Keep `schemas.ts` in sync by hand if a table's columns
change. The response schemas are honest about what's actually returned,
including `registryPasswordEnc`/`customSslCertEnc`/`customSslKeyEnc`
(ciphertext, not plaintext, since `.toJSON()` returns the whole row), documented
with a note rather than omitted, since omitting them would make the spec
describe a smaller response than the API actually sends.

`registry.ts` is a hand-maintained array of route definitions
(method/path/tags/summary/params/request/responses), there's no metadata
anywhere else in a SvelteKit route file to generate this from automatically.
Keep it in sync when a route's shape changes.

**`drizzle-zod` was tried and abandoned** for the response side: it depends on
`zod/v4`'s subpath export, which resolves fine standalone, but broke under this
repo's Bun install layout with `Cannot find package 'drizzle-orm'` from inside
`drizzle-zod`'s own resolved location, looks like a peer-dependency resolution
quirk specific to Bun's global-cache-backed install strategy, not investigated
further. Hand-mirroring the response schemas avoided it entirely rather than
fighting the resolution issue.

**Verified live**: the served document is a real, valid OpenAPI 3.1 spec, parsed
successfully by `openapi-typescript` (not just eyeballed), used to generate the
actual types `cli/` is built against (see below), and driven end-to-end through
a real account/API key against a real Docker daemon (see `cli/README.md`'s
verification notes).

### Homerun CLI (`cli/`)

A standalone Bun/TypeScript sub-project (own `package.json`, compiles to a
binary via `bun build --compile`, same shape as `agent/`/`installer/` below), a
typed CLI built on [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/)
against the spec above. `cli/src/generated/openapi-types.ts` is generated by
`openapi-typescript` straight from a running instance's real
`/api/v1/openapi.json` (`bun run generate`, checked in as a snapshot, regenerate
after any REST API route change or it silently goes stale, `openapi-fetch`
itself has no way to detect a stale-spec mismatch at compile time). Auth is
`x-api-key`/`--api-key`, same header the REST API's own hooks check first for a
non-cookie caller. Commands: `services {list,get,deploy,start,stop,restart}`,
`projects list`, `templates list`, no `create`/`update`/`delete` yet,
straightforward to add the same way. See `cli/README.md` for the full command
reference and what's verified.

**Verified live, full round trip**, not just typechecked: a throwaway account +
real API key (against an isolated `homerun_test` database, never the
maintainer's real one) drove every command against a real Docker daemon,
`services list`/`get`/`deploy` (a real `nginx:alpine`
pull→create→start)/`start`/`stop`/`restart`, plus the 401-on-bad-key path, all
through the typed `openapi-fetch` client, and the compiled binary behaves
identically to running from source.

### API Docs page (`(protected)/api-docs/`)

A dashboard page (own nav item, "API Docs", not admin-only) rendering the live
`/api/v1/openapi.json` spec via `swagger-ui-dist` (npm dependency, not a CDN
script, this is a self-hosted app, so the docs UI shouldn't need outbound
internet to render). `swagger-ui-bundle.js` is dynamically imported inside
`onMount()`, not at module scope, it touches `window`/`document` at call time,
which would crash SvelteKit's SSR pass otherwise. "Try it out" requests aren't
authenticated by the dashboard's own cookie session (Swagger UI makes its own
`fetch` calls, doesn't share credentials with the page), the page's own copy
says so; a real request there needs a pasted `x-api-key`. **Verified live**: the
page server-renders 200 (not a crash/error boundary) for a real signed-in user,
with the expected `swagger-ui` CSS/container markup present, client-side widget
initialization itself wasn't verified in a real browser (no Playwright/e2e
harness in this repo currently, see below), just that nothing crashes and the
wiring (dynamic import location, CSS import, container ref) matches Swagger UI's
own documented embed pattern.

**No E2E/browser test harness currently exists in this repo**, `e2e/`,
`playwright.config.ts`, `.env.test`, and the `qa` subagent were all removed in a
separate session's `feat: better classes` commit (`87c925d`), alongside the
earlier OOP refactor. Runtime verification for anything client-side-interactive
(a button click, a `$state` mutation actually re-rendering) is now done by hand,
booting a dev server against the isolated `homerun_test` Postgres database
(never the maintainer's real one, same convention the removed `qa` agent used)
and driving it with `curl`/direct HTTP calls, which proves a route doesn't 500
and returns the right shape but can't exercise client-side JS the way a real
browser would. If a future session wants that coverage back, it needs rebuilding
from scratch, not un-deleting, treat the removal as deliberate per this repo's
own "take it as current state" convention.

### The `$derived` + push/splice anti-pattern (real, tested bug)

**Real, tested-in-review finding**: three forms, the Settings page's OAuth
Providers list, `services/new`'s env-var rows, and the service Env Vars tab's
own rows, declared their editable row array with `$derived(...)` and then
mutated it directly (`rows.push(...)`/`rows.splice(...)`), which is exactly why
"Add provider" on the Settings page did nothing observable (the bug that
prompted this fix): a `$derived` value is computed from its dependencies, not a
mutable store, pushing onto it doesn't reliably stick the way it would on
`$state`. Fixed by converting all three to `let rows = $state(...)` seeded once,
with an `$effect` re-syncing from the source data
(`data.settings.oauthProviders`/`data.template`/`svc.envVars`) whenever it
actually changes, not on every keystroke, so in-progress edits aren't clobbered.
`templates/new/+page.svelte`'s equivalent env-var rows already used `$state`
correctly and was the reference proving the fix, if you're adding a new
push/splice-mutated row list anywhere in this app, copy that shape (or the
now-fixed three), never `$derived`.

### Release automation (`.releaserc.json`, `scripts/bump-version.ts`, `scripts/build-release-binaries.ts`)

`semantic-release`, driven by conventional-commit messages (this repo's commits
already follow `feat:`/`fix:`/`chore:`, no new discipline required). Runs as a
new `release` job in `.github/workflows/publish.yaml`, alongside the existing
`code_quality`/`build` jobs, on every push to `main`; a non-releasable push
(docs/chore-only) is a no-op, not a failure. One version number covers the whole
repo, the root app plus `agent/`/`installer`/`cli`'s own `package.json`s all get
bumped together by `scripts/bump-version.ts` (an `@semantic-release/exec`
`prepareCmd`, not `@semantic-release/npm`, this repo has no npm package to
publish, and `npm`'s plugin still wants registry-shaped config even with
`npmPublish: false`; a small script fits this codebase's existing "hand-roll a
small thing rather than fight a mismatched tool" posture better, same instinct
as the cron matcher/SigV4 client). `scripts/build-release-binaries.ts`
cross-compiles all six `agent`/`installer`/`cli` Linux binaries (x64 + arm64,
each sub-project's own `build:linux-x64`/`build:linux-arm64` scripts) so
`.releaserc.json`'s release-assets step has something to attach, directly
serving the "installer (and homerun agent) in each release artifact" TODO item,
with the CLI's own binary added the same way for consistency.

**Uses `@saithodev/semantic-release-gitea`, not the official
`@semantic-release/github` plugin**, this repo's actual git remote is a
self-hosted Gitea (`git.ombrage.space`, the same host `docker.yaml` already
pushes container images to), not GitHub, even though workflows live under
`.github/workflows/` (Gitea Actions consumes that same directory/format). The
release job's `GITEA_TOKEN` env var currently reuses the existing
`PACKAGES_TOKEN` secret.

**Verified as far as possible without real repo write access**:
`scripts/bump-version.ts` and `scripts/build-release-binaries.ts` were both run
for real locally (version bumped across all four `package.json`s and reverted,
all six binaries actually cross-compiled successfully);
`bunx semantic-release --dry-run --no-ci` was run against the real repo and got
all the way through plugin loading, branch/repo detection, and the local
git-push permission check before failing at the Gitea token-verification step on
a deliberately-fake token, confirming the config wiring itself (right plugin,
right repo, right API URL) is sound, which is the most that's checkable without
a real Gitea API token. **Not verified**: an actual release running end-to-end
in CI (creating a real tag/release/GitHub-Actions-equivalent-Gitea-Actions-run),
and specifically whether `PACKAGES_TOKEN`'s scopes cover the Gitea _release_ API
rather than just registry push, if release creation 403s in practice, mint a
dedicated token with repo write access instead of reusing that one.

### Shared deploy pipeline (`src/lib/services/deploy.service.ts`)

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

### Git-based builds (`src/lib/services/docker/git-build.ts`)

A service's `buildSource` is `"image"` (bring-your-own, the default) or `"git"`,
set on the new-service form or edited later on the Source tab, both share the
same "Deploy from" toggle UI. Git mode shells out to the system `git` binary
(`clone --depth 1 --branch <ref> --single-branch`, same "shell out to a
well-known CLI" precedent as `tar`/`df`/`nvidia-smi` elsewhere) into a temp
directory, then `DockerService.buildFromGit()` calls dockerode's `buildImage()`
against that directory (tar'd internally by dockerode, not manually) and tags
the result `homerun-build-<slug>:<timestamp>`, a fresh tag every build, same
"never reuse a name across deploys" precedent as container names. Progress lines
stream into the deployment log exactly like `pullImage`'s layer-status events
(filtered to status changes, not every line, build output is chattier than a
pull). The temp clone directory is always removed afterward (`finally`), success
or failure. A bare commit SHA doesn't work (shallow clone by branch/tag only,
not by arbitrary ref).

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

### Git provider connections (`instance_settings.gitProviders`, `git_connection` table, `$lib/services/git-provider.service.ts`, `/git-providers`)

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
cookies through a page-load auth guard the same way); `repos`/`dockerfile`
endpoints back the Source tab's picker, listing the connected account's repos
and checking for a `Dockerfile` at a given ref via each provider's own REST API
(`listRepos`/`hasDockerfile`, both branch per-kind the same way `endpoints()`
does).

**Not live-tested against a real registered OAuth App**, unlike everything else
in this document's "real, tested" notes, this one couldn't be verified
end-to-end in the session that built it: doing so requires an admin to actually
register an OAuth App on GitHub/GitLab/Gitea/Bitbucket's own site first, with a
real callback URL, which nothing server-side can do standalone. Built carefully
from each provider's own standard, well-documented OAuth2 + REST API shapes;
verify the first real connect by hand once an OAuth App exists.

### Remote hosts (`remote_host` table, `RemoteHostDTO`, `DockerService`)

A service normally deploys to the local Docker socket
(`config.docker.socketPath`), that's still the default
(`service.remoteHostId: null`). Registering a remote host (Remote Hosts page:
name + `tcp://host:port` [+ optional TLS client cert] or `ssh://user@host`) and
picking it as a service's "Deploy target" (Settings tab) routes every Docker
operation for that service, deploy, start/stop/restart, logs, status-sync,
account-deletion cleanup, at that daemon instead.

`services/docker/client.ts`'s `getDocker(remote?: RemoteHostConnection)`
(exposed as `DockerService.getDocker`, see Docker integration below) caches one
dockerode client per host (keyed by remote host id, `"local"` for the default)
in the same HMR-safe `globalThis` pattern as the db singleton.
`RemoteHostDTO.connectionFor(svc, userId)` is the one place that turns a service
into the connection object `getDocker()` wants (returns `undefined` for a local
service), every route/module that touches a service's container calls this
rather than assuming the local socket; if you add a new lifecycle operation,
thread it through the same way rather than calling `getDocker()` bare.

**Real architectural limitation, not an oversight**: the shared `homerun` Docker
network, per-project networks, and Traefik itself all live on the _local_ host.
A remote-hosted container gets Docker's own default `bridge` network instead
(verified via `docker inspect`'s `NetworkMode`), no Traefik routing, no
`<slug>:<port>` internal DNS alias, no project-network membership. It's
genuinely reachable only however you arrange that yourself (there's no
host-port-publishing UI for this, deliberately, see the Networking tab's own "no
port mapping by design" stance). Bind-mount volumes are skipped entirely on a
remote deploy (a local path has no meaning on a different machine),
`deployService()` passes an empty volume list rather than silently creating a
wrong mount. Git-based builds work against a remote host too (dockerode's
`buildImage` streams the tar'd context to whichever daemon the client points
at), but the `git clone` step itself always happens locally first, only the
Docker build step runs remotely.

Verified during development against a real second Docker connection, not just
reasoned about, by running
`socat TCP-LISTEN:12375,fork UNIX-CONNECT:/var/run/docker.sock` (a genuine TCP
proxy in front of the same daemon, standing in for a truly separate remote host)
and deploying a real service through it end-to-end: real container created,
`docker inspect` confirmed `NetworkMode: bridge` (not the shared network), and
start/stop both round-tripped through the proxied connection successfully.

### Custom SSL certificates (`src/lib/services/docker/custom-ssl.ts`)

Per-service, only meaningful once `customDomain` is set (a domain outside this
instance's own base domain, so Traefik's automatic ACME resolver can't cover
it), cert/key PEM stored encrypted
(`service.customSslCertEnc`/`customSslKeyEnc`, same AES-256-GCM scheme as
`registryPasswordEnc`), edited on the Networking tab's SSL section.

`DockerService.syncCustomSslConfig(svc)` runs after every Networking save. It's
a **deliberate no-op unless `config.traefik.dynamicConfigDir` (env
`TRAEFIK_DYNAMIC_CONFIG_DIR`) is set**, this app never modifies the live Traefik
container's command/mounts itself (that's the same "don't touch infra without
the admin's own action" boundary as the remote-hosts feature's Docker daemon
connections, just applied to Traefik instead). When it _is_ set, it decrypts the
cert/key and writes three files into that directory: `certs/<slug>.crt`,
`certs/<slug>.key`, and `<slug>-tls.yml` (a Traefik file-provider dynamic config
pointing at the other two), or removes all three if the cert's been cleared or
the domain's changed. `compose.yaml` has the exact commented-out Traefik flags
(`--providers.file.directory`/`--providers.file.watch`) and bind mount to
uncomment, at the same host path as `TRAEFIK_DYNAMIC_CONFIG_DIR`, a one-time
`docker compose up -d` the admin runs themselves; Traefik's file provider then
picks up changes on its own (`watch=true`), no restart needed per-certificate
after that initial setup.

Verified live: the encrypted round-trip, the no-op path when the dir is unset,
and, with a real directory configured, the three files actually landing with
correct byte-for-byte content, plus correct removal on clear. **Not verified**:
Traefik itself picking up the config, since that requires the live container
change this app deliberately doesn't make.

### Schedulers: cron redeploy, S3 backup, autoscale migration (`src/lib/services/cron.service.ts`, `src/lib/services/cron/`)

`CronService` (`cron.service.ts`) is a facade composing one instance each of
three independent scheduler classes under `services/cron/`,
`CronRedeployScheduler`, `BackupScheduler`, `AutoscaleScheduler`, every one
extending `BaseScheduler` (`cron/base-scheduler.ts`), which owns the shared "60s
`setInterval`, HMR-safe via a `globalThis`-backed registry keyed per subclass
(same pattern as the db singleton in `db/lib.ts`), idempotent `start()`"
boilerplate; a subclass only implements its own `tick()` plus a short `label`
for its log lines.
`CronService.startCronScheduler()`/`startBackupScheduler()`/`startAutoscaleScheduler()`
(all called from `hooks.server.ts`'s `init()`) just call `.start()` on the
composed instance, unlike `DockerService` (see Docker integration above), these
three schedulers never call into each other, so plain composition is the fit
here, not the mixin-merge pattern. `cron/cron-expression.ts` holds the small
dependency-free 5-field cron matcher (wildcard/number/range/list/step, minute
resolution, server-local time, no external cron package, matching this app's
generally dependency-light posture) as plain exported functions
(`parseCronSchedule`/`cronMatches`/`sameMinute`), pure and stateless, so it
stays outside the class hierarchy, same "pure transform doesn't need an
instance" precedent as `docker/labels.ts`;
`CronService.parseCronSchedule`/`cronMatches` just delegate to it, and two
Settings-page validation call sites call those directly.

Cron redeploy is opt-in, per service, off by default, configured on the Settings
tab (`cronEnabled` checkbox + `cronSchedule` text field, validated with the same
parser used at redeploy time). `CronRedeployScheduler`'s tick calls
`ServiceDTO.listCronEnabled()` (unscoped by user, the only DTO method that
queries across all users, since the scheduler isn't running on behalf of a
request) and fires `DeploymentService.deployService()` for anything due,
guarding against a double-fire in the same matching minute via `cronLastRunAt`.
`BackupScheduler` mirrors this exactly (own file, same
due-check/double-fire-guard shape) but operates on
`StorageVolumeDTO`/`backupSchedule`/`backupLastRunAt` instead, see S3 backups
below.

### Autoscaling / resource-aware workload migration (`instance_settings.autoscale*`, `service.autoscaleEligible`, `AutoscaleScheduler`)

**Scoped-down "GCP Cloud Run like" load shedding, not real elastic replica
autoscaling**, see TODO.md's note on this item for why the literal ask (spin up
N replicas, load-balance across them) needs a rearchitecture this codebase
doesn't have (`service.containerId` is a single column;
`createAndStartContainer`/`findServiceContainer`/status reconciliation/the
Overview tab's lifecycle actions all assume exactly one container per service).
What's built instead composes two already-existing primitives, Remote Hosts
(above) and `SystemStatsService`, into a third: when the local host is over a
configured resource threshold, one opted-in service gets **migrated**, not
replicated, onto a designated overflow Remote Host.

Two-level opt-in, same "background automation that touches live containers
defaults to inert" posture as the cron/backup schedulers:
`instanceSettings.autoscaleEnabled` (off by default, Settings' Autoscaling
section, alongside
`autoscaleCpuThresholdPercent`/`autoscaleMemoryThresholdPercent`, both default
80, and `autoscaleOverflowRemoteHostId`, which Remote Host absorbs the load)
**and** `service.autoscaleEligible` (off by default, per service, the Compute
tab). Neither alone does anything, both must be true for a service to ever
actually move.

`AutoscaleScheduler` (`services/cron/autoscale-scheduler.ts`) is the third
`BaseScheduler` subclass, alongside cron-redeploy and backup (own `globalThis`
registry key, `this.constructor.name`, distinct from the other two the same way
the pre-refactor module had three separate guard variables). Each tick: no-op
unless `autoscaleEnabled` and an overflow host are configured; reads
`SystemStatsService.getSystemStats()`; no-op unless CPU% or memory% crosses its
threshold; picks one service from
`ServiceDTO.listAutoscaleEligibleOnLocalHost()` (unscoped by user,
`autoscaleEligible = true AND remoteHostId IS NULL AND desiredState = 'running'`,
same "the one unscoped query for this DTO" precedent as `listCronEnabled()`);
migrates only that one per tick, re-checking the threshold next time rather than
potentially moving several services for a single reading.

The migration itself (`this.migrateToOverflow()`, a private method) explicitly
stops/removes the _old_ local container before deploying the new one on the
overflow host, `deployService()`'s own "replace previous container" logic
(`findServiceContainer`) only looks on whichever daemon it's pointed at, so
pointed at the _new_ remote it would never find (and thus never clean up) a
container left behind on a _different_ host; this method resolves the local
connection and removes it explicitly first, then flips `remoteHostId` and calls
the normal `DeploymentService.deployService()`. The overflow host must be owned
by the same user as the migrating service, `RemoteHostDTO.connectionFor()`'s
existing ownership scoping makes a host configured by a different account a safe
no-op (logged) rather than a cross-account leak, at the cost of silently not
migrating in that specific setup.

**Not tested against a real second host**, composed entirely from
already-exercised primitives (the remote-host removeContainer/deployService
paths every other remote-hosted deploy already goes through, not new Docker API
shapes) rather than invented mechanics, which is meaningfully lower-risk than
that sounds, but still: no second Docker daemon was available to actually
migrate a live service across and verify. Verify the first real migration by
hand once a real Remote Host is registered.

### Web terminal (`src/lib/services/docker/terminal.ts`)

Per-service "Terminal" tab, runs `/bin/sh` in the live container (rejects the
request if the service isn't `currentStatus: "running"`). No WebSocket, this app
has no custom server to hang a `ws` upgrade off (`vite dev` in dev, a plain
built server via `bun run start` in prod), so it's chunked HTTP instead:
`POST .../terminal/open` creates the session,
`GET .../terminal/[sessionId]/stream` is one long-lived streamed response for
output (same `ReadableStream` shape as `streamLogs`),
`POST .../terminal/[sessionId]/input` sends stdin a chunk at a time,
`POST .../terminal/[sessionId]/close` ends it early (a 15-minute-idle reaper
also runs regardless, `setInterval`, HMR-safe `globalThis` guard like the other
schedulers). Every route re-checks session ownership (`userId` match)
independently, `terminal.ts` only trusts the `containerId` it's given, it
doesn't do its own auth.

**Load-bearing implementation detail**: dockerode's normal
`exec.start({hijack:true})`, the standard way to get an interactive exec's
duplex stream, hangs forever under Bun. Confirmed with a minimal repro before
writing any route code: `container.exec()` (plain request/response, creates the
exec) resolves fine, but `.start()` with hijacking (an HTTP/1.1
`Connection: Upgrade` handshake handing back a raw socket) never resolves, Bun's
`node:http` compatibility layer doesn't complete that handshake the way Node's
does. The fix in `terminal.ts` is to do the _start_ step manually: open a raw
`Bun.connect()` Unix-socket connection to the Docker daemon, write the HTTP/1.1
Upgrade request by hand, and treat the socket as the raw duplex TTY stream once
the `101 UPGRADED` header block has been read past. Verified against a real
container end-to-end (real command in, real output back) before wiring it into
routes. If a future change touches this file, re-verify this still holds, it's a
Bun-runtime quirk, not a documented/guaranteed API contract, and could change
with a Bun upgrade.

Audit trail is session-level, not per-keystroke: open/close are logged via the
standard `Logger` pattern (service/container/session/user ids), individual
commands typed into the shell are not. That's a deliberate scope cut, not an
oversight, logging raw TTY bytes verbatim would be noisy and wouldn't cleanly
map to discrete commands anyway (arrow-key history, tab-completion, etc. all
flow through the same input channel).

### S3 backups (`src/lib/services/backup.service.ts`, `s3-backup.service.ts`)

Per-volume, off by default, configured on `storage/[volumeId]`. `BackupService`
(`backup.service.ts`) is an abstract base holding the generic tar-then-upload
pipeline (validate config, decrypt the stored secret, tar the volume's `source`
directory, log/return the result); `S3BackupService extends BackupService`
(`s3-backup.service.ts`) is the only concrete implementation, a hand-rolled AWS
Signature V4 client (single-request PUT, no multipart, no SDK dependency,
verified end-to-end against a local MinIO container during development) that
works against any S3-compatible endpoint (AWS S3, MinIO, R2, B2, etc.) via
path-style addressing. `S3BackupService.backupVolume(volume)` is the callable
entry point every route/scheduler uses; it PUTs the tarball as
`<prefix/>volumeName-<timestamp>.tar.gz`. **Bind-mount volumes only**,
`kind: "volume"` (Docker-managed) is rejected, since its content isn't visible
on the host filesystem the same way; would need a short-lived helper container
to read it out (not built). `BackupScheduler`
(`services/cron/backup-scheduler.ts`) mirrors `CronRedeployScheduler` exactly
(same 60s-tick / `BaseScheduler` / `cronMatches` / last-run double-fire-guard
shape, see the scheduler section above), the two are independent classes, not
shared code, since they operate on different DTOs. No restore flow, upload-only.

### Data model (`src/lib/server/db/schema.ts`)

better-auth-owned tables (`user`, `role` is `"admin"` | `"developer"`, see Auth
below, `session`, `account`, `verification`, `apikey`, `passkey`) plus:

- `service`, image/tag, registry creds (`registryPasswordEnc`, AES-256-GCM),
  envVars (JSON), port/restart-policy/resource limits, `desiredState` (user
  intent) vs `currentStatus` (live reconciled Docker state), `containerId`,
  `projectId` (nullable FK, `onDelete: "set null"`),
  `cronEnabled`/`cronSchedule`/`cronLastRunAt` (opt-in scheduled redeploy, see
  below), `authRequired` (Traefik forwardAuth gate, see below, ships with a
  known real limitation, read that section before assuming it works end-to-end),
  `buildSource` (`"image"` | `"git"`) +
  `gitUrl`/`gitRef`/`gitBuildContext`/`gitDockerfilePath` (see Git-based builds
  below, `image`/`tag` hold the resolved local build tag when `buildSource` is
  `"git"`, not user-editable directly in that mode), `remoteHostId` (nullable FK
  to `remote_host`, `onDelete: "set null"`, see Remote hosts below),
  `customSslCertEnc`/`customSslKeyEnc` (see Custom SSL certificates below),
  `networkMode` (`"bridge"` default | `"host"`) + `portProtocol` (`"tcp"`
  default | `"udp"` | `"both"`) (see Network mode below).
- `remote_host`, a registered non-local Docker daemon: `dockerHost` (`tcp://...`
  or `ssh://...`), optional `tlsCaEnc`/`tlsCertEnc`/`tlsKeyEnc` (AES-256-GCM,
  same scheme as `registryPasswordEnc`). See Remote hosts below.
- `deployment`, history of deploy attempts: status, image digest, error message,
  timestamps, and `log` (text, default `""`), the live-appended progress log
  described above, kept after the deploy completes as an audit trail (shown as
  an expandable panel per row in the deployment history).
- `service.customDomain`, optional second hostname (unique), a second Traefik
  router sharing the primary router's backend service, see labels.ts below.
  Configured on the service's Networking tab.
- `project`, name/description/userId/`slug` (unique, DNS-safe, prefixes every
  member service's container name and public subdomain, see Docker integration
  below). Every project has a matching Docker network (see below), created
  alongside the row and removed on cascade-delete. Known gap: account deletion's
  cascade cleans up a user's services/containers but not their `project` rows,
  harmless clutter today (FK pragma is off) but should get the same explicit
  treatment eventually (see TODO.md Chores).
- `template`, image/tag/port/envVars/etc., `ownerId` nullable (null = built-in,
  seeded, immutable).
- `storage_volume`, a named local volume source: `kind` (`"bind"` | `"volume"`),
  `source` (an absolute host path for bind, or a Docker-managed volume name,
  Docker's own `Binds` syntax tells the two apart by whether it looks like a
  path). `backup*` columns
  (`backupEnabled`/`backupSchedule`/`backupEndpoint`/`backupBucket`/`backupRegion`/`backupAccessKeyId`/`backupSecretAccessKeyEnc`/`backupPrefix`/`backupLastRunAt`)
  hold its optional S3 destination, see Backups below.
- `service_volume`, join table: one mount of one `storage_volume` into one
  `service` (`containerPath`, `readOnly`). A volume becomes "shared" simply by
  being mounted into more than one service, no separate project-volume concept.
- `instance_settings.onboardingCompletedAt`, nullable timestamp, non-null once
  the onboarding wizard (see Onboarding below) has run. Not part of the
  config-override merge in `config.ts`, it's onboarding-flow state, not an
  instance config value, unlike every other column on this table (see Instance
  settings below).
- `invitation`, a pending admin-sent invite (`InvitationDTO`, not
  better-auth-owned so it's a normal DTO): `email`, `role`, `token` (unique, 32
  random bytes hex), `invitedByUserId`, `expiresAt` (7 days), `acceptedAt`
  (nullable, null means still pending). See User roles & invitations below.
- `app_log` (`AppLogDTO`), persisted warn/error-level `Logger` output: `level`,
  `scope`, `message`, `metadata` (JSON-stringified extra log args), `serviceId`
  (nullable, heuristically populated, see below). Backs the per-service Errors
  tab's "Application errors" section, a lightweight Sentry-adjacent view of
  app-level failures alongside deployment failures (see
  `services/[serviceId]/errors/` below). `Logger.warn()`/`.error()`
  (`$lib/logger.ts`) fire-and-forget a `AppLogDTO.create()` call on every
  warn/error log, dynamically imported (not a top-level import) since
  `logger.ts` isn't under `$lib/server/`, keeping server-only db code out of the
  module graph unless a warn/error call actually fires; never awaited, never
  throws, so a logging call can't fail the operation it's logging. `serviceId`
  is extracted by regex-matching this codebase's own `service=<uuid>` convention
  already present in most Docker/deploy log messages, rather than threading an
  explicit serviceId through every existing call site, a log with no match is
  still visible on a future instance-wide log view, just not attributed to one
  service's Errors tab. `AppLogDTO.create()` amortized-prunes the table back to
  the newest 5000 rows on ~2% of writes, rather than adding a third scheduler
  alongside `CronService`'s two.

**Postgres enforces the schema's `onDelete: "cascade"`/`"set null"` FK
constraints for real.** (This app ran on SQLite until the Postgres conversion
below, SQLite's `PRAGMA foreign_keys` was intentionally left off there, making
`onDelete` decorative for row data; Postgres has no equivalent global disable,
so it's now a genuine DB-level safety net, not just documentation.) Explicit
app-level cascade logic still exists and is still required,
`ProjectDTO.cascadeDelete()` and `$lib/services/user.service.ts`'s
`UserService.cleanupUserResources()` (account deletion, see User roles &
invitations below for why that had to be pulled out of `auth.ts`'s
`beforeDelete` into its own method rather than left inline), because a DB
constraint can't stop/remove a real Docker container or network; only the
row-data half of cleanup benefits from the enforcement being real now.

Migrations are incremental under `drizzle/`, Postgres dialect (`0000` is the
full-schema baseline generated at the SQLite→Postgres conversion, see below,
every table in one migration, not the original per-feature history). Mid-session
schema changes get applied directly via a one-off script using
`drizzle-orm/bun-sql/migrator`'s `migrate()` against a live Postgres connection,
without needing to restart the dev server. **Adding a NOT-NULL column to a table
that already has rows**: Postgres's `ALTER TABLE ADD COLUMN NOT NULL` requires a
`DEFAULT` (or a two-step add-nullable-then-backfill-then-set-not-null), same
shape of problem SQLite had, different exact syntax; the ORM-level `notNull()`
in `schema.ts` is what matters for new rows going forward either way
(app-enforced). **Changing the meaning of an existing nullable column**:
back-fill by hand too, don't assume a nullable/already-populated column is fine
to reinterpret without a data pass.

**SQLite → Postgres conversion, real/tested**: this app originally ran on
`bun:sqlite` (a single `database.db` file, zero setup), converted to Postgres
(via Bun's built-in `SQL` client, `drizzle-orm/bun-sql`, no `pg` npm dependency)
because a real multi-writer-safe, backup/replication-friendly DB was worth the
extra `docker compose up -d` step, and jsonb/native boolean/timestamp types are
a better fit for this schema than SQLite's affinity typing. Verified live
against a real (scratch, disposable) Postgres container, not just reasoned
about: the generated migration applies cleanly; insert/select round-trips
returned real `Date` objects and real `boolean`s (not the `0`/`1`/epoch-int
values `bun:sqlite` mode-typed columns produced); `jsonb` columns
(`instanceSettings.oauthProviders`, `template.envVars`, `service.envVars`)
round-tripped as parsed objects/arrays with no manual `JSON.parse`/`stringify`
needed on either side, same as before; `seed.ts`'s `onConflictDoNothing()` is
idempotent on Postgres the same way it was on SQLite;
`ProjectDTO.cascadeDelete()`'s child-before-parent deletion order (deployments,
then services, then the project row) was already FK-safe by inspection, so real
FK enforcement doesn't break it. **Not carried over automatically**: any data in
a pre-conversion `database.db`, this was a schema/dialect switch, not a data
migration; a fresh Postgres database starts empty (migrations +
`seedBuiltinTemplates()` on first boot, same as before).

`src/lib/server/db/seed.ts`, `seedBuiltinTemplates()`, called from
`hooks.server.ts`'s `init()` on every boot (idempotent, fixed ids like
`"builtin-redis"`, `.onConflictDoNothing()`).

### Docker integration (`src/lib/services/docker.service.ts`, `src/lib/services/docker/`)

`DockerService` (`docker.service.ts`) is a singleton instance
(`export const DockerService = new DockerServiceClass()`) of a class built from
real per-concern classes merged via the TS mixin pattern, **not** a static
barrel re-exporting loose functions (see the OOP convention note above; this
module is its reference implementation). Every route/DTO imports `DockerService`
from there and calls instance methods on it (`DockerService.pullImage(...)`),
never reaching into `services/docker/*` directly, that part of the contract is
unchanged from before the mixin refactor. Each concern file under
`services/docker/` exports a `SomethingMixin(Base)` function returning a class
that extends `Base` (ultimately `BaseDockerService`, `docker/base.ts`, holds the
shared `getDocker(remote?)`); `docker.service.ts` chains all of them and
instantiates once. A concern that calls another's method does it via real
inheritance (`this.inspectStatus(...)`), which is also why the chain has a
load-bearing order: networks before containers (`createAndStartContainer` calls
`this.connectToProjectNetwork`), containers before reconcile
(`syncServiceStatus` calls `this.inspectStatus`), see the ordering comment in
`docker.service.ts` before reordering the chain.

- `client.ts`, HMR-safe `dockerode` singleton, socket path from config; not a
  mixin itself, `BaseDockerService.getDocker` wraps its exported `getDocker()`
  function. → `DockerService.getDocker`.
- `labels.ts`, pure label-building (no Docker client, no state), stays a plain
  exported function rather than a mixin: every container gets
  `homerun.managed=true` + `homerun.service.id=<id>`, plus Traefik discovery
  labels (unless `dnsResolvable` is false, then only the two managed labels, no
  `traefik.*` at all, so it never gets a router). `listManagedContainers()` and
  any host-scanning code **must** filter on `homerun.managed=true`, this app
  must never touch a container it didn't create. When the service belongs to a
  project, the public subdomain is `<projectSlug>-<slug>.<baseDomain>`
  (`projectSlug` param, optional). When `customDomain` is set, a second router
  (`<slug>-custom`) is added pointing at the _same_
  `traefik.http.services.<slug>` backend, one loadbalancer config, two hostnames
  reaching it, not a duplicated service block.
- `networks.ts`, `DockerNetworkMixin`, per-project Docker networks.
  `projectNetworkName(projectId)` is deterministic (`homerun-project-<id>`, no
  separate id stored, stays a plain exported pure function).
  `ensureProjectNetwork`/`removeProjectNetwork` (idempotent create/remove,
  called from `ProjectDTO.create`/`cascadeDelete`) and
  `connectToProjectNetwork(containerId, projectId, alias)` attaches a container
  to its project's network under a DNS alias equal to the service's slug (the
  _internal_ alias is never project-prefixed, only the container name and public
  subdomain are, sibling services keep addressing each other by plain slug) →
  `DockerService.ensureProjectNetwork`/`removeProjectNetwork`/`connectToProjectNetwork`.
- `containers.ts`, `DockerContainerMixin` (the old `service.ts`, renamed to
  avoid reading as "the Service service" next to `dto/service-dto.ts`), the
  operational surface, merged in right after the network mixin (see the ordering
  note above):
  - `pullImage(image, tag, auth?, onProgress?)`, `onProgress` is called once per
    layer _status change_ (not per byte-tick, dockerode's raw progress events
    are far too chatty to log one-for-one), used to build the live
    deploy-progress log. → `DockerService.pullImage`.
  - `createAndStartContainer(params, onProgress?)`, container names include a
    random suffix (`homerun-[<projectSlug>-]<slug>-<hex8>`) so a redeploy never
    collides on "name already in use"; the _previous_ container for a service is
    found by its `homerun.service.id` label (`#findServiceContainer`, a private
    method), not by name, since names are no longer stable across deploys. The
    container is aliased as its slug on the shared network
    (`NetworkingConfig.EndpointsConfig`) so other services can reach it at
    `http://<slug>:<containerPort>` regardless of the randomized name; if
    `params.projectId` is set, it also joins that project's network under the
    same alias (`this.connectToProjectNetwork`, inherited from the network
    mixin). `params.volumes` (from `ServiceVolumeDTO.listForService`) becomes
    `HostConfig.Binds` (`"source:containerPath[:ro]"`, covers both bind-mounts
    and named volumes with the same syntax). Don't call this directly from a new
    route, go through `$lib/services/deploy.service.ts`'s
    `DeploymentService.deployService()` instead (see above), which wraps it with
    deployment-row bookkeeping. → `DockerService.createAndStartContainer`.
  - `start/stop/restartContainer`, `removeContainer`, `inspectStatus` →
    `ContainerStatus`, `streamLogs` (follow-mode web `ReadableStream`),
    `buildAuthConfig`, all exposed the same way, `DockerService.<name>`. Docker
    doesn't strip a container's own ANSI color codes from its stdout, every
    raw-log-line surface (the Logs tab, deploy progress panel, deployment
    history, Errors tab) renders each line through
    `$lib/components/ansi-line.svelte` (backed by `$lib/ansi.ts`'s
    `parseAnsiLine()`), which splits a line into styled `<span>`s rather than
    using `{@html}`, no injection surface even though the source is a live
    container's own output.
- `reconcile.ts`, `DockerReconcileMixin`,
  `syncServiceStatus`/`syncAllServiceStatuses`: poll-on-page-load status
  reconciliation, merged in after the container mixin so `this.inspectStatus` is
  available. There is intentionally no background worker or Docker event
  subscriber (yet, see Planned features). →
  `DockerService.syncServiceStatus`/`syncAllServiceStatuses`.
- `core-services.ts`, `DockerCoreServicesMixin`, `findTraefikContainer()`, a
  deliberate narrow exception to the managed-label-only rule: read-only (logs
  only, never lifecycle) lookup of the Traefik container by image-name prefix,
  backing the System Logs page. →
  `DockerService.findTraefikContainer`/`restartTraefikContainer`/`updateTraefikContainer`.

`src/lib/services/secrets.ts` (not under `docker/`, it's a generic AES-256-GCM
utility, not Docker-specific, also used by SMTP/OAuth/S3-backup secrets),
`encryptSecret`/`decryptSecret` for `registryPasswordEnc` and every other `*Enc`
column, key derived via `scryptSync` from `config.auth.secret`.

Containers attach to the external `homerun` Docker network
(`docker network create homerun` once) rather than publishing host ports, true
for the default `networkMode: "bridge"`; see Network mode below for the `"host"`
exception. The root `compose.yaml` bootstraps Traefik and Postgres for **local
dev** only: it deliberately has no `app` service, since dev runs the app
directly on the host (`bun run dev`/`bun run start`) so its own logs aren't
viewable in-app (see `system-logs/` above). The app itself _is_ containerized
for production use (`Dockerfile`, built/pushed by
`.github/workflows/docker.yaml`; see Release automation below): the installer's
`--mode=full` generates its own separate compose file that adds that image as an
`app` service (see `installer/` below), rather than this dev compose file
gaining one.

### Network mode (`service.networkMode`, `service.portProtocol`, Networking tab)

Per-service, `"bridge"` (default) or `"host"`, configured in the Networking
tab's **Network** section, alongside `containerPort` and `portProtocol` (`"tcp"`
default | `"udp"` | `"both"`, which protocol(s) `ExposedPorts` declares the
container's port under). `"host"` shares the host's network namespace directly
(`HostConfig.NetworkMode: "host"` in `docker/containers.ts`), for apps that
specifically need real host-network access (mDNS/SSDP discovery, e.g. Home
Assistant), which bridge networking can't provide.

Host mode forces `dnsResolvable` off (both in the stored row, at save time, and
again defensively at deploy time in `createAndStartContainer`), there's no
container-specific IP/network for Traefik's docker provider to route to in host
mode, only the host's own interfaces, so Traefik labels are skipped entirely
regardless of what's stored. No project-network join either (Docker containers
in host mode can't also join a user-defined network). A host-mode service is
reachable only directly on the host's own `containerPort`, exactly as if you'd
run it with `docker run --network host` yourself, this app doesn't publish or
map anything either way, matching the existing "no host port publishing by
design" stance for bridge mode too.

**Real, tested finding**: `HostConfig.NetworkMode: "host"` combined with a
`NetworkingConfig.EndpointsConfig` (the shared-network attach bridge mode uses)
does **not** fail at the Docker API level the way you might expect, verified
live against a real scratch container, Docker silently accepted both and the
container ended up attached to the named network instead of `"host"`
(`NetworkSettings.Networks` showed the bridge network, not `host`).
`createAndStartContainer` explicitly omits `NetworkingConfig` entirely when
`networkMode === "host"` specifically because of this, sending both is not a
hard error you'd catch in testing, it's a silent wrong-mode footgun. Also
verified live: with `NetworkingConfig` correctly omitted, the container comes up
with `NetworkSettings.Networks: { host: {...} }` and no IP address, as expected
for real host networking.

### System stats (`src/lib/services/system-stats.service.ts`)

`SystemStatsService.getSystemStats()`, host-level (not per-container)
CPU/RAM/disk via Node's `os` module + a shelled-out `df -Pk .`, plus a
best-effort GPU read via `nvidia-smi` (returns `gpu: null` when absent, the
common case, not an error; no other vendor supported). CPU% needs a delta
between two samples (`os.cpus()` gives cumulative counters since boot), so a
module-scope `lastCpuSample` is diffed on each call, first call after boot
always reads 0%. Polled by the dashboard's `/system-stats` endpoint every 5s.

### Setup diagnostics (`src/lib/services/admin.service.ts`)

`AdminService.runSetupChecks()`, read-only diagnostics (base domain/auth
secret/origin still at their defaults, Traefik container reachable, Docker
socket reachable, SMTP fully configured if enabled), each with a severity and
the env var that fixes it. Reads `config`, which already reflects any DB-backed
instance settings merged over the env defaults (see Config and Instance settings
below), these checks just report the effective value, they don't care which
layer it came from. There's still no DNS-provider (Cloudflare/Pangolin)
automation.

There's no standalone `/setup` page anymore (removed, it duplicated what
`/settings` already does live). `AdminService.runSetupChecks()` now only backs
the dashboard's setup-issue banner, which deep-links straight into `/settings`
with the offending field(s) highlighted: `AdminService.SETUP_CHECK_FIELDS` (same
file) maps a check's id to the `/settings` field id(s) it corresponds to;
`(protected)/+page.server.ts` builds a `highlightFields` list from the current
issues and appends it as `?highlight=a,b,c`; `/settings` reads that param, rings
the matching fields amber, and scrolls the first one into view on mount. Two
checks (`auth-secret`, env-only; `traefik`, a live-container check) deliberately
have no entry in the map, nothing to highlight for either.

### Config (`src/lib/config.ts`)

Zod-validated env config. Notable groups: `docker.{socketPath,networkName}`,
`baseDomain`, `traefik.{entrypoint,certResolver}`, `auth.{origin,secret}`,
`smtp.*`.

`config.auth.secret` reads `AUTH_SECRET` **falling back to
`BETTER_AUTH_SECRET`**, don't collapse this to one var without checking both are
honored.

`config` is a single stable object every other module imports and reads
properties off live, the env-parsed values are captured once into a private
`envDefaults`, then `config` starts as a clone of that and is **mutated in
place** (never reassigned) by `applyInstanceSettings(override)`. See Instance
settings below for who calls that and when.

### Instance settings (DB-backed) (`instance_settings` table, `InstanceSettingsDTO`, `/settings`)

Most of `config`, OAuth providers, Docker socket/network defaults, Traefik
entrypoint/cert-resolver/dynamic-config-dir, SMTP, and core settings (base
domain, origin, the auth-check URL, cross-subdomain cookies), is now
live-editable from a `/settings` page, not just env vars. `instance_settings` is
a **singleton row** (`InstanceSettingsDTO`, id always `"default"`, auto-created
on first read): every column is nullable, `null` meaning "fall back to the env
default", a non-null value overriding it. Secrets (`smtpPasswordEnc`, each OAuth
provider's `clientSecretEnc` inside the `oauthProviders` JSON array) use the
same AES-256-GCM scheme as `service.registryPasswordEnc`
(`$lib/services/secrets.ts`, reused as-is).

**Not DB-backed**, `databaseUrl`/`port`/`auth.secret`/`logLevel`/`logFormat`
stay env-only: `databaseUrl` has to be known before the DB is even reachable,
and `auth.secret` is the key every `*Enc` column's encryption derives from, so
DB-backing it would be circular.

`InstanceSettingsDTO.toConfigOverride()` decrypts every stored secret and
returns the plain-value shape `applyInstanceSettings()` merges over
`envDefaults`. This runs twice: once in `hooks.server.ts`'s `init()` at boot
(before the server accepts any request, so DB-backed settings are in effect from
the very first request, not just after a save), and again at the end of every
`/settings` action, so a saved change is live immediately, no restart, for every
section including OAuth (see Auth below for how that one specifically applies
live).

`config.ts` deliberately never imports the DTO or `db` itself, `db/lib.ts`
imports `config.ts` for `databaseUrl`, so `config.ts` has to stay a leaf module
or the two would form a circular import. The DB-reading glue lives in
`hooks.server.ts` and `settings/+page.server.ts` instead.

**Real, tested finding from building this**: a bad OAuth provider
(unreachable/invalid discovery URL) isn't just a broken login button,
better-auth's `genericOAuth` plugin validates every configured provider's
discovery document while building its auth _context_, which every request
touching auth goes through, including plain `getSession()` on every page load
and even email/password sign-in. Saving one unvalidated **locked the whole app
out**, `/settings` included, with no way back in short of editing the DB
directly, verified live. Fixed two ways: `settings/+page.server.ts`'s
`updateOauth` action fetches and validates each provider's discovery document
(must return 200 with a JSON body containing an `issuer`) _before_ persisting
anything, rejecting the save with a clear error otherwise, deliberately **not**
the "warn, don't block" precedent the image-existence checker uses, since the
failure mode here is total lockout rather than one broken service. And as
defense in depth against any other cause, `hooks.server.ts`'s `authHandler`
wraps `auth.api.getSession()` in a `catch` that degrades to "no session" on any
error rather than letting it 500 every request, so even if auth context
construction fails for some other reason, the rest of the app (and `/settings`,
to fix whatever's wrong) stays reachable, just signed out.

### Auth (`src/lib/services/auth.ts`)

better-auth at `basePath: "/api/v1/auth"`, `drizzleAdapter` over the same
Postgres `db`. `src/hooks.server.ts` populates `event.locals.user`/`session`
from the cookie session, falling back to manual
`x-api-key`/`Authorization: Bearer` verification when no cookie is present:
`auth.api.verifyApiKey()` confirms the key, then the owning user is looked up
**directly by `result.key.referenceId`** via a plain drizzle query, deliberately
_not_ through `getSession()`'s API-key session-mocking, which is gated behind
the `apiKey()` plugin's `enableSessionForAPIKeys` option (default `false`, and
better-auth's own docs advise against enabling it in production). This is what
makes `x-api-key`/`Bearer` auth work for `src/routes/api/v1/*` (see REST API
above).

`user.deleteUser` is enabled with a `beforeDelete` hook (thin wrapper around
`$lib/services/user.service.ts`'s `UserService.cleanupUserResources()`, see User
roles & invitations below), don't assume better-auth's default account-deletion
behavior is sufficient; it isn't, by design of this app's extra tables (see Data
model above).

`config.auth.crossSubdomainCookies` (env `AUTH_CROSS_SUBDOMAIN`, default off,
also DB-editable, see Instance settings above) sets better-auth's
`advanced.crossSubDomainCookies` to scope the session cookie to `.{baseDomain}`
instead of the exact host, see the per-service auth gate below for why, and its
documented, tested limitation.

The `betterAuth({...})` call is wrapped in `buildAuth()` rather than assigned
once to a `const`, `export let auth = buildAuth()`, plus
`export function rebuildAuth()` which reassigns `auth = buildAuth()`. This is
what makes OAuth provider changes saved on `/settings` apply live: every
consumer (`hooks.server.ts`'s
`auth.api.getSession`/`svelteKitHandler({ auth, ... })`) reads `auth.*`
per-request rather than destructuring it at import time, so ES module
live-bindings mean a reassignment inside `auth.ts` is immediately visible
everywhere without a restart. `rebuildAuth()` is called at the end of
`hooks.server.ts`'s `init()` and every `/settings` action.

### Per-service auth gating (`service.authRequired`, `/api/v1/auth-check`)

When enabled (Networking tab), `services/docker/labels.ts` attaches a Traefik
forwardAuth middleware to the service's router(s) pointing at
`config.authCheckUrl` (default
`http://host.docker.internal:<port>/api/v1/auth-check`, since this app isn't
containerized, Traefik must reach it from inside its own container; the Linux
case needs `extra_hosts: host-gateway` added to compose.yaml's Traefik service,
which this app can't do for the user). `/api/v1/auth-check` just checks
`locals.user` and returns 200/401, so it works with whatever the user
authenticates into Homerun with, including a configured `genericOAuth`/OIDC
provider (see auth.ts).

**Real, tested limitation, not a hypothetical**: there's no login page mounted
on a gated service's own subdomain, so this blocks _everyone_, including a
signed-in admin, unless `AUTH_CROSS_SUBDOMAIN=true`. Even with it enabled,
during development a signed-in admin visiting the gated subdomain directly still
got a 401 (verified: the cookie's `Domain` attribute did widen correctly, but
better-auth's `getSession()` still appears to reject it based on request Host,
not root-caused, better-auth's internals weren't dug into further). The
Networking tab's copy says this plainly (bordering on a warning) rather than
promising working SSO. Treat `authRequired` today as a hard "make this
unreachable from outside" switch, not a finished login-gated-app feature, a real
fix needs a login-redirect flow for gated subdomains.

### User roles & admin-managed accounts (`user.role`, `/users`, `invitation` table)

This moved from "anyone can `/auth/sign-up`" to a real single-instance model.
Roles are `"admin"` and `"developer"`, developer is a label plus route-gating
only, not a permissions system: both roles get the full dashboard over their own
data (already isolated per-user by every DTO's `userId` scoping), the only
difference is two admin-only pages, `/users` and `/settings` (`locals.isAdmin`,
see below, checked at the top of each `load`, plus the nav items are filtered
out of `(protected)/+layout.svelte`'s sidebar for non-admins).

- **The very first account becomes admin automatically**, whoever creates it.
  `hooks.server.ts`'s `authHandler` hard-blocks
  `POST /api/v1/auth/sign-up/email` (better-auth's real email/password sign-up
  endpoint) with a 403 once `AdminService.hasAnyUser()`
  (`$lib/services/admin.service.ts`, a raw query, no DTO exists for
  better-auth-owned tables) is true, the endpoint itself is blocked, not just
  the UI, so it can't be curled around. `/auth/sign-up` and `/auth/sign-in`'s
  own `load`s cross-redirect based on the same check (blank instance → sign-up;
  account exists → sign-in), so navigating to either one always lands somewhere
  sensible. Every account after the first is created by an admin from `/users`,
  direct-create (name/email/temp password/role, works with no SMTP, via
  `auth.api.createUser`) or email invite (`InvitationDTO` +
  `/auth/accept-invite/[token]`, gated behind `isSmtpEnabled()`).
- **Real, tested-in-review finding**: making the bootstrap-admin hook
  conditional on `!user.role` doesn't work. `auth.ts`'s
  `databaseHooks.user.create.before` is where the promotion happens, but the
  `admin()` plugin registers its _own_ `databaseHooks.user.create.before` (via
  its `init()`) that sets `role` to `options.defaultRole`, and depending on
  plugin/app hook-merge order, that can run _before_ the app-level one, so
  `user.role` is already truthy by the time this hook sees it. Verified live:
  with a `!user.role` guard, the bootstrap account came out `"developer"`, not
  `"admin"`. Fixed by checking `AdminService.hasAnyUser()` directly instead of
  `user.role`'s presence, both hooks run pre-insert, so it's still reliably
  false only before the very first user exists, regardless of ordering.
  `admin({ defaultRole: "developer" })` stays as the sane fallback for any
  creation path that doesn't pass an explicit role (shouldn't normally happen,
  direct-create and invite-accept both always pass one).
- **Real, tested-in-review finding**: `auth.api.removeUser` (the admin plugin's
  user-deletion endpoint) calls `internalAdapter.deleteUser()` directly, which
  does **not** run this app's `user.deleteUser.beforeDelete` option, that option
  is read and invoked only by better-auth's own self-service delete-account
  endpoints (`node_modules/better-auth/dist/api/routes/update-user.mjs` is the
  only place `beforeDelete`/`afterDelete` are referenced at all), not by
  `internalAdapter.deleteUser` generically. Calling `auth.api.removeUser`
  naively from an admin "remove user" action would leak that user's Docker
  containers/networks. Fixed by extracting the cleanup body out of `auth.ts`'s
  `beforeDelete` into `$lib/services/user.service.ts`'s
  `UserService.cleanupUserResources(userId)`, called explicitly by both the
  self-service `beforeDelete` hook _and_ `/users`' `removeUser` action before it
  calls `auth.api.removeUser`. By contrast `databaseHooks.user.create.before`
  (used for the role-promotion above) genuinely _is_ generic,
  `internalAdapter.createUser` goes through the same `createWithHooks` machinery
  regardless of caller, confirmed in
  `node_modules/better-auth/dist/db/internal-adapter.mjs`, so that one hook
  firing uniformly for self-service sign-up, `admin.createUser`, and
  invite-accept was safe to rely on.
- `/users`' `removeUser`/`setRole` actions also refuse to strip the last
  remaining admin (`wouldRemoveLastAdmin()`, checked via
  `$lib/services/user.service.ts`'s `UserService.countAdmins()`) and refuse
  self-removal (mirroring better-auth's own guard on `admin.removeUser`, checked
  client-side too before it gets there).
- `/auth/accept-invite/[token]/+page.server.ts`'s `accept` action calls
  `auth.api.createUser` **without** a `headers` option, confirmed from
  `node_modules/better-auth/dist/plugins/admin/routes.mjs`: omitting
  `headers`/request context is treated as a trusted server-side call and skips
  the admin-role permission check entirely, which is correct here since the
  invite token itself (validated, single-use, expiring via
  `InvitationDTO.getByToken`) is the authorization, not an admin session.
  `/users`' own actions, by contrast, always pass `headers: request.headers` so
  better-auth's own permission check double-enforces admin-only on top of the
  route's own `locals.isAdmin` guard.
- `App.Locals.isAdmin` (declared in `app.d.ts`, was dead/aspirational like
  `logger`, see Logging below, until this feature) is now populated in
  `hooks.server.ts`'s `authHandler` right after `locals.user` is set
  (`locals.user?.role === "admin"`), for both the cookie-session and API-key
  paths. Every admin-only route checks `locals.isAdmin`, not
  `locals.user?.role === "admin"` inline.

### Onboarding (`instance_settings.onboardingCompletedAt`, `/onboarding`, `Stepper` component)

A signed-in user whose instance hasn't finished onboarding is forced to
`/onboarding` and can't reach anything else; `/onboarding` itself is unreachable
once it's done. Both directions are gated from the single
`(protected)/+layout.server.ts` `load` (same function that redirects signed-out
visitors to sign-in/sign-up, see Routing above), right after the `locals.user`
check. Onboarding is a property of the singleton `instance_settings` row (see
Instance settings above), not per-user, so once the bootstrap admin finishes it,
later developer accounts never see the wizard, that falls out naturally from the
flag living on the instance, not the account. Edge case: an admin _could_ create
another account before finishing onboarding themselves,
`/onboarding/+page.server.ts`'s own `load` checks `locals.isAdmin` and shows a
non-admin a "an admin needs to finish setting up this instance" holding message
instead of the real wizard rather than handing them instance-wide config
controls.

**Real, tested-in-review finding**: the two-directional check originally
compared `url.pathname === resolve("/onboarding")` (`resolve` from `$app/paths`)
and always evaluated false, this app's `resolve()` returns a _relative_ path
(`"./onboarding"`), not an absolute one, matching every
`redirect(302, resolve(...))` call in this codebase actually sending a relative
`Location` header (that's fine for a redirect the browser follows, but useless
for an equality check against `url.pathname`, which is always absolute).
Verified live: caused an infinite redirect loop landing back on `/onboarding`
itself. Fixed by comparing `route.id` (from the `load` event) against the
route's canonical id instead, `"/(protected)/onboarding"`, confirmed live, which
doesn't have this problem since it's the router's own absolute identifier, not a
derived URL string. If a future gate needs a "is this the current route" check,
use `route.id`, not a `resolve()` comparison.

`/onboarding/+page.svelte` is a 5-step wizard (Core / Docker / Traefik / Email /
Review) built on the new reusable `$lib/components/stepper.svelte`, extracted
from `services/new`'s inlined step-indicator-bar-plus-Back/Next pattern (not
retrofitted onto `services/new` itself, a deliberate scope cut). `Stepper` owns
navigation and which step is unlocked (`reachableStep`, grows only after a
passed `onNext`); the consuming page owns field markup and validation, same
"shared chrome, not shared shape" split as `form-styles.ts`. No phantom errors:
a field's error paragraph only renders once that field's step has actually
failed an attempted `Next`/submit (tracked in the page's own
`attempted: Set<number>` state, not the component's), nothing shows on initial
render. The finish action reuses the exact
`InstanceSettingsDTO.updateCore/updateDocker/updateTraefik/updateSmtp` methods
`/settings` already calls, then `markOnboardingComplete()`, then the same
`applyInstanceSettings()` + `rebuildAuth()` post-save dance `/settings`'s
actions already do.

### Logging

Every module that mutates state (`page.server.ts` actions, the Docker layer,
cascade-delete helpers) instantiates `new Logger("Domain")` from
`src/lib/logger.ts` at module scope and calls `.info()`/`.warn()`/`.error()` on
start/success/failure of each operation, with entity + user ids for correlation.
`App.Locals.logger` is declared in `app.d.ts` but never populated, that's
dead/aspirational, don't use it; the per-module `Logger` instance is the real
pattern.

### Homerun Agent + installer (`agent/`, `installer/`), draft, not yet wired into the main app

Two standalone Bun/TypeScript sub-projects at the repo root, siblings of `src/`,
each its own `package.json`/`tsconfig.json`/`node_modules` and **not** part of
the SvelteKit build, both compile to a native binary via `bun build --compile`.
Neither is referenced by any code under `src/` yet; this is groundwork, not an
integrated feature. See each folder's own README for the full detail; this
section is the pointer.

- **`agent/`**, the **Homerun Agent**: a small token-authenticated HTTP server
  (`GET /v1/health` and `GET /v1/openapi.json` unauthenticated, the latter for
  the same "spec describes shapes, not data" reason the main app's is public;
  every other route needs `Authorization: Bearer <token>`) meant to run on a
  _remote_ host's own Docker daemon, exposing
  deploy/start/stop/restart/logs/stats over plain HTTP. This is the alternative
  to registering a Remote Host by raw `tcp://`/`ssh://` Docker socket (see
  Remote hosts above), instead of exposing the daemon itself, the remote host
  runs this agent and the main app only ever talks HTTP-plus-bearer-token to it.
  It's the primitive the Autoscaling section below's "Homerun Agents"
  control-plane rearchitecture note pointed at as future work; this session
  built the standalone primitive only, not the main-app integration (no
  `remote_host.kind`/`agentUrl` schema column, no `AgentClientService`, no
  Remote Hosts UI, no `DeploymentService` branch to route through it yet).
  `POST /v1/deploy` mirrors the main app's own
  pull→remove-previous-by-label→create→start shape (`findServiceContainer` by
  `homerun.service.id` label, a fresh randomized container name every deploy,
  same conventions as `docker/containers.ts`) but is a from-scratch,
  self-contained implementation, the agent has no access to the main app's
  source tree at runtime, so `agent/src/docker.ts` and `agent/src/stats.ts`
  intentionally re-implement (not import) the equivalent logic from
  `docker/containers.ts` and `SystemStatsService`; keep the two in sync by hand
  if one changes. `agent/src/schemas.ts` holds a zod schema for the deploy body
  (`agent/src/openapi.ts` generates the agent's own OpenAPI 3.1 doc from it,
  same "one schema, two purposes" approach as the main app's, see OpenAPI
  above), **this replaced a real bug**: `/v1/deploy` previously did
  `(await req.json()) as DeployInput`, an unchecked cast with zero runtime
  validation, so a malformed request would fail deep inside dockerode with a
  confusing error instead of a clean 400; now it's
  `deployInputSchema.safeParse()` first. **Live-verified** against a real local
  Docker socket: boot + `homerun`-equivalent creation, every HTTP endpoint
  including a real `nginx:alpine`
  pull→create→start→redeploy-replaces-old→stop/remove round trip, auth rejection
  on a missing/wrong token, the new validation actually rejecting a malformed
  deploy body with a 400, `/v1/openapi.json` being a real parseable OpenAPI 3.1
  doc, and the compiled binary behaving identically to `bun run dev`.
- **`installer/`**, a single-binary installer (`installer/index.ts`) meant to be
  the target of a `curl | bash` one-liner (`installer/bootstrap.sh`) on a fresh
  Linux server: installs Docker Engine + rootless prerequisites
  (`uidmap`/`dbus-user-session`), creates a dedicated non-root system user,
  installs **rootless** Docker for that user via Docker's own documented flow
  (`get.docker.com/rootless` → `dockerd-rootless-setuptool.sh`,
  `loginctl enable-linger` + a `systemd --user` unit so the daemon survives a
  headless reboot without an active login session), creates the `homerun` on
  that rootless daemon, then installs either just the Agent (`--mode=agent`,
  default, own `systemd --user` unit) or the full stack (`--mode=full`), all
  under that same rootless account, never as root. **Binaries and Docker images
  only, nothing built from source on the target host** (superseding an earlier
  draft that cloned the repo and ran `bun run build` there): `bootstrap.sh`
  downloads the `homerun-installer-<arch>` release binary itself and `exec`s it
  (no Bun, no git); `--mode=agent` downloads the matching `homerun-agent-<arch>`
  release binary straight to `/usr/local/bin/homerun-agent`; `--mode=full`
  writes a standalone `compose.yaml` (`installer/steps/full-stack.ts`, distinct
  from the root dev `compose.yaml`; see Docker integration above) pulling the
  published `git.ombrage.space/orochibraru/homerun` app image alongside
  Traefik/Postgres, then `docker compose pull && ...up -d`.
  `installer/steps/release.ts` is the one place both artifact kinds (release
  binaries vs. the Docker image) resolve from: `--version=` (a Gitea release
  tag, default `latest`) picks which release's binaries to fetch, but doesn't
  pin the app image the same way: `docker.yaml` tags images by commit SHA +
  `latest` only, there's no `:vX.Y.Z` image tag, a real asymmetry in this repo's
  release pipeline documented in that file rather than papered over. Every
  shell-out goes through one `StepRunner` (`installer/exec.ts`) so `--dry-run`
  (print every command instead of running it) is a single interception point,
  not scattered per-step conditionals. **Verified**: the full command sequence
  via `--dry-run` for both modes (including on a non-Linux dev machine, via a
  dry-run-only package-manager-detection fallback, and including the generated
  `compose.yaml` content), and that the compiled binary's dry-run output matches
  running from source. **Not verified, flagged the same way this codebase flags
  an untested OAuth flow**: none of the real, mutating steps (package install,
  `useradd`, rootless Docker setup, systemd units, or the downloaded
  binaries/images actually starting) have run against an actual fresh Linux box
  in this session, doing so needs a disposable VM/CI runner this environment
  doesn't have, and running the mutating path against a real machine without one
  would be irreversible and wasn't attempted. Run it by hand against a real
  disposable server before trusting the one-liner on anything that matters.

## Planned features (not yet built)

Intentional gaps, noted so a future session has the intended shape rather than
re-litigating design decisions.

- **Health-gated rollout**: opt-in health check (path + expected status/timeout)
  gating whether a newly-deployed container receives traffic, blue-green style,
  keep the old container alive/routable until the new one passes, roll back
  (never route to it) if it doesn't.
- **CLI**: the REST API (`src/routes/api/v1/`) and the DTO layer underneath it
  are the groundwork, a CLI client itself doesn't exist yet.
- **Storage**: S3 backup covers bind-mount volumes only (see below), no
  named-volume backup, no restore flow.
- **Observability**: system stats beyond the dashboard's host-level
  CPU/RAM/GPU/disk, no per-container `docker stats` view yet.
- **Security**: per-service auth gating exists (`authRequired`, see below) but
  doesn't have a working login-redirect flow yet, see its own section for the
  real, tested limitation. Custom SSL cert handling exists too (see below) but
  genuinely requires the admin's own one-time Traefik config change to take
  effect.
- **Source integration**: git-based builds exist (see below), no private-repo
  credential field, no webhook/auto-deploy-on-push. Remote hosts exist too (see
  below), no host port publishing for remote-hosted services, no
  shared-network/Traefik integration for them, bind-mount volumes are skipped on
  remote deploys.
- **Onboarding**: the forced first-run wizard now exists (`/onboarding`, see
  above), and setup diagnostics feed a highlighted deep-link into `/settings`
  instead of a standalone page, the larger version (DNS-provider API automation
  for TLS/DNS ops, e.g. Cloudflare/Pangolin) still isn't built.
- **User roles**: admin/developer roles, admin-managed direct-create and email
  invites exist (see User roles & admin-managed accounts above), "developer" is
  a label plus route-gating only, no finer-grained permissions (e.g. no
  per-project access control, no read-only role) built yet.
- **Notifications / webhooks**: in-app lifecycle event feed; outbound webhooks
  (Telegram/Discord/generic HTTP) on deploy success/failure.

`TODO.md` at the repo root tracks open follow-up items separately from this
intentional-gaps list.
