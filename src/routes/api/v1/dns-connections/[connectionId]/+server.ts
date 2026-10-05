import { DnsConnectionDTO } from "#lib/dto/dns-connection-dto.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { updateDnsConnectionApiBody } from "#lib/server/validation/api-resources.js";
import {
	connectionFields,
	parseConnectionForm,
} from "#lib/server/validation/dns-forms.js";
import { dnsProviderById } from "#lib/services/dns-providers/index.js";

export const GET = async ({ locals, params }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	const connection = await DnsConnectionDTO.get(params.connectionId);
	return connection
		? Response.json(connection.summary())
		: apiError("Not found", 404);
};

export const PATCH = async ({ locals, params, request }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	const connection = await DnsConnectionDTO.get(params.connectionId);
	if (!connection) {
		return apiError("Not found", 404);
	}
	const body = await readApiBody(request, updateDnsConnectionApiBody);
	if ("response" in body) {
		return body.response;
	}
	const summary = connection.summary();
	const provider = dnsProviderById(summary.provider);
	if (!provider) {
		return apiError("This connection's provider isn't supported any more.");
	}
	const parsed = parseConnectionForm(
		connectionFields({ name: summary.name, ...body.data }),
		provider,
		true,
	);
	if (parsed.error !== null) {
		return apiError(parsed.error);
	}
	await connection.update(parsed.value);
	return Response.json(connection.summary());
};

export const DELETE = async ({ locals, params }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	const connection = await DnsConnectionDTO.get(params.connectionId);
	if (!connection) {
		return apiError("Not found", 404);
	}
	await connection.delete();
	return new Response(null, { status: 204 });
};
