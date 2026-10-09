import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { IacInventoryService } from "#lib/services/iac-inventory.service.js";
import { IacStateService } from "#lib/services/iac-state.service.js";

export const load = async () => {
	const [projects, stores, scopes] = await Promise.all([
		IacProjectDTO.list(),
		ObjectStoreDTO.list(),
		IacInventoryService.scopeOptions(),
	]);
	const storeNames = new Map(stores.map((store) => [store.id, store.name]));
	const scopeLabels = new Map(
		scopes.map((scope) => [
			scope.value,
			`${scope.group === "Stacks" ? "stack" : "service"} ${scope.label}`,
		]),
	);
	return {
		hasStore: stores.length > 0,
		projects: await Promise.all(
			projects.map(async (project) => ({
				...(await IacStateService.summary(project)),
				scopeLabel: project.scope
					? (scopeLabels.get(project.scope) ?? null)
					: null,
				storeName: storeNames.get(project.storeId) ?? null,
			})),
		),
	};
};
