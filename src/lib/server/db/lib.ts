import { Database } from "bun:sqlite";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { config } from "$lib/config";

/**
 * Database singleton that survives Vite HMR.
 * Without this, every hot reload creates a new connection pool,
 * eventually hitting "too many clients" in PostgreSQL.
 */
const globalForDb = globalThis as unknown as {
  __db_client?: Database;
  __db_instance?: BunSQLiteDatabase<Record<string, never>>;
};

function createClient(): Database {
  if (globalForDb.__db_client) {
    return globalForDb.__db_client;
  }

  const client = new Database(config.dbPath);

  globalForDb.__db_client = client;
  return client;
}

function createDb(): BunSQLiteDatabase<Record<string, never>> {
  if (globalForDb.__db_instance) {
    return globalForDb.__db_instance;
  }

  const instance = drizzle({ client: createClient() });
  globalForDb.__db_instance = instance;
  return instance;
}

export const db = createDb();

// For backward compatibility and proper singleton access
export function getDb() {
  // If instance was reset, recreate it
  if (!globalForDb.__db_instance) {
    return createDb();
  }
  return globalForDb.__db_instance;
}

/**
 * Close the database connection pool.
 * Call this during graceful shutdown.
 */
export async function closeDb(): Promise<void> {
  if (globalForDb.__db_client) {
    await globalForDb.__db_client.close();
    globalForDb.__db_client = undefined;
    globalForDb.__db_instance = undefined;
  }
}

/**
 * Reset the database connection.
 * Useful when the connection is in a bad state and needs to be recreated.
 */
export async function resetDb(): Promise<void> {
  await closeDb();
  // Force recreation on next getDb() call by clearing the singleton
  globalForDb.__db_instance = undefined;
  globalForDb.__db_client = undefined;
}
