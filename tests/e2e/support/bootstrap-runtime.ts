import { randomBytes } from "node:crypto";
import process from "node:process";
import { runMigrations } from "../../integration/support/migrate";
import { startPostgresContainer } from "../../integration/support/postgres-container";
import { assertAppIsBuilt, spawnApp } from "../../integration/support/server";
import { E2E_BASE_URL, E2E_PORT } from "./config";

async function main(): Promise<void> {
	assertAppIsBuilt();

	const pg = await startPostgresContainer();
	await runMigrations(pg.databaseUrl);

	process.env.HOMERUN_DISABLE_AUTH_RATE_LIMIT = "1";

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
