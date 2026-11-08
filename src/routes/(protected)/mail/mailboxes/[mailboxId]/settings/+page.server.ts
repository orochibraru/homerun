import { resolve } from "$app/paths";
import { fail, redirect } from "@sveltejs/kit";

import { MailMailboxDTO } from "#lib/dto/mail-mailbox-dto.js";
import { parseMailboxFields } from "#lib/server/mail-form.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";

export const actions = {
	delete: async ({ params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const mailbox = await MailMailboxDTO.get(params.mailboxId);
		if (!mailbox) {
			return fail(404, { error: "Mailbox not found." });
		}
		await mailbox.delete();
		await enqueueCoreServiceJob(
			{
				action: "syncMail",
				purge: [`${mailbox.domain}/${mailbox.toJSON().localPart}`],
			},
			locals.user.id,
		);
		redirect(303, resolve("mail/mailboxes"));
	},

	password: async ({ params, request, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const mailbox = await MailMailboxDTO.get(params.mailboxId);
		if (!mailbox) {
			return fail(404, { error: "Mailbox not found." });
		}
		const password = String((await request.formData()).get("password") ?? "");
		try {
			await MailService.setMailboxPassword(mailbox, password);
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

	update: async ({ params, request, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const mailbox = await MailMailboxDTO.get(params.mailboxId);
		if (!mailbox) {
			return fail(404, { action: "update", error: "Mailbox not found." });
		}
		const parsed = parseMailboxFields(await request.formData());
		if ("error" in parsed) {
			return fail(400, { action: "update", error: parsed.error });
		}
		await mailbox.update(parsed.fields);
		const job = await enqueueCoreServiceJob(
			{ action: "syncMail", purge: [] },
			locals.user.id,
		);
		return { jobId: job.id, success: true };
	},
};
