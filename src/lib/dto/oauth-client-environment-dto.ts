import { and, asc, eq } from "drizzle-orm";
import { db } from "#lib/server/db/lib.js";
import {
	type OauthClientEnvironment,
	oauthClientEnvironment,
} from "#lib/server/db/schema.js";
import { BaseDTO } from "./base-dto";

export interface EnvironmentInput {
	allowedOrigins: string[];
	allowLocalhost: boolean;
	name: string;
	redirectUris: string[];
}

/**
 * Wraps `oauth_client_environment`: one of an app's environments
 * (production, staging, development…), each with its own callback URLs,
 * authorized origins and whether it may use localhost. A client secret
 * belongs to one environment and only redeems codes sent to its callbacks.
 */
export class OauthClientEnvironmentDTO extends BaseDTO<OauthClientEnvironment> {
	/** Every environment of a client, oldest first. */
	static async listForClient(
		clientId: string,
	): Promise<OauthClientEnvironmentDTO[]> {
		const rows = await db
			.select()
			.from(oauthClientEnvironment)
			.where(eq(oauthClientEnvironment.clientId, clientId))
			.orderBy(asc(oauthClientEnvironment.createdAt));
		return rows.map((row) => new OauthClientEnvironmentDTO(row));
	}

	/** One environment of a client, null when it isn't that client's. */
	static async get(
		clientId: string,
		id: string,
	): Promise<OauthClientEnvironmentDTO | null> {
		const [row] = await db
			.select()
			.from(oauthClientEnvironment)
			.where(
				and(
					eq(oauthClientEnvironment.clientId, clientId),
					eq(oauthClientEnvironment.id, id),
				),
			)
			.limit(1);
		return row ? new OauthClientEnvironmentDTO(row) : null;
	}

	/** Every environment of every client that lists `origin` as authorized, for answering a CORS preflight. */
	static async anyAllowsOrigin(origin: string): Promise<boolean> {
		const rows = await db
			.select({ allowedOrigins: oauthClientEnvironment.allowedOrigins })
			.from(oauthClientEnvironment);
		return rows.some((row) => row.allowedOrigins.includes(origin));
	}

	/**
	 * Adds an environment to a client.
	 *
	 * @throws When the client already has an environment with that name.
	 */
	static async create(
		clientId: string,
		input: EnvironmentInput,
	): Promise<OauthClientEnvironmentDTO> {
		const row: OauthClientEnvironment = {
			...input,
			clientId,
			createdAt: new Date(),
			id: crypto.randomUUID(),
		};
		await db.insert(oauthClientEnvironment).values(row);
		return new OauthClientEnvironmentDTO(row);
	}

	/** Saves the environment's name, callbacks, origins and localhost switch. */
	async update(input: EnvironmentInput): Promise<void> {
		await db
			.update(oauthClientEnvironment)
			.set(input)
			.where(eq(oauthClientEnvironment.id, this.row.id));
		Object.assign(this.row, input);
	}

	/** Deletes the environment; its secrets go with it. */
	async delete(): Promise<void> {
		await db
			.delete(oauthClientEnvironment)
			.where(eq(oauthClientEnvironment.id, this.row.id));
	}

	/** The environment's id. */
	get id(): string {
		return this.row.id;
	}

	/** The environment's name, e.g. production. */
	get name(): string {
		return this.row.name;
	}

	/** The callback URLs codes for this environment may be sent to. */
	get redirectUris(): string[] {
		return this.row.redirectUris;
	}

	/** The browser origins allowed to call the token endpoint for this environment. */
	get allowedOrigins(): string[] {
		return this.row.allowedOrigins;
	}

	/** Whether localhost callbacks and origins are allowed. */
	get allowLocalhost(): boolean {
		return this.row.allowLocalhost;
	}
}
