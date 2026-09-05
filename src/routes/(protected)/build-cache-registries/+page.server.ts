import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { BuildCacheRegistryDTO } from "$lib/dto/build-cache-registry-dto";
import { Logger } from "$lib/logger";
import { parseListQuery } from "$lib/server/list-query";

const logger = new Logger("BuildCacheRegistries");

export const load = async ({ parent, url }) => {
	const { user } = await parent();
	const query = parseListQuery(url);
	const paged = await BuildCacheRegistryDTO.listPaged(user.id, query);
	return {
		filtered: query.active,
		page: paged.page,
		perPage: paged.perPage,
		registries: paged.items.map((r) => r.toJSON()),
		total: paged.total,
	};
};

export const actions = {
	delete: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const registryId = formData.get("registryId") as string | null;
		if (!registryId) {
			return fail(400, { error: "Missing registry id." });
		}

		const registry = await BuildCacheRegistryDTO.get(
			registryId,
			locals.user.id,
		);
		if (!registry) {
			return fail(404, { error: "Registry not found." });
		}

		await registry.delete();
		logger.info(
			`Build cache registry deleted: registry=${registryId} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
