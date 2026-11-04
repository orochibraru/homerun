import { RemoteHostDTO } from "#lib/dto/remote-host-dto.js";
import {
	AgentClientService,
	type AgentEvent,
} from "#lib/services/agent-client.service.js";

export const load = async ({ params, parent }) => {
	await parent();
	const connection = (
		await RemoteHostDTO.get(params.hostId)
	)?.toAgentConnection();
	if (!connection) {
		return { error: "This host isn't a registered agent.", events: [] };
	}
	try {
		const events = await AgentClientService.events(connection);
		return { error: null, events: events.toReversed() };
	} catch (err) {
		return {
			error: err instanceof Error ? err.message : String(err),
			events: [] as AgentEvent[],
		};
	}
};
