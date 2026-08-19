import { fail, redirect } from "@sveltejs/kit";
import { and, eq, ne } from "drizzle-orm";
import { resolve } from "$app/paths";
import { db } from "$lib/server/db/lib";
import { service } from "$lib/server/db/schema";
import { encryptSecret } from "$lib/server/docker/secrets";
import { removeContainer } from "$lib/server/docker/service";
import { ownedService } from "$lib/server/services";
import { updateServiceSchema } from "$lib/server/validation/service";
import type { Actions } from "./$types";

export const actions: Actions = {
	update: async ({ request, params, locals }) => {
		if (!locals.user) redirect(302, resolve("/auth/sign-in"));
		const svc = await ownedService(params.serviceId, locals.user.id);
		if (!svc) return fail(404, { error: "Service not found." });

		const formData = await request.formData();
		const result = updateServiceSchema.safeParse(Object.fromEntries(formData));
		if (!result.success) {
			return fail(400, {
				values: Object.fromEntries(formData),
				errors: result.error.flatten().fieldErrors,
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
					values: Object.fromEntries(formData),
					errors: { slug: ["That slug is already in use."] },
				});
			}
		}

		await db
			.update(service)
			.set({
				name: input.name,
				slug: input.slug,
				image: input.image,
				tag: input.tag,
				registryUrl: input.registryUrl || null,
				registryUsername: input.registryUsername || null,
				// Blank password field means "leave unchanged" — never
				// overwrite a stored credential with nothing just because
				// the user didn't retype it.
				...(input.registryPassword
					? { registryPasswordEnc: encryptSecret(input.registryPassword) }
					: {}),
				containerPort: input.containerPort,
				restartPolicy: input.restartPolicy,
				cpuLimit: input.cpuLimit || null,
				memoryLimitMb: input.memoryLimitMb ?? null,
			})
			.where(eq(service.id, svc.id));

		return { success: true };
	},

	delete: async ({ params, locals }) => {
		if (!locals.user) redirect(302, resolve("/auth/sign-in"));
		const svc = await ownedService(params.serviceId, locals.user.id);
		if (!svc) return fail(404, { error: "Service not found." });

		if (svc.containerId) {
			try {
				await removeContainer(svc.containerId, { force: true });
			} catch {
				// Container may already be gone — proceed with deleting the record.
			}
		}
		await db.delete(service).where(eq(service.id, svc.id));
		redirect(303, resolve("/services"));
	},
};
