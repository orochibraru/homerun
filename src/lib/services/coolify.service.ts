import { Logger } from "$lib/logger";
import {
	listFrom,
	type MigrationConnection,
	type MigrationEntry,
	MigrationHttpClient,
	mapLimit,
	type RawRow,
	rows,
	sourceSlug,
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
import {
	type CoolifyStorage,
	coolifyStorages,
} from "$lib/migrate/coolify-runtime";

const logger = new Logger("Coolify");

const CONCURRENCY = 6;

class CoolifyServiceClass {
	readonly label = "Coolify";

	/** A bearer-authenticated HTTP client scoped to this Coolify connection. */
	#client(connection: MigrationConnection): MigrationHttpClient {
		return new MigrationHttpClient(connection.baseUrl, {
			headers: { authorization: `Bearer ${connection.token}` },
			label: this.label,
		});
	}

	/** GETs `path` and normalizes its body to a row list. @throws When the response doesn't look like a list, which usually means the configured URL isn't actually a Coolify dashboard. */
	async #list(client: MigrationHttpClient, path: string): Promise<RawRow[]> {
		const list = listFrom(await client.get(path));
		if (!list) {
			throw new Error(
				`Coolify's answer to ${path} didn't look like a list : check the URL points at the Coolify dashboard itself.`,
			);
		}
		return rows(list);
	}

	/** Fetches and parses an application's or service's env vars, or `{}` if `uuid` is null or the request fails. */
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

	/**
	 * Fetches an application's or database's persistent storage from
	 * `/storages`, falling back to whatever the list row itself carries, or
	 * null when neither says anything about storage.
	 */
	async #storage(
		client: MigrationHttpClient,
		kind: "applications" | "databases",
		row: RawRow,
	): Promise<CoolifyStorage | null> {
		const uuid = str(row, "uuid");
		const slug = sourceSlug(str(row, "name") ?? "service");
		const body = uuid
			? await client
					.get(`/api/v1/${kind}/${encodeURIComponent(uuid)}/storages`)
					.catch(() => null)
			: null;
		return coolifyStorages(body, slug) ?? coolifyStorages(row, slug);
	}

	/**
	 * Reads a Coolify instance's projects, applications, services, and
	 * databases (concurrently, `CONCURRENCY`-limited) and normalizes them
	 * into this app's generic `MigrationEntry` shape for the Migrate tab,
	 * fetching each application's/service's env vars and each application's/
	 * database's persistent storage along the way. When
	 * `only` is given, entries are filtered to just those uuids/ids.
	 */
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
					await this.#storage(client, "applications", row),
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
		const databaseEntries = await mapLimit(
			databases.filter(wanted),
			CONCURRENCY,
			async (row) =>
				coolifyDatabase(
					row,
					coolifyProjectName(row, byEnvironment),
					await this.#storage(client, "databases", row),
				),
		);

		const entries = [...appEntries, ...serviceEntries, ...databaseEntries];
		logger.info(
			`Coolify read: projects=${projects.length} entries=${entries.length}`,
		);
		return entries;
	}
}

export const CoolifyService = new CoolifyServiceClass();
