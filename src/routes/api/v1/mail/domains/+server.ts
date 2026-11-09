import { MailDomainDTO } from "#lib/dto/mail-domain-dto.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { mailDomainApiBody } from "#lib/server/validation/mail-api.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";
import { UserService } from "#lib/services/user.service.js";

export const GET = async ({ locals }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	return Response.json(
		(await MailDomainDTO.list()).map((domain) => domain.summary()),
	);
};

export const POST = async ({ locals, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const body = await readApiBody(request, mailDomainApiBody);
	if ("response" in body) {
		return body.response;
	}
	const user = await UserService.getUser(caller.userId);
	if (!user) {
		return apiError("Unauthorized", 401);
	}
	try {
		const created = await MailService.createDomain(body.data.dnsDomainId, user);
		await enqueueCoreServiceJob(
			{ action: "syncMail", purge: [] },
			caller.userId,
		);
		return Response.json(created.summary(), { status: 201 });
	} catch (err) {
		return apiError(err instanceof Error ? err.message : String(err));
	}
};
