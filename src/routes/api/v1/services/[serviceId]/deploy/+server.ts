import { ServiceDTO } from "#lib/dto/service-dto.js";
import { deployServiceApiBody } from "#lib/server/validation/api.js";
import { DeploymentService } from "#lib/services/deploy.service.js";
import { QueueService } from "#lib/services/queue.service.js";
import {
	ReleaseChannelError,
	ReleaseChannelService,
} from "#lib/services/release-channel.service.js";

export const POST = async ({ params, locals, request }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const service = await ServiceDTO.get(params.serviceId);
	if (!service) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const raw = await request.text();
	let body: unknown = {};
	if (raw.trim()) {
		try {
			body = JSON.parse(raw);
		} catch {
			return Response.json(
				{ error: "The body isn't valid JSON." },
				{ status: 400 },
			);
		}
	}
	const result = deployServiceApiBody.safeParse(body);
	if (!result.success) {
		return Response.json(result.error.flatten(), { status: 400 });
	}
	const { environment, tag } = result.data;
	if (environment === "canary" && !service.toJSON().channelsEnabled) {
		return Response.json(
			{
				error:
					"Release channels are off for this service, so it has no canary.",
			},
			{ status: 400 },
		);
	}
	if (tag && service.buildSource === "git") {
		return Response.json(
			{ error: "This service builds from git : it has no image tag to set." },
			{ status: 400 },
		);
	}
	if (tag && tag !== service.tag) {
		await service.update({ tag });
	}

	let enqueued: { deploymentId: string; jobId: string };
	try {
		enqueued =
			environment === "canary"
				? await ReleaseChannelService.deployCanary(service, {
						trigger: "manual",
						userId: locals.user.id,
					})
				: await DeploymentService.enqueueDeploy({
						svc: service,
						userId: locals.user.id,
					});
	} catch (err) {
		if (err instanceof ReleaseChannelError) {
			return Response.json({ error: err.message }, { status: 400 });
		}
		throw err;
	}
	const { deploymentId, jobId } = enqueued;
	const finished = await QueueService.wait(jobId);
	if (finished.status !== "succeeded") {
		return Response.json(
			{ deploymentId, error: finished.error ?? "Deploy failed." },
			{ status: 500 },
		);
	}
	return Response.json({
		containerId: (finished.result?.containerId as string | null) ?? undefined,
		deploymentId,
		success: true,
	});
};
