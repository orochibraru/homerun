import { fail, redirect } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { resolve } from "$app/paths";
import { db } from "$lib/server/db/lib";
import { service } from "$lib/server/db/schema";
import { ownedService } from "$lib/server/services";
import { parseEnvVars } from "$lib/server/validation/service";
import type { Actions } from "./$types";

export const actions: Actions = {
	update: async ({ request, params, locals }) => {
		if (!locals.user) redirect(302, resolve("/auth/sign-in"));
		const svc = await ownedService(params.serviceId, locals.user.id);
		if (!svc) return fail(404, { error: "Service not found." });

		const formData = await request.formData();
		await db
			.update(service)
			.set({ envVars: parseEnvVars(formData) })
			.where(eq(service.id, svc.id));

		return { success: true };
	},
};
