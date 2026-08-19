# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Homerun — a self-hosted, single-user PaaS for deploying Docker containers with a click-config form (a minimal Dokploy/Cloud-Run alternative). Point at an image, fill in env vars/port/resources, deploy — Traefik auto-routes it to `<slug>.<baseDomain>` with TLS. Single host, local Docker socket only; no multi-node orchestration, no git/Dockerfile build pipeline (bring-your-own-image only).

Stack: SvelteKit 2 (Svelte 5 runes) + Bun runtime, better-auth, Drizzle ORM over `bun:sqlite`, Tailwind v4 + shadcn-svelte ("vega" style), dockerode.

## Commands

```
bun run dev              # vite dev
bun run build            # vite build
bun run start            # bun run ./build/index.js (serve the built app)
bun run check            # svelte-kit sync && svelte-check — currently BROKEN, see note below
bun run lint             # biome check . && rustywind --check-formatted .
bun run lint:fix         # biome check . --write && rustywind --write .
bun run db:generate      # drizzle-kit generate — regenerate migrations from src/lib/server/db/schema.ts
bun run component:add    # shadcn-svelte add <name> — installs a UI primitive into src/lib/components/ui/
docker compose up -d     # bootstraps Traefik (see compose.yaml) — required for subdomain routing to deployed services
```

No test framework is set up in this repo.

**`bun run check` is currently broken**, unrelated to app code: `typescript` is pinned to `^7.0.2`, and `svelte-check`'s `--tsgo` mode requires a _second_, aliased TypeScript 6 install alongside it (`npm install -D typescript@~6 @typescript/native@npm:typescript@7`). Until that's set up, verify changes by booting `bun run dev` and exercising routes directly rather than trusting a clean `check` run.

Biome formats with tabs + double quotes; svelte/vue/astro files have `useConst`/`useImportType`/unused-import rules turned off (Svelte 5 `$state`/`$props` destructuring trips them).

## Conventions (strict — apply to every change)

- **Never manually type anything in a route file** — `+page.svelte`, `+layout.svelte`, `+page.server.ts`, `+layout.server.ts`, `+server.ts`. This covers `$props()` (`data`/`form`/`children`/`params`) in the `.svelte` files _and_ `load`/`actions` in the `.server.ts` files. All of it is inferred by SvelteKit's tooling from the route's generated `./$types`, based on file location — that's the framework working as designed, don't fight it. Concretely:
  - `.svelte`: `const { data } = $props();` — never `: { data: PageData }`, never `: PageProps`. No `PageData`/`LayoutData`/`ActionData`/`PageProps`/`LayoutProps` type name appears in a route component at all.
  - `.server.ts`: `export const load = async ({ locals, parent }) => {...}` — never `: PageServerLoad`/`: LayoutServerLoad`. `export const actions = {...}` — never `: Actions`. No `import type {...} from "./$types"` for these at all.
  - This rule is specific to route files. Non-route components (`$lib/components/**`) and shared server modules (`$lib/server/**`) are normal TypeScript/Svelte code and should still be typed explicitly as usual — there's no route-based inference for those.
- **Nested `load` functions under `(protected)/` must not re-check `!locals.user`.** The parent `+layout.server.ts` already redirects unauthenticated users before any child `load` runs, so re-checking is dead code. Use `const { user } = await parent();` instead to get the already-guaranteed user (this also chains through nested layouts — e.g. `services/[serviceId]/+layout.server.ts`'s `parent()` picks up `user` from the `(protected)` layout above it). **This does not apply to `actions`** — form action submissions don't go through the parent layout's `load` at all (an action can be hit directly, e.g. a raw POST), so every action keeps its own explicit `if (!locals.user) redirect(...)` guard. Don't strip those.
- No unused variables or imports.
- No lint errors — `bun run lint` must be clean before considering a change done.
- No type errors left after any change. `bun run check` is the enforcement mechanism for this but is currently broken (see above) — until it's fixed, this has to be verified by careful reading plus runtime testing (`bun run dev` + exercising the actual routes), not skipped.

## Architecture

### Routing: dashboard-only, no public pages

`src/routes/(protected)/` is a route group living at `/` itself (not `/dashboard`) — its `+layout.server.ts` is the single auth guard, redirecting to `/auth/sign-in` when signed out. There is no public marketing page. `src/routes/auth/**` (sign-in, sign-up, sign-up/confirm) is the only unauthenticated surface.

The core feature lives under `src/routes/(protected)/services/`:

- `+page.svelte` — list, with inline start/stop/restart/delete actions
- `new/+page.svelte` — click-config create form (does **not** deploy — just persists config)
- `[serviceId]/+layout.server.ts` — ownership guard (id **and** userId must match, else 404) + syncs live Docker status on every visit; tabs: Overview (deploy/start/stop/restart + deployment history), `logs/` (live-streamed via a `+server.ts` GET returning a chunked `ReadableStream`, consumed client-side with `fetch()` + `body.getReader()` — no SSE/WebSocket), `env/` (edits `service.envVars`, takes effect on next deploy), `settings/` (edit + danger-zone delete)

`src/lib/server/services.ts` exports `ownedService(serviceId, userId)`, the shared ownership-check query — every service-scoped route/action uses it; never trust a route param alone.

### Data model (`src/lib/server/db/schema.ts`)

better-auth-owned tables (`user`, `session`, `account`, `verification`, `apikey`, `passkey`) plus two app tables:

- `service` — one row per deployable unit: image/tag, registry creds (`registryPasswordEnc`, AES-256-GCM), envVars (JSON column), port/restart-policy/resource limits, `desiredState` (user intent: running/stopped) vs `currentStatus` (live reconciled Docker state, `ContainerStatus` from `src/lib/types.ts`), `containerId`.
- `deployment` — immutable history of deploy attempts (status, image digest, error message, timestamps) tied to a `service`.

**`PRAGMA foreign_keys` is never enabled** on the `bun:sqlite` connection (`src/lib/server/db/lib.ts`), so `onDelete: "cascade"` in the schema is decorative. Cleanup is done explicitly instead — see `beforeDelete` in `src/lib/server/auth.ts`, which also stops/removes the user's actual Docker containers before their DB rows disappear (a DB-only cascade would leak running containers).

Migration history is a single squashed baseline (`drizzle/0000_*.sql`) — this was a from-scratch schema replacement, not an incremental migration chain.

### Docker integration (`src/lib/server/docker/`)

- `client.ts` — HMR-safe `dockerode` singleton (same `globalThis`-caching pattern as `db/lib.ts`), socket path from config.
- `labels.ts` — every container this app creates gets `localrun.managed=true` + `localrun.service.id=<id>`, plus the Traefik discovery labels (`traefik.enable`, router rule `Host(\`<slug>.<baseDomain>\`)`, entrypoint/certresolver, network). `listManagedContainers()`and any host-scanning code **must** filter on`localrun.managed=true` — this app must never touch a container on the host that it didn't create.
- `service.ts` — the operational surface: `pullImage`, `createAndStartContainer` (replaces any same-named container by convention — this is what makes "deploy" and "redeploy" the same code path), `start/stop/restartContainer`, `removeContainer`, `inspectStatus` → `ContainerStatus`, `streamLogs` (follow-mode web `ReadableStream`), `buildAuthConfig` (decrypts registry creds for a pull).
- `reconcile.ts` — `syncServiceStatus`/`syncAllServiceStatuses`: poll-on-page-load status reconciliation. There is intentionally no background worker or Docker event subscriber.
- `secrets.ts` — AES-256-GCM for `registryPasswordEnc`, key derived via `scryptSync` from `config.auth.secret` (no separate secret to manage).

Containers are attached directly to the external `localrun-network` Docker network (`docker network create localrun-network` once) rather than publishing host ports — Traefik reaches them over that network. `compose.yaml` bootstraps Traefik only; **the app itself is not containerized** — run it directly on the host (`bun run dev` / `bun run start`) with `DOCKER_NETWORK_NAME`/`DOCKER_SOCKET_PATH` set and socket access.

### Config (`src/lib/config.ts`)

Zod-validated env config, parsed once at import into a `config` singleton. Notable groups: `docker.{socketPath,networkName}`, `baseDomain` (subdomain suffix for deployed services), `traefik.{entrypoint,certResolver}`, `auth.{origin,secret}`, `smtp.*` (gates email verification via `isSmtpEnabled()`).

`config.auth.secret` reads `AUTH_SECRET` **falling back to `BETTER_AUTH_SECRET`** — the latter is better-auth's own CLI convention (and what `.env` sets), so don't "fix" this to a single var without checking both are still honored.

### Auth (`src/lib/server/auth.ts`)

better-auth at `basePath: "/api/v1/auth"`, `drizzleAdapter` over the same `bun:sqlite` db. Plugins: `sveltekitCookies`, `openAPI`, `apiKey`, `passkey`, `admin`, `bearer`, `genericOAuth` (provider list from config, empty by default). `src/hooks.server.ts` populates `event.locals.user`/`session` from the cookie session, falling back to manual `x-api-key`/`Authorization: Bearer` verification via `auth.api.verifyApiKey()` when no cookie is present — this is the auth path a future CLI/API client would use.

`user.deleteUser` is enabled with a `beforeDelete` hook (see Data model section above) — don't assume better-auth's default account-deletion behavior is sufficient here; it isn't, by design of this app's extra tables.

## Planned features (not yet built)

These are intentional gaps, not oversights — noted here so a future session has the intended shape rather than having to guess or re-litigate design decisions.

- **Env var save → auto-restart**: today, `env/+page.server.ts`'s `update` action only persists `service.envVars`; the UI tells the user to redeploy manually from Overview. Saving should instead trigger the same deploy pipeline the Overview tab's `deploy` action runs (pull + recreate container) automatically. Since the deploy logic currently lives inline in `[serviceId]/+page.server.ts`'s `deploy` action, it should be extracted into a shared function (e.g. `$lib/server/deploy.ts`) callable from both that action and the env-save action.
- **Health check before routing, with rollback**: a per-service opt-in health check (path + expected status/timeout) that gates whether a newly deployed container actually receives traffic. `createAndStartContainer` currently stops+removes the old container before starting the new one — this needs to become closer to blue-green: keep the old container alive and routable until the new one passes its health check, then swap; if it never passes, don't route to it and treat the deploy as failed (this is also the rollback mechanism — the last known-healthy container stays up). Needs new `service` columns (health check config) and probably a `deployment.healthy` flag.
- **Periodic/scheduled redeploy**: a per-service schedule (daily/weekly/monthly, or a cron expression) that re-pulls and redeploys automatically — useful for `:latest`-tagged images built upstream. This is the first real need for background/periodic execution in this app; `reconcile.ts`'s poll-on-page-load model and the "no background worker" design decision don't cover it, so this is a deliberate architecture expansion, not an extension of the existing reconciliation pattern.
- **Notifications**: an in-app feed of lifecycle events (service deployed, service failed to deploy, etc.), fed from the same deploy-lifecycle code path as the above. Needs a new table and some UI surface (e.g. a bell/activity feed).
- **Webhooks**: per-user or per-service outbound webhooks on lifecycle events, targeting Telegram (Bot API), Discord (webhook URL), or a generic HTTP endpoint. Needs a config table (url, provider/type, which events trigger it) and a dispatch step alongside the notification-write step above.
