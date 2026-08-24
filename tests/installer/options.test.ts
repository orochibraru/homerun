import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { OptionsParser } from "../../installer/options";

describe("OptionsParser.parseArgs", () => {
	test("defaults when no flags are given", () => {
		expect(OptionsParser.parseArgs([])).toEqual({
			agentPort: 7420,
			dryRun: false,
			mode: "agent",
			rootlessUser: "homerun",
			version: "latest",
			yes: false,
		});
	});

	test("--dry-run sets dryRun", () => {
		expect(OptionsParser.parseArgs(["--dry-run"]).dryRun).toBe(true);
	});

	test("--yes and -y both set yes", () => {
		expect(OptionsParser.parseArgs(["--yes"]).yes).toBe(true);
		expect(OptionsParser.parseArgs(["-y"]).yes).toBe(true);
	});

	test("--mode=full and --mode=agent set mode", () => {
		expect(OptionsParser.parseArgs(["--mode=full"]).mode).toBe("full");
		expect(OptionsParser.parseArgs(["--mode=agent"]).mode).toBe("agent");
	});

	test("--user=<name> overrides rootlessUser", () => {
		expect(OptionsParser.parseArgs(["--user=myuser"]).rootlessUser).toBe(
			"myuser",
		);
	});

	test("--version=<tag> overrides version", () => {
		expect(OptionsParser.parseArgs(["--version=v1.2.3"]).version).toBe(
			"v1.2.3",
		);
	});

	test("--port=<n> overrides agentPort", () => {
		expect(OptionsParser.parseArgs(["--port=9000"]).agentPort).toBe(9000);
	});

	test("combines multiple flags", () => {
		const opts = OptionsParser.parseArgs([
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

describe("OptionsParser.parseArgs exit paths", () => {
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
		OptionsParser.parseArgs(["--help"]);
		expect(logSpy).toHaveBeenCalled();
		expect(logSpy.mock.calls[0][0]).toContain("homerun-install");
		expect(exitSpy).toHaveBeenCalledWith(0);
	});

	test("-h behaves the same as --help", () => {
		OptionsParser.parseArgs(["-h"]);
		expect(exitSpy).toHaveBeenCalledWith(0);
	});

	test("an unknown argument prints an error and exits 1", () => {
		OptionsParser.parseArgs(["--bogus"]);
		expect(errorSpy).toHaveBeenCalled();
		expect(errorSpy.mock.calls[0][0]).toContain("Unknown argument: --bogus");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});

describe("OptionsParser.printHelp", () => {
	test("mentions every documented flag", () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
		OptionsParser.printHelp();
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
