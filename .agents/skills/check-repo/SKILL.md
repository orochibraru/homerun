---
name: check-repo
description: >-
  Run this before considering any change to this repo done. Executes the real
  gates this codebase enforces: bun run type-check (svelte-check
  --fail-on-warnings over src/ and tests/, bun check over scripts/, plus go vet
  and golangci-lint over every Go package under cmd/ and internal/, 0 errors AND
  0 warnings) and bun run lint (markdownlint-cli2, lint-tailwind.ts, oxlint
  --type-aware --deny-warnings), plus the matching unit tests. Use whenever
  finishing an edit to this codebase, before saying a change is "done", or after
  any change under src/, cmd/, internal/, scripts/ or tests/.
allowed-tools:
  Bash(bun run type-check), Bash(bun run lint), Bash(bun run lint:fix), Bash(bun
  run test), Bash(bun run gen), Bash(go vet *), Bash(go test *), Bash(go tool
  *), Bash(bun fmt *), Bash(git diff *), Bash(git status *)
---

# check-repo

This repo's CLAUDE.md is explicit: **"After every change" means run it after
every change, not just once at the end of a session, and it means the whole
repo.** Don't rationalize a red result as "unrelated to what I touched" without
actually reading the failing file first.

## Steps

1. **`bun run type-check`** — svelte-check (`--fail-on-warnings`, full `src/`
   and `tests/` trees), `bun check` over `scripts/` (its own tsconfig), then
   `go vet` and `golangci-lint run`
   (`go tool -modfile=tools/go/go.mod golangci-lint run`, the same pair CI's Go
   job runs) over `./cmd/... ./internal/... ./tests/unit/go/...` — every Go
   sub-project (the CLI, the installer, and the worker including its agent mode,
   all `package main`s in the repo-root `go.mod`) plus every shared `internal/`
   library, in one pass. This is the hard gate: 0 errors, 0 warnings. A warning
   fails it exactly like an error. Scope is always the whole repo regardless of
   which files were edited, so a failure anywhere is in scope, not just in files
   this change touched. Scope to one sub-project by narrowing the path yourself,
   e.g.
   `go vet ./cmd/cli/... ./internal/cli/... ./tests/unit/go/internal/cli/...`.

2. **`bun run lint`** — `markdownlint-cli2`, `scripts/lint-tailwind.ts` and
   `oxlint --type-aware --deny-warnings`, must be clean, whole repo. If anything
   is fixable, `bun run lint:fix` before re-checking. Note: this script doesn't
   format: formatting and import order are `bun fmt` (config in `bunfig.toml`'s
   `[fmt]`), run by the pre-commit hook, and `.claude/settings.json` runs it on
   every edited file as a PostToolUse hook, so most formatting drift is caught
   immediately. `bun fmt --check` confirms the whole repo.

3. **If a REST API route under `src/routes/api/v1/`, `src/lib/openapi/` or
   `src/lib/config.ts` changed**: `bun run gen`, and keep the regenerated
   `openapi.json`, `homerun.schema.json` and
   `tests/integration/support/openapi-types.ts` in the change. CI fails when
   they're stale.

4. **Run the unit tests that cover what changed**: `bun run test` for everything
   (a few seconds, unit only, no Postgres/Docker needed), or scope it —
   `bun --conditions=svelte --config=bunfig.unit.toml test tests/unit/app` for
   the SvelteKit side,
   `go test ./cmd/cli/... ./internal/cli/... ./tests/unit/go/internal/cli/...`
   (swap `cli` for `installer` or `worker`/`agent`) for one Go sub-project.

5. **IDE diagnostics are not ground truth in this repo.** If an inline IDE error
   looks suspicious or doesn't match what `bun run type-check` reports, trust
   `oxlint <file>` and `bun run type-check` over the IDE — this repo has a
   documented history of stale/phantom inline diagnostics.

## Reporting

State plainly which commands were run and their actual output — don't say "looks
clean" without having run them in this turn. If something fails, quote the real
error with file:line, don't paraphrase it away. A change is not done until every
applicable step above is clean.
