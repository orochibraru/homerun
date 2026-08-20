import { DockerService } from "$lib/services/docker.service";

export const GET = async ({ locals }) => {
	if (!locals.user) {
		return new Response("Unauthorized", { status: 401 });
	}

	const traefik = await DockerService.findTraefikContainer();
	if (!traefik) {
		return new Response(
			"Traefik container not found : is it running (`docker compose up -d`)?",
			{ status: 404 },
		);
	}

	const stream = await DockerService.streamLogs(traefik.id, {
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
