import { and, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import {
	type GitConnection,
	type GitProviderKind,
	gitConnection,
} from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

export interface NewGitConnectionInput {
	accessTokenEnc: string;
	expiresAt?: Date | null;
	providerId: string;
	providerKind: GitProviderKind;
	providerUsername: string;
	refreshTokenEnc?: string | null;
	userId: string;
}

export type GitConnectionUpdateInput = Partial<
	Pick<
		GitConnection,
		"accessTokenEnc" | "expiresAt" | "providerUsername" | "refreshTokenEnc"
	>
>;

/** Wraps the `git_connection` table : one user's OAuth connection to one configured git provider, see schema.ts's docstring. */
export class GitConnectionDTO extends BaseDTO<GitConnection> {
	static async listForUser(userId: string): Promise<GitConnectionDTO[]> {
		const rows = await db
			.select()
			.from(gitConnection)
			.where(eq(gitConnection.userId, userId));
		return rows.map((row) => new GitConnectionDTO(row));
	}

	static async getForUserAndProvider(
		userId: string,
		providerId: string,
	): Promise<GitConnectionDTO | null> {
		const [row] = await db
			.select()
			.from(gitConnection)
			.where(
				and(
					eq(gitConnection.userId, userId),
					eq(gitConnection.providerId, providerId),
				),
			)
			.limit(1);
		return row ? new GitConnectionDTO(row) : null;
	}

	/** Creates a new connection, or replaces the existing one for this user+provider (reconnecting). */
	static async upsert(input: NewGitConnectionInput): Promise<GitConnectionDTO> {
		const existing = await GitConnectionDTO.getForUserAndProvider(
			input.userId,
			input.providerId,
		);
		if (existing) {
			await existing.update({
				accessTokenEnc: input.accessTokenEnc,
				expiresAt: input.expiresAt ?? null,
				providerUsername: input.providerUsername,
				refreshTokenEnc: input.refreshTokenEnc ?? null,
			});
			return existing;
		}

		const now = new Date();
		const row: GitConnection = {
			accessTokenEnc: input.accessTokenEnc,
			createdAt: now,
			expiresAt: input.expiresAt ?? null,
			id: crypto.randomUUID(),
			providerId: input.providerId,
			providerKind: input.providerKind,
			providerUsername: input.providerUsername,
			refreshTokenEnc: input.refreshTokenEnc ?? null,
			updatedAt: now,
			userId: input.userId,
		};
		await db.insert(gitConnection).values(row);
		return new GitConnectionDTO(row);
	}

	async update(input: GitConnectionUpdateInput): Promise<void> {
		await db
			.update(gitConnection)
			.set(input)
			.where(eq(gitConnection.id, this.row.id));
		Object.assign(this.row, input);
	}

	async delete(): Promise<void> {
		await db.delete(gitConnection).where(eq(gitConnection.id, this.row.id));
	}

	get id(): string {
		return this.row.id;
	}
	get providerId(): string {
		return this.row.providerId;
	}
	get providerKind(): GitProviderKind {
		return this.row.providerKind;
	}
	get providerUsername(): string {
		return this.row.providerUsername;
	}
	get accessTokenEnc(): string {
		return this.row.accessTokenEnc;
	}
	get refreshTokenEnc(): string | null {
		return this.row.refreshTokenEnc;
	}
	get expiresAt(): Date | null {
		return this.row.expiresAt;
	}
}
