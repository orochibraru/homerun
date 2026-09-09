import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import process from "node:process";
import * as exec from "../../../packages/installer/exec";
import { Detector } from "../../../packages/installer/steps/detect";

describe("Detector.arch", () => {
	test("matches this repo's release-asset naming, derived from process.arch", () => {
		expect(Detector.arch()).toBe(process.arch === "arm64" ? "arm64" : "amd64");
	});
});

describe("Detector.requireLinux", () => {
	test("throws off-Linux, is a no-op on Linux", () => {
		if (process.platform === "linux") {
			expect(() => Detector.requireLinux()).not.toThrow();
		} else {
			expect(() => Detector.requireLinux()).toThrow(
				new RegExp(`refusing to run on ${process.platform}`),
			);
		}
	});
});

describe("Detector.requireRoot", () => {
	test("throws when not running as uid 0, is a no-op as root", () => {
		const uid = process.getuid?.();
		if (uid === 0) {
			expect(() => Detector.requireRoot()).not.toThrow();
		} else {
			expect(() => Detector.requireRoot()).toThrow(/needs root/);
		}
	});
});

describe("Detector.detectPackageManager", () => {
	afterEach(() => {
		mock.restore();
	});

	test("prefers apt-get when present", async () => {
		spyOn(exec, "commandExists").mockImplementation(
			async (cmd: string) => cmd === "apt-get",
		);
		expect(await Detector.detectPackageManager()).toEqual({
			install: ["apt-get", "install", "-y"],
			kind: "apt",
		});
	});

	test("falls back to dnf when apt-get is absent", async () => {
		spyOn(exec, "commandExists").mockImplementation(
			async (cmd: string) => cmd === "dnf",
		);
		expect(await Detector.detectPackageManager()).toEqual({
			install: ["dnf", "install", "-y"],
			kind: "dnf",
		});
	});

	test("falls back to yum when apt-get and dnf are absent", async () => {
		spyOn(exec, "commandExists").mockImplementation(
			async (cmd: string) => cmd === "yum",
		);
		expect(await Detector.detectPackageManager()).toEqual({
			install: ["yum", "install", "-y"],
			kind: "yum",
		});
	});

	test("throws a clear error when none are found", async () => {
		spyOn(exec, "commandExists").mockImplementation(async () => false);
		await expect(Detector.detectPackageManager()).rejects.toThrow(
			/No supported package manager found/,
		);
	});
});

describe("Detector.hostAddress", () => {
	afterEach(() => {
		mock.restore();
	});

	function spawnReturning(outputs: Record<string, string>) {
		spyOn(Bun, "spawn").mockImplementation(((cmd: string[]) => {
			const stdout = outputs[cmd[0]];
			if (stdout === undefined) {
				throw new Error("ENOENT");
			}
			return {
				exited: Promise.resolve(0),
				stdout: new Response(stdout).body,
			};
		}) as unknown as typeof Bun.spawn);
	}

	test("takes the source IP of the route out to the internet", async () => {
		spawnReturning({
			hostname: "10.0.0.5 172.17.0.1\n",
			ip: "1.1.1.1 via 10.0.0.1 dev eth0 src 37.27.7.3 uid 0 \ncache\n",
		});
		expect(await Detector.hostAddress()).toBe("37.27.7.3");
	});

	test("falls back to hostname -I, and never returns loopback", async () => {
		spawnReturning({
			hostname: "127.0.0.1 192.168.1.9\n",
			ip: "1.1.1.1 dev lo src 127.0.0.1 uid 0\n",
		});
		expect(await Detector.hostAddress()).toBe("192.168.1.9");
	});

	test("returns null when neither command exists", async () => {
		spawnReturning({});
		expect(await Detector.hostAddress()).toBeNull();
	});
});
