# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Homerun — a self-hosted, single-user PaaS for deploying Docker containers with a click-config form (a minimal Dokploy/Cloud-Run alternative). Point at an image, fill in env vars/port/resources, deploy — Traefik auto-routes it to `<slug>.<baseDomain>` with TLS. Single host, local Docker socket only; no multi-node orchestration, no git/Dockerfile build pipeline (bring-your-own-image only).

Stack: SvelteKit 2 (Svelte 5 runes) + Bun runtime, better-auth, Drizzle ORM over `bun:sqlite`, Tailwind v4 + shadcn-svelte ("vega" style), dockerode.

## Commands

```
bun run dev              # vite dev
bun run build            # vite build
bun run start             # bun run ./build/index.js (serve the built app)
bun run check            # svelte-kit sync && svelte-check — currently BROKEN, see note below
bun run lint             # biome check . && rustywind --check-formatted .
bun run lint:fix         # biome check . --write && rustywind --write .
bun run db:generate      # drizzle-kit generate — regenerate migrations from src/lib/server/db/schema.ts
bun run component:add    # shadcn-svelte add <name> — installs a UI primitive into src/lib/components/ui/
docker compose up -d     # bootstraps Traefik (see compose.yaml) — required for subdomain routing to deployed services
```

No test framework is set up in this repo.

**`bun run check` is currently broken**, unrelated to app code: `typescript` is pinned to `^7.0.2`, and `svelte-check`'s `--tsgo` mode requires a _second_, aliased TypeScript 6 install alongside it. Until that's set up, verify changes by booting `bun run dev` and exercising routes directly (real signups, real deploys, throwaway accounts — never the maintainer's own account) rather than trusting a clean `check` run.

Biome formats with tabs + double quotes; svelte/vue/astro files have `useConst`/`useImportType`/unused-import rules turned off (Svelte 5 `$state`/`$props` destructuring trips them). Note: the IDE's inline diagnostics have proven frequently stale/phantom in this repo (showing parse errors that don't reflect the real file) — `bunx biome check <file>` is ground truth, always verify against it before trusting an IDE-reported error.

## Conventions (strict — apply to every change)

- **Never manually type anything in a route file** — `+page.svelte`, `+layout.svelte`, `+page.server.ts`, `+layout.server.ts`, `+server.ts`. This covers `$props()` (`data`/`form`/`children`/`params`) in the `.svelte` files _and_ `load`/`actions`/`GET`/`POST` in `.server.ts`/`+server.ts` files. All of it is inferred by SvelteKit's tooling from the route's generated `./$types`, based on file location — that's the framework working as designed, don't fight it. Concretely:
  - `.svelte`: `const { data } = $props();` — never `: { data: PageData }`, never `: PageProps`. No `PageData`/`LayoutData`/`ActionData`/`PageProps`/`LayoutProps` type name appears in a route component at all.
  - `.server.ts` / `+server.ts`: `export const load = async ({ locals, parent }) => {...}` — never `: PageServerLoad`/`: LayoutServerLoad`. `export const actions = {...}` — never `: Actions`. `export const GET = async ({ params, locals }) => {...}` — never `: RequestHandler`. No `import type {...} from "./$types"` for any of these at all.
  - This rule is specific to route files. Non-route components (`$lib/components/**`) and shared server modules (`$lib/server/**`, `$lib/dto/**`) are normal TypeScript/Svelte code and should still be typed explicitly as usual — there's no route-based inference for those.
- **Nested `load` functions under `(protected)/` must not re-check `!locals.user`.** The parent `+layout.server.ts` already redirects unauthenticated users before any child `load` runs, so re-checking is dead code. Use `const { user } = await parent();` instead. **This does not apply to `actions`** — form action submissions don't go through the parent layout's `load` at all, so every action keeps its own explicit `if (!locals.user) throw redirect(...)` guard.
- **No raw Drizzle queries in route files.** Every table has a corresponding DTO class in `src/lib/dto/` (see below) — routes call DTO methods, never `db.select()/.insert()/.update()/.delete()` directly.
- No unused variables or imports. No lint errors — `bun run lint` must be clean before considering a change done.
- No type errors left after any change — verified by careful reading plus runtime testing until `bun run check` is fixed.

## Architecture

### The DTO layer (`src/lib/dto/`)

Every table is wrapped by a DTO class extending `BaseDTO<TRow>` (`base-dto.ts`): a thin instance around one DB row that owns its own queries. Route files call `ServiceDTO.get(id, userId)`, `svc.update({...})`, `svc.delete()` etc. instead of writing Drizzle inline — this is what "no raw SQL in page.server.ts" means in practice, and it's also the layer a future REST/CLI API would sit on top of (not yet built).

- `service-dto.ts` — `ServiceDTO`: `get`/`list`/`listByProject`/`listWithProjectNames` (joins in `project.name` for the grouped services list)/`slugTaken`/`create`/`update`/`delete`.
- `project-dto.ts` — `ProjectDTO`: `get`/`list`/`listWithServiceCounts`/`create`/`update`/`delete` (row-only) /`cascadeDelete()` (stops+removes every member container, deletes deployments/services, deletes the project row, then removes the project's Docker network — the real "delete a project" operation, see `projects/[projectId]/+page.server.ts`'s `delete` action).
- `template-dto.ts` — `TemplateDTO`: `usable(id, userId)` (built-in OR owned — for deploy-from-template), `owned(id, userId)` (owned only), `listForUser`, `create`. Built-ins have `ownerId: null` and are seeded on boot (see below).
- `deployment-dto.ts` — `DeploymentDTO`: `get`/`listForService`/`listRecentForUser` (joins in service name/slug, for the dashboard)/`create`/`update`/`appendLog(line)` (appends to the live progress log, see below).
- `storage-volume-dto.ts` — `StorageVolumeDTO`: `get`/`list`/`create`/`delete`, for the `/storage` page's volume sources.
- `service-volume-dto.ts` — `ServiceVolumeDTO`: `listForService` (joined with the volume's name/kind/source), `attach`/`detach` — the mounts of a StorageVolume into a service, shown on the service's Volumes tab.

**`toJSON()` before returning from `load`**: DTO instances are server-only; SvelteKit serializes `load` return values with devalue, which can't serialize a class instance. Every `load` maps DTOs to plain objects via `.toJSON()` (or `.map(d => d.toJSON())`) before returning.

### Routing: dashboard-only, no public pages

`src/routes/(protected)/` is a route group living at `/` itself (not `/dashboard`) — its `+layout.server.ts` is the single auth guard, redirecting to `/auth/sign-in` when signed out. There is no public marketing page. `src/routes/auth/**` is the only unauthenticated surface.

Top-level sections (sidebar nav): **Overview** (dashboard stats + recent deployments), **Services**, **Projects**, **Templates**, **Storage**.

`src/routes/(protected)/services/`:

- `+page.svelte` — list, grouped by project (with an "Ungrouped" bucket when more than one group exists), inline start/stop/restart/delete actions
- `new/+page.svelte` — click-config create form; accepts `?projectId=` and/or `?templateId=` query params to pre-fill from a project or template context (does **not** deploy — just persists config)
- `[serviceId]/+layout.server.ts` — ownership guard (id **and** userId must match, else 404) + syncs live Docker status on every visit. Tabs: **Overview** (deploy/start/stop/restart, live deploy progress panel, deployment history with expandable per-deployment logs), **Logs** (live-streamed via a `+server.ts` GET returning a chunked `ReadableStream`), **Env Vars**, **Volumes** (mount/unmount StorageVolumes), **Settings** (edit config, move between projects, save-as-template, danger-zone delete)
- `[serviceId]/deployments/[deploymentId]/progress/+server.ts` — polled by the Overview tab while a deploy is in flight; returns `{log, status}` JSON. The client pre-generates the deployment id itself (`crypto.randomUUID()`, set on the form via `formData.set("deploymentId", ...)` in `use:enhance`'s pre-submit callback) so it can start polling _before_ the deploy request even resolves. Polling is status-driven (stops once the deployment reaches a terminal status), which is also what makes resuming the progress view after a mid-deploy page reload work — `onMount` checks `svc.currentStatus` and resumes polling the latest deployment if it's still in-flight.

`src/routes/(protected)/projects/`, `templates/`, `storage/` mirror this pattern (list + `new/` create route + `[id]` detail where applicable).

### Data model (`src/lib/server/db/schema.ts`)

better-auth-owned tables (`user`, `session`, `account`, `verification`, `apikey`, `passkey`) plus:

- `service` — image/tag, registry creds (`registryPasswordEnc`, AES-256-GCM), envVars (JSON), port/restart-policy/resource limits, `desiredState` (user intent) vs `currentStatus` (live reconciled Docker state), `containerId`, `projectId` (nullable FK, `onDelete: "set null"`).
- `deployment` — history of deploy attempts: status, image digest, error message, timestamps, and `log` (text, default `""`) — the live-appended progress log described above, kept after the deploy completes as an audit trail (shown as an expandable panel per row in the deployment history).
- `project` — name/description/userId. Every project has a matching Docker network (see below), created alongside the row and removed on cascade-delete.
- `template` — image/tag/port/envVars/etc., `ownerId` nullable (null = built-in, seeded, immutable).
- `storage_volume` — a named local volume source: `kind` (`"bind"` | `"volume"`), `source` (an absolute host path for bind, or a Docker-managed volume name — Docker's own `Binds` syntax tells the two apart by whether it looks like a path).
- `service_volume` — join table: one mount of one `storage_volume` into one `service` (`containerPath`, `readOnly`). A volume becomes "shared" simply by being mounted into more than one service — no separate project-volume concept.

**`PRAGMA foreign_keys` is never enabled** on the `bun:sqlite` connection, so `onDelete: "cascade"` in the schema is decorative for anything that also needs real-world cleanup (stopping containers, removing Docker networks). Explicit cascade logic lives in `ProjectDTO.cascadeDelete()` and `beforeDelete` in `src/lib/server/auth.ts` (account deletion) — both stop/remove the user's actual Docker containers before the DB rows disappear.

Migrations are incremental under `drizzle/` (`0000` baseline, `0001` project, `0002` template, `0003` deployment.log, `0004` storage/service volume). Mid-session schema changes get applied directly via a one-off script using `drizzle-orm/bun-sqlite/migrator`'s `migrate()` against the live `database.db`, without needing to restart the dev server.

`src/lib/server/db/seed.ts` — `seedBuiltinTemplates()`, called from `hooks.server.ts`'s `init()` on every boot (idempotent, fixed ids like `"builtin-redis"`, `.onConflictDoNothing()`).

### Docker integration (`src/lib/server/docker/`)

- `client.ts` — HMR-safe `dockerode` singleton, socket path from config.
- `labels.ts` — every container gets `localrun.managed=true` + `localrun.service.id=<id>`, plus Traefik discovery labels. `listManagedContainers()` and any host-scanning code **must** filter on `localrun.managed=true` — this app must never touch a container it didn't create.
- `networks.ts` — per-project Docker networks. `projectNetworkName(projectId)` is deterministic (`localrun-project-<id>`, no separate id stored). `ensureProjectNetwork`/`removeProjectNetwork` (idempotent create/remove, called from `ProjectDTO.create`/`cascadeDelete`). `connectToProjectNetwork(containerId, projectId, alias)` attaches a container to its project's network under a DNS alias equal to the service's slug.
- `service.ts` — the operational surface:
  - `pullImage(image, tag, auth?, onProgress?)` — `onProgress` is called once per layer _status change_ (not per byte-tick — dockerode's raw progress events are far too chatty to log one-for-one), used to build the live deploy-progress log.
  - `createAndStartContainer(params, onProgress?)` — container names include a random suffix (`localrun-<slug>-<hex8>`) so a redeploy never collides on "name already in use"; the _previous_ container for a service is found by its `localrun.service.id` label (`findServiceContainer`), not by name, since names are no longer stable across deploys. The container is aliased as its slug on the shared network (`NetworkingConfig.EndpointsConfig`) so other services can reach it at `http://<slug>:<containerPort>` regardless of the randomized name; if `params.projectId` is set, it also joins that project's network under the same alias. `params.volumes` (from `ServiceVolumeDTO.listForService`) becomes `HostConfig.Binds` (`"source:containerPath[:ro]"` — covers both bind-mounts and named volumes with the same syntax).
  - `start/stop/restartContainer`, `removeContainer`, `inspectStatus` → `ContainerStatus`, `streamLogs` (follow-mode web `ReadableStream`), `buildAuthConfig`.
- `reconcile.ts` — `syncServiceStatus`/`syncAllServiceStatuses`: poll-on-page-load status reconciliation. There is intentionally no background worker or Docker event subscriber (yet — see Planned features).
- `secrets.ts` — AES-256-GCM for `registryPasswordEnc`, key derived via `scryptSync` from `config.auth.secret`.

Containers attach to the external `localrun-network` Docker network (`docker network create localrun-network` once) rather than publishing host ports. `compose.yaml` bootstraps Traefik only; **the app itself is not containerized**.

### Config (`src/lib/config.ts`)

Zod-validated env config. Notable groups: `docker.{socketPath,networkName}`, `baseDomain`, `traefik.{entrypoint,certResolver}`, `auth.{origin,secret}`, `smtp.*`.

`config.auth.secret` reads `AUTH_SECRET` **falling back to `BETTER_AUTH_SECRET`** — don't collapse this to one var without checking both are honored.

### Auth (`src/lib/server/auth.ts`)

better-auth at `basePath: "/api/v1/auth"`, `drizzleAdapter` over the same `bun:sqlite` db. `src/hooks.server.ts` populates `event.locals.user`/`session` from the cookie session, falling back to manual `x-api-key`/`Authorization: Bearer` verification when no cookie is present.

`user.deleteUser` is enabled with a `beforeDelete` hook — don't assume better-auth's default account-deletion behavior is sufficient; it isn't, by design of this app's extra tables (see Data model above).

### Logging

Every module that mutates state (`page.server.ts` actions, the Docker layer, cascade-delete helpers) instantiates `new Logger("Domain")` from `src/lib/logger.ts` at module scope and calls `.info()`/`.warn()`/`.error()` on start/success/failure of each operation, with entity + user ids for correlation. `App.Locals.logger` is declared in `app.d.ts` but never populated — that's dead/aspirational, don't use it; the per-module `Logger` instance is the real pattern.

## Planned features (not yet built)

Intentional gaps, noted so a future session has the intended shape rather than re-litigating design decisions.

- **Web terminal**: shell into a running container from the UI (`docker exec` over a websocket/stream). Security-sensitive — needs an explicit auth/audit design before building.
- **Cron / scheduled redeploy**: a per-service schedule to auto-repull-and-redeploy (useful for `:latest` tags). First real need for background/periodic execution — `reconcile.ts`'s poll-on-page-load model doesn't cover it; this is a deliberate architecture expansion (needs a scheduler, not an extension of reconciliation).
- **Health-gated rollout**: opt-in health check (path + expected status/timeout) gating whether a newly-deployed container receives traffic — blue-green style, keep the old container alive/routable until the new one passes, roll back (never route to it) if it doesn't.
- **API-driven / CLI**: the DTO layer is the groundwork; no REST endpoints or CLI client exist yet.
- **Storage**: S3-compatible auto-backup destinations.
- **Observability**: an "Errors" tab per service (error count/details/timestamps/log), system stats (CPU/RAM/GPU/disk), viewing core-service logs (Homerun itself, Traefik) from the UI.
- **Security**: general OIDC provider support to gatekeep individual apps (selectable per-service in the new-service wizard), custom SSL certificate handling.
- **Source integration**: Git providers (including self-hosted, e.g. Gitea) to build from a repo source; remote servers for deployments/builds to avoid overloading the main host.
- **Onboarding**: an instance-settings flow when domain/DNS provider/SSL aren't configured yet.
- **Networking refinements**: prefix container names/domains with their project name; a flag to mark a service as DNS-resolvable vs. subnet-only.
- **Notifications / webhooks**: in-app lifecycle event feed; outbound webhooks (Telegram/Discord/generic HTTP) on deploy success/failure.

The living version of this list is `TODO.md` at the repo root — check it for current checkbox state before starting new work.
