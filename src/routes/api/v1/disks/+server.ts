import { apiCaller, apiError } from "#lib/server/api-route.js";
import { HostDiskService } from "#lib/services/host-disk.service.js";

export const GET = async ({ locals }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	try {
		return Response.json(await HostDiskService.list());
	} catch (err) {
		return apiError(
			`Couldn't read the host's disks: ${err instanceof Error ? err.message : String(err)}`,
			502,
		);
	}
};
