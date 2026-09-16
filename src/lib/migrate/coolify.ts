import {
	composeDrafts,
	imageSummary,
	isRow,
	type MigrationEntry,
	type RawRow,
	rows,
	singleDraft,
	str,
	trimPath,
} from "./common";

export function coolifyEnvironmentProjects(
	projects: RawRow[],
): Map<string, string> {
	const byEnvironment = new Map<string, string>();
	for (const project of projects) {
		const name = str(project, "name") ?? "Coolify";
		for (const environment of rows(project.environments)) {
			for (const key of ["id", "uuid"]) {
				const id = str(environment, key);
				if (id) {
					byEnvironment.set(id, name);
				}
			}
		}
	}
	return byEnvironment;
}

export function coolifyProjectName(
	row: RawRow,
	byEnvironment: Map<string, string>,
): string {
	const environment = isRow(row.environment) ? row.environment : null;
	const project =
		environment && isRow(environment.project) ? environment.project : null;
	return (
		(project && str(project, "name")) ??
		str(row, "project_name") ??
		byEnvironment.get(str(row, "environment_id") ?? "") ??
		(environment && byEnvironment.get(str(environment, "id") ?? "")) ??
		"Coolify"
	);
}

export function coolifyEnv(list: unknown): Record<string, string> {
	const env: Record<string, string> = {};
	for (const row of rows(list)) {
		const key = str(row, "key");
		if (!key || row.is_preview === true) {
			continue;
		}
		const value = [row.real_value, row.value].find(
			(candidate) => typeof candidate === "string",
		);
		env[key] = typeof value === "string" ? value : "";
	}
	return env;
}

export function coolifyMemoryMb(raw: unknown): number | null {
	const text =
		typeof raw === "number"
			? String(raw)
			: typeof raw === "string"
				? raw.trim()
				: "";
	const match = /^(\d+(?:\.\d+)?)\s*([kmg]?)i?b?$/i.exec(text);
	if (!match) {
		return null;
	}
	const amount = Number(match[1]);
	const unit = (match[2] ?? "").toLowerCase();
	const mb =
		unit === "g"
			? amount * 1024
			: unit === "m"
				? amount
				: unit === "k"
					? amount / 1024
					: amount / 1_048_576;
	return mb >= 1 ? Math.round(mb) : null;
}

function cpuLimit(raw: unknown): string | null {
	const value =
		typeof raw === "number"
			? raw
			: typeof raw === "string"
				? Number(raw)
				: Number.NaN;
	return Number.isFinite(value) && value > 0 ? String(value) : null;
}

function firstPort(row: RawRow): number | null {
	const exposes = str(row, "ports_exposes");
	const first = exposes?.split(",")[0]?.trim();
	const port = first ? Number(first) : Number.NaN;
	return Number.isFinite(port) && port > 0 ? port : null;
}

export function coolifyGitUrl(repository: string | null): string | null {
	if (!repository) {
		return null;
	}
	if (/^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/i.test(repository)) {
		return repository;
	}
	return `https://github.com/${repository.replace(/^\/+|\.git$/g, "")}`;
}

type AppOutcome = Pick<
	MigrationEntry,
	"blocked" | "drafts" | "kind" | "summary" | "warnings"
>;

function appBase(row: RawRow, name: string, env: Record<string, string>) {
	return {
		containerPort: firstPort(row),
		cpuLimit: cpuLimit(row.limits_cpus),
		envVars: env,
		memoryLimitMb: coolifyMemoryMb(row.limits_memory),
		name,
		public: !!str(row, "fqdn"),
	};
}

function blockedApp(blocked: string, summary: string): AppOutcome {
	return { blocked, drafts: [], kind: "application", summary, warnings: [] };
}

function imageApp(row: RawRow, base: ReturnType<typeof appBase>): AppOutcome {
	const image = str(row, "docker_registry_image_name");
	if (!image) {
		return blockedApp(
			"Coolify has no image set for this application.",
			"docker image",
		);
	}
	const tag = str(row, "docker_registry_image_tag") ?? "latest";
	const draft = singleDraft({ ...base, image: `${image}:${tag}` });
	return {
		blocked: null,
		drafts: [draft],
		kind: "application",
		summary: imageSummary(draft),
		warnings: [],
	};
}

function composeApp(row: RawRow, env: Record<string, string>): AppOutcome {
	const file = str(row, "docker_compose_raw");
	if (!file) {
		return {
			...blockedApp(
				"Coolify has no compose file stored for this application.",
				"compose",
			),
			kind: "compose",
		};
	}
	const parsed = composeDrafts(file, env);
	return {
		blocked: parsed.error,
		drafts: parsed.drafts,
		kind: "compose",
		summary: `compose · ${parsed.drafts.length} service(s)`,
		warnings: parsed.warnings,
	};
}

function dockerfileApp(
	row: RawRow,
	base: ReturnType<typeof appBase>,
	buildPack: string,
): AppOutcome {
	const gitUrl = coolifyGitUrl(str(row, "git_repository"));
	if (buildPack !== "dockerfile") {
		return blockedApp(
			`Built with ${buildPack} on Coolify : Homerun only builds from a Dockerfile.`,
			`git ${gitUrl ?? "repository"} · ${buildPack}`,
		);
	}
	if (!gitUrl) {
		return blockedApp(
			"Built from a Dockerfile pasted into Coolify, with no repository behind it : create it here from its image or a repository instead.",
			"dockerfile",
		);
	}
	const draft = singleDraft({
		...base,
		build: {
			context: trimPath(str(row, "base_directory")),
			dockerfile: trimPath(str(row, "dockerfile_location")),
			gitRef: str(row, "git_branch"),
			gitUrl,
		},
		image: null,
	});
	return {
		blocked: null,
		drafts: [draft],
		kind: "application",
		summary: imageSummary(draft),
		warnings: [],
	};
}

export function coolifyApplication(
	row: RawRow,
	projectName: string,
	env: Record<string, string>,
): MigrationEntry {
	const name = str(row, "name") ?? "unnamed";
	const buildPack = str(row, "build_pack") ?? "nixpacks";
	const base = appBase(row, name, env);
	const outcome =
		buildPack === "dockerimage"
			? imageApp(row, base)
			: buildPack === "dockercompose"
				? composeApp(row, env)
				: dockerfileApp(row, base, buildPack);
	const warnings: string[] = [];
	if (str(row, "custom_docker_run_options") || str(row, "start_command")) {
		warnings.push(
			"Custom run options or a start command are set on Coolify : they aren't applied here.",
		);
	}
	if (buildPack !== "dockercompose") {
		warnings.push(
			"Coolify's API doesn't list persistent storage : re-attach volumes on the Storage tab.",
		);
	}
	return {
		...outcome,
		id: str(row, "uuid", "id") ?? `${projectName}-${name}`,
		name,
		projectName,
		warnings: [...warnings, ...outcome.warnings],
	};
}

export function coolifyService(
	row: RawRow,
	projectName: string,
	env: Record<string, string>,
): MigrationEntry {
	const name = str(row, "name") ?? "unnamed";
	const file = str(row, "docker_compose_raw");
	const base = {
		id: str(row, "uuid", "id") ?? `${projectName}-${name}`,
		kind: "compose" as const,
		name,
		projectName,
	};
	if (!file) {
		return {
			...base,
			blocked: "Coolify didn't return a compose file for this service.",
			drafts: [],
			summary: "compose",
			warnings: [],
		};
	}
	const parsed = composeDrafts(file, env);
	return {
		...base,
		blocked: parsed.error,
		drafts: parsed.drafts,
		summary: `compose · ${parsed.drafts.length} service(s)`,
		warnings: parsed.warnings,
	};
}

const DATABASES: Array<{
	env: Record<string, string>;
	match: string;
	port: number;
}> = [
	{
		env: {
			POSTGRES_DB: "postgres_db",
			POSTGRES_PASSWORD: "postgres_password",
			POSTGRES_USER: "postgres_user",
		},
		match: "postgres",
		port: 5432,
	},
	{
		env: {
			MARIADB_DATABASE: "mariadb_database",
			MARIADB_PASSWORD: "mariadb_password",
			MARIADB_ROOT_PASSWORD: "mariadb_root_password",
			MARIADB_USER: "mariadb_user",
		},
		match: "mariadb",
		port: 3306,
	},
	{
		env: {
			MYSQL_DATABASE: "mysql_database",
			MYSQL_PASSWORD: "mysql_password",
			MYSQL_ROOT_PASSWORD: "mysql_root_password",
			MYSQL_USER: "mysql_user",
		},
		match: "mysql",
		port: 3306,
	},
	{
		env: {
			MONGO_INITDB_DATABASE: "mongo_initdb_database",
			MONGO_INITDB_ROOT_PASSWORD: "mongo_initdb_root_password",
			MONGO_INITDB_ROOT_USERNAME: "mongo_initdb_root_username",
		},
		match: "mongo",
		port: 27_017,
	},
	{ env: {}, match: "redis", port: 6379 },
	{ env: {}, match: "keydb", port: 6379 },
	{ env: {}, match: "dragonfly", port: 6379 },
	{
		env: {
			CLICKHOUSE_PASSWORD: "clickhouse_admin_password",
			CLICKHOUSE_USER: "clickhouse_admin_user",
		},
		match: "clickhouse",
		port: 8123,
	},
];

export function coolifyDatabase(
	row: RawRow,
	projectName: string,
): MigrationEntry {
	const name = str(row, "name") ?? "database";
	const type = str(row, "database_type", "type") ?? "";
	const spec = DATABASES.find((candidate) => type.includes(candidate.match));
	const warnings: string[] = [];
	const envVars: Record<string, string> = {};
	for (const [envKey, field] of Object.entries(spec?.env ?? {})) {
		const value = str(row, field);
		if (value) {
			envVars[envKey] = value;
		}
	}
	if (str(row, "redis_password", "keydb_password", "dragonfly_password")) {
		warnings.push(
			"Coolify sets this password through the start command, which isn't applied here : set it yourself.",
		);
	}
	if (row.is_public === true) {
		warnings.push(
			"Public on a host port on Coolify : Homerun only reaches it over the internal network.",
		);
	}
	warnings.push(
		"Coolify's API doesn't list persistent storage : re-attach the data volume on the Storage tab.",
	);
	const image = str(row, "image");
	const id = str(row, "uuid", "id") ?? `${projectName}-${name}`;
	if (!image) {
		return {
			blocked: "Coolify has no image set for this database.",
			drafts: [],
			id,
			kind: "database",
			name,
			projectName,
			summary: type || "database",
			warnings,
		};
	}
	const draft = singleDraft({
		containerPort: spec?.port ?? null,
		cpuLimit: cpuLimit(row.limits_cpus),
		envVars,
		image,
		memoryLimitMb: coolifyMemoryMb(row.limits_memory),
		name,
		public: false,
	});
	return {
		blocked: null,
		drafts: [draft],
		id,
		kind: "database",
		name,
		projectName,
		summary: `${type.replace(/^standalone-/, "") || "database"} · ${imageSummary(draft)}`,
		warnings,
	};
}
