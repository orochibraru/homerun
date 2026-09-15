import { error, fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { BuildCacheRegistryDTO } from "$lib/dto/build-cache-registry-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("BuildCacheRegistries");

export const load = async ({ params, parent }) => {
	const { user } = await parent();

	const registry = await BuildCacheRegistryDTO.get(params.registryId, user.id);
	if (!registry) {
		error(404, "Registry not found");
	}

	return {
		registry: {
			id: registry.id,
			name: registry.name,
			registryUrl: registry.registryUrl,
			username: registry.username,
		},
	};
};

export const actions = {
	update: async ({ params, request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const registry = await BuildCacheRegistryDTO.get(
			params.registryId,
			locals.user.id,
		);
		if (!registry) {
			return fail(404, { error: "Registry not found." });
		}

		const formData = await request.formData();
		const name = (formData.get("name") as string | null)?.trim() ?? "";
		const registryUrl =
			(formData.get("registryUrl") as string | null)?.trim() ?? "";
		const username = (formData.get("username") as string | null)?.trim() ?? "";
		const password = (formData.get("password") as string | null)?.trim() ?? "";

		if (!(name && registryUrl && username)) {
			return fail(400, { error: "Name, URL and username are required." });
		}

		await registry.update({ name, password, registryUrl, username });
		logger.info(
			`Build cache registry updated: registry=${registry.id} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
