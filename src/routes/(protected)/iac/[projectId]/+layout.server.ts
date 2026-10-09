import { error } from "@sveltejs/kit";
import { config } from "#lib/config.js";
import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { IacInventoryService } from "#lib/services/iac-inventory.service.js";
import { ObjectStorageService } from "#lib/services/object-storage.service.js";

function reason(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export const load = async ({ params, url }) => {
	const project = await IacProjectDTO.get(params.projectId);
	if (!project) {
		error(404, "That IaC project doesn't exist.");
	}
	const store = await ObjectStoreDTO.get(project.storeId);
	const [endpoint, bucket, scopes] = await Promise.all([
		store ? ObjectStorageService.publicEndpoint(store) : Promise.resolve(""),
		store
			? ObjectStorageService.bucket(store, project.bucket).then(
					(detail) => ({ detail, problem: null }),
					(cause: unknown) => ({
						detail: null,
						problem: `The bucket can't be read: ${reason(cause)}`,
					}),
				)
			: Promise.resolve({
					detail: null,
					problem: "The project's object store no longer exists.",
				}),
		IacInventoryService.scopeOptions(),
	]);
	return {
		bucket: {
			keys: bucket.detail?.keys ?? null,
			problem:
				bucket.problem ??
				(bucket.detail
					? null
					: `${project.bucket} doesn't exist on ${store?.name ?? "the store"} yet. The first state write fails until it does.`),
		},
		origin: config.auth.origin ?? url.origin,
		project: {
			bucket: project.bucket,
			id: project.id,
			name: project.name,
			prefix: project.prefix,
			scope: project.scope,
			slug: project.slug,
			tool: project.tool,
		},
		scopes,
		store: store
			? {
					endpoint,
					kind: store.kind,
					name: store.name,
					region: store.region,
				}
			: null,
	};
};
