import { parseComposeFile, splitImageRef } from "$lib/compose-import";
import { ProjectDTO } from "$lib/dto/project-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { ComposeImportService } from "./compose-import.service.ts";

const logger = new Logger("Dokploy");

const TIMEOUT_MS = 20_000;
const DEFAULT_CONTAINER_PORT = 80;

export interface DokployConnection {
	baseUrl: string;
	token: string;
}

export type DokployEntryKind = "application" | "compose" | "database";

/** One deployable thing on the Dokploy side, flattened out of its project tree. */
export interface DokployEntry {
	composeFile: string | null;
	containerPort: number | null;
	envVars: Record<string, string>;
	id: string;
	image: string | null;
	kind: DokployEntryKind;
	name: string;
	projectName: string;
}

export interface DokployPlanItem {
	entry: DokployEntry;
	/** Why this one can't be imported, or null when it can. */
	blocked: string | null;
	composeServiceCount: number;
	image: string | null;
	slug: string;
	slugTaken: boolean;
	tag: string;
}

export interface DokployPlan {
	items: DokployPlanItem[];
	projects: string[];
}

interface DokployProject {
	applications?: unknown[];
	compose?: unknown[];
	mariadb?: unknown[];
	mongo?: unknown[];
	mysql?: unknown[];
	name?: string;
	postgres?: unknown[];
	redis?: unknown[];
}

const DATABASE_KEYS = [
	"mariadb",
	"mongo",
	"mysql",
	"postgres",
	"redis",
] as const;

/** Dokploy stores env as one blob, `KEY=value` a line, same shape as a .env file. */
export function parseDokployEnv(raw: unknown): Record<string, string> {
	if (typeof raw !== "string" || !raw.trim()) {
		return {};
	}
	const out: Record<string, string> = {};
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const eq = trimmed.indexOf("=");
		if (eq <= 0) {
			continue;
		}
		out[trimmed.slice(0, eq).trim()] = trimmed
			.slice(eq + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
	}
	return out;
}

export function dokploySlug(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60) || "service"
	);
}

function readString(row: Record<string, unknown>, ...keys: string[]) {
	for (const key of keys) {
		const value = row[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	return null;
}

function readPort(row: Record<string, unknown>): number | null {
	for (const key of ["applicationPort", "externalPort", "port"]) {
		const value = row[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
	}
	return null;
}

function entriesFrom(project: DokployProject): DokployEntry[] {
	const projectName = project.name ?? "Dokploy";
	const entries: DokployEntry[] = [];

	const push = (raw: unknown, kind: DokployEntryKind) => {
		if (!raw || typeof raw !== "object") {
			return;
		}
		const row = raw as Record<string, unknown>;
		const name = readString(row, "name", "appName", "composeName") ?? "unnamed";
		entries.push({
			composeFile: readString(row, "composeFile"),
			containerPort: readPort(row),
			envVars: parseDokployEnv(row.env),
			id:
				readString(
					row,
					"applicationId",
					"composeId",
					"postgresId",
					"mysqlId",
					"mariadbId",
					"mongoId",
					"redisId",
				) ?? `${projectName}-${name}`,
			image: readString(row, "dockerImage", "image", "sourceType"),
			kind,
			name,
			projectName,
		});
	};

	for (const app of project.applications ?? []) {
		push(app, "application");
	}
	for (const compose of project.compose ?? []) {
		push(compose, "compose");
	}
	for (const key of DATABASE_KEYS) {
		for (const db of project[key] ?? []) {
			push(db, "database");
		}
	}
	return entries;
}

export interface DokployImportResult {
	imported: string[];
	skipped: Array<{ name: string; reason: string }>;
}

class DokployServiceClass {
	/**
	 * Reads every project on a Dokploy instance. Read-only, and the only
	 * call this app ever makes against Dokploy : a migration pulls, it never
	 * writes back or stops anything over there.
	 */
	async listEntries(connection: DokployConnection): Promise<DokployEntry[]> {
		const url = new URL(
			"/api/project.all",
			connection.baseUrl.replace(/\/+$/, ""),
		);
		const res = await fetch(url, {
			headers: {
				accept: "application/json",
				"x-api-key": connection.token,
			},
			signal: AbortSignal.timeout(TIMEOUT_MS),
		}).catch((err: unknown) => {
			throw new Error(
				`Couldn't reach Dokploy at ${connection.baseUrl} : ${err instanceof Error ? err.message : String(err)}`,
			);
		});

		if (res.status === 401 || res.status === 403) {
			throw new Error("Dokploy rejected that API token.");
		}
		if (!res.ok) {
			throw new Error(`Dokploy answered ${res.status} for /api/project.all.`);
		}

		const body = (await res.json().catch(() => null)) as unknown;
		const wrapped = (body as { result?: { data?: unknown } } | null)?.result
			?.data;
		const projects = Array.isArray(body)
			? (body as DokployProject[])
			: Array.isArray(wrapped)
				? (wrapped as DokployProject[])
				: [];
		if (projects.length === 0 && !Array.isArray(body)) {
			throw new Error(
				"Dokploy's answer didn't look like a project list : check the URL points at the Dokploy dashboard itself.",
			);
		}

		const entries = projects.flatMap(entriesFrom);
		logger.info(
			`Dokploy read: projects=${projects.length} entries=${entries.length}`,
		);
		return entries;
	}

	/**
	 * What importing would produce, without creating anything : the dry run
	 * the user approves. `takenSlugs` is what this instance already has, so a
	 * collision is shown before it happens rather than silently renamed.
	 */
	plan(entries: DokployEntry[], takenSlugs: Set<string>): DokployPlan {
		const items = entries.map((entry) => {
			const slug = dokploySlug(entry.name);
			const composeServiceCount =
				entry.kind === "compose" && entry.composeFile
					? countComposeServices(entry.composeFile)
					: 0;
			const { image, tag } = entry.image
				? splitImageRef(entry.image)
				: { image: null, tag: "latest" };

			return {
				blocked: blockedReason(entry, image, composeServiceCount),
				composeServiceCount,
				entry,
				image,
				slug,
				slugTaken: takenSlugs.has(slug),
				tag,
			};
		});

		return {
			items,
			projects: [...new Set(entries.map((entry) => entry.projectName))],
		};
	}

	/**
	 * Creates what the approved plan describes : one Homerun service per
	 * Dokploy application/database, and the existing compose importer for a
	 * compose stack. Nothing is deployed, and nothing on the Dokploy side is
	 * touched : the imported services sit there until the user deploys them.
	 */
	async importPlan(
		items: DokployPlanItem[],
		userId: string,
	): Promise<DokployImportResult> {
		const result: DokployImportResult = { imported: [], skipped: [] };
		for (const item of items) {
			if (item.blocked) {
				result.skipped.push({ name: item.entry.name, reason: item.blocked });
				continue;
			}
			// biome-ignore lint/performance/noAwaitInLoops: each import checks its slug against rows the previous one just inserted
			const outcome = await this.#importOne(item, userId).catch(
				(err: unknown) => ({
					error: err instanceof Error ? err.message : String(err),
				}),
			);
			if (typeof outcome === "object" && "error" in outcome) {
				result.skipped.push({ name: item.entry.name, reason: outcome.error });
			} else {
				result.imported.push(item.entry.name);
			}
		}
		logger.info(
			`Dokploy import: imported=${result.imported.length} skipped=${result.skipped.length} user=${userId}`,
		);
		return result;
	}

	async #importOne(item: DokployPlanItem, userId: string): Promise<void> {
		const project = await this.#projectFor(item.entry.projectName, userId);

		if (item.entry.kind === "compose" && item.entry.composeFile) {
			const plan = parseComposeFile(item.entry.composeFile);
			await ComposeImportService.importPlan({
				drafts: plan.services,
				projectId: project,
				projectName: null,
				userId,
			});
			return;
		}

		await ServiceDTO.create({
			containerPort: item.entry.containerPort ?? DEFAULT_CONTAINER_PORT,
			dnsResolvable: item.entry.kind === "application",
			envVars: item.entry.envVars,
			image: item.image ?? "",
			name: item.entry.name,
			projectId: project,
			restartPolicy: "unless-stopped",
			slug: await uniqueSlug(item.slug),
			tag: item.tag,
			userId,
		});
	}

	async #projectFor(name: string, userId: string): Promise<string | null> {
		const existing = await ProjectDTO.list(userId);
		const match = existing.find((row) => row.name === name);
		if (match) {
			return match.id;
		}
		const slug = await uniqueProjectSlug(dokploySlug(name));
		const created = await ProjectDTO.create({
			description: "Imported from Dokploy.",
			name,
			slug,
			userId,
		});
		return created.id;
	}
}

async function uniqueSlug(slug: string): Promise<string> {
	let candidate = slug;
	let attempt = 2;
	// biome-ignore lint/performance/noAwaitInLoops: each candidate can only be checked once the previous one came back taken
	while (await ServiceDTO.slugTaken(candidate)) {
		candidate = `${slug.slice(0, 55)}-${attempt}`;
		attempt += 1;
	}
	return candidate;
}

async function uniqueProjectSlug(slug: string): Promise<string> {
	let candidate = slug;
	let attempt = 2;
	// biome-ignore lint/performance/noAwaitInLoops: each candidate can only be checked once the previous one came back taken
	while (await ProjectDTO.slugTaken(candidate)) {
		candidate = `${slug.slice(0, 55)}-${attempt}`;
		attempt += 1;
	}
	return candidate;
}

function countComposeServices(composeFile: string): number {
	try {
		return parseComposeFile(composeFile).services.length;
	} catch {
		return 0;
	}
}

function blockedReason(
	entry: DokployEntry,
	image: string | null,
	composeServiceCount: number,
): string | null {
	if (entry.kind === "compose") {
		return composeServiceCount > 0
			? null
			: "Dokploy didn't return a compose file for this stack, so there's nothing to read.";
	}
	if (!image) {
		return "Built from source on Dokploy : point a new service at its git repository instead.";
	}
	return null;
}

export const DokployService = new DokployServiceClass();
export { DEFAULT_CONTAINER_PORT as DOKPLOY_DEFAULT_PORT };
