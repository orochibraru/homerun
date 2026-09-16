import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { BuildCacheRegistryDTO } from "$lib/dto/build-cache-registry-dto";
import { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import {
	type UpdateSourceInput,
	updateSourceSchema,
} from "$lib/server/validation/service";
import { GitWebhookService } from "$lib/services/git-webhook.service";
import { encryptSecret } from "$lib/services/secrets";

const logger = new Logger("Services");

export const load = async ({ parent, params }) => {
	const { user } = await parent();
	const svc = await ServiceDTO.get(params.serviceId, user.id);
	const [settings, connections, cacheRegistries, buildServers] =
		await Promise.all([
			InstanceSettingsDTO.get(),
			GitConnectionDTO.listForUser(user.id),
			BuildCacheRegistryDTO.list(user.id),
			RemoteHostDTO.listBuildServers(user.id),
		]);
	const providersById = new Map(settings.gitProviders.map((p) => [p.id, p]));

	return {
		pushWebhook: svc ? await GitWebhookService.describe(svc) : null,
		buildCacheRegistries: cacheRegistries.map((r) => r.toJSON()),
		buildServers: buildServers.map((r) => r.toJSON()),
		// Only providers this user has actually connected : see the Git
		// Providers page for connecting one.
		connectedGitProviders: connections
			.filter((c) => providersById.has(c.providerId))
			.map((c) => ({
				id: c.providerId,
				name: providersById.get(c.providerId)?.name ?? c.providerKind,
				providerUsername: c.providerUsername,
			})),
	};
};

function statusCheckPatch(formData: FormData, isGitBuild: boolean) {
	const names = formData
		.getAll("requiredStatusChecks")
		.map((value) => String(value).trim())
		.filter((value) => value.length > 0 && value.length <= 200);
	return {
		requireStatusChecks:
			isGitBuild && formData.get("requireStatusChecks") === "on",
		requiredStatusChecks: [...new Set(names)].slice(0, 50),
	};
}

interface BuildTargets {
	buildCacheRegistryId: string | null;
	buildServerRemoteHostId: string | null;
}

/**
 * Validates the build-server/build-cache pair, returning field errors or
 * null. Both remote-host kinds (docker and agent) are real build servers,
 * see deploy.service.ts's git-build branch and AgentClientService.build :
 * real, tested-in-review bug this replaced, a stale "docker only" leftover
 * from before that integration.
 */
async function checkBuildServer(
	targets: BuildTargets,
	userId: string,
): Promise<Record<string, string[]> | null> {
	const { buildCacheRegistryId, buildServerRemoteHostId } = targets;
	if (!buildServerRemoteHostId) {
		return null;
	}

	const buildServer = await RemoteHostDTO.get(buildServerRemoteHostId, userId);
	if (!buildServer) {
		return { buildServerRemoteHostId: ["That build server wasn't found."] };
	}

	if (!buildCacheRegistryId) {
		return {
			buildCacheRegistryId: [
				"A build server needs a build cache registry, to publish the built image through.",
			],
		};
	}
	return null;
}

/** The image-source half of the update : git fields in git mode, image/tag otherwise. */
function sourcePatch(input: UpdateSourceInput, isGitBuild: boolean) {
	return {
		buildSource: input.buildSource,
		registryUrl: input.registryUrl || null,
		registryUsername: input.registryUsername || null,
		// Blank password field means "leave unchanged" : never overwrite a
		// stored credential with nothing just because the user didn't
		// retype it.
		...(input.registryPassword
			? { registryPasswordEnc: encryptSecret(input.registryPassword) }
			: {}),
		...(isGitBuild
			? {
					autoDeployOnPush: input.autoDeployOnPush,
					gitBuildContext: input.gitBuildContext || null,
					gitDockerfilePath: input.gitDockerfilePath || null,
					gitProviderId: (input.gitRepo && input.gitProviderId) || null,
					gitRef: input.gitRef || null,
					gitRepo: (input.gitProviderId && input.gitRepo) || null,
					gitUrl: input.gitUrl || null,
				}
			: {
					autoDeployOnPush: false,
					gitBuildContext: null,
					gitDockerfilePath: null,
					gitProviderId: null,
					gitRef: null,
					gitRepo: null,
					gitUrl: null,
					image: input.image,
					tag: input.tag,
				}),
	};
}

export const actions = {
	updateSource: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const result = updateSourceSchema.safeParse(Object.fromEntries(formData));
		if (!result.success) {
			return fail(400, {
				errors: result.error.flatten().fieldErrors,
				values: Object.fromEntries(formData),
			});
		}
		const input = result.data;
		const isGitBuild = input.buildSource === "git";
		const buildServerRemoteHostId = isGitBuild
			? input.buildServerRemoteHostId || null
			: null;
		const buildCacheRegistryId = isGitBuild
			? input.buildCacheRegistryId || null
			: null;

		const checks = statusCheckPatch(formData, isGitBuild);
		if (
			checks.requireStatusChecks &&
			checks.requiredStatusChecks.length === 0
		) {
			return fail(400, {
				errors: {
					requiredStatusChecks: [
						"Pick at least one check to require, or turn status checks off.",
					],
				},
				values: Object.fromEntries(formData),
			});
		}

		const buildServerError = await checkBuildServer(
			{ buildCacheRegistryId, buildServerRemoteHostId },
			locals.user.id,
		);
		if (buildServerError) {
			return fail(400, {
				errors: buildServerError,
				values: Object.fromEntries(formData),
			});
		}

		const previousWebhook = {
			gitProviderId: svc.gitProviderId,
			gitRepo: svc.gitRepo,
			gitWebhookId: svc.gitWebhookId,
		};
		await svc.update({
			buildCacheRegistryId,
			buildServerRemoteHostId,
			...checks,
			...sourcePatch(input, isGitBuild),
		});
		await GitWebhookService.sync(svc, previousWebhook);

		logger.info(
			`Service source updated: service=${svc.id} buildSource=${input.buildSource} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
