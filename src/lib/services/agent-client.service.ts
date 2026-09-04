import type { ContainerStatus } from "$lib/types";
import type { RegistryAuth } from "./docker/containers.ts";

/** Decrypted connection to a registered Homerun Agent : see remote-host-dto.ts's `toAgentConnection`. */
export interface AgentConnection {
	agentUrl: string;
	token: string;
}

class AgentRequestError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

export interface AgentDeployParams {
	containerPort: number | null;
	cpuLimit?: number | null;
	envVars: Record<string, string>;
	image: string;
	memoryLimitMb?: number | null;
	networkMode?: "bridge" | "host";
	portProtocol?: "tcp" | "udp" | "both";
	registryAuth?: RegistryAuth | null;
	restartPolicy: string;
	serviceId: string;
	// True when `image:tag` was just built on this same agent by `build()`
	// below rather than published anywhere : see agent/schemas.ts's
	// deployInputSchema docstring for why this has to skip the pull.
	skipPull?: boolean;
	slug: string;
	tag: string;
}

export interface AgentDeployResult {
	containerId: string;
	log: string[];
}

export interface AgentBuildPush {
	password: string;
	registryUrl: string;
	tag: string;
	username: string;
}

export interface AgentBuildParams {
	buildContext?: string | null;
	dockerfilePath?: string | null;
	gitRef?: string | null;
	gitUrl: string;
	push?: AgentBuildPush | null;
	tag: string;
}

export interface AgentBuildResult {
	error?: string;
	success: boolean;
}

/**
 * A thin HTTP client for a registered Homerun Agent (see agent/README.md).
 * Mirrors `docker/containers.ts`'s DockerService surface closely (deploy,
 * start/stop/restart/remove, inspectStatus, streamLogs) plus `build`
 * (`docker/git-build.ts`'s equivalent), so `deploy.service.ts` and the
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
	 * an authenticated route (`/v1/containers`, cheap and side-effect-free).
	 * Throws on an unreachable host, a 401 (bad token), or any other failure.
	 */
	async verifyToken(agentUrl: string, token: string): Promise<void> {
		const url = new URL("/v1/containers", agentUrl);
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

	/** POST /v1/deploy : pull (unless skipPull)/create/start, same shape as DockerService.createAndStartContainer + pullImage combined, just server-side on the agent. */
	deploy(
		connection: AgentConnection,
		params: AgentDeployParams,
	): Promise<AgentDeployResult> {
		return this.#request<AgentDeployResult>(connection, "POST", "/v1/deploy", {
			containerPort: params.containerPort,
			cpuLimit: params.cpuLimit ?? null,
			envVars: Object.entries(params.envVars).map(([key, value]) => ({
				key,
				value,
			})),
			image: params.image,
			memoryLimitMb: params.memoryLimitMb ?? null,
			networkMode: params.networkMode ?? "bridge",
			portProtocol: params.portProtocol ?? "tcp",
			registryAuth: params.registryAuth ?? null,
			restartPolicy: params.restartPolicy,
			serviceId: params.serviceId,
			skipPull: params.skipPull ?? false,
			slug: params.slug,
			tag: params.tag,
		});
	}

	/** POST /v1/build : clone + docker build on the agent itself, see agent/schemas.ts's buildInputSchema for the `push` tradeoff. No live progress streaming (same as `deploy`, a single JSON response once it's done, not an SSE/chunked stream). */
	build(
		connection: AgentConnection,
		params: AgentBuildParams,
	): Promise<AgentBuildResult> {
		return this.#request<AgentBuildResult>(connection, "POST", "/v1/build", {
			buildContext: params.buildContext ?? null,
			dockerfilePath: params.dockerfilePath ?? null,
			gitRef: params.gitRef ?? null,
			gitUrl: params.gitUrl,
			push: params.push ?? null,
			tag: params.tag,
		});
	}

	async startContainer(connection: AgentConnection, id: string): Promise<void> {
		await this.#request(
			connection,
			"POST",
			`/v1/containers/${encodeURIComponent(id)}/start`,
		);
	}

	async stopContainer(connection: AgentConnection, id: string): Promise<void> {
		await this.#request(
			connection,
			"POST",
			`/v1/containers/${encodeURIComponent(id)}/stop`,
		);
	}

	async restartContainer(
		connection: AgentConnection,
		id: string,
	): Promise<void> {
		await this.#request(
			connection,
			"POST",
			`/v1/containers/${encodeURIComponent(id)}/restart`,
		);
	}

	async removeContainer(
		connection: AgentConnection,
		id: string,
	): Promise<void> {
		await this.#request(
			connection,
			"DELETE",
			`/v1/containers/${encodeURIComponent(id)}`,
		);
	}

	async inspectStatus(
		connection: AgentConnection,
		id: string,
	): Promise<ContainerStatus> {
		try {
			const info = await this.#request<{
				exitCode: number | null;
				id: string;
				state: string;
				status: string;
			}>(connection, "GET", `/v1/containers/${encodeURIComponent(id)}`);
			if (info.state === "running") {
				return "running";
			}
			if (info.state === "created" || info.state === "restarting") {
				return "starting";
			}
			if (info.state === "exited" || info.state === "dead") {
				return info.exitCode === 0 ? "stopped" : "failed";
			}
			return "stopped";
		} catch (error) {
			return error instanceof AgentRequestError && error.status === 404
				? "missing"
				: "failed";
		}
	}

	/** GET /v1/containers/:id/logs, proxying the agent's own octet-stream response body straight through. */
	async streamLogs(
		connection: AgentConnection,
		id: string,
		follow: boolean,
	): Promise<ReadableStream<Uint8Array>> {
		const url = new URL(
			`/v1/containers/${encodeURIComponent(id)}/logs`,
			connection.agentUrl,
		);
		if (follow) {
			url.searchParams.set("follow", "true");
		}
		const response = await fetch(url, {
			headers: { authorization: `Bearer ${connection.token}` },
		});
		if (!(response.ok && response.body)) {
			throw new Error(
				`Agent returned ${response.status} while streaming logs.`,
			);
		}
		return response.body;
	}

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
