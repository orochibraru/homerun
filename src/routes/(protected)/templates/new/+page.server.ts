import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { Logger } from "$lib/logger";
import { db } from "$lib/server/db/lib";
import { template } from "$lib/server/db/schema";
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
    const now = new Date();

    await db.insert(template).values({
      category: input.category || null,
      containerPort: input.containerPort,
      cpuLimit: input.cpuLimit || null,
      createdAt: now,
      description: input.description || null,
      envVars: parseEnvVars(formData),
      icon: input.icon || null,
      id: crypto.randomUUID(),
      image: input.image,
      memoryLimitMb: input.memoryLimitMb ?? null,
      name: input.name,
      ownerId: locals.user.id,
      restartPolicy: input.restartPolicy,
      tag: input.tag,
      updatedAt: now,
    });

    logger.info(`Template created: name=${input.name} user=${locals.user.id}`);
    redirect(303, resolve("/templates"));
  },
};
