import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as exec from "../../installer/exec";
import {
	arch,
	detectPackageManager,
	requireLinux,
	requireRoot,
} from "../../installer/steps/detect";

describe("arch", () => {
	test("matches this repo's release-asset naming, derived from process.arch", () => {
		expect(arch()).toBe(process.arch === "arm64" ? "arm64" : "amd64");
	});
});

describe("requireLinux", () => {
	test("throws off-Linux, is a no-op on Linux", () => {
		if (process.platform === "linux") {
			expect(() => requireLinux()).not.toThrow();
		} else {
			expect(() => requireLinux()).toThrow(
				new RegExp(`refusing to run on ${process.platform}`),
			);
		}
	});
});

describe("requireRoot", () => {
	test("throws when not running as uid 0, is a no-op as root", () => {
		const uid = process.getuid?.();
		if (uid === 0) {
			expect(() => requireRoot()).not.toThrow();
		} else {
			expect(() => requireRoot()).toThrow(/needs root/);
		}
	});
});

describe("detectPackageManager", () => {
	afterEach(() => {
		mock.restore();
	});

	test("prefers apt-get when present", async () => {
		spyOn(exec, "commandExists").mockImplementation(
			async (cmd: string) => cmd === "apt-get",
		);
		expect(await detectPackageManager()).toEqual({
			install: ["apt-get", "install", "-y"],
			kind: "apt",
		});
	});

	test("falls back to dnf when apt-get is absent", async () => {
		spyOn(exec, "commandExists").mockImplementation(
			async (cmd: string) => cmd === "dnf",
		);
		expect(await detectPackageManager()).toEqual({
			install: ["dnf", "install", "-y"],
			kind: "dnf",
		});
	});

	test("falls back to yum when apt-get and dnf are absent", async () => {
		spyOn(exec, "commandExists").mockImplementation(
			async (cmd: string) => cmd === "yum",
		);
		expect(await detectPackageManager()).toEqual({
			install: ["yum", "install", "-y"],
			kind: "yum",
		});
	});

	test("throws a clear error when none are found", async () => {
		spyOn(exec, "commandExists").mockImplementation(async () => false);
		await expect(detectPackageManager()).rejects.toThrow(
			/No supported package manager found/,
		);
	});
});
