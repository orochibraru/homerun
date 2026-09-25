import { DeploymentDTO } from "$lib/dto/deployment-dto";

export const load = async ({ parent }) => {
	const { services } = await parent();
	const recentDeployments = await DeploymentDTO.listRecentForServices(
		services.map((svc) => svc.id),
	);

	return {
		recentDeployments: recentDeployments.map((r) => ({
			...r.deployment.toJSON(),
			serviceName: r.serviceName,
			serviceSlug: r.serviceSlug,
		})),
	};
};
