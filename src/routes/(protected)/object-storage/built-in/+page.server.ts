import { fail, redirect } from "@sveltejs/kit";
import { config } from "#lib/config.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { ObjectStorageService } from "#lib/services/object-storage.service.js";
import { resolve } from "$app/paths";

export const load = async () => ({
	status: await ObjectStorageService.builtinStatus(),
	suggestedHost: config.baseDomain ? `s3.${config.baseDomain}` : "",
});

export const actions = {
	setEnabled: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const enabled = (await request.formData()).get("enabled") === "on";
		const job = await enqueueCoreServiceJob(
			enabled
				? { action: "enableBuiltinStore", userId: locals.user.id }
				: { action: "disableBuiltinStore" },
			locals.user.id,
		);
		return { jobId: job.id, success: true };
	},

	setPublicHost: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const host = String((await request.formData()).get("publicHost") ?? "");
		const problem = await ObjectStorageService.builtinPublicHostProblem(host);
		if (problem) {
			return fail(400, { error: problem });
		}
		const job = await enqueueCoreServiceJob(
			{ action: "publishBuiltinStore", host },
			locals.user.id,
		);
		return { jobId: job.id, success: true };
	},
};
