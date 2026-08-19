import { fail, redirect } from "@sveltejs/kit";
import { and, eq, ne } from "drizzle-orm";
import { resolve } from "$app/paths";
import { db } from "$lib/server/db/lib";
import { service } from "$lib/server/db/schema";
import { encryptSecret } from "$lib/server/docker/secrets";
import { removeContainer } from "$lib/server/docker/service";
import { ownedService } from "$lib/server/services";
import { updateServiceSchema } from "$lib/server/validation/service";

export const actions = {
  delete: async ({ params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ownedService(params.serviceId, locals.user.id);
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
    await db.delete(service).where(eq(service.id, svc.id));
    throw redirect(303, resolve("/services"));
  },
  update: async ({ request, params, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }
    const svc = await ownedService(params.serviceId, locals.user.id);
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

    if (input.slug !== svc.slug) {
      const [slugTaken] = await db
        .select({ id: service.id })
        .from(service)
        .where(and(eq(service.slug, input.slug), ne(service.id, svc.id)))
        .limit(1);
      if (slugTaken) {
        return fail(400, {
          errors: { slug: ["That slug is already in use."] },
          values: Object.fromEntries(formData),
        });
      }
    }

    await db
      .update(service)
      .set({
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
      })
      .where(eq(service.id, svc.id));

    return { success: true };
  },
};
