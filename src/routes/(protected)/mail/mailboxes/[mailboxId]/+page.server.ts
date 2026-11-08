import { fail } from "@sveltejs/kit";

import { MailMailboxDTO } from "#lib/dto/mail-mailbox-dto.js";
import { isMailAddress } from "#lib/mail.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { MailService } from "#lib/services/mail.service.js";
import { MailInboxService } from "#lib/services/mail/inbox.js";

export const load = async ({ params, parent }) => {
	await parent();
	const mailbox = await MailMailboxDTO.get(params.mailboxId);
	return {
		contents: mailbox ? await MailInboxService.contents(mailbox) : null,
		hostname: await MailService.hostname(),
	};
};

export const actions = {
	emptyFolder: async ({ params, request, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const mailbox = await MailMailboxDTO.get(params.mailboxId);
		if (!mailbox) {
			return fail(404, { error: "Mailbox not found." });
		}
		const folder = String((await request.formData()).get("folder") ?? "");
		try {
			await MailInboxService.emptyFolder(mailbox, folder);
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
		return { folder, success: true };
	},

	sendTest: async ({ params, request, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const mailbox = await MailMailboxDTO.get(params.mailboxId);
		if (!mailbox) {
			return fail(404, { error: "Mailbox not found." });
		}
		const recipient = String((await request.formData()).get("recipient") ?? "")
			.trim()
			.toLowerCase();
		if (!isMailAddress(recipient)) {
			return fail(400, { error: "That isn't an email address." });
		}
		try {
			await MailInboxService.sendTest(mailbox, recipient);
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
		return { recipient, success: true };
	},
};
