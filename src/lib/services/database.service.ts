import { closeDb, db, getDb, resetDb } from "$lib/server/db/lib";

/**
 * Thin named wrapper around $lib/server/db/lib.ts's HMR-safe Drizzle
 * singleton. `db/**` (the singleton itself, schema.ts, seed.ts) stays put —
 * this class is just the stable "DatabaseService" entry point the rest of
 * the services layer is named consistently with; DTOs may keep importing
 * `db` directly from `$lib/server/db/lib` or use `DatabaseService.db`,
 * either resolves to the same singleton.
 */
export class DatabaseService {
	static db = db;
	static getDb = getDb;
	static closeDb = closeDb;
	static resetDb = resetDb;
}
