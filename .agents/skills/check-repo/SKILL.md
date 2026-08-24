---
name: check-repo
description:
  Run this before considering any change to this repo done. Executes the real
  gates this codebase enforces: bun run check (svelte-check --fail-on-warnings,
  0 errors AND 0 warnings across the whole src/ tree, not just touched files)
  and bun run lint (biome check ., 0 errors), plus bunx tsc --noEmit for any of
  agent/, installer/, cli/ that were touched (separate tsconfig.json, not
  covered by the root check script). Use whenever finishing an edit to this
  codebase, before saying a change is "done", or after any change under src/,
  agent/, installer/, or cli/.
user-invocable: true
allowed-tools: Bash(bun run check), Bash(bun run lint), Bash(bunx tsc --noEmit *), Bash(bunx biome check *), Bash(git diff *), Bash(git status *)
---

# check-repo

This repo's CLAUDE.md is explicit: **"After every change" means run it after
every change, not just once at the end of a session, and it means the whole
repo.** Don't rationalize a red result as "unrelated to what I touched" without
actually reading the failing file first.

## Steps

1. **`bun run check`** — svelte-kit sync + svelte-check with
   `--fail-on-warnings`. This is the hard gate: 0 errors, 0 warnings, full
   `src/` tree. A warning fails it exactly like an error. Scope is always the
   whole tree regardless of which files were edited, so a failure anywhere is in
   scope, not just in files this change touched.

2. **`bun run lint`** — `biome check .`, must be 0 errors, whole repo. If
   anything is fixable, `bun run lint:fix` (`biome check . --write --unsafe`)
   before re-checking. Note: `.claude/settings.json` already runs
   `bun run fix --skip=correctness/noUnusedImports` as a PostToolUse hook on
   every Write/Edit, so most formatting drift is caught immediately — this step
   is the final confirmation, not the first line of defense.

3. **If `agent/`, `installer/`, or `cli/` were touched** (check with
   `git status`/`git diff`): each is a standalone Bun/TypeScript sub-project
   with its own `tsconfig.json`, not covered by the root `bun run check`. Run
   its own typecheck:
   - `agent/` touched → `bunx tsc --noEmit -p agent/tsconfig.json`
   - `installer/` touched → `bunx tsc --noEmit -p installer/tsconfig.json`
   - `cli/` touched → `bunx tsc --noEmit -p cli/tsconfig.json`

   (Or use the root `check:agent`/`check:installer`/`check:cli` scripts if
   present in `package.json` — check first, they wrap the same command.)

4. **If `agent/`, `installer/`, or `cli/` tests were touched, or their source
   changed in a way that could affect behavior**: run the matching
   `bun test:agent` / `bun test:cli` / `bun test:installer`.

5. **IDE diagnostics are not ground truth in this repo.** If an inline IDE error
   looks suspicious or doesn't match what `bun run check` reports, trust
   `bunx biome check <file>` and `bun run check` over the IDE — this repo has a
   documented history of stale/phantom inline diagnostics.

## Reporting

State plainly which commands were run and their actual output — don't say "looks
clean" without having run them in this turn. If something fails, quote the real
error with file:line, don't paraphrase it away. A change is not done until every
applicable step above is clean.
