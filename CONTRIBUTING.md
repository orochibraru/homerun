# Contributing to Homerun

This is the "I want to run this from source and change code" guide. If you just
want to _run_ Homerun, you don't need any of this: use the installer one-liner
or `compose.prod.yaml` instead, see
[docs/getting-started.md](docs/getting-started.md). Nothing here (git, Bun, a
dev server) is needed for either of those paths.

## Prerequisites

- [Bun](https://bun.sh)
- Docker (for Traefik + Postgres, and for the containers the app itself will
  manage once it's running)

## Setup

```sh
git clone https://github.com/orochibraru/homerun.git && cd homerun
bun install
docker network create homerun
docker compose up -d          # Traefik + Postgres, see compose.yaml
cp .env.example .env          # see docs/configuration.md, or edit env vars directly
bun run db:generate
bun run dev
```

Open `http://localhost:5173`. The app runs directly on the host (not in a
container) so it can reach `/var/run/docker.sock` without any socket-forwarding;
see the top comment in [`compose.yaml`](compose.yaml). The first account you
create becomes admin automatically; signing in for the first time drops you into
the onboarding wizard (base domain / Docker / Traefik / email).

`bun run build && bun run start` runs the built app instead of the Vite dev
server, closer to how the production Docker image runs it, still directly on the
host, still against the same `compose.yaml` Postgres/Traefik.

`packages/agent/`, `packages/installer/`, `packages/cli/`, and `packages/docs/`
all share this same root `bun install`/`node_modules` (no separate per-package
installs). Run the first three directly from source with
`bun run packages/agent/index.ts`,
`bun run packages/installer/index.ts --dry-run`,
`bun run packages/cli/index.ts services list`, etc. `packages/docs/` isn't run
directly the same way, it's built/served via `bun run dev:docs`/`build:docs`
(see `packages/docs/README.md`).

## Before every change: the hard gates

These are enforced by a git pre-commit hook, not just CI: a violating commit is
rejected locally. The hook is run by [prek](https://github.com/j178/prek) from
`.pre-commit-config.yaml`; install prek (`brew install prek`, or
`uv tool install prek`), then `bun install` wires the git shim up for you
(`prepare` runs `prek install`). Hooks autofix in place, so a commit that gets
rejected for "files were modified by this hook" just needs `git add` and a
re-commit.

```sh
bun run check   # svelte-kit sync && svelte-check --fail-on-warnings, zero errors AND zero warnings, whole repo
bun run lint    # biome check ., zero errors, whole repo
```

Run both after _every_ change, not just once at the end. `bun run check`'s scope
is already the whole `src/` tree regardless of which files you touched, so a red
result elsewhere in the repo is still your problem to look at, not something to
wave off as unrelated without actually checking. If you touch `packages/agent/`,
`packages/installer/`, or `packages/cli/`, also typecheck that sub-project
specifically: `bun run check:agent` / `check:installer` / `check:cli` (or
`bun run check:packages` for all three). They're not covered by the
SvelteKit-scoped `check:app` half of `bun run check`.

`bun run test` runs the real test suite (`bun:test`, unit + integration, see
`CLAUDE.md`'s "Commands" section for the full breakdown of `test`/`test:*`
scripts).

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

## Releases

Don't run `bun run release` yourself; it's CI-only, triggered on push to `main`.
See CLAUDE.md's "Release automation" section for what it does (binaries for
`packages/agent`/`packages/installer`/`packages/cli`, the Docker image, the
GitHub release).
