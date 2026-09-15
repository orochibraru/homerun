import { allowLongRequest } from "$lib/server/long-request";
import { DockerService } from "$lib/services/docker.service";

export const GET = async ({ params, locals, platform }) => {
	allowLongRequest(platform);
	if (!locals.user) {
		return new Response("Unauthorized", { status: 401 });
	}
	if (!locals.isAdmin) {
		return new Response("Forbidden", { status: 403 });
	}

	// Only containers this instance's own stack owns : the id is checked
	// against that list rather than trusted, so this can't be pointed at an
	// arbitrary container on the host.
	const infra = await DockerService.listInfraContainers();
	if (!infra.some((container) => container.id === params.containerId)) {
		return new Response("Not found", { status: 404 });
	}

	const stream = await DockerService.streamLogs(params.containerId, {
		follow: true,
		tail: 200,
	});
	return new Response(stream, {
		headers: {
			"Cache-Control": "no-store",
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
};
