import { resolve } from "$app/paths";
import { fail, redirect } from "@sveltejs/kit";

import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";
import { MailDataVolumeService } from "#lib/services/mail/data-volume.js";
import { MailRelayService } from "#lib/services/mail/relay.js";
import { MailSelfTestService } from "#lib/services/mail/self-test.js";
import { WebmailService } from "#lib/services/mail/webmail.js";

export const load = async () => {
	const [webmail, relay, dataVolume] = await Promise.all([
		WebmailService.list(),
		MailRelayService.settings(),
		MailDataVolumeService.get(),
	]);
	return {
		dataVolume: dataVolume
			? {
					backupEnabled: dataVolume.toJSON().backupEnabled,
					id: dataVolume.id,
				}
			: null,
		relay,
		webmail,
	};
};

export const actions = {
	addDataVolume: async ({ locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const volume = await MailDataVolumeService.add(locals.user.id);
		redirect(
			303,
			resolve("/(protected)/storage/[volumeId]", { volumeId: volume.id }),
		);
	},

	setRelay: async ({ request, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const form = await request.formData();
		const portRaw = String(form.get("relayPort") ?? "").trim();
		try {
			await MailRelayService.save({
				host: String(form.get("relayHost") ?? ""),
				password: String(form.get("relayPassword") ?? "") || null,
				port: portRaw ? Number(portRaw) : null,
				user: String(form.get("relayUser") ?? ""),
			});
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
		const job = await enqueueCoreServiceJob(
			{ action: "syncMail", purge: [] },
			locals.user.id,
		);
		return { jobId: job.id, success: true };
	},

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

	restart: async ({ locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		try {
			await MailService.restart();
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : "Couldn't restart it.",
			});
		}
		return { success: true };
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
