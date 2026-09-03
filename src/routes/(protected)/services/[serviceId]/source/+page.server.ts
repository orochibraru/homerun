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
import { encryptSecret } from "$lib/services/secrets";

const logger = new Logger("Services");

export const load = async ({ parent }) => {
	const { user } = await parent();
	const [settings, connections, cacheRegistries, buildServers] =
		await Promise.all([
			InstanceSettingsDTO.get(),
			GitConnectionDTO.listForUser(user.id),
			BuildCacheRegistryDTO.list(user.id),
			RemoteHostDTO.listBuildServers(user.id),
		]);
	const providersById = new Map(settings.gitProviders.map((p) => [p.id, p]));

	return {
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
	deployTargetHostId: string | null,
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

	if (buildServerRemoteHostId !== deployTargetHostId && !buildCacheRegistryId) {
		return {
			buildCacheRegistryId: [
				"A build server different from the deploy target needs a build cache registry, to publish the built image through.",
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
					gitBuildContext: input.gitBuildContext || null,
					gitDockerfilePath: input.gitDockerfilePath || null,
					gitRef: input.gitRef || null,
					gitUrl: input.gitUrl || null,
				}
			: {
					gitBuildContext: null,
					gitDockerfilePath: null,
					gitRef: null,
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

		const buildServerError = await checkBuildServer(
			{ buildCacheRegistryId, buildServerRemoteHostId },
			svc.remoteHostId,
			locals.user.id,
		);
		if (buildServerError) {
			return fail(400, {
				errors: buildServerError,
				values: Object.fromEntries(formData),
			});
		}

		await svc.update({
			buildCacheRegistryId,
			buildServerRemoteHostId,
			...sourcePatch(input, isGitBuild),
		});

		logger.info(
			`Service source updated: service=${svc.id} buildSource=${input.buildSource} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
