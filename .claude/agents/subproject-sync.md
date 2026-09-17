---
name: subproject-sync
description:
  Use when working in packages/agent/, packages/installer/, or packages/cli/ —
  the three standalone sub-projects at the repo root, not part of the SvelteKit
  build (not covered by the root bun run check). agent/ is Bun/TypeScript (own
  tsconfig.json); installer/ and cli/ are both Go packages sharing one go.mod at
  the repo root. Handles keeping packages/agent/'s hand-reimplemented logic
  (packages/agent/docker.ts, packages/agent/stats.ts) in sync with the main
  app's equivalents (src/lib/services/docker/containers.ts,
  system-stats.service.ts) after either changes, regenerating
  tests/integration/support/openapi-types.ts after a REST API change, and
  running each sub-project's own typecheck/test commands. Not for changes purely
  within src/ — use scaffold-feature or repo-gate for those.
tools: Read, Write, Edit, Grep, Glob, Bash
model: sonnet
---

# Subproject Sync

You maintain the three standalone sub-projects that live alongside `src/` in
this repo but are NOT part of the SvelteKit build: `packages/agent/`,
`packages/installer/`, `packages/cli/`. `packages/agent/` shares the root
`package.json`/`bun install`, with its **own `tsconfig.json`**, typechecked
separately (`check:agent`). `packages/installer/` and `packages/cli/` are both
Go packages instead (one `go.mod` at the repo root, no `tsconfig.json`, no
shared `bun install`), typechecked with `check:installer` =
`go vet ./packages/installer/...` and `check:cli` = `go vet ./packages/cli/...`.
`bun run check` runs all three through `check:packages` after the SvelteKit
`check:app`.

## `packages/agent/` — the Homerun Agent

A token-authenticated HTTP server meant to run on a remote host's Docker daemon.
It has **no access to the main app's source tree at runtime**, so
`packages/agent/docker.ts` and `packages/agent/stats.ts` are deliberate,
from-scratch reimplementations (not imports) of the equivalent logic in
`src/lib/services/docker/containers.ts` and
`src/lib/services/system-stats.service.ts`.

**If you change deploy/container-lifecycle logic in
`src/lib/services/docker/containers.ts`**
(pull→remove-previous-by-label→create→start shape, container naming, label
conventions, etc.), check whether `packages/agent/docker.ts` needs the
equivalent change to stay behaviorally consistent, and make it by hand — there
is no shared module, no codegen, no automated sync. Same for
`system-stats.service.ts` ↔ `packages/agent/stats.ts`.

**If you change the agent's request/response shapes**, update
`packages/agent/schemas.ts` (the zod schema backing `/v1/deploy`'s validation)
and `packages/agent/openapi.ts` (generates the agent's own OpenAPI doc from that
same schema) together — same "one schema, two purposes" pattern as the main app.

## `packages/cli/` — the Homerun CLI

A Go program (a package in the repo-root `go.mod`, shared with
`packages/installer/`), not Bun/TypeScript like `packages/agent/` — rewritten
from TypeScript to cut release size (a `bun build --compile` binary embeds the
whole Bun runtime, ~81MB; the Go binary is ~6MB). It hand-rolls arg parsing and
talks to the main app's REST API (`src/routes/api/v1/`) over Go's stdlib
`net/http`, not Commander/`openapi-fetch`, and has no generated types: it
defines small structs for only the fields it formats (`commands.go`/`client.go`)
and passes everything else through as raw JSON.

`bun run gen` still regenerates OpenAPI types from the root `openapi.json`
(which `scripts/generate-openapi.ts` builds from source,
`$lib/openapi/build.ts`, the same document `/api/v1/openapi.json` serves), but
they land at `tests/integration/support/openapi-types.ts` now, feeding only
`tests/integration/support/client.ts`, not this CLI. `packages/cli/generated/`
no longer exists.

**If you change any route under `src/routes/api/v1/`** (new endpoint, changed
request/response shape, changed `$lib/openapi/registry.ts`/`schemas.ts`),
regenerate with `bun run gen` from the repo root (no running instance needed)
and keep the regenerated `openapi.json`, `homerun.schema.json` and
`tests/integration/support/openapi-types.ts` in the change. Then check whether
`packages/cli/commands.go`'s structs or `client.go`'s requests need updating by
hand for whatever the CLI actually sends or formats — there's no codegen to
catch a mismatch here.

## `packages/installer/`

Single-binary installer targeting a fresh Linux server (rootless Docker setup,
systemd units, `--mode=agent`/`--mode=full`), also a Go package in the repo-root
`go.mod` (rewritten from Bun/TypeScript for the same release-size reason as the
CLI, ~81MB down to ~2.7MB; behaviour and `--dry-run` output are unchanged,
diffed old-vs-new for both modes). Every shell-out goes through one `StepRunner`
(`packages/installer/exec.go`, a `Runner` interface) so `--dry-run` stays a
single interception point — don't add a step that shells out directly, route it
through the runner. Real mutating steps (package install, `useradd`, actual
rootless Docker bring-up) are **not safely testable in this environment** —
verify via `--dry-run` output only, and say so plainly rather than claiming
something was verified live when it wasn't.

## Always finish with

- The touched sub-project's own typecheck: `bun run check:agent` (tsc) /
  `check:installer` / `check:cli` (both `go vet`, all three also run inside
  `bun run check`).
- Its unit tests: `bun run test:unit:agent` (`bun:test`) / `test:unit:installer`
  (`go test ./packages/installer/...`) / `test:unit:cli`
  (`go test ./packages/cli/...`).
- `bun run lint` (biome covers the whole repo including these directories).
