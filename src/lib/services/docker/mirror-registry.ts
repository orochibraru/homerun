import { mirrorRepository } from "./image-scan-refs.ts";

export const MANIFEST_ACCEPT = [
	"application/vnd.oci.image.index.v1+json",
	"application/vnd.docker.distribution.manifest.list.v2+json",
	"application/vnd.oci.image.manifest.v1+json",
	"application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

export const KEEP_TAG_PREFIX = "homerun-keep-";
export const MIRROR_GC_SCANS_PER_SERVICE = 2;

const CATALOG_PAGE_SIZE = 1000;
const NEXT_LINK_RE = /<([^>]+)>;\s*rel="next"/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const REPOSITORY_RE =
	/^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$/;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RepositoryRef {
	repository: string;
}

export interface MirrorTag extends RepositoryRef {
	digest: string;
	tag: string;
}

export interface MirrorDigest extends RepositoryRef {
	digest: string;
}

export interface MirrorKeepSet {
	digests: MirrorDigest[];
	tags: Array<RepositoryRef & { tag: string }>;
}

export interface MirrorGcPlan {
	deletes: MirrorDigest[];
	emptiedRepositories: string[];
	keptManifests: number;
	pins: MirrorTag[];
}

export interface ServiceMirrorReference {
	deployed: ImageDigestRef[];
	image: string;
	scans: ImageDigestRef[];
	tag: string;
}

export interface ImageDigestRef {
	digest: string;
	imageRef: string;
}

export function isValidRepository(name: string): boolean {
	return REPOSITORY_RE.test(name);
}

export function isValidDigest(digest: string): boolean {
	return DIGEST_RE.test(digest);
}

export function splitImageRef(ref: string): { image: string; tag: string } {
	const bare = ref.split("@")[0] ?? ref;
	const colon = bare.lastIndexOf(":");
	if (colon > bare.lastIndexOf("/")) {
		return { image: bare.slice(0, colon), tag: bare.slice(colon + 1) };
	}
	return { image: bare, tag: "latest" };
}

export function keepTagFor(digest: string): string {
	return `${KEEP_TAG_PREFIX}${digest.replace("sha256:", "").slice(0, 32)}`;
}

function digestRepository(ref: ImageDigestRef): MirrorDigest {
	const { image, tag } = splitImageRef(ref.imageRef);
	return { digest: ref.digest, repository: mirrorRepository(image, tag) };
}

export function mirrorKeepSet(
	references: ServiceMirrorReference[],
	scansPerService = MIRROR_GC_SCANS_PER_SERVICE,
): MirrorKeepSet {
	const tags: MirrorKeepSet["tags"] = [];
	const digests: MirrorDigest[] = [];
	for (const reference of references) {
		tags.push({
			repository: mirrorRepository(reference.image, reference.tag),
			tag: reference.tag,
		});
		for (const revision of reference.deployed) {
			digests.push(digestRepository(revision));
		}
		const recent = new Set<string>();
		for (const scan of reference.scans) {
			if (recent.size >= scansPerService) {
				break;
			}
			if (!recent.has(scan.digest)) {
				recent.add(scan.digest);
				digests.push(digestRepository(scan));
			}
		}
	}
	return {
		digests: digests.filter(
			(entry) =>
				isValidDigest(entry.digest) && isValidRepository(entry.repository),
		),
		tags,
	};
}

function key(repository: string, value: string): string {
	return `${repository}@${value}`;
}

export function planMirrorGc(
	inventory: MirrorTag[],
	repositories: string[],
	keep: MirrorKeepSet,
): MirrorGcPlan {
	const keptTags = new Set(
		keep.tags.map((entry) => key(entry.repository, entry.tag)),
	);
	const keptDigests = new Set(
		keep.digests.map((entry) => key(entry.repository, entry.digest)),
	);
	for (const entry of inventory) {
		if (keptTags.has(key(entry.repository, entry.tag))) {
			keptDigests.add(key(entry.repository, entry.digest));
		}
	}

	const tagged = new Set(
		inventory.map((entry) => key(entry.repository, entry.digest)),
	);
	const deletes = new Map<string, MirrorDigest>();
	for (const entry of inventory) {
		const id = key(entry.repository, entry.digest);
		if (!keptDigests.has(id)) {
			deletes.set(id, { digest: entry.digest, repository: entry.repository });
		}
	}

	const known = new Set(repositories);
	const pins = new Map<string, MirrorTag>();
	for (const entry of keep.digests) {
		const id = key(entry.repository, entry.digest);
		if (known.has(entry.repository) && !tagged.has(id)) {
			pins.set(id, { ...entry, tag: keepTagFor(entry.digest) });
		}
	}

	const survivors = new Set<string>();
	for (const id of keptDigests) {
		const [repository] = id.split("@");
		if (tagged.has(id) || pins.has(id)) {
			survivors.add(repository);
		}
	}

	const keptTagged = [...keptDigests].filter((id) => tagged.has(id)).length;
	return {
		deletes: [...deletes.values()],
		emptiedRepositories: repositories.filter((name) => !survivors.has(name)),
		keptManifests: keptTagged + pins.size,
		pins: [...pins.values()],
	};
}

export function nextCatalogPath(link: string | null): string | null {
	const next = NEXT_LINK_RE.exec(link ?? "")?.[1];
	if (!next) {
		return null;
	}
	const url = new URL(next, "http://mirror");
	return `${url.pathname}${url.search}`;
}

export function parseDuKilobytes(output: string): number | null {
	const value = Number.parseInt(output.trim().split(/\s+/)[0] ?? "", 10);
	return Number.isFinite(value) ? value * 1024 : null;
}

export class MirrorRegistryClient {
	readonly #baseUrl: string;
	readonly #fetch: FetchLike;

	constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
		this.#baseUrl = baseUrl.replace(/\/+$/, "");
		this.#fetch = fetchImpl;
	}

	async #request(path: string, init?: RequestInit): Promise<Response> {
		return await this.#fetch(`${this.#baseUrl}${path}`, {
			...init,
			signal: init?.signal ?? AbortSignal.timeout(30_000),
		});
	}

	async #fail(response: Response, what: string): Promise<never> {
		const body = await response.text().catch(() => "");
		throw new Error(
			`${what} failed: HTTP ${response.status}${body ? ` ${body.trim().slice(0, 200)}` : ""}`,
		);
	}

	async ping(): Promise<boolean> {
		try {
			const response = await this.#request("/v2/", {
				signal: AbortSignal.timeout(3000),
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	async catalog(): Promise<string[]> {
		const repositories: string[] = [];
		let path: string | null = `/v2/_catalog?n=${CATALOG_PAGE_SIZE}`;
		while (path) {
			// biome-ignore lint/performance/noAwaitInLoops: catalog pages are chained by the Link header
			const response = await this.#request(path);
			if (!response.ok) {
				await this.#fail(response, "Listing the mirror's repositories");
			}
			const body = (await response.json()) as {
				repositories?: string[] | null;
			};
			repositories.push(...(body.repositories ?? []));
			path = nextCatalogPath(response.headers.get("link"));
		}
		return repositories.filter(isValidRepository);
	}

	async tags(repository: string): Promise<string[]> {
		const response = await this.#request(`/v2/${repository}/tags/list`);
		if (response.status === 404) {
			return [];
		}
		if (!response.ok) {
			await this.#fail(response, `Listing tags of ${repository}`);
		}
		const body = (await response.json()) as { tags?: string[] | null };
		return body.tags ?? [];
	}

	async digest(repository: string, reference: string): Promise<string | null> {
		const response = await this.#request(
			`/v2/${repository}/manifests/${reference}`,
			{ headers: { Accept: MANIFEST_ACCEPT }, method: "HEAD" },
		);
		if (response.status === 404) {
			return null;
		}
		if (!response.ok) {
			await this.#fail(response, `Resolving ${repository}:${reference}`);
		}
		return response.headers.get("docker-content-digest");
	}

	async inventory(repository: string): Promise<MirrorTag[]> {
		const entries: MirrorTag[] = [];
		for (const tag of await this.tags(repository)) {
			// biome-ignore lint/performance/noAwaitInLoops: one HEAD at a time keeps the registry idle-friendly
			const digest = await this.digest(repository, tag);
			if (digest) {
				entries.push({ digest, repository, tag });
			}
		}
		return entries;
	}

	async tagManifest(entry: MirrorTag): Promise<boolean> {
		const source = await this.#request(
			`/v2/${entry.repository}/manifests/${entry.digest}`,
			{ headers: { Accept: MANIFEST_ACCEPT } },
		);
		if (source.status === 404) {
			return false;
		}
		if (!source.ok) {
			await this.#fail(source, `Reading ${entry.repository}@${entry.digest}`);
		}
		const body = await source.arrayBuffer();
		const response = await this.#request(
			`/v2/${entry.repository}/manifests/${entry.tag}`,
			{
				body,
				headers: {
					"Content-Type":
						source.headers.get("content-type") ??
						"application/vnd.docker.distribution.manifest.v2+json",
				},
				method: "PUT",
			},
		);
		if (!response.ok) {
			await this.#fail(response, `Tagging ${entry.repository}:${entry.tag}`);
		}
		return true;
	}

	async deleteManifest(entry: MirrorDigest): Promise<boolean> {
		const response = await this.#request(
			`/v2/${entry.repository}/manifests/${entry.digest}`,
			{ method: "DELETE" },
		);
		if (response.status === 404) {
			return false;
		}
		if (!response.ok) {
			await this.#fail(
				response,
				`Deleting ${entry.repository}@${entry.digest}`,
			);
		}
		return true;
	}
}
