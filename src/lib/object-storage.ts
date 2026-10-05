export type ObjectStoreKind = "garage" | "s3";

export const BUILTIN_STORE_NAME = "Built-in (Garage)";

export const GARAGE_REGION = "garage";

export const USAGE_OBJECT_CAP = 10_000;

const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const IP_LIKE_RE = /^\d+\.\d+\.\d+\.\d+$/;
const EXPIRATION_DAYS_RE =
	/<Rule>[\s\S]*?<Status>Enabled<\/Status>[\s\S]*?<Expiration>\s*<Days>(\d+)<\/Days>/;

export const LIFECYCLE_RULE_ID = "homerun-expire";

export const MAX_EXPIRATION_DAYS = 36_500;

/**
 * Why `name` can't be an S3 bucket name, or null when it can: 3 to 63
 * lowercase letters, digits, dots and dashes, starting and ending with a
 * letter or digit, never two dots in a row and never shaped like an IP.
 */
export function bucketNameProblem(name: string): string | null {
	if (!BUCKET_NAME_RE.test(name) || name.includes("..")) {
		return "A bucket name is 3 to 63 lowercase letters, digits, dots or dashes, starting and ending with a letter or digit.";
	}
	if (IP_LIKE_RE.test(name)) {
		return "A bucket name can't look like an IP address.";
	}
	return null;
}

/**
 * Why `value` can't be an object store endpoint, or null when it can: an
 * http(s) URL with no path, query or credentials.
 */
export function endpointProblem(value: string): string | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return "The endpoint is a URL like https://s3.eu-central-1.amazonaws.com.";
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		return "The endpoint has to start with https:// or http://.";
	}
	if (url.username || url.password || url.search || url.pathname !== "/") {
		return "The endpoint is just the scheme and host, with no path, query or credentials.";
	}
	return null;
}

/**
 * The bucket lifecycle configuration that expires every object `days` after
 * it was written, as the XML body PutBucketLifecycleConfiguration takes.
 */
export function lifecycleXml(days: number): string {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
		"<Rule>",
		`<ID>${LIFECYCLE_RULE_ID}</ID>`,
		"<Filter><Prefix></Prefix></Filter>",
		"<Status>Enabled</Status>",
		`<Expiration><Days>${days}</Days></Expiration>`,
		"</Rule>",
		"</LifecycleConfiguration>",
	].join("");
}

/**
 * The expiry in days of the first enabled rule in a lifecycle configuration,
 * or null when no enabled rule expires objects.
 */
export function lifecycleExpirationDays(xml: string): number | null {
	const match = xml.match(EXPIRATION_DAYS_RE);
	return match ? Number.parseInt(match[1], 10) : null;
}

/** "1,234 objects" for a count, "10,000+ objects" once it hit the listing cap. */
export function objectCountLabel(objects: number, capped: boolean): string {
	const count = objects.toLocaleString("en-US");
	return `${count}${capped ? "+" : ""} ${objects === 1 && !capped ? "object" : "objects"}`;
}
