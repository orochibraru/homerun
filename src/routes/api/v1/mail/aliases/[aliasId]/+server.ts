import { MailAliasDTO } from "#lib/dto/mail-alias-dto.js";
import { parseDestinations } from "#lib/mail.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { mailAliasUpdateApiBody } from "#lib/server/validation/mail-api.js";
import { enqueueCoreServiceJob } from "#lib/services/core-service-queue.js";
import { MailService } from "#lib/services/mail.service.js";

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const alias = await MailAliasDTO.get(params.aliasId);
	return alias ? Response.json(alias.summary()) : apiError("Not found", 404);
};

export const PATCH = async ({ locals, params, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const alias = await MailAliasDTO.get(params.aliasId);
	if (!alias) {
		return apiError("Not found", 404);
	}
	const body = await readApiBody(request, mailAliasUpdateApiBody);
	if ("response" in body) {
		return body.response;
	}
	const current = alias.toJSON();
	const destinations = body.data.destinations
		? parseDestinations(body.data.destinations.join(","))
		: current.destinations;
	const problem = MailService.destinationsProblem(destinations);
	if (problem) {
		return apiError(problem);
	}
	await alias.update({
		destinations,
		enabled: body.data.enabled ?? current.enabled,
	});
	await enqueueCoreServiceJob({ action: "syncMail", purge: [] }, caller.userId);
	return Response.json(alias.summary());
};

export const DELETE = async ({ locals, params }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const alias = await MailAliasDTO.get(params.aliasId);
	if (!alias) {
		return apiError("Not found", 404);
	}
	await alias.delete();
	await enqueueCoreServiceJob({ action: "syncMail", purge: [] }, caller.userId);
	return new Response(null, { status: 204 });
};
