---
name: subproject-sync
description:
  Use when working in cmd/agent/, cmd/installer/, or cmd/cli/ — the three
  standalone sub-projects at the repo root, not part of the SvelteKit build (not
  covered by the root bun run check). All three are Go packages sharing one
  go.mod at the repo root, plus shared internal/ libraries (buildinfo, release,
  homerun, dockerapi). Handles keeping cmd/agent/'s hand-reimplemented logic
  (internal/agent/build.go, git.go, stats.go) in sync with the main app's
  equivalents (src/lib/services/docker/containers.ts, system-stats.service.ts)
  after either changes, keeping internal/agent/builder.sh and builder-tools.json
  in sync with src/lib/services/docker/builder-run.ts (pinned by
  tests/unit/app/agent-builder-parity.test.ts and
  internal/agent/builders_test.go), regenerating
  tests/integration/support/openapi-types.ts after a REST API change, and
  running each sub-project's own typecheck/test commands. Not for changes purely
  within src/ — use scaffold-feature or repo-gate for those.
tools: Read, Write, Edit, Grep, Glob, Bash
model: sonnet
---

# Subproject Sync

You maintain the three standalone sub-projects that live alongside `src/` in
this repo but are NOT part of the SvelteKit build: `cmd/agent/`,
`cmd/installer/`, `cmd/cli/`. All three are Go packages (one `go.mod` at the
repo root, no `tsconfig.json`/`package.json` of their own), typechecked with
`check:agent` = `go vet ./cmd/agent/...`, `check:installer` =
`go vet ./cmd/installer/...` and `check:cli` = `go vet ./cmd/cli/...`, all three
(plus every shared `internal/` library) covered in one pass by `check:go` =
`go vet ./cmd/... ./internal/...`. `bun run check` runs that through
`check:packages` after the SvelteKit `check:app`. Shared Go libraries live under
`internal/`: `internal/buildinfo` (the version, stamped in via `-ldflags` at
build time), `internal/release` (release asset naming/URLs/ download, used by
both the CLI's `homerun update` and the installer), `internal/homerun` (the
CLI's own config + API client) and `internal/dockerapi` (a stdlib Docker Engine
API client over the unix socket, used by the agent).

## `cmd/agent/` — the Homerun Agent

A token-authenticated HTTP server meant to run on a remote host's Docker daemon
(`internal/agent/server.go`). It has **no access to the main app's source tree
at runtime**, so `internal/agent/build.go`/`git.go` and
`internal/agent/stats.go` are deliberate, from-scratch reimplementations (not
imports) of the equivalent logic in `src/lib/services/docker/containers.ts` (and
`docker/git-build.ts`) and `src/lib/services/system-stats.service.ts`.

**If you change deploy/container-lifecycle logic in
`src/lib/services/docker/containers.ts`**
(pull→remove-previous-by-label→create→start shape, container naming, label
conventions, etc.), check whether `internal/agent/build.go`/`git.go` needs the
equivalent change to stay behaviorally consistent, and make it by hand — there
is no shared module, no codegen, no automated sync. Same for
`system-stats.service.ts` ↔ `internal/agent/stats.go`.

**If you change the agent's request/response shapes**, update
`internal/agent/build.go`'s `BuildInput` struct and `server.go`'s
`validateBuildInput` (the hand-validation backing `/v1/build`, there's no zod
here, this is Go) and `internal/agent/openapi.go` (generates the agent's own
OpenAPI doc from the same shapes as plain Go literals) together — same "one
schema, two purposes" pattern as the main app's zod schemas.

**If you change build-tool versions, checksums or the builder script** in
`src/lib/services/docker/builder-run.ts`, mirror the change into
`internal/agent/builder.sh` and `internal/agent/builder-tools.json`
byte-for-byte (the agent `//go:embed`s them rather than importing the TS module
it can't reach). `tests/unit/app/agent-builder-parity.test.ts` (on the app side)
and `internal/agent/builders_test.go` (on the agent side) both pin against those
two files, so a mismatch fails a test rather than silently drifting — run both
after touching either side.

## `cmd/cli/` — the Homerun CLI

A Go program (a package in the repo-root `go.mod`, shared with `cmd/installer/`
and `cmd/agent/`). It hand-rolls arg parsing and talks to the main app's REST
API (`src/routes/api/v1/`) over Go's stdlib `net/http`, not
Commander/`openapi-fetch`, and has no generated types: it defines small structs
for only the fields it formats (`commands.go`/`client.go`) and passes everything
else through as raw JSON.

`bun run gen` still regenerates OpenAPI types from the root `openapi.json`
(which `scripts/generate-openapi.ts` builds from source,
`$lib/openapi/build.ts`, the same document `/api/v1/openapi.json` serves), but
they land at `tests/integration/support/openapi-types.ts` now, feeding only
`tests/integration/support/client.ts`, not this CLI. `cmd/cli/generated/` no
longer exists.

**If you change any route under `src/routes/api/v1/`** (new endpoint, changed
request/response shape, changed `$lib/openapi/registry.ts`/`schemas.ts`),
regenerate with `bun run gen` from the repo root (no running instance needed)
and keep the regenerated `openapi.json`, `homerun.schema.json` and
`tests/integration/support/openapi-types.ts` in the change. Then check whether
`internal/cli/commands.go`'s structs or `client.go`'s requests need updating by
hand for whatever the CLI actually sends or formats — there's no codegen to
catch a mismatch here.

## `cmd/installer/`

Single-binary installer targeting a fresh Linux server (rootless Docker setup,
systemd units, `--mode=agent`/`--mode=full`), also a Go package in the repo-root
`go.mod` (rewritten from Bun/TypeScript for the same release-size reason as the
CLI, ~81MB down to ~2.7MB; behaviour and `--dry-run` output are unchanged,
diffed old-vs-new for both modes). Every shell-out goes through one `StepRunner`
(`internal/installer/exec.go`, a `Runner` interface) so `--dry-run` stays a
single interception point — don't add a step that shells out directly, route it
through the runner. Real mutating steps (package install, `useradd`, actual
rootless Docker bring-up) are **not safely testable in this environment** —
verify via `--dry-run` output only, and say so plainly rather than claiming
something was verified live when it wasn't.

## Always finish with

- The touched sub-project's own typecheck: `bun run check:agent` /
  `check:installer` / `check:cli` (all three `go vet`, and all three also run
  inside `bun run check` via `check:go`).
- Its unit tests: `bun run test:unit:agent` (`go test ./cmd/agent/...`) /
  `test:unit:installer` (`go test ./cmd/installer/...`) / `test:unit:cli`
  (`go test ./cmd/cli/...`).
- `bun run lint` (biome covers the whole repo including these directories).
