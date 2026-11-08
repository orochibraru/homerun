import { resolve } from "$app/paths";
import { fail, redirect } from "@sveltejs/kit";

import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";
import { MailSelfTestService } from "#lib/services/mail/self-test.js";
import { WebmailService } from "#lib/services/mail/webmail.js";

export const load = async () => ({
	webmail: await WebmailService.list(),
});

export const actions = {
	deployWebmail: async ({ locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		let serviceId: string;
		try {
			serviceId = await WebmailService.deploy(locals.user.id);
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
		redirect(303, resolve("/(protected)/services/[serviceId]", { serviceId }));
	},

	selfTest: async ({ locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		return { checks: await MailSelfTestService.run(), success: true };
	},

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
		const webmail = await WebmailService.retarget(
			await MailService.hostname(),
			MailService.hostnameFor(host),
			locals.user.id,
		);
		await MailService.setHostname(host);
		const job = await enqueueCoreServiceJob(
			{ action: "syncMail", purge: [] },
			locals.user.id,
		);
		return { jobId: job.id, success: true, webmail };
	},
};
