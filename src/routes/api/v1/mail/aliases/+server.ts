import { MailAliasDTO } from "#lib/dto/mail-alias-dto.js";
import { parseDestinations } from "#lib/mail.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { mailAliasCreateApiBody } from "#lib/server/validation/mail-api.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";

export const GET = async ({ locals }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	return Response.json(
		(await MailAliasDTO.list()).map((alias) => alias.summary()),
	);
};

export const POST = async ({ locals, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const body = await readApiBody(request, mailAliasCreateApiBody);
	if ("response" in body) {
		return body.response;
	}
	try {
		const created = await MailService.createAlias({
			destinations: parseDestinations(body.data.destinations.join(",")),
			domainId: body.data.domainId,
			enabled: body.data.enabled ?? true,
			localPart: body.data.localPart,
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
