import { MailMailboxDTO } from "#lib/dto/mail-mailbox-dto.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { mailMailboxUpdateApiBody } from "#lib/server/validation/mail-api.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const mailbox = await MailMailboxDTO.get(params.mailboxId);
	return mailbox
		? Response.json(mailbox.summary())
		: apiError("Not found", 404);
};

export const PATCH = async ({ locals, params, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const mailbox = await MailMailboxDTO.get(params.mailboxId);
	if (!mailbox) {
		return apiError("Not found", 404);
	}
	const body = await readApiBody(request, mailMailboxUpdateApiBody);
	if ("response" in body) {
		return body.response;
	}
	const current = mailbox.toJSON();
	const { password, ...fields } = body.data;
	try {
		if (password) {
			await MailService.setMailboxPassword(mailbox, password);
		}
		await MailService.updateMailbox(mailbox, {
			displayName:
				fields.displayName === undefined
					? current.displayName
					: fields.displayName || null,
			enabled: fields.enabled ?? current.enabled,
			ownerId:
				fields.ownerId === undefined ? current.ownerId : fields.ownerId || null,
			quotaMb: fields.quotaMb === undefined ? current.quotaMb : fields.quotaMb,
		});
	} catch (err) {
		return apiError(err instanceof Error ? err.message : String(err));
	}
	await enqueueCoreServiceJob({ action: "syncMail", purge: [] }, caller.userId);
	return Response.json(mailbox.summary());
};

export const DELETE = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const mailbox = await MailMailboxDTO.get(params.mailboxId);
	if (!mailbox) {
		return apiError("Not found", 404);
	}
	await mailbox.delete();
	await enqueueCoreServiceJob(
		{
			action: "syncMail",
			purge: [`${mailbox.domain}/${mailbox.toJSON().localPart}`],
		},
		caller.userId,
	);
	return new Response(null, { status: 204 });
};
