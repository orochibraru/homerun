import { error } from "@sveltejs/kit";
import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { ObjectStorageService } from "#lib/services/object-storage.service.js";

function reason(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export const load = async ({ params }) => {
	const project = await IacProjectDTO.get(params.projectId);
	if (!project) {
		error(404, "That state backend doesn't exist.");
	}
	const store = await ObjectStoreDTO.get(project.storeId);
	const [endpoint, bucket] = await Promise.all([
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
					problem: "The backend's object store no longer exists.",
				}),
	]);
	return {
		bucket: {
			keys: bucket.detail?.keys ?? null,
			problem:
				bucket.problem ??
				(bucket.detail
					? null
					: `${project.bucket} doesn't exist on ${store?.name ?? "the store"} yet. Terraform's first write fails until it does.`),
		},
		project: {
			bucket: project.bucket,
			id: project.id,
			name: project.name,
			prefix: project.prefix,
			slug: project.slug,
		},
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
