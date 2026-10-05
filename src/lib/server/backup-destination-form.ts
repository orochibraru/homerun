import {
	type DestinationType,
	parseDestinationType,
} from "#lib/backup-destinations.js";

export interface ParsedDestinationForm {
	accessKeyId: string;
	bucket: string;
	endpoint: string;
	name: string;
	region: string;
	secretAccessKey: string;
	type: DestinationType;
}

export type DestinationFormResult =
	| { error: string }
	| { parsed: ParsedDestinationForm };

/** Where the fields come from: the form's FormData, or a Map built from a JSON body. */
export interface DestinationFields {
	get(name: string): unknown;
}

function field(formData: DestinationFields, name: string): string {
	const value = formData.get(name);
	return typeof value === "string" ? value.trim() : "";
}

function normalisePath(type: DestinationType, path: string): string {
	const trimmed = path === "/" ? path : path.replace(/\/+$/, "");
	return type === "sftp" ? trimmed : trimmed.replace(/^\/+/, "");
}

function validate(
	parsed: ParsedDestinationForm,
	keepSecret: boolean,
): string | null {
	const { accessKeyId, bucket, endpoint, name, region, secretAccessKey, type } =
		parsed;
	if (type === "s3") {
		if (
			!(
				name &&
				endpoint &&
				bucket &&
				region &&
				accessKeyId &&
				(secretAccessKey || keepSecret)
			)
		) {
			return "Every field is required.";
		}
		return URL.canParse(endpoint) ? null : "Endpoint must be a full URL.";
	}
	if (!(name && endpoint && accessKeyId)) {
		return "Name, host and username are required.";
	}
	if (!(secretAccessKey || keepSecret)) {
		return type === "sftp"
			? "Give a password or a private key."
			: "The password is required.";
	}
	if (type === "webdav") {
		return /^https?:\/\//.test(endpoint) && URL.canParse(endpoint)
			? null
			: "URL must start with http:// or https://.";
	}
	if (/[/\s]/.test(endpoint)) {
		return "Host is a hostname or an address, with an optional :port.";
	}
	if (type === "smb" && !bucket) {
		return "Give the share's name, then an optional path under it.";
	}
	return null;
}

/**
 * Validates a submitted backup destination form and maps it onto the
 * destination row's columns: an SFTP, SMB or WebDAV destination keeps its
 * host or URL in `endpoint`, its path in `bucket`, its username in
 * `accessKeyId` and its password, or an SFTP private key when one was
 * pasted, in `secretAccessKey`.
 *
 * @param options.keepSecret Editing an existing destination: a blank secret
 *   is allowed and means the stored one stays.
 * @returns The parsed fields, or the first validation error message.
 */
export function parseDestinationForm(
	formData: DestinationFields,
	options: { keepSecret?: boolean } = {},
): DestinationFormResult {
	const type = parseDestinationType(field(formData, "type") || "s3");
	if (!type) {
		return { error: "Unknown destination type." };
	}
	const path = field(formData, "bucket");
	const parsed: ParsedDestinationForm = {
		accessKeyId: field(formData, "accessKeyId"),
		bucket: type === "s3" ? path : normalisePath(type, path),
		endpoint: field(formData, "endpoint"),
		name: field(formData, "name"),
		region: type === "s3" ? field(formData, "region") : "",
		secretAccessKey:
			(type === "sftp" && field(formData, "privateKey")) ||
			field(formData, "secretAccessKey"),
		type,
	};
	const error = validate(parsed, options.keepSecret ?? false);
	return error ? { error } : { parsed };
}
