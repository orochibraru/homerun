---
name: migration-workflow
description:
  Workflow for changing src/lib/server/db/schema.ts and getting the change
  applied to a live Postgres database, drizzle-kit generate, the NOT-NULL
  add-column-to-existing-rows gotcha, applying incrementally against a running
  dev DB without restarting, and what Postgres now genuinely enforces (onDelete
  cascade/set null) versus what still needs explicit app-level cleanup. Use
  whenever a table in schema.ts is added, changed, or a column's meaning
  changes.
user-invocable: true
---

# migration-workflow

## 1. Edit `src/lib/server/db/schema.ts`

Add/change the table or column. This repo is Postgres via `drizzle-orm/bun-sql`
(Bun's built-in `SQL` client, no `pg` dependency).

## 2. Generate the migration

```bash
bun run db:generate   # drizzle-kit generate
```

This produces a new incremental migration under `drizzle/`, on top of the `0000`
full-schema baseline (generated at the SQLite→Postgres conversion — one
migration covering every table at that point, not per-feature history).

## 3. Watch for the NOT-NULL-on-existing-rows gotcha

Postgres's `ALTER TABLE ADD COLUMN NOT NULL` requires a `DEFAULT`, or a two-step
add-nullable → backfill → set-not-null. If the generated migration adds a
`NOT NULL` column to a table that already has rows and doesn't supply a default,
fix it by hand before applying: either add a sensible `DEFAULT` in the migration
SQL, or split it into the two-step form and backfill real data. `notNull()` in
`schema.ts` matters for new rows going forward either way (app-enforced), but
existing rows need an actual value at the DB level.

**Changing the _meaning_ of an existing nullable column** (not just adding one):
back-fill by hand too — don't assume an already-populated nullable column is
safe to reinterpret without a data pass over existing rows.

## 4. Apply it

- **Mid-session against a live dev DB, without restarting**: write a one-off
  script using `drizzle-orm/bun-sql/migrator`'s `migrate()` against a live
  Postgres connection, run it directly. Look at how this was done for prior
  mid-session schema changes (check recent git history in `drizzle/` for
  precedent) rather than restarting the dev server.
- **Fresh instance / normal boot**: migrations run automatically, plus
  `seedBuiltinTemplates()` (`src/lib/server/db/seed.ts`, idempotent,
  `.onConflictDoNothing()`), from `hooks.server.ts`'s `init()`.

Requires `docker compose up -d` (bootstraps Postgres, see `compose.yaml`) — the
app has no fallback DB.

## 5. FK behavior — real, not decorative

Postgres enforces this schema's `onDelete: "cascade"`/`"set null"` for real (no
SQLite-style global disable). That only covers row data — it does **not**
stop/remove a live Docker container or network. If your new table has any
relationship to a service/project that has real infrastructure alongside its row
(a container, a network), you still need explicit app-level cleanup code (see
`ProjectDTO.cascadeDelete()` and `UserService.cleanupUserResources()` for the
existing pattern of "DB cascade handles rows, explicit code handles Docker") —
don't assume the FK constraint alone is sufficient.

## 6. Finish

Add/update the DTO for the new/changed table (see the `new-dto-route` skill).
Run the `check-repo` skill.
