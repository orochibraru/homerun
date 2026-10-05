import { DnsConnectionDTO } from "#lib/dto/dns-connection-dto.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { dnsConnectionApiBody } from "#lib/server/validation/api-resources.js";
import {
	connectionFields,
	parseConnectionForm,
} from "#lib/server/validation/dns-forms.js";
import { dnsProviderById } from "#lib/services/dns-providers/index.js";

export const GET = async ({ locals }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	return Response.json(
		(await DnsConnectionDTO.list()).map((connection) => connection.summary()),
	);
};

export const POST = async ({ locals, request }) => {
	const caller = apiCaller(locals, { adminOnly: true });
	if ("refused" in caller) {
		return caller.refused;
	}
	const body = await readApiBody(request, dnsConnectionApiBody);
	if ("response" in body) {
		return body.response;
	}
	const provider = dnsProviderById(body.data.provider);
	if (!provider) {
		return apiError("Unknown DNS provider.");
	}
	const parsed = parseConnectionForm(connectionFields(body.data), provider);
	if (parsed.error !== null) {
		return apiError(parsed.error);
	}
	const connection = await DnsConnectionDTO.create({
		...parsed.value,
		provider: provider.id,
		userId: caller.userId,
	});
	return Response.json(connection.summary(), { status: 201 });
};
