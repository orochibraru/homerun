import { describe, expect, test } from "bun:test";

const { crc32, zipFiles } = await import("../../../src/lib/server/zip");

function entries(archive: Uint8Array): { name: string; content: string }[] {
	const view = new DataView(archive.buffer, archive.byteOffset);
	const end = archive.length - 22;
	expect(view.getUint32(end, true)).toBe(0x06_05_4b_50);
	const count = view.getUint16(end + 10, true);
	let central = view.getUint32(end + 16, true);
	const decoder = new TextDecoder();
	const found: { name: string; content: string }[] = [];
	for (let index = 0; index < count; index++) {
		expect(view.getUint32(central, true)).toBe(0x02_01_4b_50);
		const size = view.getUint32(central + 24, true);
		const nameLength = view.getUint16(central + 28, true);
		const local = view.getUint32(central + 42, true);
		const name = decoder.decode(
			archive.slice(central + 46, central + 46 + nameLength),
		);
		const data = archive.slice(
			local + 30 + nameLength,
			local + 30 + nameLength + size,
		);
		expect(view.getUint32(central + 16, true)).toBe(crc32(data));
		found.push({ content: decoder.decode(data), name });
		central += 46 + nameLength;
	}
	return found;
}

describe("crc32", () => {
	test("matches the standard check value", () => {
		expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcb_f4_39_26);
		expect(crc32(new Uint8Array())).toBe(0);
	});
});

describe("zipFiles", () => {
	test("stores every file under its path, UTF-8 included", () => {
		const archive = zipFiles([
			{ content: "terraform {}\n", path: "lab/versions.tf" },
			{ content: "héllo ✓\n", path: "lab/README.md" },
		]);
		expect(entries(archive)).toEqual([
			{ content: "terraform {}\n", name: "lab/versions.tf" },
			{ content: "héllo ✓\n", name: "lab/README.md" },
		]);
	});

	test("an empty archive is just the end record", () => {
		expect(zipFiles([]).length).toBe(22);
	});
});
