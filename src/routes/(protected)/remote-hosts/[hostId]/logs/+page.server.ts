import { RemoteHostDTO } from "#lib/dto/remote-host-dto.js";
import {
	AgentClientService,
	type AgentLogLine,
} from "#lib/services/agent-client.service.js";

export const load = async ({ params, parent }) => {
	await parent();
	const connection = (
		await RemoteHostDTO.get(params.hostId)
	)?.toAgentConnection();
	if (!connection) {
		return { error: "This host isn't a registered agent.", lines: [] };
	}
	try {
		return {
			error: null,
			lines: await AgentClientService.logs(connection),
		};
	} catch (err) {
		return {
			error: err instanceof Error ? err.message : String(err),
			lines: [] as AgentLogLine[],
		};
	}
};
