import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import {
	type EnrollmentRoles,
	NodeEnrollmentDTO,
} from "#lib/dto/node-enrollment-dto.js";
import { RemoteHostDTO } from "#lib/dto/remote-host-dto.js";
import { Logger } from "#lib/logger.js";
import { AgentClientService } from "./agent-client.service.ts";
import { DockerService } from "./docker.service.ts";
import { encryptSecret } from "./secrets.ts";

const logger = new Logger("NodeEnrollment");

/** What a server sends when it enrolls itself. */
export interface EnrollRequest {
	agentToken?: string;
	agentUrl?: string;
	hostname: string;
	token: string;
}

/** What the enrolling server gets back. */
export interface EnrollResponse {
	remoteHostId: string | null;
	swarm: { managerAddress: string; token: string } | null;
}

/** An enrollment refused, with the HTTP status the endpoint answers. */
export class EnrollError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/**
 * Turns a fresh server into capacity: it runs the install script the Remote
 * Hosts page hands out, which installs the worker in agent mode and calls
 * back here with the one-time enrollment token. A build-server enrollment
 * registers the agent as a remote host; a swarm-node enrollment answers with
 * the join token the script joins this instance's swarm with.
 */
class NodeEnrollmentServiceClass {
	/**
	 * What an enrollment will make the server, without using it up, so the
	 * install script knows what to install before it registers.
	 *
	 * @throws EnrollError when the token is unusable, or it asks for a swarm
	 * node while this instance isn't in swarm mode.
	 */
	async plan(token: string): Promise<EnrollmentRoles> {
		const enrollment = await this.#usable(token);
		if (enrollment.roles.swarmNode) {
			await this.#swarmJoin();
		}
		return enrollment.roles;
	}

	/**
	 * Checks everything first and claims the token last, so a server whose
	 * agent isn't reachable yet can rerun the script with the same token.
	 *
	 * @throws EnrollError when the token is unknown, used or expired, the
	 * agent can't be verified, or swarm mode is off on this instance.
	 */
	async enroll(request: EnrollRequest): Promise<EnrollResponse> {
		const enrollment = await this.#usable(request.token);
		const { buildServer, swarmNode } = enrollment.roles;
		const swarm = swarmNode ? await this.#swarmJoin() : null;
		if (buildServer) {
			await this.#verifyAgent(request);
		}
		const row = enrollment.toJSON();
		const host = buildServer
			? await RemoteHostDTO.create({
					agentTokenEnc: encryptSecret(request.agentToken as string),
					agentUrl: request.agentUrl as string,
					kind: "agent",
					name: row.name || request.hostname,
					userId: row.userId,
				})
			: null;
		if (!(await enrollment.claim(request.hostname, host?.id ?? null))) {
			await host?.delete();
			throw new EnrollError(409, "Another server used this token first.");
		}
		logger.info(
			`Server enrolled: host=${request.hostname} buildServer=${buildServer} swarmNode=${swarmNode}`,
		);
		return { remoteHostId: host?.id ?? null, swarm };
	}

	/** The enrollment behind a token, when it can still be used. */
	async #usable(token: string): Promise<NodeEnrollmentDTO> {
		const enrollment = await NodeEnrollmentDTO.findUsable(token);
		if (!enrollment) {
			throw new EnrollError(
				401,
				"This enrollment token is unknown, already used or expired. Generate a new command from Remote Hosts.",
			);
		}
		return enrollment;
	}

	/** Verifies the agent the script installed answers with its token. */
	async #verifyAgent(request: EnrollRequest): Promise<void> {
		if (!(request.agentUrl && request.agentToken)) {
			throw new EnrollError(
				400,
				"This enrollment makes the server a build server, but no agent URL and token were sent.",
			);
		}
		if (!URL.canParse(request.agentUrl)) {
			throw new EnrollError(400, `${request.agentUrl} isn't a URL.`);
		}
		try {
			await AgentClientService.verifyToken(
				request.agentUrl,
				request.agentToken,
			);
		} catch (error) {
			throw new EnrollError(
				502,
				`${error instanceof Error ? error.message : String(error)} Check that this instance can reach port 7420 on the server.`,
			);
		}
	}

	/** The join token and address, when this instance runs in swarm mode. */
	async #swarmJoin(): Promise<EnrollResponse["swarm"]> {
		const settings = await InstanceSettingsDTO.get();
		if (settings.orchestrationMode !== "swarm") {
			throw new EnrollError(
				409,
				"This instance isn't in swarm mode. Switch Settings → Docker to Swarm first.",
			);
		}
		return await DockerService.swarmJoinInfo();
	}
}

export const NodeEnrollmentService = new NodeEnrollmentServiceClass();
