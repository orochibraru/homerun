# Unit tests

`bun:test`, run directly by Bun (`bun test --timeout 120000` — see the root
`CLAUDE.md`'s note on why `--timeout` is passed explicitly), covering
`packages/agent/`, the one remaining Bun/TypeScript sub-project. Tests live
here, under `tests/unit/<package>/`, mirroring the source tree —
`tests/unit/agent/token.test.ts` tests `packages/agent/token.ts`, etc.
`tests/unit/app/` is component tests for the SvelteKit app itself (a
Svelte-compiling Bun plugin + happy-dom setup, `@testing-library/svelte`), see
its own README. `packages/cli/` and `packages/installer/` are both Go packages
in the repo-root `go.mod` and aren't part of this suite at all: their own tests
are `packages/cli/cli_test.go` and `packages/installer/*_test.go`, run with
`go test ./packages/cli/...` (`bun run test:unit:cli`) and
`go test ./packages/installer/...` (`bun run test:unit:installer`), not
`bun:test`. There used to be a `tests/unit/installer/`, mirroring the same
`packages/agent/` shape, before the installer's Go rewrite moved its tests next
to the Go source.

Run everything: `bun run test` (a bare `bun test` also works for the `bun:test`
half — no wrapper script, `bunfig.toml`'s `[test].preload` handles the rest —
but `bun run test` also runs `go test ./packages/...` afterward, covering both
`packages/cli/` and `packages/installer/`). Scoped: `bun run test:unit`
(agent/app only, no Postgres/Docker needed), `bun run test:unit:agent`,
`bun run test:unit:app`, `bun run test:unit:cli` and
`bun run test:unit:installer` (the Go tests, above, plain `go test`, no Bun
preload involved). See `tests/integration/README.md` for the separate
`tests/integration/` suite, and `tests/e2e/README.md` for the real-browser
Playwright suite (its own runner, `bun run test:e2e`, not part of
`bun run test`'s `bun test` invocation).

## Mocks are process-global

`mock.module(specifier, factory)` mutates one module registry for the whole
`bun test` process — two files mocking the same specifier differently would
collide regardless of run order. `tests/unit/agent/docker.test.ts` (mocks
`"dockerode"` wholesale) and `tests/unit/agent/http.test.ts` (spies on
individual `DockerService` methods via `spyOn`, restored with `mock.restore()`
in `afterEach`) coexist because they mock at different granularities, not
because either is isolated — keep that in mind adding a new file that touches
either module.

## `packages/cli/`'s tests set `$HOME` directly, no preload needed

`packages/cli/config.go` resolves its config file path
(`~/.config/homerun/config.json`) from `os.UserHomeDir()`, which reads `$HOME`
fresh on every call (unlike the old TypeScript CLI's `os.homedir()`, fixed for
the life of the process, which is why that version needed a `bunfig.toml`
preload mocking it). `packages/cli/cli_test.go` just calls
`t.Setenv("HOME", t.TempDir())` per test, which Go's own test runner resets
automatically, so there's no shared scratch-directory setup and no
`tests/unit/support/` involvement at all for `go test`.

## Coverage

`bunfig.toml`'s `[test].coverage = true` turns coverage on for every run, scoped
away from `tests/**` (`packages/cli/generated/**` was in this exclusion list
too, back when that directory existed for the TypeScript CLI). No threshold
enforced yet.

## Fakes over mocking libraries

`packages/installer/exec.go`'s `Runner` is a real Go interface, so its own Go
tests (`steps_test.go`, `fullstack_test.go`, `migrate_test.go`, `flow_test.go`,
`main_test.go`, `support_test.go`) pass a fake implementation instead of the
real `StepRunner`, no mocking library involved — the same "fake over mock"
posture the old `bun:test` suite used to take with plain object literals for
this same collaborator, before the installer's Go rewrite moved these tests out
of `tests/unit/installer/` entirely.

## Real bugs this suite caught

- `Bun.write(path, data, { mode: 0o600 })`'s `mode` option is silently a no-op
  on Bun 1.4.0 — the file lands with whatever the umask produces (0644 under the
  common 022 umask) regardless of what's passed. `packages/agent/token.ts`'s
  persisted agent token — a full-access API credential — was affected by exactly
  this. Fixed by calling `node:fs/promises`'s `chmod()` explicitly after
  `Bun.write` (`node:fs`'s own `mode` option is honored, verified).
- `bunfig.toml`'s `[test].timeout` key is silently not honored by Bun 1.4.0 for
  `test()` bodies — every `test/test:*` script passes `--timeout 120000` on the
  CLI instead.

## Vitest was tried and reverted

This suite briefly ran on Vitest. It fixed the timeout bug above and gave each
test file its own module registry. But `coverage.provider: "v8"` crashes under
Bun once coverage from more than one test file needs merging
(`@bcoe/v8-coverage`'s recursive merge throws
`RangeError: Maximum call stack size exceeded`, reproduced directly, confirmed
independent of provider — `istanbul` avoided it, `v8` didn't). The suite moved
back to `bun:test` rather than keep the extra dependency around for that.

`tsconfig.json` excludes `tests/` from `svelte-check` (`bun run check`'s
`check:app`) — `bun:test`'s `mock()` return type hits real overload-resolution
errors under svelte-check's TS resolution that don't happen under
`tsc`/`bun test` directly. `tests/unit/agent/` is type-checked per-package
instead (`bun run check:agent`); `packages/cli/`'s and `packages/installer/`'s
own tests aren't under `tests/` at all, `check:cli` and `check:installer` are
both `go vet`, not `tsc`.
