import { createHash } from "node:crypto";
import {
	lifecycleExpirationDays,
	lifecycleXml,
	USAGE_OBJECT_CAP,
} from "#lib/object-storage.js";
import { expectS3Ok, type S3Credentials, s3Fetch } from "./signer.ts";

export interface BucketSummary {
	createdAt: string | null;
	name: string;
}

export interface BucketUsage {
	bytes: number;
	capped: boolean;
	objects: number;
}

const PAGE_SIZE = 1000;

function tagValue(xml: string, tag: string): string | null {
	return xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] ?? null;
}

function blocks(xml: string, tag: string): string[] {
	return [
		...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g")),
	].map((match) => match[1]);
}

/**
 * Bucket-level S3 calls against one store (AWS, Garage, MinIO, Hetzner, any
 * S3-compatible endpoint), signed with SigV4 and parsed from the XML by hand,
 * so no SDK is needed.
 */
export class ObjectStoreClient {
	readonly #credentials: S3Credentials;
	readonly #fetch: typeof fetch;

	constructor(credentials: S3Credentials, fetcher: typeof fetch = fetch) {
		this.#credentials = credentials;
		this.#fetch = fetcher;
	}

	/**
	 * Every bucket the credentials can see, by name.
	 *
	 * @throws When the store refuses or can't be reached.
	 */
	async listBuckets(): Promise<BucketSummary[]> {
		const response = await s3Fetch(
			this.#credentials,
			{ method: "GET", path: "/" },
			this.#fetch,
		);
		await expectS3Ok(response, "ListBuckets");
		return blocks(await response.text(), "Bucket")
			.map((bucket) => ({
				createdAt: tagValue(bucket, "CreationDate"),
				name: tagValue(bucket, "Name") ?? "",
			}))
			.filter((bucket) => bucket.name)
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Creates a bucket, in the store's region when that isn't AWS's default
	 * one, which is the only region that refuses an explicit constraint.
	 *
	 * @throws With the store's own error, e.g. a name already taken.
	 */
	async createBucket(name: string): Promise<void> {
		const region = this.#credentials.region;
		const body =
			region && region !== "us-east-1"
				? `<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>${region}</LocationConstraint></CreateBucketConfiguration>`
				: undefined;
		await expectS3Ok(
			await s3Fetch(
				this.#credentials,
				{ body, method: "PUT", path: `/${name}` },
				this.#fetch,
			),
			"CreateBucket",
		);
	}

	/**
	 * Deletes an empty bucket.
	 *
	 * @throws With a plain message when the bucket still holds objects, the
	 *   store's own error otherwise.
	 */
	async deleteBucket(name: string): Promise<void> {
		const response = await s3Fetch(
			this.#credentials,
			{ method: "DELETE", path: `/${name}` },
			this.#fetch,
		);
		if (response.status === 409) {
			throw new Error(
				`${name} still holds objects. Empty it first, then delete it.`,
			);
		}
		await expectS3Ok(response, "DeleteBucket");
	}

	/**
	 * How many objects a bucket holds and their total size, listing at most
	 * `cap` objects so a huge bucket can't stall the page: `capped` says the
	 * real numbers are higher.
	 *
	 * @throws When the bucket can't be listed.
	 */
	async usage(name: string, cap = USAGE_OBJECT_CAP): Promise<BucketUsage> {
		let objects = 0;
		let bytes = 0;
		let token: string | null = null;
		do {
			const query: Record<string, string> = {
				"list-type": "2",
				"max-keys": String(PAGE_SIZE),
			};
			if (token) {
				query["continuation-token"] = token;
			}
			// oxlint-disable-next-line no-await-in-loop -- each page needs the previous page's continuation token
			const response = await s3Fetch(
				this.#credentials,
				{ method: "GET", path: `/${name}`, query },
				this.#fetch,
			);
			// oxlint-disable-next-line no-await-in-loop -- same page as above
			await expectS3Ok(response, "ListObjectsV2");
			// oxlint-disable-next-line no-await-in-loop -- same page as above
			const xml = await response.text();
			for (const entry of blocks(xml, "Contents")) {
				objects += 1;
				bytes += Number.parseInt(tagValue(entry, "Size") ?? "0", 10);
			}
			token =
				tagValue(xml, "IsTruncated") === "true"
					? tagValue(xml, "NextContinuationToken")
					: null;
		} while (token && objects < cap);
		return { bytes, capped: token !== null, objects };
	}

	/**
	 * The days after which the bucket expires objects, or null when it has
	 * no expiring lifecycle rule.
	 *
	 * @throws When the store refuses the request for another reason.
	 */
	async expirationDays(name: string): Promise<number | null> {
		const response = await s3Fetch(
			this.#credentials,
			{ method: "GET", path: `/${name}`, query: { lifecycle: "" } },
			this.#fetch,
		);
		if (response.status === 404) {
			return null;
		}
		await expectS3Ok(response, "GetBucketLifecycleConfiguration");
		return lifecycleExpirationDays(await response.text());
	}

	/**
	 * Expires every object `days` after it was written, or removes the
	 * lifecycle configuration when `days` is null. Replaces whatever
	 * lifecycle rules the bucket had.
	 *
	 * @throws With the store's own error.
	 */
	async setExpirationDays(name: string, days: number | null): Promise<void> {
		if (days === null) {
			await expectS3Ok(
				await s3Fetch(
					this.#credentials,
					{ method: "DELETE", path: `/${name}`, query: { lifecycle: "" } },
					this.#fetch,
				),
				"DeleteBucketLifecycle",
			);
			return;
		}
		const body = lifecycleXml(days);
		await expectS3Ok(
			await s3Fetch(
				this.#credentials,
				{
					body,
					headers: {
						"content-md5": createHash("md5").update(body).digest("base64"),
						"content-type": "application/xml",
					},
					method: "PUT",
					path: `/${name}`,
					query: { lifecycle: "" },
				},
				this.#fetch,
			),
			"PutBucketLifecycleConfiguration",
		);
	}

	/**
	 * An object's body as text, or null when it doesn't exist.
	 *
	 * @throws When the store refuses the request for another reason.
	 */
	async getObject(bucket: string, key: string): Promise<string | null> {
		const response = await s3Fetch(
			this.#credentials,
			{ method: "GET", path: `/${bucket}/${key}` },
			this.#fetch,
		);
		if (response.status === 404) {
			return null;
		}
		await expectS3Ok(response, "GetObject");
		return await response.text();
	}

	/**
	 * Writes an object, replacing any object at the same key.
	 *
	 * @throws With the store's own error.
	 */
	async putObject(
		bucket: string,
		key: string,
		body: string,
		contentType = "application/octet-stream",
	): Promise<void> {
		await expectS3Ok(
			await s3Fetch(
				this.#credentials,
				{
					body,
					headers: { "content-type": contentType },
					method: "PUT",
					path: `/${bucket}/${key}`,
				},
				this.#fetch,
			),
			"PutObject",
		);
	}
}
