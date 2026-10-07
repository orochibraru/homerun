import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";

export const load = async ({ parent }) => {
	await parent();
	const builtinEnabled =
		(await InstanceSettingsDTO.get()).toJSON().garageEnabled === true;
	const stores = (await ObjectStoreDTO.list())
		.filter((store) => store.kind !== "garage" || builtinEnabled)
		.map((store) => store.summary());
	return { builtinEnabled, stores };
};
