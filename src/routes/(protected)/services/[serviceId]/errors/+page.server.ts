import { DeploymentDTO } from "$lib/dto/deployment-dto";

export const load = async ({ params }) => {
  const failedDeployments = await DeploymentDTO.listFailedForService(
    params.serviceId
  );

  return { failedDeployments: failedDeployments.map((d) => d.toJSON()) };
};
