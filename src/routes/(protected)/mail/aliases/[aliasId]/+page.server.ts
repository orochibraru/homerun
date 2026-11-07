import { resolve } from "$app/paths";
import { error, fail, redirect } from "@sveltejs/kit";

import { MailAliasDTO } from "#lib/dto/mail-alias-dto.js";
import { parseDestinations } from "#lib/mail.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";

export const load = async ({ params }) => {
	const alias = await MailAliasDTO.get(params.aliasId);
	if (!alias) {
		error(404, "Alias not found.");
	}
	return { alias: alias.summary() };
};

export const actions = {
	delete: async ({ params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const alias = await MailAliasDTO.get(params.aliasId);
		if (!alias) {
			return fail(404, { error: "Alias not found." });
		}
		await alias.delete();
		await enqueueCoreServiceJob(
			{ action: "syncMail", purge: [] },
			locals.user.id,
		);
		redirect(303, resolve("mail/aliases"));
	},

	update: async ({ params, request, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const alias = await MailAliasDTO.get(params.aliasId);
		if (!alias) {
			return fail(404, { error: "Alias not found." });
		}
		const form = await request.formData();
		const destinations = parseDestinations(
			String(form.get("destinations") ?? ""),
		);
		const problem = MailService.destinationsProblem(destinations);
		if (problem) {
			return fail(400, { error: problem });
		}
		await alias.update({ destinations, enabled: form.get("enabled") === "on" });
		const job = await enqueueCoreServiceJob(
			{ action: "syncMail", purge: [] },
			locals.user.id,
		);
		return { jobId: job.id, success: true };
	},
};
