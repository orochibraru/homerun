import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config, isSmtpEnabled } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import {
	applyAndRebuild,
	checkbox,
	nullableText,
} from "$lib/server/validation/instance-settings-form";
import { EmailService } from "$lib/services/email.service";

const logger = new Logger("InstanceSettings");

export const actions = {
	sendTest: async ({ locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		if (!isSmtpEnabled()) {
			return fail(400, {
				error:
					"SMTP isn't configured yet : fill in the fields, save, then send a test.",
			});
		}
		const to = locals.user.email;
		try {
			await new EmailService({
				content: `This is a test message from Homerun (${config.baseDomain}). Getting it means the saved SMTP settings work.`,
				subject: "Homerun SMTP test",
				to,
			}).send();
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			logger.error(`SMTP test email failed: user=${locals.user.id} ${detail}`);
			return fail(400, { error: detail });
		}
		logger.info(`SMTP test email sent: user=${locals.user.id}`);
		return { success: true, testSentTo: to };
	},

	updateSmtp: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		if (!locals.isAdmin) {
			throw redirect(302, resolve("/"));
		}
		const formData = await request.formData();
		const portRaw = (formData.get("smtpPort") as string | null)?.trim();
		const settings = await InstanceSettingsDTO.get();
		await settings.updateSmtp({
			smtpEnabled: checkbox(formData, "smtpEnabled"),
			smtpFrom: nullableText(formData, "smtpFrom"),
			smtpHost: nullableText(formData, "smtpHost"),
			smtpPassword:
				(formData.get("smtpPassword") as string | null)?.trim() || undefined,
			smtpPort: portRaw ? Number.parseInt(portRaw, 10) : null,
			smtpSecure: checkbox(formData, "smtpSecure"),
			smtpUser: nullableText(formData, "smtpUser"),
		});
		applyAndRebuild(settings);
		logger.info(`SMTP instance settings updated: user=${locals.user.id}`);
		return { savedSection: "smtp", success: true };
	},
};
