import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { allowLongRequest } from "$lib/server/long-request";
import { QueueService } from "$lib/services/queue.service";
import { RevisionService } from "$lib/services/revision.service";

const logger = new Logger("API");

export const POST = async ({ params, locals, platform, url }) => {
	allowLongRequest(platform);
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}

	const target = await RevisionService.findTarget(
		svc,
		params.revisionId === "previous" ? null : params.revisionId,
	);
	if (target.error !== null) {
		return json({ error: target.error }, { status: target.status });
	}
	const { revision } = target;

	const restoreConfig = url.searchParams.get("restoreConfig") === "true";
	const { deploymentId, jobId } = await RevisionService.enqueueRollback({
		restoreConfig,
		revision,
		svc,
		userId: locals.user.id,
	});
	logger.info(
		`Revision deploy via API: service=${svc.id} revision=${revision.id} deployment=${deploymentId} restoreConfig=${restoreConfig} user=${locals.user.id}`,
	);
	const finished = await QueueService.wait(jobId);
	if (finished.status !== "succeeded") {
		return json(
			{ deploymentId, error: finished.error ?? "Deploy failed." },
			{ status: 500 },
		);
	}
	return json({
		containerId: (finished.result?.containerId as string | null) ?? undefined,
		deploymentId,
		success: true,
	});
};
