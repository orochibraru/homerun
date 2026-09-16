import { Logger } from "$lib/logger";
import {
	isRow,
	listFrom,
	type MigrationConnection,
	type MigrationEntry,
	MigrationHttpClient,
	mapLimit,
} from "$lib/migrate/common";
import {
	type DokployRef,
	dokployEntry,
	dokployIdKey,
	dokployRefs,
} from "$lib/migrate/dokploy";

const logger = new Logger("Dokploy");

const CONCURRENCY = 6;

class DokployServiceClass {
	readonly label = "Dokploy";

	#client(connection: MigrationConnection): MigrationHttpClient {
		return new MigrationHttpClient(connection.baseUrl, {
			headers: { "x-api-key": connection.token },
			label: this.label,
		});
	}

	async #detail(client: MigrationHttpClient, ref: DokployRef) {
		const query = new URLSearchParams({ [dokployIdKey(ref.type)]: ref.id });
		const body = await client.get(`/api/${ref.type}.one?${query}`);
		if (!isRow(body)) {
			throw new Error(
				`Dokploy's answer for ${ref.type} "${ref.name ?? ref.id}" wasn't an object.`,
			);
		}
		return body;
	}

	async listEntries(
		connection: MigrationConnection,
		only?: Set<string>,
	): Promise<MigrationEntry[]> {
		const client = this.#client(connection);
		const projects = listFrom(await client.get("/api/project.all"));
		if (!projects) {
			throw new Error(
				"Dokploy's answer didn't look like a project list : check the URL points at the Dokploy dashboard itself.",
			);
		}
		const refs = dokployRefs(projects).filter(
			(ref) => !only || only.has(ref.id),
		);
		const entries = await mapLimit(refs, CONCURRENCY, async (ref) =>
			dokployEntry(ref, await this.#detail(client, ref)),
		);
		logger.info(
			`Dokploy read: projects=${projects.length} entries=${entries.length}`,
		);
		return entries;
	}
}

export const DokployService = new DokployServiceClass();
