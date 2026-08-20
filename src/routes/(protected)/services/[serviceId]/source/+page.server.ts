import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { GitConnectionDTO } from "$lib/dto/git-connection-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { updateSourceSchema } from "$lib/server/validation/service";
import { encryptSecret } from "$lib/services/secrets";

const logger = new Logger("Services");

export const load = async ({ parent }) => {
	const { user } = await parent();
	const [settings, connections] = await Promise.all([
		InstanceSettingsDTO.get(),
		GitConnectionDTO.listForUser(user.id),
	]);
	const providersById = new Map(settings.gitProviders.map((p) => [p.id, p]));

	return {
		// Only providers this user has actually connected — see the Git
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

		await svc.update({
			buildSource: input.buildSource,
			registryUrl: input.registryUrl || null,
			registryUsername: input.registryUsername || null,
			// Blank password field means "leave unchanged" — never overwrite a
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
		});

		logger.info(
			`Service source updated: service=${svc.id} buildSource=${input.buildSource} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
