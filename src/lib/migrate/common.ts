import {
	ComposeParseError,
	type ComposeServiceDraft,
	type ComposeVolumeDraft,
	parseComposeFile,
	slugifyComposeKey,
	splitImageRef,
} from "$lib/compose-import";
import { parseDotEnv } from "$lib/env-parse";

export type MigrationEntryKind = "application" | "compose" | "database";

export interface MigrationConnection {
	baseUrl: string;
	token: string;
}

export interface MigrationEntry {
	blocked: string | null;
	drafts: ComposeServiceDraft[];
	id: string;
	kind: MigrationEntryKind;
	name: string;
	projectName: string;
	summary: string;
	warnings: string[];
}

export interface MigrationPreviewService {
	envCount: number;
	name: string;
	port: number;
	public: boolean;
	slug: string;
	slugTaken: boolean;
	volumeCount: number;
}

export interface MigrationPreviewEntry {
	blocked: string | null;
	id: string;
	kind: MigrationEntryKind;
	name: string;
	projectName: string;
	services: MigrationPreviewService[];
	summary: string;
	warnings: string[];
}

export interface MigrationPreview {
	entries: MigrationPreviewEntry[];
	projects: string[];
}

export interface MigrationImportResult {
	imported: Array<{ name: string; services: number }>;
	skipped: Array<{ name: string; reason: string }>;
}

export type MigrationFormState =
	| {
			error?: string;
			preview?: MigrationPreview;
			result?: MigrationImportResult;
			values?: { baseUrl: string };
	  }
	| null
	| undefined;

export type RawRow = Record<string, unknown>;

const DEFAULT_PORT = 80;

export function isRow(value: unknown): value is RawRow {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rows(value: unknown): RawRow[] {
	return Array.isArray(value) ? value.filter(isRow) : [];
}

export function str(row: RawRow, ...keys: string[]): string | null {
	for (const key of keys) {
		const value = row[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
		if (typeof value === "number" && Number.isFinite(value)) {
			return String(value);
		}
	}
	return null;
}

export function num(row: RawRow, ...keys: string[]): number | null {
	for (const key of keys) {
		const value = row[key];
		const parsed =
			typeof value === "number"
				? value
				: typeof value === "string" && value.trim()
					? Number(value)
					: Number.NaN;
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return null;
}

export function listFrom(body: unknown): unknown[] | null {
	if (Array.isArray(body)) {
		return body;
	}
	if (isRow(body)) {
		if (Array.isArray(body.data)) {
			return body.data;
		}
		const result = body.result;
		if (isRow(result) && Array.isArray(result.data)) {
			return result.data;
		}
	}
	return null;
}

export function parseEnvBlob(raw: unknown): Record<string, string> {
	if (typeof raw !== "string" || !raw.trim()) {
		return {};
	}
	return Object.fromEntries(
		parseDotEnv(raw).map(({ key, value }) => [key, value]),
	);
}

export function interpolate(text: string, env: Record<string, string>): string {
	return text.replace(
		/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}/g,
		(match, key: string, fallback: string | undefined) => {
			if (env[key] !== undefined && env[key] !== "") {
				return env[key];
			}
			return fallback ?? match;
		},
	);
}

export function trimPath(path: string | null): string | null {
	const cleaned = (path ?? "").replace(/^\.?\/+/, "").replace(/\/+$/, "");
	return cleaned && cleaned !== "." ? cleaned : null;
}

export function joinPaths(...parts: Array<string | null>): string | null {
	return trimPath(
		parts
			.map(trimPath)
			.filter((part): part is string => !!part)
			.join("/"),
	);
}

export function sourceSlug(name: string): string {
	return slugifyComposeKey(name) || "service";
}

export function bindVolumeName(slug: string, containerPath: string): string {
	const suffix = slugifyComposeKey(containerPath.replace(/^\//, "")) || "data";
	return `${slug}-${suffix}`.slice(0, 63);
}

export interface SingleDraftInput {
	build?: ComposeServiceDraft["build"];
	containerPort: number | null;
	cpuLimit?: string | null;
	envVars: Record<string, string>;
	image: string | null;
	memoryLimitMb?: number | null;
	name: string;
	public: boolean;
	volumes?: ComposeVolumeDraft[];
}

export function singleDraft(input: SingleDraftInput): ComposeServiceDraft {
	const slug = sourceSlug(input.name);
	const ref = input.image
		? splitImageRef(input.image)
		: { image: slug, tag: "latest" };
	return {
		build: input.build ?? null,
		containerPort: input.containerPort ?? DEFAULT_PORT,
		cpuLimit: input.cpuLimit ?? null,
		dependsOn: [],
		dnsResolvable: input.public,
		envVars: input.envVars,
		image: ref.image,
		key: slug,
		memoryLimitMb: input.memoryLimitMb ?? null,
		name: input.name,
		networkMode: "bridge",
		portProtocol: "tcp",
		restartPolicy: "unless-stopped",
		slug,
		tag: ref.tag,
		volumes: input.volumes ?? [],
		warnings: [],
	};
}

export function composeDrafts(
	file: string,
	env: Record<string, string>,
): { drafts: ComposeServiceDraft[]; error: string | null; warnings: string[] } {
	try {
		const plan = parseComposeFile(interpolate(file, env));
		const unresolved = plan.services.some((svc) =>
			Object.values(svc.envVars).some((value) => /\$\{[^}]+\}/.test(value)),
		);
		return {
			drafts: plan.services,
			error: null,
			warnings: [
				...(unresolved
					? [
							"Some variables still reference values the source didn't return : fill those in by hand.",
						]
					: []),
				...plan.warnings,
				...plan.services.flatMap((svc) =>
					svc.warnings.map((warning) => `${svc.key}: ${warning}`),
				),
			],
		};
	} catch (err) {
		return {
			drafts: [],
			error:
				err instanceof ComposeParseError
					? `The compose file couldn't be read : ${err.message}`
					: String(err),
			warnings: [],
		};
	}
}

export function imageSummary(draft: ComposeServiceDraft): string {
	if (draft.build) {
		const ref = draft.build.gitRef ? `@${draft.build.gitRef}` : "";
		return `git ${draft.build.gitUrl ?? "repository"}${ref}`;
	}
	return `${draft.image}:${draft.tag}`;
}

export function previewEntries(
	entries: MigrationEntry[],
	takenSlugs: Set<string>,
): MigrationPreview {
	return {
		entries: entries.map((entry) => ({
			blocked: entry.blocked,
			id: entry.id,
			kind: entry.kind,
			name: entry.name,
			projectName: entry.projectName,
			services: entry.drafts.map((draft) => ({
				envCount: Object.keys(draft.envVars).length,
				name: draft.name,
				port: draft.containerPort,
				public: draft.dnsResolvable,
				slug: draft.slug,
				slugTaken: takenSlugs.has(draft.slug),
				volumeCount: draft.volumes.length,
			})),
			summary: entry.summary,
			warnings: entry.warnings,
		})),
		projects: [...new Set(entries.map((entry) => entry.projectName))],
	};
}

export async function mapLimit<T, R>(
	items: T[],
	limit: number,
	run: (item: T) => Promise<R>,
): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		if (next >= items.length) {
			return;
		}
		const index = next;
		next += 1;
		out[index] = await run(items[index] as T);
		return worker();
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	return out;
}

export interface HttpClientOptions {
	headers: Record<string, string>;
	label: string;
}

const TIMEOUT_MS = 20_000;

export class MigrationHttpClient {
	readonly #baseUrl: string;
	readonly #options: HttpClientOptions;

	constructor(baseUrl: string, options: HttpClientOptions) {
		this.#baseUrl = baseUrl.replace(/\/+$/, "");
		this.#options = options;
	}

	async get(path: string): Promise<unknown> {
		const url = `${this.#baseUrl}${path}`;
		const res = await fetch(url, {
			headers: { accept: "application/json", ...this.#options.headers },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		}).catch((err: unknown) => {
			throw new Error(
				`Couldn't reach ${this.#options.label} at ${this.#baseUrl} : ${err instanceof Error ? err.message : String(err)}`,
			);
		});
		if (res.status === 401 || res.status === 403) {
			throw new Error(`${this.#options.label} rejected that API token.`);
		}
		if (!res.ok) {
			throw new Error(
				`${this.#options.label} answered ${res.status} for ${path.split("?")[0]}.`,
			);
		}
		const text = await res.text();
		try {
			return JSON.parse(text) as unknown;
		} catch {
			throw new Error(
				`${this.#options.label}'s answer to ${path.split("?")[0]} wasn't JSON : check the URL points at the ${this.#options.label} dashboard itself.`,
			);
		}
	}
}
