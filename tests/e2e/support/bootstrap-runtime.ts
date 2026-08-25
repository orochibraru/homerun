import { randomBytes } from "node:crypto";
import { runMigrations } from "../../integration/support/migrate";
import { startPostgresContainer } from "../../integration/support/postgres-container";
import { spawnApp } from "../../integration/support/server";
import { E2E_BASE_URL, E2E_PORT } from "./config";

/**
 * The actual Bun-runtime half of E2E bootstrap, run as its own child
 * process by `global-setup.ts` rather than imported directly into it.
 *
 * Why the indirection: Playwright's own CLI (`node_modules/.bin/playwright`)
 * has a `#!/usr/bin/env node` shebang, so even invoking it via `bunx` runs
 * the actual test-runner process, and therefore `globalSetup`, under plain
 * Node.js, not Bun (verified live: `bunx playwright test` still fails with
 * `Cannot find package 'bun'` the moment `globalSetup` imports anything from
 * `tests/integration/support`, which uses `Bun.SQL`/`Bun.spawn` throughout).
 * Rewriting that support code to be Bun-agnostic would risk regressing the
 * already-working integration suite for this one caller. Running this file
 * as a genuine `bun run` child process instead sidesteps the problem
 * entirely while still reusing that support code as-is.
 *
 * Prints one `READY <json>` line once the app is healthy, for the parent
 * (Node) process to key off of, then stays alive holding the Postgres
 * container and app process open until it receives SIGTERM, at which point
 * it tears both down before exiting.
 */
async function main(): Promise<void> {
	const pg = await startPostgresContainer();
	await runMigrations(pg.databaseUrl);

	const build = Bun.spawnSync(["bun", "run", "build:app"], {
		cwd: process.cwd(),
		stderr: "inherit",
		stdout: "inherit",
	});
	if (!build.success) {
		await pg.stop();
		throw new Error("bun run build:app failed, see output above");
	}

	const app = await spawnApp({
		authSecret: randomBytes(32).toString("hex"),
		baseDomain: "localhost",
		databaseUrl: pg.databaseUrl,
		origin: E2E_BASE_URL,
		port: E2E_PORT,
	});

	let shuttingDown = false;
	process.on("SIGTERM", () => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;
		void (async () => {
			await app.stop();
			await pg.stop();
			process.exit(0);
		})();
	});

	console.log(`READY ${JSON.stringify({ baseUrl: E2E_BASE_URL })}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
