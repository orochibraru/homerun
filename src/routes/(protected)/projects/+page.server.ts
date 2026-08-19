import { desc, eq, sql } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { project, service } from "$lib/server/db/schema";

export const load = async ({ parent }) => {
  const { user } = await parent();

  const projects = await db
    .select({
      createdAt: project.createdAt,
      description: project.description,
      id: project.id,
      name: project.name,
      serviceCount: sql<number>`count(${service.id})`,
    })
    .from(project)
    .leftJoin(service, eq(service.projectId, project.id))
    .where(eq(project.userId, user.id))
    .groupBy(project.id)
    .orderBy(desc(project.createdAt));

  return { projects };
};
