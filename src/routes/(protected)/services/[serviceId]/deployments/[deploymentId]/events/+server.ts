import { ServiceDTO } from "$lib/dto/service-dto";
import { deployProgressStream } from "$lib/server/deploy-progress-stream";

export const GET = async ({ params, locals }) => {
	if (!locals.user) {
		return new Response("Unauthorized", { status: 401 });
	}

	const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
	if (!svc) {
		return new Response("Not found", { status: 404 });
	}

	return new Response(deployProgressStream(params.deploymentId, svc.id), {
		headers: {
			"Cache-Control": "no-store",
			Connection: "keep-alive",
			"Content-Type": "text/event-stream",
		},
	});
};
