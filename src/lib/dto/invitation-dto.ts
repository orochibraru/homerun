import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import type { Invitation, UserRole } from "$lib/server/db/schema";
import { invitation } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface InvitationCreateInput {
	email: string;
	invitedByUserId: string;
	role: UserRole;
}

/**
 * A pending admin-sent invite (Users page's "Send invite" action) — see
 * schema.ts's `invitation` table docstring. Unlike `user`, this table isn't
 * better-auth-owned, so it gets a normal DTO.
 */
export class InvitationDTO extends BaseDTO<Invitation> {
	/** Generates the token, deletes any existing pending invite for the same email first (one live invite per address). */
	static async create(input: InvitationCreateInput): Promise<InvitationDTO> {
		await db
			.delete(invitation)
			.where(
				and(eq(invitation.email, input.email), isNull(invitation.acceptedAt)),
			);

		const now = new Date();
		const row: Invitation = {
			acceptedAt: null,
			createdAt: now,
			email: input.email,
			expiresAt: new Date(now.getTime() + INVITE_EXPIRY_MS),
			id: crypto.randomUUID(),
			invitedByUserId: input.invitedByUserId,
			role: input.role,
			token: randomBytes(32).toString("hex"),
		};
		await db.insert(invitation).values(row);
		return new InvitationDTO(row);
	}

	/** Only an unaccepted, unexpired invite — the accept-invite page treats anything else as invalid. */
	static async getByToken(token: string): Promise<InvitationDTO | null> {
		const [row] = await db
			.select()
			.from(invitation)
			.where(eq(invitation.token, token))
			.limit(1);
		if (!row || row.acceptedAt || row.expiresAt < new Date()) {
			return null;
		}

		return new InvitationDTO(row as Invitation);
	}

	static async listPending(): Promise<InvitationDTO[]> {
		const rows = await db
			.select()
			.from(invitation)
			.where(isNull(invitation.acceptedAt));
		return rows.map((row) => new InvitationDTO(row as Invitation));
	}

	/** For the Users page's "cancel invite" action, which only has the id from the pending-invitations list, not a loaded instance. */
	static async deleteById(id: string): Promise<void> {
		await db.delete(invitation).where(eq(invitation.id, id));
	}

	async delete(): Promise<void> {
		await db.delete(invitation).where(eq(invitation.id, this.row.id));
	}

	async markAccepted(): Promise<void> {
		const acceptedAt = new Date();
		await db
			.update(invitation)
			.set({ acceptedAt })
			.where(eq(invitation.id, this.row.id));
		Object.assign(this.row, { acceptedAt });
	}
}
