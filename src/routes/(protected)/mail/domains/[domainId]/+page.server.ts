import { resolve } from "$app/paths";
import { error, fail, redirect } from "@sveltejs/kit";

import { MailDomainDTO } from "#lib/dto/mail-domain-dto.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";

export const load = async ({ params }) => {
	const domain = await MailDomainDTO.get(params.domainId);
	if (!domain) {
		error(404, "Mail domain not found.");
	}
	const [checks, dnsDomain] = await Promise.all([
		MailService.checkRecords(domain),
		MailService.dnsDomain(domain),
	]);
	return {
		checks,
		domain: domain.summary(),
		managedBy: dnsDomain?.toJSON().name ?? null,
	};
};

export const actions = {
	delete: async ({ params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const domain = await MailDomainDTO.get(params.domainId);
		if (!domain) {
			return fail(404, { error: "Mail domain not found." });
		}
		await domain.delete();
		await enqueueCoreServiceJob(
			{ action: "syncMail", purge: [domain.name] },
			locals.user.id,
		);
		redirect(303, resolve("mail"));
	},

	publish: async ({ params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const domain = await MailDomainDTO.get(params.domainId);
		if (!domain) {
			return fail(404, { error: "Mail domain not found." });
		}
		try {
			const lines = await MailService.publishRecords(domain);
			return { lines, success: true };
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	},
};
