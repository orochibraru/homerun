import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import {
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthRefreshToken,
} from "$lib/server/db/schema";

export interface AuthorizedApp {
	clientId: string;
	lastAuthorizedAt: Date | null;
	name: string;
	scopes: string[];
}

/** Splits better-auth's space-separated scope string, tolerating a JSON array too. */
function scopeList(value: string): string[] {
	const trimmed = value.trim();
	if (trimmed.startsWith("[")) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			return Array.isArray(parsed) ? parsed.map(String) : [];
		} catch {
			return [];
		}
	}
	return trimmed.split(/\s+/).filter(Boolean);
}

/**
 * One user's grants to the apps that use "Sign in with Homerun": the consent
 * rows plus the access and refresh tokens the OIDC provider issued. An app
 * counts as authorized while it has a consent or a live token, since a client
 * that skips the consent screen never records a consent at all.
 */
class OauthGrantDTOClass {
	/** The apps `userId` has authorized, most recently authorized first. */
	async listForUser(userId: string): Promise<AuthorizedApp[]> {
		const now = new Date();
		const live = <T extends typeof oauthAccessToken | typeof oauthRefreshToken>(
			table: T,
		) =>
			and(
				eq(table.userId, userId),
				isNull(table.revoked),
				or(isNull(table.expiresAt), gt(table.expiresAt, now)),
			);
		const [consents, refreshTokens, accessTokens] = await Promise.all([
			db
				.select({
					at: oauthConsent.updatedAt,
					clientId: oauthConsent.clientId,
					scopes: oauthConsent.scopes,
				})
				.from(oauthConsent)
				.where(eq(oauthConsent.userId, userId)),
			db
				.select({
					at: oauthRefreshToken.createdAt,
					clientId: oauthRefreshToken.clientId,
					scopes: oauthRefreshToken.scopes,
				})
				.from(oauthRefreshToken)
				.where(live(oauthRefreshToken)),
			db
				.select({
					at: oauthAccessToken.createdAt,
					clientId: oauthAccessToken.clientId,
					scopes: oauthAccessToken.scopes,
				})
				.from(oauthAccessToken)
				.where(live(oauthAccessToken)),
		]);

		const byClient = new Map<
			string,
			{ at: Date | null; scopes: Set<string> }
		>();
		for (const grant of [...consents, ...refreshTokens, ...accessTokens]) {
			const entry = byClient.get(grant.clientId) ?? {
				at: null,
				scopes: new Set<string>(),
			};
			for (const scope of scopeList(grant.scopes)) {
				entry.scopes.add(scope);
			}
			if (grant.at && (!entry.at || grant.at > entry.at)) {
				entry.at = grant.at;
			}
			byClient.set(grant.clientId, entry);
		}
		if (byClient.size === 0) {
			return [];
		}

		const clients = await db
			.select({ clientId: oauthClient.clientId, name: oauthClient.name })
			.from(oauthClient)
			.where(inArray(oauthClient.clientId, [...byClient.keys()]));
		const names = new Map(
			clients.map((client) => [client.clientId, client.name]),
		);
		return [...byClient.entries()]
			.map(([clientId, entry]) => ({
				clientId,
				lastAuthorizedAt: entry.at,
				name: names.get(clientId) ?? clientId,
				scopes: [...entry.scopes].sort(),
			}))
			.sort(
				(a, b) =>
					(b.lastAuthorizedAt?.getTime() ?? 0) -
					(a.lastAuthorizedAt?.getTime() ?? 0),
			);
	}

	/**
	 * Unlinks an app from `userId`: deletes the consent and every access and
	 * refresh token issued to that app for this user, so it can't call Homerun
	 * on their behalf again and the next sign-in asks for consent afresh.
	 */
	async revokeForUser(userId: string, clientId: string): Promise<void> {
		await db.transaction(async (tx) => {
			await tx
				.delete(oauthAccessToken)
				.where(
					and(
						eq(oauthAccessToken.userId, userId),
						eq(oauthAccessToken.clientId, clientId),
					),
				);
			await tx
				.delete(oauthRefreshToken)
				.where(
					and(
						eq(oauthRefreshToken.userId, userId),
						eq(oauthRefreshToken.clientId, clientId),
					),
				);
			await tx
				.delete(oauthConsent)
				.where(
					and(
						eq(oauthConsent.userId, userId),
						eq(oauthConsent.clientId, clientId),
					),
				);
		});
	}
}

export const OauthGrantDTO = new OauthGrantDTOClass();
