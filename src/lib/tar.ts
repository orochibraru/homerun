export interface TarEntry {
	content?: Buffer | string;
	mode?: number;
	name: string;
	type: "directory" | "file";
}

const BLOCK = 512;
const NUL = String.fromCharCode(0);

/** Writes `value` as a NUL-terminated, zero-padded octal field of `length` bytes at `offset`. */
function writeOctal(
	header: Buffer,
	value: number,
	offset: number,
	length: number,
): void {
	header.write(
		`${value.toString(8).padStart(length - 1, "0")}${NUL}`,
		offset,
		length,
		"ascii",
	);
}

/**
 * Splits an entry name across ustar's 155-byte prefix and 100-byte name
 * fields at a slash when it's longer than 100 bytes.
 *
 * @throws When the name can't fit both fields.
 */
function splitName(name: string): { base: string; prefix: string } {
	if (Buffer.byteLength(name) <= 100) {
		return { base: name, prefix: "" };
	}
	const cut = name.lastIndexOf("/", name.length - 2);
	const prefix = name.slice(0, Math.max(cut, 0));
	const base = name.slice(cut + 1);
	if (
		cut < 0 ||
		Buffer.byteLength(prefix) > 155 ||
		Buffer.byteLength(base) > 100
	) {
		throw new Error(`The path "${name}" is too long for a tar archive.`);
	}
	return { base, prefix };
}

/** One 512-byte ustar header for `entry` holding `size` bytes of content. */
function headerFor(entry: TarEntry, size: number): Buffer {
	const header = Buffer.alloc(BLOCK);
	const isDirectory = entry.type === "directory";
	const { base, prefix } = splitName(
		isDirectory ? `${entry.name.replace(/\/+$/, "")}/` : entry.name,
	);
	header.write(base, 0, 100, "utf8");
	writeOctal(header, entry.mode ?? (isDirectory ? 0o755 : 0o644), 100, 8);
	writeOctal(header, 0, 108, 8);
	writeOctal(header, 0, 116, 8);
	writeOctal(header, size, 124, 12);
	writeOctal(header, Math.floor(Date.now() / 1000), 136, 12);
	header.fill(" ", 148, 156);
	header.write(isDirectory ? "5" : "0", 156, 1, "ascii");
	header.write(`ustar${NUL}00`, 257, 8, "ascii");
	header.write(prefix, 345, 155, "utf8");
	const checksum = header.reduce((sum, byte) => sum + byte, 0);
	header.write(
		`${checksum.toString(8).padStart(6, "0")}${NUL} `,
		148,
		8,
		"ascii",
	);
	return header;
}

/**
 * Builds an uncompressed ustar archive in memory from directories and files,
 * for Docker's archive endpoint (`putArchive`), which takes file content in
 * the request body rather than on a command line, so it has no size limit.
 */
export function tarArchive(entries: TarEntry[]): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		const content =
			entry.type === "directory"
				? Buffer.alloc(0)
				: Buffer.isBuffer(entry.content)
					? entry.content
					: Buffer.from(entry.content ?? "", "utf8");
		parts.push(headerFor(entry, content.length), content);
		parts.push(Buffer.alloc((BLOCK - (content.length % BLOCK)) % BLOCK));
	}
	parts.push(Buffer.alloc(BLOCK * 2));
	return Buffer.concat(parts);
}
