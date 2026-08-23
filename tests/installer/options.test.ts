import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { parseArgs, printHelp } from "../../installer/options";

describe("parseArgs", () => {
	test("defaults when no flags are given", () => {
		expect(parseArgs([])).toEqual({
			agentPort: 7420,
			dryRun: false,
			mode: "agent",
			rootlessUser: "homerun",
			version: "latest",
			yes: false,
		});
	});

	test("--dry-run sets dryRun", () => {
		expect(parseArgs(["--dry-run"]).dryRun).toBe(true);
	});

	test("--yes and -y both set yes", () => {
		expect(parseArgs(["--yes"]).yes).toBe(true);
		expect(parseArgs(["-y"]).yes).toBe(true);
	});

	test("--mode=full and --mode=agent set mode", () => {
		expect(parseArgs(["--mode=full"]).mode).toBe("full");
		expect(parseArgs(["--mode=agent"]).mode).toBe("agent");
	});

	test("--user=<name> overrides rootlessUser", () => {
		expect(parseArgs(["--user=myuser"]).rootlessUser).toBe("myuser");
	});

	test("--version=<tag> overrides version", () => {
		expect(parseArgs(["--version=v1.2.3"]).version).toBe("v1.2.3");
	});

	test("--port=<n> overrides agentPort", () => {
		expect(parseArgs(["--port=9000"]).agentPort).toBe(9000);
	});

	test("combines multiple flags", () => {
		const opts = parseArgs([
			"--dry-run",
			"--mode=full",
			"--user=alice",
			"--version=v2.0.0",
			"--port=8080",
			"--yes",
		]);
		expect(opts).toEqual({
			agentPort: 8080,
			dryRun: true,
			mode: "full",
			rootlessUser: "alice",
			version: "v2.0.0",
			yes: true,
		});
	});
});

describe("parseArgs exit paths", () => {
	let exitSpy: ReturnType<typeof spyOn>;
	let logSpy: ReturnType<typeof spyOn>;
	let errorSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		exitSpy = spyOn(process, "exit").mockImplementation(
			(() => undefined) as never,
		);
		logSpy = spyOn(console, "log").mockImplementation(() => undefined);
		errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
	});

	afterEach(() => {
		mock.restore();
	});

	test("--help prints help and exits 0", () => {
		parseArgs(["--help"]);
		expect(logSpy).toHaveBeenCalled();
		expect(logSpy.mock.calls[0][0]).toContain("homerun-install");
		expect(exitSpy).toHaveBeenCalledWith(0);
	});

	test("-h behaves the same as --help", () => {
		parseArgs(["-h"]);
		expect(exitSpy).toHaveBeenCalledWith(0);
	});

	test("an unknown argument prints an error and exits 1", () => {
		parseArgs(["--bogus"]);
		expect(errorSpy).toHaveBeenCalled();
		expect(errorSpy.mock.calls[0][0]).toContain("Unknown argument: --bogus");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});

describe("printHelp", () => {
	test("mentions every documented flag", () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
		printHelp();
		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		logSpy.mockRestore();

		for (const flag of [
			"--version=",
			"--mode=agent|full",
			"--user=",
			"--port=",
			"--dry-run",
			"--yes",
		]) {
			expect(output).toContain(flag);
		}
	});
});
