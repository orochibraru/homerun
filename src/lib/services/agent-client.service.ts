import type { BuildMethod } from "$lib/build-methods";
import type { GitCredential } from "$lib/git-clone-url";

/** Decrypted connection to a registered Homerun Agent : see remote-host-dto.ts's `toAgentConnection`. */
export interface AgentConnection {
	agentUrl: string;
	token: string;
}

class AgentRequestError extends Error {
	status: number;

	/** An error thrown by `#request` for a non-2xx agent response, carrying the HTTP status alongside the message. */
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

export interface AgentBuildPush {
	password: string;
	registryUrl: string;
	tag: string;
	username: string;
}

export interface AgentBuildParams {
	bakeFile?: string | null;
	bakeTarget?: string | null;
	buildContext?: string | null;
	buildMethod?: BuildMethod | null;
	commit?: string | null;
	credential?: GitCredential | null;
	dockerfilePath?: string | null;
	gitRef?: string | null;
	gitUrl: string;
	push?: AgentBuildPush | null;
	tag: string;
}

export interface AgentBuildResult {
	commit?: string | null;
	error?: string;
	success: boolean;
}

/**
 * A thin HTTP client for a registered Homerun Agent (see agent/README.md).
 * Mirrors `docker/containers.ts`'s DockerService surface closely (deploy,
 * start/stop/restart/remove, inspectStatus, streamLogs) plus `build`
 * (the Go worker's own build step), so `deploy.service.ts` and the
 * various lifecycle call sites (see `service-lifecycle.service.ts`) can
 * treat an agent-backed remote host as a real deploy target/build server
 * instead of the "registered and health-checked, but not usable" state
 * this used to be in (see remote_host.kind's docstring in schema.ts).
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

	/** POST /v1/build : clone + docker build on the agent itself, see agent/schemas.ts's buildInputSchema for the `push` tradeoff. No live progress streaming (same as `deploy`, a single JSON response once it's done, not an SSE/chunked stream). */
	build(
		connection: AgentConnection,
		params: AgentBuildParams,
	): Promise<AgentBuildResult> {
		return this.#request<AgentBuildResult>(connection, "POST", "/v1/build", {
			bakeFile: params.bakeFile ?? null,
			bakeTarget: params.bakeTarget ?? null,
			buildContext: params.buildContext ?? null,
			buildMethod: params.buildMethod ?? "dockerfile",
			commit: params.commit ?? null,
			credential: params.credential ?? null,
			dockerfilePath: params.dockerfilePath ?? null,
			gitRef: params.gitRef ?? null,
			gitUrl: params.gitUrl,
			push: params.push ?? null,
			tag: params.tag,
		});
	}

	/**
	 * Shared fetch plumbing for every authenticated agent call: bearer auth,
	 * a longer timeout when a body is sent (a build/deploy can run for
	 * minutes with no progress streaming, see `build`), and translating a
	 * JSON `{ error }` body or non-2xx status into an `AgentRequestError`.
	 * @throws `AgentRequestError` on a non-2xx response, or a plain `Error`
	 * if the agent can't be reached at all.
	 */
	async #request<T>(
		connection: AgentConnection,
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const url = new URL(path, connection.agentUrl);
		let response: Response;
		try {
			response = await fetch(url, {
				body: body !== undefined ? JSON.stringify(body) : undefined,
				headers: {
					authorization: `Bearer ${connection.token}`,
					...(body !== undefined ? { "content-type": "application/json" } : {}),
				},
				method,
				signal: AbortSignal.timeout(
					body !== undefined ? 15 * 60 * 1000 : 15_000,
				),
			});
		} catch (error) {
			throw new Error(
				`Couldn't reach the agent at ${connection.agentUrl} : ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		const data = await response.json().catch(() => null);
		if (!response.ok) {
			const message =
				data && typeof data === "object" && "error" in data
					? String((data as { error: unknown }).error)
					: `Agent returned ${response.status}.`;
			throw new AgentRequestError(message, response.status);
		}
		return data as T;
	}
}

export const AgentClientService = new AgentClientServiceClass();
