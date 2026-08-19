import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { TemplateDTO } from "$lib/dto/template-dto";
import { Logger } from "$lib/logger";
import { parseEnvVars } from "$lib/server/validation/service";
import { createTemplateSchema } from "$lib/server/validation/template";

const logger = new Logger("Templates");

export const actions = {
  create: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }

    const formData = await request.formData();
    const result = createTemplateSchema.safeParse(Object.fromEntries(formData));

    if (!result.success) {
      return fail(400, {
        errors: result.error.flatten().fieldErrors,
        values: Object.fromEntries(formData),
      });
    }

    const input = result.data;

    await TemplateDTO.create({
      category: input.category || null,
      containerPort: input.containerPort,
      cpuLimit: input.cpuLimit || null,
      description: input.description || null,
      envVars: parseEnvVars(formData),
      icon: input.icon || null,
      image: input.image,
      memoryLimitMb: input.memoryLimitMb ?? null,
      name: input.name,
      ownerId: locals.user.id,
      restartPolicy: input.restartPolicy,
      tag: input.tag,
    });

    logger.info(`Template created: name=${input.name} user=${locals.user.id}`);
    redirect(303, resolve("/templates"));
  },
};
