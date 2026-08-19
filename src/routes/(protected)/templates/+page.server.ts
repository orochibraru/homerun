import { eq, isNull, or } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { template } from "$lib/server/db/schema";

export const load = async ({ parent }) => {
  const { user } = await parent();

  const templates = await db
    .select()
    .from(template)
    .where(or(isNull(template.ownerId), eq(template.ownerId, user.id)));

  return {
    builtins: templates.filter((t) => t.ownerId === null),
    mine: templates.filter((t) => t.ownerId === user.id),
  };
};
