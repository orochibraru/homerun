import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { auth } from "#lib/services/auth.js";

export const GET = async () => {
	try {
		await InstanceSettingsDTO.get();
		await auth.api.getSession({ headers: new Headers() });
		return Response.json({ status: "ok" });
	} catch (err) {
		return Response.json(
			{
				error: err instanceof Error ? err.message : String(err),
				status: "error",
			},
			{ status: 503 },
		);
	}
};
