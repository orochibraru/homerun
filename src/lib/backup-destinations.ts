export const DESTINATION_TYPES = ["s3", "sftp", "smb", "webdav"] as const;

export type DestinationType = (typeof DESTINATION_TYPES)[number];

export const DESTINATION_TYPE_LABELS: Record<DestinationType, string> = {
	s3: "S3-compatible bucket",
	sftp: "SFTP (SSH)",
	smb: "SMB share",
	webdav: "WebDAV",
};

export interface DestinationSummary {
	accessKeyId: string;
	bucket: string;
	endpoint: string;
	region: string;
	type: DestinationType;
}

/** Narrows a submitted form value to a destination type, null when it isn't one. */
export function parseDestinationType(value: unknown): DestinationType | null {
	return DESTINATION_TYPES.find((type) => type === value) ?? null;
}

/**
 * Where a destination points, for a list row and a run's log: an S3 row's
 * endpoint, bucket and region, or `sftp://user@host/path` for the others.
 */
export function describeDestination(destination: DestinationSummary): string {
	if (destination.type === "s3") {
		return `${destination.endpoint} · ${destination.bucket} · ${destination.region}`;
	}
	const path = destination.bucket.replace(/^\/+/, "");
	if (destination.type === "webdav") {
		return [destination.endpoint.replace(/\/+$/, ""), path]
			.filter(Boolean)
			.join("/");
	}
	return `${destination.type}://${destination.accessKeyId}@${destination.endpoint}/${path}`;
}

export interface DestinationFields {
	endpointLabel: string;
	endpointPlaceholder: string;
	hint: string;
	pathLabel: string;
	pathPlaceholder: string;
	pathRequired: boolean;
}

export const DESTINATION_FIELDS: Record<
	Exclude<DestinationType, "s3">,
	DestinationFields
> = {
	sftp: {
		endpointLabel: "Host",
		endpointPlaceholder: "u123456.your-storagebox.de:23",
		hint: "Anything with SSH access: a NAS, a VPS, a Hetzner Storage Box (port 23). The server's host key isn't verified.",
		pathLabel: "Path",
		pathPlaceholder: "backups/homerun",
		pathRequired: false,
	},
	smb: {
		endpointLabel: "Host",
		endpointPlaceholder: "nas.local",
		hint: "A Windows or Samba share, the kind a NAS exports. SMB 2 and 3 only.",
		pathLabel: "Share and path",
		pathPlaceholder: "backups/homerun",
		pathRequired: true,
	},
	webdav: {
		endpointLabel: "URL",
		endpointPlaceholder: "https://u123456.your-storagebox.de",
		hint: "Any WebDAV server: a Hetzner Storage Box with WebDAV turned on, Nextcloud, a NAS.",
		pathLabel: "Path",
		pathPlaceholder: "backups/homerun",
		pathRequired: false,
	},
};
