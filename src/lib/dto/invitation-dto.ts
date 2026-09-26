import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Role } from "$lib/permissions";
import { db } from "$lib/server/db/lib";
import type { Invitation, UserRole } from "$lib/server/db/schema";
import { invitation } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Whether an invite can still be accepted : not accepted yet and not past its expiry. */
export function isInviteLive(
	row: Pick<Invitation, "acceptedAt" | "expiresAt">,
	now: Date = new Date(),
): boolean {
	return !row.acceptedAt && row.expiresAt > now;
}

export interface InvitationCreateInput {
	email: string;
	invitedByUserId: string;
	role: Role;
}

/**
 * A pending admin-sent invite (Users page's "Send invite" action) : see
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
			role: input.role as UserRole,
			token: randomBytes(32).toString("hex"),
		};
		await db.insert(invitation).values(row);
		return new InvitationDTO(row);
	}

	/** Only an unaccepted, unexpired invite : the accept-invite page treats anything else as invalid. */
	static async getByToken(token: string): Promise<InvitationDTO | null> {
		const [row] = await db
			.select()
			.from(invitation)
			.where(eq(invitation.token, token))
			.limit(1);
		if (!(row && isInviteLive(row))) {
			return null;
		}

		return new InvitationDTO(row as Invitation);
	}

	/** Every invite that can still be accepted : not accepted and not expired, the same rule `getByToken` applies. */
	static async listPending(): Promise<InvitationDTO[]> {
		const now = new Date();
		const rows = await db
			.select()
			.from(invitation)
			.where(and(isNull(invitation.acceptedAt), gt(invitation.expiresAt, now)));
		return rows.map((row) => new InvitationDTO(row as Invitation));
	}

	/** For the Users page's "cancel invite" action, which only has the id from the pending-invitations list, not a loaded instance. */
	static async deleteById(id: string): Promise<void> {
		await db.delete(invitation).where(eq(invitation.id, id));
	}

	/** Deletes this invite row. */
	async delete(): Promise<void> {
		await db.delete(invitation).where(eq(invitation.id, this.row.id));
	}

	/** Stamps the invite as accepted now, so its token stops working. */
	async markAccepted(): Promise<void> {
		const acceptedAt = new Date();
		await db
			.update(invitation)
			.set({ acceptedAt })
			.where(eq(invitation.id, this.row.id));
		Object.assign(this.row, { acceptedAt });
	}
}
