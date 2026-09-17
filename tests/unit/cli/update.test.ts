import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import process from "node:process";
import { UpdateService } from "../../../packages/cli/update";

/**
 * `UpdateService.update()` is heavily side-effecting past its first guard clauses (real
 * network calls to GitHub, replacing the running binary), so this only
 * exercises the fast, deterministic fail-fast paths that are actually true
 * in every environment this suite runs in : `bun test` always runs via the
 * `bun` runtime itself (never a `bun build --compile`d binary).
 *
 * `fail()` (cli/output.ts) is typed `never` because it calls `process.exit`,
 * which truly never returns in production ; a no-op `process.exit` mock
 * would let execution fall through to the *next* guard (and eventually a
 * real network call), so the mock here throws instead, faithfully modeling
 * "this call never returns" for the purposes of this test.
 */
class ExitCalled extends Error {
	constructor(public code: number) {
		super(`process.exit(${code})`);
	}
}

describe("update", () => {
	afterEach(() => {
		mock.restore();
	});

	test("fails fast without any network calls, on whichever guard applies to this environment", async () => {
		const errorSpy = spyOn(console, "error").mockImplementation(
			() => undefined,
		);
		spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new ExitCalled(code ?? 0);
		}) as never);
		const fetchSpy = spyOn(globalThis, "fetch");

		await expect(UpdateService.update()).rejects.toThrow(ExitCalled);

		expect(fetchSpy).not.toHaveBeenCalled();
		const message = errorSpy.mock.calls[0]?.[0] as string;
		if (process.platform !== "linux" && process.platform !== "darwin") {
			expect(message).toContain("only supports Linux and macOS");
		} else {
			// Running via `bun test`, process.execPath is the `bun` runtime
			// itself, never a compiled `homerun` binary.
			expect(message).toContain("only works on the installed binary");
		}
	});
});

/**
 * `#currentArch` is private, so these drive it through the public
 * `update()` entry point, past the platform/compiled-binary guards
 * `process.platform`/`process.execPath` are overridden with
 * `Object.defineProperty` (both are plain, configurable properties on Bun's
 * `process`) so the arch guard is reached deterministically regardless of
 * what this suite actually runs on. Mirrors
 * `packages/installer/steps/detect.ts`'s `arch()`, see
 * `.agents/notes/packages-and-release.md`.
 */
describe("update arch detection", () => {
	const originalArch = process.arch;
	const originalPlatform = process.platform;
	const originalExecPath = process.execPath;

	afterEach(() => {
		mock.restore();
		Object.defineProperty(process, "arch", {
			configurable: true,
			value: originalArch,
		});
		Object.defineProperty(process, "platform", {
			configurable: true,
			value: originalPlatform,
		});
		Object.defineProperty(process, "execPath", {
			configurable: true,
			value: originalExecPath,
		});
	});

	function asCompiledLinuxBinary(arch: string): void {
		Object.defineProperty(process, "platform", {
			configurable: true,
			value: "linux",
		});
		Object.defineProperty(process, "execPath", {
			configurable: true,
			value: "/usr/local/bin/homerun",
		});
		Object.defineProperty(process, "arch", { configurable: true, value: arch });
	}

	test("maps x64 to amd64 and reaches the network step", async () => {
		asCompiledLinuxBinary("x64");
		spyOn(console, "log").mockImplementation(() => undefined);
		const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("network disabled in test"),
		);
		spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new ExitCalled(code ?? 0);
		}) as never);

		await expect(UpdateService.update()).rejects.toThrow(ExitCalled);
		expect(fetchSpy).toHaveBeenCalledWith(
			expect.stringContaining("api.github.com"),
		);
	});

	test("maps arm64 to arm64 and reaches the network step", async () => {
		asCompiledLinuxBinary("arm64");
		spyOn(console, "log").mockImplementation(() => undefined);
		const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("network disabled in test"),
		);
		spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new ExitCalled(code ?? 0);
		}) as never);

		await expect(UpdateService.update()).rejects.toThrow(ExitCalled);
		expect(fetchSpy).toHaveBeenCalledWith(
			expect.stringContaining("api.github.com"),
		);
	});

	test("fails fast on an unsupported architecture, before any network call", async () => {
		asCompiledLinuxBinary("ia32");
		const errorSpy = spyOn(console, "error").mockImplementation(
			() => undefined,
		);
		const fetchSpy = spyOn(globalThis, "fetch");
		spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new ExitCalled(code ?? 0);
		}) as never);

		await expect(UpdateService.update()).rejects.toThrow(ExitCalled);

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(errorSpy.mock.calls[0]?.[0]).toContain(
			'Unsupported architecture "ia32"',
		);
	});
});
