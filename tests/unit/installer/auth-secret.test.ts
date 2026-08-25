import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StepRunner } from "../../../packages/installer/exec";
import { AuthSecretInstaller } from "../../../packages/installer/steps/auth-secret";

/**
 * `#hasAuthSecret` reads `.env` directly via `Bun.file` (not through
 * `StepRunner`, see the class's own comment), so these tests use a real
 * scratch directory rather than a fake runner for that half ; the mutating
 * half (`appendLine`/`run`) is still faked, same "fakes over mocking
 * libraries" convention as tests/unit/installer/network.test.ts.
 */
let dirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		dirs.map((dir) => rm(dir, { force: true, recursive: true })),
	);
	dirs = [];
});

async function scratchDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "homerun-auth-secret-"));
	dirs.push(dir);
	return dir;
}

function fakeRunner() {
	const run = mock(async () => ({ code: 0, stderr: "", stdout: "" }));
	const appendLine = mock(async (path: string, line: string) => {
		await Bun.write(path, `${line}\n`);
	});
	return { appendLine, run } as unknown as StepRunner;
}

describe("AuthSecretInstaller.ensureAuthSecret", () => {
	test("generates and persists a secret when .env doesn't exist yet", async () => {
		const composeDir = await scratchDir();
		const runner = fakeRunner();

		await AuthSecretInstaller.ensureAuthSecret(runner, "homerun", composeDir);

		const envPath = `${composeDir}/.env`;
		expect(
			(runner.appendLine as ReturnType<typeof mock>).mock.calls,
		).toHaveLength(1);
		const [path, line] = (runner.appendLine as ReturnType<typeof mock>).mock
			.calls[0] as [string, string];
		expect(path).toBe(envPath);
		expect(line).toMatch(/^AUTH_SECRET=[0-9a-f]{64}$/);

		expect(runner.run).toHaveBeenCalledWith(["chmod", "600", envPath]);
		expect(runner.run).toHaveBeenCalledWith([
			"chown",
			"homerun:homerun",
			envPath,
		]);
	});

	test("never overwrites an already-generated or admin-set secret", async () => {
		const composeDir = await scratchDir();
		const envPath = `${composeDir}/.env`;
		await Bun.write(envPath, "AUTH_SECRET=admin-chosen-value\nOTHER=1\n");
		const runner = fakeRunner();

		await AuthSecretInstaller.ensureAuthSecret(runner, "homerun", composeDir);

		expect(runner.appendLine).not.toHaveBeenCalled();
		expect(runner.run).not.toHaveBeenCalled();
		expect(await Bun.file(envPath).text()).toBe(
			"AUTH_SECRET=admin-chosen-value\nOTHER=1\n",
		);
	});

	test("treats a .env with other vars but no AUTH_SECRET as needing one generated", async () => {
		const composeDir = await scratchDir();
		const envPath = `${composeDir}/.env`;
		await Bun.write(envPath, "POSTGRES_PASSWORD=changeme\n");
		const runner = fakeRunner();

		await AuthSecretInstaller.ensureAuthSecret(runner, "homerun", composeDir);

		expect(runner.appendLine).toHaveBeenCalledTimes(1);
	});
});
