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

export const load = async () => {
	return { baseDomain: config.baseDomain };
};

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const result = createServiceSchema.safeParse(Object.fromEntries(formData));

		if (!result.success) {
			return fail(400, {
				values: Object.fromEntries(formData),
				errors: result.error.flatten().fieldErrors,
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
				values: Object.fromEntries(formData),
				errors: { slug: ["That slug is already in use."] },
			});
		}

		const now = new Date();
		const id = crypto.randomUUID();

		await db.insert(service).values({
			id,
			userId: locals.user.id,
			name: input.name,
			slug: input.slug,
			image: input.image,
			tag: input.tag,
			registryUrl: input.registryUrl || null,
			registryUsername: input.registryUsername || null,
			registryPasswordEnc: input.registryPassword
				? encryptSecret(input.registryPassword)
				: null,
			envVars: parseEnvVars(formData),
			containerPort: input.containerPort,
			restartPolicy: input.restartPolicy,
			cpuLimit: input.cpuLimit || null,
			memoryLimitMb: input.memoryLimitMb ?? null,
			desiredState: "stopped",
			currentStatus: "pending",
			createdAt: now,
			updatedAt: now,
		});

		redirect(303, resolve("/services"));
	},
};
