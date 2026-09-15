import { DeploymentDTO } from "$lib/dto/deployment-dto";

export const load = async ({ params }) => {
	const deployments = await DeploymentDTO.listForService(params.serviceId);
	return { deployments: deployments.map((d) => d.toJSON()) };
};
