import { MailDomainDTO } from "#lib/dto/mail-domain-dto.js";
import { apiCaller, apiError } from "#lib/server/api-route.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const domain = await MailDomainDTO.get(params.domainId);
	if (!domain) {
		return apiError("Not found", 404);
	}
	return Response.json({
		...domain.summary(),
		records: await MailService.checkRecords(domain),
	});
};

export const DELETE = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const domain = await MailDomainDTO.get(params.domainId);
	if (!domain) {
		return apiError("Not found", 404);
	}
	await domain.delete();
	await enqueueCoreServiceJob(
		{ action: "syncMail", purge: [domain.name] },
		caller.userId,
	);
	return new Response(null, { status: 204 });
};
