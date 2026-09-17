import type { BuildMethod } from "$lib/build-methods";
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
import { applyCoolifyExtras, type CoolifyStorage } from "./coolify-runtime";

/**
 * Indexes Coolify projects by the id and uuid of each of their environments, so
 * a resource that only carries an environment id can be attributed to its
 * project.
 */
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

/**
 * Resolves the project a Coolify resource belongs to, trying its embedded
 * environment's project, a `project_name` field, then the environment index from
 * `coolifyEnvironmentProjects`, and falling back to "Coolify".
 */
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

/**
 * Converts Coolify's env var list into a key/value map, skipping preview-only
 * variables and preferring the resolved `real_value` over the raw `value`.
 */
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

/**
 * Converts a Coolify memory limit (`512m`, `2g`, `1024k`, or bare bytes) to
 * whole megabytes, or null when unparseable or under 1 MB.
 */
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

/**
 * Normalises Coolify's `git_repository` into a cloneable URL: full URLs and SSH
 * remotes pass through, a bare `owner/repo` is assumed to be on GitHub.
 */
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

/**
 * Drafts a Coolify application deployed from a registry image and tag. Blocked
 * when no image is set.
 */
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

/**
 * Drafts a Coolify Docker Compose application from its stored compose file.
 * Blocked when no file is stored or it can't be parsed.
 */
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

const COOLIFY_BUILD_METHODS: Record<string, BuildMethod> = {
	dockerfile: "dockerfile",
	nixpacks: "nixpacks",
	railpack: "railpack",
};

/**
 * Drafts a Coolify git application as a git-based service, built from its
 * Dockerfile or with Nixpacks/Railpack. Blocked for a build pack Homerun has no
 * builder for (static) or when there's no repository behind it.
 */
function gitApp(
	row: RawRow,
	base: ReturnType<typeof appBase>,
	buildPack: string,
): AppOutcome {
	const gitUrl = coolifyGitUrl(str(row, "git_repository"));
	const method = COOLIFY_BUILD_METHODS[buildPack];
	if (!method) {
		return blockedApp(
			`Built with ${buildPack} on Coolify : Homerun builds from a Dockerfile, Nixpacks, Railpack or buildpacks.`,
			`git ${gitUrl ?? "repository"} · ${buildPack}`,
		);
	}
	if (!gitUrl) {
		return blockedApp(
			method === "dockerfile"
				? "Built from a Dockerfile pasted into Coolify, with no repository behind it : create it here from its image or a repository instead."
				: `Built with ${buildPack} on Coolify with no repository behind it : create it here from its image or a repository instead.`,
			buildPack,
		);
	}
	const warnings: string[] = [];
	if (
		method !== "dockerfile" &&
		(str(row, "install_command") || str(row, "build_command"))
	) {
		warnings.push(
			`Custom install or build commands are set on Coolify : ${buildPack} detects them from the repository here, set them in a config file there instead.`,
		);
	}
	const draft = singleDraft({
		...base,
		build: {
			context: trimPath(str(row, "base_directory")),
			dockerfile:
				method === "dockerfile"
					? trimPath(str(row, "dockerfile_location"))
					: null,
			gitRef: str(row, "git_branch"),
			gitUrl,
			method,
		},
		image: null,
	});
	return {
		blocked: null,
		drafts: [draft],
		kind: "application",
		summary: imageSummary(draft),
		warnings,
	};
}

/**
 * Converts a Coolify application into a migration entry, picking the image,
 * compose or Dockerfile path from its build pack and carrying over its run
 * options, start command and persistent storage (`storage`, null when the
 * source didn't list it).
 */
export function coolifyApplication(
	row: RawRow,
	projectName: string,
	env: Record<string, string>,
	storage: CoolifyStorage | null = null,
): MigrationEntry {
	const name = str(row, "name") ?? "unnamed";
	const buildPack = str(row, "build_pack") ?? "nixpacks";
	const base = appBase(row, name, env);
	const outcome =
		buildPack === "dockerimage"
			? imageApp(row, base)
			: buildPack === "dockercompose"
				? composeApp(row, env)
				: gitApp(row, base, buildPack);
	const warnings: string[] = [];
	const single = buildPack === "dockercompose" ? undefined : outcome.drafts[0];
	if (single) {
		applyCoolifyExtras(single, row, storage, warnings);
	}
	return {
		...outcome,
		id: str(row, "uuid", "id") ?? `${projectName}-${name}`,
		name,
		projectName,
		warnings: [...warnings, ...outcome.warnings],
	};
}

/**
 * Converts a Coolify one-click service into a compose migration entry from its
 * compose file. Blocked when Coolify returned no file or it can't be parsed.
 */
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

/**
 * The start command Coolify runs a Redis-family database with to set its
 * password (`--requirepass`), or null when it has none. Redis and KeyDB name
 * their server binary; Dragonfly's image entrypoint takes bare flags.
 */
export function coolifyPasswordCommand(
	row: RawRow,
	type: string,
): string[] | null {
	const password = str(
		row,
		"redis_password",
		"keydb_password",
		"dragonfly_password",
	);
	if (!password) {
		return null;
	}
	if (type.includes("keydb")) {
		return ["keydb-server", "--requirepass", password];
	}
	if (type.includes("dragonfly")) {
		return ["--requirepass", password];
	}
	return ["redis-server", "--requirepass", password];
}

/**
 * Converts a Coolify standalone database into a single private service draft,
 * mapping its stored credentials onto the image's standard env vars, applying
 * a Redis-family password through the start command the way Coolify does,
 * carrying its persistent storage over when listed (`storage`), and warning
 * about public ports, which don't carry over. Blocked when no image is set.
 */
export function coolifyDatabase(
	row: RawRow,
	projectName: string,
	storage: CoolifyStorage | null = null,
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
	if (row.is_public === true) {
		warnings.push(
			"Public on a host port on Coolify : Homerun only reaches it over the internal network.",
		);
	}
	if (!storage) {
		warnings.push(
			"Coolify didn't list this database's persistent storage : re-attach the data volume on the Volumes tab.",
		);
	}
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
		command: coolifyPasswordCommand(row, type),
		containerPort: spec?.port ?? null,
		cpuLimit: cpuLimit(row.limits_cpus),
		envVars,
		files: storage?.files ?? [],
		image,
		memoryLimitMb: coolifyMemoryMb(row.limits_memory),
		name,
		public: false,
		volumes: storage?.volumes ?? [],
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
