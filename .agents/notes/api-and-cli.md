# REST API, OpenAPI, CLI

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory. These sections were split out of that file, so a "see X below/above"
in the text below may now point at a section living in a sibling note rather
than in this one.

## REST API (`src/routes/api/v1/`)

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
- `stacks/`, `templates/`, read/create, same pattern, thinner (no lifecycle
  actions).
- `services/`, `stacks/`, and `templates/`'s `GET`s are paginated
  (`parseApiListQuery`/`jsonPage`, see Server-side list pagination above):
  `page`, `perPage` (default 100, max 100), `q`. The response body is
  deliberately still a plain JSON array, not an envelope, so an existing client
  doesn't break; the total row count, current page, and page size come back in
  `x-total-count`/`x-page`/`x-per-page` response headers instead. `templates/`
  runs the builtin and mine paged queries in parallel and concatenates their
  items, with `total` summed across both.
- `system-stats/`, `GET`, host CPU/RAM/disk/GPU stats
  (`SystemStatsService.getSystemStats()`). Moved here from a bare
  `(protected)/system-stats/+server.ts`, that route lived directly in the pages
  directory even though it's pure JSON with no page, which is what
  `(protected)/` is otherwise exclusively for; the dashboard's own 5s poll
  (`(protected)/+page.svelte`) now fetches `/api/v1/system-stats` instead.
- `openapi.json/`, `GET`, public/unauthenticated (the spec describes shapes, not
  data; every documented route still enforces its own auth independently).
  Serves the OpenAPI 3.1 document built by `$lib/openapi/build.ts`, see below.

`GET /api/health` sits outside `v1/` entirely, a one-line unauthenticated
`new Response("OK")` used as a readiness probe (the compose healthcheck, and
`tests/e2e/`'s bootstrap waiting for the spawned app), not part of the versioned
API surface or the OpenAPI document.

This is deliberately a thin JSON wrapper over the DTO layer, not a new
abstraction, the `packages/cli/` sub-project talks to this (see below).

## Long-running requests and Bun's idle timeout (`$lib/server/long-request.ts`)

**Real, reproduced finding, not a precaution.** `@orochibraru/svelte-smol`'s
server passes `idleTimeout` to `Bun.serve()`, defaulting to 10s (env
`IDLE_TIMEOUT`), and Bun applies that to a request that's still being _handled_,
not just to a genuinely idle socket: a handler that produces no bytes for longer
than the window has its connection severed mid-flight, and the caller sees a
bare `ECONNRESET` instead of a response. A GET is transparently retried by most
clients so it only ever looks slow; a POST is not, so it just fails.

This bit `POST /api/v1/services/<id>/stop`, which awaits `docker stop`, whose
own SIGKILL grace period is _also_ 10s, so any container that doesn't exit on
its stop signal promptly lands the request exactly on the boundary. It surfaced
as an integration test failing in CI on three of four consecutive runs, always
that same request, always `ECONNRESET`, and never locally: **macOS doesn't
enforce this the same way** (verified, a 12s handler returns 200 there), which
is what made it look like test flakiness. Reproduced deliberately in
`oven/bun:1.4.0` on Linux: with `idleTimeout: 10`, a 15s POST handler fails with
`ECONNRESET` at ~12s plus Bun's own
`warn: Bun.serve() timed out a request after 10 seconds`; at 11s it failed
sometimes and passed others, which is the flakiness itself.

`allowLongRequest(platform)` (`$lib/server/long-request.ts`) clears the timeout
for one request via `platform.server.timeout(platform.request, 0)`
(`App.Platform` was already typed for exactly this in `app.d.ts`). It's a no-op
under `vite dev`, where `platform` is undefined and the timeout doesn't apply
anyway. Call it as the _first_ statement of any handler that can legitimately
outlast the window; it's already wired into the API's
`deploy`/`stop`/`restart`/`DELETE` handlers, the dashboard actions doing those
same operations (services list, service Overview, the Settings danger-zone
delete), and the two long-lived streams that have the same exposure, the Logs
and Terminal routes — svelte-smol auto-exempts only `text/event-stream`, and
neither of those is SSE, so a quiet container would otherwise have its stream
cut at 10s too. `start` is deliberately not wired, it can't reach 10s.
`tests/unit/app/long-request.test.ts` guards the `0`.

## OpenAPI (`$lib/openapi/`, `$lib/server/validation/api.ts`)

`GET /api/v1/openapi.json` serves a real OpenAPI 3.1 document, generated (not
hand-written) from `$lib/openapi/build.ts` + `registry.ts`. Request bodies are
the _actual_ zod schemas that validate each request at runtime
(`$lib/server/validation/api.ts`,
`createServiceApiBody`/`updateServiceApiBody`/`createStackApiBody`, imported by
both the route files and `registry.ts`), converted to JSON Schema via zod v4's
native `z.toJSONSchema()`, one schema instance drives both validation and docs,
so they can't silently drift apart the way a hand-maintained spec would.
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
Keep it in sync when a route's shape changes. `RouteDef.queryParams` (a
`ParamDef[]`, same shape as `pathParams`) is what the three paginated list
routes above use to document `page`/`perPage`/`q` (`registry.ts`'s shared
`listQueryParams` array); `build.ts` emits both `pathParams` and `queryParams`
as `in: "path"`/`in: "query"` OpenAPI parameters on the same operation.

**`drizzle-zod` was tried and abandoned** for the response side: it depends on
`zod/v4`'s subpath export, which resolves fine standalone, but broke under this
repo's Bun install layout with `Cannot find package 'drizzle-orm'` from inside
`drizzle-zod`'s own resolved location, looks like a peer-dependency resolution
quirk specific to Bun's global-cache-backed install strategy, not investigated
further. Hand-mirroring the response schemas avoided it entirely rather than
fighting the resolution issue.

**Verified live**: the served document is a real, valid OpenAPI 3.1 spec, parsed
successfully by `openapi-typescript` (not just eyeballed), used to generate the
actual types `packages/cli/` is built against (see below), and driven end-to-end
through a real account/API key against a real Docker daemon (see
`packages/cli/README.md`'s verification notes).

## Homerun CLI (`packages/cli/`)

A standalone Bun/TypeScript sub-project under `packages/` (compiles to a binary
via `bun build --compile`, same shape as `packages/agent/`/`packages/installer/`
below, sharing the root `package.json`/`bun install` rather than having its
own), a typed CLI built on
[`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) against the spec above.
`packages/cli/generated/openapi-types.ts` is generated by `openapi-typescript`
straight from a running instance's real `/api/v1/openapi.json` (the root
`bun run gen`, which also regenerates `openapi.json` and `homerun.schema.json`
and runs as part of `build:app`; checked in as a snapshot, regenerate after any
REST API route change or it silently goes stale, `openapi-fetch` itself has no
way to detect a stale-spec mismatch at compile time). Auth is
`x-api-key`/`--api-key`, same header the REST API's own hooks check first for a
non-cookie caller. Commands: `services {list,get,deploy,start,stop,restart}`,
`stacks list`, `templates list`, no `create`/`update`/`delete` yet,
straightforward to add the same way. See `packages/cli/README.md` for the full
command reference and what's verified.

Every `list` command also takes `--page <n>`, `--per-page <n>` (default 100, max
100, same clamp as the API) and `--search <term>`, threaded through as the same
`page`/`perPage`/`q` query params the REST API's `GET` list routes accept (see
REST API and Server-side list pagination above). `commands.ts`'s `ListArgs`
interface (`json`/`page`/`perPage`/`search`) replaced the old bare
`json: boolean` parameter every `*List` command took;
`Output.printPageFooter(response, shown)` reads the `x-total-count`/`x-page`/
`x-per-page` response headers and prints
`Showing 10 of 60 (page 1 of 6). Use --page/--per-page for the rest.` whenever a
listing was truncated, silent when the whole set fit, so a partial result can't
be mistaken for a complete one. Default behavior is unchanged (100/page), so a
plain `homerun services list` on a normal instance looks exactly as before.

**Verified live, full round trip**, not just typechecked: a throwaway account +
real API key (against an isolated `homerun_test` database, never the
maintainer's real one) drove every command against a real Docker daemon,
`services list`/`get`/`deploy` (a real `nginx:alpine`
pull→create→start)/`start`/`stop`/`restart`, plus the 401-on-bad-key path, all
through the typed `openapi-fetch` client, and the compiled binary behaves
identically to running from source. The pagination flags were verified the same
way on a 60-service database: the compiled CLI printed the truncation footer for
`--per-page 10` and `--per-page 10 --page 3`, and `--search svc-58` returned the
single matching row.

`homerun login`'s device-code flow is now verified live too (previously flagged
as untested, closed in a later session): a real compiled CLI binary, installed
via `packages/cli/install.sh` inside a Linux Docker container, ran
`homerun login --base-url <real installer-provisioned instance>`, printed a real
user code, was approved via the real `/cli-auth` approval-page form action as
the real signed-in admin, and picked up a real API key, saved to
`~/.config/homerun/config.json` at mode `0600`. This run is also what surfaced
and fixed a real routing bug in `src/hooks.server.ts`:
`POST /api/v1/auth/cli/{device,token}` weren't in `authHandler`'s
`customAuthPaths` allowlist, so both 404'd before ever reaching their real
SvelteKit route files, swallowed by better-auth's own catch-all handler for
anything under its `/api/v1/auth` basePath. Fixed by adding both paths alongside
the pre-existing `/api/v1/auth/providers` entry.

The CLI also has a standing end-to-end suite, `tests/e2e/ui-cli.spec.ts`, which
runs it against the Playwright suite's built app on every E2E run (device login
approved in a real browser, every list/get command, overrides, 401/404 exits,
logout), see `.agents/notes/testing.md`.

## API Docs page (`(protected)/api-docs/`)

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
initialization itself wasn't verified in a real browser (the Playwright suite
that now exists, see below, doesn't cover this page), just that nothing crashes
and the wiring (dynamic import location, CSS import, container ref) matches
Swagger UI's own documented embed pattern.
