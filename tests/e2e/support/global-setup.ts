import { type ChildProcess, spawn } from "node:child_process";
import { ciTimeout } from "../../integration/support/ci";

/**
 * Boots a real app against a real, throwaway Postgres for this suite to
 * drive with a real browser. The actual work (starting Postgres, migrating,
 * building, spawning the app) happens in `bootstrap-runtime.ts`, run here as
 * a genuine `bun run` child process rather than imported directly — see that
 * file's own comment for why (Playwright's test runner itself runs under
 * Node, not Bun, even when launched via `bunx`, and that support code is
 * Bun-only). This process just spawns that child, waits for its `READY`
 * line, and returns a teardown function (Playwright's own documented
 * pattern for a `globalSetup` that needs to clean up after itself) that
 * signals it to shut down.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
	const child = spawn(
		"bun",
		["run", "tests/e2e/support/bootstrap-runtime.ts"],
		{
			cwd: process.cwd(),
			env: process.env,
			stdio: ["ignore", "pipe", "inherit"],
		},
	);

	await waitForReady(child);

	return async () => {
		await stop(child);
	};
}

/** Resolves once `bootstrap-runtime.ts` prints its `READY` line, or rejects if it exits first. */
function waitForReady(child: ChildProcess): Promise<void> {
	return new Promise((resolveReady, reject) => {
		let buffered = "";
		const onData = (chunk: Buffer) => {
			process.stdout.write(chunk);
			buffered += chunk.toString();
			if (buffered.includes("READY ")) {
				child.stdout?.off("data", onData);
				resolveReady();
			}
		};
		child.stdout?.on("data", onData);
		child.once("exit", (code) => {
			reject(new Error(`E2E bootstrap exited early (code ${code})`));
		});
		setTimeout(
			() => reject(new Error("E2E bootstrap never became ready in time")),
			ciTimeout(90_000, 180_000),
		);
	});
}

/** Sends SIGTERM and waits for the bootstrap process to actually exit (it tears down Postgres/the app itself on receiving it, see bootstrap-runtime.ts). */
function stop(child: ChildProcess): Promise<void> {
	return new Promise((resolveStopped) => {
		if (child.exitCode !== null) {
			resolveStopped();
			return;
		}
		child.once("exit", () => resolveStopped());
		child.kill("SIGTERM");
	});
}
