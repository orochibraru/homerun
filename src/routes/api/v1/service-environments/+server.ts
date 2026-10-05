import { ServiceDTO } from "#lib/dto/service-dto.js";
import {
	isEnvironmentRow,
	serviceEnvironmentApiJson,
} from "#lib/server/api-json.js";
import { apiCaller, apiError, readApiBody } from "#lib/server/api-route.js";
import { serviceEnvironmentApiBody } from "#lib/server/validation/api-resources.js";
import {
	EnvironmentError,
	EnvironmentService,
} from "#lib/services/environment.service.js";

export const GET = async ({ locals }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	return Response.json(
		(await ServiceDTO.list())
			.map((svc) => svc.toJSON())
			.filter(isEnvironmentRow)
			.map(serviceEnvironmentApiJson),
	);
};

export const POST = async ({ locals, request }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const body = await readApiBody(request, serviceEnvironmentApiBody);
	if ("response" in body) {
		return body.response;
	}
	const { deploy, domain, envOverrides, name, ref, serviceId } = body.data;
	const parent = await ServiceDTO.get(serviceId);
	if (!parent) {
		return apiError("Service not found.", 404);
	}
	try {
		const environment = await EnvironmentService.create(
			parent,
			name,
			{ domain: domain ?? null, envOverrides, ref },
			{ deploy, userId: caller.userId },
		);
		return Response.json(serviceEnvironmentApiJson(environment.toJSON()), {
			status: 201,
		});
	} catch (err) {
		if (err instanceof EnvironmentError) {
			return apiError(err.message);
		}
		throw err;
	}
};
