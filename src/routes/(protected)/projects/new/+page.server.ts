import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ProjectDTO } from "$lib/dto/project-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("Projects");

export const actions = {
  create: async ({ request, locals }) => {
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

    const proj = await ProjectDTO.create({
      description,
      name,
      userId: locals.user.id,
    });

    logger.info(`Project created: project=${proj.id} user=${locals.user.id}`);
    redirect(303, resolve("/projects"));
  },
};
