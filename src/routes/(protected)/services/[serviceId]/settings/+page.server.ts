import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ProjectDTO } from "$lib/dto/project-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { TemplateDTO } from "$lib/dto/template-dto";
import { Logger } from "$lib/logger";
import { encryptSecret } from "$lib/server/docker/secrets";
import { removeContainer } from "$lib/server/docker/service";
import { updateServiceSchema } from "$lib/server/validation/service";

const logger = new Logger("Services");

export const load = async ({ parent }) => {
  const { user } = await parent();
  const projects = await ProjectDTO.list(user.id);

  return { projects: projects.map((p) => p.toJSON()) };
};

export const actions = {
  delete: async ({ params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }

    if (svc.containerId) {
      try {
        await removeContainer(svc.containerId, { force: true });
      } catch {
        // Container may already be gone proceed with deleting the record.
      }
    }
    await svc.delete();
    logger.info(`Service deleted: service=${svc.id} user=${locals.user.id}`);
    throw redirect(303, resolve("/services"));
  },
  moveProject: async ({ request, params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }

    const formData = await request.formData();
    const rawProjectId = formData.get("projectId") as string | null;

    // Empty selection means "ungrouped" — otherwise confirm the target
    // project is actually the user's own, never trust the form value alone.
    let projectId: string | null = null;
    if (rawProjectId) {
      const proj = await ProjectDTO.get(rawProjectId, locals.user.id);
      if (!proj) {
        return fail(400, { error: "That project wasn't found." });
      }
      projectId = proj.id;
    }

    await svc.update({ projectId });
    logger.info(
      `Service moved: service=${svc.id} project=${projectId ?? "none"} user=${locals.user.id}`
    );
    return { moved: true };
  },
  saveAsTemplate: async ({ params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }

    await TemplateDTO.create({
      containerPort: svc.containerPort,
      cpuLimit: svc.cpuLimit,
      description: `Saved from ${svc.name}`,
      envVars: svc.envVars,
      image: svc.image,
      memoryLimitMb: svc.memoryLimitMb,
      name: svc.name,
      ownerId: locals.user.id,
      restartPolicy: svc.restartPolicy,
      tag: svc.tag,
    });

    logger.info(
      `Template saved from service: service=${svc.id} user=${locals.user.id}`
    );
    return { templateSaved: true };
  },
  update: async ({ request, params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }

    const formData = await request.formData();
    const result = updateServiceSchema.safeParse(Object.fromEntries(formData));
    if (!result.success) {
      return fail(400, {
        errors: result.error.flatten().fieldErrors,
        values: Object.fromEntries(formData),
      });
    }
    const input = result.data;

    if (
      input.slug !== svc.slug &&
      (await ServiceDTO.slugTaken(input.slug, svc.id))
    ) {
      return fail(400, {
        errors: { slug: ["That slug is already in use."] },
        values: Object.fromEntries(formData),
      });
    }

    await svc.update({
      image: input.image,
      name: input.name,
      registryUrl: input.registryUrl || null,
      registryUsername: input.registryUsername || null,
      slug: input.slug,
      tag: input.tag,
      // Blank password field means "leave unchanged" — never
      // overwrite a stored credential with nothing just because
      // the user didn't retype it.
      ...(input.registryPassword
        ? { registryPasswordEnc: encryptSecret(input.registryPassword) }
        : {}),
      containerPort: input.containerPort,
      cpuLimit: input.cpuLimit || null,
      memoryLimitMb: input.memoryLimitMb ?? null,
      restartPolicy: input.restartPolicy,
    });

    logger.info(
      `Service settings updated: service=${svc.id} user=${locals.user.id}`
    );
    return { success: true };
  },
};
