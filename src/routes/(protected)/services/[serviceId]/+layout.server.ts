import { error } from "@sveltejs/kit";
import { config } from "$lib/config";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { serviceHostname } from "$lib/services/dns.service";
import { certResolverFor } from "$lib/services/docker/cert-resolver";

export const load = async ({ params, parent }) => {
	await parent();

	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		error(404, "Service not found");
	}

	const [stack, [lastDeploy]] = await Promise.all([
		svc.stackId ? StackDTO.get(svc.stackId) : null,
		DeploymentDTO.listRevisions(svc.id, 1),
	]);

	return {
		baseDomain: config.baseDomain,
		behindPangolin: config.pangolinEnabled,
		certResolver: certResolverFor(
			serviceHostname(svc.slug, stack?.slug),
			config.traefik.certResolver,
			config.pangolinEnabled,
		),
		lastDeployedAt: lastDeploy
			? (lastDeploy.toJSON().finishedAt ?? lastDeploy.toJSON().createdAt)
			: null,
		stackSlug: stack?.slug ?? null,
		publicScheme: config.traefik.entrypoint === "web" ? "http" : "https",
		service: svc.toJSON(),
	};
};
