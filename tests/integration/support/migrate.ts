import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";

/**
 * Runs the real, checked-in `drizzle/` migrations directly against the
 * fresh test-only Postgres container, explicitly, as its own visible setup
 * step — same `drizzle-orm/bun-sql/migrator` `migrate()` call CLAUDE.md
 * already documents as the precedent for a one-off script applying schema
 * changes directly against a live Postgres connection. Kept independent of
 * the spawned app's own boot-time migration (`hooks.server.ts`'s `init()`
 * runs the identical migration again, idempotently, before the app starts
 * accepting requests) rather than relying on that alone : if the migration
 * itself is broken, this fails fast, before ever spawning the app, instead
 * of surfacing as an opaque "app never became healthy" timeout.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
	const sql = new SQL(databaseUrl);
	try {
		const db = drizzle(sql);
		await migrate(db, { migrationsFolder: "./drizzle" });
	} finally {
		await sql.close();
	}
}
