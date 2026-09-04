import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { Logger } from "$lib/logger";
import {
	applyAndRebuild,
	checkbox,
	nullableText,
} from "$lib/server/validation/instance-settings-form";

const logger = new Logger("InstanceSettings");

export const actions = {
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
