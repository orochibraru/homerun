import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { DockerService } from "$lib/services/docker.service";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return new Response("Unauthorized", { status: 401 });
	}

	const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!svc) {
		return new Response("Not found", { status: 404 });
	}
	if (!svc.containerId && !svc.swarmServiceId) {
		return new Response("This service hasn't been deployed yet.", {
			status: 400,
		});
	}

	const stream = svc.swarmServiceId
		? await DockerService.streamSwarmServiceLogs(svc.swarmServiceId)
		: await DockerService.streamLogs(
				svc.containerId as string,
				{ follow: true, tail: 200 },
				await RemoteHostDTO.connectionFor(svc, locals.user.id),
			);
	return new Response(stream, {
		headers: {
			"Cache-Control": "no-store",
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
};
