import { splitImageRef } from "$lib/image-ref";
import { mirrorRepository } from "./image-scan-refs.ts";

export const MANIFEST_ACCEPT = [
	"application/vnd.oci.image.index.v1+json",
	"application/vnd.docker.distribution.manifest.list.v2+json",
	"application/vnd.oci.image.manifest.v1+json",
	"application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

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

/** Whether `name` matches the Docker Distribution repository-name grammar (lowercase, `/`-separated path segments). */
export function isValidRepository(name: string): boolean {
	return REPOSITORY_RE.test(name);
}

/** Whether `digest` is a well-formed `sha256:<64 hex chars>` content digest. */
export function isValidDigest(digest: string): boolean {
	return DIGEST_RE.test(digest);
}

function digestRepository(ref: ImageDigestRef): MirrorDigest {
	const { image, tag } = splitImageRef(ref.imageRef);
	return { digest: ref.digest, repository: mirrorRepository(image, tag) };
}

/**
 * Computes what a mirror garbage-collection pass must keep, across a set of
 * services: each service's currently-deployed tag and digests, plus its
 * `scansPerService` most recent distinct scanned digests. Entries with a
 * malformed digest or repository name are dropped.
 */
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

/** The next page's path+query from a `Link: <...>; rel="next"` response header, or null when there's no next page. */
export function nextCatalogPath(link: string | null): string | null {
	const next = NEXT_LINK_RE.exec(link ?? "")?.[1];
	if (!next) {
		return null;
	}
	const url = new URL(next, "http://mirror");
	return `${url.pathname}${url.search}`;
}

/** Parses the leading number from `du -sk`-style output and converts it to bytes; null when it isn't parseable. */
export function parseDuKilobytes(output: string): number | null {
	const value = Number.parseInt(output.trim().split(/\s+/)[0] ?? "", 10);
	return Number.isFinite(value) ? value * 1024 : null;
}

export class MirrorRegistryClient {
	readonly #baseUrl: string;
	readonly #fetch: FetchLike;
	readonly #authorization: string | null;

	constructor(
		baseUrl: string,
		fetchImpl: FetchLike = fetch,
		auth: { password: string; username: string } | null = null,
	) {
		this.#baseUrl = baseUrl.replace(/\/+$/, "");
		this.#fetch = fetchImpl;
		this.#authorization = auth
			? `Basic ${btoa(`${auth.username}:${auth.password}`)}`
			: null;
	}

	/**
	 * Issues a fetch against the mirror's base URL with the client's Basic
	 * credentials when it has any, defaulting to a 30s abort timeout when
	 * `init` doesn't supply its own signal.
	 */
	async #request(path: string, init?: RequestInit): Promise<Response> {
		const headers = new Headers(init?.headers);
		if (this.#authorization) {
			headers.set("Authorization", this.#authorization);
		}
		return await this.#fetch(`${this.#baseUrl}${path}`, {
			...init,
			headers,
			signal: init?.signal ?? AbortSignal.timeout(30_000),
		});
	}

	/**
	 * @throws Always: an Error describing `what` failed, folding in the
	 *   response's status and (truncated) body text.
	 */
	async #fail(response: Response, what: string): Promise<never> {
		const body = await response.text().catch(() => "");
		throw new Error(
			`${what} failed: HTTP ${response.status}${body ? ` ${body.trim().slice(0, 200)}` : ""}`,
		);
	}

	/** Whether the mirror's registry API answers `/v2/` within a short (3s) timeout. */
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

	/**
	 * Lists every repository in the mirror, paging through `_catalog` via
	 * its `Link` header, filtered to well-formed repository names.
	 *
	 * @throws When a catalog page request fails.
	 */
	async catalog(): Promise<string[]> {
		const repositories: string[] = [];
		let path: string | null = `/v2/_catalog?n=${CATALOG_PAGE_SIZE}`;
		while (path) {
			// oxlint-disable-next-line no-await-in-loop -- catalog pages are chained by the Link header
			const response = await this.#request(path);
			if (!response.ok) {
				// oxlint-disable-next-line no-await-in-loop -- catalog pages are chained by the Link header
				await this.#fail(response, "Listing the mirror's repositories");
			}
			// oxlint-disable-next-line no-await-in-loop -- catalog pages are chained by the Link header
			const body = (await response.json()) as {
				repositories?: string[] | null;
			};
			repositories.push(...(body.repositories ?? []));
			path = nextCatalogPath(response.headers.get("link"));
		}
		return repositories.filter(isValidRepository);
	}

	/**
	 * A repository's tags. Returns an empty array for a repository that
	 * doesn't exist (404) rather than throwing.
	 *
	 * @throws On any other failed response.
	 */
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

	/**
	 * Resolves `repository:reference` to its content digest via a manifest
	 * HEAD request. Null when the reference doesn't exist (404).
	 *
	 * @throws On any other failed response.
	 */
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

	/**
	 * Resolves every tag of `repository` to its digest, one HEAD request at
	 * a time (kept sequential to be idle-friendly to the registry), skipping
	 * any tag whose digest couldn't be resolved.
	 */
	async inventory(repository: string): Promise<MirrorTag[]> {
		const entries: MirrorTag[] = [];
		for (const tag of await this.tags(repository)) {
			// oxlint-disable-next-line no-await-in-loop -- one HEAD at a time keeps the registry idle-friendly
			const digest = await this.digest(repository, tag);
			if (digest) {
				entries.push({ digest, repository, tag });
			}
		}
		return entries;
	}

	/**
	 * Deletes a manifest by digest. Returns false when it's already gone
	 * (404) rather than throwing.
	 *
	 * @throws On any other failed response.
	 */
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
