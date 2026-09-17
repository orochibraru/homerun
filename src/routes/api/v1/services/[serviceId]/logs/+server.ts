import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { allowLongRequest } from "$lib/server/long-request";
import { isDeployed } from "$lib/service-state";
import { DockerService } from "$lib/services/docker.service";

export const GET = async ({ params, locals, platform, url }) => {
	allowLongRequest(platform);
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const tail = Number(url.searchParams.get("tail") ?? 200);
	if (!Number.isInteger(tail) || tail < 1 || tail > 10_000) {
		return json(
			{ error: "tail must be a whole number from 1 to 10000." },
			{ status: 400 },
		);
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	if (!isDeployed(svc)) {
		return json(
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
