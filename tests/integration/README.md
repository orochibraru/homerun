# Integration tests

`bun test` (or `bun run test`, its package.json alias) runs **the whole suite**
— `agent`/`cli`/`installer` (fast) _and_ this one — in a single command, no
wrapper script. `tests/integration/support/setup.ts` is wired in natively via
`bunfig.toml`'s `[test].preload`, and registers global `beforeAll`/`afterAll`
hooks (bun:test's own run-wide-fixture mechanism, not a bespoke
top-level-await-plus-signal-handlers script) that, once per run:

1. Start a fresh, throwaway `postgres:18-alpine` container on a random host port
   (`support/postgres-container.ts`) — not a shared/fixed-port dev instance, so
   two runs of this suite (two terminals, two CI jobs, a local run next to CI)
   never collide.
2. Run the real `drizzle/` migrations directly against it
   (`support/migrate.ts`), as an explicit, visible step — separate from (but
   consistent with) the spawned app's own idempotent boot-time migration.
3. Build the real app (`bun run build:app`) and boot it as a real child process
   on another random port.
4. Spawn a real Homerun Agent and a real second Docker connection (`socat`),
   each on their own random port too.
5. Bootstrap the first (admin) account, mint a real API key, register both
   remote-host kinds, build the git-build fixture repo.

No mocks, no in-process shortcuts, and — because every port is resolved fresh
per run — no fixed ports anywhere in this suite to collide on. Only runs any of
this when the current `bun test` invocation actually includes an integration
test file (an argv check in setup.ts) : `bun test tests/agent` (and
`test:agent`/`test:cli`/`test:installer`) skip it entirely and stay fast.
Requires a reachable Docker daemon and `socat` on `PATH` (`brew install socat` /
`apt-get install -y socat`) ; wired into CI as-is,
`.github/workflows/code_quality.yaml`'s `ts` job needs no `services:` block for
Postgres any more (the suite manages its own container directly against the
runner's own Docker daemon), just the `socat` install step and the same
`bun run test` the fast suites already ran.

**Real, previously-undiscovered production bugs found purely by building and
running this suite** (not test-harness artifacts — all three were fixed at the
source, not worked around here):

- `apiKey()`'s own default rate limit (10 requests per _24 hours_ per key,
  independent of better-auth's general `rateLimit` option) silently 401'd the
  REST API/CLI after ~10 calls on any one key — fixed in
  `src/lib/services/auth.ts` (300/min).
- `GET /services/{id}` returned the raw, possibly-stale DB row instead of
  reconciling `currentStatus` against live Docker/agent state the way the
  dashboard's own page load already does — a stop/start via the REST API never
  became visible to a polling API consumer. Fixed by adding the same
  `DockerService.syncServiceStatus` call the dashboard's own
  `[serviceId]/+layout.server.ts` already makes.
- `POST /services` validated `buildSource`/`gitUrl`/`gitRef`/
  `gitBuildContext`/`gitDockerfilePath` but never actually passed them to
  `ServiceDTO.create()`, so a git-mode create via the REST API (or the CLI, once
  it grows a `create` command) silently created an image-mode service with an
  empty image ref instead — the git-build deploy then failed with a confusing
  daemon-level error (`Get "http:": http: no Host in request URL`) that pointed
  nowhere near the real cause. Fixed in `src/routes/api/v1/services/+server.ts`.

## Coverage checklist

Not tracked as a `bun test` coverage percentage — the app runs as a spawned
child process (a deliberate choice, see the plan this suite was built from), so
Bun's own coverage instrumentation can't see code executing in a different OS
process. Tracked here instead, by scenario/endpoint.

### Service deployment (the core target)

- [x] Image-mode deploy, local target, no project
- [x] Image-mode deploy, local target, inside a project
- [x] Git-build deploy, local target (real `git clone`, local fixture repo)
- [x] Env vars land in the deployed container
- [x] Deploy to a `docker`-kind remote host (real second daemon connection)
- [x] Deploy to an `agent`-kind remote host (real spawned agent)
- [x] Start/stop/restart lifecycle, local target
- [x] Start/stop lifecycle, agent target (the exact "silently used the local
      socket instead" bug class this session found is what this guards)
- [x] Bad/nonexistent image fails with a real, non-empty error message, not
      silently
- [ ] `networkMode: "host"` vs `"bridge"` — not yet covered
- [ ] cpu/memory limits — not yet covered
- [ ] Custom domain — not yet covered
- [ ] Autoscale-eligible toggle — not yet covered
- [ ] Git-build with build server = a _different_ agent host than the deploy
      target (the cross-host publish path, needs a disposable S3-compatible
      cache registry endpoint) — not yet covered, flagged as a real gap rather
      than silently skipped
- [ ] `PATCH /services/{id}` field-by-field coverage (only `remoteHostId` is
      exercised so far)

### REST API surface

- [x] `POST /services`, `GET /services/{id}`, `PATCH /services/{id}`
      (`remoteHostId` and plain fields like `name`/`envVars`),
      `POST /services/{id}/deploy`, `/start`, `/stop`, `/restart`,
      `DELETE /services/{id}` (asserted directly : 204, then a 404 on the next
      `GET`, not just relied on via cleanup)
- [x] `POST /projects`, `GET /projects`, slug-conflict 409
- [x] `GET /templates`
- [x] `GET /system-stats`
- [x] `GET /openapi.json` (public, real valid OpenAPI 3.1)
- [x] `POST /api/v1/auth/sign-up/email` (bootstrap-once guard)
- [x] Unauthenticated request → 401
- [x] Bad API key → 401 (not a crash)
- [x] Foreign/nonexistent resource id → 404, not 403

### Not covered by this suite (deliberately, see tests/app/ instead)

UI/component behavior and anything client-side-interactive : that's
`tests/app/`'s job (component testing + Playwright E2E), tracked in `TODO.md`,
not duplicated here.
