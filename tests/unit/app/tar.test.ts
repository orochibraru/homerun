import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tarArchive } from "../../../src/lib/tar";

function extract(archive: Buffer): string {
	const dir = mkdtempSync(join(tmpdir(), "homerun-tar-"));
	writeFileSync(join(dir, "archive.tar"), archive);
	const result = Bun.spawnSync(["tar", "-xf", "archive.tar"], { cwd: dir });
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.toString());
	}
	return dir;
}

describe("tarArchive", () => {
	test("round-trips directories and files through the system tar", () => {
		const big = "x".repeat(300_000);
		const dir = extract(
			tarArchive([
				{ name: "app", type: "directory" },
				{ content: "key: value\n", name: "app/1-config-yml", type: "file" },
				{ content: big, name: "app/2-large", type: "file" },
				{ content: "", name: "app/3-empty", type: "file" },
			]),
		);
		try {
			expect(readFileSync(join(dir, "app/1-config-yml"), "utf8")).toBe(
				"key: value\n",
			);
			expect(readFileSync(join(dir, "app/2-large"), "utf8")).toBe(big);
			expect(readFileSync(join(dir, "app/3-empty"), "utf8")).toBe("");
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("puts a long path's directories in the prefix field", () => {
		const name = `${"deep/".repeat(30)}file`;
		const dir = extract(tarArchive([{ content: "ok", name, type: "file" }]));
		try {
			expect(readFileSync(join(dir, name), "utf8")).toBe("ok");
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
		expect(() =>
			tarArchive([{ content: "", name: "a".repeat(120), type: "file" }]),
		).toThrow("too long");
	});

	test("pads to 512-byte blocks and ends with two empty blocks", () => {
		const archive = tarArchive([{ content: "hi", name: "f", type: "file" }]);
		expect(archive.length).toBe(512 * 4);
	});
});
