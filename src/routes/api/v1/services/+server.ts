import { json } from "@sveltejs/kit";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { HOST_ACCESS_MESSAGE, hostAccessRequested } from "$lib/host-access";
import { Logger } from "$lib/logger";
import { jsonPage, parseApiListQuery } from "$lib/server/api-pagination";
import {
	type CreateServiceApiInput,
	createServiceApiBody,
} from "$lib/server/validation/api";
import { CapacityService } from "$lib/services/capacity.service";
import { attachDefaultDataVolume } from "$lib/services/default-volume";
import { GitWebhookService } from "$lib/services/git-webhook.service";
import { encryptSecret } from "$lib/services/secrets";

const logger = new Logger("API");

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const paged = await ServiceDTO.listWithStackNamesPaged(
		parseApiListQuery(url),
	);
	return jsonPage(
		paged.items.map((r) => r.service.toJSON()),
		paged,
	);
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
 * image ref (the daemon surfaces that as a confusing
 * "Get \"http:\": http: no Host in request URL" 500, nothing about a
 * missing image). The REST API and the CLI built on it couldn't create a
 * git-build service at all before this fix.
 */
function toCreateInput(
	input: CreateServiceApiInput,
	stackId: string | null,
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
		stackId,
		pullPolicy: input.pullPolicy,
		restartPolicy: input.restartPolicy,
		runtime: {
			capAdd: input.capAdd,
			command: input.command ?? null,
			devices: input.devices,
			entrypoint: input.entrypoint ?? null,
			envFiles: input.envFiles,
			labels: input.labels,
			privileged: input.privileged,
		},
		slug: input.slug,
		userId,
	};
}

/** Where the image comes from : the git-build fields plus registry coordinates. */
function toSourceInput(input: CreateServiceApiInput) {
	return {
		autoDeployOnPush: input.autoDeployOnPush,
		buildSource: input.buildSource,
		gitBakeFile: input.gitBakeFile || null,
		gitBuildTarget: input.gitBuildTarget || null,
		gitBuildContext: input.gitBuildContext || null,
		gitBuildMethod: input.gitBuildMethod,
		gitDockerfilePath: input.gitDockerfilePath || null,
		gitProviderId: input.gitProviderId || null,
		gitRef: input.gitRef || null,
		gitRepo: input.gitRepo || null,
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

	if (!locals.isAdmin && hostAccessRequested(input)) {
		return json({ error: HOST_ACCESS_MESSAGE }, { status: 403 });
	}

	if (await ServiceDTO.slugTaken(input.slug)) {
		return json({ error: "That slug is already in use." }, { status: 409 });
	}

	const full = await CapacityService.refusal();
	if (full) {
		return json({ error: full }, { status: 409 });
	}

	const stackId =
		input.stackId && (await StackDTO.get(input.stackId)) ? input.stackId : null;

	const svc = await ServiceDTO.create(
		toCreateInput(input, stackId, locals.user.id),
	);

	await attachDefaultDataVolume(svc, locals.user.id);

	await GitWebhookService.sync(svc, {
		gitProviderId: null,
		gitRepo: null,
		gitWebhookId: null,
	});

	logger.info(
		`Service created via API: service=${svc.id} slug=${svc.slug} user=${locals.user.id}`,
	);

	return json(svc.toJSON(), { status: 201 });
};
