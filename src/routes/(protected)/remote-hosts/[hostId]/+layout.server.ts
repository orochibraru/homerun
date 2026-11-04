import { error } from "@sveltejs/kit";

import { RemoteHostDTO } from "#lib/dto/remote-host-dto.js";
import { APP_VERSION } from "#lib/server/app-version.js";
import { AgentClientService } from "#lib/services/agent-client.service.js";
import { normalizeVersion } from "#lib/services/self-update/version.js";

export const load = async ({ params, parent }) => {
	await parent();
	const host = await RemoteHostDTO.get(params.hostId);
	if (!host) {
		error(404, "Remote host not found");
	}

	let agentStatus: {
		error: string | null;
		reachable: boolean;
		version: string | null;
	} | null = null;
	if (host.kind === "agent" && host.agentUrl) {
		try {
			const { version } = await AgentClientService.checkHealth(host.agentUrl);
			agentStatus = { error: null, reachable: true, version };
		} catch (err) {
			agentStatus = {
				error: err instanceof Error ? err.message : String(err),
				reachable: false,
				version: null,
			};
		}
	}

	const instanceVersion = normalizeVersion(APP_VERSION);
	const agentVersion = agentStatus?.version
		? normalizeVersion(agentStatus.version)
		: null;
	return {
		agentStatus,
		host: host.toJSON(),
		instanceVersion,
		updateAvailable:
			!!instanceVersion && !!agentVersion && agentVersion !== instanceVersion,
	};
};
