import { eq } from "drizzle-orm";
import {
	accountProviderIdFor,
	emailMatchesPattern,
	methodForAccountProviderId,
} from "$lib/auth-providers";
import type { ServiceDTO } from "$lib/dto/service-dto";
import { db } from "$lib/server/db/lib";
import {
	account as accountTable,
	user as userTable,
} from "$lib/server/db/schema";

const GROUP_CLAIMS = ["groups", "roles", "grp"];

export type AccessDenialReason =
	| "no-method-configured"
	| "method-not-linked"
	| "user-not-allowed"
	| "email-not-allowed"
	| "group-not-allowed";

export interface AccessDecision {
	allowed: boolean;
	reason?: AccessDenialReason;
}

export const ACCESS_DENIAL_MESSAGES: Record<AccessDenialReason, string> = {
	"email-not-allowed": "Your email address isn't on this app's allowed list.",
	"group-not-allowed":
		"Your identity provider didn't return a group this app allows.",
	"method-not-linked":
		"Your account isn't linked to a sign-in method this app accepts.",
	"no-method-configured":
		"This app has no sign-in method configured yet, so nobody can be let through. An admin needs to pick one on its Networking tab.",
	"user-not-allowed": "You're not on this app's allowed user list.",
};

function decodeJwtClaims(token: string): Record<string, unknown> | null {
	const parts = token.split(".");
	if (parts.length < 2) {
		return null;
	}
	try {
		const parsed = JSON.parse(
			Buffer.from(parts[1], "base64url").toString("utf8"),
		) as unknown;
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function collectStrings(value: unknown, into: Set<string>): void {
	if (typeof value === "string") {
		into.add(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			collectStrings(entry, into);
		}
	}
}

export function groupsFromIdToken(idToken: string): Set<string> {
	const groups = new Set<string>();
	const claims = decodeJwtClaims(idToken);
	if (!claims) {
		return groups;
	}
	for (const claim of GROUP_CLAIMS) {
		collectStrings(claims[claim], groups);
	}
	const realmAccess = claims.realm_access;
	if (realmAccess && typeof realmAccess === "object") {
		collectStrings((realmAccess as Record<string, unknown>).roles, groups);
	}
	const resourceAccess = claims.resource_access;
	if (resourceAccess && typeof resourceAccess === "object") {
		for (const entry of Object.values(
			resourceAccess as Record<string, unknown>,
		)) {
			if (entry && typeof entry === "object") {
				collectStrings((entry as Record<string, unknown>).roles, groups);
			}
		}
	}
	return groups;
}

interface LinkedAccount {
	idToken: string | null;
	providerId: string;
}

function groupsAcross(accounts: LinkedAccount[]): Set<string> {
	const groups = new Set<string>();
	for (const entry of accounts) {
		if (!entry.idToken) {
			continue;
		}
		for (const group of groupsFromIdToken(entry.idToken)) {
			groups.add(group);
		}
	}
	return groups;
}

function emailAllowed(svc: ServiceDTO, email: string): boolean {
	return (
		svc.authAllowedEmails.length === 0 ||
		svc.authAllowedEmails.some((pattern) => emailMatchesPattern(email, pattern))
	);
}

class AppAccessServiceClass {
	async evaluate(svc: ServiceDTO, userId: string): Promise<AccessDecision> {
		if (svc.authProviders.length === 0) {
			return { allowed: false, reason: "no-method-configured" };
		}
		if (
			svc.authAllowedUserIds.length > 0 &&
			!svc.authAllowedUserIds.includes(userId)
		) {
			return { allowed: false, reason: "user-not-allowed" };
		}

		const [account, linked] = await Promise.all([
			this.#emailFor(userId),
			this.#linkedAccounts(svc, userId),
		]);
		if (!account) {
			return { allowed: false, reason: "user-not-allowed" };
		}
		if (!emailAllowed(svc, account)) {
			return { allowed: false, reason: "email-not-allowed" };
		}
		if (linked.length === 0) {
			return { allowed: false, reason: "method-not-linked" };
		}
		if (svc.authAllowedGroups.length > 0) {
			const groups = groupsAcross(linked);
			if (!svc.authAllowedGroups.some((group) => groups.has(group))) {
				return { allowed: false, reason: "group-not-allowed" };
			}
		}
		return { allowed: true };
	}

	async linkedMethods(userId: string): Promise<string[]> {
		const accounts = await db
			.select({ providerId: accountTable.providerId })
			.from(accountTable)
			.where(eq(accountTable.userId, userId));
		return [
			...new Set(accounts.map((a) => methodForAccountProviderId(a.providerId))),
		];
	}

	async #emailFor(userId: string): Promise<string | null> {
		const [row] = await db
			.select({ email: userTable.email })
			.from(userTable)
			.where(eq(userTable.id, userId))
			.limit(1);
		return row?.email ?? null;
	}

	async #linkedAccounts(
		svc: ServiceDTO,
		userId: string,
	): Promise<LinkedAccount[]> {
		const allowed = new Set(svc.authProviders.map(accountProviderIdFor));
		const accounts = await db
			.select({
				idToken: accountTable.idToken,
				providerId: accountTable.providerId,
			})
			.from(accountTable)
			.where(eq(accountTable.userId, userId));
		return accounts.filter((a) => allowed.has(a.providerId));
	}
}

export const AppAccessService = new AppAccessServiceClass();
