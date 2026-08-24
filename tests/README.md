# Unit tests

Bun's native test runner (`bun:test`), covering `agent/`, `installer/`, and
`cli/` (three standalone Bun sub-projects, see the root `CLAUDE.md`). Tests live
here, under `tests/<package>/`, mirroring the source tree rather than sitting
next to the files they cover — `tests/agent/token.test.ts` tests
`agent/token.ts`, `tests/installer/detect.test.ts` tests
`installer/steps/detect.ts`, etc. `tests/app/` is a separate, pre-existing
scaffold for the SvelteKit app itself (a Svelte-compiling preload helper for
future component tests, wired in via `bunfig.toml`'s `[test].preload`); it
predates and is unrelated to the `agent`/`installer`/`cli` suites below.

Run everything: `bun test`. Scoped: `bun test:agent`, `bun test:installer`,
`bun test:cli`.

## Module mocks are process-global, not per-file

`bun:test`'s `mock.module(specifier, factory)` replaces that specifier's entry
in the module registry for the rest of the **whole `bun test` run** — every test
file in the run shares one registry, there's no per-file reset by default. It
also applies **retroactively**: code that already imported the real module
before the mock call still sees the new value afterward, because a named import
is a live binding onto the same object `mock.module` mutates in place (verified
directly: a function captured via `import { fn } from "./x"` before any mocking
started still returned the mocked value after a _different_ file's top-level
`mock.module("./x", ...)` ran later). `bun test`'s file scheduling order is also
not guaranteed to be alphabetical.

The practical consequence: two test files that `mock.module` the **same**
specifier with different fakes will collide, regardless of which order they
happen to run in, and there's no reliable "this file's mock only applies to this
file" boundary the way there is for `describe`/`it`-scoped setup. Two patterns
avoid this collision entirely:

- **A plain mutable singleton** (e.g. `agent/config.ts`'s `config` object, a
  plain `export const config = {...}`, not `Object.freeze`d): save the fields
  you're about to override, mutate them directly on the real object, restore
  them in `afterEach`. No module registry involved at all, so nothing to collide
  with. See `tests/agent/token.test.ts`.
- **`spyOn` a handful of named functions on an otherwise-real module** (e.g.
  `agent/docker.ts`'s functions, faked out from under `agent/http.ts` in
  `tests/agent/http.test.ts`; `cli/output.ts`'s `fail` in
  `tests/cli/commands.test.ts`):
  `spyOn(moduleNamespace, "fnName") .mockImplementation(...)`, restored via
  `mock.restore()` in `afterEach`. `spyOn` on a named export works the same way
  as the live-binding mutation above (verified), but only patches the specific
  function(s) used, so a _different_ file needing the **real** implementation of
  the same module at the same time doesn't break. Concretely:
  `tests/agent/docker.test.ts` needs the real `agent/docker.ts` (backed by a
  mocked `dockerode`) at the same time `tests/agent/http.test.ts` fakes
  `agent/docker.ts`'s functions out from under `agent/http.ts`. A wholesale
  `mock.module("../../agent/docker", ...)` in the latter would have clobbered
  the former regardless of run order (this was hit for real while writing these
  tests, see git history) — `spyOn` doesn't, since it only overwrites the
  specific properties it's told to.

`mock.module` wholesale (replacing an entire module) is still the right tool
when **nothing else in the suite touches that specifier at all** —
`tests/agent/docker.test.ts` mocks `dockerode` itself this way, since
`agent/docker.ts` is the only importer of it in this whole repo, so there's no
other file to collide with.

## `cli/` tests need a mocked `os.homedir()`

`cli/config.ts` resolves its config file path (`~/.config/homerun/config.json`)
from `os.homedir()` **once, at module load**
(`const CONFIG_DIR = join(homedir(), ...)`). `os.homedir()` itself is fixed for
the life of the process — it reads the real OS environment at process start, not
per call (verified on Bun 1.4.0: reassigning `process.env.HOME` mid-process does
**not** change what subsequent `os.homedir()` calls return). That means an
ordinary per-file `mock.module("node:os", ...)` can't help either: by the time
any individual test file's own code runs, `cli/config.ts` may already have been
imported (directly, or transitively via `cli/client.ts`/`cli/login.ts`) by some
other file earlier in the run, permanently locking in whichever home directory
was live at that point (see the "process-global" section above).

The fix that actually works: `tests/support/homedir-preload.ts`, wired in via
`bunfig.toml`'s `[test].preload` (which Bun guarantees runs before _any_ test
file's own imports, once, for the whole run), mocks `node:os`'s `homedir()` to a
fresh `mkdtempSync`-created scratch directory, passing every other `node:os`
export (`cpus()`, `totalmem()`, etc., used for real by `agent/stats.ts`) through
unchanged. This needed no changes to `bun test`'s invocation at all — a
completely bare `bun test` (no wrapper script, no env var) already lands
`cli/config.ts` in the scratch directory, verified directly. Every test file
that touches `cli/config.ts` (`tests/cli/config.test.ts`, `client.test.ts`,
`login.test.ts`) still guards against this invariant ever breaking (e.g. the
preload entry gets removed, or a run doesn't pick up this repo's `bunfig.toml`):

```ts
if (!homedir().startsWith(tmpdir())) {
  throw new Error(
    "... refusing to risk touching the real ~/.config/homerun ...",
  );
}
```

so that failure mode fails loudly instead of silently reading/writing a real
developer's stored API key.

## Coverage

`bunfig.toml`'s `[test]` section turns coverage reporting on for every
`bun test` run (`coverage = true`, `coverageReporter = ["text", "lcov"]`),
scoped away from `tests/**` and `cli/generated/**` (generated OpenAPI types,
never meant to be exercised directly) via `coveragePathIgnorePatterns`. Coverage
only reports on files actually loaded by the tests that ran, so scoping to one
package (`bun test:agent`) only shows that package's files, not a 0%-everywhere
table for the rest of the repo. No `coverageThreshold` is set yet — this suite
is brand new, enforcing a threshold is a reasonable follow-up once coverage has
stabilized, not a day-one requirement.

## Fakes over mocking libraries

Where a function takes a `StepRunner`-shaped collaborator (`installer/exec.ts`)
or a small client object, tests pass a plain object literal with
`mock()`-wrapped methods instead of instantiating the real class — TypeScript's
structural types are erased at runtime, so this is a valid `StepRunner` etc. as
far as the code under test can tell, without ever shelling out for real. See
`tests/installer/network.test.ts` / `release.test.ts` / `full-stack.test.ts` /
`agent-step.test.ts`.

## A real bug this caught

Writing `tests/agent/token.test.ts` surfaced a real, verified issue:
`Bun.write(path, data, { mode: 0o600 })`'s `mode` option is silently a no-op on
Bun 1.4.0 — the file lands with whatever the umask produces (0644 under the
common 022 umask) regardless of what's passed. `agent/token.ts`'s persisted
agent token — a full-access API credential — was affected by exactly this,
landing group/other-readable on a shared host despite asking for 0600. Fixed by
calling `node:fs/promises`'s `chmod()` explicitly after `Bun.write` (`node:fs`'s
own `mode` option, unlike `Bun.write`'s, is honored, verified). If a future
change writes another secret to disk via `Bun.write`, don't trust its `mode`
option either — `chmod` afterward.
