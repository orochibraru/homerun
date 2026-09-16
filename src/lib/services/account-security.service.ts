import { and, count, desc, eq, isNotNull } from "drizzle-orm";
import {
	type SecurityPolicy,
	type SecurityRequirement,
	type UserSecurityState,
	unmetSecurityRequirements,
} from "$lib/security-policy";
import { db } from "$lib/server/db/lib";
import { account, passkey, user } from "$lib/server/db/schema";

export interface PasskeySummary {
	backedUp: boolean;
	createdAt: Date | null;
	deviceType: string;
	id: string;
	name: string | null;
}

class AccountSecurityServiceClass {
	async listPasskeys(userId: string): Promise<PasskeySummary[]> {
		return await db
			.select({
				backedUp: passkey.backedUp,
				createdAt: passkey.createdAt,
				deviceType: passkey.deviceType,
				id: passkey.id,
				name: passkey.name,
			})
			.from(passkey)
			.where(eq(passkey.userId, userId))
			.orderBy(desc(passkey.createdAt));
	}

	async linkedAccounts(
		userId: string,
	): Promise<{ accountId: string; providerId: string }[]> {
		return await db
			.select({ accountId: account.accountId, providerId: account.providerId })
			.from(account)
			.where(eq(account.userId, userId));
	}

	async hasPassword(userId: string): Promise<boolean> {
		const [row] = await db
			.select({ id: account.id })
			.from(account)
			.where(
				and(
					eq(account.userId, userId),
					eq(account.providerId, "credential"),
					isNotNull(account.password),
				),
			)
			.limit(1);
		return !!row;
	}

	async state(userId: string): Promise<UserSecurityState> {
		const [[userRow], [passkeyRow]] = await Promise.all([
			db
				.select({ twoFactorEnabled: user.twoFactorEnabled })
				.from(user)
				.where(eq(user.id, userId))
				.limit(1),
			db
				.select({ total: count() })
				.from(passkey)
				.where(eq(passkey.userId, userId)),
		]);
		return {
			passkeyCount: passkeyRow?.total ?? 0,
			twoFactorEnabled: userRow?.twoFactorEnabled ?? false,
		};
	}

	async unmetRequirements(
		userId: string,
		policy: SecurityPolicy,
	): Promise<SecurityRequirement[]> {
		if (!(policy.requirePasskey || policy.requireTwoFactor)) {
			return [];
		}
		return unmetSecurityRequirements(policy, await this.state(userId));
	}
}

export const AccountSecurityService = new AccountSecurityServiceClass();
