import { config } from "#lib/config.js";
import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { IacStateService } from "#lib/services/iac-state.service.js";

export const load = async ({ parent, url }) => {
	await parent();
	const [projects, storeRows, settings] = await Promise.all([
		IacProjectDTO.list(),
		ObjectStoreDTO.list(),
		InstanceSettingsDTO.get(),
	]);
	const builtinEnabled = settings.toJSON().garageEnabled === true;
	const storeNames = new Map(storeRows.map((store) => [store.id, store.name]));
	return {
		builtinEnabled,
		origin: config.auth.origin ?? url.origin,
		projects: await Promise.all(
			projects.map(async (project) => ({
				...(await IacStateService.summary(project)),
				storeName: storeNames.get(project.storeId) ?? null,
			})),
		),
		stores: storeRows
			.filter((store) => store.kind !== "garage" || builtinEnabled)
			.map((store) => store.summary()),
	};
};
