import { Logger } from "$lib/logger";
import {
	listFrom,
	type MigrationConnection,
	type MigrationEntry,
	MigrationHttpClient,
	mapLimit,
	type RawRow,
	rows,
	str,
} from "$lib/migrate/common";
import {
	coolifyApplication,
	coolifyDatabase,
	coolifyEnv,
	coolifyEnvironmentProjects,
	coolifyProjectName,
	coolifyService,
} from "$lib/migrate/coolify";

const logger = new Logger("Coolify");

const CONCURRENCY = 6;

class CoolifyServiceClass {
	readonly label = "Coolify";

	#client(connection: MigrationConnection): MigrationHttpClient {
		return new MigrationHttpClient(connection.baseUrl, {
			headers: { authorization: `Bearer ${connection.token}` },
			label: this.label,
		});
	}

	async #list(client: MigrationHttpClient, path: string): Promise<RawRow[]> {
		const list = listFrom(await client.get(path));
		if (!list) {
			throw new Error(
				`Coolify's answer to ${path} didn't look like a list : check the URL points at the Coolify dashboard itself.`,
			);
		}
		return rows(list);
	}

	async #env(
		client: MigrationHttpClient,
		kind: "applications" | "services",
		uuid: string | null,
	): Promise<Record<string, string>> {
		if (!uuid) {
			return {};
		}
		const body = await client
			.get(`/api/v1/${kind}/${encodeURIComponent(uuid)}/envs`)
			.catch(() => []);
		return coolifyEnv(listFrom(body) ?? []);
	}

	async listEntries(
		connection: MigrationConnection,
		only?: Set<string>,
	): Promise<MigrationEntry[]> {
		const client = this.#client(connection);
		const [projects, applications, services, databases] = await Promise.all([
			this.#list(client, "/api/v1/projects"),
			this.#list(client, "/api/v1/applications"),
			this.#list(client, "/api/v1/services"),
			this.#list(client, "/api/v1/databases").catch(() => []),
		]);
		const detailed = await mapLimit(projects, CONCURRENCY, async (project) => {
			const uuid = str(project, "uuid");
			if (!uuid || Array.isArray(project.environments)) {
				return project;
			}
			const body = await client
				.get(`/api/v1/projects/${encodeURIComponent(uuid)}`)
				.catch(() => project);
			return { ...project, ...(body as RawRow) };
		});
		const byEnvironment = coolifyEnvironmentProjects(detailed);
		const wanted = (row: RawRow) => {
			const id = str(row, "uuid", "id");
			return !only || (id !== null && only.has(id));
		};

		const appEntries = await mapLimit(
			applications.filter(wanted),
			CONCURRENCY,
			async (row) =>
				coolifyApplication(
					row,
					coolifyProjectName(row, byEnvironment),
					await this.#env(client, "applications", str(row, "uuid")),
				),
		);
		const serviceEntries = await mapLimit(
			services.filter(wanted),
			CONCURRENCY,
			async (row) =>
				coolifyService(
					row,
					coolifyProjectName(row, byEnvironment),
					await this.#env(client, "services", str(row, "uuid")),
				),
		);
		const databaseEntries = databases
			.filter(wanted)
			.map((row) =>
				coolifyDatabase(row, coolifyProjectName(row, byEnvironment)),
			);

		const entries = [...appEntries, ...serviceEntries, ...databaseEntries];
		logger.info(
			`Coolify read: projects=${projects.length} entries=${entries.length}`,
		);
		return entries;
	}
}

export const CoolifyService = new CoolifyServiceClass();
