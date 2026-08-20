import { and, desc, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type RemoteHost, remoteHost } from "$lib/server/db/schema";
import type { RemoteHostConnection } from "$lib/services/docker.service";
import { decryptSecret } from "$lib/services/secrets";
import { BaseDTO } from "./base-dto";

export interface NewRemoteHostInput {
	dockerHost: string;
	name: string;
	tlsCaEnc?: string | null;
	tlsCertEnc?: string | null;
	tlsKeyEnc?: string | null;
	userId: string;
}

export type RemoteHostUpdateInput = Partial<
	Pick<
		RemoteHost,
		"dockerHost" | "name" | "tlsCaEnc" | "tlsCertEnc" | "tlsKeyEnc"
	>
>;

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

	static async create(input: NewRemoteHostInput): Promise<RemoteHostDTO> {
		const now = new Date();
		const row: RemoteHost = {
			createdAt: now,
			dockerHost: input.dockerHost,
			id: crypto.randomUUID(),
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

	/** Decrypts the stored TLS material into what docker/client.ts's getDocker() expects. */
	toConnection(): RemoteHostConnection {
		return {
			dockerHost: this.row.dockerHost,
			id: this.row.id,
			tlsCa: this.row.tlsCaEnc ? decryptSecret(this.row.tlsCaEnc) : null,
			tlsCert: this.row.tlsCertEnc ? decryptSecret(this.row.tlsCertEnc) : null,
			tlsKey: this.row.tlsKeyEnc ? decryptSecret(this.row.tlsKeyEnc) : null,
		};
	}

	get id(): string {
		return this.row.id;
	}
	get name(): string {
		return this.row.name;
	}
	get dockerHost(): string {
		return this.row.dockerHost;
	}

	/**
	 * The connection to use for a service's docker operations : undefined
	 * for the local socket (remoteHostId unset, the default), or the
	 * decrypted remote connection otherwise. Every lifecycle action
	 * (start/stop/restart/logs/deploy) should route through this rather
	 * than assuming the local Docker socket, so remote-hosted services
	 * actually get reached on their own daemon.
	 */
	static async connectionFor(
		svc: { remoteHostId: string | null },
		userId: string,
	): Promise<RemoteHostConnection | undefined> {
		if (!svc.remoteHostId) {
			return;
		}
		const host = await RemoteHostDTO.get(svc.remoteHostId, userId);
		return host?.toConnection();
	}
}
