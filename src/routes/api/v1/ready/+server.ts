import { json } from "@sveltejs/kit";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { auth } from "$lib/services/auth";

export const GET = async () => {
	try {
		await InstanceSettingsDTO.get();
		await auth.api.getSession({ headers: new Headers() });
		return json({ status: "ok" });
	} catch (err) {
		return json(
			{
				error: err instanceof Error ? err.message : String(err),
				status: "error",
			},
			{ status: 503 },
		);
	}
};
