import { fail, redirect } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { db } from "$lib/server/db/lib";
import { service } from "$lib/server/db/schema";
import { encryptSecret } from "$lib/server/docker/secrets";
import {
  createServiceSchema,
  parseEnvVars,
} from "$lib/server/validation/service";

export const load = async () => ({ baseDomain: config.baseDomain });

export const actions = {
  create: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(302, resolve("/auth/sign-in"));
    }

    const formData = await request.formData();
    const result = createServiceSchema.safeParse(Object.fromEntries(formData));

    if (!result.success) {
      return fail(400, {
        errors: result.error.flatten().fieldErrors,
        values: Object.fromEntries(formData),
      });
    }

    const input = result.data;

    const [slugTaken] = await db
      .select({ id: service.id })
      .from(service)
      .where(eq(service.slug, input.slug))
      .limit(1);

    if (slugTaken) {
      return fail(400, {
        errors: { slug: ["That slug is already in use."] },
        values: Object.fromEntries(formData),
      });
    }

    const now = new Date();
    const id = crypto.randomUUID();

    await db.insert(service).values({
      containerPort: input.containerPort,
      cpuLimit: input.cpuLimit || null,
      createdAt: now,
      currentStatus: "pending",
      desiredState: "stopped",
      envVars: parseEnvVars(formData),
      id,
      image: input.image,
      memoryLimitMb: input.memoryLimitMb ?? null,
      name: input.name,
      registryPasswordEnc: input.registryPassword
        ? encryptSecret(input.registryPassword)
        : null,
      registryUrl: input.registryUrl || null,
      registryUsername: input.registryUsername || null,
      restartPolicy: input.restartPolicy,
      slug: input.slug,
      tag: input.tag,
      updatedAt: now,
      userId: locals.user.id,
    });

    redirect(303, resolve("/services"));
  },
};
