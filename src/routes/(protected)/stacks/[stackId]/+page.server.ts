import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ServiceDTO } from "$lib/dto/service-dto";

export const load = async ({ params, parent }) => {
	const { user } = await parent();
	const services = await ServiceDTO.listByStack(params.stackId, user.id);
	const recentDeployments = await DeploymentDTO.listRecentForServices(
		services.map((svc) => svc.id),
	);

	return {
		recentDeployments: recentDeployments.map((r) => ({
			...r.deployment.toJSON(),
			serviceName: r.serviceName,
			serviceSlug: r.serviceSlug,
		})),
		services: services.map((s) => s.toJSON()),
	};
};
