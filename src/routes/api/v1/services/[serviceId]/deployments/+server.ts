import { json } from "@sveltejs/kit";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ServiceDTO } from "$lib/dto/service-dto";

export const GET = async ({ params, locals, url }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}
	const limit = Number(url.searchParams.get("limit") ?? 10);
	if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
		return json(
			{ error: "limit must be a whole number from 1 to 50." },
			{ status: 400 },
		);
	}
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		return json({ error: "Not found" }, { status: 404 });
	}
	const deployments = await DeploymentDTO.listForService(svc.id, limit);
	return json(
		deployments
			.map((deployment) => deployment.toJSON())
			.map((row) => ({
				createdAt: row.createdAt,
				errorMessage: row.errorMessage,
				finishedAt: row.finishedAt,
				gitCommit: row.gitCommit,
				gitRef: row.gitRef,
				id: row.id,
				imageDigest: row.imageDigest,
				imageRef: row.imageRef,
				log: row.log,
				rollbackOfDeploymentId: row.rollbackOfDeploymentId,
				startedAt: row.startedAt,
				status: row.status,
			})),
	);
};
