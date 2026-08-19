import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ProjectDTO } from "$lib/dto/project-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("Projects");

export const load = async ({ params, parent }) => {
  const { user } = await parent();
  const services = await ServiceDTO.listByProject(params.projectId, user.id);

  return { services: services.map((s) => s.toJSON()) };
};

export const actions = {
  delete: async ({ params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const proj = await ProjectDTO.get(params.projectId, locals.user.id);
    if (!proj) {
      return fail(404, { error: "Project not found." });
    }
    await proj.cascadeDelete();
    logger.info(
      `Project deleted: project=${params.projectId} user=${locals.user.id}`
    );
    redirect(303, resolve("/projects"));
  },
  rename: async ({ request, params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const proj = await ProjectDTO.get(params.projectId, locals.user.id);
    if (!proj) {
      return fail(404, { error: "Project not found." });
    }
    const formData = await request.formData();
    const name = (formData.get("name") as string | null)?.trim() ?? "";
    const description =
      (formData.get("description") as string | null)?.trim() || null;

    if (!name) {
      return fail(400, { error: "Name is required." });
    }

    await proj.update({ description, name });

    logger.info(
      `Project renamed: project=${params.projectId} user=${locals.user.id}`
    );
    return { success: true };
  },
};
