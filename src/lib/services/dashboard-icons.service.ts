import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config } from "$lib/config";
import { Logger } from "$lib/logger";
import { DASHBOARD_ICON_NAME } from "$lib/service-icon";

export const DASHBOARD_ICONS_CDN =
	"https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons";
export const MAX_DASHBOARD_ICON_BYTES = 2 * 1024 * 1024;
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const FORMATS = ["svg", "png"] as const;

type IconFormat = (typeof FORMATS)[number];

export interface DashboardIcon {
	aliases: string[];
	categories: string[];
	name: string;
}

interface CatalogEntry extends DashboardIcon {
	format: IconFormat;
	variants: string[];
}

interface Catalog {
	entries: Map<string, CatalogEntry>;
	fetchedAt: number;
}

export interface DashboardIconFile {
	body: Uint8Array<ArrayBuffer>;
	contentType: string;
}

export interface DashboardIconsOptions {
	dir?: () => string;
	fetch?: (url: string) => Promise<Response>;
	now?: () => number;
}

const CONTENT_TYPES: Record<IconFormat, string> = {
	png: "image/png",
	svg: "image/svg+xml",
};

const logger = new Logger("DashboardIcons");

/** Turns upstream `metadata.json` into catalog entries, lowercasing categories and dropping names that aren't valid slugs or formats this proxy doesn't serve. */
export function parseDashboardIconsMetadata(raw: unknown): CatalogEntry[] {
	if (!raw || typeof raw !== "object") {
		throw new Error("Dashboard Icons metadata isn't an object");
	}
	const entries: CatalogEntry[] = [];
	for (const [name, value] of Object.entries(raw)) {
		const meta = value as {
			aliases?: unknown;
			base?: unknown;
			categories?: unknown;
			colors?: Record<string, unknown>;
		};
		const format = FORMATS.find((f) => f === meta?.base);
		if (!(format && DASHBOARD_ICON_NAME.test(name))) {
			continue;
		}
		const strings = (list: unknown) =>
			Array.isArray(list)
				? list.filter((item): item is string => typeof item === "string")
				: [];
		const variants = [meta.colors?.dark, meta.colors?.light].filter(
			(variant): variant is string =>
				typeof variant === "string" &&
				variant !== name &&
				DASHBOARD_ICON_NAME.test(variant),
		);
		entries.push({
			aliases: strings(meta.aliases),
			categories: [
				...new Set(strings(meta.categories).map((c) => c.toLowerCase())),
			],
			format,
			name,
			variants,
		});
	}
	return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Serves Dashboard Icons (homarr-labs/dashboard-icons) through Homerun, so no
 * browser ever calls jsDelivr: the catalog and every icon are fetched once
 * and kept on disk under the data directory.
 */
export class DashboardIconsServiceClass {
	#catalog: Catalog | null = null;
	#catalogLoad: Promise<Catalog> | null = null;
	#dir: () => string;
	#fetch: (url: string) => Promise<Response>;
	#iconLoads = new Map<string, Promise<DashboardIconFile | null>>();
	#misses = new Map<string, number>();
	#now: () => number;

	/** Options exist for tests; the app uses the defaults (the data dir, global fetch, the clock). */
	constructor(options: DashboardIconsOptions = {}) {
		this.#dir =
			options.dir ?? (() => resolve(config.dataDir, "dashboard-icons"));
		this.#fetch = options.fetch ?? ((url) => fetch(url));
		this.#now = options.now ?? Date.now;
	}

	/**
	 * The icon catalog, name-sorted. Served from memory, then the disk copy,
	 * then upstream; a copy older than a day is still returned while a
	 * refresh runs in the background, so the picker works offline.
	 *
	 * @throws When there's no copy anywhere and upstream can't be reached.
	 */
	async catalog(): Promise<DashboardIcon[]> {
		const catalog = await this.#loadCatalog();
		return [...catalog.entries.values()].map(
			({ aliases, categories, name }) => ({ aliases, categories, name }),
		);
	}

	/**
	 * The icon file for `name`, from disk or fetched once from jsDelivr and
	 * written to disk. Returns null for an invalid or unknown name, or one
	 * upstream doesn't have (remembered for ten minutes so a missing icon
	 * doesn't hit the CDN on every render).
	 */
	async icon(name: string): Promise<DashboardIconFile | null> {
		if (!DASHBOARD_ICON_NAME.test(name)) {
			return null;
		}
		const entry = await this.#loadCatalog().then(
			(catalog) => catalog.entries.get(name) ?? null,
			() => undefined,
		);
		if (entry === null) {
			return null;
		}
		const formats = entry ? [entry.format] : FORMATS;
		const cached = await Promise.all(
			formats.map((format) =>
				readFile(join(this.#dir(), "icons", `${name}.${format}`)).then(
					(body) => ({ body, format }),
					() => null,
				),
			),
		);
		const hit = cached.find((file) => file !== null);
		if (hit) {
			return {
				body: new Uint8Array(hit.body),
				contentType: CONTENT_TYPES[hit.format],
			};
		}
		if ((this.#misses.get(name) ?? 0) > this.#now()) {
			return null;
		}
		let load = this.#iconLoads.get(name);
		if (!load) {
			load = this.#download(name, formats, entry?.variants ?? []).finally(() =>
				this.#iconLoads.delete(name),
			);
			this.#iconLoads.set(name, load);
		}
		return await load;
	}

	/** Fetches `name` (then its colour variants) in each format in turn, caching the first hit; records a miss when none exists. */
	async #download(
		name: string,
		formats: readonly IconFormat[],
		variants: string[],
	): Promise<DashboardIconFile | null> {
		const candidates = formats.flatMap((format) =>
			[name, ...variants].map((file) => ({ file, format })),
		);
		for (const { file, format } of candidates) {
			// oxlint-disable-next-line no-await-in-loop -- the first file upstream has wins, the rest mustn't be fetched
			const body = await this.#fetchBytes(
				`${DASHBOARD_ICONS_CDN}/${format}/${file}.${format}`,
			).catch((err) => {
				logger.warn(`Couldn't fetch Dashboard Icon ${file}.${format}`, err);
				return null;
			});
			if (body) {
				return this.#store(name, format, body);
			}
		}
		this.#misses.set(name, this.#now() + MISS_TTL_MS);
		return null;
	}

	/** Writes a downloaded icon to disk (a failure is logged, not thrown) and returns it. */
	async #store(
		name: string,
		format: IconFormat,
		body: Uint8Array<ArrayBuffer>,
	): Promise<DashboardIconFile> {
		await this.#writeAtomic(
			join(this.#dir(), "icons", `${name}.${format}`),
			body,
		).catch((err) => {
			logger.warn(`Couldn't cache Dashboard Icon ${name}`, err);
		});
		return { body, contentType: CONTENT_TYPES[format] };
	}

	/** The body at `url`, or null on a non-2xx, an empty body or one over `MAX_DASHBOARD_ICON_BYTES`. */
	async #fetchBytes(url: string): Promise<Uint8Array<ArrayBuffer> | null> {
		const res = await this.#fetch(url);
		if (!res.ok) {
			return null;
		}
		const length = Number(res.headers.get("content-length") ?? 0);
		if (length > MAX_DASHBOARD_ICON_BYTES) {
			return null;
		}
		const body = new Uint8Array(await res.arrayBuffer());
		return body.byteLength > 0 && body.byteLength <= MAX_DASHBOARD_ICON_BYTES
			? body
			: null;
	}

	/** The in-memory catalog, loading the disk copy first and refreshing from upstream when it's older than a day (in the background when there's a copy to serve). */
	async #loadCatalog(): Promise<Catalog> {
		if (!this.#catalog) {
			this.#catalog = await this.#readCatalogFile();
		}
		const current = this.#catalog;
		if (current && this.#now() - current.fetchedAt < CATALOG_TTL_MS) {
			return current;
		}
		this.#catalogLoad ??= this.#refreshCatalog().finally(() => {
			this.#catalogLoad = null;
		});
		if (current) {
			this.#catalogLoad.catch((err) => {
				logger.warn("Couldn't refresh the Dashboard Icons catalog", err);
			});
			return current;
		}
		return await this.#catalogLoad;
	}

	/** The catalog saved on disk, or null when there's none or it can't be parsed. */
	async #readCatalogFile(): Promise<Catalog | null> {
		const text = await readFile(
			join(this.#dir(), "catalog.json"),
			"utf8",
		).catch(() => null);
		if (!text) {
			return null;
		}
		try {
			const saved = JSON.parse(text) as {
				entries: CatalogEntry[];
				fetchedAt: number;
			};
			return {
				entries: new Map(saved.entries.map((entry) => [entry.name, entry])),
				fetchedAt: saved.fetchedAt,
			};
		} catch (err) {
			logger.warn("Ignoring an unreadable Dashboard Icons catalog", err);
			return null;
		}
	}

	/**
	 * Fetches `metadata.json`, keeps it in memory and saves it to disk.
	 *
	 * @throws When upstream answers with an error status or unparseable JSON.
	 */
	async #refreshCatalog(): Promise<Catalog> {
		const res = await this.#fetch(`${DASHBOARD_ICONS_CDN}/metadata.json`);
		if (!res.ok) {
			throw new Error(`Dashboard Icons metadata returned ${res.status}`);
		}
		const entries = parseDashboardIconsMetadata(await res.json());
		const catalog = {
			entries: new Map(entries.map((entry) => [entry.name, entry])),
			fetchedAt: this.#now(),
		};
		this.#catalog = catalog;
		await this.#writeAtomic(
			join(this.#dir(), "catalog.json"),
			JSON.stringify({ entries, fetchedAt: catalog.fetchedAt }),
		).catch((err) => {
			logger.warn("Couldn't save the Dashboard Icons catalog", err);
		});
		return catalog;
	}

	/** Writes through a temp file and a rename, so a reader never sees a half-written file. */
	async #writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
		await mkdir(join(path, ".."), { recursive: true });
		const tmp = `${path}.${this.#now()}.tmp`;
		await writeFile(tmp, data);
		await rename(tmp, path);
	}
}

export const DashboardIconsService = new DashboardIconsServiceClass();
