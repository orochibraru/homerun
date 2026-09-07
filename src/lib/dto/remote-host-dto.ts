import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type RemoteHost, remoteHost } from "$lib/server/db/schema";
import {
	type ListQuery,
	narrowFilter,
	type PagedResult,
	searchCondition,
} from "$lib/server/list-query";
import type { AgentConnection } from "$lib/services/agent-client.service";
import type { RemoteHostConnection } from "$lib/services/docker.service";
import { decryptSecret } from "$lib/services/secrets";
import { BaseDTO } from "./base-dto";

export interface NewRemoteHostInput {
	agentTokenEnc?: string | null;
	agentUrl?: string | null;
	dockerHost?: string | null;
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
		| "kind"
		| "name"
		| "tlsCaEnc"
		| "tlsCertEnc"
		| "tlsKeyEnc"
	>
>;

/** Where a git build actually runs : this host, a remote Docker daemon, or a Homerun Agent. */
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

	/** One page of `list`, searched/filtered server-side, plus the unpaged total. */
	static async listPaged(
		userId: string,
		query: ListQuery,
	): Promise<PagedResult<RemoteHostDTO>> {
		const conditions: SQL[] = [eq(remoteHost.userId, userId)];
		const search = searchCondition(query.q, [
			remoteHost.name,
			remoteHost.dockerHost,
			remoteHost.agentUrl,
		]);
		if (search) {
			conditions.push(search);
		}
		const kinds = narrowFilter(query.filters.kind, [
			"docker",
			"agent",
		] as const);
		if (kinds.length > 0) {
			conditions.push(inArray(remoteHost.kind, kinds));
		}
		const where = and(...conditions);

		const [rows, totals] = await Promise.all([
			db
				.select()
				.from(remoteHost)
				.where(where)
				.orderBy(desc(remoteHost.createdAt))
				.limit(query.limit)
				.offset(query.offset),
			db.select({ total: count() }).from(remoteHost).where(where),
		]);

		return {
			items: rows.map((row) => new RemoteHostDTO(row)),
			page: query.page,
			perPage: query.perPage,
			total: totals[0]?.total ?? 0,
		};
	}

	/** Every registered host, all of which are build servers : `kind: "docker"` (a raw dockerode `buildImage()`) and `kind: "agent"` (its own `POST /v1/build`) alike. */
	static listBuildServers(userId: string): Promise<RemoteHostDTO[]> {
		return RemoteHostDTO.list(userId);
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

	/** Row-only delete : services referencing this host as a build server have it cleared by the FK's onDelete: set null. */
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
	get kind(): RemoteHost["kind"] {
		return this.row.kind;
	}
	get agentUrl(): string | null {
		return this.row.agentUrl;
	}

	/** Resolves a build server id into the connection its build should run through. */
	static async resolveBuildTarget(
		hostId: string | null | undefined,
		userId: string,
	): Promise<RemoteExecutionTarget> {
		if (!hostId) {
			return { kind: "local" };
		}
		const host = await RemoteHostDTO.get(hostId, userId);
		if (!host) {
			throw new Error(`Build server ${hostId} not found.`);
		}
		if (host.kind === "agent") {
			const connection = host.toAgentConnection();
			if (!connection) {
				throw new Error(
					`Build server ${hostId} has no usable agent connection.`,
				);
			}
			return { connection, hostId, kind: "agent" };
		}
		return { connection: host.toConnection(), hostId, kind: "docker" };
	}
}
