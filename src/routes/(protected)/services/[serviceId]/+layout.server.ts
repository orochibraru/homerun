import { error } from "@sveltejs/kit";
import { config } from "$lib/config";
import { ProjectDTO } from "$lib/dto/project-dto";
import { ServiceDTO } from "$lib/dto/service-dto";

export const load = async ({ params, parent }) => {
	const { user } = await parent();

	const svc = await ServiceDTO.get(params.serviceId, user.id);
	if (!svc) {
		error(404, "Service not found");
	}

	const project = svc.projectId
		? await ProjectDTO.get(svc.projectId, user.id)
		: null;

	return {
		baseDomain: config.baseDomain,
		certResolver: config.traefik.certResolver,
		projectSlug: project?.slug ?? null,
		publicScheme: config.traefik.entrypoint === "web" ? "http" : "https",
		service: svc.toJSON(),
	};
};
