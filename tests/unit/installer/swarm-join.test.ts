import { describe, expect, test } from "bun:test";

const SCRIPT = "packages/installer/swarm-join.sh";

async function runScript(
	argv: string[],
): Promise<{ code: number; stderr: string; stdout: string }> {
	const proc = Bun.spawn(["bash", SCRIPT, ...argv], {
		stderr: "pipe",
		stdin: "ignore",
		stdout: "pipe",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { code: await proc.exited, stderr, stdout };
}

describe("swarm-join.sh argument handling", () => {
	test("--help prints usage, every flag and the rootful requirement", async () => {
		const { code, stdout } = await runScript(["--help"]);
		expect(code).toBe(0);
		for (const flag of [
			"--token=",
			"--manager=",
			"--advertise-addr=",
			"--version=",
			"--user=",
		]) {
			expect(stdout).toContain(flag);
		}
		expect(stdout).toContain("rootful");
		expect(stdout).toContain("4789/udp");
	});

	test("refuses to run without both a token and a manager address", async () => {
		const missingManager = await runScript(["--token=SWMTKN-1-abc"]);
		expect(missingManager.code).toBe(1);
		expect(missingManager.stderr).toContain("--token and --manager");

		const missingToken = await runScript(["--manager=10.0.0.1:2377"]);
		expect(missingToken.code).toBe(1);
	});

	test("rejects an unknown argument before doing anything", async () => {
		const { code, stderr } = await runScript(["--bogus"]);
		expect(code).toBe(1);
		expect(stderr).toContain("unknown argument: --bogus");
	});

	test("a value flag given without a value fails instead of swallowing the next flag", async () => {
		const { code } = await runScript(["--token"]);
		expect(code).not.toBe(0);
	});
});
