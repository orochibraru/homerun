import { MailMailboxDTO } from "#lib/dto/mail-mailbox-dto.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { mailMailboxCreateApiBody } from "#lib/server/validation/mail-api.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";

export const GET = async ({ locals }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	return Response.json(
		(await MailMailboxDTO.list()).map((mailbox) => mailbox.summary()),
	);
};

export const POST = async ({ locals, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const body = await readApiBody(request, mailMailboxCreateApiBody);
	if ("response" in body) {
		return body.response;
	}
	try {
		const created = await MailService.createMailbox({
			displayName: body.data.displayName || null,
			domainId: body.data.domainId,
			enabled: body.data.enabled ?? true,
			kind: body.data.kind ?? "mailbox",
			localPart: body.data.localPart,
			ownerId: body.data.ownerId || null,
			password: body.data.password,
			quotaMb: body.data.quotaMb ?? null,
		});
		await enqueueCoreServiceJob(
			{ action: "syncMail", purge: [] },
			caller.userId,
		);
		return Response.json(created.summary(), { status: 201 });
	} catch (err) {
		return apiError(err instanceof Error ? err.message : String(err));
	}
};
