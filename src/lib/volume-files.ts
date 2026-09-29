export const MAX_EDITABLE_BYTES = 1024 * 1024;

const ENV_CHUNK = 96 * 1024;

export interface VolumeEntry {
	kind: "directory" | "file" | "link" | "other";
	mode: string;
	modifiedAt: string;
	name: string;
	size: number;
}

/**
 * A path inside a volume, relative to its root, with `.` segments and extra
 * slashes dropped. Null when it climbs out with `..` or holds a NUL byte, so
 * nothing outside the volume is ever addressed. Empty is the root itself.
 */
export function normalizeVolumePath(raw: string): string | null {
	if (raw.includes("\0")) {
		return null;
	}
	const segments = raw.split("/").filter((s) => s !== "" && s !== ".");
	return segments.includes("..") ? null : segments.join("/");
}

/**
 * Whether `name` is a single entry name to create inside a folder: not empty,
 * no slash or NUL, not `.`/`..`, and within Linux's 255-byte limit.
 */
export function isEntryName(name: string): boolean {
	return (
		name !== "" &&
		name !== "." &&
		name !== ".." &&
		!/[/\0]/.test(name) &&
		new TextEncoder().encode(name).length <= 255
	);
}

/** Whether `mode` is an octal permission mode `chmod` takes, like `644` or `2775`. */
export function isOctalMode(mode: string): boolean {
	return /^[0-7]{3,4}$/.test(mode);
}

/** The parent of a normalized volume path, "" at the root. */
export function parentPath(path: string): string {
	return path.split("/").slice(0, -1).join("/");
}

function kindOf(type: string): VolumeEntry["kind"] {
	if (type === "directory") {
		return "directory";
	}
	if (type.startsWith("regular")) {
		return "file";
	}
	return type === "symbolic link" ? "link" : "other";
}

/**
 * Parses the helper's `stat -c '%F|%s|%Y|%a|%n'` lines into entries, directories
 * first then by name. The name is the last field, so one containing `|` still
 * parses.
 */
export function parseListing(output: string): VolumeEntry[] {
	const entries: VolumeEntry[] = [];
	for (const line of output.split("\n")) {
		const [type, size, mtime, mode, ...rest] = line.split("|");
		const name = rest.join("|").split("/").pop() ?? "";
		if (!(type && name) || name === "." || name === "..") {
			continue;
		}
		entries.push({
			kind: kindOf(type),
			mode: mode ?? "",
			modifiedAt: new Date(Number(mtime) * 1000).toISOString(),
			name,
			size: Number(size) || 0,
		});
	}
	return entries.sort((a, b) =>
		a.kind === b.kind
			? a.name.localeCompare(b.name)
			: a.kind === "directory"
				? -1
				: b.kind === "directory"
					? 1
					: a.name.localeCompare(b.name),
	);
}

/** Whether `bytes` look like text worth editing: no NUL byte and valid UTF-8. */
export function isEditableText(bytes: Uint8Array): boolean {
	if (bytes.includes(0)) {
		return false;
	}
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}

/**
 * Splits `content` into base64 environment variables `C0`, `C1`, … each well
 * under Linux's 128 KB limit on a single one, for the write helper to join
 * back.
 */
export function contentChunks(content: string): Record<string, string> {
	const encoded = Buffer.from(content, "utf8").toString("base64");
	const chunks: Record<string, string> = {};
	for (let i = 0; i * ENV_CHUNK < encoded.length; i += 1) {
		chunks[`C${i}`] = encoded.slice(i * ENV_CHUNK, (i + 1) * ENV_CHUNK);
	}
	return chunks;
}
