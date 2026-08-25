import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandExists, StepRunner } from "../../../packages/installer/exec";

describe("StepRunner dry-run mode", () => {
	let logSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		logSpy = spyOn(console, "log").mockImplementation(() => undefined);
	});

	afterEach(() => {
		mock.restore();
	});

	test("run() never actually spawns the command", async () => {
		const runner = new StepRunner(true);
		// A command that would fail loudly if it were actually executed.
		const result = await runner.run(["false"]);
		expect(result).toEqual({ code: 0, stderr: "", stdout: "" });
	});

	test("run() logs the command with a [dry-run] prefix", async () => {
		const runner = new StepRunner(true);
		await runner.run(["echo", "hello"]);
		const logged = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(logged).toContain("[dry-run] echo hello");
	});

	test("wraps a command with sudo -u when `as` is given", async () => {
		const runner = new StepRunner(true);
		await runner.run(["docker", "ps"], { as: "homerun" });
		const logged = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(logged).toContain("[dry-run] sudo -u homerun -- docker ps");
	});

	test("threads `env` through an explicit `env K=V` prefix inside the sudo'd command", async () => {
		const runner = new StepRunner(true);
		await runner.run(["docker", "ps"], {
			as: "homerun",
			env: { DOCKER_HOST: "unix:///tmp/docker.sock" },
		});
		const logged = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(logged).toContain(
			"sudo -u homerun -- env DOCKER_HOST=unix:///tmp/docker.sock docker ps",
		);
	});

	test("logs the cwd when given", async () => {
		const runner = new StepRunner(true);
		await runner.run(["ls"], { cwd: "/tmp" });
		const logged = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(logged).toContain("(cwd=/tmp)");
	});

	test("writeFile is a no-op that just logs", async () => {
		const runner = new StepRunner(true);
		const workDir = await mkdtemp(join(tmpdir(), "homerun-installer-exec-"));
		const path = join(workDir, "should-not-exist");

		await runner.writeFile(path, "hello world");

		expect(await Bun.file(path).exists()).toBe(false);
		const logged = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(logged).toContain("[dry-run]");
		expect(logged).toContain(path);
		await rm(workDir, { force: true, recursive: true });
	});
});

describe("StepRunner real execution", () => {
	test("run() captures stdout and returns exit code 0 on success", async () => {
		const runner = new StepRunner(false);
		const result = await runner.run(["sh", "-c", "echo hi"]);
		expect(result.code).toBe(0);
		expect(result.stdout.trim()).toBe("hi");
	});

	test("run() throws with the exit code on failure", async () => {
		const runner = new StepRunner(false);
		await expect(runner.run(["sh", "-c", "exit 3"])).rejects.toThrow(
			/command failed \(3\)/,
		);
	});

	test("runOk() returns true on success", async () => {
		const runner = new StepRunner(false);
		expect(await runner.runOk(["sh", "-c", "exit 0"])).toBe(true);
	});

	test("runOk() swallows a failure and returns false", async () => {
		const runner = new StepRunner(false);
		expect(await runner.runOk(["sh", "-c", "exit 1"])).toBe(false);
	});

	test("writeFile() actually writes the file with the given content", async () => {
		const runner = new StepRunner(false);
		const workDir = await mkdtemp(join(tmpdir(), "homerun-installer-exec-"));
		const path = join(workDir, "unit.txt");

		await runner.writeFile(path, "hello world");

		expect(await readFile(path, "utf8")).toBe("hello world");
		await rm(workDir, { force: true, recursive: true });
	});
});

describe("commandExists", () => {
	test("is true for a command that's actually on PATH", async () => {
		expect(await commandExists("sh")).toBe(true);
	});

	test("is false for a made-up command", async () => {
		expect(await commandExists("totally-not-a-real-command-xyz")).toBe(false);
	});
});
