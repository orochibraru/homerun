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

Handlers don't check write permission themselves: `hooks.server.ts` refuses any
non-GET request from a read-only caller (the `viewer` role or a read-scoped API
key) with a JSON `403` before the route runs, see `auth.md`'s Read-only role
section. `$lib/openapi/build.ts` adds that `403` to every non-GET operation
automatically, so a new write route documents it without a registry entry.

- `services/`, `GET` list, `POST` create (zod-validated body, not the
  FormData-shaped schema `$lib/server/validation/service.ts`, that one's
  checkbox/`envKey[]`/`envValue[]` preprocessing is form-specific).
- `services/[serviceId]/`, `GET`, `PATCH` (partial update; `registryPassword` in
  the body re-encrypts, omitted means unchanged; changing the git source fields
  re-syncs the push webhook, see below), `DELETE` (`?force=true`,
  `ServiceLifecycleService.deleteService`, same contract as the Settings
  danger-zone action: a workload removal failure 409s with `{error}` and deletes
  nothing unless `force`).
- `services/[serviceId]/webhook/`, `GET`, the push-to-deploy webhook's URL,
  secret and registration status (`GitWebhookService.describe`); 404 when
  `autoDeployOnPush` is off. See Push-to-deploy in `services-and-templates.md`.
- `services/[serviceId]/{deploy,start,stop,restart}/`, `POST`. `deploy` awaits
  the full pull→create→start pipeline via `deployService()` (see below) and
  returns once it's done, no separate polling endpoint for API clients (the
  dashboard's own progress-polling UI is unrelated, cookie-session only).
- `services/[serviceId]/scans/`, `GET` (paged `ImageScanDTO.toSummary()`s,
  newest first, no `findings`), `POST` (queues `ImageScanService.enqueueScan`,
  202 `{jobId, status}`; 400 when neither `containerId` nor `swarmServiceId` is
  set, same guard as the Security tab's `scan` action; 409 `{error, jobId}` when
  `JobDTO.findActive("image_scan", "image_scan:<id>")` finds one, where the tab
  itself just coalesces through the queue's dedupe key, since an API client
  wants to know it didn't start a new one). `scans/latest/` and
  `scans/[scanId]/`, `GET`, the full row with `findings`; `latest` 404s with
  "This service hasn't been scanned yet." Every scan query goes through
  `ServiceDTO.get(serviceId)` first, so an unknown service 404s.
- `jobs/[jobId]/`, `GET`, a trimmed job row (no `payload`) for polling a queued
  job, any account's job (resources are shared), 404 for an unknown id. Exists
  for `homerun services scan --wait`, generic on purpose.
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
- `auth-token/`, `DELETE`, revokes the API key that authenticated the request
  itself (`CliAuthService.revokeApiKey`, deletes the `apikey` row directly since
  better-auth's own `POST /api-key/delete` needs a session an API-key-only
  caller doesn't have), `homerun logout`'s server-side counterpart to clearing
  `~/.config/homerun/config.json`. Deliberately **not** under `/api/v1/auth/`:
  `hooks.server.ts`'s `customAuthPaths` routes everything there to better-auth's
  own catch-all first, which 404s an undeclared path, the same real bug the
  CLI's device-code endpoints hit (see below). `400` when the request wasn't
  API-key-authenticated at all.
- `webhooks/git/[serviceId]/`, `POST`, public/unauthenticated: where a git
  provider delivers push events for push-to-deploy
  (`GitWebhookService.handleDelivery`), signature-verified per service rather
  than session/API-key gated, exempted from `csrfHandler` since some providers
  post form bodies. See Push-to-deploy in `services-and-templates.md`.

`GET /api/health` sits outside `v1/` entirely, a one-line unauthenticated
`new Response("OK")` used as a readiness probe (the compose healthcheck, and
`tests/e2e/`'s bootstrap waiting for the spawned app), not part of the versioned
API surface or the OpenAPI document.

This is deliberately a thin JSON wrapper over the DTO layer, not a new
abstraction, the `cmd/cli/` sub-project talks to this (see below).

`homerun services scan <id> --wait` polls `GET /jobs/{jobId}` (2s) then reads
`scans/latest`; `--fail-on <critical|high|medium|low>` implies `--wait` and
exits 1 via `Output.fail` when `findingsAtOrAbove(counts, level)` is non-zero,
meant as a CI gate. A 409 is followed (its `jobId`) when waiting, fatal
otherwise. `latest` after the job can in principle be a concurrent deploy's scan
rather than the queued one, accepted, the job result doesn't carry a scan id.

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
actual types `cmd/cli/` is built against (see below), and driven end-to-end
through a real account/API key against a real Docker daemon (see
`cmd/cli/README.md`'s verification notes).

## Homerun CLI (`cmd/cli/`)

A standalone **Go** program, a package in a single Go module at the repo root
(`go.mod`), shared with `cmd/installer/` and `cmd/agent/` (all three now Go, the
agent was the last to be rewritten from Bun/TypeScript, see
`packages-and-release.md`): `check:cli` is `go vet ./cmd/cli/...`,
`test:unit:cli` is `go test ./cmd/cli/...` (`internal/cli/cli_test.go`), and
`scripts/build-packages.ts` builds it with `go build` rather than
`Bun.build({compile: ...})`. **Rewritten from TypeScript** to cut release size:
a `bun build --compile` binary embeds the whole Bun runtime (~81MB on linux/x64,
same size as a hello-world; `strip`/`--bytecode` changed nothing), the Go binary
is ~6MB. It hand-rolls arg parsing and uses Go's stdlib `net/http` rather than
Commander/`openapi-fetch`, and has no generated types at all: it defines small
structs for only the fields it formats (`commands.go`/`client.go`) and passes
everything else through as raw JSON. `cmd/cli/generated/` is gone; `bun run gen`
still regenerates OpenAPI types (`tests/integration/support/openapi-types.ts`),
but they now feed only `tests/integration/support/client.ts`, not this CLI. Auth
is `x-api-key`/`--api-key`, same header the REST API's own hooks check first for
a non-cookie caller. Commands:
`services {list,get,deploy,start,stop,restart,scan}`,
`services scans {list,get}` (`list` is the group's `isDefault` subcommand, so
`services scans <id>` works), `stacks list`, `templates list`, no
`create`/`update`/`delete` yet, straightforward to add the same way. See
`cmd/cli/README.md` for the full command reference and what's verified.

Every `list` command also takes `--page <n>`, `--per-page <n>` (default 100, max
100, same clamp as the API) and `--search <term>`, threaded through as the same
`page`/`perPage`/`q` query params the REST API's `GET` list routes accept (see
REST API and Server-side list pagination above). `commands.go`'s `ListArgs`
struct (`JSON`/`Page`/`PerPage`/`Search`) replaced the old bare `json: boolean`
parameter every `*List` command took; `printPageFooter(header, shown)`
(`output.go`) reads the `x-total-count`/`x-page`/`x-per-page` response headers
and prints `Showing 10 of 60 (page 1 of 6). Use --page/--per-page for the rest.`
whenever a listing was truncated, silent when the whole set fit, so a partial
result can't be mistaken for a complete one. Default behavior is unchanged
(100/page), so a plain `homerun services list` on a normal instance looks
exactly as before.

**Verified live against the Go binary** (the rewrite session):
`services list`/`get`/`revisions`/`scans list`/`scans get`/`logs --tail` (a real
stream from a running container), `templates list`, `instance status`, `--json`,
`--per-page`, and the 404/400/missing-argument/bad-flag error paths, all driven
against the maintainer's real instance; the whole `tests/e2e/ui-cli.spec.ts`
suite (16 specs: login device flow, deploys, scans, logout revocation) against a
real built app; and the static `linux/amd64` binary running on Alpine (musl, no
glibc) with its `-ldflags` version stamp intact. Two real regressions came out
of that e2e run rather than out of review: a missing positional argument
reported "Not logged in" because the client was resolved before the argument was
checked, and Go's `flag` package stops at the first positional, so
`services scans list <id> --json` silently ignored the flag and printed a table
(`parse()` now resumes after each positional, covered by a unit test).

**Verified live, full round trip** (against the previous, TypeScript
implementation, kept here because it covers deploy paths the Go run reached only
through the e2e suite): a throwaway account + real API key (against an isolated
`homerun_test` database, never the maintainer's real one) drove every command
against a real Docker daemon, `services list`/`get`/`deploy` (a real
`nginx:alpine` pull→create→start)/`start`/`stop`/`restart`, plus the
401-on-bad-key path, and the compiled binary behaved identically to running from
source. The pagination flags were verified the same way on a 60-service
database: the compiled CLI printed the truncation footer for `--per-page 10` and
`--per-page 10 --page 3`, and `--search svc-58` returned the single matching
row.

`homerun login`'s device-code flow is now verified live too (previously flagged
as untested, closed in a later session): a real compiled CLI binary, installed
via `cmd/cli/install.sh` inside a Linux Docker container, ran
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
logout), see `.agents/notes/testing.md`. `homerun logout` now revokes the API
key server-side (`DELETE /auth-token`, best-effort: any error or non-ok response
just means the local logout proceeds anyway) before clearing the local config,
rather than only ever clearing the local file; verified live in that same suite,
which re-uses the revoked key against `GET /services` afterwards and asserts
`401`.

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
