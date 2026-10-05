export interface ZipEntry {
	content: string;
	path: string;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit++) {
		value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
	}
	return value >>> 0;
});

/** The CRC-32 checksum a zip entry carries. */
export function crc32(bytes: Uint8Array): number {
	let crc = 0xff_ff_ff_ff;
	for (const byte of bytes) {
		crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

/** A date as the MS-DOS time and date words zip headers use (2-second precision). */
function dosDateTime(date: Date): { date: number; time: number } {
	return {
		date:
			((Math.max(date.getFullYear(), 1980) - 1980) << 9) |
			((date.getMonth() + 1) << 5) |
			date.getDate(),
		time:
			(date.getHours() << 11) |
			(date.getMinutes() << 5) |
			Math.floor(date.getSeconds() / 2),
	};
}

/**
 * A zip archive of text files, stored without compression: Terraform
 * configurations are a few kilobytes, so deflate wouldn't buy anything worth
 * a dependency. Names are flagged UTF-8.
 */
export function zipFiles(
	entries: ZipEntry[],
	modified = new Date(),
): Uint8Array<ArrayBuffer> {
	const encoder = new TextEncoder();
	const stamp = dosDateTime(modified);
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = encoder.encode(entry.path);
		const data = encoder.encode(entry.content);
		const crc = crc32(data);
		const local = new Uint8Array(30 + name.length + data.length);
		const localView = new DataView(local.buffer);
		localView.setUint32(0, 0x04_03_4b_50, true);
		localView.setUint16(4, 20, true);
		localView.setUint16(6, 0x08_00, true);
		localView.setUint16(8, 0, true);
		localView.setUint16(10, stamp.time, true);
		localView.setUint16(12, stamp.date, true);
		localView.setUint32(14, crc, true);
		localView.setUint32(18, data.length, true);
		localView.setUint32(22, data.length, true);
		localView.setUint16(26, name.length, true);
		localView.setUint16(28, 0, true);
		local.set(name, 30);
		local.set(data, 30 + name.length);

		const central = new Uint8Array(46 + name.length);
		const centralView = new DataView(central.buffer);
		centralView.setUint32(0, 0x02_01_4b_50, true);
		centralView.setUint16(4, 20, true);
		centralView.setUint16(6, 20, true);
		centralView.setUint16(8, 0x08_00, true);
		centralView.setUint16(10, 0, true);
		centralView.setUint16(12, stamp.time, true);
		centralView.setUint16(14, stamp.date, true);
		centralView.setUint32(16, crc, true);
		centralView.setUint32(20, data.length, true);
		centralView.setUint32(24, data.length, true);
		centralView.setUint16(28, name.length, true);
		centralView.setUint32(42, offset, true);
		central.set(name, 46);

		locals.push(local);
		centrals.push(central);
		offset += local.length;
	}
	const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
	const end = new Uint8Array(22);
	const endView = new DataView(end.buffer);
	endView.setUint32(0, 0x06_05_4b_50, true);
	endView.setUint16(8, entries.length, true);
	endView.setUint16(10, entries.length, true);
	endView.setUint32(12, centralSize, true);
	endView.setUint32(16, offset, true);

	const archive = new Uint8Array(offset + centralSize + end.length);
	let cursor = 0;
	for (const part of [...locals, ...centrals, end]) {
		archive.set(part, cursor);
		cursor += part.length;
	}
	return archive;
}
