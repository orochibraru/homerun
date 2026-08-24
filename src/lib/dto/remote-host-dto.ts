import { and, desc, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type RemoteHost, remoteHost } from "$lib/server/db/schema";
import type { AgentConnection } from "$lib/services/agent-client.service";
import type { RemoteHostConnection } from "$lib/services/docker.service";
import { decryptSecret } from "$lib/services/secrets";
import { BaseDTO } from "./base-dto";

export interface NewRemoteHostInput {
	agentTokenEnc?: string | null;
	agentUrl?: string | null;
	dockerHost?: string | null;
	isBuildServer?: boolean;
	kind?: RemoteHost["kind"];
	name: string;
	tlsCaEnc?: string | null;
	tlsCertEnc?: string | null;
	tlsKeyEnc?: string | null;
	userId: string;
}

export type RemoteHostUpdateInput = Partial<
	Pick<
		RemoteHost,
		| "agentTokenEnc"
		| "agentUrl"
		| "dockerHost"
		| "isBuildServer"
		| "kind"
		| "name"
		| "tlsCaEnc"
		| "tlsCertEnc"
		| "tlsKeyEnc"
	>
>;

/**
 * Where a service's docker-or-agent operation should actually run : see
 * `RemoteHostDTO.resolveTarget`. `hostId` is carried on the non-local
 * variants so a caller can tell two remote targets apart (e.g. "is the
 * build server the same host as the deploy target") without a second
 * lookup.
 */
export type RemoteExecutionTarget =
	| { kind: "local" }
	| { connection: RemoteHostConnection; hostId: string; kind: "docker" }
	| { connection: AgentConnection; hostId: string; kind: "agent" };

/** Wraps the `remote_host` table : see ServiceDTO for the pattern this follows. */
export class RemoteHostDTO extends BaseDTO<RemoteHost> {
	static async get(id: string, userId: string): Promise<RemoteHostDTO | null> {
		const [row] = await db
			.select()
			.from(remoteHost)
			.where(and(eq(remoteHost.id, id), eq(remoteHost.userId, userId)))
			.limit(1);
		return row ? new RemoteHostDTO(row) : null;
	}

	static async list(userId: string): Promise<RemoteHostDTO[]> {
		const rows = await db
			.select()
			.from(remoteHost)
			.where(eq(remoteHost.userId, userId))
			.orderBy(desc(remoteHost.createdAt));
		return rows.map((row) => new RemoteHostDTO(row));
	}

	/**
	 * Every host usable as a service's deploy target, `kind: "docker"` *and*
	 * `kind: "agent"` alike : both now route through `resolveTarget`/
	 * `service-lifecycle.service.ts`/`deploy.service.ts` (see
	 * remote_host.kind's docstring in schema.ts). Use this instead of
	 * `list()` in any deploy-target picker, still narrower than the bare
	 * list since a future non-deployable host kind shouldn't automatically
	 * show up here.
	 */
	static async listDeployTargets(userId: string): Promise<RemoteHostDTO[]> {
		const rows = await db
			.select()
			.from(remoteHost)
			.where(eq(remoteHost.userId, userId))
			.orderBy(desc(remoteHost.createdAt));
		return rows.map((row) => new RemoteHostDTO(row));
	}

	/** Hosts opted in as a dedicated build server (Source tab's "Build server" picker), for this user : `kind: "docker"` (a raw dockerode `buildImage()`) and `kind: "agent"` (its own `POST /v1/build`) alike. */
	static async listBuildServers(userId: string): Promise<RemoteHostDTO[]> {
		const rows = await db
			.select()
			.from(remoteHost)
			.where(
				and(eq(remoteHost.userId, userId), eq(remoteHost.isBuildServer, true)),
			)
			.orderBy(desc(remoteHost.createdAt));
		return rows.map((row) => new RemoteHostDTO(row));
	}

	static async create(input: NewRemoteHostInput): Promise<RemoteHostDTO> {
		const now = new Date();
		const kind = input.kind ?? "docker";
		const row: RemoteHost = {
			agentTokenEnc: input.agentTokenEnc ?? null,
			agentUrl: input.agentUrl ?? null,
			createdAt: now,
			dockerHost: input.dockerHost ?? null,
			id: crypto.randomUUID(),
			isBuildServer: input.isBuildServer ?? false,
			kind,
			name: input.name,
			tlsCaEnc: input.tlsCaEnc ?? null,
			tlsCertEnc: input.tlsCertEnc ?? null,
			tlsKeyEnc: input.tlsKeyEnc ?? null,
			updatedAt: now,
			userId: input.userId,
		};
		await db.insert(remoteHost).values(row);
		return new RemoteHostDTO(row);
	}

	async update(input: RemoteHostUpdateInput): Promise<void> {
		await db
			.update(remoteHost)
			.set(input)
			.where(eq(remoteHost.id, this.row.id));
		Object.assign(this.row, input);
	}

	/** Row-only delete : services referencing this host have their remoteHostId cleared by the FK's onDelete: set null. */
	async delete(): Promise<void> {
		await db.delete(remoteHost).where(eq(remoteHost.id, this.row.id));
	}

	/** Decrypts the stored TLS material into what docker/client.ts's getDocker() expects. Only meaningful for `kind: "docker"`. */
	toConnection(): RemoteHostConnection {
		return {
			dockerHost: this.row.dockerHost ?? "",
			id: this.row.id,
			tlsCa: this.row.tlsCaEnc ? decryptSecret(this.row.tlsCaEnc) : null,
			tlsCert: this.row.tlsCertEnc ? decryptSecret(this.row.tlsCertEnc) : null,
			tlsKey: this.row.tlsKeyEnc ? decryptSecret(this.row.tlsKeyEnc) : null,
		};
	}

	/** Decrypts the stored agent token into what agent-client.service.ts expects. Only meaningful for `kind: "agent"`. */
	toAgentConnection(): AgentConnection | null {
		const { agentTokenEnc, agentUrl, kind } = this.row;
		if (kind !== "agent" || !agentUrl || !agentTokenEnc) {
			return null;
		}
		const token = decryptSecret(agentTokenEnc);
		if (!token) {
			return null;
		}
		return { agentUrl, token };
	}

	get id(): string {
		return this.row.id;
	}
	get name(): string {
		return this.row.name;
	}
	get dockerHost(): string | null {
		return this.row.dockerHost;
	}
	get isBuildServer(): boolean {
		return this.row.isBuildServer;
	}
	get kind(): RemoteHost["kind"] {
		return this.row.kind;
	}
	get agentUrl(): string | null {
		return this.row.agentUrl;
	}

	/**
	 * The raw dockerode connection for a service's *docker-only* operations
	 * (the web Terminal's exec, custom SSL file sync, network/volume
	 * plumbing) : undefined for the local socket or an agent-backed host
	 * alike, since neither has a dockerode-reachable daemon (the local
	 * socket case is handled by `getDocker()`'s own no-argument default, an
	 * agent case genuinely has no raw socket to hand back at all, by
	 * design, see remote_host.kind's docstring in schema.ts). For anything
	 * that *is* agent-capable (deploy, start/stop/restart/remove/logs,
	 * status sync, see `resolveTarget` below and `service-lifecycle.service.ts`),
	 * use that instead : this method staying docker-only is what keeps a
	 * genuinely-docker-only feature from being handed a connection shape it
	 * can't do anything with.
	 */
	static async connectionFor(
		svc: { remoteHostId: string | null },
		userId: string,
	): Promise<RemoteHostConnection | undefined> {
		if (!svc.remoteHostId) {
			return;
		}
		const host = await RemoteHostDTO.get(svc.remoteHostId, userId);
		if (host?.kind !== "docker") {
			return;
		}
		return host.toConnection();
	}

	/**
	 * The execution target for a service's docker-*or-agent* operations :
	 * `resolveTarget(svc.remoteHostId, userId)` for the deploy target,
	 * `resolveTarget(svc.buildServerRemoteHostId, userId)` for the build
	 * server (same shape, either field works, both are just "a
	 * remoteHostId or null"). `service-lifecycle.service.ts` and
	 * `deploy.service.ts` are the two consumers : anything that can
	 * meaningfully run against an agent, not just a raw Docker daemon,
	 * should resolve through this rather than `connectionFor` above.
	 */
	static async resolveTarget(
		hostId: string | null | undefined,
		userId: string,
	): Promise<RemoteExecutionTarget> {
		if (!hostId) {
			return { kind: "local" };
		}
		const host = await RemoteHostDTO.get(hostId, userId);
		if (!host) {
			// Shouldn't happen (the FK would already have nulled this out on
			// delete), but never silently hand back a local-socket fallback
			// for a hostId that doesn't resolve : local() would be a real
			// mismatch, better to surface a clear error at the call site.
			throw new Error(`Remote host ${hostId} not found.`);
		}
		if (host.kind === "agent") {
			const connection = host.toAgentConnection();
			if (!connection) {
				throw new Error(
					`Remote host ${hostId} has no usable agent connection.`,
				);
			}
			return { connection, hostId, kind: "agent" };
		}
		return { connection: host.toConnection(), hostId, kind: "docker" };
	}
}
