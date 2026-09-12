# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## How to work here (read this first)

**Don't think like enterprise.** No phased rollouts, no "Phase 1 / Phase 2", no
priority tiers, no migration plans, no risk matrices, no asking whether we
should ship it. This is a one-person hobby PaaS, not a bank. Just do the work
and ship the software. If it breaks, we open an issue and fix it. Nobody dies.

Concretely:

- Do the whole change in one go. Don't split it into stages and hand back a plan
  for the rest.
- Don't ask permission to proceed on something already asked for. Do it.
- Don't rank findings by severity or write a rollout strategy. Fix what's
  broken, mention what you skipped in one line.
- No feature flags, no backwards-compat shims, no deprecation windows. There's
  one instance and one user. Change the thing.
- Breaking a migration, losing dev data, or needing a manual step is fine. Say
  so, move on.
- The conventions below (types, DTOs, toasts, no comments, `bun run check`
  clean) still apply. Being fast isn't licence to leave the repo broken.

**Work out of `TODO.md`.** It's the backlog, and it's the only one. Don't write
a plan in chat, don't keep a task list somewhere else, don't hand back a
"proposed roadmap".

- Picking up work with no specific ask : take something from `TODO.md` and do
  it.
- Finished an item : tick it off and move it under `## Done` in the same change,
  not in a follow-up.
- Found something out of scope mid-task : add a line to `TODO.md` and carry on.
  Don't stop, don't ask, don't do it anyway.
- The `Small`/`Medium`/`Large` headings are rough size, not priority. There is
  no priority ordering, don't add one.

## What this is

Homerun, a self-hosted, single-user PaaS for deploying Docker containers with a
click-config form (a minimal Dokploy/Cloud-Run alternative). Point at an image
(or a git repo, see below), fill in env vars/port/resources, deploy, Traefik
auto-routes it to `<slug>.<baseDomain>` with TLS. Single host, local Docker
socket only; no multi-node orchestration. A service is either
"bring-your-own-image" (the original/default) or "build from a git repo"
(clones + builds a Dockerfile locally, no registry involved), see Git-based
builds below.

Stack: SvelteKit 2 (Svelte 5 runes) + Bun runtime, better-auth, Drizzle ORM over
Postgres (via Bun's built-in `SQL` client, `drizzle-orm/bun-sql`, no `pg`
dependency needed), Tailwind v4 + shadcn-svelte ("vega" style), dockerode.

## Commands

```bash
bun run dev              # vite dev
bun run build            # parallel build:app (bun run gen && vite build) + build:packages (scripts/build-packages.ts, the agent/installer/cli binaries)
bun run start            # ./build/server (the binary @orochibraru/svelte-smol compiles, serve the built app)
bun run gen              # svelte-kit sync + regenerate openapi.json, packages/cli/generated/openapi-types.ts and homerun.schema.json, runs as part of build:app
bun run check            # parallel check:app + check:packages, the real gate, see note below
bun run check:app        # svelte-kit sync && svelte-check --fail-on-warnings --tsgo, the SvelteKit half of the gate
bun run check:scripts    # tsc over scripts/ (tsconfig.scripts.json), part of check:packages, scripts/ isn't covered by svelte-check's own include list
bun run lint             # parallel lint:ts (biome check) + lint:md (markdownlint-cli2) + lint:tailwind (tailwint, Tailwind class sorting), rustywind is still a listed dependency but unwired, tailwint superseded it
bun run lint:fix         # the --write/--fix half of all three
bun run format:md        # prettier over **/*.md, separate from lint:md's rule checking
bun run db:generate      # drizzle-kit generate, regenerate migrations from src/lib/server/db/schema.ts
bun run component:add    # shadcn-svelte add <name>, installs a UI primitive into src/lib/components/ui/
bun run dev:agent        # bun run --hot packages/agent/index.ts, the Homerun Agent against the local Docker socket
bun run dev:docs         # packages/docs/ (the docs site) in dev; build:docs/check:docs are its build/typecheck, all three via scripts/docs.ts
docker compose up -d     # bootstraps Traefik + Postgres for local dev (compose.yaml), required, the app has no fallback DB, see Compose files below
bun run release          # semantic-release, normally CI-only (.github/workflows/publish.yaml), see Release automation below
```

```bash
bun run test              # bun test --timeout 120000, the whole bun:test suite (unit + integration, see below), never tests/e2e/ (Playwright, own runner)
bun run test:unit         # unit tests only (packages/agent, packages/installer, packages/cli, plus tests/unit/app)
bun run test:unit:agent   # scoped to packages/agent
bun run test:unit:app     # scoped to tests/unit/app, the SvelteKit app's own unit/component tests
bun run test:unit:cli     # scoped to packages/cli
bun run test:unit:installer  # scoped to packages/installer
bun run test:integration  # tests/integration/ only, real Postgres/Docker/agent, see that suite's own README
bun run test:e2e          # playwright test, tests/e2e/, real Chromium against a real built app, needs bun run build:app first, see E2E browser tests below
bun run e2e:multipass     # scripts/e2e-multipass.ts, real-infra installer/agent/CLI e2e, see below, not wired into CI
bun run e2e:multipass:release  # scripts/e2e-multipass-release.ts, the same but against the *published* release and the *documented* commands, see below, also not wired into CI (`--only=docs` is the VM-free docs-drift check)
```

`packages/agent/`, `packages/installer/`, and `packages/cli/` are separate
standalone Bun/TypeScript sub-projects (their own `tsconfig.json`, checked via
the root `check:agent`/`check:cli`/`check:installer` scripts and compiled via
`scripts/build-packages.ts`, **not** their own `package.json`/`bun install`,
they share the root one), not part of the SvelteKit app above, see "Homerun
Agent + installer" and "Homerun CLI" below for what they are. `packages/docs/`
is a fourth sub-project under `packages/`, a generated docs site, see its own
subsection below.

### Unit tests (`tests/`)

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

## AI-assisted development (`.claude/agents/`, `.claude/skills/` → `.agents/skills/`)

This repo has Claude Code skills and subagents encoding the workflows below in
executable detail, not just prose, use them instead of re-deriving the steps by
hand:

- Skills (invoke directly, or they trigger on a matching request): `check-repo`
  (the `bun run check`/`bun run lint`/per-subproject-typecheck gate above, as a
  runnable checklist), `new-dto-route` (schema → DTO → route, with the
  no-manual-typing/no-raw-Drizzle/toJSON rules below baked in),
  `new-docker-mixin` (adding a concern to `DockerService`'s mixin chain, with
  the load-bearing ordering rule), `migration-workflow` (`schema.ts` →
  `db:generate` → apply, with the NOT-NULL-on-existing-rows gotcha).
- Subagents (`.claude/agents/*.md`): `repo-gate` (final review gate before
  calling a change done, scans for this file's own hard rules),
  `scaffold-feature` (adds a new table+DTO+route end to end), `subproject-sync`
  (keeps `packages/agent/`'s hand-reimplemented Docker/stats logic in sync with
  the main app, regenerates `packages/cli/`'s OpenAPI-derived types),
  `ui-consistency` (flags route markup that reimplements an existing shared
  component/primitive instead of using it, and visual drift between equivalent
  pages), `docs-sync` (use PROACTIVELY after a code change that
  adds/removes/changes a feature, checks this file itself, and
  `TODO.md`/sub-project READMEs, for exactly the kind of staleness this bullet
  list itself just had two live examples of: `ui-consistency` missing from here,
  and three shipped features still marked unbuilt under Planned features below,
  both fixed in the same session `docs-sync` was added).

Skill content lives under `.agents/skills/<name>/SKILL.md` with a symlink from
`.claude/skills/`, matching the existing `shadcn-svelte` skill's layout, keep
that pattern for any new skill.

## Conventions (strict, apply to every change)

- **Never manually type anything in a route file**, `+page.svelte`,
  `+layout.svelte`, `+page.server.ts`, `+layout.server.ts`, `+server.ts`. This
  covers `$props()` (`data`/`form`/`children`/`params`) in the `.svelte` files
  _and_ `load`/`actions`/`GET`/`POST` in `.server.ts`/`+server.ts` files. All of
  it is inferred by SvelteKit's tooling from the route's generated `./$types`,
  based on file location, that's the framework working as designed, don't fight
  it. Concretely:
  - `.svelte`: `const { data } = $props();`, never `: { data: PageData }`, never
    `: PageProps`. No
    `PageData`/`LayoutData`/`ActionData`/`PageProps`/`LayoutProps` type name
    appears in a route component at all.
  - `.server.ts` / `+server.ts`:
    `export const load = async ({ locals, parent }) => {...}`, never
    `: PageServerLoad`/`: LayoutServerLoad`. `export const actions = {...}`,
    never `: Actions`. `export const GET = async ({ params, locals }) => {...}`,
    never `: RequestHandler`. No `import type {...} from "./$types"` for any of
    these at all.
  - This rule is specific to route files. Non-route components
    (`$lib/components/**`) and shared server modules (`$lib/services/**`,
    `$lib/server/db/**`, `$lib/server/validation/**`, `$lib/dto/**`) are normal
    TypeScript/Svelte code and should still be typed explicitly as usual,
    there's no route-based inference for those.
- **Nested `load` functions under `(protected)/` must not re-check
  `!locals.user`.** The parent `+layout.server.ts` already redirects
  unauthenticated users before any child `load` runs, so re-checking is dead
  code. Use `const { user } = await parent();` instead. **This does not apply to
  `actions`**, form action submissions don't go through the parent layout's
  `load` at all, so every action keeps its own explicit
  `if (!locals.user) throw redirect(...)` guard.
- **A page made of tabs gets one real route (and one `+page.svelte` /
  `+page.server.ts`) per tab, not one big file with a client-side `activeTab`
  switch.** `services/[serviceId]/` is the reference shape: a `+layout.svelte`
  owns the tab bar (`TabNav` with `href`-based tabs, see
  `$lib/components/tab-nav.svelte`) and renders `{@render children()}`; a
  `+layout.server.ts` holds the shared guard/load every tab needs (a child
  route's own `load`, if it needs one at all, calls `parent()` rather than
  re-fetching); the first/default tab is the bare `+page.svelte` at that route's
  root, every other tab gets its own subfolder. `settings/` (General = bare
  `+page.svelte`, `docker/`, `networking/`, `email/`) is the second real
  example, split from a single 1400-line file for exactly this reason: a
  client-state tab switch means every tab's fields, `load` data, and actions all
  live in one file/one request, which stops scaling once a page has more than a
  couple of tabs. Keep each tab's own `load`/`actions` scoped to what that tab
  actually needs, don't let a new tab's server logic leak into a file it doesn't
  belong to.
- **No raw Drizzle queries in route files.** Every table has a corresponding DTO
  class in `src/lib/dto/` (see below), routes call DTO methods, never
  `db.select()/.insert()/.update()/.delete()` directly.
- No unused variables or imports. No lint errors, anywhere in the repo,
  `bun run lint` must be clean before considering a change done.
- **No type errors and no type-check warnings left after any change, anywhere in
  the repo, not just the files touched, `bun run check` must exit clean (0
  errors, 0 warnings, it fails on warnings too, see the note above) before
  considering a change done.** This isn't optional or best-effort: run it for
  real after every change and read what it reports, rather than assuming an
  untouched file's error is pre-existing and therefore not your problem, confirm
  that by actually looking, and fix it either way if it's cheap and unambiguous.
- **Every async user action is reported with `toast.promise`, never a bare
  `toast.success`/`toast.error`.** A promise toast is the only shape that
  narrates the whole operation (`loading` → `success`/`error`) instead of only
  its outcome, and it forces the failure path to be written, which is what was
  actually broken before: the sign-in form's inputs stayed disabled after a
  wrong password and the password field was never cleared, because the `catch`
  branch toasted and returned without restoring state. The two shapes:
  - **A client-side async handler** (a `fetch`, a better-auth client call) gets
    split in two: an inner `async <name>Callback()` that does the work, throws
    an `Error` on failure, and resets its own UI state (`loading = false`,
    clearing a password field) in a `catch` before rethrowing; and a thin outer
    `handle<Name>()` that returns
    `toast.promise(<name>Callback(...), { error, loading, success })`, with
    `error` a function mapping the thrown error to a message via
    `toastError(error, "<fallback>")`. `src/routes/auth/sign-in/+page.svelte`
    and `$lib/components/profile-menu.svelte` are the reference implementations.
    Validate inside the callback and `throw` there too, rather than toasting
    early and returning, so there's one path in and one path out.
  - **A `use:enhance` form** uses `enhanceToast({...})` from `$lib/toast.ts`,
    which bridges enhance's callback shape onto a real promise. It takes
    `loading`/`success`/`error` (where `success` may be a `(data) => string`
    reading the action's returned data), optional sonner `action`/`description`,
    `reset` (forwarded to `update()`), and the lifecycle hooks
    `onStart`/`onSubmit` (pre-submit, receives the `FormData`, for things like
    stamping a client-generated deployment id)
    /`onSettled`/`onSuccess`/`onFailure` (both receive the action's data)
    /`onComplete` (runs _after_ `update()`, for a trailing `refreshAll()`).
    `saveToast("<Section> settings")` is the shorthand for the settings-style
    "save this section" form. Put pending-state resets in `onSettled`, not in a
    hand-written callback. `enhanceToast` already extracts a failure's message
    from either `data.error` or the first entry of this repo's zod-shaped
    `data.errors` field map, so a route never needs to dig that out itself.
    `tests/unit/app/toast.test.ts` covers that extraction and the hook order.
- **The exceptions are narrow and all of them are non-mutating or instant**: a
  synchronous result with nothing to await (`env-paste-button.svelte`'s parse, a
  clipboard copy), and a background _load_ that already renders its own inline
  spinner or skeleton rather than blocking on user intent, which today means
  every remote query (see Remote functions below): the repo picker, the
  image-exists check, the dashboard's Host Resources panel, the job queue and
  the notification feed all report failure inline. A long-lived stream is a
  third: the Terminal tab reports failures through its own `errored` banner,
  since a promise that only settles when the connection ends can't drive a
  toast. Anything that mutates state on the server gets a promise toast.
- **Never cap the width of a dashboard page.** A page under `(protected)/` fills
  the viewport : its root wrapper is `<div class="p-6 md:p-8">`, with **no
  `mx-auto` and no `max-w-*`**. This app is used on ultrawide monitors, and a
  centred `max-w-4xl` column leaves most of the screen as empty gutter while the
  content it was "protecting" (tables, lists, key/value grids, side-by-side
  cards) is exactly the content that wants the room. If a genuinely long block
  of running prose needs a reading measure, cap **that one text node** (the
  precedent is `templates/[templateId]`'s description at `max-w-2xl`) — but
  don't reach for it reflexively: no other dashboard page caps its helper text,
  and sprinkling `max-w-prose` over some paragraphs and not others reads as an
  accident rather than a decision. The only other exception is a **centred
  single-purpose card** on an otherwise-empty page (`auth/sign-in`,
  `auth/sign-up`, `auth/accept-invite`, `auth/error`, `app-auth`, `cli-auth` —
  all `max-w-md`). Neither exception is a licence to wrap a real page in a
  column.
- **No comments. Anywhere. In any code file.** No explanatory line comments, no
  header banners, no prose in YAML/compose/shell files either. A change's
  rationale belongs in the git commit message, a feature's explanation belongs
  in `docs/` or this file, and code that needs a comment to be understood needs
  a better name instead. Existing comments in files you aren't otherwise
  touching stay put, don't do sweeping comment-deletion passes, just never add
  one.
- **Prefer real OOP over a static-only class that just re-exports imported
  functions (or is `static` throughout for no reason beyond habit).** A
  `class Foo { static bar = importedBar; }` barrel (the shape
  `docker.service.ts` and `database.service.ts` used to have, the latter was
  pure dead code duplicating `db/lib.ts` and was deleted outright rather than
  "fixed") isn't real OOP, it's a namespace with extra syntax, and neither is
  `class Foo { static bar() {...} }` once there's no actual reason for `bar` to
  be static. Three reference shapes now exist, pick whichever fits the module:
  - **Plain instance singleton**, the default, and the most common case: a class
    was `static`-only for no real reason (`AdminService`, `ApiService`,
    `DeploymentService`, `GitProviderService`, `SystemStatsService`,
    `UserService`, `S3BackupService`, all under `$lib/services/`). Drop every
    `static`, instantiate once, export the instance under the _same_ name the
    class used to export
    (`class AdminServiceClass {...}; export const AdminService = new AdminServiceClass();`).
    `SystemStatsService` is the clearest win from this: its CPU% delta sample
    (`#lastCpuSample`) used to be an awkward module-scope `let` purely because
    the class had no instance to hang it off, it's now a real private instance
    field. `BaseDockerService`/`BaseScheduler`-style abstract bases stay
    exported as classes, not instances (they're meant to be extended, e.g.
    `BackupService`, not instantiated directly).
  - **Mixin-merge**, when several concerns need to call into each other and
    external code should keep addressing one flat symbol,
    `$lib/services/docker.service.ts`: each concern (containers, networks,
    terminal, reconcile, git-build, custom-ssl, core-services,
    `src/lib/services/docker/*.ts`) is a real class extending
    `BaseDockerService` (`docker/base.ts`), merged into one `DockerService` via
    the TS mixin pattern (each file exports a `SomethingMixin(Base)` function;
    `docker.service.ts` chains them and instantiates once,
    `export const DockerService = new DockerServiceClass()`), and one concern
    calling another's method uses real inheritance (`this.inspectStatus(...)`),
    not a cross-module import.
  - **Composition**, when the pieces are independent and don't call each other,
    `$lib/services/cron.service.ts`: `CronService` composes three instances of
    one generic `DueScheduler<T>` (`src/lib/services/cron/due-scheduler.ts`),
    extending `BaseScheduler` for its shared tick/HMR-guard boilerplate, and a
    `CronService` method just calls `.start()` on the instance it owns rather
    than being `static start = importedStart`.

    Across all three, a genuinely pure/stateless transform (`docker/labels.ts`,
    `cron/cron-expression.ts`, `api.service.ts`'s
    `parseImageRef`/`parseWwwAuthenticate`, `git-provider.service.ts`'s
    `endpoints`/`authHeader`) is fine left as a plain module-scope function,
    it's the _stateful, side-effecting, or genuinely-multi-concern_ modules this
    convention targets, not every last helper. Every one of these examples keeps
    external call sites unchanged
    (`DockerService.pullImage(...)`/`CronService.startCronScheduler()`/`AdminService.hasAnyUser()`
    all read identically whether the symbol is a class-with-statics or a
    singleton/facade instance), so refactoring a module to this shape doesn't
    have to ripple into routes/DTOs that already call through it. Apply this
    opportunistically when you're already touching a static-barrel module, not
    as a blanket rewrite mandate, same posture as the shared-UI-components note
    above. DTOs (`$lib/dto/*`) are a deliberate exception, not an oversight:
    their `static get()`/`.list()`/`.create()` finders returning per-row
    instances with instance methods (`svc.update()`) is already a correct,
    intentional Repository/Active-Record split, see the DTO layer section below,
    don't "fix" it.

## Architecture

### The DTO layer (`src/lib/dto/`)

Every table is wrapped by a DTO class extending `BaseDTO<TRow>` (`base-dto.ts`):
a thin instance around one DB row that owns its own queries. Route files call
`ServiceDTO.get(id, userId)`, `svc.update({...})`, `svc.delete()` etc. instead
of writing Drizzle inline, this is what "no raw SQL in page.server.ts" means in
practice, and it's also the layer a future REST/CLI API would sit on top of (not
yet built).

- `service-dto.ts`, `ServiceDTO`:
  `get`/`list`/`listByProject`/`listWithProjectNames` (joins in `project.name`
  for the grouped services list)/`listWithProjectNamesPaged`/
  `listFilterFacets`/`slugTaken`/`create`/`update`/`delete`. See Server-side
  list pagination below for the paged/faceted pair.
- `project-dto.ts`, `ProjectDTO`:
  `get`/`list`/`listWithServiceCounts`/`listWithServiceCountsPaged`/`create`/
  `update`/`delete` (row-only) /`cascadeDelete()` (stops+removes every member
  container, deletes deployments/services, deletes the project row, then removes
  the project's Docker network, the real "delete a project" operation, see
  `projects/[projectId]/+page.server.ts`'s `delete` action).
- `template-dto.ts`, `TemplateDTO`: `usable(id, userId)` (built-in OR owned, for
  deploy-from-template), `owned(id, userId)` (owned only), `listForUser`,
  `listPaged(userId, "builtin" | "mine", query)`, `listCategories`, `create`.
  Built-ins have `ownerId: null` and are seeded on boot (see below).
- `template-link-dto.ts`, `TemplateLinkDTO`: `listForTemplate(templateId)`
  (joined with the linked template's own image/tag/port/envVars/resources, for
  both display and for actually deploying it), `countForTemplate`, `create`,
  `remove`. See Template links below.
- `deployment-dto.ts`, `DeploymentDTO`:
  `get`/`listForService`/`listRecentForUser` (joins in service name/slug, for
  the dashboard)/`create`/`update`/`appendLog(line)` (appends to the live
  progress log, see below).
- `storage-volume-dto.ts`, `StorageVolumeDTO`:
  `get`/`list`/`listPaged`/`create`/`delete`, for the `/storage` page's volume
  sources.
- `service-volume-dto.ts`, `ServiceVolumeDTO`: `listForService` (joined with the
  volume's name/kind/source), `attach`/`detach`, the mounts of a StorageVolume
  into a service, shown on the service's Volumes tab.
- `remote-host-dto.ts`, `RemoteHostDTO`:
  `get`/`list`/`listPaged`/`listBuildServers`/`create`/`update`/`delete`,
  `toConnection()` (decrypts TLS material into what `DockerService.getDocker()`
  wants), and the static `resolveBuildTarget(hostId, userId)` that turns a host
  id into the `RemoteExecutionTarget` `deploy.service.ts` branches on, see Build
  servers below.
- `s3-destination-dto.ts`, `S3DestinationDTO`:
  `get`/`list`/`listPaged`/`create`/`update`/`delete`, plus
  `decryptSecretAccessKey()` (for the S3 client only, never a `load` return
  value), a named, reusable S3 target several volumes can share, see S3 backups
  below.
- `backup-run-dto.ts`, `BackupRunDTO`: `create`/`finish`/`listForVolume`/
  `listForUser`/`listForUserPaged` (joins in the volume's name), one row per
  backup attempt, the history behind `/backups`.
- `cron-job-dto.ts`, `CronJobDTO`: `get`/`list`/`listPaged`/`listEnabled`
  (unscoped by user, for the scheduler tick, same precedent as
  `ServiceDTO.listCronEnabled`)/`create`/`update`/ `delete`, and
  `cron-job-run-dto.ts`, `CronJobRunDTO`:
  `create`/`finish`/`listForJob`/`listForUser` (joins in the job's name), one
  row per cron job attempt with its captured output. See Cron jobs below.
- `build-cache-registry-dto.ts`, `BuildCacheRegistryDTO`:
  `get`/`list`/`listPaged`/`create`/`delete`, a per-user registry credential a
  git-build pulls its `--cache-from` image from and pushes fresh layers back to,
  see Git-based builds below.
- `git-connection-dto.ts`, `GitConnectionDTO`: one user's OAuth authorization
  against one configured git provider, see Git provider connections below.
- `app-log-dto.ts`, `notification-dto.ts`, `user-preferences-dto.ts`,
  `instance-settings-dto.ts`, `invitation-dto.ts`, each covered by its own
  section below.

**`toJSON()` before returning from `load`**: DTO instances are server-only;
SvelteKit serializes `load` return values with devalue, which can't serialize a
class instance. Every `load` maps DTOs to plain objects via `.toJSON()` (or
`.map(d => d.toJSON())`) before returning.

### Server-side list pagination (`$lib/server/list-query.ts`, `$lib/server/api-pagination.ts`)

Every list page, and the three paginated REST endpoints below, share one
query-parsing layer instead of loading a user's entire table and
searching/filtering it in memory, which is what every list page (and the
services list's status-sync loop, see below) used to do, and what a handful of
history views (`/backups`) silently truncated to their newest N rows instead of
paging through.

- `list-query.ts`'s `parseListQuery(url, {filterKeys, pageParam, perPage})`
  turns a request's `URL` into a `ListQuery` (`page`/`perPage`/`limit`/
  `offset`/`q`/`filters`, plus `active`, true when a search term or any filter
  is set, what a page uses to tell "you have nothing yet" apart from "nothing
  matched"). Defaults to 25/page, hard-capped at 100 regardless of what's
  requested; malformed/negative `page`/`perPage` fall back rather than erroring.
  `PagedResult<T>` (`{items, page, perPage, total}`) is the shape every paged
  DTO finder below returns. `searchCondition(q, columns)` builds a
  case-insensitive `ilike` `or(...)` across the given columns, escaping
  `%`/`_`/`\` in `q` first. `narrowFilter(values, allowed)` narrows raw URL
  strings down to a column's enum union, needed because `service.currentStatus`
  (`$type<ContainerStatus>()`) and `remote_host.kind` (a `text(..., {enum})`
  column) both reject a bare `string[]` passed to `inArray`.
- `api-pagination.ts`'s `parseApiListQuery(url)` is the same parser with a
  100/page default (API callers don't get the dashboard's 25);
  `jsonPage(items, meta)` wraps `json()` and stamps
  `x-total-count`/`x-page`/`x-per-page` response headers, see REST API below for
  why the body itself stays a plain array rather than growing an envelope.
- Every paged DTO finder does its search/filter/count in SQL, not in memory, the
  row query and a `count()` query run in one `Promise.all`:
  `ServiceDTO.listWithProjectNamesPaged` (+ `ServiceDTO.listFilterFacets`, every
  distinct status/project the user actually has, so the filter pills stay stable
  no matter which page you're on), `ProjectDTO.listWithServiceCountsPaged`,
  `TemplateDTO.listPaged(userId, "builtin" | "mine", query)` (+
  `TemplateDTO.listCategories`), `StorageVolumeDTO.listPaged`,
  `RemoteHostDTO.listPaged`, `S3DestinationDTO.listPaged`,
  `BuildCacheRegistryDTO.listPaged`, `BackupRunDTO.listForUserPaged`, and
  `UserService.listUsersPaged`. The old unpaged finders (`ServiceDTO.list`,
  `list`/`listForUser`/etc. on the others) stay, for internal callers that need
  every row regardless of the requesting user's current page: schedulers, Docker
  Cleanup, cascade-delete.
- `services/+page.server.ts`'s `load` used to call
  `DockerService.syncAllServiceStatuses` for every service the user owns on
  every page load, one Docker `inspect` per service, then re-run the full query.
  It now syncs only the current page's already-deployed services
  (`containerId`/`swarmServiceId` set), skips both the sync and the second query
  entirely when the page has none, and calls `allowLongRequest(platform)` (see
  Long-running requests below), which it never did before, leaving it exposed to
  Bun's 10s idle-timeout cut on Linux.

**Verified live** against a seeded Postgres, in a real browser and over the REST
API/CLI: every list page pages correctly, search and filters reach the whole
table rather than the loaded page, selection is dropped when the page changes,
and out-of-range `page`/`perPage` clamp instead of erroring. `/backups` is the
one worth remembering: it previously capped at the newest 50 runs with nothing
in the UI saying so.

### Design system and theming (`src/routes/layout.css`)

One file owns the whole visual language : the palette, the radius scale, the
fonts, and the four custom Tailwind v4 `@utility` definitions every surface is
built from. Nothing under `src/routes`/`src/lib` should hardcode a hex value or
a blur/shadow stack, route it through a token here instead.

- **Two typefaces.** `--font-sans` is Inter (self-hosted `@font-face` blocks
  pointing at `static/fonts/`, plus the `@fontsource-variable/inter` import);
  `--font-mono` is **JetBrains Mono** (`@fontsource-variable/jetbrains-mono`,
  bundled, no CDN, same "a self-hosted app shouldn't need outbound internet to
  render" reasoning as the Swagger UI docs page). Mono is not decorative : it
  carries every machine-readable string, image refs (`redis:alpine`), slugs and
  hostnames, image digests, metrics, status badges, and section labels, which is
  most of what makes this read as infrastructure tooling rather than a generic
  dashboard.
- **`glass`** is the panel/card treatment : translucent `--color-surface`, a
  `backdrop-filter` blur+saturate, a hairline border, a top inner highlight, and
  a soft drop shadow, plus a `--glass-sheen` specular gradient over the top 45%.
  That sheen is load-bearing, not decoration : without it a translucent panel on
  a near-black ground reads as a flat tinted rectangle rather than as glass.
  **`glass-strong`** is the same for elements that overlap scrolling content and
  therefore need more opacity to stay readable (the sidebar, the sticky header,
  the mobile drawer). **`glass-interactive`** adds the hover lift.
- **`tech`** is `--font-mono` + `tabular-nums`, for any number that updates live
  (the dashboard's 5s stats poll) so digits don't reflow as they change.
  **`eyebrow`** is the small uppercase mono section label used for every panel
  title and sidebar category heading.
- **The ambient backdrop** (`body::before`/`::after`) is what the glass actually
  samples : three off-screen radial color pools plus a faint 44px engineering
  grid, both `position: fixed` so they stay put while content scrolls. **Any
  full-height wrapper inside `(protected)/` must not paint an opaque
  background** or it covers this and every glass surface flattens out ; the
  layout's root div is deliberately transparent for exactly this reason.
- **The radius scale was deliberately tightened** : `--radius` is `0.5rem` (from
  `0.625rem`) and the multiplier curve is flatter, so `rounded-2xl` resolves to
  `0.75rem` rather than the old `1.125rem`. Card corners are the single biggest
  "toy vs. tool" tell, don't loosen them back up.
- Both themes are real and both are checked : light is `:root`, dark is `.dark`
  (driven by `mode-watcher`, see Appearance preferences below). Every token that
  differs between them is redefined in both blocks, a color defined only in one
  is a bug.

**Sweeping this file's tokens is how a global visual change is made**, not a
per-route pass : the redesign that introduced this section changed ~40 route
files, but almost all of that was one mechanical substitution
(`border border-border bg-surface` → `glass`). **A real bug came out of doing
that with a `\b`-anchored regex**: `bg-surface\b` matches inside `bg-surface-2`,
silently producing a bogus `glass-2` class that Tailwind emits nothing for.
Match on whole class tokens, not substrings.

### Page width and layout

Covered as a hard rule under Conventions above, repeated here because it's a
layout decision rather than a code-style one: **dashboard pages fill the
viewport** (`p-6 md:p-8`, no `mx-auto`, no `max-w-*`). `/authentication` shipped
with `mx-auto max-w-4xl` and looked broken on an ultrawide display, with the
whole page squeezed into a centre column; `remote-hosts/[hostId]` had the same
defect (`mx-auto max-w-2xl`). Both now follow the same wrapper every other page
uses.

### Shared UI components (`src/lib/components/`)

Not a full componentized design system, this app still doesn't have one, but a
real shared list-page toolkit now exists alongside the smaller extracted
patterns: `status-badge.svelte` (pre-existing), `empty-state.svelte`
(icon/title/subtitle + optional CTA snippet, used on Storage and Remote Hosts so
far, other list pages still have their empty state inlined), `form-styles.ts`
(the `inputClass`/`labelClass`/`errorClass` Tailwind strings almost every form
page redefines identically, imported directly as class strings, not a wrapper
component, so it doesn't force a markup shape change on pages that predate it;
wired into Remote Hosts and the service Networking tab so far), `stepper.svelte`
(the step-indicator-bar-plus-Back/Next chrome and unlocked-step gating every
multi-step form needs, extracted while building the onboarding wizard, see
Onboarding below; not yet retrofitted onto `services/new`'s own inlined
equivalent), and `skeleton.svelte` (one pulsing placeholder block, sized by a
`class` prop, the pending branch every remote-query-backed panel renders, see
Remote functions below). If you're touching a page with an inline empty-state or
the same three class-string literals, prefer wiring in the shared version over
copy-pasting again, but this is opportunistic, not a mandate to refactor
unrelated pages.

**Self-loading components**, the ones that fetch their own data through a remote
query rather than taking it as a prop off a route's `load` (see Remote functions
below), so a page that wants one just renders it: `host-resources.svelte` (the
dashboard's Host Resources panel, own 5s poll), `job-queue-panel.svelte`
(Scheduling's job queue, own 3s poll), `notification-bell.svelte` (the header's
feed, plus its own mutations), `git-repo-picker.svelte` (the "Browse repos"
picker, shared by `services/new` and the service Source tab, calls back with the
picked repo), and `image-check-warning.svelte` (the debounced "this image wasn't
found in its registry" warning, shared by the same two pages).

**The list-page toolkit**, used by every entity list page (services, projects,
templates, storage, remote-hosts, s3-destinations, build-cache-registries,
users, backups):

- `entity-toolbar.svelte` is **URL-driven**, not prop-bound: it reads the
  current `q` and each filter group's value straight off `page.url.searchParams`
  and writes changes back with `goto(url, {keepFocus, noScroll, replaceState})`,
  debounced 300ms for the search box, clearing every page param in `pageParams`
  (default `["page"]`) on every change so a new search/filter always lands back
  on page 1. Props are `filters` (`FilterGroup[]`, each
  `{key, label, options: {label, value}[]}`), `pageParams`, `placeholder`, and a
  `trailing` snippet slot (where a page renders `ViewModeToggle`); the old
  bindable `search`/`selected` props and the exported `FilterSelection` type are
  gone, filtering moved server-side (see Server-side list pagination above), so
  there's no client state left to bind. `$lib/filtering.ts` (`matchesQuery`/
  `matchesFilter`) still exists but is no longer used by any list page. Replaced
  the bespoke search-input-plus-category-`Drawer` that used to be inlined in the
  templates gallery only (see Built-in template catalog and gallery below);
  pages without a card view (remote-hosts, s3-destinations,
  build-cache-registries, users, backups) use it for search/filter alone, with
  no `trailing` snippet.
- `pagination.svelte`: Previous/Next plus "26–50 of 60 services" and "Page 2 of
  3", also URL-driven (`goto()`, same as the toolbar), rendered only when
  `total > perPage`. Takes `page`/`perPage`/`total` (a page's `PagedResult`, see
  Server-side list pagination above) plus an optional `pageParam` (default
  `"page"`) and `label`, so a page with two independent paged lists (the
  templates gallery's built-in/custom sections) can render two of these against
  two different params.
- `view-mode.svelte.ts`'s `ViewMode` class + `view-mode-toggle.svelte`: one
  page's list/card preference, persisted in `localStorage` under
  `homerun:view:<key>` (`new ViewMode("services")`, optional 2nd arg is the
  fallback mode, e.g. `new ViewMode("templates", "card")`). Deliberately its own
  module rather than living inside `entity-list-view.svelte`, specifically so
  one page can render several `EntityListView`s sharing a single toggle
  (services groups its rows by project, one `EntityListView` per group); before
  this, each group toggled independently, a real pre-existing bug this fixes,
  not just a refactor.
- `entity-list-view.svelte` now takes `view: ViewMode` plus an optional
  `cardGridClass` (defaults to a 3-column grid; templates passes a 4-column
  one). Its old `viewKey` string prop and its module-block `EntityViewMode`
  export are gone, that type now lives on `$lib/view-mode.svelte.ts`. Every list
  page now renders straight from `data` (already one page, already
  filtered/searched) rather than deriving a client-side `filtered` array, and
  tells a true empty state apart from a no-match one via
  `data.total === 0 && !data.filtered`.

`confirm-dialog.svelte` gained an optional `confirmPhrase` prop: when set, the
dialog renders an input and the confirm button stays disabled until the typed
text matches the phrase exactly (Enter in the input confirms too). This replaced
the old "append a confirmation div into the section" pattern (an inline
`{#if showDeleteConfirm}` toggling a form in place) with a real modal everywhere
that pattern appeared: the service Settings danger zone and the project detail
danger zone (typed phrase is the entity's own name), and the services list's own
per-row delete (service name) and new bulk delete (`delete N services`, see the
services list bullet below). The profile Security page's account deletion moved
into a `Dialog` too, but keeps its existing password gate instead of a typed
phrase, the password already serves that purpose. The remote-host detail page
already used `ConfirmDialog` before this and needed no change.

**Verified live** in a real browser: the toolkit's search/filter narrowing, one
`ViewMode` toggle staying in sync across a grouped list that renders several
`EntityListView`s (services' per-project groups), select-all plus the bulk bar,
`confirmPhrase` enabling the confirm button only on an exact match, and real
single and bulk deletes. A bulk action where every service fails surfaces the
first rejection's message rather than reporting success.

### Routing: dashboard-only, no public pages

`src/routes/(protected)/` is a route group living at `/` itself (not
`/dashboard`), its `+layout.server.ts` is the single auth guard, redirecting to
`/auth/sign-in` (or `/auth/sign-up` on a blank instance) when signed out,
**and** one half of the onboarding guard, redirecting to `/onboarding` when the
instance hasn't finished it (see Onboarding below for the other half,
`src/routes/onboarding/` is its own top-level route, not nested under
`(protected)/`, with its own reverse-direction `load`). There is no public
marketing page. `src/routes/auth/**` is the only unauthenticated surface.

The sidebar nav is grouped into four labeled categories (`category` on each item
in `(protected)/+layout.svelte`'s nav array, color-coded per category, see
Appearance preferences below for the per-user "single accent color" override):

- **Workspace**: **Overview** (dashboard stats + recent deployments),
  **Services**, **Projects**, **Templates**, **Cron Jobs** (user-defined
  scheduled tasks, see Cron jobs below).
- **Infrastructure**: **Storage**, **Backups** (backup-run history + "Run now",
  see S3 backups below), **S3 Destinations** (reusable, named backup targets),
  **Remote Hosts**, **Scheduling** (one instance-wide view of every cron
  redeploy, enabled cron job and backup schedule, plus the job queue).
- **Integrations**: **Git Providers**, **Build Cache** (registry credentials for
  cross-build cache reuse, see Git-based builds below), **API Docs**.
- **Administration**: **Users** (admin-only), **Authentication** (admin-only,
  sign-in methods for the instance and the per-app login wall, see
  Authentication page below), **Settings** (admin-only), **System Logs**,
  **Docker Cleanup** (admin-only, see below).

Not in the nav but real routes: `/profile/**` (reached from the profile menu,
see Appearance preferences below), `/cli-auth` (the CLI device-code approval
page), `/app-auth` (the sign-in screen a gated app's visitors are redirected to,
deliberately top-level rather than under `(protected)/` since it has to render
for signed-out visitors, see Per-app login wall below). The bell's own
read/delete endpoints used to live at `/notifications/**` and are now remote
commands instead, see Remote functions below. `(protected)/+layout.svelte`
filters the nav array on `data.user.role === "admin"` before rendering, a
developer sees everything else unchanged (their own services/projects, already
isolated per-user by every DTO's `userId` scoping). `/setup` was removed (see
Setup diagnostics below) in favor of the dashboard banner deep-linking into
`/settings`.

`src/routes/(protected)/services/`:

- `+page.svelte`, list, grouped by project (with an "Ungrouped" bucket when more
  than one group exists), server-side search/status/project filters and a
  list/card view toggle (`entity-toolbar.svelte`/`ViewMode`, see Shared UI
  components above) plus a `<Pagination>` footer (see Server-side list
  pagination above; `+page.server.ts`'s `load` calls
  `ServiceDTO.listWithProjectNamesPaged` and `ServiceDTO.listFilterFacets` for
  the pills, so the filter options stay stable across pages), inline per-row
  start/stop/restart/delete actions plus a checkbox-driven multi-select
  (select-all scoped to whatever's on the **current page**, a sticky bottom bar
  with Start/Stop/Restart/Delete/Clear; paginating or changing the
  search/filters drops anything selected that's no longer on screen rather than
  silently submitting it with a bulk action). Both single-row and bulk actions
  go through four new `ServiceLifecycleService` methods
  (`startService`/`stopService`/`restartService`/`deleteService`,
  `service-lifecycle.service.ts`, each taking a `ServiceDTO` and branching on
  `svc.swarmServiceId` internally) rather than each call site re-deriving that
  branch; the pre-existing containerId-level `start`/`stop`/`restart`/`remove`
  methods are unchanged and still used elsewhere. `+page.server.ts`'s single
  `bulk` action takes repeated `serviceId` fields plus an `op` (from the clicked
  submit button's own name/value) and runs every resolved service through
  `Promise.allSettled` (this repo's `noAwaitInLoops` lint rule forbids an await
  loop), returning `{succeeded, failed, op}` so the toast reports a partial
  result, or `fail(400)` with the first rejection's message if every one failed.
  Bulk delete is gated behind `ConfirmDialog`'s typed-phrase confirm
  (`delete N services`); single-row delete requires typing the service's own
  name. `load` also now calls `allowLongRequest(platform)` (it didn't before,
  see Server-side list pagination above for the status-sync fix that came with
  it and Long-running requests below for why that matters).
- `import/+page.svelte`, paste a compose file, preview what it maps onto, then
  create (and optionally deploy) the stack : see Compose import below. Reached
  from the "Import compose" button next to "Deploy a Service" on the list.
- `new/+page.svelte`, click-config create form, a 4-step wizard (Basic info /
  Networking / Environment / Compute, one `<form>` throughout, steps hidden via
  a CSS class rather than `{#if}` so field state survives navigating between
  them); accepts `?projectId=` and/or `?templateId=` query params to pre-fill
  from a project or template context. "Deploy from" toggles between a Docker
  image and a git repo (see Git-based builds below), same toggle repeated on the
  service's own Source tab for editing after creation. Two submit actions share
  one `createServiceFromForm()` helper (`new/+page.server.ts`) that validates +
  creates the row: `create` (secondary button, "Create service", persists config
  only, same as before) and `createAndDeploy` (primary button, "Create and
  Deploy", calls `allowLongRequest(platform)` then
  `DeploymentService.deployService()` before redirecting straight to the new
  service's Overview tab instead of the services/project list). A min-height
  wrapper around the step content keeps the Next/Back button row's vertical
  position stable as steps of different heights swap in.
- `[serviceId]/+layout.server.ts`, ownership guard (id **and** userId must
  match, else 404) + syncs live Docker status on every visit. Tabs: **Overview**
  (deploy/start/stop/restart, live deploy progress panel, deployment history
  with expandable per-deployment logs, plus an embedded `LiveLogViewer`, see
  Logs below, shown once deployed so recent output is visible without switching
  tabs), **Source** (Deploy-from image/git toggle, image+tag or git repo fields,
  private registry, `updateSourceSchema`, its own `updateSource` action; split
  off Settings so "what gets deployed" has its own tab), **Logs** (live-streamed
  via a `+server.ts` GET returning a chunked `ReadableStream`, rendered through
  `$lib/components/live-log-viewer.svelte`, the same component embedded in
  Overview), **Env Vars**, **Volumes** (mount/unmount StorageVolumes, including
  a "New volume" modal, `$lib/components/new-volume-fields.svelte` shared with
  `/storage/new`, so a volume can be created and mounted without leaving the
  service), **Networking** (custom domain mapping; an **Access** section holds
  the per-app login wall, its allowed sign-in methods and its user/email/group
  allowlists, `updateAppAuth`, see Per-app login wall below; a **Network**
  section holds container port, protocol (tcp/udp/both), network mode
  (bridge/host, see below), and DNS-resolvability, `updatePortsSchema`, its own
  `updatePorts` action, moved off Settings; SSL section is a read-only explainer
  for the automatic-vs-custom-cert split, host ports are still never
  _published_/mapped by design even though host network mode now exists, see
  below), **Compute** (cpu/memory limits, `updateComputeSchema`, its own
  `updateCompute` action, moved off Settings), **Terminal** (interactive shell
  into the live container, see below), **Errors** (failed deployments + a live
  "container currently down" banner + "Application errors", persisted app-level
  warn/error `Logger` output attributed to this service, see
  `app_log`/`AppLogDTO` in Data model below; plus, when
  `currentStatus === "missing"`, a distinct banner with a "Resolve" button,
  `?/resolveOrphan`, calling `ServiceDTO.resolveOrphan()` to clear the stale
  `containerId`/`swarmServiceId` and put the row back to a clean, never-deployed
  shape so Deploy works again, see the `"missing"` `ContainerStatus` note under
  Docker integration below), **Settings** (name/slug/restart-policy, move
  between projects, save-as-template, auto-redeploy cron schedule, danger-zone
  delete, image/git/registry, port/network and cpu/memory fields all moved to
  their own tabs, see Source/Networking/Compute above)
- `[serviceId]/deployments/[deploymentId]/events/+server.ts`, the SSE stream the
  Overview tab listens on while a deploy is in flight (see Live progress below),
  and `.../progress/+server.ts`, the older `{log, status}` JSON endpoint, now
  the client's fallback when the stream can't be held open. The client
  pre-generates the deployment id itself (`crypto.randomUUID()`, set on the form
  via `formData.set("deploymentId", ...)` in `use:enhance`'s pre-submit
  callback) so it can start listening _before_ the deploy request even resolves,
  which is why the stream waits for the row instead of 404ing. Both are
  status-driven (they end once the deployment reaches a terminal status), which
  is also what makes resuming the progress view after a mid-deploy page reload
  work, `onMount` checks the latest deployment's status and `svc.currentStatus`
  and reattaches if either is still in-flight.

`src/routes/(protected)/projects/`, `templates/`, `storage/`, `authentication/`
mirror this pattern (list + `new/` create route + `[id]` detail where
applicable). `system-logs/` streams the Traefik container's own logs (see Docker
integration below).

### REST API (`src/routes/api/v1/`)

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
- `projects/`, `templates/`, read/create, same pattern, thinner (no lifecycle
  actions).
- `services/`, `projects/`, and `templates/`'s `GET`s are paginated
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

### Long-running requests and Bun's idle timeout (`$lib/server/long-request.ts`)

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

### OpenAPI (`$lib/openapi/`, `$lib/server/validation/api.ts`)

`GET /api/v1/openapi.json` serves a real OpenAPI 3.1 document, generated (not
hand-written) from `$lib/openapi/build.ts` + `registry.ts`. Request bodies are
the _actual_ zod schemas that validate each request at runtime
(`$lib/server/validation/api.ts`,
`createServiceApiBody`/`updateServiceApiBody`/`createProjectApiBody`, imported
by both the route files and `registry.ts`), converted to JSON Schema via zod
v4's native `z.toJSONSchema()`, one schema instance drives both validation and
docs, so they can't silently drift apart the way a hand-maintained spec would.
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

### Homerun CLI (`packages/cli/`)

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
`projects list`, `templates list`, no `create`/`update`/`delete` yet,
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

### API Docs page (`(protected)/api-docs/`)

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

### E2E browser tests (`tests/e2e/`, `playwright.config.ts`)

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
Access section's reveal-and-validate behaviour. Not covered: a real deploy needs
a Docker socket reachable from _inside_ the spawned app, which this bootstrap
doesn't wire up. Add browser-level cases here; don't re-prove API shapes
`tests/integration/` already covers directly and faster.

### The `$derived` + push/splice anti-pattern (real, tested bug)

**Real, tested-in-review finding**: three forms, the Settings page's OAuth
Providers list, `services/new`'s env-var rows, and the service Env Vars tab's
own rows, declared their editable row array with `$derived(...)` and then
mutated it directly (`rows.push(...)`/`rows.splice(...)`), which is exactly why
"Add provider" on the Settings page did nothing observable (the bug that
prompted this fix): a `$derived` value is computed from its dependencies, not a
mutable store, pushing onto it doesn't reliably stick the way it would on
`$state`. Fixed by converting all three to `let rows = $state(...)` seeded once,
with an `$effect` re-syncing from the source data
(`data.settings.oauthProviders`/`data.template`/`svc.envVars`) whenever it
actually changes, not on every keystroke, so in-progress edits aren't clobbered.
`templates/new/+page.svelte`'s equivalent env-var rows already used `$state`
correctly and was the reference proving the fix, if you're adding a new
push/splice-mutated row list anywhere in this app, copy that shape (or the
now-fixed three), never `$derived`.

### Release automation (`.releaserc.json`, `scripts/bump-version.ts`, `scripts/build-release-binaries.ts`)

**The CI pipeline builds each image once and reuses it.** Both
`pull_request.yaml` and `publish.yaml` run the same shape: `code_quality` →
`docker.yaml` (per image) → `e2e.yaml` → `docker-manifest.yaml` (per image) →
gate/release. The split between the last two is the point : `docker.yaml` pushes
**by digest only** (`push-by-digest=true`, no tag), so `e2e.yaml` can
`docker pull` that exact digest and run Playwright against the real artefact,
and `docker-manifest.yaml` only then applies the friendly tag (`pr-<n>`,
`vX.Y.Z`, `latest`). Nothing anyone can pull by name is ever published before
e2e has passed against it, and the app is built once per platform instead of
once for the image plus again from source for the tests. The per-platform
digests and the `docker-metadata-action` bake file travel between those
workflows as run artefacts, which is why they must stay in one workflow run
(`uses:`, not a separate `workflow_run`). Both arches build natively
(`ubuntu-24.04-arm` for arm64), never under QEMU.

Three consequences worth not re-deriving: **a fork builds but publishes
nothing** — `push: false` makes the build `type=cacheonly`, so no digest
artefact exists, which is why `e2e.yaml` takes a `pulled` input and falls back
to `bun run build:app`, and why every manifest job is gated on the PR not coming
from a fork. **`pr-cleanup.yaml`** deletes the three `pr-<n>` tags when a PR
closes, so the Docker Hub repos don't accumulate one per pull request; a 404
there is normal (e2e failed, so the tag was never created). And
**`code_quality.yaml` no longer runs e2e at all** — it is `lint` +
`docs-check` + `ts-test` only, with the heavy gates (`lint:ts`, `lint:tailwind`,
`check`, `test:unit`) skipped inside prek via `SKIP` and run as their own named
steps instead, so a red run names the gate that broke rather than burying it in
one `prek` log. Its `Codegen is current` step runs `bun run gen` and fails on
any resulting diff, which is what keeps `openapi.json`, `homerun.schema.json`
and `packages/cli/generated/` from silently going stale after a REST API change.

`semantic-release`, driven by conventional-commit messages (this repo's commits
already follow `feat:`/`fix:`/`chore:`, no new discipline required). Runs as a
new `release` job in `.github/workflows/publish.yaml`, alongside the existing
`code_quality`/`build` jobs, on every push to `main`; a non-releasable push
(docs/chore-only) is a no-op, not a failure. One version number covers the whole
repo, the root app plus `packages/agent`/`packages/installer`/`packages/cli`'s
own `package.json`s all get bumped together by `scripts/bump-version.ts` (an
`@semantic-release/exec` `prepareCmd`, not `@semantic-release/npm`, this repo
has no npm package to publish, and `npm`'s plugin still wants registry-shaped
config even with `npmPublish: false`; a small script fits this codebase's
existing "hand-roll a small thing rather than fight a mismatched tool" posture
better, same instinct as the cron matcher/SigV4 client).
`scripts/build-release-binaries.ts` cross-compiles all six
`agent`/`installer`/`cli` Linux binaries (x64 + arm64, each sub-project's own
`build:linux-x64`/`build:linux-arm64` scripts) so `.releaserc.json`'s
release-assets step has something to attach, directly serving the "installer
(and homerun agent) in each release artifact" TODO item, with the CLI's own
binary added the same way for consistency.

**Uses `@semantic-release/github`**, the official plugin: this repo is hosted on
GitHub (`github.com/orochibraru/homerun`) and runs on GitHub Actions. It
previously lived on a self-hosted Gitea and used
`@saithodev/semantic-release-gitea`; that migration is done, so don't
reintroduce Gitea-specific release/CI config.

**Container images go to Docker Hub, not GHCR**, deliberately:
`docker.io/orochibraru/homerun{,-agent,-docs}`. That's the one piece of the
pipeline that does _not_ follow the code host, so `docker.yaml`'s login takes a
real Docker Hub credential (`secrets.DOCKER_REGISTRY_PASSWORD`, an access token;
the Docker Hub username is the plain `registry_username` input, since it isn't
secret) rather than the built-in `GITHUB_TOKEN`.

**The release job needs `secrets.RELEASE_TOKEN`, not `GITHUB_TOKEN`**: a
fine-grained PAT scoped to this repo (Contents + Issues + Pull requests: write).
`@semantic-release/git` pushes the version bump straight to `main`, and a `main`
ruleset blocks pushes from anyone but a repo admin, which `github-actions[bot]`
isn't. It's threaded in twice, as `actions/checkout`'s `token` (git push auth)
and as the `GH_TOKEN` env var (`@semantic-release/github`'s API calls). The
`version` job's dry run takes it too, unlike the sibling `nuvio-web` repo this
CI shape is shared with: here that job's output also feeds the `binaries` job's
baked version, so it has to actually resolve rather than silently falling back
to a commit SHA.

**Job ids use `-`, never `:`** (`build-app`, not `build:app`). GitHub rejects a
colon in a job id outright and refuses to run the whole workflow file; the
Gitea-era config had `build:app` and got away with it.

**Fork PRs build but never push.** `docker.yaml` takes a `push` input (default
true); `pull_request.yaml` passes
`github.event.pull_request.head.repo.full_name == github.repository`, so a
same-repo PR still publishes its `pr-<n>` tag while a fork's build switches its
bake output to `type=cacheonly` and skips the registry login, the digest upload,
and the whole `merge` job. GitHub withholds secrets from fork PRs, so the login
there could only ever fail; this way the build is still a real gate (and still
warms the layer cache) without needing a credential. `secrets.registry_password`
is `required: false` for the same reason.

**Not verified**: an actual release running end-to-end on GitHub Actions
(creating a real tag/release and pushing the version bump back to `main`). The
earlier Gitea-era verification of `scripts/bump-version.ts` and
`scripts/build-release-binaries.ts` still stands (both were run for real
locally, all six binaries cross-compiled), since neither is host-specific.

### Shared deploy pipeline (`src/lib/services/deploy.service.ts`)

`DeploymentService.deployService(svc, userId, clientDeploymentId?)` is the one
pull-or-build→create-container→start implementation, used by the service
Overview page's `deploy` action, `POST /api/v1/services/[serviceId]/deploy`, and
the cron redeploy scheduler (below). Branches on `svc.buildSource` right at the
top: `"image"` pulls as before; `"git"` calls `DockerService.buildFromGit()`
(below) and overwrites `svc.image`/`svc.tag` with the resulting local tag
_before_ `createAndStartContainer` runs, so the container step never needs to
know which path produced the image. Returns
`{success, deploymentId, containerId?, error?}` rather than throwing, callers
decide how to surface failure (a SvelteKit `fail()`, a JSON error body, a
scheduler log line). Don't reimplement this inline in a new call site; extend
the shared method instead.

### Compose import (`$lib/compose-import.ts`, `$lib/services/compose-import.service.ts`, `(protected)/services/import/`)

Paste a `docker-compose.yaml`, get Homerun rows. Two halves, deliberately split:
`$lib/compose-import.ts` is a **pure parser** (the `yaml` package, no DB, no
Docker) turning compose text into a `ComposeImportPlan`
(`services: ComposeServiceDraft[]`, plus file-level `warnings`/`networkNames`/
`volumeNames`), covered directly by `tests/unit/app/compose-import.test.ts`;
`compose-import.service.ts` is the row-creating half (`ComposeImportService`, a
plain instance singleton) that turns a plan into `ProjectDTO`/`ServiceDTO`/
`StorageVolumeDTO`/`ServiceVolumeDTO` rows. The route
(`services/import/+page.server.ts`) has a `preview` action (parse, return the
plan) and an `import` action that **re-parses the pasted text server-side**
rather than trusting a plan round-tripped through the client.

What maps: `image` (split via `splitImageRef`, which handles a registry port and
strips a digest), `environment` in both the map and `KEY=VALUE` list forms,
`ports`/`expose` (the _container_ side; `parsePortEntry` handles
`"8080:80/udp"`, `"127.0.0.1:8080:80"`, a bare number, and the long
`{target, protocol}` form), `restart` (`on-failure:3` → `on-failure`), `volumes`
(short and long syntax), `depends_on`, `network_mode: host`, `container_name`,
`deploy.resources.limits.cpus`/`memory` (and the legacy `cpus`/`mem_limit`).
Everything else is a **warning on the preview, not a silent drop**: `build:`,
`command`, `entrypoint`, `healthcheck`, `env_file`, `labels`, capabilities,
devices, `privileged`, secrets/configs, top-level extra networks, relative bind
mounts (Homerun needs an absolute host path), anonymous volumes, and the host
side of every port mapping.

Two mapping decisions worth not re-litigating: **`dnsResolvable` is true only
when the compose service published a host port** (`ports:`), false when it only
`expose`d one, which is the closest honest translation of "this one was meant to
be reachable from outside"; and **one compose file maps onto one Homerun
project**, since a project already _is_ a Docker network here, so a file's own
multiple `networks:` can't be reproduced and says so in a warning.

`orderByDependencies` topologically sorts the drafts (falling back to file order
on a cycle rather than throwing), which is what makes "Import and deploy" queue
the stack in `depends_on` order : the last service is passed to
`DeploymentService.enqueueStackDeploy` as the primary and the rest as its
dependency chain, reusing the template-links machinery rather than a second
ordering implementation. Storage volumes are de-duplicated against the user's
existing ones by `(kind, source)`, so importing two files that share a named
volume mounts the same row twice instead of creating a duplicate.

### Smart service links on create (`$lib/service-link.ts`, `service-link-picker.svelte`)

The Environment step of `services/new` has a "Link a service" picker next to
"Paste .env": pick any service the user already owns (**regardless of project**,
which is the whole point : every bridge-mode service is on the shared network
and reachable at `<slug>:<port>` anyway, so linking is purely about generating
the env vars, there's no networking to set up) and it writes connection env rows
into the existing key/value editor.

`$lib/service-link.ts` is a pure, tested module
(`tests/unit/app/service-link.test.ts`), no DB or Docker:
`detectLinkEngine(image)` matches the image ref against a small table (postgres
incl. timescale/postgis, mysql/percona, mariadb, mongo, redis/valkey/dragonfly,
rabbitmq, else `generic`), `credentialsFor` reads that engine's own conventional
env vars off the linked service's stored `envVars`
(`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`, `MYSQL_*`/`MARIADB_*`
including the root-password fallback, `MONGO_INITDB_*`, `REDIS_PASSWORD`,
`RABBITMQ_DEFAULT_USER`/`_PASS`), and
`buildLinkEnv({format, prefix, target, urlKey})` produces the rows. Three
formats: `"url"` (a URI, `postgres://user:pass@slug:5432/db`), `"jdbc"`
(relational engines only, credentials as query params, `supportsJdbc` on the
engine gates the option), and `"vars"`
(`<PREFIX>_HOST`/`_PORT`/`_USER`/`_PASSWORD`/`_DB`, only emitting the ones that
exist). Every key name is a **default, not a rule**: the picker exposes the URL
variable name and the variable prefix as editable inputs
(`defaultUrlKey`/`defaultVarPrefix`, e.g. `POSTGRES_URL` / `POSTGRES`, or
`<SLUG>_URL` / `<SLUG>` for a generic service), which is what the TODO item
asked for. Values are URL-encoded, so a password with a space or an `@` survives
the round trip.

The picker merges into `envRows` through the same `mergeEnvRows` helper
`EnvPasteButton` uses, so an existing key is overwritten in place rather than
duplicated. It's a preview-then-add dialog, not an async mutation, which is why
it's one of the documented `toast.success` exceptions rather than a promise
toast.

### Live progress: SSE, streams, and why not WebSockets

**This stack has no WebSocket route API.** SvelteKit 2.70 (the latest stable,
checked) has no `socket`/upgrade export for `+server.ts`, and grep confirms the
string "websocket" doesn't appear anywhere in the installed `@sveltejs/kit`;
`@orochibraru/svelte-smol` is ready for one (`getHandler()` forwards a
`server.websocket()` to `Bun.serve`, printing "WebSocket: disabled" when the
framework doesn't provide one), so the gap is SvelteKit's, not the adapter's.
Kit 3.0.0-next exists but adopting a `next` major for this isn't worth it. So
the transport ladder here is, in order of preference:

- **A `ReadableStream` response** for one-way server→client byte streams that
  aren't event-shaped : container logs (`services/[serviceId]/logs/+server.ts`)
  and the terminal's output channel. Already push-based, **not polling**,
  despite what TODO.md assumed.
- **Server-sent events** for one-way server→client _event_ streams : deploy
  progress (below). `text/event-stream` is the one content type
  `@orochibraru/svelte-smol` auto-exempts from Bun's `idleTimeout`, so an SSE
  route needs no `allowLongRequest()` call, which is a real advantage over a
  bare chunked stream here.
- **Chunked HTTP both ways** where a client→server channel is genuinely needed :
  only the web terminal, which already does this (`terminal/[sessionId]/input`),
  and which needed its own raw `Bun.connect()` hijack anyway (see Web terminal).
- **A remote `query`/`command`** (see Remote functions below) for any
  dashboard-only request/response call that isn't a stream : a panel that loads
  behind a skeleton, a poll, a small mutation the bell or a picker fires. This
  is what replaced the hand-written `fetch` + internal `+server.ts` pairs those
  surfaces used to need.
- **Plain REST/form actions** for everything else. The REST API stays the CLI's
  contract and the OpenAPI document's source of truth, and remote functions
  deliberately don't touch it : they're an internal dashboard transport, not a
  second public API. A form that mutates real state still goes through a form
  action with `enhanceToast`, not a command.

**Deploy progress is SSE** (`$lib/server/deploy-progress-stream.ts`, served by
`services/[serviceId]/deployments/[deploymentId]/events/+server.ts`), replacing
the Overview tab's 1s `fetch` poll. The server-side loop still reads the
`deployment` row on an interval, but only _pushes_ when the serialized snapshot
actually changes, so a client sees a new line the moment it lands instead of up
to a second later, over one connection instead of one request per second. Two
details are load-bearing: the stream **waits for the deployment row to appear**
(up to 60s) instead of 404ing, because the Overview tab starts listening before
its own deploy POST has been handled and an `EventSource` treats an HTTP error
as fatal and never reconnects; and the client's `onerror` **falls back to the
old polling loop** (`pollProgress`, still there, still the resilient path)
rather than leaving the panel stuck, for a buffering proxy or a dropped
connection. The JSON `progress/+server.ts` endpoint stays for exactly that
fallback.

**Deploy phases** (`$lib/deploy-phases.ts`) give that panel structure instead of
a raw log tail: `deployService` appends a marker line (`phaseLine(id)`, rendered
`▸ Fetching image`) as it enters each of `config`/`volumes`/`image`/`container`/
`network`/`ready`, and `deployPhaseStates(log, status)` derives per-phase
`done`/`active`/`failed`/`pending` from the last marker in the log plus the
deployment's status. The markers are ordinary log lines, so the deployment
history's raw-log panel keeps working untouched and nothing else in the pipeline
had to learn about phases. There is deliberately **no "checking container
health" phase**: health-gated rollout isn't built (see Planned features), and a
phase that always passes instantly would be a lie.

### Remote functions (`src/lib/remote/*.remote.ts`, `$lib/server/remote-auth.ts`)

SvelteKit's remote functions are enabled
(`kit.experimental.remoteFunctions: true`, set inline in `vite.config.ts`, which
is where this repo's whole Kit config lives, there is no `svelte.config.js`).
They're the transport for dashboard data that a page doesn't need in order to
render : a panel that can come in behind a skeleton, a poll, a picker's
on-demand lookup, and the small mutations those surfaces fire. Every one lives
in `src/lib/remote/`, and Svelte's `compilerOptions.experimental.async` is
deliberately **not** enabled, nothing here needs `await` in a template.

**What is and isn't allowed to move here.** Anything a page's own correctness
depends on stays in `load` : the signed-in user, their role/`isAdmin`, their
appearance preferences, instance settings, and every entity list a route
renders. What moved is only data whose absence for a few hundred milliseconds is
a skeleton rather than a broken page. Concretely:

- `system-stats.remote.ts`, `getSystemStats` : the dashboard's Host Resources
  panel, which used to be fetched in the dashboard's `load` (blocking the whole
  page on a `df` + `nvidia-smi` shell-out) _and_ re-fetched every 5s from
  `/api/v1/system-stats`. `$lib/components/host-resources.svelte` owns the query
  and the poll now. The REST route stays : it's in the OpenAPI document and is a
  public API surface, unrelated to the dashboard's own rendering.
- `notifications.remote.ts`, `getNotifications` + the
  `markNotificationRead`/`markAllNotificationsRead`/`deleteNotification`
  commands : the bell's feed. It used to be fetched in
  `(protected)/+layout.server.ts` (so **every** protected page load paid for 20
  notifications plus an unread count, whether or not anyone opened the bell) and
  mutated through three one-line `+server.ts` routes each followed by a
  `refreshAll()`, which re-ran every `load` on the page. Each command now calls
  `getNotifications().refresh()` on the server, so the updated feed rides back
  on the mutation's own response.
- `jobs.remote.ts`, `getJobQueue` : the Scheduling page's job-queue panel. Its
  3s poll used to be a `refreshAll()`, re-running that page's entire (large)
  `load` every tick to update one panel.
- `git-repos.remote.ts`, `listProviderRepos`/`hasDockerfile`, and
  `image-check.remote.ts`, `checkImage` : the git repo picker and the
  image-exists warning, both of which were duplicated verbatim between
  `services/new` and the service Source tab. They're now one shared component
  each (`git-repo-picker.svelte`, `image-check-warning.svelte`) over one shared
  query.

**Auth is not inherited.** A remote function is its own endpoint : the
`(protected)` layout's `load` guard never runs for one, exactly like a
`+server.ts` route. Every query/command starts with `requireUser()`
(`$lib/server/remote-auth.ts`), which reads `getRequestEvent().locals.user` and
`error(401)`s otherwise. `hooks.server.ts` populates `locals` for these requests
the same as any other, so cookie sessions and API keys both work. Anything
admin-only would need its own `locals.isAdmin` check on top, same as an
admin-only route's `load`.

**Arguments are validated, not cast.** A query/command taking an argument passes
a zod schema as its first parameter (`query(z.string(), ...)`), the same "one
schema, real runtime validation" posture as the REST API's own
`$lib/server/validation/api.ts`. Don't reach for `"unchecked"`.

**Two consumption patterns, and the difference matters.** A `RemoteQuery` is a
promise, but it's a _stable_ object : `{#await someQuery}` renders once and will
**not** re-render when `refresh()` lands, because the awaited expression never
changes identity. So:

- A query that refreshes in place (a poll, a command's single-flight update) is
  read through its reactive accessors, `query.ready`/`query.current`/
  `query.error`, with the pending branch rendering
  `$lib/components/skeleton.svelte`. `host-resources.svelte`,
  `job-queue-panel.svelte` and `notification-bell.svelte` are the reference
  shapes.
- A one-shot, user-triggered lookup assigns a fresh promise to `$state` and
  `{#await}`s that, which is what makes the block re-run per invocation.
  `git-repo-picker.svelte` (a "List repos" click, then a Dockerfile check for
  the picked repo) is the reference shape.

**A background load through a remote query is still one of the documented
`toast.promise` exceptions** (see Conventions above) : it renders its own inline
spinner/skeleton and reports failure inline, it doesn't narrate itself through a
toast. Mutations that a user deliberately submits still belong in a form action
with `enhanceToast`, not a command.

### Cron jobs (`cron_job`/`cron_job_run` tables, `CronJobDTO`, `$lib/services/cron-job.service.ts`, `/cron-jobs`)

A user-defined scheduled task that isn't tied to a service, unlike
`service.cronSchedule` (which redeploys an existing service). Two kinds:

- **`kind: "image"`** runs a throwaway container via `DockerService.runOneOff`
  (see the one-off mixin under Docker integration): image + tag, an optional
  command override, env vars, and optional private-registry credentials
  (`registryPasswordEnc`, same AES-256-GCM scheme as everything else). The
  command override is parsed by `$lib/command-parse.ts`'s `parseCommand`, a
  small pure tokenizer (quotes group, backslash escapes, and a leading `[` is
  taken as Docker-style JSON exec form), tested in
  `tests/unit/app/command-parse.test.ts`.
- **`kind: "exec"`** runs `/bin/sh -c <command>` where the app itself runs, via
  `execFile` with a real `timeout`. **Admin-only, enforced in
  `$lib/server/cron-job-form.ts`** (shared by both the create and edit actions,
  so neither can skip it) rather than only hidden in the UI : it inherits this
  process's own privileges. That's the same class of power the Docker socket
  already gives any user of this app, but it's a different blast radius (the
  app's own filesystem/credentials), hence the gate.

`CronJobService.runJob(job)` is the single entry point both the scheduler and
the manual "Run now" funnel through, and it writes one `cron_job_run` row per
attempt on every path including a thrown runner, same shape as
`BackupService.runBackup`. A run keeps `exitCode`, `success`, `error`, and the
captured stdout+stderr (`CronJobRunDTO.finish` keeps the **last** 64k characters
rather than the first, since a failure's useful output is at the end).

Wiring follows the existing patterns exactly rather than inventing anything:
`JobType` gains `"cron_job"` (`$lib/types.ts` + `JOB_TYPE_LABELS`), with its own
zod payload (`queue/payloads.ts`) and handler (`queue/handlers.ts`), an
`enqueueCronJobRun` helper (`cron-job-queue.ts`, mirroring `backup-queue.ts`)
keyed `cron_job:<id>` for both dedupe and lock so one job never runs twice
concurrently, and a fourth `BaseScheduler` subclass
(`cron/cron-job-scheduler.ts`, composed into `CronService` and started from
`hooks.server.ts`) with the same due-check plus same-minute double-fire guard as
the redeploy and backup schedulers. Routes are the usual list/new/detail trio
(`/cron-jobs`, `new/`, `[cronJobId]/`) sharing one form component
(`$lib/components/cron-job-fields.svelte`) and one server-side parser
(`$lib/server/cron-job-form.ts`); enabled jobs also render on the Scheduling
page next to cron redeploys and backups.

**Not remote-host aware**: an image job always runs on the local daemon
(`runOneOff` takes a `remote` param, but nothing sets it here yet). **No per-run
streaming either**: output is captured and shown once the run finishes, which is
why a long-running job's page shows a spinner rather than a live tail.

### Template links (`template_link` table, `TemplateLinkDTO`, `$lib/services/template-links.ts`)

A template can link to other templates so deploying it deploys its companions
too, e.g. a WordPress-shaped template linking to a "MySQL" template, or a worker
linking to a "Redis" one : `templates/new`'s "Linked containers" section lets a
template owner check any other _leaf_ template (built-in or their own, shown
with its image/tag/port/env vars so there's enough to decide by) to link it,
with an optional alias (defaults to the linked template's own slugified name
when left blank). Deliberately two levels deep only, not a general DAG :
`TemplateLinkDTO.create`'s caller (`templates/new/+page.server.ts`) rejects
linking to a template that itself already has links, so a link's target is
always a leaf. This keeps env-var token resolution (below) simple, one level of
substitution, no cycle detection needed.

An env var on the _primary_ template can reference a linked template via
`{{alias}}` (resolves to the linked service's generated slug, its internal DNS
hostname on the shared network regardless of project, same
`http://<slug>:<port>` addressing every service already gets) or
`{{alias.ENV_KEY}}` (resolves to that linked service's own resolved value for
that env var, e.g. `{{db.POSTGRES_PASSWORD}}`). Resolution
(`$lib/services/template-links.ts`'s `resolveLinkTokens`) leaves an unknown
token untouched rather than stripping it, so a typo'd alias fails loud (visible
literally in the deployed env var) instead of silently producing an empty value.
Linked templates' own env vars are used as-is, not further resolved : only the
primary can reference `{{alias}}` tokens, not link-to-link.

Deploying from a linked template (`services/new`'s `create`/`createAndDeploy`
actions, via `buildTemplateLinkContext`/`createLinkedServices`) : if the service
being created has no project yet, one is auto-created (named after it) so the
whole stack shows up grouped ; each linked service gets a deterministic slug
(`<primary-slug>-<alias>`, de-duplicated against existing services) and deploys
from its own template's image/tag/port/envVars/resources, created
`dnsResolvable: false` by default (a database/cache/worker doesn't usually want
a public subdomain). `createAndDeploy` deploys every linked service before the
primary, same "bring up dependencies before dependents" ordering
`docker compose`'s `depends_on` implies, though nothing here actually waits for
a linked service to be _healthy_, just created and started.

### Built-in template catalog and gallery (`builtin-templates.ts`, `builtin-templates-apps.ts`, `template-icon.svelte`, `templates/[templateId]/`)

55 built-in templates (up from the original 8), split across two data files
purely to stay under `noExcessiveLinesPerFile`'s 680-line limit:
`src/lib/server/db/builtin-templates.ts` (the original 8 infra templates plus
Media/Network/Dashboard/Productivity/Finance category entries, also exports the
`BuiltinTemplate`/`BuiltinTemplateLink` interfaces both files use) and
`src/lib/server/db/builtin-templates-apps.ts` (17 more, Analytics/Monitoring/
Development/other categories). `src/lib/server/db/seed.ts` is a thin
orchestrator importing both arrays plus `BUILTIN_TEMPLATE_LINKS` (3 entries:
WordPress→MySQL, Umami→Postgres, Miniflux→Postgres, wiring the Template links
feature above into real built-ins) and inserting all of it with
`onConflictDoNothing()`, same idempotent-seed-on-boot pattern as before. Every
image was verified real via `docker manifest inspect <image>:<tag>` (fast, no
full pull) before being added, not just guessed from a project's README.

Every template row (`template.category`/`sourceUrl`/`websiteUrl`, the latter two
added to `schema.ts` and `TemplateDTO.NewTemplateInput` alongside the
pre-existing `icon`) can carry a source-code and a website link, shown as
external-link buttons on the template details page (below); either can be `null`
(some projects genuinely have no separate marketing site).

**Icons are real bundled app logos, not generic per-category lucide icons.**
`static/template-icons/` holds 55 downloaded SVG/PNG files (named
`<id-without-builtin->.{svg,png}`, e.g. `redis.svg`, `ghost.png`), sourced from
[selfh.st/icons](https://selfh.st/icons/) (the de facto self-hosted-app icon
set, also used by Homepage/Dashy/Homarr), CC BY 4.0, bundled locally rather than
hotlinked from its CDN for the same "self-hosted app shouldn't need outbound
internet to render" reasoning as the Swagger UI docs page (see API Docs page
below) — attribution credited in the templates gallery's own footer. A
template's `icon` column holds a bundled filename (`"redis.svg"`) when a real
logo exists, or `null`/a legacy category string for one that predates this
(anything without a `.` in it). `$lib/components/template-icon.svelte` is the
one place that renders a template's icon anywhere in the app (the gallery, the
details page, template-linking pickers on `templates/new`/`services/new`):
`icon.includes(".")` picks the bundled `<img>` path (`/template-icons/<icon>`),
otherwise it falls back to
`templateCategoryIcon(category)`/`templateCategoryColor(category)`
(`$lib/constants.ts`, `TEMPLATE_CATEGORY_ICONS`/`TEMPLATE_CATEGORY_COLORS`,
keyed by the `category` column) — one lucide icon and one accent color per
category (e.g. media is rose, database is emerald, monitoring is cyan), not a
flat single fallback color, so an app without an official logo is still visually
distinguishable at a glance from its neighbors. `templateIcon()`/
`TEMPLATE_ICONS` (the old flat category→icon map this replaced) no longer exist.

The gallery (`templates/+page.svelte`) uses the shared list-page toolkit (see
Shared UI components above) for its search (matches name/description/image) and
category filter (pills built from whatever categories are actually present
rather than a hardcoded list, `TemplateDTO.listCategories`), plus a list/card
`ViewModeToggle` (`new ViewMode("templates", "card")`, card is the default here,
unlike every other list page). This replaced the page's own earlier bespoke
search-input-plus-`Drawer` implementation (`$lib/components/ui/drawer`,
vaul-svelte's `direction` prop), now generalized into `entity-toolbar.svelte`
and shared with every other list page instead of being templates-only. The
built-in and custom sections paginate **independently**, 24 per page each,
`TemplateDTO.listPaged(userId, "builtin" | "mine", query)` called twice with two
separate `ListQuery`s (`pageParam: "bpage"` / `"mpage"`, see Server-side list
pagination above), one shared search/category toolbar filtering both, two
`<Pagination>` footers reading their own param. Each card/row links to
`templates/[templateId]/`, a details page (`+page.server.ts` guards via
`TemplateDTO.usable`, same built-in-or-owned rule every deploy-from-template
path uses) showing the full description, container port/CPU/memory/env vars, the
source/website links, any linked companion templates (below), and the GitHub
repo panel/readme (below). Every card and the details page carry two actions
instead of one: **Quick Deploy** (primary) calls a `quickDeploy` form action
(`$lib/services/template-links.ts`'s `quickDeployFromTemplate()`, shared by both
routes) that creates the service straight from the template's defaults
(name/slug auto-generated via `slugify`) and deploys it immediately, no wizard;
**Configure** (secondary) is the old single "Deploy" button, renamed since it
only navigates into `services/new` (carrying `templateId`, and `projectId` when
arrived at from a project) to let the user tweak first. The gallery's
`quickDeploy` action returns a plain success object (not a redirect) so
`use:enhance` can show a `toast.success` with a "View" button instead of yanking
the user out of the grid mid-browse, letting several templates get
quick-deployed back to back; the details page's own action still `redirect()`s
straight to the new service, no grid to lose there.

**GitHub repo enrichment** (`$lib/services/github-repo.service.ts`): when a
template's `sourceUrl` is a `github.com` URL, the details page's `load` calls
`getGitHubRepoInfo()`, which resolves owner/repo from the URL and hits
`api.github.com`'s repo/releases/readme endpoints (unauthenticated, so the usual
public 60 req/hr-per-IP limit applies) for star count, last-push time, latest
release tag, and the rendered readme. Returned **without being awaited** in
`load()`, SvelteKit streams it, so a slow/rate-limited GitHub response doesn't
block the rest of the page; `+page.svelte` renders it via
`{#await data.github then repo}`. Every fetch has an 8s `AbortSignal.timeout`
and the whole thing is wrapped in try/catch, GitHub being slow or down never
breaks the page, `getGitHubRepoInfo()` just resolves to `null` and the panel/
readme sections don't render. Results are cached in-memory per `owner/repo` (1h
TTL, HMR-safe `globalThis` singleton, same pattern as the db client) since every
viewer of the same template would otherwise re-hit the same three endpoints. The
readme is rendered with `marked` (already a dependency, used by `packages/docs/`
for the operator guides) through a custom renderer that resolves relative
image/link paths against the repo's default branch (`raw.githubusercontent.com`
for images, a `blob/<branch>/` GitHub URL for links), then run through
`sanitize-html` (a new dependency, added specifically for this) before being
sent to the client and rendered via `{@html}`. This sanitization step is
load-bearing, not decorative: a template's `sourceUrl` is user-settable (a
developer can save any service as a template with any source URL), so a
malicious template could point at a repo whose README is crafted to exploit gaps
in GitHub's own rendering; sanitizing server-side means the client only ever
receives an already-restricted tag/attribute allowlist, regardless of what
GitHub returned.

### Git-based builds (`src/lib/services/docker/git-build.ts`)

A service's `buildSource` is `"image"` (bring-your-own, the default) or `"git"`,
set on the new-service form or edited later on the Source tab, both share the
same "Deploy from" toggle UI. Git mode shells out to the system `git` binary
(`clone --depth 1 --branch <ref> --single-branch`, same "shell out to a
well-known CLI" precedent as `tar`/`df`/`nvidia-smi` elsewhere) into a temp
directory, then `DockerService.buildFromGit()` calls dockerode's `buildImage()`
against that directory (tar'd internally by dockerode, not manually) and tags
the result `homerun-build-<slug>:<timestamp>`, a fresh tag every build, same
"never reuse a name across deploys" precedent as container names. Progress lines
stream into the deployment log exactly like `pullImage`'s layer-status events
(filtered to status changes, not every line, build output is chattier than a
pull). The temp clone directory is always removed afterward (`finally`), success
or failure. A bare commit SHA doesn't work (shallow clone by branch/tag only,
not by arbitrary ref).

Any git-clone-able HTTPS URL works, this is what makes it "Git providers,
including self-hosted Gitea" without any provider-specific API integration for
the clone/build step itself: cloning is provider-agnostic at the URL level, so
GitHub/GitLab/a self-hosted Gitea instance/anything else all just work the same
way. There's still no webhook/auto-deploy-on-push, a git-mode service is
redeployed the same way an image-mode one is (manually, or via its own
`cronSchedule` for `:latest`-tracking-equivalent auto-rebuilds). There **is**
now a repo-browsing UI and OAuth-based private-repo access, see Git provider
connections below; a private repo can still fall back to a token embedded in the
URL (`https://TOKEN@host/...`) without connecting a provider at all.

**Build cache and build servers** (`build_cache_registry`,
`service.buildCacheRegistryId`/`buildServerRemoteHostId`,
`/build-cache-registries`): a git-mode service can name a registry credential to
use purely as a layer cache, `git-build.ts` pulls `<registry>/<cache ref>`
before the build, passes it as `cachefrom`, and pushes the fresh layers back
afterward. Both directions are best-effort: a missing cache image or a failed
push logs and continues, it never fails the build. **Real, tested finding**: the
classic (non-BuildKit) build API this app uses wants `cachefrom` as a
JSON-encoded _array string_ despite `@types/dockerode` typing it as a plain
string, a bare string 400s with `error reading cache-from: invalid character`;
and `BUILDKIT_INLINE_CACHE` is a BuildKit-only concept the classic builder warns
about and ignores, real reuse comes from the cache image's own layers (verified
live, a repeat build showed "Using cache" for every step).
`buildServerRemoteHostId` picks a _different_ host to build on than the one the
service deploys to (any registered Remote Host, see Build servers below);
`deploy.service.ts` rejects that combination outright unless a cache registry is
configured too, since publishing through that registry is the only way the built
image reaches the deploy target.

### Git provider connections (`instance_settings.gitProviders`, `git_connection` table, `$lib/services/git-provider.service.ts`, `/git-providers`)

Separate from the git-clone-based builds above, this is what makes the Source
tab's "Browse repos" picker possible instead of pasting a raw URL. Two layers,
matching how OAuth generally works: an **OAuth App** registered once per
provider (GitHub/GitLab/self-hosted Gitea/Bitbucket) on that provider's own
site, configured on the `/git-providers` page (admin-only to add/remove,
DB-backed, `instance_settings.gitProviders` jsonb array, same "settings stored
in the DB via a form" convention as SMTP/OAuth-login providers, not env-only);
and a **connection**, one user's own OAuth authorization against one configured
provider (`git_connection` table, `userId` + `providerId`, AES-256-GCM-encrypted
access/refresh token), every developer connects their own account from the same
page, admin-configuring-the-app is a one-time step separate from each user's own
connect.

`GitProviderService` (`$lib/services/git-provider.service.ts`) implements one
standard OAuth2 authorization-code flow, parameterized per provider kind
(`endpoints()`, authorize/token/API base URLs and scope differ; Bitbucket
authenticates its token exchange via HTTP Basic instead of body params,
everything else is uniform). `createState()`/`verifyState()` sign a stateless
CSRF state param with `config.auth.secret` (HMAC + `timingSafeEqual`) rather
than a DB-backed state table, nothing to clean up, verified purely from the
value itself. The OAuth round-trip lives under
`/api/v1/git-providers/[providerId]/{connect,callback}` (outside `(protected)/`
for the same reason the REST API is, a provider's own redirect can't carry
cookies through a page-load auth guard the same way). The Source tab's repo
picker (`$lib/components/git-repo-picker.svelte`) lists the connected account's
repos and checks for a `Dockerfile` at a given ref through
`$lib/remote/git-repos.remote.ts`, not a `+server.ts` route, see Remote
functions below; both go through `GitProviderService.listRepos`/`hasDockerfile`,
which branch per-kind the same way `endpoints()` does.

**Not live-tested against a real registered OAuth App**, unlike everything else
in this document's "real, tested" notes, this one couldn't be verified
end-to-end in the session that built it: doing so requires an admin to actually
register an OAuth App on GitHub/GitLab/Gitea/Bitbucket's own site first, with a
real callback URL, which nothing server-side can do standalone. Built carefully
from each provider's own standard, well-documented OAuth2 + REST API shapes;
verify the first real connect by hand once an OAuth App exists.

### Build servers (`remote_host` table, `RemoteHostDTO`, `/remote-hosts`)

**A registered remote host is a build server, nothing else.** Placement is
Swarm's job (see Swarm mode below): capacity comes from joining a node to the
swarm, not from pointing a service at a second daemon. `service.remoteHostId`,
the Settings tab's "Deploy target" picker, `resolveTarget`, `connectionFor` and
every remote branch in `deploy.service.ts`/`service-lifecycle.service.ts`/
`docker/reconcile.ts` were removed (migration `drizzle/0022_shiny_shiva.sql`).
Deploys run on the local daemon, or as a swarm service on the local manager.
What survives is `service.buildServerRemoteHostId`: a git-mode service can build
its image somewhere other than where it runs, which matters because a swarm
manager shouldn't have to also be the box with the build cache and the CPU
budget.

Two connection kinds (`remote_host.kind`, chosen on the "new host" form's
connection-type toggle), both real build servers:

- `"docker"` (the original/default): name + `tcp://host:port` [+ optional TLS
  client cert] or `ssh://user@host`, a raw Docker Engine connection, built
  through dockerode's own `buildImage()`.
- `"agent"`: name + `agentUrl`/`agentTokenEnc`, a registered Homerun Agent (see
  below) instead, token-authenticated HTTP rather than exposing the daemon
  itself, built through its own `POST /v1/build`. The token is verified against
  the agent (`AgentClientService.verifyToken`, which hits the authenticated
  `/v1/stats`) before the row is saved.

`RemoteHostDTO.resolveBuildTarget(hostId, userId)` is the one place a host id
becomes a `RemoteExecutionTarget` (`{kind: "local"}` /
`{kind: "docker", connection}` / `{kind: "agent", connection}`);
`deploy.service.ts` branches on that `kind` to route the build through
`DockerService` or `AgentClientService`. `RemoteHostDTO.listBuildServers()` is
what the Source tab's build-server picker reads : every registered host
qualifies, there's no per-host opt-in flag. `services/docker/client.ts`'s
`getDocker(remote?: RemoteHostConnection)` (exposed as
`DockerService.getDocker`, see Docker integration below) caches one dockerode
client per host (keyed by remote host id, `"local"` for the default) in the same
HMR-safe `globalThis` pattern as the db singleton, for `"docker"` hosts.

**A build server always needs a cache registry.** The built image lands on the
build server's own daemon, which by definition isn't the daemon the service
deploys to, so the registry is the only way it gets across; `deploy.service.ts`
rejects the combination outright rather than deploying a tag that doesn't exist
locally. The `git clone` step itself always happens on this host first, only the
Docker build runs remotely.

### Custom SSL certificates (`src/lib/services/docker/custom-ssl.ts`)

Per-service, only meaningful once `customDomain` is set (a domain outside this
instance's own base domain, so Traefik's automatic ACME resolver can't cover
it), cert/key PEM stored encrypted
(`service.customSslCertEnc`/`customSslKeyEnc`, same AES-256-GCM scheme as
`registryPasswordEnc`), edited on the Networking tab's SSL section.

`DockerService.syncCustomSslConfig(svc)` runs after every Networking save. It's
a **deliberate no-op unless `config.traefik.dynamicConfigDir` (env
`TRAEFIK_DYNAMIC_CONFIG_DIR`) is set**, this app never modifies the live Traefik
container's command/mounts itself (that's the same "don't touch infra without
the admin's own action" boundary as the build-server feature's Docker daemon
connections, just applied to Traefik instead). When it _is_ set, it decrypts the
cert/key and writes three files into that directory: `certs/<slug>.crt`,
`certs/<slug>.key`, and `<slug>-tls.yml` (a Traefik file-provider dynamic config
pointing at the other two), or removes all three if the cert's been cleared or
the domain's changed. `tools/compose/base.compose.yaml` (the shared Traefik
definition every root compose file extends, see Compose files below) has the
exact commented-out Traefik flags
(`--providers.file.directory`/`--providers.file.watch`) and bind mount to
uncomment, at the same host path as `TRAEFIK_DYNAMIC_CONFIG_DIR`, a one-time
`docker compose up -d` the admin runs themselves; Traefik's file provider then
picks up changes on its own (`watch=true`), no restart needed per-certificate
after that initial setup.

Verified live: the encrypted round-trip, the no-op path when the dir is unset,
and, with a real directory configured, the three files actually landing with
correct byte-for-byte content, plus correct removal on clear. **Not verified**:
Traefik itself picking up the config, since that requires the live container
change this app deliberately doesn't make.

### DNS automation: Cloudflare and Pangolin (`src/lib/services/cloudflare.service.ts`, `src/lib/services/pangolin.service.ts`)

The DNS-provider automation gap this doc used to list under Planned features is
closed: two independent, optional integrations, configured on `/settings`, both
DB-backed on `instance_settings`, both unset by default (inert until
configured), and both can be turned on simultaneously (they run independently).
Both are plain classes with static methods that re-read `InstanceSettingsDTO` on
every call rather than caching, the admin can change credentials mid-session and
syncs are infrequent (once per deploy), same reasoning as `GitProviderService`.
Both fire from the same spot, `deploy.service.ts`, right after a successful
**local** deploy with `dnsResolvable` set, fire-and-forget (`.catch(() => {})`),
never able to fail the deploy itself, only log+warn on error.

- **`CloudflareService`**: for instances that own DNS on Cloudflare directly.
  `syncDnsRecord(hostname, target)` upserts a CNAME (`<slug>.<baseDomain>` →
  `baseDomain`) via the Cloudflare v4 REST API; `deleteDnsRecord(hostname)`
  removes it on service delete; `verifyZoneAccess(token, zoneId)` backs the
  Settings page's "Test connection" button. Config: `instanceSettings`'s
  `cloudflareApiTokenEnc` (AES-256-GCM, same scheme as every other `*Enc`
  column) + `cloudflareZoneId`.
- **`PangolinService`**: for instances fronted by a self-hosted
  [Pangolin](https://github.com/fosrl/pangolin) tunnel/reverse-proxy manager
  instead of owning DNS directly. `syncDnsRecord(hostname)` creates a Pangolin
  **Resource** (a subdomain under one of the org's already-registered Pangolin
  domains matching the hostname) plus a **Target** pointing at this host's own
  Traefik entrypoint through the configured "main site"'s tunnel;
  `deleteDnsRecord(hostname)` removes the Resource;
  `verifyConnection(baseUrl, token, orgId)` backs its own "Test connection"
  button. Config:
  `pangolinApiBaseUrl`/`pangolinApiTokenEnc`/`pangolinOrgId`/`pangolinMainSiteName`
  (all four required to activate) + optional `pangolinTargetPort` (defaults to
  80, Pangolin terminates public TLS itself). Pangolin's own OpenAPI spec is
  broken/unusable, so its API shapes (`PangolinDomain`/`PangolinResource`/
  `PangolinSite`/`PangolinResourceTarget`, envelope `{data, success}`) are
  hand-typed against its Swagger UI widget, cross-checked against a sibling
  open-source Dokploy-to-Pangolin bridge project that hit the same issue and
  took the same approach. Both services use plain hand-rolled `fetch` calls
  rather than an `openapi-fetch` client, same posture as `GitProviderService`.

**Not live-tested against a real registered account**, same posture as
`GitProviderService`'s OAuth flow and the autoscaling migration: built carefully
from each provider's own documented API shapes, but verify the first real sync
by hand once a zone/token (Cloudflare) or org/site/API key (Pangolin) are
actually configured. Pangolin's delete path specifically is inferred from REST
convention rather than confirmed live, the reference project it was modeled on
is create-only.

### Job queue and worker (`job` table, `JobDTO`, `$lib/services/queue.service.ts`, `$lib/services/queue/`)

Every long-running, side-effecting operation in this app, deploys (including git
builds), volume backups, user-defined cron jobs, and host-wide Docker cleanups,
goes through one DB-backed queue drained by one in-process worker, instead of
running inline in whichever request or scheduler tick happened to trigger it.
That's what makes "five pushes in a minute" collapse into one build, what stops
two deploys of the same service racing each other, and what keeps a
`docker prune` from sweeping layers out from under a running build.

- **`job` table / `JobDTO`** (`src/lib/dto/job-dto.ts`) is the queue itself.
  Beyond the obvious (`type`, `payload` jsonb, `status`, `attempts`/
  `maxAttempts`, `runAt`, `error`, `result`, `title` for the UI), four columns
  carry the whole scheduling policy, and `JobDTO.claimNext()` is the one place
  they're interpreted:
  - **`dedupeKey`** collapses repeats. A partial unique index
    (`job_type_dedupeKey_queued_uidx`, `where status = 'queued'`) makes it a
    real DB-level constraint, not a check-then-insert race : a second
    `deploy:<serviceId>` while one is still waiting its turn is rejected by
    Postgres, and `QueueService.enqueue()` returns the already-queued job
    instead. Once that job starts running the key frees up, so a push landing
    mid-build still queues a follow-up build rather than being lost.
  - **`lockKey`** serialises. Only one _running_ job may hold a given key, so
    `service:<id>` means one deploy per service at a time while other services
    deploy in parallel.
  - **`dependsOnJobId`** orders a chain. A job is only claimable once its
    dependency has actually `succeeded`; if that dependency fails permanently,
    `JobDTO.cancelDependents()` cancels the rest of the chain transitively
    rather than leaving it queued behind something that will never finish. This
    is what replaced the sequential `await deployService()` loop that used to
    bring a template's linked stack up in order inside the request handler (see
    `DeploymentService.enqueueStackDeploy`).
  - **`exclusive`** is the host-wide barrier, used by Docker cleanup. An
    exclusive job runs alone (nothing else is claimed while it runs, and it
    waits for whatever is already running), and while one is _queued_ nothing
    else is claimed either, so it can't starve behind a steady trickle of
    deploys. The deliberate consequence, verified rather than assumed: a queued
    prune takes precedence over already-queued deploys, and only waits on
    in-flight ones. The reverse rule would block a waiting admin behind an
    unbounded deploy backlog.

  The claim itself is one `for update skip locked` select inside a transaction,
  so two concurrent claimers pick two different rows rather than racing for the
  same one.

- **`QueueService`** (`$lib/services/queue.service.ts`) is the enqueue/wait API
  every caller uses : `enqueue()` (with the coalescing described above),
  `wait(jobId)` (poll to a terminal status, for the two callers that must keep
  their synchronous contract), plus the list helpers the Scheduling page reads.
- **`JobWorker`** (`$lib/services/queue/worker.ts`) is a fourth `BaseScheduler`
  subclass alongside the three cron schedulers, overriding `intervalMs` to a 1s
  poll (`BaseScheduler` gained both that knob and a non-overlapping-tick guard
  for this). Started from `hooks.server.ts`'s `init()`. Each tick claims up to
  `MAX_CONCURRENT_JOBS` (3) jobs, claiming _serially_ so each claim sees the
  previous one's committed `running` row (a parallel batch of claims would each
  run in its own uncommitted transaction and could hand out two jobs sharing a
  `lockKey`). On the very first tick it calls `JobDTO.requeueOrphaned()` : this
  app runs one worker, so any row still `running` at boot was left there by a
  process that died, and is put back on the queue. `runJob()` is public
  specifically so `tests/unit/app/queue.test.ts` can drive the
  succeed/retry/permanently-fail decision without an interval.
- **`$lib/services/queue/handlers.ts`** maps a `JobType` to its handler
  (`deploy` → `DeploymentService.deployService`, `backup` →
  `S3BackupService.backupVolume`, `cron_job` → `CronJobService.runJob`,
  `docker_cleanup` → the matching `DockerService.prune*`), each parsing its own
  payload through a zod schema in `queue/payloads.ts` rather than casting : a
  payload written by an older version of the app fails as a clean job error
  instead of deep inside dockerode. Throwing is how a handler reports failure.
  Kept in its own module so `QueueService` stays importable from
  `deploy.service.ts` without an import cycle (`handlers` → `deploy.service` →
  `queue.service`, and `worker` → `handlers`, so `hooks.server.ts` imports the
  worker directly).

**What changed at each trigger point.** `DeploymentService.deployService()` is
unchanged as the actual pipeline and is still the single source of truth; what
moved is _who calls it_. `DeploymentService.enqueueDeploy()` creates the
`deployment` row up front with status `"pending"` (and sets the service's
`currentStatus` to match) and queues the job, so the Overview tab's existing
progress polling, which already treated `pending` as in-flight and already
resumes from `svc.currentStatus` after a reload, works unchanged for a deploy
that hasn't started yet. `deployService()` now reuses an existing deployment row
when handed its id instead of always creating one.

**The Overview tab's progress polling had to grow two things for this**, both
real bugs found by driving a template quick-deploy in a real browser rather than
by reading the code. It now `refreshAll()`s on every status transition and once
more at the end : the header status pill and the deployment-history rows come
from `load`, not from the progress endpoint, so a deploy started _somewhere
else_ (a quick-deploy, the create wizard, cron) left them frozen at whatever
they were when the page loaded, and only a manual reload caught up. And
`onMount` resumes from the latest deployment row's own `status`, not just
`svc.currentStatus` : on a redeploy the layout's `syncServiceStatus` inspects
the still-running _old_ container and writes `"running"` back over the in-flight
`"pending"`, so the service-level check alone could miss a deploy that really
was in flight. The progress panel also renders while
`pendingAction === "deploy"` even with zero log lines yet (a queued job, or a
pull that hasn't emitted a status change), showing "Waiting for the deploy to
start…" rather than nothing, and the "this service hasn't been deployed yet"
banner is suppressed during a first deploy.

- Service Overview's `deploy` action, `services/new`'s `createAndDeploy`, the
  templates gallery's `quickDeploy` and the cron redeploy scheduler all enqueue
  and return immediately. The two create-a-service-and-deploy-it paths no longer
  block the request on a real image pull at all, which is what makes the
  redirect land on the service page with live progress instead of a spinning
  button.
- `POST /api/v1/services/<id>/deploy` enqueues _and_ `QueueService.wait()`s, so
  its "returns once the deploy is done" contract (and therefore
  `homerun services deploy`) is unchanged, verified by `tests/integration/`'s
  real deploy tests still passing untouched.
- The Docker Cleanup page's six actions likewise enqueue-and-wait (via
  `$lib/services/docker-cleanup-queue.ts`, split out of the route file so the
  route keeps no manual typing), since the page renders the reclaimed-space
  summary. They also gained `allowLongRequest()`, which they were missing.
- Backups (`/backups`'s and `storage/[volumeId]`'s "Run now", plus the backup
  scheduler) enqueue and return : a tar-and-upload could comfortably outlive
  Bun's idle timeout, and neither route called `allowLongRequest()`. The
  `backup_run` row is still written by `BackupService.runBackup()` when the job
  actually starts.

**Retries** are per job type (`maxAttempts`, default 1) with exponential backoff
: backups get 2 attempts, deploys and cleanups get one, since a failed deploy is
something the user should see and decide about rather than have silently
retried. Finished rows are amortized-pruned after 7 days on ~2% of inserts, the
same convention as `AppLogDTO`/`NotificationDTO`.

**Visibility** is the Scheduling page's new "Job queue" section
(`$lib/components/job-queue-panel.svelte`, which loads itself through
`$lib/remote/jobs.remote.ts` rather than taking props off that page's `load`,
running/queued plus the last 15 finished, refreshing itself every 3s while
anything is active).

**Verified against real Postgres**, not just reasoned about : a throwaway
database driven through `JobDTO` directly covered dedupe/coalescing, the lock
key skipping a same-service job while claiming another, dependency gating and
transitive cancellation, both directions of the exclusive barrier, priority
ordering, `runAt` gating and retry rescheduling, orphan requeue, and eight
racing `claimNext()` calls handing out five jobs exactly once each. The
browser-level flow was verified live too : a real template quick-deploy against
an isolated instance, driven through Playwright, lands on the service page with
the progress panel already streaming, no stale "not deployed yet" banner, and
the status pill reaching RUNNING with no manual reload. The API-level end-to-end
path is covered by `tests/integration/` (real image pulls, real containers,
local deploys, git builds, and the failure path) passing unchanged through the
queue, and the policy layer by `tests/unit/app/queue.test.ts`.

### Schedulers (`src/lib/services/cron.service.ts`, `src/lib/services/cron/`)

`CronService` (`cron.service.ts`) composes three instances of one generic
`DueScheduler<T>` (`cron/due-scheduler.ts`), one per scheduled concern: cron
redeploy (`ServiceDTO.listCronEnabled()` → `DeploymentService.enqueueDeploy`),
S3 backup (`StorageVolumeDTO.listBackupEnabled()` → `enqueueVolumeBackup`) and
user cron jobs (`CronJobDTO.listEnabled()` → `enqueueCronJobRun`, see Cron jobs
above). All three were separate near-identical classes before; the config object
(`list`/`schedule`/`lastRunAt`/`markRun`/`fire`/`describe`/`label`) is the only
thing that actually differed. Each `list()` is unscoped by user, since a
scheduler isn't running on behalf of a request. Due-checking is
`cronMatches(schedule, now)` plus a `sameMinute(lastRunAt, now)` guard against a
double-fire within one matching minute.

`DueScheduler` extends `BaseScheduler` (`cron/base-scheduler.ts`), which owns
the shared "60s `setInterval`, HMR-safe via a `globalThis`-backed registry keyed
on `label`, non-overlapping ticks, idempotent `start()`" boilerplate. **Keyed on
`label`, not `constructor.name`**: three instances of the same class would
collide on the latter. `JobWorker` (`queue/worker.ts`) is the fourth subclass,
overriding `intervalMs` to a 1s poll, see Job queue and worker above.
`CronService.startCronScheduler()`/`startBackupScheduler()`/
`startCronJobScheduler()` (all called from `hooks.server.ts`'s `init()`) just
call `.start()` on the composed instance.

`cron/cron-expression.ts` holds the small dependency-free 5-field cron matcher
(wildcard/number/range/list/step, minute resolution, server-local time, no
external cron package, matching this app's generally dependency-light posture)
as plain exported functions (`parseCronSchedule`/`cronMatches`/`sameMinute`),
pure and stateless, so it stays outside the class hierarchy, same "pure
transform doesn't need an instance" precedent as `docker/labels.ts`;
`CronService.parseCronSchedule`/`cronMatches` just delegate to it, and two
route-level validation call sites call those directly. Day-of-month and weekday
follow the standard cron OR rule: when **both** fields are restricted a date
matches if **either** does (`0 0 1 * 1` fires on the 1st _and_ every Monday);
when one is a wildcard only the other applies. "Restricted" means the field
doesn't start with `*`, matching Vixie cron's own star flag, so `*/2` counts as
unrestricted. Covered by `tests/unit/app/cron-expression.test.ts`.

### Web terminal (`src/lib/services/docker/terminal.ts`)

Per-service "Terminal" tab, runs `/bin/sh` in the live container (rejects the
request if the service isn't `currentStatus: "running"`). No WebSocket, this app
has no custom server to hang a `ws` upgrade off (`vite dev` in dev, a plain
built server via `bun run start` in prod), so it's chunked HTTP instead:
`POST .../terminal/open` creates the session,
`GET .../terminal/[sessionId]/stream` is one long-lived streamed response for
output (same `ReadableStream` shape as `streamLogs`),
`POST .../terminal/[sessionId]/input` sends stdin a chunk at a time,
`POST .../terminal/[sessionId]/close` ends it early (a 15-minute-idle reaper
also runs regardless, `setInterval`, HMR-safe `globalThis` guard like the other
schedulers). Every route re-checks session ownership (`userId` match)
independently, `terminal.ts` only trusts the `containerId` it's given, it
doesn't do its own auth.

**Load-bearing implementation detail**: dockerode's normal
`exec.start({hijack:true})`, the standard way to get an interactive exec's
duplex stream, hangs forever under Bun. Confirmed with a minimal repro before
writing any route code: `container.exec()` (plain request/response, creates the
exec) resolves fine, but `.start()` with hijacking (an HTTP/1.1
`Connection: Upgrade` handshake handing back a raw socket) never resolves, Bun's
`node:http` compatibility layer doesn't complete that handshake the way Node's
does. The fix in `terminal.ts` is to do the _start_ step manually: open a raw
`Bun.connect()` Unix-socket connection to the Docker daemon, write the HTTP/1.1
Upgrade request by hand, and treat the socket as the raw duplex TTY stream once
the `101 UPGRADED` header block has been read past. Verified against a real
container end-to-end (real command in, real output back) before wiring it into
routes. If a future change touches this file, re-verify this still holds, it's a
Bun-runtime quirk, not a documented/guaranteed API contract, and could change
with a Bun upgrade.

Audit trail is session-level, not per-keystroke: open/close are logged via the
standard `Logger` pattern (service/container/session/user ids), individual
commands typed into the shell are not. That's a deliberate scope cut, not an
oversight, logging raw TTY bytes verbatim would be noisy and wouldn't cleanly
map to discrete commands anyway (arrow-key history, tab-completion, etc. all
flow through the same input channel).

### S3 backups (`src/lib/services/backup.service.ts`, `s3-backup.service.ts`, `/backups`, `/s3-destinations`)

Per-volume, off by default. The destination itself is a separate, named,
reusable row (`s3_destination`, `S3DestinationDTO`, managed on
`/s3-destinations`) that a volume points at via `storageVolume.s3DestinationId`,
so several volumes can share one bucket/credential pair; the volume only owns
`backupEnabled`/`backupSchedule`/`backupPrefix`, edited on `storage/[volumeId]`.
Every attempt, scheduled or manual, writes a `backup_run` row (`BackupRunDTO`,
created before the attempt and finalized on every return path, including
validation failure), and `/backups` is the page over that history, plus a "Run
now" action per volume, the same one `storage/[volumeId]` offers.
`BackupService` (`backup.service.ts`) is an abstract base holding the generic
tar-then-upload pipeline (`runBackup()`: open the run row, validate config,
resolve+decrypt the named destination, tar the volume's `source` directory,
finalize the run row, return the result), with a concrete subclass supplying
only the "put these bytes at this key" transport;
`S3BackupService extends BackupService` (`s3-backup.service.ts`) is the only
concrete implementation, a hand-rolled AWS Signature V4 client (single-request
PUT, no multipart, no SDK dependency, verified end-to-end against a local MinIO
container during development) that works against any S3-compatible endpoint (AWS
S3, MinIO, R2, B2, etc.) via path-style addressing.
`S3BackupService.backupVolume(volume)` (a singleton instance,
`export const S3BackupService = new S3BackupServiceClass()`) is the callable
entry point every route/scheduler uses; it PUTs the tarball as
`<prefix/>volumeName-<timestamp>.tar.gz`. **Both volume kinds are supported**:
`kind: "bind"` is tar'd straight off the host (`execFile("tar", ...)`), and
`kind: "volume"` (Docker-managed, whose content isn't visible on the host
filesystem the same way) is mounted read-only into a throwaway `alpine:3`
container that tars it to stdout, via `DockerService.runOneOff` (see the one-off
mixin under Docker integration below). Both paths produce the same bytes, so
only `BackupService`'s private `archive()` branches, `attemptBackup` and every
caller are kind-agnostic. A non-zero exit from the helper fails the run with the
helper's own stderr attached, rather than uploading a truncated/empty tarball.
Scheduled backups are one `DueScheduler` config over
`StorageVolumeDTO.listBackupEnabled()`, see Schedulers above. No restore flow,
upload-only.

### Data model (`src/lib/server/db/schema.ts`)

better-auth-owned tables (`user`, `role` is `"admin"` | `"developer"`, see Auth
below, `session`, `account`, `verification`, `apikey`, `passkey`) plus:

- `service`, image/tag, registry creds (`registryPasswordEnc`, AES-256-GCM),
  envVars (JSON), port/restart-policy/resource limits, `desiredState` (user
  intent) vs `currentStatus` (live reconciled Docker state), `containerId`,
  `projectId` (nullable FK, `onDelete: "set null"`),
  `cronEnabled`/`cronSchedule`/`cronLastRunAt` (opt-in scheduled redeploy, see
  below), `authRequired` + `authProviders`/`authAllowedUserIds`/
  `authAllowedEmails`/`authAllowedGroups` (the per-app login wall and its access
  policy, see Per-app login wall below), `buildSource` (`"image"` | `"git"`) +
  `gitUrl`/`gitRef`/`gitBuildContext`/`gitDockerfilePath` (see Git-based builds
  below, `image`/`tag` hold the resolved local build tag when `buildSource` is
  `"git"`, not user-editable directly in that mode),
  `customSslCertEnc`/`customSslKeyEnc` (see Custom SSL certificates below),
  `networkMode` (`"bridge"` default | `"host"`) + `portProtocol` (`"tcp"`
  default | `"udp"` | `"both"`) (see Network mode below), `buildCacheRegistryId`
  (nullable FK to `build_cache_registry`) + `buildServerRemoteHostId` (nullable
  FK to `remote_host`, build this service's image somewhere other than where it
  runs; `deploy.service.ts` rejects that unless a cache registry is also set,
  since a cross-host build has no other way to hand the built image over), both
  see Git-based builds below.
- `remote_host`, a registered build server: `kind` (`"docker"` | `"agent"`),
  `dockerHost` (`tcp://...` or `ssh://...`) plus optional
  `tlsCaEnc`/`tlsCertEnc`/`tlsKeyEnc` for the former, `agentUrl`/`agentTokenEnc`
  for the latter (all AES-256-GCM, same scheme as `registryPasswordEnc`). See
  Build servers below.
- `deployment`, history of deploy attempts: status, image digest, error message,
  timestamps, and `log` (text, default `""`), the live-appended progress log
  described above, kept after the deploy completes as an audit trail (shown as
  an expandable panel per row in the deployment history).
- `service.customDomain`, optional second hostname (unique), a second Traefik
  router sharing the primary router's backend service, see labels.ts below.
  Configured on the service's Networking tab.
- `project`, name/description/userId/`slug` (unique, DNS-safe, prefixes every
  member service's container name and public subdomain, see Docker integration
  below). Every project has a matching Docker network (see below), created
  alongside the row and removed on cascade-delete. Known gap: account deletion's
  cascade cleans up a user's services/containers but not their `project` rows,
  harmless clutter today (FK pragma is off) but should get the same explicit
  treatment eventually (see TODO.md Chores).
- `template`, image/tag/port/envVars/etc., `ownerId` nullable (null = built-in,
  seeded, immutable).
- `template_link`, a template linking to another template (a database, a cache,
  a worker, whatever) so deploying the first also deploys the second :
  `templateId` (the "primary"), `linkedTemplateId`, `alias` (unique per
  `templateId`, used both for display and as the `{{alias}}` token an env var
  can reference). See Template links below.
- `storage_volume`, a named local volume source: `kind` (`"bind"` | `"volume"`),
  `source` (an absolute host path for bind, or a Docker-managed volume name,
  Docker's own `Binds` syntax tells the two apart by whether it looks like a
  path). Its optional backup config is
  `backupEnabled`/`backupSchedule`/`backupPrefix`/`backupLastRunAt` plus
  `s3DestinationId` (nullable FK, `onDelete: "set null"`), the endpoint/bucket/
  region/credentials themselves live on `s3_destination`, not here, so several
  volumes can share one target, see S3 backups below.
- `s3_destination` (`S3DestinationDTO`), a named, reusable S3-compatible target:
  `name`/`endpoint`/`bucket`/`region`/`accessKeyId`/`secretAccessKeyEnc`
  (AES-256-GCM, same scheme as `registryPasswordEnc`), owned per user, managed
  on `/s3-destinations`.
- `backup_run` (`BackupRunDTO`), one row per backup attempt (scheduled or manual
  "Run now"): `volumeId`, `startedAt`/`finishedAt`, `success` (null while still
  running), `sizeBytes`, `error`. Written from `BackupService.runBackup()`, the
  one place both the scheduler and the manual action funnel through, so every
  path gets a log entry including validation failures. Backs `/backups`;
  `storage_volume.backupLastRunAt` alone only ever remembered a timestamp.
- `cron_job` (`CronJobDTO`), a user-defined scheduled task, independent of
  `service.cronSchedule`: `name`/`description`/`schedule` (5-field cron)/
  `enabled` (off by default), `kind` (`"image"` | `"exec"`), `image`/`tag`/
  `command` (a shell command for `"exec"`, an optional override for `"image"`),
  `envVars` (JSON), `registryUrl`/`registryUsername`/`registryPasswordEnc`
  (AES-256-GCM, same scheme as `service.registryPasswordEnc`), `timeoutSeconds`
  (default 900), `lastRunAt`. See Cron jobs above.
- `cron_job_run` (`CronJobRunDTO`), one row per cron job attempt (scheduled or
  manual "Run now"): `startedAt`/`finishedAt`, `success` (null while running),
  `exitCode`, `output` (stdout+stderr, last 64k characters), `error`. Same shape
  as `backup_run`, plus what the command printed.
- `build_cache_registry` (`BuildCacheRegistryDTO`), a per-user container
  registry credential (`registryUrl` with no scheme, `username`, `passwordEnc`)
  used only as a build cache source/destination, not as a deploy image source,
  managed on `/build-cache-registries`. See Git-based builds below.
- `service_volume`, join table: one mount of one `storage_volume` into one
  `service` (`containerPath`, `readOnly`). A volume becomes "shared" simply by
  being mounted into more than one service, no separate project-volume concept.
- `instance_settings.onboardingCompletedAt`, nullable timestamp, non-null once
  the onboarding wizard (see Onboarding below) has run. Not part of the
  config-override merge in `config.ts`, it's onboarding-flow state, not an
  instance config value, unlike every other column on this table (see Instance
  settings below).
- `invitation`, a pending admin-sent invite (`InvitationDTO`, not
  better-auth-owned so it's a normal DTO): `email`, `role`, `token` (unique, 32
  random bytes hex), `invitedByUserId`, `expiresAt` (7 days), `acceptedAt`
  (nullable, null means still pending). See User roles & invitations below.
- `app_log` (`AppLogDTO`), persisted warn/error-level `Logger` output: `level`,
  `scope`, `message`, `metadata` (JSON-stringified extra log args), `serviceId`
  (nullable, heuristically populated, see below). Backs the per-service Errors
  tab's "Application errors" section, a lightweight Sentry-adjacent view of
  app-level failures alongside deployment failures (see
  `services/[serviceId]/errors/` below). `Logger.warn()`/`.error()`
  (`$lib/logger.ts`) fire-and-forget a `AppLogDTO.create()` call on every
  warn/error log, dynamically imported (not a top-level import) since
  `logger.ts` isn't under `$lib/server/`, keeping server-only db code out of the
  module graph unless a warn/error call actually fires; never awaited, never
  throws, so a logging call can't fail the operation it's logging. `serviceId`
  is extracted by regex-matching this codebase's own `service=<uuid>` convention
  already present in most Docker/deploy log messages, rather than threading an
  explicit serviceId through every existing call site, a log with no match is
  still visible on a future instance-wide log view, just not attributed to one
  service's Errors tab. `AppLogDTO.create()` amortized-prunes the table back to
  the newest 5000 rows on ~2% of writes, rather than adding a third scheduler
  alongside `CronService`'s two.
- `notification` (`NotificationDTO`), a curated per-user lifecycle event feed
  (deploy success/failure, service created/started/stopped, auto-redeploy,
  runtime error), deliberately separate from `app_log` above, see In-app
  notifications below.
- `instance_settings.orchestrationMode` (`"standalone"` default | `"swarm"`),
  plus `service.replicas`/`swarmServiceId`, opt-in Docker Swarm mode, see Swarm
  mode below.
- `instance_settings.cloudflareApiTokenEnc`/`cloudflareZoneId` and
  `pangolinApiBaseUrl`/`pangolinApiTokenEnc`/`pangolinOrgId`/
  `pangolinMainSiteName`/`pangolinTargetPort`, optional DNS automation, see DNS
  automation below.
- `user_preferences` (`UserPreferencesDTO`), one row per user, `userId` itself
  as the primary key (a genuine 1:1 extension of `user`, not a singleton like
  `instance_settings`): `theme` (`"light"` | `"dark"` | `"system"` default),
  `sidebarColorIntensity` (`"colorful"` default | `"accent"`), `accentColor`
  (nullable hex string). See Appearance preferences below.

**Postgres enforces the schema's `onDelete: "cascade"`/`"set null"` FK
constraints for real.** (This app ran on SQLite until the Postgres conversion
below, SQLite's `PRAGMA foreign_keys` was intentionally left off there, making
`onDelete` decorative for row data; Postgres has no equivalent global disable,
so it's now a genuine DB-level safety net, not just documentation.) Explicit
app-level cascade logic still exists and is still required,
`ProjectDTO.cascadeDelete()` and `$lib/services/user.service.ts`'s
`UserService.cleanupUserResources()` (account deletion, see User roles &
invitations below for why that had to be pulled out of `auth.ts`'s
`beforeDelete` into its own method rather than left inline), because a DB
constraint can't stop/remove a real Docker container or network; only the
row-data half of cleanup benefits from the enforcement being real now.

Migrations are incremental under `drizzle/`, Postgres dialect (`0000` is the
full-schema baseline generated at the SQLite→Postgres conversion, see below,
every table in one migration, not the original per-feature history). Mid-session
schema changes get applied directly via a one-off script using
`drizzle-orm/bun-sql/migrator`'s `migrate()` against a live Postgres connection,
without needing to restart the dev server. **Adding a NOT-NULL column to a table
that already has rows**: Postgres's `ALTER TABLE ADD COLUMN NOT NULL` requires a
`DEFAULT` (or a two-step add-nullable-then-backfill-then-set-not-null), same
shape of problem SQLite had, different exact syntax; the ORM-level `notNull()`
in `schema.ts` is what matters for new rows going forward either way
(app-enforced). **Changing the meaning of an existing nullable column**:
back-fill by hand too, don't assume a nullable/already-populated column is fine
to reinterpret without a data pass.

**SQLite → Postgres conversion, real/tested**: this app originally ran on
`bun:sqlite` (a single `database.db` file, zero setup), converted to Postgres
(via Bun's built-in `SQL` client, `drizzle-orm/bun-sql`, no `pg` npm dependency)
because a real multi-writer-safe, backup/replication-friendly DB was worth the
extra `docker compose up -d` step, and jsonb/native boolean/timestamp types are
a better fit for this schema than SQLite's affinity typing. Verified live
against a real (scratch, disposable) Postgres container, not just reasoned
about: the generated migration applies cleanly; insert/select round-trips
returned real `Date` objects and real `boolean`s (not the `0`/`1`/epoch-int
values `bun:sqlite` mode-typed columns produced); `jsonb` columns
(`instanceSettings.oauthProviders`, `template.envVars`, `service.envVars`)
round-tripped as parsed objects/arrays with no manual `JSON.parse`/`stringify`
needed on either side, same as before; `seed.ts`'s `onConflictDoNothing()` is
idempotent on Postgres the same way it was on SQLite;
`ProjectDTO.cascadeDelete()`'s child-before-parent deletion order (deployments,
then services, then the project row) was already FK-safe by inspection, so real
FK enforcement doesn't break it. **Not carried over automatically**: any data in
a pre-conversion `database.db`, this was a schema/dialect switch, not a data
migration; a fresh Postgres database starts empty (migrations +
`seedBuiltinTemplates()` on first boot, same as before).

`src/lib/server/db/seed.ts`, `seedBuiltinTemplates()`, called from
`hooks.server.ts`'s `init()` on every boot (idempotent, fixed ids like
`"builtin-redis"`, `.onConflictDoNothing()`).

**Real, tested finding**: `hooks.server.ts`'s `waitForDatabase()` (retries a
trivial `select 1` up to 10 times, 2s apart, before `init()` proceeds to
migrations) used to `throw` once it exhausted its retries. SvelteKit's own
dev-mode handling of a thrown server `init()` hook doesn't crash the process, it
silently leaves the server in a broken state where every subsequent request just
hangs/fails with no useful error, rather than either recovering or exiting
loudly. Fixed by calling `process.exit(1)` instead once retries are exhausted,
so an unreachable Postgres at boot fails fast and visibly (a restart loop under
`docker compose`/systemd, a hard failure locally) instead of leaving a
half-started server up that looks alive but answers nothing correctly.

### Docker integration (`src/lib/services/docker.service.ts`, `src/lib/services/docker/`)

`DockerService` (`docker.service.ts`) is a singleton instance
(`export const DockerService = new DockerServiceClass()`) of a class built from
real per-concern classes merged via the TS mixin pattern, **not** a static
barrel re-exporting loose functions (see the OOP convention note above; this
module is its reference implementation). Every route/DTO imports `DockerService`
from there and calls instance methods on it (`DockerService.pullImage(...)`),
never reaching into `services/docker/*` directly, that part of the contract is
unchanged from before the mixin refactor. Each concern file under
`services/docker/` exports a `SomethingMixin(Base)` function returning a class
that extends `Base` (ultimately `BaseDockerService`, `docker/base.ts`, holds the
shared `getDocker(remote?)`); `docker.service.ts` chains all of them and
instantiates once. A concern that calls another's method does it via real
inheritance (`this.inspectStatus(...)`), which is also why the chain has a
load-bearing order: networks before containers (`createAndStartContainer` calls
`this.connectToProjectNetwork`), containers before reconcile
(`syncServiceStatus` calls `this.inspectStatus`), containers before one-off
(`runOneOff` calls `this.pullImage`), see the ordering comment in
`docker.service.ts` before reordering the chain.

- `client.ts`, HMR-safe `dockerode` singleton, socket path from config; not a
  mixin itself, `BaseDockerService.getDocker` wraps its exported `getDocker()`
  function. → `DockerService.getDocker`.
- `labels.ts`, pure label-building (no Docker client, no state), stays a plain
  exported function rather than a mixin: every container gets
  `homerun.managed=true` + `homerun.service.id=<id>`, plus Traefik discovery
  labels (unless `dnsResolvable` is false, then only the two managed labels, no
  `traefik.*` at all, so it never gets a router). `listManagedContainers()` and
  any host-scanning code **must** filter on `homerun.managed=true`, this app
  must never touch a container it didn't create. When the service belongs to a
  project, the public subdomain is `<projectSlug>-<slug>.<baseDomain>`
  (`projectSlug` param, optional). When `customDomain` is set, a second router
  (`<slug>-custom`) is added pointing at the _same_
  `traefik.http.services.<slug>` backend, one loadbalancer config, two hostnames
  reaching it, not a duplicated service block. When `authRequired` is set, a
  forwardAuth middleware is attached to every router for the service, pointing
  at `authCheckUrlFor(serviceId)` — `config.authCheckUrl` with a `?service=<id>`
  query param, so the gate identifies the service from the URL rather than
  having to resolve `X-Forwarded-Host` back to a slug or custom domain — plus
  `authResponseHeaders` for `GATE_IDENTITY_HEADERS`. Because these are labels,
  turning the wall on or off only takes effect on the next deploy.
- `networks.ts`, `DockerNetworkMixin`, per-project Docker networks.
  `projectNetworkName(projectId)` is deterministic (`homerun-project-<id>`, no
  separate id stored, stays a plain exported pure function).
  `ensureProjectNetwork`/`removeProjectNetwork` (idempotent create/remove,
  called from `ProjectDTO.create`/`cascadeDelete`) and
  `connectToProjectNetwork(containerId, projectId, alias)` attaches a container
  to its project's network under a DNS alias equal to the service's slug (the
  _internal_ alias is never project-prefixed, only the container name and public
  subdomain are, sibling services keep addressing each other by plain slug) →
  `DockerService.ensureProjectNetwork`/`removeProjectNetwork`/`connectToProjectNetwork`.
- `containers.ts`, `DockerContainerMixin` (the old `service.ts`, renamed to
  avoid reading as "the Service service" next to `dto/service-dto.ts`), the
  operational surface, merged in right after the network mixin (see the ordering
  note above):
  - `pullImage(image, tag, auth?, onProgress?)`, `onProgress` is called once per
    layer _status change_ (not per byte-tick, dockerode's raw progress events
    are far too chatty to log one-for-one), used to build the live
    deploy-progress log. → `DockerService.pullImage`.
  - `createAndStartContainer(params, onProgress?)`, container names include a
    random suffix (`homerun-[<projectSlug>-]<slug>-<hex8>`) so a redeploy never
    collides on "name already in use"; the _previous_ container for a service is
    found by its `homerun.service.id` label (`#findServiceContainer`, a private
    method), not by name, since names are no longer stable across deploys. The
    container is aliased as its slug on the shared network
    (`NetworkingConfig.EndpointsConfig`) so other services can reach it at
    `http://<slug>:<containerPort>` regardless of the randomized name; if
    `params.projectId` is set, it also joins that project's network under the
    same alias (`this.connectToProjectNetwork`, inherited from the network
    mixin). `params.volumes` (from `ServiceVolumeDTO.listForService`) becomes
    `HostConfig.Binds` (`"source:containerPath[:ro]"`, covers both bind-mounts
    and named volumes with the same syntax). Don't call this directly from a new
    route, go through `$lib/services/deploy.service.ts`'s
    `DeploymentService.deployService()` instead (see above), which wraps it with
    deployment-row bookkeeping. → `DockerService.createAndStartContainer`.
  - `start/stop/restartContainer`, `removeContainer`, `inspectStatus` →
    `ContainerStatus`, `streamLogs` (follow-mode web `ReadableStream`),
    `buildAuthConfig`, all exposed the same way, `DockerService.<name>`.
    `ContainerStatus` (`$lib/types.ts`) has a `"missing"` value alongside
    pending/pulling/starting/running/stopped/failed, for a container Docker
    can't find at all (a 404 on `inspect()`, e.g. removed manually outside the
    app, `docker rm`), distinct from `"failed"` (the container still exists but
    exited non-zero); `inspectStatus` only returns `"missing"` for a real 404,
    any other inspect error still falls back to `"failed"` as before. See the
    Errors tab bullet above for the "Resolve" action
    (`ServiceDTO.resolveOrphan()`) this status backs, and Remote hosts/Homerun
    Agent below, `agent-client.service.ts`'s `inspectStatus` and
    `packages/agent/docker.ts`'s `ContainerNotFoundError` (mapped to a real HTTP
    404 by `packages/agent/http.ts`) make the same distinction for an
    agent-backed host. Docker doesn't strip a container's own ANSI color codes
    from its stdout, every raw-log-line surface (the Logs tab, deploy progress
    panel, deployment history, Errors tab) renders each line through
    `$lib/components/ansi-line.svelte` (backed by `$lib/ansi.ts`'s
    `parseAnsiLine()`), which splits a line into styled `<span>`s rather than
    using `{@html}`, no injection surface even though the source is a live
    container's own output.
- `reconcile.ts`, `DockerReconcileMixin`,
  `syncServiceStatus`/`syncAllServiceStatuses`: poll-on-page-load status
  reconciliation, merged in after the container mixin so `this.inspectStatus` is
  available. There is intentionally no background worker or Docker event
  subscriber (yet, see Planned features). →
  `DockerService.syncServiceStatus`/`syncAllServiceStatuses`.
- `core-services.ts`, `DockerCoreServicesMixin`, `findTraefikContainer()`, a
  deliberate narrow exception to the managed-label-only rule: read-only (logs
  only, never lifecycle) lookup of the Traefik container by image-name prefix,
  backing the System Logs page. →
  `DockerService.findTraefikContainer`/`restartTraefikContainer`/`updateTraefikContainer`.
- `cleanup.ts`, `DockerCleanupMixin`, host-wide (not per-service, deliberately
  the one mixin that isn't scoped to `homerun.managed=true` containers, see
  Docker Cleanup below) `docker.df()`-backed preview (`getCleanupPreview()` →
  `CleanupPreview`) plus
  `pruneContainers`/`pruneImages(all?)`/`pruneNetworks`/`pruneBuildCache`/
  `pruneVolumes`/`pruneSystem`, thin wrappers over dockerode's own
  `prune*`/`pruneBuilder` calls. → `DockerService.getCleanupPreview`/
  `pruneContainers`/`pruneImages`/`pruneNetworks`/`pruneBuildCache`/
  `pruneVolumes`/`pruneSystem`.
- `one-off.ts`, `DockerOneOffMixin`, `runOneOff(params)`: pull-if-missing,
  create, start, wait, collect stdout/stderr, remove, for the two places that
  need a container as a _tool_ rather than as a service (reading a
  Docker-managed named volume out for a backup, see S3 backups above; running a
  user-defined cron job's image, see Cron jobs below). Needs the container mixin
  ahead of it in the chain (`this.pullImage`). **`Tty` is deliberately false
  here**, unlike `createAndStartContainer`, so Docker's own stream framing keeps
  stdout and stderr apart : a caller reading a binary tarball off stdout must
  not get stderr interleaved into it, which is exactly what a TTY container
  would do. `timeoutMs` kills the container rather than leaving it running, and
  the result carries `timedOut` so the caller can say so; the container is
  removed in a `finally` either way. The attached socket is `destroy()`ed
  explicitly once the run finishes : without that it stays open and keeps Bun's
  event loop alive, leaking one connection per run in a long-lived server. →
  `DockerService.runOneOff`.

`src/lib/services/secrets.ts` (not under `docker/`, it's a generic AES-256-GCM
utility, not Docker-specific, also used by SMTP/OAuth/S3-backup secrets),
`encryptSecret`/`decryptSecret` for `registryPasswordEnc` and every other `*Enc`
column, key derived via `scryptSync` from `config.auth.secret`.

Containers attach to the shared `homerun` Docker network rather than publishing
host ports, true for the default `networkMode: "bridge"`; see Network mode below
for the `"host"` exception. **`createAndStartContainer` calls
`ensureSharedNetwork()` on every local bridge-mode deploy** rather than assuming
a one-time `docker network create`: compose creates it for a compose-run
instance and nothing does for a bare `bun run start`, and Docker Cleanup's
network prune removes it once the last container detaches. Its absence fails at
container **start**, not create ("network homerun not found"), which is why the
deploy looked like it had gotten further than it had.

**Compose files.** The actual service definitions live once in
`tools/compose/{base,app,agent}.compose.yaml` (Traefik + Postgres in `base`, the
app and Agent in the other two); each root-level file is a thin `extends:`
composition of those, so Traefik's flags or Postgres's image change in one
place:

- `compose.yaml`, **local dev**, Traefik + Postgres only. Deliberately no `app`
  service: dev runs the app directly on the host (`bun run dev`/`bun run start`)
  so its own logs aren't viewable in-app (see `system-logs/` above). This is
  what `docker compose up -d` brings up, and what the app assumes exists.
- `compose.dev.yaml`, the same plus `app` and `agent` built from this repo's own
  `Dockerfile` (`target: app`/`target: agent`), for exercising the containerized
  app locally.
- `compose.prod.yaml`, the operator-facing stack: the published
  `docker.io/orochibraru/homerun` image alongside Traefik and Postgres.
  Deliberately **self-contained**, no `extends:`, since someone who `curl`s just
  this one file down has no `tools/` directory; it's Option B in
  `docs/getting-started.md`, so a change here has to stay in step with that doc
  (`bun run e2e:multipass:release --only=docs` checks exactly that).

The app itself _is_ containerized for production use (`Dockerfile`,
`docker-bake.hcl`, built/pushed by `.github/workflows/docker.yaml`; see Release
automation below). The installer's `--mode=full` generates its own separate
compose file on the target host (see `packages/installer/` below) rather than
reusing any of these.

### Swarm mode (`instance_settings.orchestrationMode`, `service.replicas`/`swarmServiceId`, `src/lib/services/docker/swarm.ts`)

Instance-wide, opt-in alternative to the single-container-per-service model
described above: `instanceSettings.orchestrationMode` (`"standalone"` default |
`"swarm"`, `/settings`) switches every **local** deploy from
`createAndStartContainer` to `DockerService.createAndStartSwarmService`
(`DockerSwarmMixin`, `docker/swarm.ts`, chained into the same `DockerService`
mixin merge as the other concerns, see the ordering note above), creating a real
Docker Swarm Service (`docker.createService`,
`Mode: {Replicated: {Replicas: n}}`) instead of a plain container.
`deploy.service.ts` branches on `orchestrationMode` right alongside its existing
`buildSource` branch.

- `service.replicas` (int, default 1, edited on the Compute tab, ignored in
  standalone mode) is the desired replica count.
- `service.swarmServiceId` is the swarm-mode equivalent of `containerId`;
  `containerId` stays null for a swarm-mode service, there's no single container
  to point it at, `DockerSwarmMixin.getRunningTaskContainerId` resolves one
  specific task's container on demand instead (used by the Terminal tab's exec).
- Mixin surface: `ensureSwarmNetwork` (idempotent overlay network, the
  swarm-mode counterpart to `networks.ts`'s per-project bridge networks),
  `createAndStartSwarmService`, `removeSwarmService`, `scaleSwarmService`
  (stop/start map to scaling to 0 / back to the configured replica count, rather
  than a real container stop/start), `restartSwarmService` (bumps `ForceUpdate`
  to recreate every task), `inspectSwarmServiceStatus` (aggregates task states
  into the same `ContainerStatus` vocabulary standalone mode uses, so the
  Overview tab doesn't need a separate rendering path), `streamSwarmServiceLogs`
  (same `ReadableStream` shape as `containers.ts`'s `streamLogs`).
  `docker/reconcile.ts`'s `DockerReconcileMixin` checks `service.swarmServiceId`
  first and calls `inspectSwarmServiceStatus` when present, falling back to the
  standard container path otherwise. The v1 REST API's `start`/`stop`/`restart`
  routes (`src/routes/api/v1/services/`) branch the same way, swarm-mode
  services are controllable via the API, not just the dashboard.

**Prerequisites this app never automates** (same "don't touch infra without the
admin's own action" boundary as custom SSL's Traefik config): the host's Docker
daemon must already be swarm-active (`docker swarm init`, done once by the
admin), and the live Traefik container needs `--providers.docker.swarmMode=true`
added to its command, a one-time `tools/compose/base.compose.yaml` edit +
restart (or its equivalent in whichever compose file is actually running,
`compose.prod.yaml` is self-contained, see Compose files below).

**This app only ever talks to the local manager.** Extra capacity comes from a
node _joining this swarm_ as a worker, which Docker then schedules onto on its
own; it is never a `remote_host` row. That's exactly why Remote Hosts was cut
back to build servers (see Build servers above), a second standalone daemon and
a swarm worker are different things and this app only wires up the latter.
`packages/installer/swarm-join.sh` (a standalone bash script, not part of the
TypeScript installer's `StepRunner`, documented in
`packages/installer/README.md`) is the groundwork for this gap: it joins a
remote box to an existing swarm as a worker on its own rootless Docker daemon
and installs the Homerun Agent there via `systemd --user`, the same install
shape `packages/installer/steps/agent.ts` uses locally, hand-mirrored rather
than sharing the TS installer's dry-run machinery so the two scripts stay in
lockstep by inspection. Usage:
`curl -fsSL .../swarm-join.sh | sudo bash -s -- --token <SWMTKN-...> --manager <ip>:2377`
(token/manager address come from `docker swarm join-token worker` on the
manager). Once joined, the node is schedulable by the swarm itself, nothing in
this app has to register it. **Not verified against a real second host or a real
swarm**: syntax-checked (`bash -n`) and `shellcheck`-clean, and every individual
command mirrors a step already dry-run-verified in the main installer, but the
actual `docker swarm join` handshake and a real Homerun deploy onto that node
haven't been run end-to-end, same caveat `bootstrap.sh` itself carries.

### Network mode (`service.networkMode`, `service.portProtocol`, Networking tab)

Per-service, `"bridge"` (default) or `"host"`, configured in the Networking
tab's **Network** section, alongside `containerPort` and `portProtocol` (`"tcp"`
default | `"udp"` | `"both"`, which protocol(s) `ExposedPorts` declares the
container's port under). `"host"` shares the host's network namespace directly
(`HostConfig.NetworkMode: "host"` in `docker/containers.ts`), for apps that
specifically need real host-network access (mDNS/SSDP discovery, e.g. Home
Assistant), which bridge networking can't provide.

Host mode forces `dnsResolvable` off (both in the stored row, at save time, and
again defensively at deploy time in `createAndStartContainer`), there's no
container-specific IP/network for Traefik's docker provider to route to in host
mode, only the host's own interfaces, so Traefik labels are skipped entirely
regardless of what's stored. No project-network join either (Docker containers
in host mode can't also join a user-defined network). A host-mode service is
reachable only directly on the host's own `containerPort`, exactly as if you'd
run it with `docker run --network host` yourself, this app doesn't publish or
map anything either way, matching the existing "no host port publishing by
design" stance for bridge mode too.

**Real, tested finding**: `HostConfig.NetworkMode: "host"` combined with a
`NetworkingConfig.EndpointsConfig` (the shared-network attach bridge mode uses)
does **not** fail at the Docker API level the way you might expect, verified
live against a real scratch container, Docker silently accepted both and the
container ended up attached to the named network instead of `"host"`
(`NetworkSettings.Networks` showed the bridge network, not `host`).
`createAndStartContainer` explicitly omits `NetworkingConfig` entirely when
`networkMode === "host"` specifically because of this, sending both is not a
hard error you'd catch in testing, it's a silent wrong-mode footgun. Also
verified live: with `NetworkingConfig` correctly omitted, the container comes up
with `NetworkSettings.Networks: { host: {...} }` and no IP address, as expected
for real host networking.

### Docker Cleanup (`src/lib/services/docker/cleanup.ts`, `(protected)/docker-cleanup/`)

Admin-only (nav item, Administration category, `adminOnly: true`), host-wide
Docker housekeeping, `docker system df`/`prune` exposed through the dashboard
instead of needing shell access to the host. Deliberately **not**
`homerun.managed=true`-scoped like the rest of `DockerService`, this is the one
mixin that intentionally looks at (and can delete) containers/images/
networks/volumes/build cache Homerun didn't create, that's the entire point of a
cleanup tool.

`docker-cleanup/+page.server.ts`'s `load` calls
`DockerService.getCleanupPreview()` (`docker.df()` + `listNetworks()`, filtered
to what's actually reclaimable, unused images, non-running containers,
unreferenced volumes, unused networks excluding the three Docker defaults and
whatever's still attached to a container, unused build cache entries) so the
page shows what a prune would remove before the admin commits to it. Six form
actions, each a thin call into one `DockerCleanupMixin` method
(`pruneContainers`/`pruneImages`/`pruneNetworks`/`pruneBuildCache`/
`pruneVolumes`/`pruneSystem`, `pruneSystem` running the first four in sequence
and returning one combined summary), every one independently re-checking
`locals.isAdmin` the same as `load` does. No confirmation-dialog/dry-run step in
the UI itself, the preview list is the only "are you sure" a prune action gets.

### System stats (`src/lib/services/system-stats.service.ts`)

`SystemStatsService.getSystemStats()`, host-level (not per-container)
CPU/RAM/disk via Node's `os` module + a shelled-out `df -Pk .`, plus a
best-effort GPU read via `nvidia-smi` (returns `gpu: null` when absent, the
common case, not an error; no other vendor supported). CPU% needs a delta
between two samples (`os.cpus()` gives cumulative counters since boot), so a
module-scope `lastCpuSample` is diffed on each call, first call after boot
always reads 0%. Polled by the dashboard's `/system-stats` endpoint every 5s.

### Setup diagnostics (`src/lib/services/admin.service.ts`)

`AdminService.runSetupChecks()`, read-only diagnostics (base domain/auth
secret/origin still at their defaults, Traefik container reachable, Docker
socket reachable, SMTP fully configured if enabled), each with a severity and
the env var that fixes it. Reads `config`, which already reflects any DB-backed
instance settings merged over the env defaults (see Config and Instance settings
below), these checks just report the effective value, they don't care which
layer it came from. DNS automation (Cloudflare/Pangolin, see below) is separate
from this check, `runSetupChecks()` doesn't currently flag an unset DNS
provider, that's an opt-in feature, not a base-instance misconfiguration.

There's no standalone `/setup` page anymore (removed, it duplicated what
`/settings` already does live). `AdminService.runSetupChecks()` now only backs
the dashboard's setup-issue banner, which deep-links straight into `/settings`
with the offending field(s) highlighted: `AdminService.SETUP_CHECK_FIELDS` (same
file) maps a check's id to the `/settings` field id(s) it corresponds to;
`(protected)/+page.server.ts` builds a `highlightFields` list from the current
issues and appends it as `?highlight=a,b,c`; `/settings` is now split into one
route per tab (see the tabs convention above), so its `+layout.server.ts`
redirects to whichever tab the first highlighted field actually lives on before
that tab's own page rings the matching fields amber and scrolls the first one
into view on mount. Two checks (`auth-secret`, env-only; `traefik`, a
live-container check) deliberately have no entry in the map, nothing to
highlight for either.

### Config (`src/lib/config.ts`)

Zod-validated YAML config, not env vars, except `DATABASE_URL`/`AUTH_SECRET`/
`PORT`/`CONFIG_FILE` (env-only, needed before the file/DB are reachable).
`CONFIG_FILE` (default `./homerun.yaml`) points at the YAML file; missing file =
all defaults, every field optional. `yamlConfigSchema` is the file's own schema
(exported so `scripts/generate-config-schema.ts` can turn it into
`homerun.schema.json`, a JSON Schema `homerun.example.yaml` references via a
`# yaml-language-server: $schema=` comment for editor linting); `configSchema`
extends it with the env-only fields for the full `AppConfig` type. Notable
groups: `docker.{socketPath,networkName}`, `baseDomain`,
`traefik.{entrypoint,certResolver}`, `auth.{origin,secret}`, `smtp.*`. See
`docs/configuration.md`.

`config.auth.secret` reads `AUTH_SECRET` **falling back to
`BETTER_AUTH_SECRET`**, don't collapse this to one var without checking both are
honored.

`config` is a single stable object every other module imports and reads
properties off live, the file+env-parsed values are captured once into a private
`fileDefaults`, then `config` starts as a clone of that and is **mutated in
place** (never reassigned) by `applyInstanceSettings(override)`. See Instance
settings below for who calls that and when.

### Instance settings (DB-backed) (`instance_settings` table, `InstanceSettingsDTO`, `/settings`)

Most of `config`, OAuth providers, Docker socket/network defaults, Traefik
entrypoint/cert-resolver/dynamic-config-dir, SMTP, and core settings (base
domain, origin, the auth-check URL, cross-subdomain cookies), is now
live-editable from the dashboard, not just env vars. All of it lives on
`/settings` except the OAuth providers, which moved to their own top-level
`/authentication` page (see Authentication page below) — `/settings` therefore
has four tabs now (General, Docker, Networking, Email), not five.
`instance_settings` is a **singleton row** (`InstanceSettingsDTO`, id always
`"default"`, auto-created on first read): every column is nullable, `null`
meaning "fall back to the env default", a non-null value overriding it. Secrets
(`smtpPasswordEnc`, each OAuth provider's `clientSecretEnc` inside the
`oauthProviders` JSON array) use the same AES-256-GCM scheme as
`service.registryPasswordEnc` (`$lib/services/secrets.ts`, reused as-is).

**Not DB-backed**, `databaseUrl`/`port`/`auth.secret`/`logLevel`/`logFormat`
stay env-only: `databaseUrl` has to be known before the DB is even reachable,
and `auth.secret` is the key every `*Enc` column's encryption derives from, so
DB-backing it would be circular.

`InstanceSettingsDTO.toConfigOverride()` decrypts every stored secret and
returns the plain-value shape `applyInstanceSettings()` merges over
`envDefaults`. This runs twice: once in `hooks.server.ts`'s `init()` at boot
(before the server accepts any request, so DB-backed settings are in effect from
the very first request, not just after a save), and again at the end of every
`/settings` action, so a saved change is live immediately, no restart, for every
section including OAuth (see Auth below for how that one specifically applies
live). `/settings` itself is split into one route per tab (bare `+page.svelte` =
General/Core, `docker/`, `networking/`, `email/`, see the tabs convention under
Conventions above), so this apply-plus-rebuild pair is pulled into a shared
`applyAndRebuild(settings)` helper
(`$lib/server/validation/instance-settings-form.ts`, alongside `nullableText`/
`checkbox` form-parsing helpers every tab's actions use), each tab's own action
calls it rather than duplicating the two calls per file.

`config.ts` deliberately never imports the DTO or `db` itself, `db/lib.ts`
imports `config.ts` for `databaseUrl`, so `config.ts` has to stay a leaf module
or the two would form a circular import. The DB-reading glue lives in
`hooks.server.ts` and `settings/+layout.server.ts` instead, the latter now
shared across every tab (fetches `InstanceSettingsDTO.get()` once, plus the
setup-issue-banner deep-link redirect described below).

**Real, tested finding from building this**: a bad OAuth provider
(unreachable/invalid discovery URL) isn't just a broken login button,
better-auth's `genericOAuth` plugin validates every configured provider's
discovery document while building its auth _context_, which every request
touching auth goes through, including plain `getSession()` on every page load
and even email/password sign-in. Saving one unvalidated **locked the whole app
out**, `/settings` included, with no way back in short of editing the DB
directly, verified live. Fixed two ways:
`settings/authentication/+page.server.ts`'s `updateOauth` action fetches and
validates each provider's discovery document (must return 200 with a JSON body
containing an `issuer`) _before_ persisting anything, rejecting the save with a
clear error otherwise, deliberately **not** the "warn, don't block" precedent
the image-existence checker uses, since the failure mode here is total lockout
rather than one broken service. And as defense in depth against any other cause,
`hooks.server.ts`'s `authHandler` wraps `auth.api.getSession()` in a `catch`
that degrades to "no session" on any error rather than letting it 500 every
request, so even if auth context construction fails for some other reason, the
rest of the app (and `/settings`, to fix whatever's wrong) stays reachable, just
signed out.

### Auth (`src/lib/services/auth.ts`)

better-auth at `basePath: "/api/v1/auth"`, `drizzleAdapter` over the same
Postgres `db`. `src/hooks.server.ts` populates `event.locals.user`/`session`
from the cookie session, falling back to manual
`x-api-key`/`Authorization: Bearer` verification when no cookie is present:
`auth.api.verifyApiKey()` confirms the key, then the owning user is looked up
**directly by `result.key.referenceId`** via a plain drizzle query, deliberately
_not_ through `getSession()`'s API-key session-mocking, which is gated behind
the `apiKey()` plugin's `enableSessionForAPIKeys` option (default `false`, and
better-auth's own docs advise against enabling it in production). This is what
makes `x-api-key`/`Bearer` auth work for `src/routes/api/v1/*` (see REST API
above).

`user.deleteUser` is enabled with a `beforeDelete` hook (thin wrapper around
`$lib/services/user.service.ts`'s `UserService.cleanupUserResources()`, see User
roles & invitations below), don't assume better-auth's default account-deletion
behavior is sufficient; it isn't, by design of this app's extra tables (see Data
model above).

`config.auth.crossSubdomainCookies` (env `AUTH_CROSS_SUBDOMAIN`, default off,
also DB-editable, see Instance settings above) sets better-auth's
`advanced.crossSubDomainCookies` to scope the session cookie to `.{baseDomain}`
instead of the exact host, see the per-service auth gate below for why, and its
documented, tested limitation.

**`advanced.useSecureCookies` is set explicitly from the `ORIGIN` env var's
scheme, and it has to be.** Real, reproduced bug, not a precaution: sign-in on
an instance reached over plain HTTP at a bare IP (`http://<ip>:3000`, exactly
what the installer's `--mode=full` produces) returned 200 and toasted "Signed in
successfully", but the button stayed stuck on "Signing in…" forever and the user
never reached the dashboard. better-auth derives the secure-cookie flag through
a fallback chain (`cookies/index.mjs`'s `createCookieGetter`): explicit
`useSecureCookies`, else `baseURL`'s protocol, else **`isProduction`**. This app
deliberately never pins `baseURL` (see the long comment in `auth.ts` for the
lockout that causes), so a deployed container (`NODE_ENV=production`) fell
through to `isProduction` and issued
`__Secure-better-auth.session_token; Secure`. A browser on plain HTTP at a bare
IP silently **discards** that cookie twice over : `Secure` requires a secure
context (only `localhost`/`127.0.0.1` are exempt, an IP is not), and the
`__Secure-` prefix independently requires both. So the POST succeeded, no cookie
was ever stored, `locals.user` stayed empty on the next request, the sign-in
page's `load` never threw its `redirect(302, resolve("/"))`, `refreshAll()` had
no redirect to act on, and `loading` is only ever reset in `catch` or
`onNavigate` : hence a success toast over a permanently spinning button.
**Verified by A/B against a real production build on a real LAN IP**, reading
the actual `Set-Cookie`: pre-fix + `ORIGIN=http://<ip>:3000` →
`__Secure-…; Secure`; fixed → `better-auth.session_token` with no `Secure`;
fixed + `ORIGIN=https://…` → `__Secure-…; Secure` again, so an HTTPS deployment
is not downgraded. The full chain was then driven end to end: sign-in stores the
cookie, `get-session` returns the session, and `/auth/sign-in`'s data request
answers `{"type":"redirect","location":"../../"}`, which is what `client.js`'s
`_invalidate` turns into the `_goto` that un-sticks the button. The branch is
skipped entirely when `ORIGIN` is unset, leaving better-auth's own
`isProduction` default rather than guessing.

**It reads `process.env.ORIGIN`, never `config.auth.origin`, and that
distinction is load-bearing.** The first version of this fix derived the flag
from `config.auth.origin`, which is a _mutable, user-editable setting_ : saving
it calls `applyInstanceSettings()` + `rebuildAuth()`, and flipping
`useSecureCookies` renames the cookie (`better-auth.session_token` ↔
`__Secure-better-auth.session_token`), so every live session is instantly
unreadable. Concretely, and caught by e2e rather than by reading the code :
onboarding's "Use HTTPS" checkbox defaults to **on** whenever
`settings.authOrigin` is still null (a fresh instance), so clicking through the
wizard with defaults saved `https://…`, flipped the flag, renamed the cookie,
and **signed the admin out onto `/auth/sign-in` at the exact moment they
finished setting the instance up**. `ORIGIN` is the right source because it is
how the app is actually _served_ (compose.prod.yaml requires it, the installer
sets it, the e2e harness sets it) and is immutable for the process lifetime, so
no settings save can ever rename a cookie out from under a signed-in user. If a
deployment genuinely changes scheme, that's a restart, which is the correct
blast radius for a cookie-security change.

Rate limiting is on outside `vite dev`: 100 requests per IP per 15 minutes
overall, plus the `apiKey()` plugin's own 300/minute. **Real, tested finding**:
better-auth also applies an undocumented-in-config "special rule" (its
`rate-limiter/index.mjs`'s `getDefaultSpecialRules`) capping any
`/sign-in`/`/sign-up`-prefixed path at 3 requests per 10 seconds, well below
that `max`/`window` and unaffected by them, which a handful of `tests/e2e/`
specs signing in and out against a real production build tripped immediately.
`HOMERUN_DISABLE_AUTH_RATE_LIMIT=1` turns rate limiting off for that reason, set
only by `tests/e2e/support/bootstrap-runtime.ts`'s spawned app, never in
production, same test-only-escape-hatch shape as
`HOMERUN_SKIP_INTEGRATION_SETUP`.

The `betterAuth({...})` call is wrapped in `buildAuth()` rather than assigned
once to a `const`, `export let auth = buildAuth()`, plus
`export function rebuildAuth()` which reassigns `auth = buildAuth()`. This is
what makes OAuth provider changes saved on `/settings` apply live: every
consumer (`hooks.server.ts`'s
`auth.api.getSession`/`svelteKitHandler({ auth, ... })`) reads `auth.*`
per-request rather than destructuring it at import time, so ES module
live-bindings mean a reassignment inside `auth.ts` is immediately visible
everywhere without a restart. `rebuildAuth()` is called at the end of
`hooks.server.ts`'s `init()` and every `/settings` action.

### Base domain vs. Dashboard URL, and why they're two things

`instance_settings.baseDomain` and `auth.origin` answer different questions, and
collapsing them caused a real, reported breakage. **Base domain is the DNS
suffix deployed services are routed under** : `labels.ts` interpolates it into a
Traefik `Host()` rule as `<slug>` dot `<baseDomain>`, and a host rule cannot
contain a port. **Dashboard URL (`auth.origin`) is where this app itself is
reached**, scheme and port included, and it's what the OAuth redirect URI and
the login wall's redirects are built from. In production the two coincide
(`example.com`→`<https://example.com`>); **in development they diverge**,
because the dashboard runs on `http://localhost:5173` while services are routed
by Traefik on 443 as `<slug>.localhost`.

Origin used to be derived as `scheme://baseDomain` with no separate field, and
`normalizeBaseDomain` explicitly permitted an optional `:port`. So getting the
origin right for dev forced `localhost:5173` into Base domain, which then became
the routing suffix : every service rendered as `<slug>.localhost:5173`, a URL
that hits the **Vite dev server** rather than Traefik, which served the
dashboard under that hostname, found no session cookie for it, and bounced to
`/auth/sign-in`. That's the bug, and nothing about it looked like a domain
problem from the outside.

Now: `normalizeBaseDomain` returns `{domain, port}` and **the port is moved to
the origin instead of the routing name**, so pasting `localhost:5173` (or a full
URL) into Base domain does the right thing silently rather than corrupting
routing. `applyCoreOverride` also strips any port from `config.baseDomain` at
boot, so an instance that already stored one is correct without needing a
re-save. Settings gained an explicit optional **Dashboard URL** field for the
cases derivation can't express. **A blank Dashboard URL means "derive it"**, and
that is load-bearing : `authOrigin` is always persisted, derived or not, so a
naive `value={settings.authOrigin}` pre-fills the field and then silently
overrides a later Base domain edit — caught by a browser test, not by reading
the code. The field renders blank whenever the stored origin equals
`scheme://baseDomain`, and shows the placeholder as a hint.

**Known dev-mode papercut, deliberately not automated**: `config.authCheckUrl`
defaults to `http://host.docker.internal:${PORT}/api/v1/auth-check` with `PORT`
defaulting to 3000, but `vite dev` serves on 5173 and doesn't set `PORT`, so the
login wall's forwardAuth calls a dead port in development until Auth-check URL
is set by hand. **Don't "fix" this by deriving the port from `auth.origin`** :
that is only the same port in dev. Behind a reverse proxy the origin is 443
while the app listens on 3000, so deriving would break production to fix
development.

### Authentication pages (`/authentication`, `$lib/auth-providers.ts`)

Admin-only, its own sidebar item under Administration. It **replaced** the old
`/settings/authentication` tab (that route is gone; `/settings` is down to four
tabs), so there's one place editing `instance_settings.oauthProviders`.

**It follows the list + `new/` + `[id]` shape every other entity uses**
(services, projects, storage), not a single page of inline expanding forms. The
first cut was that inline page and it was wrong on every axis the user cared
about : one provider looked like _the_ provider, deleting had no confirmation,
and the whole thing lived in one whole-array `updateOauth` action whose seven
parallel `formData.getAll()` arrays had to stay index-aligned between collapsed
and expanded rows. The route split deleted that fragility outright : each page
edits exactly one provider through `addOauthProvider`/`updateOauthProvider`/
`deleteOauthProvider` on the DTO, and `$lib/server/oauth-provider-form.ts`
parses one provider from one form. Providers still live in the
`instance_settings.oauthProviders` jsonb array rather than their own table, so
the route param is the provider **name**, which is why the name is immutable
once created (it's in the redirect URI and in every service's `oauth:<name>`
method reference). Deletion goes through `ConfirmDialog` with the provider name
as the typed phrase, same as the service danger zone.

**`label` vs `name`.** `name` is the machine id (lowercase, hyphens, part of the
redirect URI and of `oauth:<name>`); `label` is the human name shown on the
"Continue with …" button, the app-auth screen, the per-service Access checkbox
list and the provider list. `label` falls back to `name` everywhere it's read,
so providers stored before it existed keep working.

**Signing out of the provider is opt-in, off by default** (`signOutOfProvider`).
better-auth picks `end_session_endpoint` straight out of the discovery document
(`endSessionEndpoint ??= discovered.end_session_endpoint`) and performs
RP-initiated logout by default, so signing out of Homerun bounced the user to
their IdP's logout page without anyone having configured it. The provider config
now always passes `disableProviderLogout: !signOutOfProvider`, so the default is
a local sign-out and the redirect only happens when an admin ticks the box.

- **Presets.**- **Presets.** `OAUTH_PRESETS` (`$lib/auth-providers.ts`, a pure
  module, also home to the method-id encoding and the email matcher) carries a
  discovery-URL template, default scopes and PKCE default for Pocket ID,
  Keycloak, Authelia, Logto, Authentik, Zitadel and Kanidm. Clicking one appends
  a prefilled provider row with `{host}`/`{realm}`/`{slug}`/`{clientId}`
  placeholders left in for the admin to replace; "Blank" is still there for
  anything else. The templates are the products' own documented discovery paths,
  which differ more than you'd guess (Logto nests under `/oidc`, Authentik under
  `/application/o/<slug>`, Kanidm under `/oauth2/openid/<client id>`).
- The page prints the exact redirect URI to register with the provider
  (`<origin>/api/v1/auth/callback/<provider id>`), and says so explicitly when
  `config.auth.origin` isn't set yet rather than printing a broken URL.
- Provider **names must be unique** and renaming one silently drops it from any
  service that referenced it as `oauth:<name>`, so the save action rejects
  duplicates and the UI shows a per-provider "used by N apps" count.
- A "Protected apps" panel lists services with the wall on, flagging any with no
  sign-in method picked, and deep-links to each one's Networking tab.

**The OAuth redirect URI comes from the request, and both halves of the exchange
must agree.** better-auth builds the authorize step's `redirect_uri` from the
provider's optional `redirectURI`, but the **token exchange ignores it
entirely** and rebuilds the URI from `context.baseURL` (see
`api/routes/callback.mjs`, which interpolates `c.context.baseURL` with the
callback path), and that is derived per-request because `auth.ts` deliberately
leaves `baseURL` undefined — see Auth above for the lockout that causes. **Real
bug, introduced and reverted in one session**: pinning only `redirectURI` to
`config.auth.origin` made the authorize step stable but desynced it from the
token step, turning a `redirect_uri ... is not registered` error into
`invalid_code`, since OAuth requires the two to match byte for byte. Don't pin
one half. The request origin is the single source of truth for both, and the fix
for "it points at the wrong hostname" is to make the user reach Homerun at the
right one : that's what the Base domain / Dashboard URL split above and the
canonicalization below are for. The original report (a `dashy.localhost:5173`
callback not being registered) turned out to be the _same_ root cause as the
layout bug — a port in Base domain sending the browser to the dev server under a
service hostname — and fixing that fixes the redirect URI without pinning
anything.

**Client authentication on the token exchange is selectable per provider**
(`instance_settings.oauthProviders[].tokenAuthMethod`,
`"auto" | "post" | "basic"`, Authentication page). better-auth's default
(`getDefaultTokenEndpointAuth`) is `client_secret_post` whenever a client secret
is configured, and `none` when it isn't — and `none` sends **no client
credentials at all**, which an IdP reports as `invalid_client`,
indistinguishable from a wrong secret. A discovery document's
`token_endpoint_auth_methods_supported` lists what the _server_ accepts, but
each registered client has its own configured method, so a client set to
`client_secret_basic` rejects the default POST-body request. **Automatic is not
"let better-auth decide"** : it reads the provider's own
`token_endpoint_auth_methods_supported`, captured into `discoveredTokenAuth` by
the same discovery fetch that already validates the URL on save, and prefers
`client_secret_basic` when offered — which is what RFC 6749 §2.3.1 requires
servers to support and calls body credentials "NOT RECOMMENDED", and what OIDC
Core defaults `token_endpoint_auth_method` to. better-auth's POST-body default
is the outlier, and following it is what made a correctly configured Pocket ID
client fail. Falls back to `post` when Basic isn't advertised, and to
better-auth's own default when neither is (`resolveAdvertisedTokenAuth`, a pure
function in `$lib/auth-providers.ts`, covered by
`tests/unit/app/token-auth.test.ts`). Because the list is captured at save time,
a provider stored before this exists has an empty `discoveredTokenAuth` and
behaves as before until it's saved again. `"basic"` maps to better-auth's
`authentication: "basic"`, `"post"` to an explicit
`tokenEndpointAuth: { method: "client_secret_post" }`, and all of it is only
applied when a secret is actually present : passing a secret-based method with
no secret makes the plugin **throw during init**, which would take the whole
auth context down (the lockout shape described under Auth above). **Verified by
observing the real request** against a stub IdP that logs what arrives —
`auto`/`post` put the secret in the body, `basic` sends an
`Authorization: Basic` header and no body secret. That stub is the tool to reach
for here : two earlier guesses at this bug (a pinned `redirectURI`, then a
suspected empty secret) were both wrong, and only watching the actual outgoing
request settled it.

**The flow still has to start and finish on one origin.** The PKCE code-verifier
cookie is set on whichever origin began the exchange, so beginning on host A and
finishing on host B fails on the verifier even when the URIs line up.
`$lib/server/canonical-origin.ts`'s `offCanonicalOrigin()` is what closes that:
`/app-auth` 302s to the canonical origin (lossless, its state is the signed `rd`
param), and the dashboard sign-in page swaps its provider buttons for a link to
the canonical sign-in URL rather than offering a button that cannot work. **The
load-bearing detail is that it reads the `Host` (or `X-Forwarded-Host`) header,
not `url.origin`** : with `ORIGIN` set, SvelteKit normalizes `event.url` to the
configured origin, so a `url.origin` comparison can never detect the mismatch
and the guard is silently dead code, which is exactly how the first attempt at
it was written. The header is attacker-controllable, which is safe here because
it only ever decides _whether_ to redirect; the target is always
`config.auth.origin`, never derived from the request.

**Linking a provider to an existing account is explicit, and it has to be.**
better-auth refuses implicit linking when the **local** user row has
`emailVerified: false`, even for a trusted provider (`link-account.mjs`'s single
condition, which also covers `accountLinking.enabled`/`disableImplicitLinking`).
Homerun's bootstrap admin signs up with email and password while SMTP is
typically disabled, so `emailVerified` is false and can never become true : that
account could **never** link an OIDC provider, and the failure surfaced as a raw
`account_not_linked` code. The escape hatch (`requireLocalEmailVerified: false`)
is marked deprecated upstream — "the gate will become unconditional" — so
disabling it buys months and then breaks. The fix is therefore the explicit
path, not the loophole: `/profile/security` has a **Connected accounts** section
listing every enabled provider with Connect/Disconnect, driven by better-auth's
authenticated `linkSocial()`/`unlinkAccount()` (which bypass the gate entirely,
since being signed in is itself the proof both accounts are yours). Disconnect
is disabled while the user has no `credential` account, so nobody can strip
their own last sign-in method. **`unlinkAccount` takes `accountId`, not
`providerId`**, in this version, so the load returns each provider's
`account.accountId` alongside its linked flag.

**better-auth's own error UI is replaced by `/auth/error`** via
`onAPIError.errorURL`. Without it, a failed OAuth callback renders better-auth's
branded "Something went wrong" page with a raw code and an "Ask AI" button,
which is jarring in a self-hosted dashboard. The page maps the codes that
actually occur (`account_not_linked`, `state_mismatch`, `email_not_verified`,
`email_not_found`, `invalid_callback_request`) to plain language, and falls back
to a sane message for anything else. **It normalizes the incoming code**
(lowercase, spaces and hyphens to underscores) because better-auth emits
`"account not linked"` with spaces and it arrives slugified.

**The page performs the fix rather than describing it.** A first cut told the
user to go to Profile → Security themselves, which the user rightly rejected :
the page already knows everything needed to do it. For `account_not_linked` it
now renders a real **Link \<provider\> to this account** button (calling
`linkSocial()` inline) plus **Sign out**, when `locals.user` is set — and the
sign-in prompt only when nobody is signed in, since linking requires an
authenticated session. Which provider failed isn't in better-auth's redirect (it
only appends `error=`), so the two places that start an OAuth flow stash the
provider name in `sessionStorage` first (`$lib/oauth-attempt.ts`); the page
falls back to the only enabled provider when there's exactly one, and to a
button per provider otherwise, so it degrades instead of guessing wrong.

**Enabled providers now actually appear on the dashboard's own sign-in page**
too, as "Continue with …" buttons. They never did before: providers could be
configured but nothing rendered a button, and `/api/v1/auth/providers` was in
`hooks.server.ts`'s `customAuthPaths` allowlist while the route itself didn't
exist. **In this better-auth version `genericOAuth` registers its providers as
ordinary social providers** ("used through the standard `signIn.social` and
`callback/:id` core endpoints — no plugin-specific endpoints needed", from the
plugin's own types), so the client calls
`signIn.social({ provider, callbackURL })` and needs no extra client plugin —
there is no `genericOAuthClient` export in this version to add. `provider` is
typed as a union of the built-in social providers, so a custom provider id needs
a cast at that one call site.

### Per-app login wall (`service.authRequired` + policy columns, `/api/v1/auth-check`, `/app-auth`, `$lib/server/app-gate.ts`)

The gap this document used to describe at length — `authRequired` blocked
_everyone_ because there was no login page on the gated hostname and
`AUTH_CROSS_SUBDOMAIN` didn't rescue it — is closed. `authRequired` is now a
real login wall, and `crossSubdomainCookies` is unrelated to it (still a
supported setting, just not part of this flow).

**The mechanism, and the Traefik behaviour it rests on.** Traefik returns a
non-2xx forwardAuth response to the client _verbatim_, headers and all. So
`/api/v1/auth-check` can answer with a `302` **and** a `Set-Cookie`, and because
the browser sees that response as coming from the gated app's own hostname, the
cookie lands host-scoped there. That's the whole trick: no cross-subdomain
cookies, no second Traefik router, no extra container. **Verified directly
against Traefik v3** before any of this was built (a throwaway auth server and
backend behind the real dev Traefik): a 302 passes through with its `Location`,
custom headers and `Set-Cookie` intact; `X-Forwarded-Uri` carries the query
string; the original request's `Cookie` header reaches the auth server; and
`authResponseHeaders` injects identity headers into the backend request on a
2xx. Re-verify these if the middleware is ever reworked, the design has no
fallback if any of them stops holding.

The round trip, all of it through the one forwardAuth channel:

1. Anonymous request to `app.example.com/page` → auth-check → `302` to
   `<config.auth.origin>/app-auth?rd=<signed token>`. `rd` carries the original
   URL, the host and the service id, HMAC-signed with a 10-minute TTL, so it
   can't be used as an open redirect.
2. `/app-auth` (its own top-level route, outside `(protected)/` — it has to
   render for signed-out visitors) resolves the service, and either renders a
   sign-in screen restricted to that app's allowed methods, or, for an
   already-signed-in allowed user, `302`s to
   `app.example.com/__homerun_auth/callback?token=<60s grant>`.
3. That callback path is itself gated, so it lands back in auth-check, which
   verifies the grant and answers `302` + `Set-Cookie` for the session cookie
   (`homerun_app_session`, `HttpOnly`/`SameSite=Lax`/`Secure` over https, **no
   `Domain`** so it stays host-only, 8h).
4. The original URL is re-requested, now carrying the cookie → `200`, plus
   `X-Homerun-User`/`-Email`/`-Name` (declared in the middleware's
   `authResponseHeaders`) so a proxy-header-aware app gets the identity for
   free.

`/__homerun_auth/logout` clears the cookie the same way.

**The hot path is DB-free.** The cookie is a self-contained signed token
(`$lib/server/app-gate.ts`), so a request with a valid one costs an HMAC verify
plus a 10s-TTL in-memory lookup of the service row
(`$lib/server/gated-service-cache.ts`, HMR-safe `globalThis` singleton, same
pattern as the db client). Every proxied request to a gated app goes through
this, so don't add a query to it.

**Revocation is immediate, and that's load-bearing.** The cookie embeds a
`policyVersion`, a short HMAC over the service's own auth policy; auth-check
recomputes it per request and challenges on a mismatch, and saving the policy
calls `invalidateGatedService()`. Without this, tightening an allowlist would
have left already-issued cookies working for up to 8 hours — observed for real
during live testing, which is what prompted adding it. What is _not_ covered:
deleting a user or changing their groups at the provider only takes effect at
their next sign-in, or at the 8h cookie expiry.

**Config prerequisite**: `config.auth.origin` must be set, since that's where
visitors get sent to sign in. `updateAppAuth` refuses to turn the wall on
without it, and auth-check falls back to an explanatory 500 rather than a
mystery redirect. **`config.auth.origin` now falls back to the `ORIGIN` env
var** — it previously read only `homerun.yaml`/`instance_settings`, even though
`compose.prod.yaml`, the installer's generated stack and the integration harness
all set `ORIGIN`, and `auth.ts` warned based on `process.env.ORIGIN` while
`config.auth.origin` never read it.

**Turning the wall on or off requires a redeploy**, since the middleware is
attached via the container's Traefik labels. Changing the policy on an
already-gated service does not.

**The policy columns** on `service` (all jsonb, all `[]` by default):
`authProviders` (allowed sign-in methods, `"password"` for built-in credentials
or `"oauth:<provider name>"`), plus `authAllowedUserIds`/`authAllowedEmails`/
`authAllowedGroups`. `$lib/auth-providers.ts` is the pure module owning that
encoding (and the `*@domain` email matcher, and the preset catalogue);
`$lib/services/app-access.service.ts` evaluates a decision. **Nothing is
selected by default and the wall can't be turned on with an empty
`authProviders`** — that combination would lock out everyone including the
owner, so it's rejected at save time rather than allowed and warned about.

**"Which method did they use" is answered by linked identity, not by the
session.** better-auth's `session` table records no provider, so
`AppAccessService` checks whether the user has an `account` row whose
`providerId` matches an allowed method (`credential` ↔ `password`). Groups come
from decoding the claims of that row's stored `idToken` (`groups`, `roles`, and
Keycloak's `realm_access`/`resource_access` roles — a fixed list, deliberately
not per-provider config). A stricter session-bound check would need a side table
written at sign-in and still couldn't classify a pre-existing dashboard session.

**Verified end to end against real infrastructure**, not just reasoned about: a
real gated `nginx:alpine` container behind the real dev Traefik, driven with
curl as the browser through every hop — anonymous redirect, the login screen,
the grant, the host-scoped `Set-Cookie`, the app actually serving, a forged
cookie refused, logout, the identity headers, and a policy change revoking a
live cookie. `tests/integration/app-gate.test.ts` covers the same flow against
the real app (including cross-host cookie rejection and each denial reason), and
`tests/unit/app/app-gate.test.ts` covers token signing/expiry/tampering and
claim extraction.

### User roles & admin-managed accounts (`user.role`, `/users`, `invitation` table)

This moved from "anyone can `/auth/sign-up`" to a real single-instance model.
Roles are `"admin"` and `"developer"`, developer is a label plus route-gating
only, not a permissions system: both roles get the full dashboard over their own
data (already isolated per-user by every DTO's `userId` scoping), the only
difference is two admin-only pages, `/users` and `/settings` (`locals.isAdmin`,
see below, checked at the top of each `load`, plus the nav items are filtered
out of `(protected)/+layout.svelte`'s sidebar for non-admins).

- **The very first account becomes admin automatically**, whoever creates it.
  `hooks.server.ts`'s `authHandler` hard-blocks
  `POST /api/v1/auth/sign-up/email` (better-auth's real email/password sign-up
  endpoint) with a 403 once `AdminService.hasAnyUser()`
  (`$lib/services/admin.service.ts`, a raw query, no DTO exists for
  better-auth-owned tables) is true, the endpoint itself is blocked, not just
  the UI, so it can't be curled around. `/auth/sign-up` and `/auth/sign-in`'s
  own `load`s cross-redirect based on the same check (blank instance → sign-up;
  account exists → sign-in), so navigating to either one always lands somewhere
  sensible. Every account after the first is created by an admin from `/users`,
  direct-create (name/email/temp password/role, works with no SMTP, via
  `auth.api.createUser`) or email invite (`InvitationDTO` +
  `/auth/accept-invite/[token]`, gated behind `isSmtpEnabled()`).
- **Real, tested-in-review finding**: making the bootstrap-admin hook
  conditional on `!user.role` doesn't work. `auth.ts`'s
  `databaseHooks.user.create.before` is where the promotion happens, but the
  `admin()` plugin registers its _own_ `databaseHooks.user.create.before` (via
  its `init()`) that sets `role` to `options.defaultRole`, and depending on
  plugin/app hook-merge order, that can run _before_ the app-level one, so
  `user.role` is already truthy by the time this hook sees it. Verified live:
  with a `!user.role` guard, the bootstrap account came out `"developer"`, not
  `"admin"`. Fixed by checking `AdminService.hasAnyUser()` directly instead of
  `user.role`'s presence, both hooks run pre-insert, so it's still reliably
  false only before the very first user exists, regardless of ordering.
  `admin({ defaultRole: "developer" })` stays as the sane fallback for any
  creation path that doesn't pass an explicit role (shouldn't normally happen,
  direct-create and invite-accept both always pass one).
- **Real, tested-in-review finding**: `auth.api.removeUser` (the admin plugin's
  user-deletion endpoint) calls `internalAdapter.deleteUser()` directly, which
  does **not** run this app's `user.deleteUser.beforeDelete` option, that option
  is read and invoked only by better-auth's own self-service delete-account
  endpoints (`node_modules/better-auth/dist/api/routes/update-user.mjs` is the
  only place `beforeDelete`/`afterDelete` are referenced at all), not by
  `internalAdapter.deleteUser` generically. Calling `auth.api.removeUser`
  naively from an admin "remove user" action would leak that user's Docker
  containers/networks. Fixed by extracting the cleanup body out of `auth.ts`'s
  `beforeDelete` into `$lib/services/user.service.ts`'s
  `UserService.cleanupUserResources(userId)`, called explicitly by both the
  self-service `beforeDelete` hook _and_ `/users`' `removeUser` action before it
  calls `auth.api.removeUser`. By contrast `databaseHooks.user.create.before`
  (used for the role-promotion above) genuinely _is_ generic,
  `internalAdapter.createUser` goes through the same `createWithHooks` machinery
  regardless of caller, confirmed in
  `node_modules/better-auth/dist/db/internal-adapter.mjs`, so that one hook
  firing uniformly for self-service sign-up, `admin.createUser`, and
  invite-accept was safe to rely on.
- `/users`' `removeUser`/`setRole` actions also refuse to strip the last
  remaining admin (`wouldRemoveLastAdmin()`, checked via
  `$lib/services/user.service.ts`'s `UserService.countAdmins()`) and refuse
  self-removal (mirroring better-auth's own guard on `admin.removeUser`, checked
  client-side too before it gets there).
- `/auth/accept-invite/[token]/+page.server.ts`'s `accept` action calls
  `auth.api.createUser` **without** a `headers` option, confirmed from
  `node_modules/better-auth/dist/plugins/admin/routes.mjs`: omitting
  `headers`/request context is treated as a trusted server-side call and skips
  the admin-role permission check entirely, which is correct here since the
  invite token itself (validated, single-use, expiring via
  `InvitationDTO.getByToken`) is the authorization, not an admin session.
  `/users`' own actions, by contrast, always pass `headers: request.headers` so
  better-auth's own permission check double-enforces admin-only on top of the
  route's own `locals.isAdmin` guard.
- `App.Locals.isAdmin` (declared in `app.d.ts`, was dead/aspirational like
  `logger`, see Logging below, until this feature) is now populated in
  `hooks.server.ts`'s `authHandler` right after `locals.user` is set
  (`locals.user?.role === "admin"`), for both the cookie-session and API-key
  paths. Every admin-only route checks `locals.isAdmin`, not
  `locals.user?.role === "admin"` inline.

### Onboarding (`instance_settings.onboardingCompletedAt`, `/onboarding`, `Stepper` component)

A signed-in user whose instance hasn't finished onboarding is forced to
`/onboarding` and can't reach anything else; `/onboarding` itself is unreachable
once it's done. **`src/routes/onboarding/` is its own top-level route, not
nested under `(protected)/`** (it predates that route group's current shape,
this doc previously said otherwise, see below), so the two directions are two
separate `load`s rather than one shared check: `(protected)/+layout.server.ts`
redirects into `/onboarding` when `!settings.onboardingComplete` (right after
its own `locals.user` check, same function that redirects signed-out visitors to
sign-in/sign-up, see Routing above), and `onboarding/+layout.server.ts`
redirects back out to `/` when `settings.onboardingComplete` is already true,
both reading the same `InstanceSettingsDTO.onboardingComplete` getter
(`onboardingCompletedAt !== null`). Onboarding is a property of the singleton
`instance_settings` row (see Instance settings above), not per-user, so once the
bootstrap admin finishes it, later developer accounts never see the wizard, that
falls out naturally from the flag living on the instance, not the account. Edge
case: an admin _could_ create another account before finishing onboarding
themselves, `/onboarding/+page.server.ts`'s own `load` checks `locals.isAdmin`
and shows a non-admin a "an admin needs to finish setting up this instance"
holding message instead of the real wizard rather than handing them
instance-wide config controls.

**Doc correction**: this section previously described both directions as gated
from a single `(protected)/+layout.server.ts` load comparing `route.id` against
`"/(protected)/onboarding"`, following an earlier fix for a real
`url.pathname`-vs-`resolve()` bug (`resolve("/onboarding")` returns the relative
`"./onboarding"` in this app, not an absolute path, so an `===` check against
`url.pathname` always evaluated false and infinite-redirect-looped). That fix
and its `route.id` mechanism are gone now that `onboarding/` moved out from
under `(protected)/` into its own top-level route with its own reverse-direction
`load`; there is no `route.id` comparison anywhere in this codebase today. The
underlying gotcha (`resolve()` here returns a relative path, not useful for a
`url.pathname` equality check) is still real and still worth knowing if a future
gate needs one, just not implemented this way anymore.

`/onboarding/+page.svelte` is a 5-step wizard (Core / Docker / Traefik / Email /
Review) built on the new reusable `$lib/components/stepper.svelte`, extracted
from `services/new`'s inlined step-indicator-bar-plus-Back/Next pattern (not
retrofitted onto `services/new` itself, a deliberate scope cut). `Stepper` owns
navigation and which step is unlocked (`reachableStep`, grows only after a
passed `onNext`); the consuming page owns field markup and validation, same
"shared chrome, not shared shape" split as `form-styles.ts`. No phantom errors:
a field's error paragraph only renders once that field's step has actually
failed an attempted `Next`/submit (tracked in the page's own
`attempted: Set<number>` state, not the component's), nothing shows on initial
render. The finish action reuses the exact
`InstanceSettingsDTO.updateCore/updateDocker/updateTraefik/updateSmtp` methods
`/settings` already calls, then `markOnboardingComplete()`, then the same
`applyInstanceSettings()` + `rebuildAuth()` post-save dance `/settings`'s
actions already do.

### Logging

Every module that mutates state (`page.server.ts` actions, the Docker layer,
cascade-delete helpers) instantiates `new Logger("Domain")` from
`src/lib/logger.ts` at module scope and calls `.info()`/`.warn()`/`.error()` on
start/success/failure of each operation, with entity + user ids for correlation.
`App.Locals.logger` is declared in `app.d.ts` but never populated, that's
dead/aspirational, don't use it; the per-module `Logger` instance is the real
pattern.

### In-app notifications (`notification` table, `NotificationDTO`, `notification-bell.svelte`)

A curated, per-user lifecycle event feed, deliberately separate from the
`app_log`/Errors-tab system above: written explicitly at each event site rather
than derived from logs, so it stays a short, meaningful list rather than every
warn/error the app produces. Shown via a bell icon
(`$lib/components/notification-bell.svelte`, a Popover-based dropdown) in the
protected layout's header, next to `$lib/components/profile-menu.svelte` (the
account/sign-out dropdown, pulled out of `+layout.svelte`'s previously-inline
markup as its own component alongside this feature).

- `notification` table: `id`, `userId` (FK, cascade delete), `serviceId`
  (nullable FK, cascade delete), `message`, `type` (enum:
  `deploy_success`/`deploy_failure`/`service_created`/`service_started`/
  `service_stopped`/`auto_redeploy`/`app_runtime_error`), `createdAt`, `readAt`
  (nullable, unread until set). Indexed on `(userId, createdAt)`.
- `NotificationDTO`: `listForUser(userId, limit=30)` (joins in the related
  service's slug so a feed entry can link straight to it),
  `unreadCount(userId)`, `markRead`/`markAllRead`/`delete(id, userId)` (owner-
  scoped, backs the bell dropdown's per-row remove button), and a
  fire-and-forget static `notify(input)` helper, never awaited, swallows its own
  errors, same posture as `Logger.warn`/`.error`'s `AppLogDTO` write, a
  notification call can't fail the operation it's attached to. `create`
  amortized-prunes each user back to their newest 200 rows on ~5% of writes,
  same convention as `AppLogDTO`'s 5000-row prune.
  `notifyServiceError(serviceId, message)` is the one unscoped-by-owner query on
  this DTO (same precedent as `ServiceDTO.listCronEnabled`), used by
  `Logger.error` to attribute a runtime error notification without threading a
  userId through every call site.
- Call sites: `deploy.service.ts` (deploy success, auto-redeploy, deploy
  failure), `$lib/logger.ts` (`Logger.error` → `notifyServiceError`),
  `services/new/+page.server.ts` (service created), the service Overview page's
  start/stop actions.
- `notification-bell.svelte` owns its own data end to end through
  `$lib/remote/notifications.remote.ts` (see Remote functions above) : one query
  for the feed plus unread count, and one command per
  mark-read/mark-all-read/delete, each refreshing that query server-side so the
  new feed comes back on the mutation's own response. It takes no props. This
  replaced fetching the feed in `(protected)/+layout.server.ts` (paid for on
  every protected page load, opened bell or not) and three one-line `+server.ts`
  routes each followed by a full-page `refreshAll()`.

This closes the "in-app lifecycle event feed" half of what Planned features
below used to list as unbuilt; outbound webhooks (Telegram/Discord/generic HTTP)
on the same events are still unbuilt, see below.

### Appearance preferences (`user_preferences` table, `UserPreferencesDTO`, `/profile/appearance`)

Per-account, not instance-wide (contrast `instance_settings`, which every other
"live-editable config" section in this document is about): a new "Appearance"
tab on the profile layout (`profile/+layout.svelte`, alongside Personal
Information/Security/Sessions/Authorized Clients), backed by
`profile/appearance/+page.server.ts`'s three actions
(`updateTheme`/`updateSidebar`/`updateAccent`, each validated by its own zod
schema in `$lib/server/validation/appearance.ts`) calling
`UserPreferencesDTO.get(userId)`'s `updateTheme`/`updateSidebarColorIntensity`/
`updateAccentColor`, which share `InstanceSettingsDTO`'s private-`persist()`
-per-section shape but per-user instead of a singleton row.

- **Theme**: `mode-watcher` (already an installed dependency, mounted in the
  root `+layout.svelte`) was previously dead code, hardcoded to
  `<ModeWatcher defaultMode="light" />` with no UI ever exposing a way to change
  it, despite `layout.css`'s `.dark` rules already being fully built out. Now
  `<ModeWatcher />` (mode-watcher's own default, `"system"`), and the Appearance
  page's theme selector calls `setMode()` directly for an instant client-side
  preview, with the DB save (`updateTheme` action) as the durable, cross-device
  copy. `(protected)/+layout.svelte`'s `onMount` seeds a browser that has no
  `mode-watcher-mode` localStorage entry yet (a first visit on a new
  device/browser) from `data.preferences.theme`, so the account's saved choice
  follows across devices; a browser that already has its own mode-watcher entry
  is left alone, that entry owns it from then on. This is additive to, not a
  replacement for, mode-watcher's own localStorage persistence.
- **Sidebar color intensity**: `(protected)/+layout.svelte`'s existing
  `categoryColors` map (Administration=red, Infrastructure=emerald,
  Integrations=violet, Workspace=accent) is now conditionally bypassed by a
  `colorful` derived boolean; when `sidebarColorIntensity === "accent"`, every
  category's `{@const color = ...}` resolves to the shared `fallbackColor`
  (Workspace's accent entry) instead of its own.
- **Accent color**: `(protected)/+layout.svelte`'s root wrapper div gets an
  inline `style` computed from `accentColor` (a `"#rrggbb"` hex string, `null`
  meaning "use the built-in default") that overrides
  `--color-accent`/`--color-accent-light`/`--color-accent-glow` for that whole
  subtree; every `bg-accent`/`text-accent`/etc. Tailwind utility already
  references those CSS vars rather than a literal value (Tailwind v4's `@theme`
  block), so no component needs to know about the override. Scoped to
  `(protected)/` only, not pre-login pages, since this is a dashboard
  preference, not a site-wide brand color.
- `(protected)/+layout.server.ts`'s shared `load` (same one that fetches
  notifications, see above) now also fetches `UserPreferencesDTO.get(...)` and
  returns `preferences: preferences.toJSON()`, since the sidebar itself, not
  just the Appearance page, needs it on every protected render.

### Homerun Agent + installer (`packages/agent/`, `packages/installer/`)

Two standalone Bun/TypeScript sub-projects under `packages/`, siblings of
`src/`, each its own `tsconfig.json` (**not** its own `package.json`/
`node_modules`, they share the root install, same as every other `packages/*`
sub-project, see the Commands section above) and **not** part of the SvelteKit
build, both compile to a native binary via `bun build --compile`. See each
folder's own README for the full detail; this section is the pointer.
`packages/docs/` is a fourth, unrelated sub-project under `packages/` (the
generated docs site, see its own subsection near the end of this document), not
part of the Agent/installer/CLI trio described here.

The Agent is a selectable build-server connection kind
(`remote_host.kind: "agent"`, `$lib/services/agent-client.service.ts`'s
`AgentClientService`, see Build servers above for the wiring). The installer
stays standalone tooling (it's not imported by `src/` and isn't meant to be, it
drives a target machine's shell, not this app's own runtime).

- **`packages/agent/`**, the **Homerun Agent**: a small token-authenticated HTTP
  server meant to run on a build server's own Docker daemon. Four routes:
  `GET /v1/health` and `GET /v1/openapi.json` unauthenticated (the latter for
  the same "spec describes shapes, not data" reason the main app's is public,
  health so a monitor can probe liveness without holding the token),
  `POST /v1/build` and `GET /v1/stats` behind `Authorization: Bearer <token>`.
  It is **not** a deploy target : the deploy/lifecycle/logs routes it used to
  carry were removed along with remote deploys (see Build servers above), and
  `AgentClientService.verifyToken` probes `/v1/stats` for exactly that reason.
  This is the alternative to registering a build server by raw `tcp://`/`ssh://`
  Docker socket : instead of exposing the daemon itself, the build server runs
  this agent and the main app only ever talks HTTP-plus-bearer-token to it.
  **Wired into the main app**: `remote_host.kind` (`"docker"` | `"agent"`) +
  `agentUrl`/`agentTokenEnc` (schema.ts), `AgentClientService`
  (`$lib/services/agent-client.service.ts`, a thin HTTP client over
  `build`/`stats`/`health`), and the Remote Hosts "new host" form's
  connection-type toggle; `deploy.service.ts` branches on
  `RemoteHostDTO.resolveBuildTarget()`'s `kind` to route a git build through
  `DockerService` or `AgentClientService`. The agent has no access to the main
  app's source tree at runtime, so `packages/agent/docker.ts` and
  `packages/agent/stats.ts` intentionally re-implement (not import) the
  equivalent logic from `docker/git-build.ts` and `SystemStatsService`; keep the
  two in sync by hand if one changes. `packages/agent/schemas.ts` holds the zod
  schema for the build body, `safeParse`d at the route rather than cast, and
  `packages/agent/openapi.ts` generates the agent's own OpenAPI 3.1 doc from the
  same schema, the "one schema, two purposes" approach the main app uses (see
  OpenAPI above).
- **`packages/installer/`**, a single-binary installer
  (`packages/installer/index.ts`) meant to be the target of a `curl | bash`
  one-liner (`packages/installer/bootstrap.sh`) on a fresh Linux server:
  installs Docker Engine + rootless prerequisites
  (`uidmap`/`dbus-user-session`), creates a dedicated non-root system user,
  installs **rootless** Docker for that user via Docker's own documented flow
  (`get.docker.com/rootless` → `dockerd-rootless-setuptool.sh`,
  `loginctl enable-linger` + a `systemd --user` unit so the daemon survives a
  headless reboot without an active login session), creates the `homerun` on
  that rootless daemon, then installs either just the Agent (`--mode=agent`,
  default, own `systemd --user` unit) or the full stack (`--mode=full`), all
  under that same rootless account, never as root. **Binaries and Docker images
  only, nothing built from source on the target host** (superseding an earlier
  draft that cloned the repo and ran `bun run build` there): `bootstrap.sh`
  downloads the `homerun-installer-<arch>` release binary itself and `exec`s it
  (no Bun, no git); `--mode=agent` downloads the matching `homerun-agent-<arch>`
  release binary straight to `/usr/local/bin/homerun-agent`; `--mode=full`
  writes a standalone `compose.yaml` (`packages/installer/steps/full-stack.ts`,
  distinct from the root dev `compose.yaml`; see Docker integration above)
  pulling the published `docker.io/orochibraru/homerun` app image alongside
  Traefik/Postgres, then `docker compose pull && ...up -d`.

  **`--mode=full` resolves an address for the instance and it is never
  `localhost`** (`index.ts`'s `resolveHost`): `--domain=` wins, else an
  interactive prompt (skipped when stdin isn't a TTY, which is every
  `curl | bash` install), else `Detector.hostAddress()` (the `src` of
  `ip -4 route get 1.1.1.1`, falling back to the first non-loopback
  `hostname -I` address). It becomes `baseDomain` in the generated
  `homerun.yaml` and the `ORIGIN` default in the generated `compose.yaml`, and
  `homerun.yaml` no longer carries its own `auth.origin` so those two can't
  disagree. **Real, reported bug this fixes**: the old `http://localhost:3000`
  default didn't just produce wrong absolute URLs, it made a fresh instance
  impossible to sign up to. With `ORIGIN` set, SvelteKit normalizes `event.url`
  to it, so better-auth derives its `baseURL`, and therefore its trusted
  origins, from `localhost` while the browser's `Origin` header is the real
  address, and `POST /api/v1/auth/sign-up/email` 403s with `Invalid origin`.
  `compose.prod.yaml` (the manual Option B path, where nothing can detect an
  address) makes `ORIGIN` required with `${ORIGIN:?...}` instead, the same
  fail-closed shape `AUTH_SECRET` already used.

  `packages/installer/steps/release.ts` is the one place both artifact kinds
  (release binaries vs. the Docker image) resolve from: `--version=` (a GitHub
  release tag, default `latest`) picks which release's binaries to fetch, but
  doesn't pin the app image the same way: `docker.yaml` tags images by commit
  SHA + `latest` only, there's no `:vX.Y.Z` image tag, a real asymmetry in this
  repo's release pipeline documented in that file rather than papered over.
  Every shell-out goes through one `StepRunner` (`packages/installer/exec.ts`)
  so `--dry-run` (print every command instead of running it) is a single
  interception point, not scattered per-step conditionals. **Verified**: the
  full command sequence via `--dry-run` for both modes (including on a non-Linux
  dev machine, via a dry-run-only package-manager-detection fallback, and
  including the generated `compose.yaml` content), and that the compiled
  binary's dry-run output matches running from source.

  **The real, mutating steps are now verified too**, against two real disposable
  Multipass Ubuntu 24.04 VMs (superseding this section's earlier "needs a
  disposable VM/CI runner this environment doesn't have" note): `--mode=agent`
  end to end (real `apt`/Docker Engine install, real rootless Docker setup, real
  `systemd --user` unit, the Agent actually running and reachable over the
  network, health endpoint + OpenAPI both responding from outside the VM), and
  `--mode=full` end to end on a second VM (real rootless Docker, real
  `docker compose pull && ...up -d` bringing up Traefik, Postgres, and the real
  published `docker.io/orochibraru/homerun` app image, all healthy, dashboard
  reachable from outside the VM). See `packages/installer/README.md` for the
  full verification notes and the real bugs this run found and fixed
  (AppArmor-restricted unprivileged user namespaces on Ubuntu 24.04, an
  RootlessKit privileged-port restriction blocking Traefik's 80/443, an unquoted
  YAML scalar in the generated compose file, a postgres-18 volume-mount-path
  mismatch, and a missing `ORIGIN` env var, all now fixed in
  `packages/installer/steps/rootless-docker.ts` and `.../steps/full-stack.ts`).
  **Still not verified**: `packages/installer/swarm-join.sh` (see Swarm mode
  above), this session's VM testing didn't touch it, it remains untested against
  a real second host or a real swarm, same caveat as before.

  This whole run is reproducible, not a one-off: `scripts/e2e-multipass.ts`
  (`bun run e2e:multipass`) automates exactly this, builds the
  installer/agent/CLI binaries from local source (not a published release, so it
  catches a regression before it ships), launches two disposable Multipass VMs,
  runs the real installer binary on each (`--mode=agent` / `--mode=full`), signs
  up + onboards the bootstrap admin over the real HTTP API, registers the agent
  VM as a build server and deploys/stops/starts a real service, then drives a
  real `homerun login` device-code round trip plus every documented CLI command
  from a throwaway Docker container, tearing everything down after (`--keep` to
  leave it running, `--skip-build` to reuse a previous build). Deliberately
  **not** wired into any GitHub Actions workflow, this repo's CI runners have no
  nested virtualization for Multipass, it's a local-only tool to run by hand
  before cutting a release or after touching installer/agent/CLI code.

  `scripts/e2e-multipass-release.ts` (`bun run e2e:multipass:release`) is its
  mirror image, and the two share `scripts/e2e/` (`multipass.ts`, the VM/HTTP
  machinery both drive; `docs.ts`, the docs command extractor; `release.ts`, the
  GitHub-release resolver). Where the suite above builds from local source and
  runs the binaries directly, this one runs **only what's already published,
  using the commands the docs themselves print**: the one-liners are extracted
  from `docs/getting-started.md`, `packages/agent/README.md` and
  `docs/api-and-cli.md` at run time and executed verbatim (`Vm.runScript` writes
  a documented block to a file and runs it rather than re-typing it), so a
  renamed flag, a moved `raw.githubusercontent.com` path, or a landing page that
  disagrees with `docs/getting-started.md` fails the run. Phases are
  `--only=`/`--skip=` selectable: `docs` (cross-checks every place the same
  command is documented, asserts each documented URL exists in this checkout
  _and_ is live, and asserts the GitHub release under test really published all
  six binaries, no VM needed, seconds to run), `full`, `agent`, `remote`, `cli`,
  `compose` (`docs/getting-started.md`'s Option B, on rootful Docker). Because
  it tests what's published, a fix in the working tree isn't reflected until it
  ships, that's the point, not a gap, `--ref=<branch>` points the documented
  URLs at a pushed branch when verifying a docs/installer change before merging,
  and `--version=vX.Y.Z` pins a release instead of `latest`.

### Documentation (`docs/`, `packages/docs/`, `README.md`, `CONTRIBUTING.md`)

Three audiences, three places, keep them apart:

- **`CLAUDE.md`** (this file): everything a future session needs that isn't
  derivable from the code, including the "real, tested finding" notes. Not
  user-facing.
- **`docs/*.md`**: the operator-facing guides (`getting-started`,
  `configuration`, `services`, `remote-hosts-and-agent`, `storage-and-backups`,
  `projects-and-templates`, `users-and-access`, `api-and-cli`,
  `faq-and-limitations`, indexed by `docs/README.md`), plus the root
  `README.md`; `CONTRIBUTING.md` covers the dev-workflow half. These are the
  source of truth, plain Markdown, readable straight from the repo. The commands
  they print are **executed verbatim** by `bun run e2e:multipass:release` (see
  below), so a stale install one-liner is a test failure, not just a doc nit.
- **`packages/docs/`**: a standalone, fully static SvelteKit site (own
  `svelte.config.js`/`vite.config.ts`/`tsconfig.json`, `adapter-static`, sharing
  the root `package.json`/`bun install` like every other `packages/*`
  sub-project) that renders the landing page, a `/docs/<slug>` page per file
  under `docs/` (via `import.meta.glob` at build time, never a second copy to
  keep in sync), and a `/docs/api` Swagger UI page. Published as
  `docker.io/orochibraru/homerun-docs`.

**A dead `#anchor` in `docs/` fails the docs image build, and nothing else
catches it.** `adapter-static`'s prerender resolves every cross-page anchor
against the ids `docs-content.ts`'s own slugger emits, and errors on a miss;
`bun run check` only runs `check:docs` (svelte-check), never a prerender, so a
heading rename that orphans a link is green locally and red in
`Docker Build (Docs)`. Run `bun run build:docs` after renaming a heading in
`docs/`.

`bun run dev:docs`/`build:docs`/`check:docs` all go through `scripts/docs.ts`
rather than plain `vite`/`svelte-check`, for two reasons documented at length in
that file: it writes a stub `.svelte-kit/tsconfig.json` at the **repo root** (a
real, tested rolldown-vite bug resolves `packages/docs/tsconfig.json`'s
`extends` chain against the repo root instead of `packages/docs/`, and fails
outright if that file doesn't exist, invisible locally the moment
`bun run dev`/`check:app` has run once, caught for real by a clean Docker
build), and it copies the checked-in root `openapi.json` into
`packages/docs/static/` (gitignored, regenerated every dev/build) so the Swagger
UI page has a spec to serve. `check:docs` is part of `bun run check`.

## Planned features (not yet built)

Intentional gaps, noted so a future session has the intended shape rather than
re-litigating design decisions.

- **Health-gated rollout**: opt-in health check (path + expected status/timeout)
  gating whether a newly-deployed container receives traffic, blue-green style,
  keep the old container alive/routable until the new one passes, roll back
  (never route to it) if it doesn't.
- **Storage**: S3 backup now covers both volume kinds (a Docker-managed named
  volume is read out through a throwaway helper container, see S3 backups
  above), but there's still no restore flow, upload only.
- **Observability**: system stats beyond the dashboard's host-level
  CPU/RAM/GPU/disk, no per-container `docker stats` view yet (swarm mode's
  `inspectSwarmServiceStatus` aggregates task state, not per-task resource
  usage, see Swarm mode above).
- **Security**: the per-app login wall is built and works end to end (see
  Per-app login wall above); what's still missing there is finer-grained
  revocation than the 8h cookie lifetime for a user deleted or re-grouped at the
  provider. Custom SSL cert handling exists too (see below) but genuinely
  requires the admin's own one-time Traefik config change to take effect.
- **Source integration**: git-based builds exist (see Git-based builds above),
  no private-repo credential field beyond a token in the clone URL, no
  webhook/auto-deploy-on-push. Build servers exist too (see Build servers
  above); adding capacity for _deploys_ is Swarm's job, and
  `packages/installer/swarm-join.sh` (joining a node as a worker) is still
  unverified against a real swarm.
- **Onboarding**: the forced first-run wizard now exists (`/onboarding`, see
  above), and setup diagnostics feed a highlighted deep-link into `/settings`
  instead of a standalone page; DNS automation itself now exists (Cloudflare and
  Pangolin, see above), but the wizard doesn't walk a new admin through
  configuring either one yet, that's still a manual `/settings` visit after
  onboarding finishes.
- **User roles**: admin/developer roles, admin-managed direct-create and email
  invites exist (see User roles & admin-managed accounts above), "developer" is
  a label plus route-gating only, no finer-grained permissions (e.g. no
  per-project access control, no read-only role) built yet.
- **Notifications / webhooks**: the in-app lifecycle event feed now exists (see
  In-app notifications above); outbound webhooks (Telegram/Discord/generic HTTP)
  on the same events are still unbuilt.

`TODO.md` at the repo root tracks open follow-up items separately from this
intentional-gaps list.
