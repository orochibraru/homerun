import { fail, redirect } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { resolve } from "$app/paths";
import { Logger } from "$lib/logger";
import { db } from "$lib/server/db/lib";
import { service } from "$lib/server/db/schema";
import { ownedService } from "$lib/server/services";
import { parseEnvVars } from "$lib/server/validation/service";

const logger = new Logger("Services");

export const actions = {
  update: async ({ request, params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ownedService(params.serviceId, locals.user.id);
    if (!svc) {
      return fail(404, { error: "Service not found." });
    }

    const formData = await request.formData();
    await db
      .update(service)
      .set({ envVars: parseEnvVars(formData) })
      .where(eq(service.id, svc.id));

    logger.info(`Env vars updated: service=${svc.id} user=${locals.user.id}`);
    return { success: true };
  },
};
