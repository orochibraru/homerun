# Testing

Homerun reference notes, loaded on demand rather than every session. `CLAUDE.md`
holds the rules that always apply plus an index of the sibling notes in this
directory. These sections were split out of that file, so a "see X below/above"
in the text below may now point at a section living in a sibling note rather
than in this one.

## Unit tests (`tests/`)

`bun:test`, run directly by Bun — `bun test --timeout 120000` (every
`test`/`test:*` script passes `--timeout` explicitly since `bunfig.toml`'s
`[test].timeout` key is silently unhonored on Bun 1.4.0). Covers
`packages/agent/`, `packages/installer/`, and `packages/cli/`. Tests live under
`tests/unit/<package>/`, not next to the source files they cover
(`tests/unit/agent/token.test.ts` tests `packages/agent/token.ts`, etc.).
`tests/unit/app/` covers the SvelteKit app itself, a couple of component tests
plus the pure modules under `$lib` that are worth pinning down directly
(`long-request.test.ts`, see Long-running requests below; `queue.test.ts`;
`toast.test.ts`; `compose-import.test.ts`; `service-link.test.ts`;
`deploy-phases.test.ts`; `command-parse.test.ts`; `auth-providers.test.ts`;
`app-gate.test.ts`, the login wall's token signing/expiry/tampering, its cookie
parsing, and OIDC group-claim extraction) : anything that's a real transform
with no DB or Docker dependency belongs here rather than in
`tests/integration/`, which is still where most of `src/` is exercised.

Run everything: `bun run test` (bare `bun test` also works, no wrapper script —
`bunfig.toml`'s `[test].preload` handles the rest). Scoped: `bun run test:unit`,
`test:unit:agent`, `test:unit:app`, `test:unit:cli`, `test:unit:installer`,
every one of which also sets `HOMERUN_SKIP_INTEGRATION_SETUP=1` so the preloaded
integration bootstrap (real Postgres container) doesn't run for a unit-only
invocation. `tests/integration/` is a separate suite with its own
`beforeAll`/`afterAll` (real Postgres/Docker/agent, see
`tests/integration/README.md`), and `tests/e2e/` is a third, Playwright, outside
`bun test` entirely (see E2E browser tests below). `tests/README.md` is this
section's counterpart living next to the code.

**Where Postgres comes from, `HOMERUN_TEST_POSTGRES_URL`.**
`tests/integration/support/postgres.ts`'s `startTestPostgres()` is the one entry
point both `tests/integration/` and `tests/e2e/` resolve their database through,
and it branches on that env var alone: **set** (CI, where
`.github/workflows/code_quality.yaml`'s `ts-test` and `e2e` jobs each declare a
job-level `services: postgres:` container) means connect to that server and
`create database` a uniquely-named per-run database on it, dropped
`with (force)` in teardown; **unset** (local dev, the default) means the
original behavior, a throwaway `postgres:18-alpine` container this suite
`docker run`s itself on a random host port (`support/postgres-container.ts`,
still the fallback, not dead code). Two reasons for the CI half, both about the
job no longer racing its own container: the runner pulls the service image and
gates every step behind its `pg_isready` health check before our code runs at
all (the inline `docker pull` eating the readiness budget on a cold runner is a
real, previously-observed CI failure documented in `postgres-container.ts`), and
a fresh database name per run is what makes the workflow's `nick-fields/retry`
re-attempts meaningful — attempt 2 gets an empty database on the same
still-running service container instead of inheriting attempt 1's
already-bootstrapped admin account. The deploy tests still need a real Docker
daemon either way; only Postgres moved. Verified live, both paths: the full
integration suite and the full Playwright suite each pass against a stand-in
service container (twice back to back, the retry case, no leaked databases) and
against the local `docker run` fallback.

**Vitest was tried and abandoned for this suite.** It fixed the `[test].timeout`
bug above (real `hookTimeout`/`testTimeout` config) and gave each test file its
own module registry (no more `mock.module` leaking across files). But
`coverage.provider: "v8"` crashes under Bun once coverage from more than one
test file needs merging — `@bcoe/v8-coverage`'s recursive merge throws
`RangeError: Maximum call stack size exceeded`, reproduced directly, confirmed
independent of provider (`istanbul` avoided it, `v8` didn't). Given that, plus
`bun:test` being the simpler/native option, the suite moved back. `mock.module`
mutating one process-global registry is a real, accepted tradeoff again — see
`tests/unit/agent/docker.test.ts` (mocks `"dockerode"` wholesale) and
`tests/unit/agent/http.test.ts` (spies on individual `DockerService` methods via
`spyOn`, restored with `mock.restore()`), which have to coexist in one process
without colliding.

`tsconfig.json` excludes `tests/` from `svelte-check` (`check:app`) —
`bun:test`'s `mock()` return type hits real overload-resolution errors under
svelte-check's TS resolution that don't occur under `tsc`/`bun test` directly.
`tests/` is type-checked per-package instead (`check:agent`/`check:cli`/
`check:installer`, `bun-types`, not svelte-check's DOM-flavored config).

## `packages/cli/` tests need a mocked `os.homedir()`

`packages/cli/config.ts` resolves its config file path from `os.homedir()` once,
at module load, and `os.homedir()` is fixed for the life of the process
(reassigning `process.env.HOME` mid-run doesn't change it, verified on Bun
1.4.0). `tests/unit/support/homedir-preload.ts`, wired in via `bunfig.toml`'s
`[test].preload`, mocks `node:os`'s `homedir()` to a scratch directory for the
whole run via `mock.module`, before any test file's own imports — the one place
guaranteed to run early enough regardless of which file imports
`packages/cli/config.ts` first. Every test file that touches
`packages/cli/config.ts` still guards against this invariant breaking:

```ts
if (!homedir().startsWith(tmpdir())) {
  throw new Error(
    "... refusing to risk touching the real ~/.config/homerun ...",
  );
}
```

## Coverage

`bunfig.toml`'s `[test].coverage = true` turns on Bun's native coverage for
every run, scoped away from `tests/**` and `packages/cli/generated/**`. No
threshold enforced yet.

## Retries (`bunfig.toml`'s `[test].retry`)

`retry = 2` retries a failing test up to 2x (3 attempts total) before it's
reported failed, to absorb transient CI flakiness (real Postgres/Docker in
`tests/integration/`). Unit and integration are the only suites this governs,
`test:e2e` is Playwright and `e2e:multipass` is its own script, neither reads
`bunfig.toml`. `beforeEach`/`afterEach` **do** re-run around each retry attempt
(verified, only `beforeAll`/`afterAll` stay once-per-file), so a test that
cleans up per-test gets a genuinely fresh attempt rather than inheriting the
failed one's leftovers.

`[test].rerunEach` (run every test file N times, to surface a flake rather than
hide one) is the opposite policy and **cannot be combined with `retry`**, Bun
1.4.0 hard-errors (`"retry" cannot be used with "rerunEach"`) when both are set,
whether both are in this file or split across the file and a CLI flag. Running
it therefore needs a separate config file (`bun test --config=<file>`, which
replaces `bunfig.toml` rather than merging with it), which is why there's no
rerun policy checked in here.

## Fakes over mocking libraries

Where a function takes a `StepRunner`-shaped collaborator
(`packages/installer/exec.ts`) or a small client object, tests pass a plain
object literal with `mock()`-wrapped methods instead of instantiating the real
class. See `tests/unit/installer/network.test.ts` / `release.test.ts` /
`full-stack.test.ts` / `agent-step.test.ts`.

## Real bugs this suite caught

- `Bun.write(path, data, { mode: 0o600 })`'s `mode` option is silently a no-op
  on Bun 1.4.0 — the file lands with whatever the umask produces (0644 under the
  common 022 umask) regardless of what's passed. `packages/agent/token.ts`'s
  persisted agent token — a full-access API credential — was affected by exactly
  this. Fixed by calling `node:fs/promises`'s `chmod()` explicitly after
  `Bun.write` (`node:fs`'s own `mode` option is honored, verified). If a future
  change writes another secret to disk via `Bun.write`, `chmod` afterward too.
- `bunfig.toml`'s `[test].timeout` key is silently not honored by Bun 1.4.0 for
  `test()` bodies — every `test/test:*` script passes `--timeout 120000` on the
  CLI instead.
- `[test].retry` genuinely is honored (verified: a test failing on attempts 1-2
  and passing on 3 reports as 1 pass under `retry = 3`, no CLI flag needed), but
  `[test].rerunEach`'s config key is camelCase only, the CLI flag's own spelling
  (`rerun-each`, kebab-case) is silently ignored as a bunfig key, same failure
  mode as `[test].timeout` above just for a different key. See Retries below.
- Bun's `Bun.serve()` `idleTimeout` (10s by default, and what
  `@orochibraru/svelte-smol` ships) kills a request that's still _being
  handled_, not just an idle socket, and only on Linux — so
  `POST /services/<id>/stop` died with `ECONNRESET` in CI while passing on every
  macOS dev machine. Caught by `tests/integration/`, root-caused by reproducing
  it in `oven/bun:1.4.0`. See Long-running requests and Bun's idle timeout
  below.

This section is scoped to what `tests/` itself caught; a sibling finding from
the same "Bun's own APIs quietly diverge from `node:fs`" family, but caught by
manual live installer testing rather than this suite, lives in
`packages/installer/steps/rootless-docker.ts`'s own doc comment instead:
`Bun.file(path).exists()` can return `true` for a `/proc` pseudo-file while
`.text()` silently returns `""`, `node:fs/promises`' `readFile` reads it
correctly. See Homerun Agent + installer below.

## E2E browser tests (`tests/e2e/`, `playwright.config.ts`)

**This repo has a real browser harness again** (an earlier session deleted the
previous one in `feat: better classes`, `87c925d`, and this document said for a
while that none existed, that's stale, it was rebuilt from scratch rather than
un-deleted). Real Playwright driving real Chromium against a real _built_ app
(`bun run build:app` first, this suite doesn't build for you) backed by a
throwaway Postgres container, run with `bun run test:e2e`, deliberately outside
`bun run test`, Playwright is its own runner and `bunfig.toml`'s retry/coverage
settings don't reach it. See `tests/e2e/README.md` for the full detail; the
load-bearing parts:

- **`globalSetup` runs under Node, not Bun.** Playwright's CLI has a
  `#!/usr/bin/env node` shebang, so even `bunx playwright test` runs the config
  and its `globalSetup` under Node (verified: importing
  `tests/integration/support` there fails with `Cannot find package 'bun'`, that
  code uses `Bun.SQL`/`Bun.spawn` throughout). `support/global-setup.ts`
  therefore spawns `support/bootstrap-runtime.ts` as a genuine `bun run` child
  process, which starts Postgres, migrates, spawns the built app, prints one
  `READY <json>` line once `/api/health` answers, and stays alive until it's
  SIGTERM'd at teardown.
- **Fixed port, one shared app instance.** Playwright reads `use.baseURL` at
  config-load time, before a `globalSetup` could resolve a free port the way
  `tests/integration/` does, so the port is fixed (`support/config.ts`) and
  `workers: 1`/`fullyParallel: false` share one live app+database across every
  spec. Don't run this suite twice concurrently on one machine, and create a
  fresh account per spec file rather than assuming a clean slate (see
  `bootstrap.spec.ts`'s `test.describe.serial` for depending on order _within_ a
  file).
- **Auth rate limiting is disabled for it** (`HOMERUN_DISABLE_AUTH_RATE_LIMIT=1`
  on the spawned app), see Auth below for the real finding behind that.
- **`bunfig.toml` excludes it from `bun test`**
  (`pathIgnorePatterns = ["**/tests/e2e/**"]`), these specs match `bun test`'s
  own `*.spec.ts` discovery and would otherwise be picked up and fail there.
- **`E2E_IMAGE` runs the suite against a built Docker image instead of the local
  `build/server` binary** (`tests/integration/support/app-container.ts`'s
  `startAppContainer`, chosen by `bootstrap-runtime.ts` when the variable is
  set). This is how CI tests the exact artefact it is about to publish rather
  than a second build of the same source, see the CI pipeline note under Release
  automation below. Everything else about the harness is unchanged : the same
  throwaway Postgres, the same migrations, the same fixed port, the same
  health-check wait. Two details are load-bearing : the container's
  `DATABASE_URL` has `localhost`/`127.0.0.1` rewritten to `host.docker.internal`
  (a container's own `localhost` is itself, not the host) and it is started with
  `--add-host=host.docker.internal:host-gateway` so that name resolves on Linux
  too, not just Docker Desktop; and `assertAppIsBuilt()` is skipped in image
  mode, since there is no local build to assert on. The container also runs
  under a **fixed** name (`homerun-e2e-app`), removed before each start rather
  than given a unique one : a container left behind by a crashed or killed run
  otherwise holds the suite's fixed port forever, and CI's three whole-suite
  retries all failed on
  `Bind for 0.0.0.0:4310 failed: port is already allocated` before the app could
  even start. Safe for the same reason the port is fixed, this suite already
  can't run twice concurrently on one machine. **Verified live**: the full suite
  against a locally-built `app` image passes 23/23, and passes again with a
  leaked container already holding 4310, which is the retry case that was
  failing.

Covered today: blank-instance bootstrap sign-up landing on `/onboarding`, the
sign-up→sign-in redirect once an account exists, clicking the whole onboarding
wizard through to completion, sign-in/sign-out, the service-creation wizard's
own submit path, (`remote-functions.spec.ts`) the remote-query/command surfaces,
that the dashboard's Host Resources panel, the notification feed and the
job-queue panel each resolve past their skeleton against real data, and that a
mark-read/delete command updates the feed with no page reload, and
(`ui-login-wall.spec.ts`) the Authentication page's presets and the service
Access section's reveal-and-validate behaviour, and (`ui-form-state.spec.ts`)
that a saved settings section keeps its field values and that the compose-import
page's Import step accepts the file its own Parse step previewed, the two halves
of the `reset` bug under Conventions above. Not covered by the specs above: a
real deploy (the screenshot pipeline below does one, on purpose, and is the only
thing here that touches Docker). Add browser-level cases here; don't re-prove
API shapes `tests/integration/` already covers directly and faster.

## Screenshots for the docs (`tests/e2e/screenshots/`, `bun run screenshots`)

The images in `docs/images/`, which `docs/showcase.md` and the README's hero
both publish, are **generated, not taken by hand** : `bun run screenshots` runs
`tests/e2e/screenshots/docs-screenshots.spec.ts` through
`playwright.screenshots.config.ts`. It reuses the E2E harness above (same
`globalSetup`, same throwaway Postgres, same fixed port, same
`bun run build:app` prerequisite) but has its own config so the ordinary
`bun run test:e2e` doesn't shoot screenshots on every run :
`playwright.config.ts` carries `testIgnore: "screenshots/**"` for exactly that
reason, and the screenshot config's `testDir` points at the subfolder.

- **It signs in once.** The bootstrap test saves `storageState` to
  `test-results/screenshots-auth.json` and every later test runs under
  `test.use({ storageState })`. Signing in per test meant ~26 sign-ins inside
  two minutes and produced its own flake (a sign-in that silently didn't
  navigate, failing whichever shot drew it). The sign-in shot itself sits
  outside that describe, so it gets a clean signed-out context.
- **It bootstraps its own world.** A blank instance means signing up, clicking
  through onboarding (with Base domain set to `example.com`, so the hostnames in
  the shots read like a real deployment rather than `127.0.0.1`), then seeding a
  project and three services through `POST /api/v1/projects` and
  `POST /api/v1/services` : `page.request` shares the browser context's cookie
  jar, so the session authenticates the API calls with no key to mint.
- **Two of those services are really deployed**, through
  `POST /api/v1/services/:id/deploy`, which is what makes the dashboard, the
  status pills, the deployment history and the live log viewer show real state
  instead of empty states. That works because the default harness spawns the app
  as a **local process** sharing the host's Docker daemon. It would not work
  under `E2E_IMAGE`, where the app runs in a container with no socket mounted :
  don't set that variable for this pipeline.
- **It cleans up after itself in `afterAll`, not in a final test.** Playwright's
  serial mode skips the rest of the file after a failure, so a teardown written
  as the last `test()` leaks the containers _and_ the project's Docker network
  the moment any single shot fails — which is the exact leak behind "Reclaim
  project networks whose project row is gone" in `TODO.md`. `afterAll` runs
  either way. (The project is deleted by POSTing its `?/delete` form action with
  an `x-sveltekit-action` header, since projects have no REST DELETE.)
- **Dark mode is `page.emulateMedia({ colorScheme })`**, which works only
  because the account's theme preference defaults to `system` and the browser
  context is fresh, so `mode-watcher` has no `localStorage` override to prefer.
  If a shot ever needs a signed-in account with an explicit theme, set that
  entry instead.
- **Don't wait on `networkidle`** anywhere in these specs. The dashboard polls
  stats every 5s and the log viewer holds an SSE connection open, so it never
  settles; the spec waits on `domcontentloaded` plus a fixed beat.
- Each shot asserts its own URL and a page-specific string before the shutter,
  so a redirected, blank or broken screen fails the run rather than being
  published as marketing. Adding a shot means adding one entry to `SHOTS` and a
  section to `docs/showcase.md`; `docs/images/README.md` is written by the run
  itself.

**In CI it runs two ways, and only one of them commits.** `screenshots.yaml` is
a `workflow_call` job wired into `pull_request.yaml` (off `code_quality`, in
parallel with the image builds): it builds from source, pre-pulls the two images
the seed deploys, captures everything and uploads `docs/images` as an artefact.
It proves the generator still works and is the only job in CI that performs a
**real deploy** — `e2e.yaml` can't, because it runs the app as a container with
no Docker socket. It does **not** commit anything. The capture step is wrapped
in `nick-fields/retry` for the same reason `e2e.yaml`'s is: one run in six
against a shared Postgres failed at the seeding step and passed on every re-run.
`screenshots-refresh.yaml` (`workflow_dispatch`, `contents: write`) calls that
same workflow, downloads the artefact over `docs/images/`, and commits the
result with `[skip ci]`, then pings the docs site the way `docs-update.yaml`
does — `[skip ci]` stops the push from re-running the whole publish pipeline,
and a `GITHUB_TOKEN` push wouldn't trigger `docs-update.yaml` anyway.

**Refreshing the gallery is deliberate, not automatic, and that's the point.**
The png can't be diffed for drift: the pages carrying live data (the dashboard,
a service's overview, the log viewer) come out byte-different on every single
run — live CPU%, "just now", the container's random name suffix — so ~8 of the
26 files change even when nothing in the app did, and PNG blobs don't
delta-compress. Regenerating on every merge would add megabytes of history for
no signal. Run the refresh workflow when the UI has actually changed.

`docs/images/README.md` is written by the run itself and must come out already
prettier-formatted (the spec hard-wraps its one prose line exactly where
prettier would): a generated file that the pre-commit hook then reformats fights
the next regeneration forever.

**A spec file that signs in as the bootstrap admin must sort after
`onboarding.spec.ts`**, hence the `ui-` prefix on the two that do: Playwright
runs files in discovery order with one shared app, so a spec landing before
onboarding finishes is bounced to `/onboarding` by the layout's own gate.
Anything Docker-touching is still out : importing a compose file into a
_project_ creates a Docker network, so `ui-form-state.spec.ts` imports ungrouped
on purpose.
