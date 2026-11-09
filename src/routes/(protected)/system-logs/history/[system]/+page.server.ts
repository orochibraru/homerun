import { ServiceLogDTO } from "#lib/dto/service-log-dto.js";
import { LogHistoryService } from "#lib/services/log-history.service.js";

export const load = async ({ params, url }) => {
	const [history, systems] = await Promise.all([
		LogHistoryService.view({ system: params.system }, url),
		ServiceLogDTO.systems(),
	]);
	return { history, system: params.system, systems };
};
