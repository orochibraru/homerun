import {
	type DestinationType,
	describeDestination,
} from "$lib/backup-destinations";
import { DockerService } from "../docker.service.ts";
import type { BackupObject } from "../s3-backup.service.ts";

export const RCLONE_IMAGE = "rclone/rclone";
export const RCLONE_TAG = "1.75.1";

const LIST_TIMEOUT_MS = 2 * 60 * 1000;
const DIRECTORY_NOT_FOUND = 3;
const ERROR_TAIL_CHARS = 500;

const WRAPPER =
	'if [ -n "$HOMERUN_PASS" ]; then export RCLONE_CONFIG_DEST_PASS="$(printf %s "$HOMERUN_PASS" | rclone obscure -)"; fi; exec rclone "$@"';

export interface RcloneDestination {
	host: string;
	path: string;
	secret: string;
	type: Exclude<DestinationType, "s3">;
	username: string;
}

export interface RcloneRemote {
	entrypoint: string[];
	env: Record<string, string>;
	image: string;
	label: string;
	path: string;
}

interface RcloneEntry {
	ModTime?: string;
	Name: string;
	Size: number;
}

/** Splits `host:port` (or `[v6]:port`) into its two halves, port null when absent. */
export function splitHostPort(value: string): {
	host: string;
	port: string | null;
} {
	const match = value.match(/^(.*):(\d+)$/);
	const host = (match?.[1] ?? value).replace(/^\[(.*)\]$/, "$1");
	return { host, port: match?.[2] ?? null };
}

/** `path/rest` under the rclone remote, tolerating an empty or root path. */
function target(path: string, rest: string): string {
	const joined = path && rest ? `${path.replace(/\/$/, "")}/${rest}` : path;
	return `dest:${joined || rest}`;
}

/**
 * The rclone helper container that reaches `destination`: its image, the
 * environment that configures one remote named `dest`, and an entrypoint
 * that obscures the password inside the container, the form rclone wants.
 * An SFTP secret that is a PEM private key is passed as the key instead.
 */
export function rcloneRemote(destination: RcloneDestination): RcloneRemote {
	const env: Record<string, string> = {
		RCLONE_CONFIG_DEST_TYPE: destination.type,
		RCLONE_LOG_LEVEL: "ERROR",
	};
	if (destination.username) {
		env.RCLONE_CONFIG_DEST_USER = destination.username;
	}
	if (destination.type === "webdav") {
		env.RCLONE_CONFIG_DEST_URL = destination.host;
		env.RCLONE_CONFIG_DEST_VENDOR = "other";
	} else {
		const { host, port } = splitHostPort(destination.host);
		env.RCLONE_CONFIG_DEST_HOST = host;
		if (port) {
			env.RCLONE_CONFIG_DEST_PORT = port;
		}
	}
	if (destination.type === "sftp") {
		env.RCLONE_CONFIG_DEST_SHELL_TYPE = "none";
	}
	if (
		destination.type === "sftp" &&
		destination.secret.includes("-----BEGIN")
	) {
		env.RCLONE_CONFIG_DEST_KEY_PEM = destination.secret
			.trim()
			.replace(/\r?\n/g, "\\n");
	} else {
		env.HOMERUN_PASS = destination.secret;
	}
	return {
		entrypoint: ["sh", "-c", WRAPPER, "rclone"],
		env,
		image: `${RCLONE_IMAGE}:${RCLONE_TAG}`,
		label: describeDestination({
			accessKeyId: destination.username,
			bucket: destination.path,
			endpoint: destination.host,
			region: "",
			type: destination.type,
		}),
		path: destination.path,
	};
}

/**
 * The `.tar.gz` files under `remote` whose key starts with `prefix`, newest
 * first, listed by a one-off rclone container. A directory that doesn't
 * exist yet is an empty list.
 *
 * @throws When rclone can't reach or read the destination.
 */
export async function listRemoteBackups(
	remote: RcloneRemote,
	prefix: string,
): Promise<BackupObject[]> {
	const cut = prefix.lastIndexOf("/") + 1;
	const directory = prefix.slice(0, cut);
	const namePrefix = prefix.slice(cut);
	const result = await DockerService.runOneOff({
		cmd: [
			"lsjson",
			"--files-only",
			"--no-mimetype",
			target(remote.path, directory.replace(/\/$/, "")),
		],
		entrypoint: remote.entrypoint,
		envVars: remote.env,
		image: RCLONE_IMAGE,
		tag: RCLONE_TAG,
		timeoutMs: LIST_TIMEOUT_MS,
	});
	if (result.exitCode === DIRECTORY_NOT_FOUND) {
		return [];
	}
	if (result.timedOut || result.exitCode !== 0) {
		const detail = result.timedOut
			? "no answer within 2 minutes"
			: result.stderr.toString("utf8").trim().slice(-ERROR_TAIL_CHARS);
		throw new Error(`Couldn't list the backups on ${remote.label}: ${detail}`);
	}
	const entries: RcloneEntry[] = JSON.parse(result.stdout.toString("utf8"));
	return entries
		.filter(
			(entry) =>
				entry.Name.startsWith(namePrefix) && entry.Name.endsWith(".tar.gz"),
		)
		.map((entry) => ({
			key: `${directory}${entry.Name}`,
			lastModified: entry.ModTime ?? null,
			sizeBytes: entry.Size,
		}))
		.sort((a, b) => b.key.localeCompare(a.key));
}
