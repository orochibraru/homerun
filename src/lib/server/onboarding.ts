import { db } from "$lib/server/db/lib";
import { user as userTable } from "$lib/server/db/schema";

/**
 * Whether any account exists at all yet. Drives two things: the very first
 * account created (via public sign-up) becomes the instance's admin (see
 * auth.ts's databaseHooks), and public sign-up itself locks once this is
 * true (see hooks.server.ts) — every account after the first is created by
 * an admin, from the Users page.
 *
 * Raw query against `user` rather than a DTO — there's no DTO for
 * better-auth-owned tables, same precedent hooks.server.ts already uses for
 * the API-key lookup below.
 */
export async function hasAnyUser(): Promise<boolean> {
  const [row] = await db.select({ id: userTable.id }).from(userTable).limit(1);
  return !!row;
}
