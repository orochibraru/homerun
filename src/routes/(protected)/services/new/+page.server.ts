import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { ProjectDTO } from "$lib/dto/project-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { TemplateDTO } from "$lib/dto/template-dto";
import { Logger } from "$lib/logger";
import { encryptSecret } from "$lib/server/docker/secrets";
import {
  createServiceSchema,
  parseEnvVars,
} from "$lib/server/validation/service";

const logger = new Logger("Services");

export const load = async ({ url, parent }) => {
  const { user } = await parent();
  const projectId = url.searchParams.get("projectId");
  const templateId = url.searchParams.get("templateId");

  // Ignore a projectId that isn't actually the user's own project, or a
  // templateId the user isn't allowed to use, rather than erroring — the
  // form just falls back to blank/no-project silently safe.
  const project =
    projectId && (await ProjectDTO.get(projectId, user.id)) ? projectId : null;
  const template = templateId
    ? await TemplateDTO.usable(templateId, user.id)
    : null;

  return {
    baseDomain: config.baseDomain,
    projectId: project,
    template: template?.toJSON() ?? null,
  };
};

export const actions = {
  create: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }

    const formData = await request.formData();
    const rawProjectId = formData.get("projectId") as string | null;
    const projectId =
      rawProjectId && (await ProjectDTO.get(rawProjectId, locals.user.id))
        ? rawProjectId
        : null;

    const result = createServiceSchema.safeParse(Object.fromEntries(formData));

    if (!result.success) {
      return fail(400, {
        errors: result.error.flatten().fieldErrors,
        values: Object.fromEntries(formData),
      });
    }

    const input = result.data;

    if (await ServiceDTO.slugTaken(input.slug)) {
      return fail(400, {
        errors: { slug: ["That slug is already in use."] },
        values: Object.fromEntries(formData),
      });
    }

    const svc = await ServiceDTO.create({
      containerPort: input.containerPort,
      cpuLimit: input.cpuLimit || null,
      envVars: parseEnvVars(formData),
      image: input.image,
      memoryLimitMb: input.memoryLimitMb ?? null,
      name: input.name,
      projectId,
      registryPasswordEnc: input.registryPassword
        ? encryptSecret(input.registryPassword)
        : null,
      registryUrl: input.registryUrl || null,
      registryUsername: input.registryUsername || null,
      restartPolicy: input.restartPolicy,
      slug: input.slug,
      tag: input.tag,
      userId: locals.user.id,
    });

    logger.info(
      `Service created: service=${svc.id} slug=${input.slug} image=${input.image}:${input.tag} user=${locals.user.id}`
    );

    redirect(
      303,
      projectId ? `${resolve("/projects")}/${projectId}` : resolve("/services")
    );
  },
};
