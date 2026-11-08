import { error } from "@sveltejs/kit";

import { MailMailboxDTO } from "#lib/dto/mail-mailbox-dto.js";

export const load = async ({ params }) => {
	const mailbox = await MailMailboxDTO.get(params.mailboxId);
	if (!mailbox) {
		error(404, "Mailbox not found.");
	}
	return { mailbox: mailbox.summary() };
};
