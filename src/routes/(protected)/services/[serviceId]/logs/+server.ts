import { ServiceDTO } from "$lib/dto/service-dto";
import { allowLongRequest } from "$lib/server/long-request";
import { DockerService } from "$lib/services/docker.service";
import { ServiceLifecycleService } from "$lib/services/service-lifecycle.service";

export const GET = async ({ params, locals, platform }) => {
	allowLongRequest(platform);
	if (!locals.user) {
		return new Response("Unauthorized", { status: 401 });
	}

	const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!svc) {
		return new Response("Not found", { status: 404 });
	}
	if (!(svc.containerId || svc.swarmServiceId)) {
		return new Response("This service hasn't been deployed yet.", {
			status: 400,
		});
	}

	const stream = svc.swarmServiceId
		? await DockerService.streamSwarmServiceLogs(svc.swarmServiceId)
		: await ServiceLifecycleService.streamLogs(
				svc.containerId as string,
				svc.remoteHostId,
				locals.user.id,
			);
	return new Response(stream, {
		headers: {
			"Cache-Control": "no-store",
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
};
