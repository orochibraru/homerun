import { json } from "@sveltejs/kit";
import { ProjectDTO } from "$lib/dto/project-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { createServiceApiBody } from "$lib/server/validation/api";
import { encryptSecret } from "$lib/services/secrets";

const logger = new Logger("API");

export const GET = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const services = await ServiceDTO.list(locals.user.id);
	return json(services.map((s) => s.toJSON()));
};

export const POST = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = await request.json().catch(() => null);
	const result = createServiceApiBody.safeParse(body);
	if (!result.success) {
		return json(
			{ error: "Invalid request body", issues: result.error.flatten() },
			{ status: 400 },
		);
	}
	const input = result.data;

	if (await ServiceDTO.slugTaken(input.slug)) {
		return json({ error: "That slug is already in use." }, { status: 409 });
	}

	const projectId =
		input.projectId && (await ProjectDTO.get(input.projectId, locals.user.id))
			? input.projectId
			: null;

	const svc = await ServiceDTO.create({
		containerPort: input.containerPort,
		cpuLimit: input.cpuLimit || null,
		dnsResolvable: input.dnsResolvable,
		envVars: input.envVars,
		image: input.image ?? "",
		memoryLimitMb: input.memoryLimitMb ?? null,
		name: input.name,
		projectId,
		registryPasswordEnc: input.registryPassword
			? encryptSecret(input.registryPassword)
			: null,
		registryUrl: input.registryUrl || null,
		registryUsername: input.registryUsername || null,
		restartPolicy: input.restartPolicy,
		slug: input.slug,
		tag: input.tag ?? "",
		userId: locals.user.id,
	});

	logger.info(
		`Service created via API: service=${svc.id} slug=${svc.slug} user=${locals.user.id}`,
	);

	return json(svc.toJSON(), { status: 201 });
};
