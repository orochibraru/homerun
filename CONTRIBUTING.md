# Contributing to Homerun

This is the "I want to run this from source and change code" guide. If you just
want to _run_ Homerun, you don't need any of this: use the installer one-liner
or `compose.prod.yaml` instead, see
[docs/getting-started.md](docs/getting-started.md). Nothing here (git, Bun, a
dev server) is needed for either of those paths.

## Prerequisites

- [mise](https://mise.jdx.dev), then `mise install` in the repo: it installs the
  Bun, Go, prek and golangci-lint versions pinned in `mise.toml`. Without mise,
  install those four yourself at the same versions (Go is only needed for `cmd/`
  and `internal/`, the worker, agent, CLI and installer)
- Docker (for Traefik + Postgres, and for the containers the app itself will
  manage once it's running)

## Toolchain (mise)

`mise.toml` pins the tools a checkout needs outside `node_modules`: Bun, Go,
prek and golangci-lint. `mise install` installs them, and mise's shell
activation (`eval "$(mise activate zsh)"`, see
[mise's docs](https://mise.jdx.dev/getting-started.html)) puts those versions on
`PATH` inside the repo. `mise ls` shows what's active.

mise can't install Docker itself, only check it: `mise run docker` (also run
after every `mise install`) fails if no daemon is reachable or `docker compose`
v2 is missing, and creates the `homerun` network if it doesn't exist yet.

CI doesn't use mise, so the same versions are also pinned elsewhere, and a bump
has to touch every copy: Bun in `package.json`'s `packageManager` and the
`Dockerfile`'s `oven/bun` tags, Go in `go.mod` and the `Dockerfile`'s `golang`
tag, golangci-lint in `.github/workflows/go.yaml` and `code_quality.yaml`, prek
via `j178/prek-action` in `code_quality.yaml`. Renovate updates `mise.toml`
along with the rest.

## Setup

```sh
git clone https://github.com/orochibraru/homerun.git && cd homerun
mise install
bun install
docker network create homerun # already done by mise install
docker compose up -d          # Traefik + Postgres, see compose.yaml
cp .env.example .env          # set AUTH_SECRET, and ORIGIN=http://localhost:5173 for bun run dev
bun run dev
```

Open `http://localhost:5173`. Migrations in `drizzle/` apply themselves at boot;
`bun run db:generate` is only for when you change `src/lib/server/db/schema.ts`.
The app runs directly on the host (not in a container) so it can reach the
Docker socket without any socket-forwarding; [`compose.yaml`](compose.yaml) only
runs Traefik and Postgres. The first account you create becomes admin
automatically; signing in for the first time drops you into the onboarding
wizard (base domain / Docker / Traefik / email).

`bun run dev` also runs the job worker (`cmd/worker`, Go), with its output
prefixed `[worker]`. Deploys, builds, scans, backups, cron jobs and Docker
cleanups only run while it's up. It rebuilds and restarts on every change under
`cmd/` or `internal/`; a change that doesn't compile prints the error and leaves
the previous worker running. `bun run dev:app` is vite alone,
`bun run dev:worker` the worker alone. Without Go installed, run the worker in
Docker instead: `docker compose --profile worker up -d --build worker` (rebuild
it after a Go change).

`bun run build && bun run start` runs the built app instead of the Vite dev
server, closer to how the production Docker image runs it, still directly on the
host, still against the same `compose.yaml` Postgres/Traefik.

`cmd/agent/`, `cmd/cli/` and `cmd/installer/` are all Go programs (one `go.mod`
at the repo root, no `bun install` needed for any of them): `go run ./cmd/agent`
(also `bun run dev:agent`), `go run ./cmd/cli services list`,
`go run ./cmd/installer --dry-run`, etc.

## Before every change: the hard gates

These are enforced by git hooks, not just CI. The hooks are run by
[prek](https://github.com/j178/prek) from `.pre-commit-config.yaml`; prek comes
from `mise install`, then `bun install` wires them up for you (`prepare` runs
`prek install`, which installs the pre-commit, commit-msg and pre-push hooks). A
commit only runs the fast, per-file hooks (oxlint, Biome format and import
sorting, Prettier and markdownlint, gofmt, Tailwind, typos, secret scanning), a
few seconds. A push runs the whole-repo gates: the type check, unit tests (80%
coverage gate), golangci-lint and the Go tests. Hooks autofix in place, so a
commit that gets rejected for "files were modified by this hook" just needs
`git add` and a re-commit. After pulling this change, run `prek install` once so
the pre-push hook exists.

```sh
bun run check   # svelte-check --fail-on-warnings over src/ and tests/, then go vet over every package under cmd/ and internal/, plus tsc over scripts/, zero errors AND zero warnings
bun run lint    # markdownlint-cli2, tailwint, oxlint --type-aware (linting) and biome check (formatting, import order), whole repo
```

Run both after _every_ change, not just once at the end. `bun run check`'s scope
is already the whole repo regardless of which files you touched, so a red result
elsewhere is still your problem to look at, not something to wave off as
unrelated without actually checking. `bun run check` includes `go vet` over
`cmd/agent/`, `cmd/cli/`, `cmd/installer/` and every shared `internal/` library
(`check:go`) plus the `scripts/` typecheck (`check:scripts`), together
`check:packages`; `bun run check:agent` / `check:installer` / `check:cli` /
`check:scripts` run one of them alone. If you changed a REST API route or
`config.ts`, also run `bun run gen` and commit the regenerated `openapi.json`,
`homerun.schema.json` and `tests/integration/support/openapi-types.ts`: CI fails
when they're stale.

`bun run test:unit` is the fast suite (seconds, no Postgres or Docker needed).
`bun run test` runs the whole `bun:test` suite, unit + integration, see
`CLAUDE.md`'s "Commands" section for the full breakdown of `test`/`test:*`
scripts and `.agents/notes/testing.md` for what integration and E2E need.

Two real-infrastructure suites live outside that (Multipass + Docker locally,
never in CI): `bun run e2e:multipass` drives the installer/agent/CLI built from
your working tree, and `bun run e2e:multipass:release` drives the published
release using the commands the docs themselves print. If you touched an install
instruction, `bun run e2e:multipass:release --only=docs` is the seconds-long,
VM-free half of the latter.

## Conventions

The full, detailed set of architectural and style conventions this codebase
holds itself to lives in [`CLAUDE.md`](CLAUDE.md): route-file typing rules, the
DTO layer, the OOP-vs-static-class conventions, and a long list of "real,
tested" findings from past work worth not re-discovering the hard way. Read it
before a non-trivial change; it's written for exactly this purpose (it's also
what Claude Code reads when working in this repo).

## Commits

Commit messages follow
[Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
`chore:`, etc.). `semantic-release` drives version bumps and changelog
generation from them on every push to `main` (`.releaserc.json`,
`.github/workflows/publish.yaml`), so a misformatted subject line isn't just a
style nit, it changes what actually ships.

PRs are squash-merged with the PR title as the commit message, so the **PR
title** is what counts, and CI fails a PR whose title isn't a conventional
commit. Only `feat`, `fix`, `perf`, `refactor`, `docs` and breaking changes
(`feat!:`) cut a release. Changes that only touch `docs/`, markdown files,
`.agents/` or `.claude/` don't trigger a release or image build on their own.

## Releases

Don't run `bun run release` yourself; it's CI-only, triggered on push to `main`.
See the "Release automation" section of
[`.agents/notes/packages-and-release.md`](.agents/notes/packages-and-release.md)
for what it does (binaries for `cmd/agent`/`cmd/installer`/`cmd/cli`, the Docker
image, the GitHub release).
