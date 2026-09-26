# E2E tests

Real Playwright tests driving a real Chromium browser against a real, built
Homerun instance backed by a real, throwaway Postgres database — the one
genuinely client-side-interactive gap neither `tests/unit/` (bun:test, no
browser) nor `tests/integration/` (real HTTP/`fetch`, no browser, see that
suite's own README's "Not covered by this suite") exercises. A prior session
removed this repo's previous E2E harness deliberately (see
`tests/integration/README.md`'s note and CLAUDE.md's own "No E2E/browser test
harness" section); this rebuilds it from scratch rather than resurrecting
anything.

Requires `bun run build` run first (this suite doesn't build the app for you), a
Postgres to run against, and a Chromium build
(`bunx playwright install chromium` if the first run reports one missing).
Postgres comes from `tests/integration/support/postgres.ts`, shared with that
suite: a CI service container when `HOMERUN_TEST_POSTGRES_URL` is set (each run
gets its own freshly-created database on it), otherwise a throwaway container
this suite starts on the local Docker daemon. See that suite's README for the
split. Run with `bun run test:e2e` (`bunx playwright test` also works — not part
of `bun run test`'s `bun test` invocation, Playwright is its own runner).

## Why bootstrap runs as a separate Bun child process

Playwright's own CLI (`node_modules/.bin/playwright`) has a
`#!/usr/bin/env node` shebang, so even `bunx playwright test` runs the actual
test-runner process, and therefore `playwright.config.ts`'s `globalSetup`, under
plain Node.js, not Bun — verified live: `globalSetup` importing anything from
`tests/integration/support` directly failed with `Cannot find package 'bun'`,
since that support code uses `Bun.SQL`/ `Bun.spawn` throughout. Rather than
rewrite that (already-proven, shared) support code to be Bun-agnostic,
`support/global-setup.ts` spawns `support/bootstrap-runtime.ts` as a genuine
`bun run` child process instead — that file does the actual work (check the
build exists, start Postgres, migrate, spawn the built app), prints one
`READY <json>` line once the app answers `/api/health`, and stays alive holding
the container/app process open until `global-setup.ts` sends it `SIGTERM` at
teardown.

## Fixed port, not a resolved-free one

`tests/integration/` resolves a fresh random port per run (`support/port.ts`) so
concurrent runs never collide. This suite uses a fixed port instead
(`support/config.ts`) — Playwright reads `use.baseURL` from
`playwright.config.ts` at config-load time, before `globalSetup` (which is what
would otherwise resolve a free port) ever runs, so the two can't agree on a
dynamic value without a second IPC round trip. The tradeoff: don't run this
suite twice concurrently on the same machine.

## One shared app instance across the whole suite

`workers: 1`, `fullyParallel: false` — every spec file in this suite runs
against the _same_ spawned app/database, not an isolated instance per file or
per test, since resolving a fresh Postgres database per spec would slow this
down considerably for little benefit here. Write specs with that in mind: create
a fresh account (or otherwise-unique data) per spec file rather than assuming a
clean slate, and see `bootstrap.spec.ts`'s own `test.describe.serial` for how to
depend on ordering _within_ one file explicitly rather than relying on
Playwright's default (unordered) execution.

## Rate limiting is disabled for this suite

better-auth caps `/sign-in`/`/sign-up` at 3 requests per 10 seconds by default,
independent of this app's own `rateLimit.max`/`window` config.
`bootstrap-runtime.ts` sets `HOMERUN_DISABLE_AUTH_RATE_LIMIT=1` on the spawned
app to avoid tripping it across specs (see `src/lib/services/auth.ts`); never
set in production.

## Coverage

- [x] Blank instance → `/` redirects to `/auth/sign-up` (bootstrap-admin
      sign-up, not sign-in)
- [x] Filling in and submitting the real sign-up form creates the first (admin)
      account and lands on `/onboarding`, not the dashboard directly (the forced
      first-run wizard, see CLAUDE.md's Onboarding section)
- [x] Once an account exists, `/auth/sign-up` redirects to `/auth/sign-in`
      instead, for any visitor, not just an already-authenticated one
- [x] Onboarding wizard: clicking through every step with default values,
      finishing, and `/onboarding` becoming unreachable afterward
      (`onboarding.spec.ts`)
- [x] Sign-in (wrong password rejected, real password succeeds) and sign-out
      (`sign-in-out.spec.ts`)
- [x] The service-creation wizard's own submit path, both the success redirect
      and a validation failure returning to step 1 (`service-wizard.spec.ts`)
- [x] Remote functions (`remote-functions.spec.ts`): the dashboard's Host
      Resources panel, the notification feed and the Scheduling page's job-queue
      panel each resolving past their skeleton against real data, and a
      mark-read/delete command updating the feed with no page reload
- [x] The Authentication page (`ui-login-wall.spec.ts`): every OAuth preset
      offered, and clicking one prefilling a provider row with that product's
      own discovery-URL template
- [x] A service's Access section: policy fields only appearing once the login
      wall is on, and saving it with no sign-in method picked being refused
- [x] The `homerun` CLI (`ui-cli.spec.ts`), see below
- [ ] A real deploy _as a test_ — the screenshot pipeline below does deploy for
      real, but nothing here asserts on it yet

Extend `bootstrap.spec.ts` or add new files here rather than duplicating
`tests/integration/`'s own API-level coverage — this suite's job is specifically
the client-side-interactive parts (`$state`/`$derived` reactivity, client-side
`goto()` redirects, real form submission), not re-proving the API shapes that
suite already covers directly and faster.

## The CLI runs against this same instance (`ui-cli.spec.ts`)

The CLI is a Go program (`cmd/cli/*.go`), so this suite can't run it from source
the way it once ran `bun run cmd/cli/index.ts`: `ui-cli.spec.ts`'s `beforeAll`
compiles it first
(`go build -ldflags "-X github.com/orochibraru/homerun/internal/buildinfo.Version=..."`
into a scratch dir, version-stamped to match `package.json` exactly like
`scripts/build-packages.ts` does), then spawns that real binary against the app
this suite already booted, with a throwaway `HOME` per test so it never reads or
writes a real `~/.config/homerun/config.json`. `HOMERUN_BASE_URL`,
`HOMERUN_API_KEY` and `FORCE_COLOR` are stripped from its environment and
`NO_COLOR=1` is set, keeping every assertion on stdout/stderr free of terminal
escape codes and any real login already on the machine. No key is minted by
hand: the spec drives `homerun login`'s device-code flow for real, reading the
code the CLI prints and approving it on `/cli-auth` in the browser as the
bootstrap admin, then uses the key the CLI saved.

Covered: help, `--version`, "Not logged in" with no config, the CLI's own
missing-argument error (hand-rolled arg parsing, not Commander's, since the CLI
is a Go program), login against an unreachable URL, a denied login (non-zero
exit, nothing saved), an approved login (config saved at `0600`),
`stacks list`/`services list`/`templates list` as tables, `--json`, `--search`,
`--per-page`/`--page` and the truncation footer, `services get`,
`--base-url`/`--api-key` flags and the env vars overriding the saved login, a
bad key exiting 1 with the API's 401, `services get`/`deploy` on an unknown id
exiting 1 with the 404, and `logout`. The stack and services it lists are
created through the REST API with the CLI's own key, since the CLI has no
`create` command. Lifecycle commands (`deploy`/`start`/`stop`/`restart`) are
only exercised on their 404 path : CI runs the app as a container with no Docker
socket, so a real deploy can't be asserted the same way in both places.

`bun run test:e2e tests/e2e/bootstrap.spec.ts tests/e2e/onboarding.spec.ts tests/e2e/ui-cli.spec.ts`
runs just those three specs, which is the minimum it needs. The `ui-` prefix is
for sort order (it signs in as the admin, so it must run after onboarding).

A bad-key call logs an "Invalid API key" warning that shows up in the
dashboard's notification feed, whose text contains "Authentication" : a spec
that runs afterwards and looks a sidebar link up by a partial name will match
both, hence `exact: true` in `ui-login-wall.spec.ts`.

## `screenshots/` is not part of this suite

`screenshots/docs-screenshots.spec.ts` generates the images in `docs/images/`
that `docs/showcase.md` and the README publish. It runs through its own
`playwright.screenshots.config.ts` (`bun run screenshots`) and is excluded from
this one by `playwright.config.ts`'s `testIgnore`, so an ordinary
`bun run test:e2e` never shoots screenshots.

It reuses this suite's bootstrap wholesale, then goes further than any spec
here: it seeds a stack and three services through the REST API (the browser
context's session cookie authenticates them) and **really deploys two of them**
against the host's Docker daemon, which is what puts live statuses, deployment
history and streaming logs in the shots. That only works because the default
harness spawns the app as a local process next to the daemon — don't run it with
`E2E_IMAGE` set, where the app is containerised without the socket. Everything
it creates is removed in `afterAll` (containers, then the stack and its Docker
network) so a failed shot can't leak either.

In CI it runs on every pull request (`.github/workflows/screenshots.yaml`, wired
into `pull_request.yaml` and its gate), which makes it, with `templates/` below,
the only job that does a real deploy — `e2e.yaml` runs the app as a container
with no Docker socket. That run uploads the images as an artefact and commits
nothing. Refreshing what's checked in is a manual `Refresh Screenshots` workflow
dispatch: the shots of pages with live data (dashboard, service overview, logs)
come out byte-different every single run, so regenerating on each merge would
only add megabytes of undeltifiable blobs to the history for no signal.

See `.agents/notes/testing.md` for the rest of the rules that pipeline follows.

## `templates/` is not part of this suite either

`templates/deploy.spec.ts` deploys every built-in template through Quick Deploy
on the host's Docker daemon, waits for each service to report healthy, checks
routed ones answer through a throwaway Traefik, and removes everything before
the next. Its own config, `playwright.templates.config.ts`, excluded here by
`testIgnore`; `TEMPLATES_E2E_ONLY=redis,umami` narrows it to a few. Same
`E2E_IMAGE` caveat as the screenshots. The rules it follows, its skip list and
its CI wiring are in `.agents/notes/testing.md`.
