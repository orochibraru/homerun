import { fail } from "@sveltejs/kit";

import { MailMailboxDTO } from "#lib/dto/mail-mailbox-dto.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";

export const load = async () => {
	const [mailboxes, usage] = await Promise.all([
		MailMailboxDTO.list(),
		MailService.usage(),
	]);
	return {
		mailboxes: mailboxes.map((box) => ({
			...box.summary(),
			usage: usage[box.address] ?? null,
		})),
	};
};

export const actions = {
	toggle: async ({ request, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const id = String((await request.formData()).get("mailboxId") ?? "");
		const mailbox = await MailMailboxDTO.get(id);
		if (!mailbox) {
			return fail(404, { error: "Mailbox not found." });
		}
		const { displayName, enabled, quotaMb } = mailbox.toJSON();
		await mailbox.update({ displayName, enabled: !enabled, quotaMb });
		const job = await enqueueCoreServiceJob(
			{ action: "syncMail", purge: [] },
			locals.user.id,
		);
		return { enabled: !enabled, jobId: job.id, success: true };
	},
};
