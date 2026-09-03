import { json } from "@sveltejs/kit";
import { ProjectDTO } from "$lib/dto/project-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import {
	type CreateServiceApiInput,
	createServiceApiBody,
} from "$lib/server/validation/api";
import { encryptSecret } from "$lib/services/secrets";

const logger = new Logger("API");

export const GET = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const services = await ServiceDTO.list(locals.user.id);
	return json(services.map((s) => s.toJSON()));
};

/**
 * Maps the validated API body onto ServiceDTO.create's input, normalizing
 * empty strings to null the way the FormData path does.
 *
 * Real, tested-in-review finding, from this app's own integration test
 * suite (tests/integration/) : buildSource/gitUrl/gitRef/gitBuildContext/
 * gitDockerfilePath were validated by createServiceApiBody but never
 * actually passed to ServiceDTO.create(), so a git-mode POST /services
 * silently created an image-mode service instead (buildSource defaulting
 * to "image", image/tag defaulting to "" since a git-mode request doesn't
 * send them), which then failed at deploy time trying to pull an empty
 * image ref (dockerode/the daemon surfaces that as a confusing
 * "Get \"http:\": http: no Host in request URL" 500, nothing about a
 * missing image). The REST API and the CLI built on it couldn't create a
 * git-build service at all before this fix.
 */
function toCreateInput(
	input: CreateServiceApiInput,
	projectId: string | null,
	userId: string,
) {
	return {
		...toSourceInput(input),
		authRequired: input.authRequired,
		containerPort: input.containerPort,
		cpuLimit: input.cpuLimit || null,
		dnsResolvable: input.dnsResolvable,
		envVars: input.envVars,
		memoryLimitMb: input.memoryLimitMb ?? null,
		name: input.name,
		projectId,
		restartPolicy: input.restartPolicy,
		slug: input.slug,
		userId,
	};
}

/** Where the image comes from : the git-build fields plus registry coordinates. */
function toSourceInput(input: CreateServiceApiInput) {
	return {
		buildSource: input.buildSource,
		gitBuildContext: input.gitBuildContext || null,
		gitDockerfilePath: input.gitDockerfilePath || null,
		gitRef: input.gitRef || null,
		gitUrl: input.gitUrl || null,
		image: input.image ?? "",
		registryPasswordEnc: input.registryPassword
			? encryptSecret(input.registryPassword)
			: null,
		registryUrl: input.registryUrl || null,
		registryUsername: input.registryUsername || null,
		tag: input.tag ?? "",
	};
}

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

	const svc = await ServiceDTO.create(
		toCreateInput(input, projectId, locals.user.id),
	);

	logger.info(
		`Service created via API: service=${svc.id} slug=${svc.slug} user=${locals.user.id}`,
	);

	return json(svc.toJSON(), { status: 201 });
};
