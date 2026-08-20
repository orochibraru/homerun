import { count, desc, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import type { User } from "$lib/server/db/schema";
import { user as userTable } from "$lib/server/db/schema";

/**
 * Small read helpers for the `user` table, used by the admin Users page.
 * Raw queries rather than a DTO — there's no DTO for better-auth-owned
 * tables, same precedent hooks.server.ts and auth.ts already use.
 */
export async function listUsers(): Promise<User[]> {
  return await db.select().from(userTable).orderBy(desc(userTable.createdAt));
}

export async function countAdmins(): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(userTable)
    .where(eq(userTable.role, "admin"));
  return row?.total ?? 0;
}
