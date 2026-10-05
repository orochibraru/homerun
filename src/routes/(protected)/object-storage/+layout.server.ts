import { redirect } from "@sveltejs/kit";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { resolve } from "$app/paths";

export const load = async ({ parent }) => {
	const { user } = await parent();
	if (user.role !== "admin") {
		throw redirect(302, resolve(""));
	}
	const builtinEnabled =
		(await InstanceSettingsDTO.get()).toJSON().garageEnabled === true;
	const stores = (await ObjectStoreDTO.list())
		.filter((store) => store.kind !== "garage" || builtinEnabled)
		.map((store) => store.summary());
	return { builtinEnabled, stores };
};
