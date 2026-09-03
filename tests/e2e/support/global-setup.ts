import { type ChildProcess, spawn } from "node:child_process";
import process from "node:process";
import { ciTimeout } from "../../integration/support/ci";

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
