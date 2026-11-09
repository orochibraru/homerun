import { fail } from "@sveltejs/kit";

import { MailMailboxDTO } from "#lib/dto/mail-mailbox-dto.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";

export const load = async ({ parent }) => {
	const { user } = await parent();
	const [mailboxes, hostname] = await Promise.all([
		MailMailboxDTO.listForOwner(user.id),
		MailService.hostname(),
	]);
	return {
		hostname,
		mailboxes: mailboxes.map((mailbox) => mailbox.summary()),
	};
};

export const actions = {
	password: async ({ request, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const form = await request.formData();
		const mailbox = await MailMailboxDTO.getOwned(
			String(form.get("mailboxId") ?? ""),
			locals.user.id,
		);
		if (!mailbox) {
			return fail(404, { error: "That mailbox isn't yours." });
		}
		try {
			await MailService.setMailboxPassword(
				mailbox,
				String(form.get("password") ?? ""),
			);
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
};
