import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { ProjectDTO } from "$lib/dto/project-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { TemplateDTO } from "$lib/dto/template-dto";
import { Logger } from "$lib/logger";
import { encryptSecret } from "$lib/server/docker/secrets";
import {
  type CreateServiceInput,
  createServiceSchema,
  parseEnvVars,
} from "$lib/server/validation/service";

const logger = new Logger("Services");

/** Maps the validated form input's image-vs-git fields to what ServiceDTO.create expects — pulled out to keep the create action's complexity in check. */
function buildSourceFields(input: CreateServiceInput, slug: string) {
  if (input.buildSource !== "git") {
    return {
      gitBuildContext: null,
      gitDockerfilePath: null,
      gitRef: null,
      gitUrl: null,
      image: input.image as string,
      tag: input.tag || "latest",
    };
  }
  return {
    gitBuildContext: input.gitBuildContext || null,
    gitDockerfilePath: input.gitDockerfilePath || null,
    gitRef: input.gitRef || null,
    gitUrl: input.gitUrl || null,
    // No real image/tag until the first build — deployService()
    // overwrites both with the resolved local tag once it's built.
    image: `localrun-build-${slug}`,
    tag: "pending",
  };
}

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
      authRequired: input.authRequired,
      buildSource: input.buildSource,
      containerPort: input.containerPort,
      cpuLimit: input.cpuLimit || null,
      dnsResolvable: input.dnsResolvable,
      envVars: parseEnvVars(formData),
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
      userId: locals.user.id,
      ...buildSourceFields(input, input.slug),
    });

    logger.info(
      `Service created: service=${svc.id} slug=${input.slug} source=${input.buildSource} user=${locals.user.id}`
    );

    redirect(
      303,
      projectId ? `${resolve("/projects")}/${projectId}` : resolve("/services")
    );
  },
};
