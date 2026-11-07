import { fail } from "@sveltejs/kit";

import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";

export const actions = {
	setEnabled: async ({ request, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const enabled = (await request.formData()).get("enabled") === "on";
		await MailService.setEnabled(enabled);
		const job = await enqueueCoreServiceJob(
			{ action: "syncMail", purge: [] },
			locals.user.id,
		);
		return { jobId: job.id, success: true };
	},

	setHostname: async ({ request, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const host = String((await request.formData()).get("hostname") ?? "");
		const problem = MailService.hostnameProblem(host);
		if (problem) {
			return fail(400, { error: problem });
		}
		await MailService.setHostname(host);
		const job = await enqueueCoreServiceJob(
			{ action: "syncMail", purge: [] },
			locals.user.id,
		);
		return { jobId: job.id, success: true };
	},
};
