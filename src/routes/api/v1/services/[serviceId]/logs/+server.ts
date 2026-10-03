import { ServiceDTO } from "#lib/dto/service-dto.js";
import { isDeployed } from "#lib/service-state.js";
import { DockerService } from "#lib/services/docker.service.js";

export const GET = async ({ params, locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const tail = Number(url.searchParams.get("tail") ?? 200);
	if (!Number.isInteger(tail) || tail < 1 || tail > 10_000) {
		return Response.json(
			{ error: "tail must be a whole number from 1 to 10000." },
			{ status: 400 },
		);
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	if (!isDeployed(svc)) {
		return Response.json(
			{ error: "This service hasn't been deployed yet." },
			{ status: 400 },
		);
	}
	const opts = { follow: url.searchParams.get("follow") === "true", tail };
	const stream = svc.swarmServiceId
		? await DockerService.streamSwarmServiceLogs(svc.swarmServiceId, opts)
		: await DockerService.streamLogs(svc.containerId as string, opts);
	return new Response(stream, {
		headers: {
			"Cache-Control": "no-store",
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
};
