import { resolve } from "$app/paths";
import { fail, redirect } from "@sveltejs/kit";

import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";

export const load = async () => ({
	available: await MailService.availableDomains(),
});

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const dnsDomainId = String(
			(await request.formData()).get("dnsDomainId") ?? "",
		);
		let id: string;
		try {
			id = (await MailService.createDomain(dnsDomainId, locals.user)).id;
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
		await enqueueCoreServiceJob(
			{ action: "syncMail", purge: [] },
			locals.user.id,
		);
		redirect(
			303,
			resolve("/(protected)/mail/domains/[domainId]", { domainId: id }),
		);
	},
};
