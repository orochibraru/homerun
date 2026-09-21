/** Decrypted connection to a registered agent-mode Homerun worker : see remote-host-dto.ts's `toAgentConnection`. */
export interface AgentConnection {
	agentUrl: string;
	token: string;
}

/**
 * The app's side of a registered remote build host, the Homerun worker in
 * agent mode (see cmd/worker/README.md): the health and token checks the
 * Remote Hosts pages run. Builds on that host go through the local worker's
 * deploy job, not through here.
 */
class AgentClientServiceClass {
	/** GET /v1/health, unauthenticated. Throws with a human-readable message on any failure. */
	async checkHealth(
		agentUrl: string,
	): Promise<{ status: string; version: string }> {
		const url = new URL("/v1/health", agentUrl);
		let response: Response;
		try {
			response = await fetch(url, { signal: AbortSignal.timeout(5000) });
		} catch (error) {
			throw new Error(
				`Couldn't reach the agent at ${agentUrl} : ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (!response.ok) {
			throw new Error(`Agent health check returned ${response.status}.`);
		}
		return response.json();
	}

	/**
	 * Confirms the bearer token is actually accepted by the agent, by hitting
	 * an authenticated route (`/v1/stats`, cheap and side-effect-free).
	 * Throws on an unreachable host, a 401 (bad token), or any other failure.
	 */
	async verifyToken(agentUrl: string, token: string): Promise<void> {
		const url = new URL("/v1/stats", agentUrl);
		let response: Response;
		try {
			response = await fetch(url, {
				headers: { authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(5000),
			});
		} catch (error) {
			throw new Error(
				`Couldn't reach the agent at ${agentUrl} : ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (response.status === 401) {
			throw new Error("The agent rejected this token.");
		}
		if (!response.ok) {
			throw new Error(
				`Agent returned ${response.status} while verifying the token.`,
			);
		}
	}
}

export const AgentClientService = new AgentClientServiceClass();
