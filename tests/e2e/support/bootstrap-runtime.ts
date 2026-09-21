import { randomBytes } from "node:crypto";
import process from "node:process";
import {
	imageUnderTest,
	startAppContainer,
	startWorkerContainer,
} from "../../integration/support/app-container";
import { runMigrations } from "../../integration/support/migrate";
import { getFreePort } from "../../integration/support/port";
import { startTestPostgres } from "../../integration/support/postgres";
import { spawnWorker } from "../../integration/support/processes";
import { assertAppIsBuilt, spawnApp } from "../../integration/support/server";
import { E2E_BASE_URL, E2E_PORT } from "./config";

async function main(): Promise<void> {
	const image = imageUnderTest();
	if (!image) {
		assertAppIsBuilt();
	}

	const pg = await startTestPostgres();
	await runMigrations(pg.databaseUrl);

	process.env.HOMERUN_DISABLE_AUTH_RATE_LIMIT = "1";

	const workerPort = getFreePort();
	const options = {
		authSecret: randomBytes(32).toString("hex"),
		baseDomain: "localhost",
		databaseUrl: pg.databaseUrl,
		origin: E2E_BASE_URL,
		port: E2E_PORT,
		workerUrl: `http://localhost:${workerPort}`,
	};
	const worker = image
		? await startWorkerContainer(image, options)
		: spawnWorker({ ...options, port: workerPort });
	if (!image) {
		await (worker as ReturnType<typeof spawnWorker>).ready();
	}
	const app = image
		? await startAppContainer(image, options)
		: await spawnApp(options);

	let shuttingDown = false;
	process.on("SIGTERM", () => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;
		void (async () => {
			await app.stop();
			await worker.stop();
			await pg.stop();
			process.exit(0);
		})();
	});

	console.log(
		`READY ${JSON.stringify({ baseUrl: E2E_BASE_URL, image: image ?? null })}`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
