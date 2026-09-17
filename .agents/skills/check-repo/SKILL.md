---
name: check-repo
description: >-
  Run this before considering any change to this repo done. Executes the real
  gates this codebase enforces: bun run check (svelte-check --fail-on-warnings
  over src/ and tests/ plus tsc over packages/agent, packages/installer and
  scripts/, plus go vet over the Go packages/cli, 0 errors AND 0 warnings) and
  bun run lint (markdownlint-cli2, tailwint, biome check --error-on-warnings),
  plus the matching unit tests. Use whenever finishing an edit to this codebase,
  before saying a change is "done", or after any change under src/, packages/,
  scripts/ or tests/.
user-invocable: true
allowed-tools:
  Bash(bun run check), Bash(bun run check:*), Bash(bun run lint), Bash(bun run
  lint:*), Bash(bun run test:unit*), Bash(bun run gen), Bash(bunx biome check
  *), Bash(git diff *), Bash(git status *)
---

# check-repo

This repo's CLAUDE.md is explicit: **"After every change" means run it after
every change, not just once at the end of a session, and it means the whole
repo.** Don't rationalize a red result as "unrelated to what I touched" without
actually reading the failing file first.

## Steps

1. **`bun run check`** — `check:app` (svelte-kit sync + svelte-check with
   `--fail-on-warnings`, full `src/` and `tests/` trees) then `check:packages`
   (`tsc --noEmit` over `packages/installer`, `packages/agent` and `scripts/`,
   each with its own tsconfig, plus `go vet ./packages/cli/...` for the CLI,
   which is a separate Go module, not TypeScript). This is the hard gate: 0
   errors, 0 warnings. A warning fails it exactly like an error. Scope is always
   the whole repo regardless of which files were edited, so a failure anywhere
   is in scope, not just in files this change touched.

2. **`bun run lint`** — `lint:md` (markdownlint-cli2), `lint:tailwind`
   (tailwint) and `lint:ts` (`biome check --error-on-warnings`), must be clean,
   whole repo. If anything is fixable, `bun run lint:fix` (the `--fix`/`--write`
   half of all three) before re-checking. Note: `.claude/settings.json` already
   runs `biome check --write` on every edited code file and `prettier --write`
   on every edited markdown file as PostToolUse hooks, so most formatting drift
   is caught immediately — this step is the final confirmation, not the first
   line of defense.

3. **If a REST API route under `src/routes/api/v1/`, `$lib/openapi/` or
   `src/lib/config.ts` changed**: `bun run gen`, and keep the regenerated
   `openapi.json`, `homerun.schema.json` and
   `tests/integration/support/openapi-types.ts` in the change. CI fails when
   they're stale.

4. **Run the unit tests that cover what changed**: `bun run test:unit` for
   everything (a few seconds), or `bun run test:unit:app` / `test:unit:agent` /
   `test:unit:cli` / `test:unit:installer` for one area.

5. **IDE diagnostics are not ground truth in this repo.** If an inline IDE error
   looks suspicious or doesn't match what `bun run check` reports, trust
   `bunx biome check <file>` and `bun run check` over the IDE — this repo has a
   documented history of stale/phantom inline diagnostics.

## Reporting

State plainly which commands were run and their actual output — don't say "looks
clean" without having run them in this turn. If something fails, quote the real
error with file:line, don't paraphrase it away. A change is not done until every
applicable step above is clean.
