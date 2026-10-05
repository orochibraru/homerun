export interface GarageBucketKey {
	accessKeyId: string;
	name: string;
	permissions: GaragePermissions;
}

export interface GarageBucketInfo {
	bytes: number;
	id: string;
	keys: GarageBucketKey[];
	name: string;
	objects: number;
}

export interface GarageNewKey {
	accessKeyId: string;
	name: string;
	secretAccessKey: string;
}

export interface GaragePermissions {
	owner: boolean;
	read: boolean;
	write: boolean;
}

interface NodeStatus {
	id: string;
	role: unknown;
}

interface RawBucketInfo {
	bytes?: number;
	globalAliases?: string[];
	id: string;
	keys?: {
		accessKeyId: string;
		name?: string;
		permissions?: Partial<GaragePermissions>;
	}[];
	objects?: number;
}

const DEFAULT_CAPACITY_BYTES = 1_000_000_000_000;

/**
 * Garage's admin API (v2): the cluster layout a fresh single node needs
 * before it serves anything, buckets with a global alias every key can use,
 * and access keys with per-bucket permissions.
 */
export class GarageAdminClient {
	readonly #baseUrl: string;
	readonly #fetch: typeof fetch;
	readonly #token: string;

	constructor(baseUrl: string, token: string, fetcher: typeof fetch = fetch) {
		this.#baseUrl = baseUrl.replace(/\/+$/, "");
		this.#token = token;
		this.#fetch = fetcher;
	}

	/**
	 * Calls one admin operation and returns its JSON body.
	 *
	 * @throws With Garage's own message when the call fails.
	 */
	async #call<T>(
		method: "GET" | "POST",
		operation: string,
		options: { body?: unknown; query?: Record<string, string> } = {},
	): Promise<T> {
		const url = new URL(`${this.#baseUrl}/v2/${operation}`);
		for (const [key, value] of Object.entries(options.query ?? {})) {
			url.searchParams.set(key, value);
		}
		const response = await this.#fetch(url, {
			headers: {
				authorization: `Bearer ${this.#token}`,
				"content-type": "application/json",
			},
			method,
			...(method === "POST"
				? { body: JSON.stringify(options.body ?? {}) }
				: {}),
		});
		const text = await response.text();
		if (!response.ok) {
			let message = text;
			try {
				message = (JSON.parse(text) as { message?: string }).message ?? text;
			} catch {
				message = text;
			}
			throw new Error(
				`Garage ${operation} failed (${response.status}): ${message}`,
			);
		}
		return (text ? JSON.parse(text) : null) as T;
	}

	/** Whether the node answers its health check, which it only does once it has a layout. */
	async healthy(): Promise<boolean> {
		const response = await this.#fetch(`${this.#baseUrl}/health`).catch(
			() => null,
		);
		return response?.ok === true;
	}

	/**
	 * Gives the single node a role and applies the layout when it has none
	 * yet, which a fresh Garage needs before it stores anything. A node that
	 * already has a role is left alone.
	 *
	 * @throws When the admin API refuses.
	 */
	async ensureLayout(capacityBytes = DEFAULT_CAPACITY_BYTES): Promise<void> {
		const status = await this.#call<{
			layoutVersion: number;
			nodes: NodeStatus[];
		}>("GET", "GetClusterStatus");
		const node = status.nodes[0];
		if (!node || node.role) {
			return;
		}
		await this.#call("POST", "UpdateClusterLayout", {
			body: {
				roles: [
					{ capacity: capacityBytes, id: node.id, tags: [], zone: "homerun" },
				],
			},
		});
		await this.#call("POST", "ApplyClusterLayout", {
			body: { version: status.layoutVersion + 1 },
		});
	}

	/**
	 * A bucket's id, usage and keys, or null when no bucket has that name.
	 *
	 * @throws When the admin API fails for another reason.
	 */
	async bucket(name: string): Promise<GarageBucketInfo | null> {
		const raw = await this.#call<RawBucketInfo>("GET", "GetBucketInfo", {
			query: { globalAlias: name },
		}).catch((err: unknown) => {
			if (err instanceof Error && err.message.includes("(404)")) {
				return null;
			}
			throw err;
		});
		return raw ? toBucketInfo(raw, name) : null;
	}

	/**
	 * Every bucket with a global alias, by name.
	 *
	 * @throws When the admin API refuses.
	 */
	async bucketNames(): Promise<string[]> {
		const buckets = await this.#call<{ globalAliases?: string[] }[]>(
			"GET",
			"ListBuckets",
		);
		return buckets
			.flatMap((bucket) => bucket.globalAliases ?? [])
			.sort((a, b) => a.localeCompare(b));
	}

	/**
	 * Creates a bucket under a global alias and gives `ownerKeyId` full
	 * access to it.
	 *
	 * @throws With Garage's message, e.g. when the name is taken.
	 */
	async createBucket(name: string, ownerKeyId: string): Promise<void> {
		const created = await this.#call<{ id: string }>("POST", "CreateBucket", {
			body: { globalAlias: name },
		});
		await this.allow(created.id, ownerKeyId, {
			owner: true,
			read: true,
			write: true,
		});
	}

	/**
	 * Deletes an empty bucket.
	 *
	 * @throws With a plain message when it still holds objects, Garage's own
	 *   otherwise.
	 */
	async deleteBucket(name: string): Promise<void> {
		const info = await this.bucket(name);
		if (!info) {
			return;
		}
		if (info.objects > 0) {
			throw new Error(
				`${name} still holds objects. Empty it first, then delete it.`,
			);
		}
		await this.#call("POST", "DeleteBucket", { query: { id: info.id } });
	}

	/**
	 * Creates an access key, returning its secret, the only time Garage
	 * hands it out through this client.
	 *
	 * @throws When the admin API refuses.
	 */
	async createKey(name: string): Promise<GarageNewKey> {
		const key = await this.#call<GarageNewKey>("POST", "CreateKey", {
			body: { name },
		});
		return {
			accessKeyId: key.accessKeyId,
			name: key.name,
			secretAccessKey: key.secretAccessKey,
		};
	}

	/**
	 * Deletes an access key, revoking every permission it had.
	 *
	 * @throws When the admin API refuses.
	 */
	async deleteKey(accessKeyId: string): Promise<void> {
		await this.#call("POST", "DeleteKey", { query: { id: accessKeyId } });
	}

	/**
	 * Grants `accessKeyId` the given permissions on a bucket, adding to what
	 * it already had.
	 *
	 * @throws When the admin API refuses.
	 */
	async allow(
		bucketId: string,
		accessKeyId: string,
		permissions: GaragePermissions,
	): Promise<void> {
		await this.#call("POST", "AllowBucketKey", {
			body: { accessKeyId, bucketId, permissions },
		});
	}
}

/** Garage's bucket info shape, narrowed to what Homerun shows. */
export function toBucketInfo(
	raw: RawBucketInfo,
	name: string,
): GarageBucketInfo {
	return {
		bytes: raw.bytes ?? 0,
		id: raw.id,
		keys: (raw.keys ?? []).map((key) => ({
			accessKeyId: key.accessKeyId,
			name: key.name ?? "",
			permissions: {
				owner: key.permissions?.owner === true,
				read: key.permissions?.read === true,
				write: key.permissions?.write === true,
			},
		})),
		name: raw.globalAliases?.[0] ?? name,
		objects: raw.objects ?? 0,
	};
}
