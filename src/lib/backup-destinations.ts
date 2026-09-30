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

export interface DestinationPreset {
	endpoint?: string;
	/** Derives the endpoint from the username, for providers whose host carries the account name. */
	endpointFor?: (username: string) => string;
	endpointPlaceholder?: string;
	hint?: string;
	id: string;
	label: string;
	path?: string;
	region?: string;
	type: DestinationType;
}

export const DESTINATION_PRESETS: DestinationPreset[] = [
	{
		endpointFor: (username) =>
			username ? `${username}.your-storagebox.de:23` : "",
		hint: "Turn on SSH support for the box in Hetzner's console, and External reachability when Homerun runs outside Hetzner's network. The username is the box's (u123456) or a sub-account's (u123456-sub1); the host follows from it.",
		id: "hetzner-storage-box",
		label: "Hetzner Storage Box",
		path: "backups/homerun",
		type: "sftp",
	},
	{
		endpoint: "https://fsn1.your-objectstorage.com",
		hint: "Replace fsn1 with the bucket's own location in both the endpoint and the region.",
		id: "hetzner-object-storage",
		label: "Hetzner Object Storage",
		region: "fsn1",
		type: "s3",
	},
	{
		endpoint: "https://s3.us-east-1.amazonaws.com",
		hint: "Use the bucket's own region in both the endpoint and the region.",
		id: "aws-s3",
		label: "AWS S3",
		region: "us-east-1",
		type: "s3",
	},
	{
		endpointPlaceholder: "https://<account-id>.r2.cloudflarestorage.com",
		hint: "The endpoint carries your Cloudflare account id. The region is always auto.",
		id: "cloudflare-r2",
		label: "Cloudflare R2",
		region: "auto",
		type: "s3",
	},
	{
		endpoint: "https://s3.us-west-004.backblazeb2.com",
		hint: "The bucket's page shows its endpoint; the region is the part after s3.",
		id: "backblaze-b2",
		label: "Backblaze B2",
		region: "us-west-004",
		type: "s3",
	},
	{
		endpointPlaceholder: "http://minio:9000",
		hint: "The MinIO server's API address, not its console.",
		id: "minio",
		label: "MinIO",
		region: "us-east-1",
		type: "s3",
	},
	{
		endpointPlaceholder: "nas.local",
		hint: "The share's name comes first in the path, then a folder under it. The user needs write access to the share.",
		id: "nas-smb",
		label: "NAS share (SMB)",
		path: "backups/homerun",
		type: "smb",
	},
	{
		endpointPlaceholder: "nas.local:22",
		hint: "Turn on SSH or SFTP on the NAS first. On Synology the path starts with the shared folder, without /volume1.",
		id: "nas-sftp",
		label: "NAS over SFTP",
		path: "backups/homerun",
		type: "sftp",
	},
	{
		endpointPlaceholder:
			"https://cloud.example.com/remote.php/dav/files/<username>",
		hint: "Use an app password rather than your account's own.",
		id: "nextcloud",
		label: "Nextcloud (WebDAV)",
		path: "backups/homerun",
		type: "webdav",
	},
];
