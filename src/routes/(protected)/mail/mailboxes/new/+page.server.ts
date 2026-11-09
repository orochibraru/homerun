import { resolve } from "$app/paths";
import { fail, redirect } from "@sveltejs/kit";

import { MailDomainDTO } from "#lib/dto/mail-domain-dto.js";
import { isMailboxKind } from "#lib/mail.js";
import { parseMailboxFields } from "#lib/server/mail-form.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";
import { MailOwnerService } from "#lib/services/mail/owners.js";

export const load = async () => ({
	domains: (await MailDomainDTO.list()).map((domain) => ({
		id: domain.id,
		name: domain.name,
	})),
	owners: await MailOwnerService.choices(),
});

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const form = await request.formData();
		const parsed = parseMailboxFields(form);
		if ("error" in parsed) {
			return fail(400, { error: parsed.error });
		}
		const kind = form.get("kind");
		if (!isMailboxKind(kind)) {
			return fail(400, { error: "Pick a mailbox or a noreply address." });
		}
		try {
			await MailService.createMailbox({
				...parsed.fields,
				domainId: String(form.get("domainId") ?? ""),
				kind,
				localPart: String(form.get("localPart") ?? ""),
				password: String(form.get("password") ?? ""),
			});
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
		await enqueueCoreServiceJob(
			{ action: "syncMail", purge: [] },
			locals.user.id,
		);
		redirect(303, resolve("mail/mailboxes"));
	},
};
