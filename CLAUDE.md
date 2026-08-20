# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Homerun — a self-hosted, single-user PaaS for deploying Docker containers with a click-config form (a minimal Dokploy/Cloud-Run alternative). Point at an image (or a git repo — see below), fill in env vars/port/resources, deploy — Traefik auto-routes it to `<slug>.<baseDomain>` with TLS. Single host, local Docker socket only; no multi-node orchestration. A service is either "bring-your-own-image" (the original/default) or "build from a git repo" (clones + builds a Dockerfile locally, no registry involved) — see Git-based builds below.

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
- `remote-host-dto.ts` — `RemoteHostDTO`: `get`/`list`/`create`/`update`/`delete`, `toConnection()` (decrypts TLS material into what `docker/client.ts`'s `getDocker()` wants), and the static `connectionFor(svc, userId)` helper every route/module uses instead of calling `getDocker()` bare — see Remote hosts below.

**`toJSON()` before returning from `load`**: DTO instances are server-only; SvelteKit serializes `load` return values with devalue, which can't serialize a class instance. Every `load` maps DTOs to plain objects via `.toJSON()` (or `.map(d => d.toJSON())`) before returning.

### Shared UI components (`src/lib/components/`)

Not exhaustive — this app doesn't have (and this session didn't attempt) a full componentized design system, just the handful of genuinely-duplicated patterns that got pulled out as they were touched: `status-badge.svelte` (pre-existing), `empty-state.svelte` (icon/title/subtitle + optional CTA snippet — used on Storage and Remote Hosts so far, other list pages still have their empty state inlined), `form-styles.ts` (the `inputClass`/`labelClass`/`errorClass` Tailwind strings almost every form page redefines identically — imported directly as class strings, not a wrapper component, so it doesn't force a markup shape change on pages that predate it; wired into Remote Hosts and the service Networking tab so far). If you're touching a page with an inline empty-state or the same three class-string literals, prefer wiring in the shared version over copy-pasting again — but this is opportunistic, not a mandate to refactor unrelated pages.

### Routing: dashboard-only, no public pages

`src/routes/(protected)/` is a route group living at `/` itself (not `/dashboard`) — its `+layout.server.ts` is the single auth guard, redirecting to `/auth/sign-in` when signed out. There is no public marketing page. `src/routes/auth/**` is the only unauthenticated surface.

Top-level sections (sidebar nav): **Overview** (dashboard stats + recent deployments), **Services**, **Projects**, **Templates**, **Storage**, **Remote Hosts**, **System Logs**, **Setup**.

`src/routes/(protected)/services/`:

- `+page.svelte` — list, grouped by project (with an "Ungrouped" bucket when more than one group exists), inline start/stop/restart/delete actions
- `new/+page.svelte` — click-config create form, a 4-step wizard (Basic info / Networking / Environment / Compute — one `<form>` throughout, steps hidden via a CSS class rather than `{#if}` so field state survives navigating between them); accepts `?projectId=` and/or `?templateId=` query params to pre-fill from a project or template context (does **not** deploy — just persists config). "Deploy from" toggles between a Docker image and a git repo (see Git-based builds below), same toggle repeated on Settings for editing after creation.
- `[serviceId]/+layout.server.ts` — ownership guard (id **and** userId must match, else 404) + syncs live Docker status on every visit. Tabs: **Overview** (deploy/start/stop/restart, live deploy progress panel, deployment history with expandable per-deployment logs), **Logs** (live-streamed via a `+server.ts` GET returning a chunked `ReadableStream`), **Env Vars**, **Volumes** (mount/unmount StorageVolumes), **Networking** (custom domain mapping + the auth-gate toggle; SSL/Ports sections are read-only explainers, not controls — TLS is automatic, host ports are never published by design), **Terminal** (interactive shell into the live container, see below), **Errors** (failed deployments + a live "container currently down" banner), **Settings** (edit config, move between projects/remote deploy target, save-as-template, auto-redeploy cron schedule, danger-zone delete)
- `[serviceId]/deployments/[deploymentId]/progress/+server.ts` — polled by the Overview tab while a deploy is in flight; returns `{log, status}` JSON. The client pre-generates the deployment id itself (`crypto.randomUUID()`, set on the form via `formData.set("deploymentId", ...)` in `use:enhance`'s pre-submit callback) so it can start polling _before_ the deploy request even resolves. Polling is status-driven (stops once the deployment reaches a terminal status), which is also what makes resuming the progress view after a mid-deploy page reload work — `onMount` checks `svc.currentStatus` and resumes polling the latest deployment if it's still in-flight.

`src/routes/(protected)/projects/`, `templates/`, `storage/` mirror this pattern (list + `new/` create route + `[id]` detail where applicable). `system-logs/` streams the Traefik container's own logs (see Docker integration below).

### REST API (`src/routes/api/v1/`)

Lives outside `(protected)/` — that group's guard is a page-`load` redirect, wrong for a JSON API that should 401 instead. Every handler starts with its own `if (!locals.user) return json({error:"Unauthorized"}, {status:401})`; `locals.user` is populated for both cookie sessions and `x-api-key`/`Bearer` requests by `hooks.server.ts` (see Auth below), so the same handlers serve the dashboard's own `fetch` calls and external API-key clients alike.

- `services/` — `GET` list, `POST` create (zod-validated body, not the FormData-shaped schema `$lib/server/validation/service.ts` — that one's checkbox/`envKey[]`/`envValue[]` preprocessing is form-specific).
- `services/[serviceId]/` — `GET`, `PATCH` (partial update; `registryPassword` in the body re-encrypts, omitted means unchanged), `DELETE` (stops/removes the container first, same as the Settings danger-zone action).
- `services/[serviceId]/{deploy,start,stop,restart}/` — `POST`. `deploy` awaits the full pull→create→start pipeline via `deployService()` (see below) and returns once it's done — no separate polling endpoint for API clients (the dashboard's own progress-polling UI is unrelated, cookie-session only).
- `projects/`, `templates/` — read/create, same pattern, thinner (no lifecycle actions).

This is deliberately a thin JSON wrapper over the DTO layer, not a new abstraction — a future CLI is meant to talk to this.

### Shared deploy pipeline (`src/lib/server/deploy.ts`)

`deployService(svc, userId, clientDeploymentId?)` is the one pull-or-build→create-container→start implementation, used by the service Overview page's `deploy` action, `POST /api/v1/services/[serviceId]/deploy`, and the cron redeploy scheduler (below). Branches on `svc.buildSource` right at the top: `"image"` pulls as before; `"git"` calls `buildFromGit()` (below) and overwrites `svc.image`/`svc.tag` with the resulting local tag _before_ `createAndStartContainer` runs, so the container step never needs to know which path produced the image. Returns `{success, deploymentId, containerId?, error?}` rather than throwing — callers decide how to surface failure (a SvelteKit `fail()`, a JSON error body, a scheduler log line). Don't reimplement this inline in a new call site; extend the shared function instead.

### Git-based builds (`src/lib/server/docker/git-build.ts`)

A service's `buildSource` is `"image"` (bring-your-own, the default) or `"git"` — set on the new-service form or edited later on Settings, both share the same "Deploy from" toggle UI. Git mode shells out to the system `git` binary (`clone --depth 1 --branch <ref> --single-branch`, same "shell out to a well-known CLI" precedent as `tar`/`df`/`nvidia-smi` elsewhere) into a temp directory, then `buildFromGit()` calls dockerode's `buildImage()` against that directory (tar'd internally by dockerode, not manually) and tags the result `localrun-build-<slug>:<timestamp>` — a fresh tag every build, same "never reuse a name across deploys" precedent as container names. Progress lines stream into the deployment log exactly like `pullImage`'s layer-status events (filtered to status changes, not every line — build output is chattier than a pull). The temp clone directory is always removed afterward (`finally`), success or failure. No credential field for private repos yet (embed a token in the URL: `https://TOKEN@host/...`); a bare commit SHA doesn't work (shallow clone by branch/tag only, not by arbitrary ref).

Any git-clone-able HTTPS URL works — this is what makes it "Git providers, including self-hosted Gitea" without any provider-specific API integration: cloning is provider-agnostic at the URL level, so GitHub/GitLab/a self-hosted Gitea instance/anything else all just work the same way. There's no repo-browsing UI, no webhook/auto-deploy-on-push — a git-mode service is redeployed the same way an image-mode one is (manually, or via its own `cronSchedule` for `:latest`-tracking-equivalent auto-rebuilds).

### Remote hosts (`remote_host` table, `RemoteHostDTO`, `docker/client.ts`)

A service normally deploys to the local Docker socket (`config.docker.socketPath`) — that's still the default (`service.remoteHostId: null`). Registering a remote host (Remote Hosts page: name + `tcp://host:port` [+ optional TLS client cert] or `ssh://user@host`) and picking it as a service's "Deploy target" (Settings tab) routes every Docker operation for that service — deploy, start/stop/restart, logs, status-sync, account-deletion cleanup — at that daemon instead.

`docker/client.ts`'s `getDocker(remote?: RemoteHostConnection)` caches one dockerode client per host (keyed by remote host id, `"local"` for the default) in the same HMR-safe `globalThis` pattern as the db singleton. `RemoteHostDTO.connectionFor(svc, userId)` is the one place that turns a service into the connection object `getDocker()` wants (returns `undefined` for a local service) — every route/module that touches a service's container calls this rather than assuming the local socket; if you add a new lifecycle operation, thread it through the same way rather than calling `getDocker()` bare.

**Real architectural limitation, not an oversight**: the shared `localrun-network` Docker network, per-project networks, and Traefik itself all live on the _local_ host. A remote-hosted container gets Docker's own default `bridge` network instead (verified via `docker inspect`'s `NetworkMode`) — no Traefik routing, no `<slug>:<port>` internal DNS alias, no project-network membership. It's genuinely reachable only however you arrange that yourself (there's no host-port-publishing UI for this, deliberately — see the Networking tab's own "no port mapping by design" stance). Bind-mount volumes are skipped entirely on a remote deploy (a local path has no meaning on a different machine) — `deployService()` passes an empty volume list rather than silently creating a wrong mount. Git-based builds work against a remote host too (dockerode's `buildImage` streams the tar'd context to whichever daemon the client points at) — but the `git clone` step itself always happens locally first, only the Docker build step runs remotely.

Verified during development against a real second Docker connection — not just reasoned about — by running `socat TCP-LISTEN:12375,fork UNIX-CONNECT:/var/run/docker.sock` (a genuine TCP proxy in front of the same daemon, standing in for a truly separate remote host) and deploying a real service through it end-to-end: real container created, `docker inspect` confirmed `NetworkMode: bridge` (not the shared network), and start/stop both round-tripped through the proxied connection successfully.

### Custom SSL certificates (`docker/custom-ssl.ts`)

Per-service, only meaningful once `customDomain` is set (a domain outside this instance's own base domain, so Traefik's automatic ACME resolver can't cover it) — cert/key PEM stored encrypted (`service.customSslCertEnc`/`customSslKeyEnc`, same AES-256-GCM scheme as `registryPasswordEnc`), edited on the Networking tab's SSL section.

`syncCustomSslConfig(svc)` runs after every Networking save. It's a **deliberate no-op unless `config.traefik.dynamicConfigDir` (env `TRAEFIK_DYNAMIC_CONFIG_DIR`) is set** — this app never modifies the live Traefik container's command/mounts itself (that's the same "don't touch infra without the admin's own action" boundary as the remote-hosts feature's Docker daemon connections, just applied to Traefik instead). When it _is_ set, it decrypts the cert/key and writes three files into that directory: `certs/<slug>.crt`, `certs/<slug>.key`, and `<slug>-tls.yml` (a Traefik file-provider dynamic config pointing at the other two) — or removes all three if the cert's been cleared or the domain's changed. `compose.yaml` has the exact commented-out Traefik flags (`--providers.file.directory`/`--providers.file.watch`) and bind mount to uncomment, at the same host path as `TRAEFIK_DYNAMIC_CONFIG_DIR` — a one-time `docker compose up -d` the admin runs themselves; Traefik's file provider then picks up changes on its own (`watch=true`), no restart needed per-certificate after that initial setup.

Verified live: the encrypted round-trip, the no-op path when the dir is unset, and — with a real directory configured — the three files actually landing with correct byte-for-byte content, plus correct removal on clear. **Not verified**: Traefik itself picking up the config, since that requires the live container change this app deliberately doesn't make.

### Cron redeploy scheduler (`src/lib/server/cron.ts`, `cron-scheduler.ts`)

Opt-in, per service, off by default — configured on the Settings tab (`cronEnabled` checkbox + `cronSchedule` text field, validated with the same parser used at redeploy time). `cron.ts` is a small dependency-free 5-field cron matcher (wildcard/number/range/list/step, minute resolution, server-local time — no external cron package, matching this app's generally dependency-light posture). `cron-scheduler.ts`'s `startCronScheduler()` runs a 60s `setInterval` (started from `hooks.server.ts`'s `init()`), HMR-safe via a `globalThis` guard (same pattern as the db singleton in `db/lib.ts`) so a dev-server hot reload never starts a second interval. Each tick calls `ServiceDTO.listCronEnabled()` (unscoped by user — the only DTO method that queries across all users, since the scheduler isn't running on behalf of a request) and fires `deployService()` for anything due, guarding against a double-fire in the same matching minute via `cronLastRunAt`.

### Web terminal (`src/lib/server/docker/terminal.ts`)

Per-service "Terminal" tab, runs `/bin/sh` in the live container (rejects the request if the service isn't `currentStatus: "running"`). No WebSocket — this app has no custom server to hang a `ws` upgrade off (`vite dev` in dev, a plain built server via `bun run start` in prod) — so it's chunked HTTP instead: `POST .../terminal/open` creates the session, `GET .../terminal/[sessionId]/stream` is one long-lived streamed response for output (same `ReadableStream` shape as `streamLogs`), `POST .../terminal/[sessionId]/input` sends stdin a chunk at a time, `POST .../terminal/[sessionId]/close` ends it early (a 15-minute-idle reaper also runs regardless, `setInterval`, HMR-safe `globalThis` guard like the other schedulers). Every route re-checks session ownership (`userId` match) independently — `terminal.ts` only trusts the `containerId` it's given, it doesn't do its own auth.

**Load-bearing implementation detail**: dockerode's normal `exec.start({hijack:true})` — the standard way to get an interactive exec's duplex stream — hangs forever under Bun. Confirmed with a minimal repro before writing any route code: `container.exec()` (plain request/response, creates the exec) resolves fine, but `.start()` with hijacking (an HTTP/1.1 `Connection: Upgrade` handshake handing back a raw socket) never resolves — Bun's `node:http` compatibility layer doesn't complete that handshake the way Node's does. The fix in `terminal.ts` is to do the _start_ step manually: open a raw `Bun.connect()` Unix-socket connection to the Docker daemon, write the HTTP/1.1 Upgrade request by hand, and treat the socket as the raw duplex TTY stream once the `101 UPGRADED` header block has been read past. Verified against a real container end-to-end (real command in, real output back) before wiring it into routes. If a future change touches this file, re-verify this still holds — it's a Bun-runtime quirk, not a documented/guaranteed API contract, and could change with a Bun upgrade.

Audit trail is session-level, not per-keystroke: open/close are logged via the standard `Logger` pattern (service/container/session/user ids), individual commands typed into the shell are not. That's a deliberate scope cut, not an oversight — logging raw TTY bytes verbatim would be noisy and wouldn't cleanly map to discrete commands anyway (arrow-key history, tab-completion, etc. all flow through the same input channel).

### S3 backups (`src/lib/server/backup/`, `backup-scheduler.ts`)

Per-volume, off by default, configured on `storage/[volumeId]`. `backup/s3-client.ts` is a hand-rolled AWS Signature V4 client (`putObject` — single-request PUT, no multipart, no SDK dependency — verified end-to-end against a local MinIO container during development) that works against any S3-compatible endpoint (AWS S3, MinIO, R2, B2, etc.) via path-style addressing. `backup/backup.ts`'s `backupVolume()` shells out to `tar` to gzip the volume's `source` directory in memory, then PUTs it as `<prefix/>volumeName-<timestamp>.tar.gz`. **Bind-mount volumes only** — `kind: "volume"` (Docker-managed) is rejected, since its content isn't visible on the host filesystem the same way; would need a short-lived helper container to read it out (not built). `backup-scheduler.ts` mirrors `cron-scheduler.ts` exactly (same 60s-tick / `globalThis`-guard / `cronMatches` / last-run double-fire-guard pattern, own logger) — the two are independent schedulers, not shared code, since they operate on different DTOs. No restore flow — upload-only.

### Data model (`src/lib/server/db/schema.ts`)

better-auth-owned tables (`user`, `session`, `account`, `verification`, `apikey`, `passkey`) plus:

- `service` — image/tag, registry creds (`registryPasswordEnc`, AES-256-GCM), envVars (JSON), port/restart-policy/resource limits, `desiredState` (user intent) vs `currentStatus` (live reconciled Docker state), `containerId`, `projectId` (nullable FK, `onDelete: "set null"`), `cronEnabled`/`cronSchedule`/`cronLastRunAt` (opt-in scheduled redeploy, see below), `authRequired` (Traefik forwardAuth gate, see below — ships with a known real limitation, read that section before assuming it works end-to-end), `buildSource` (`"image"` | `"git"`) + `gitUrl`/`gitRef`/`gitBuildContext`/`gitDockerfilePath` (see Git-based builds below — `image`/`tag` hold the resolved local build tag when `buildSource` is `"git"`, not user-editable directly in that mode), `remoteHostId` (nullable FK to `remote_host`, `onDelete: "set null"` — see Remote hosts below), `customSslCertEnc`/`customSslKeyEnc` (see Custom SSL certificates below).
- `remote_host` — a registered non-local Docker daemon: `dockerHost` (`tcp://...` or `ssh://...`), optional `tlsCaEnc`/`tlsCertEnc`/`tlsKeyEnc` (AES-256-GCM, same scheme as `registryPasswordEnc`). See Remote hosts below.
- `deployment` — history of deploy attempts: status, image digest, error message, timestamps, and `log` (text, default `""`) — the live-appended progress log described above, kept after the deploy completes as an audit trail (shown as an expandable panel per row in the deployment history).
- `service.customDomain` — optional second hostname (unique), a second Traefik router sharing the primary router's backend service — see labels.ts below. Configured on the service's Networking tab.
- `project` — name/description/userId/`slug` (unique, DNS-safe — prefixes every member service's container name and public subdomain, see Docker integration below). Every project has a matching Docker network (see below), created alongside the row and removed on cascade-delete. Known gap: account deletion's cascade cleans up a user's services/containers but not their `project` rows — harmless clutter today (FK pragma is off) but should get the same explicit treatment eventually (see TODO.md Chores).
- `template` — image/tag/port/envVars/etc., `ownerId` nullable (null = built-in, seeded, immutable).
- `storage_volume` — a named local volume source: `kind` (`"bind"` | `"volume"`), `source` (an absolute host path for bind, or a Docker-managed volume name — Docker's own `Binds` syntax tells the two apart by whether it looks like a path). `backup*` columns (`backupEnabled`/`backupSchedule`/`backupEndpoint`/`backupBucket`/`backupRegion`/`backupAccessKeyId`/`backupSecretAccessKeyEnc`/`backupPrefix`/`backupLastRunAt`) hold its optional S3 destination — see Backups below.
- `service_volume` — join table: one mount of one `storage_volume` into one `service` (`containerPath`, `readOnly`). A volume becomes "shared" simply by being mounted into more than one service — no separate project-volume concept.

**`PRAGMA foreign_keys` is never enabled** on the `bun:sqlite` connection, so `onDelete: "cascade"` in the schema is decorative for anything that also needs real-world cleanup (stopping containers, removing Docker networks). Explicit cascade logic lives in `ProjectDTO.cascadeDelete()` and `beforeDelete` in `src/lib/server/auth.ts` (account deletion) — both stop/remove the user's actual Docker containers before the DB rows disappear.

Migrations are incremental under `drizzle/` (`0000` baseline, `0001` project, `0002` template, `0003` deployment.log, `0004` storage/service volume, `0005` service.dns_resolvable, `0006` project.slug, `0007` service.cron*, `0008` service.customDomain, `0009` storage_volume.backup*, `0010` service.authRequired, `0011` service.buildSource/git*, `0012` remote_host + service.remoteHostId, `0013` service.customSsl*). Mid-session schema changes get applied directly via a one-off script using `drizzle-orm/bun-sqlite/migrator`'s `migrate()` against the live `database.db`, without needing to restart the dev server. **Adding a NOT-NULL column to a table that already has rows** (as `0006` did): SQLite's `ALTER TABLE ADD COLUMN NOT NULL` requires a `DEFAULT` even on an empty table — use a harmless default (e.g. `DEFAULT ''`) in the migration SQL, then backfill any pre-existing rows with a real value by hand; the ORM-level `notNull()` in `schema.ts` is what matters for new rows going forward (app-enforced, same as the FK-cascade note below).

`src/lib/server/db/seed.ts` — `seedBuiltinTemplates()`, called from `hooks.server.ts`'s `init()` on every boot (idempotent, fixed ids like `"builtin-redis"`, `.onConflictDoNothing()`).

### Docker integration (`src/lib/server/docker/`)

- `client.ts` — HMR-safe `dockerode` singleton, socket path from config.
- `labels.ts` — every container gets `localrun.managed=true` + `localrun.service.id=<id>`, plus Traefik discovery labels (unless `dnsResolvable` is false — then only the two managed labels, no `traefik.*` at all, so it never gets a router). `listManagedContainers()` and any host-scanning code **must** filter on `localrun.managed=true` — this app must never touch a container it didn't create. When the service belongs to a project, the public subdomain is `<projectSlug>-<slug>.<baseDomain>` (`projectSlug` param, optional). When `customDomain` is set, a second router (`<slug>-custom`) is added pointing at the _same_ `traefik.http.services.<slug>` backend — one loadbalancer config, two hostnames reaching it, not a duplicated service block.
- `networks.ts` — per-project Docker networks. `projectNetworkName(projectId)` is deterministic (`localrun-project-<id>`, no separate id stored). `ensureProjectNetwork`/`removeProjectNetwork` (idempotent create/remove, called from `ProjectDTO.create`/`cascadeDelete`). `connectToProjectNetwork(containerId, projectId, alias)` attaches a container to its project's network under a DNS alias equal to the service's slug (the _internal_ alias is never project-prefixed, only the container name and public subdomain are — sibling services keep addressing each other by plain slug).
- `service.ts` — the operational surface:
  - `pullImage(image, tag, auth?, onProgress?)` — `onProgress` is called once per layer _status change_ (not per byte-tick — dockerode's raw progress events are far too chatty to log one-for-one), used to build the live deploy-progress log.
  - `createAndStartContainer(params, onProgress?)` — container names include a random suffix (`localrun-[<projectSlug>-]<slug>-<hex8>`) so a redeploy never collides on "name already in use"; the _previous_ container for a service is found by its `localrun.service.id` label (`findServiceContainer`), not by name, since names are no longer stable across deploys. The container is aliased as its slug on the shared network (`NetworkingConfig.EndpointsConfig`) so other services can reach it at `http://<slug>:<containerPort>` regardless of the randomized name; if `params.projectId` is set, it also joins that project's network under the same alias. `params.volumes` (from `ServiceVolumeDTO.listForService`) becomes `HostConfig.Binds` (`"source:containerPath[:ro]"` — covers both bind-mounts and named volumes with the same syntax). Don't call this directly from a new route — go through `$lib/server/deploy.ts`'s `deployService()` instead (see above), which wraps it with deployment-row bookkeeping.
  - `start/stop/restartContainer`, `removeContainer`, `inspectStatus` → `ContainerStatus`, `streamLogs` (follow-mode web `ReadableStream`), `buildAuthConfig`.
- `reconcile.ts` — `syncServiceStatus`/`syncAllServiceStatuses`: poll-on-page-load status reconciliation. There is intentionally no background worker or Docker event subscriber (yet — see Planned features).
- `secrets.ts` — AES-256-GCM for `registryPasswordEnc`, key derived via `scryptSync` from `config.auth.secret`.
- `core-services.ts` — `findTraefikContainer()`, a deliberate narrow exception to the managed-label-only rule: read-only (logs only, never lifecycle) lookup of the Traefik container by image-name prefix, backing the System Logs page.

Containers attach to the external `localrun-network` Docker network (`docker network create localrun-network` once) rather than publishing host ports. `compose.yaml` bootstraps Traefik only; **the app itself is not containerized** (so its own logs aren't viewable in-app — see `system-logs/` above).

### System stats (`src/lib/server/system-stats.ts`)

`getSystemStats()` — host-level (not per-container) CPU/RAM/disk via Node's `os` module + a shelled-out `df -Pk .`, plus a best-effort GPU read via `nvidia-smi` (returns `gpu: null` when absent — the common case, not an error; no other vendor supported). CPU% needs a delta between two samples (`os.cpus()` gives cumulative counters since boot), so a module-scope `lastCpuSample` is diffed on each call — first call after boot always reads 0%. Polled by the dashboard's `/system-stats` endpoint every 5s.

### Setup diagnostics (`src/lib/server/setup-checks.ts`)

`runSetupChecks()` — read-only diagnostics (base domain/auth secret/origin still at their defaults, Traefik container reachable, Docker socket reachable, SMTP fully configured if enabled), each with a severity and the env var that fixes it. Surfaced on `/setup` and as a dismissed-by-navigating-away banner on the dashboard when anything isn't `"ok"`. Reads `config`, which already reflects any DB-backed instance settings merged over the env defaults (see Config and Instance settings below) — these checks just report the effective value, they don't care which layer it came from. There's still no DNS-provider (Cloudflare/Pangolin) automation; see TODO.md's Onboarding item for that larger, unbuilt scope.

### Config (`src/lib/config.ts`)

Zod-validated env config. Notable groups: `docker.{socketPath,networkName}`, `baseDomain`, `traefik.{entrypoint,certResolver}`, `auth.{origin,secret}`, `smtp.*`.

`config.auth.secret` reads `AUTH_SECRET` **falling back to `BETTER_AUTH_SECRET`** — don't collapse this to one var without checking both are honored.

`config` is a single stable object every other module imports and reads properties off live — the env-parsed values are captured once into a private `envDefaults`, then `config` starts as a clone of that and is **mutated in place** (never reassigned) by `applyInstanceSettings(override)`. See Instance settings below for who calls that and when.

### Instance settings (DB-backed) (`instance_settings` table, `InstanceSettingsDTO`, `/settings`)

Most of `config` — OAuth providers, Docker socket/network defaults, Traefik entrypoint/cert-resolver/dynamic-config-dir, SMTP, and core settings (base domain, origin, the auth-check URL, cross-subdomain cookies) — is now live-editable from a `/settings` page, not just env vars. `instance_settings` is a **singleton row** (`InstanceSettingsDTO`, id always `"default"`, auto-created on first read): every column is nullable, `null` meaning "fall back to the env default", a non-null value overriding it. Secrets (`smtpPasswordEnc`, each OAuth provider's `clientSecretEnc` inside the `oauthProviders` JSON array) use the same AES-256-GCM scheme as `service.registryPasswordEnc` (`docker/secrets.ts`, reused as-is).

**Not DB-backed** — `dbPath`/`port`/`auth.secret`/`logLevel`/`logFormat` stay env-only: `dbPath` has to be known before the DB is even reachable, and `auth.secret` is the key every `*Enc` column's encryption derives from, so DB-backing it would be circular.

`InstanceSettingsDTO.toConfigOverride()` decrypts every stored secret and returns the plain-value shape `applyInstanceSettings()` merges over `envDefaults`. This runs twice: once in `hooks.server.ts`'s `init()` at boot (before the server accepts any request, so DB-backed settings are in effect from the very first request, not just after a save), and again at the end of every `/settings` action — so a saved change is live immediately, no restart, for every section including OAuth (see Auth below for how that one specifically applies live).

`config.ts` deliberately never imports the DTO or `db` itself — `db/lib.ts` imports `config.ts` for `dbPath`, so `config.ts` has to stay a leaf module or the two would form a circular import. The DB-reading glue lives in `hooks.server.ts` and `settings/+page.server.ts` instead.

**Real, tested finding from building this**: a bad OAuth provider (unreachable/invalid discovery URL) isn't just a broken login button — better-auth's `genericOAuth` plugin validates every configured provider's discovery document while building its auth _context_, which every request touching auth goes through, including plain `getSession()` on every page load and even email/password sign-in. Saving one unvalidated **locked the whole app out**, `/settings` included, with no way back in short of editing the DB directly — verified live. Fixed two ways: `settings/+page.server.ts`'s `updateOauth` action fetches and validates each provider's discovery document (must return 200 with a JSON body containing an `issuer`) _before_ persisting anything, rejecting the save with a clear error otherwise — deliberately **not** the "warn, don't block" precedent the image-existence checker uses, since the failure mode here is total lockout rather than one broken service. And as defense in depth against any other cause, `hooks.server.ts`'s `authHandler` wraps `auth.api.getSession()` in a `catch` that degrades to "no session" on any error rather than letting it 500 every request — so even if auth context construction fails for some other reason, the rest of the app (and `/settings`, to fix whatever's wrong) stays reachable, just signed out.

### Auth (`src/lib/server/auth.ts`)

better-auth at `basePath: "/api/v1/auth"`, `drizzleAdapter` over the same `bun:sqlite` db. `src/hooks.server.ts` populates `event.locals.user`/`session` from the cookie session, falling back to manual `x-api-key`/`Authorization: Bearer` verification when no cookie is present: `auth.api.verifyApiKey()` confirms the key, then the owning user is looked up **directly by `result.key.referenceId`** via a plain drizzle query — deliberately _not_ through `getSession()`'s API-key session-mocking, which is gated behind the `apiKey()` plugin's `enableSessionForAPIKeys` option (default `false`, and better-auth's own docs advise against enabling it in production). This is what makes `x-api-key`/`Bearer` auth work for `src/routes/api/v1/*` (see REST API above).

`user.deleteUser` is enabled with a `beforeDelete` hook — don't assume better-auth's default account-deletion behavior is sufficient; it isn't, by design of this app's extra tables (see Data model above).

`config.auth.crossSubdomainCookies` (env `AUTH_CROSS_SUBDOMAIN`, default off, also DB-editable — see Instance settings above) sets better-auth's `advanced.crossSubDomainCookies` to scope the session cookie to `.{baseDomain}` instead of the exact host — see the per-service auth gate below for why, and its documented, tested limitation.

The `betterAuth({...})` call is wrapped in `buildAuth()` rather than assigned once to a `const` — `export let auth = buildAuth()`, plus `export function rebuildAuth()` which reassigns `auth = buildAuth()`. This is what makes OAuth provider changes saved on `/settings` apply live: every consumer (`hooks.server.ts`'s `auth.api.getSession`/`svelteKitHandler({ auth, ... })`) reads `auth.*` per-request rather than destructuring it at import time, so ES module live-bindings mean a reassignment inside `auth.ts` is immediately visible everywhere without a restart. `rebuildAuth()` is called at the end of `hooks.server.ts`'s `init()` and every `/settings` action.

### Per-service auth gating (`service.authRequired`, `/api/v1/auth-check`)

When enabled (Networking tab), `docker/labels.ts` attaches a Traefik forwardAuth middleware to the service's router(s) pointing at `config.authCheckUrl` (default `http://host.docker.internal:<port>/api/v1/auth-check`, since this app isn't containerized — Traefik must reach it from inside its own container; the Linux case needs `extra_hosts: host-gateway` added to compose.yaml's Traefik service, which this app can't do for the user). `/api/v1/auth-check` just checks `locals.user` and returns 200/401, so it works with whatever the user authenticates into Homerun with — including a configured `genericOAuth`/OIDC provider (see auth.ts).

**Real, tested limitation, not a hypothetical**: there's no login page mounted on a gated service's own subdomain, so this blocks _everyone_ — including a signed-in admin — unless `AUTH_CROSS_SUBDOMAIN=true`. Even with it enabled, during development a signed-in admin visiting the gated subdomain directly still got a 401 (verified: the cookie's `Domain` attribute did widen correctly, but better-auth's `getSession()` still appears to reject it based on request Host — not root-caused, better-auth's internals weren't dug into further). The Networking tab's copy says this plainly (bordering on a warning) rather than promising working SSO. Treat `authRequired` today as a hard "make this unreachable from outside" switch, not a finished login-gated-app feature — a real fix needs a login-redirect flow for gated subdomains.

### Logging

Every module that mutates state (`page.server.ts` actions, the Docker layer, cascade-delete helpers) instantiates `new Logger("Domain")` from `src/lib/logger.ts` at module scope and calls `.info()`/`.warn()`/`.error()` on start/success/failure of each operation, with entity + user ids for correlation. `App.Locals.logger` is declared in `app.d.ts` but never populated — that's dead/aspirational, don't use it; the per-module `Logger` instance is the real pattern.

## Planned features (not yet built)

Intentional gaps, noted so a future session has the intended shape rather than re-litigating design decisions.

- **Health-gated rollout**: opt-in health check (path + expected status/timeout) gating whether a newly-deployed container receives traffic — blue-green style, keep the old container alive/routable until the new one passes, roll back (never route to it) if it doesn't.
- **CLI**: the REST API (`src/routes/api/v1/`) and the DTO layer underneath it are the groundwork — a CLI client itself doesn't exist yet.
- **Storage**: S3 backup covers bind-mount volumes only (see below) — no named-volume backup, no restore flow.
- **Observability**: system stats beyond the dashboard's host-level CPU/RAM/GPU/disk — no per-container `docker stats` view yet.
- **Security**: per-service auth gating exists (`authRequired`, see below) but doesn't have a working login-redirect flow yet — see its own section for the real, tested limitation. Custom SSL cert handling exists too (see below) but genuinely requires the admin's own one-time Traefik config change to take effect.
- **Source integration**: git-based builds exist (see below) — no private-repo credential field, no webhook/auto-deploy-on-push. Remote hosts exist too (see below) — no host port publishing for remote-hosted services, no shared-network/Traefik integration for them, bind-mount volumes are skipped on remote deploys.
- **Onboarding**: basic setup diagnostics exist (`/setup`, see above) — the larger version (DNS-provider API automation for TLS/DNS ops, e.g. Cloudflare/Pangolin) isn't built.
- **Notifications / webhooks**: in-app lifecycle event feed; outbound webhooks (Telegram/Discord/generic HTTP) on deploy success/failure.

The living version of this list is `TODO.md` at the repo root — check it for current checkbox state before starting new work.
