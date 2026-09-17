import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { isRootlessDaemon } = await import(
	"../../../src/lib/services/docker/swarm"
);

describe("isRootlessDaemon", () => {
	test("spots the rootless marker a rootless daemon reports", () => {
		expect(
			isRootlessDaemon([
				"name=seccomp,profile=builtin",
				"name=rootless",
				"name=cgroupns",
			]),
		).toBe(true);
	});

	test("is false for a system daemon", () => {
		expect(
			isRootlessDaemon([
				"name=apparmor,profile=default",
				"name=seccomp,profile=builtin",
				"name=cgroupns",
			]),
		).toBe(false);
	});

	test("is false when docker info carries no security options", () => {
		expect(isRootlessDaemon(undefined)).toBe(false);
		expect(isRootlessDaemon([])).toBe(false);
	});

	test("matches the whole option, not a substring of another one", () => {
		expect(isRootlessDaemon(["name=seccomp,profile=rootless-custom"])).toBe(
			false,
		);
	});
});
