# E2E tests

Real Playwright tests driving a real Chromium browser against a real, built
Homerun instance backed by a real, throwaway Postgres container — the one
genuinely client-side-interactive gap neither `tests/unit/` (bun:test, no
browser) nor `tests/integration/` (real HTTP/`fetch`, no browser, see that
suite's own README's "Not covered by this suite") exercises. A prior session
removed this repo's previous E2E harness deliberately (see
`tests/integration/README.md`'s note and CLAUDE.md's own "No E2E/browser test
harness" section); this rebuilds it from scratch rather than resurrecting
anything.

Run with `bun run test:e2e` (`bunx playwright test` also works — this suite
isn't part of `bun run test`'s `bun test` invocation, Playwright is its own
runner). Requires a reachable Docker daemon, same as `tests/integration/`, for
the throwaway Postgres container, and a Chromium build
(`bunx playwright install chromium` if the very first run reports one missing).

## Why bootstrap runs as a separate Bun child process

Playwright's own CLI (`node_modules/.bin/playwright`) has a
`#!/usr/bin/env node` shebang, so even `bunx playwright test` runs the actual
test-runner process, and therefore `playwright.config.ts`'s `globalSetup`, under
plain Node.js, not Bun — verified live: `globalSetup` importing anything from
`tests/integration/support` directly failed with `Cannot find package 'bun'`,
since that support code uses `Bun.SQL`/ `Bun.spawn` throughout. Rather than
rewrite that (already-proven, shared) support code to be Bun-agnostic,
`support/global-setup.ts` spawns `support/bootstrap-runtime.ts` as a genuine
`bun run` child process instead — that file does the actual work (start
Postgres, migrate, `bun run build:app`, spawn the built app), prints one
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
per test, since spinning up a fresh Postgres container per spec would slow this
down considerably for little benefit here. Write specs with that in mind: create
a fresh account (or otherwise-unique data) per spec file rather than assuming a
clean slate, and see `bootstrap.spec.ts`'s own `test.describe.serial` for how to
depend on ordering _within_ one file explicitly rather than relying on
Playwright's default (unordered) execution.

## Coverage

- [x] Blank instance → `/` redirects to `/auth/sign-up` (bootstrap-admin
      sign-up, not sign-in)
- [x] Filling in and submitting the real sign-up form creates the first (admin)
      account and lands on `/onboarding`, not the dashboard directly (the forced
      first-run wizard, see CLAUDE.md's Onboarding section)
- [x] Once an account exists, `/auth/sign-up` redirects to `/auth/sign-in`
      instead, for any visitor, not just an already-authenticated one
- [ ] The onboarding wizard itself (stepper navigation, validation, finishing
      it) — not yet covered
- [ ] Sign-in with a real password, sign-out — not yet covered
- [ ] Anything past onboarding (service create/deploy, the dashboard proper) —
      not yet covered, and notably needs a reachable Docker socket from _inside_
      the spawned app process for a real deploy, which this suite's bootstrap
      doesn't currently wire up (`tests/integration/`'s own `spawnApp` doesn't
      either, by design, that suite drives the API directly rather than through
      a browser)

Extend `bootstrap.spec.ts` or add new files here rather than duplicating
`tests/integration/`'s own API-level coverage — this suite's job is specifically
the client-side-interactive parts (`$state`/`$derived` reactivity, client-side
`goto()` redirects, real form submission), not re-proving the API shapes that
suite already covers directly and faster.
