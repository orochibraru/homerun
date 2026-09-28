import { desc, eq } from "drizzle-orm";
import {
	CLIENT_SECRET_MARKER,
	OIDC_TEST_CALLBACK_PATH,
} from "$lib/oidc-provider";
import { db } from "$lib/server/db/lib";
import { type OauthClient, oauthClient } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

/** A string-array column the auth adapter stores as JSON text, read back as a list. */
function jsonList(value: string | null): string[] {
	if (!value) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter((entry): entry is string => typeof entry === "string")
			: [];
	} catch {
		return [];
	}
}

export interface OauthClientSummary {
	clientId: string;
	confidential: boolean;
	createdAt: Date | null;
	disabled: boolean;
	enableEndSession: boolean;
	id: string;
	name: string;
	redirectUris: string[];
	requirePkce: boolean;
	scopes: string[];
	skipConsent: boolean;
	tokenAuthMethod: string;
}

/**
 * Wraps the `oauth_client` table: the apps registered to use "Sign in with
 * Homerun". Reads only; creating a client, changing it and rotating its
 * secret go through `OauthAppService`, since better-auth owns secret hashing
 * and field validation for those.
 */
export class OauthClientDTO extends BaseDTO<OauthClient> {
	/** Every registered app, newest first. */
	static async list(): Promise<OauthClientDTO[]> {
		const rows = await db
			.select()
			.from(oauthClient)
			.orderBy(desc(oauthClient.createdAt));
		return rows.map((row) => new OauthClientDTO(row));
	}

	/** The registered app with this row id, null when there's none. */
	static async get(id: string): Promise<OauthClientDTO | null> {
		const [row] = await db
			.select()
			.from(oauthClient)
			.where(eq(oauthClient.id, id))
			.limit(1);
		return row ? new OauthClientDTO(row) : null;
	}

	/** The registered app with this public client id, null when there's none. */
	static async getByClientId(clientId: string): Promise<OauthClientDTO | null> {
		const [row] = await db
			.select()
			.from(oauthClient)
			.where(eq(oauthClient.clientId, clientId))
			.limit(1);
		return row ? new OauthClientDTO(row) : null;
	}

	/**
	 * Points the client's `client_secret` at the `oauth_client_secret` table
	 * (`homerun-secrets:<client id>`), which `OauthClientSecretDTO.verify`
	 * reads, so its secrets can be several, per environment, and revoked one
	 * by one. Written here because better-auth would store a hash instead.
	 */
	static async useSecretTable(clientId: string): Promise<void> {
		await db
			.update(oauthClient)
			.set({
				clientSecret: `${CLIENT_SECRET_MARKER}${clientId}`,
				updatedAt: new Date(),
			})
			.where(eq(oauthClient.clientId, clientId));
	}

	/** Turns the app on or off; a disabled app can't start new sign-ins. */
	async setDisabled(disabled: boolean): Promise<void> {
		await db
			.update(oauthClient)
			.set({ disabled, updatedAt: new Date() })
			.where(eq(oauthClient.id, this.row.id));
		this.row.disabled = disabled;
	}

	/**
	 * Sets whether sign-ins must send a PKCE challenge. Written here rather
	 * than through better-auth, whose update endpoint doesn't take it. A public
	 * app always needs PKCE whatever this says.
	 */
	async setRequirePkce(requirePkce: boolean): Promise<void> {
		await db
			.update(oauthClient)
			.set({ requirePKCE: requirePkce, updatedAt: new Date() })
			.where(eq(oauthClient.id, this.row.id));
		this.row.requirePKCE = requirePkce;
	}

	/**
	 * Sets how a confidential app sends its secret to the token endpoint:
	 * `client_secret_basic` (HTTP Basic header) or `client_secret_post`
	 * (request body). The provider only accepts the registered one, and its
	 * update endpoint doesn't take it, so it's written here.
	 */
	async setTokenEndpointAuthMethod(
		method: "client_secret_basic" | "client_secret_post",
	): Promise<void> {
		await db
			.update(oauthClient)
			.set({ tokenEndpointAuthMethod: method, updatedAt: new Date() })
			.where(eq(oauthClient.id, this.row.id));
		this.row.tokenEndpointAuthMethod = method;
	}

	/**
	 * Deletes the app. Its tokens and consents cascade with it, so anyone
	 * signed in to it through Homerun loses access at their next token use.
	 */
	async delete(): Promise<void> {
		await db.delete(oauthClient).where(eq(oauthClient.id, this.row.id));
	}

	/** The row id. */
	get id(): string {
		return this.row.id;
	}

	/** The public client id apps are configured with. */
	get clientId(): string {
		return this.row.clientId;
	}

	/** The app's display name, falling back to its client id. */
	get name(): string {
		return this.row.name || this.row.clientId;
	}

	/** How the app authenticates at the token endpoint: `client_secret_basic`, `client_secret_post` or `none`. */
	get tokenEndpointAuthMethod(): string {
		return this.row.tokenEndpointAuthMethod ?? "client_secret_basic";
	}

	/** The plain, serializable view the admin pages render. */
	summary(): OauthClientSummary {
		return {
			clientId: this.row.clientId,
			confidential: this.row.tokenEndpointAuthMethod !== "none",
			createdAt: this.row.createdAt,
			disabled: this.row.disabled ?? false,
			enableEndSession: this.row.enableEndSession ?? false,
			id: this.row.id,
			name: this.name,
			redirectUris: jsonList(this.row.redirectUris).filter(
				(uri) => !uri.endsWith(OIDC_TEST_CALLBACK_PATH),
			),
			requirePkce: this.row.requirePKCE ?? true,
			scopes: jsonList(this.row.scopes),
			skipConsent: this.row.skipConsent ?? false,
			tokenAuthMethod: this.tokenEndpointAuthMethod,
		};
	}
}
