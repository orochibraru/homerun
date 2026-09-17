import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import process from "node:process";
import {
	dockerFlavourOf,
	OptionsParser,
} from "../../../packages/installer/options";

describe("OptionsParser.parseArgs", () => {
	test("defaults when no flags are given", () => {
		expect(OptionsParser.parseArgs([])).toEqual({
			agentPort: 7420,
			dryRun: false,
			migrateToRootful: false,
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

	test("--docker=rootful and --docker=rootless set docker", () => {
		expect(OptionsParser.parseArgs(["--docker=rootful"]).docker).toBe(
			"rootful",
		);
		expect(
			OptionsParser.parseArgs(["--docker=rootful", "--docker=rootless"]).docker,
		).toBe("rootless");
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
			migrateToRootful: false,
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
			"--docker=rootless|rootful",
			"--advertise-addr=",
			"--migrate-to-rootful",
			"--image=",
			"--user=",
			"--port=",
			"--dry-run",
			"--yes",
		]) {
			expect(output).toContain(flag);
		}
	});
});

describe("OptionsParser.parseArgs --domain", () => {
	test("is unset by default and takes the value verbatim", () => {
		expect(OptionsParser.parseArgs([]).domain).toBeUndefined();
		expect(
			OptionsParser.parseArgs(["--domain=https://homerun.example.com/"]).domain,
		).toBe("https://homerun.example.com/");
	});
});

describe("OptionsParser.parseArgs swarm and migration flags", () => {
	test("--advertise-addr and --image take their values", () => {
		const opts = OptionsParser.parseArgs([
			"--advertise-addr=10.0.0.5",
			"--image=homerun:local",
		]);
		expect(opts.advertiseAddress).toBe("10.0.0.5");
		expect(opts.image).toBe("homerun:local");
	});

	test("--migrate-to-rootful implies a full install", () => {
		const opts = OptionsParser.parseArgs(["--migrate-to-rootful"]);
		expect(opts.migrateToRootful).toBe(true);
		expect(opts.mode).toBe("full");
	});
});

describe("dockerFlavourOf", () => {
	test("a full install defaults to the system daemon", () => {
		expect(dockerFlavourOf(OptionsParser.parseArgs(["--mode=full"]))).toBe(
			"rootful",
		);
	});

	test("a full install can opt into rootless", () => {
		expect(
			dockerFlavourOf(
				OptionsParser.parseArgs(["--mode=full", "--docker=rootless"]),
			),
		).toBe("rootless");
	});

	test("the agent always runs rootless", () => {
		expect(dockerFlavourOf(OptionsParser.parseArgs([]))).toBe("rootless");
	});
});

describe("OptionsParser.validate", () => {
	test("accepts rootful Docker for a full install", () => {
		expect(
			OptionsParser.validate(
				OptionsParser.parseArgs(["--mode=full", "--docker=rootful"]),
			),
		).toBeNull();
	});

	test("rejects an explicit daemon for an agent install", () => {
		expect(
			OptionsParser.validate(OptionsParser.parseArgs(["--docker=rootful"])),
		).toContain("--docker=rootful only applies to --mode=full");
		expect(
			OptionsParser.validate(OptionsParser.parseArgs(["--docker=rootless"])),
		).toContain("--docker=rootless only applies to --mode=full");
	});

	test("rejects migrating to rootful while asking for rootless", () => {
		expect(
			OptionsParser.validate(
				OptionsParser.parseArgs(["--migrate-to-rootful", "--docker=rootless"]),
			),
		).toContain("drop --docker=rootless");
	});

	test("rejects --advertise-addr without a swarm to advertise", () => {
		expect(
			OptionsParser.validate(
				OptionsParser.parseArgs([
					"--mode=full",
					"--docker=rootless",
					"--advertise-addr=10.0.0.5",
				]),
			),
		).toContain("--advertise-addr only applies");
		expect(
			OptionsParser.validate(
				OptionsParser.parseArgs(["--mode=full", "--advertise-addr=10.0.0.5"]),
			),
		).toBeNull();
	});

	test("accepts the defaults and a plain migration", () => {
		expect(OptionsParser.validate(OptionsParser.parseArgs([]))).toBeNull();
		expect(
			OptionsParser.validate(OptionsParser.parseArgs(["--migrate-to-rootful"])),
		).toBeNull();
	});
});
