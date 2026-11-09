import { LogHistoryService } from "#lib/services/log-history.service.js";

export const load = async ({ parent, url }) => {
	const { workstation } = await parent();
	return {
		history: await LogHistoryService.view(
			{ workstationId: workstation.id },
			url,
		),
	};
};
