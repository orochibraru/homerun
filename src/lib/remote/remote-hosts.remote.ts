import { error } from "@sveltejs/kit";
import { z } from "zod";
import { requireWriter } from "#lib/server/remote-auth.js";
import { AgentClientService } from "#lib/services/agent-client.service.js";
import { command } from "$app/server";

export const testAgentConnection = command(
	z.object({ agentToken: z.string().trim().min(1), agentUrl: z.url() }),
	async ({ agentToken, agentUrl }): Promise<void> => {
		requireWriter();
		try {
			await AgentClientService.verifyToken(agentUrl, agentToken);
		} catch (err) {
			error(
				502,
				err instanceof Error ? err.message : "Couldn't verify the agent.",
			);
		}
	},
);
