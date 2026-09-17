# Contributing to Homerun

This is the "I want to run this from source and change code" guide. If you just
want to _run_ Homerun, you don't need any of this: use the installer one-liner
or `compose.prod.yaml` instead, see
[docs/getting-started.md](docs/getting-started.md). Nothing here (git, Bun, a
dev server) is needed for either of those paths.

## Prerequisites

- [Bun](https://bun.sh), the version pinned in `package.json`'s `packageManager`
  field
- Docker (for Traefik + Postgres, and for the containers the app itself will
  manage once it's running)

## Setup

```sh
git clone https://github.com/orochibraru/homerun.git && cd homerun
bun install
docker network create homerun
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

`bun run build && bun run start` runs the built app instead of the Vite dev
server, closer to how the production Docker image runs it, still directly on the
host, still against the same `compose.yaml` Postgres/Traefik.

`packages/agent/`, `packages/installer/`, and `packages/cli/` all share this
same root `bun install`/`node_modules` (no separate per-package installs). Run
each directly from source with `bun run packages/agent/index.ts`,
`bun run packages/installer/index.ts --dry-run`,
`bun run packages/cli/index.ts services list`, etc.

## Before every change: the hard gates

These are enforced by a git pre-commit hook, not just CI: a violating commit is
rejected locally. The hook is run by [prek](https://github.com/j178/prek) from
`.pre-commit-config.yaml`; install prek (`brew install prek`, or
`uv tool install prek`), then `bun install` wires the git shim up for you
(`prepare` runs `prek install`). Hooks autofix in place, so a commit that gets
rejected for "files were modified by this hook" just needs `git add` and a
re-commit.

```sh
bun run check   # svelte-check --fail-on-warnings over src/ and tests/, then tsc over packages/* and scripts/, zero errors AND zero warnings
bun run lint    # markdownlint-cli2, tailwint and biome check --error-on-warnings, whole repo
```

Run both after _every_ change, not just once at the end. `bun run check`'s scope
is already the whole repo regardless of which files you touched, so a red result
elsewhere is still your problem to look at, not something to wave off as
unrelated without actually checking. `bun run check` includes the
`packages/agent/`, `packages/installer/`, `packages/cli/` and `scripts/`
typechecks (`check:packages`); `bun run check:agent` / `check:installer` /
`check:cli` / `check:scripts` run one of them alone. If you changed a REST API
route or `config.ts`, also run `bun run gen` and commit the regenerated
`openapi.json`, `homerun.schema.json` and `packages/cli/generated/`: CI fails
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
for what it does (binaries for
`packages/agent`/`packages/installer`/`packages/cli`, the Docker image, the
GitHub release).
