import { MailService } from "#lib/services/mail.service.js";

export const load = async ({ parent }) => {
	await parent();
	return { mailStatus: await MailService.status() };
};
