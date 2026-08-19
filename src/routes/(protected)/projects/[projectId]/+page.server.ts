import { fail, redirect } from "@sveltejs/kit";
import { desc, eq } from "drizzle-orm";
import { resolve } from "$app/paths";
import { Logger } from "$lib/logger";
import { db } from "$lib/server/db/lib";
import { project, service } from "$lib/server/db/schema";
import { deleteProjectCascade } from "$lib/server/projects";

const logger = new Logger("Projects");

export const load = async ({ params }) => {
  const services = await db
    .select()
    .from(service)
    .where(eq(service.projectId, params.projectId))
    .orderBy(desc(service.createdAt));

  return { services };
};

export const actions = {
  delete: async ({ params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    await deleteProjectCascade(params.projectId, locals.user.id);
    logger.info(
      `Project deleted: project=${params.projectId} user=${locals.user.id}`
    );
    redirect(303, resolve("/projects"));
  },
  rename: async ({ request, params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const formData = await request.formData();
    const name = (formData.get("name") as string | null)?.trim() ?? "";
    const description =
      (formData.get("description") as string | null)?.trim() || null;

    if (!name) {
      return fail(400, { error: "Name is required." });
    }

    await db
      .update(project)
      .set({ description, name })
      .where(eq(project.id, params.projectId));

    logger.info(
      `Project renamed: project=${params.projectId} user=${locals.user.id}`
    );
    return { success: true };
  },
};
