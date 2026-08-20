import { AppLogDTO } from "$lib/dto/app-log-dto";
import { DeploymentDTO } from "$lib/dto/deployment-dto";

export const load = async ({ params }) => {
	const [failedDeployments, appLogs] = await Promise.all([
		DeploymentDTO.listFailedForService(params.serviceId),
		AppLogDTO.listForService(params.serviceId),
	]);

	return {
		appLogs: appLogs.map((l) => l.toJSON()),
		failedDeployments: failedDeployments.map((d) => d.toJSON()),
	};
};
