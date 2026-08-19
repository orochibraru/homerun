import { and, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type Template, template } from "$lib/server/db/schema";

/**
 * Loads a template the user is allowed to use: either their own, or a
 * built-in (ownerId null). Returns null otherwise — never trust a route
 * param alone.
 */
export async function usableTemplate(
  templateId: string,
  userId: string
): Promise<Template | null> {
  const [row] = await db
    .select()
    .from(template)
    .where(eq(template.id, templateId))
    .limit(1);
  if (!row) {
    return null;
  }
  if (row.ownerId !== null && row.ownerId !== userId) {
    return null;
  }
  return row;
}

/** Loads a template the user owns (never a built-in). For edit/delete. */
export async function ownedTemplate(
  templateId: string,
  userId: string
): Promise<Template | null> {
  const [row] = await db
    .select()
    .from(template)
    .where(and(eq(template.id, templateId), eq(template.ownerId, userId)))
    .limit(1);
  return row ?? null;
}
