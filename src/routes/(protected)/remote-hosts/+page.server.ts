import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { Logger } from "$lib/logger";
import { AgentClientService } from "$lib/services/agent-client.service";

const logger = new Logger("RemoteHosts");

export interface AgentStatus {
	reachable: boolean;
	version: string | null;
	error: string | null;
}

/**
 * Live `GET /v1/health` against every `kind: "agent"` host, in parallel, so
 * the list page can actually show *why* an agent shows as unusable (down,
 * wrong URL, version) instead of the same static caveat regardless of
 * whether the agent is even reachable. Best-effort : a single unreachable
 * agent shouldn't fail the whole page load, same posture as
 * AgentClientService.checkHealth's own caller at Add-Host-save time.
 */
async function checkAgentStatuses(
	hosts: Awaited<ReturnType<typeof RemoteHostDTO.list>>,
): Promise<Record<string, AgentStatus>> {
	const agentHosts = hosts.filter((h) => h.kind === "agent" && h.agentUrl);
	const entries = await Promise.all(
		agentHosts.map(async (h) => {
			try {
				const { version } = await AgentClientService.checkHealth(
					h.agentUrl as string,
				);
				return [h.id, { error: null, reachable: true, version }] as const;
			} catch (error) {
				return [
					h.id,
					{
						error: error instanceof Error ? error.message : String(error),
						reachable: false,
						version: null,
					},
				] as const;
			}
		}),
	);
	return Object.fromEntries(entries);
}

export const load = async ({ parent }) => {
	const { user } = await parent();
	const hosts = await RemoteHostDTO.list(user.id);
	const agentStatuses = await checkAgentStatuses(hosts);
	return { agentStatuses, hosts: hosts.map((h) => h.toJSON()) };
};

export const actions = {
	delete: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const hostId = formData.get("hostId") as string | null;
		if (!hostId) {
			return fail(400, { error: "Missing host id." });
		}

		const host = await RemoteHostDTO.get(hostId, locals.user.id);
		if (!host) {
			return fail(404, { error: "Remote host not found." });
		}

		await host.delete();
		logger.info(`Remote host deleted: host=${hostId} user=${locals.user.id}`);
		return { success: true };
	},
};
