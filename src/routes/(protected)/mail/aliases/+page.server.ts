import { fail } from "@sveltejs/kit";

import { MailAliasDTO } from "#lib/dto/mail-alias-dto.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";

export const load = async () => ({
	aliases: (await MailAliasDTO.list()).map((alias) => alias.summary()),
});

export const actions = {
	toggle: async ({ request, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const id = String((await request.formData()).get("aliasId") ?? "");
		const alias = await MailAliasDTO.get(id);
		if (!alias) {
			return fail(404, { error: "Alias not found." });
		}
		const { destinations, enabled } = alias.toJSON();
		await alias.update({ destinations, enabled: !enabled });
		const job = await enqueueCoreServiceJob(
			{ action: "syncMail", purge: [] },
			locals.user.id,
		);
		return { enabled: !enabled, jobId: job.id, success: true };
	},
};
