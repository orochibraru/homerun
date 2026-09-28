import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type NodeEnrollment, nodeEnrollment } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

const LIFETIME_MS = 60 * 60 * 1000;

/** What an enrollment turns the server into. */
export interface EnrollmentRoles {
	buildServer: boolean;
	swarmNode: boolean;
}

/** An enrollment as the Remote Hosts page shows it, without its token hash. */
export type NodeEnrollmentSummary = Omit<NodeEnrollment, "tokenHash">;

/** The stored form of an enrollment token. */
function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("base64url");
}

/**
 * Wraps `node_enrollment`: a one-time token an admin hands a fresh server so
 * it can register itself as a build server, a swarm node, or both. Only the
 * token's hash is stored; it expires after an hour and works once.
 */
export class NodeEnrollmentDTO extends BaseDTO<NodeEnrollment> {
	/**
	 * Starts an enrollment.
	 *
	 * @returns The enrollment and its plaintext token, which is never stored.
	 */
	static async create(
		input: EnrollmentRoles & { name: string | null; userId: string },
	): Promise<{ enrollment: NodeEnrollmentDTO; token: string }> {
		const token = `hrn_${randomBytes(24).toString("base64url")}`;
		const now = new Date();
		const row: NodeEnrollment = {
			buildServer: input.buildServer,
			createdAt: now,
			expiresAt: new Date(now.getTime() + LIFETIME_MS),
			hostname: null,
			id: crypto.randomUUID(),
			name: input.name,
			remoteHostId: null,
			swarmNode: input.swarmNode,
			tokenHash: hashToken(token),
			usedAt: null,
			userId: input.userId,
		};
		await db.insert(nodeEnrollment).values(row);
		return { enrollment: new NodeEnrollmentDTO(row), token };
	}

	/** The unused, unexpired enrollment `token` belongs to, null otherwise. */
	static async findUsable(token: string): Promise<NodeEnrollmentDTO | null> {
		const [row] = await db
			.select()
			.from(nodeEnrollment)
			.where(
				and(
					eq(nodeEnrollment.tokenHash, hashToken(token)),
					isNull(nodeEnrollment.usedAt),
					gt(nodeEnrollment.expiresAt, new Date()),
				),
			)
			.limit(1);
		return row ? new NodeEnrollmentDTO(row) : null;
	}

	/** Enrollments no server has used yet and that haven't expired, newest first. */
	static async listPending(): Promise<NodeEnrollmentDTO[]> {
		const rows = await db
			.select()
			.from(nodeEnrollment)
			.where(
				and(
					isNull(nodeEnrollment.usedAt),
					gt(nodeEnrollment.expiresAt, new Date()),
				),
			)
			.orderBy(desc(nodeEnrollment.createdAt));
		return rows.map((row) => new NodeEnrollmentDTO(row));
	}

	/** The enrollment with this id, null when there's none. */
	static async get(id: string): Promise<NodeEnrollmentDTO | null> {
		const [row] = await db
			.select()
			.from(nodeEnrollment)
			.where(eq(nodeEnrollment.id, id))
			.limit(1);
		return row ? new NodeEnrollmentDTO(row) : null;
	}

	/**
	 * Marks the enrollment used by `hostname`, only if nothing used it first.
	 *
	 * @returns Whether this call claimed it.
	 */
	async claim(hostname: string, remoteHostId: string | null): Promise<boolean> {
		const claimed = await db
			.update(nodeEnrollment)
			.set({ hostname, remoteHostId, usedAt: new Date() })
			.where(
				and(eq(nodeEnrollment.id, this.row.id), isNull(nodeEnrollment.usedAt)),
			)
			.returning({ id: nodeEnrollment.id });
		return claimed.length > 0;
	}

	/** Revokes the enrollment. */
	async delete(): Promise<void> {
		await db.delete(nodeEnrollment).where(eq(nodeEnrollment.id, this.row.id));
	}

	/** The roles the enrolled server takes on. */
	get roles(): EnrollmentRoles {
		return { buildServer: this.row.buildServer, swarmNode: this.row.swarmNode };
	}

	/** The row without its token hash. */
	summary(): NodeEnrollmentSummary {
		const { tokenHash: _hash, ...rest } = this.row;
		return rest;
	}
}
