# Unit tests

`bun:test`, run directly by Bun (`bun test --timeout 120000` — see the root
`CLAUDE.md`'s note on why `--timeout` is passed explicitly), covering
`packages/agent/`, `packages/installer/`, and `packages/cli/`. Tests live here,
under `tests/unit/<package>/`, mirroring the source tree —
`tests/unit/agent/token.test.ts` tests `packages/agent/token.ts`,
`tests/unit/installer/detect.test.ts` tests
`packages/installer/steps/detect.ts`, etc. `tests/unit/app/` is component tests
for the SvelteKit app itself (a Svelte-compiling Bun plugin + happy-dom setup,
`@testing-library/svelte`), see its own README.

Run everything: `bun run test` (a bare `bun test` also works — no wrapper
script, `bunfig.toml`'s `[test].preload` handles the rest). Scoped:
`bun run test:unit`, `bun run test:unit:agent`, `bun run test:unit:app`,
`bun run test:unit:cli`, `bun run test:unit:installer`. See
`tests/integration/README.md` for the separate `tests/integration/` suite, and
`tests/e2e/README.md` for the real-browser Playwright suite (its own runner,
`bun run test:e2e`, not part of `bun run test`'s `bun test` invocation).

## Mocks are process-global

`mock.module(specifier, factory)` mutates one module registry for the whole
`bun test` process — two files mocking the same specifier differently would
collide regardless of run order. `tests/unit/agent/docker.test.ts` (mocks
`"dockerode"` wholesale) and `tests/unit/agent/http.test.ts` (spies on
individual `DockerService` methods via `spyOn`, restored with `mock.restore()`
in `afterEach`) coexist because they mock at different granularities, not
because either is isolated — keep that in mind adding a new file that touches
either module.

## `cli/` tests need a mocked `os.homedir()`

`packages/cli/config.ts` resolves its config file path
(`~/.config/homerun/config.json`) from `os.homedir()` once, at module load.
`os.homedir()` itself is fixed for the life of the process (reassigning
`process.env.HOME` mid-process doesn't change it, verified on Bun 1.4.0).

`tests/unit/support/homedir-preload.ts`, wired in via `bunfig.toml`'s
`[test].preload`, mocks `node:os`'s `homedir()` to a `mkdtempSync`-created
scratch directory for the whole run, before any test file's own imports run.
Every test file that touches `cli/config.ts` (`config.test.ts`,
`client.test.ts`, `login.test.ts`) guards against this invariant breaking:

```ts
if (!homedir().startsWith(tmpdir())) {
  throw new Error(
    "... refusing to risk touching the real ~/.config/homerun ...",
  );
}
```

## Coverage

`bunfig.toml`'s `[test].coverage = true` turns coverage on for every run, scoped
away from `tests/**` and `packages/cli/generated/**`. No threshold enforced yet.

## Fakes over mocking libraries

Where a function takes a `StepRunner`-shaped collaborator
(`packages/installer/exec.ts`) or a small client object, tests pass a plain
object literal with `mock()`-wrapped methods instead of instantiating the real
class — TypeScript's structural types are erased at runtime, so this is a valid
`StepRunner` etc. as far as the code under test can tell. See
`tests/unit/installer/network.test.ts` / `release.test.ts` /
`full-stack.test.ts` / `agent-step.test.ts`.

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
`tsc`/`bun test` directly. `tests/` is type-checked per-package instead
(`bun run check:agent`/`check:cli`/`check:installer`).
