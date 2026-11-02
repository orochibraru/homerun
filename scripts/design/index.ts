import { mkdir } from "node:fs/promises";
import process from "node:process";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import Bun from "bun";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { startMockWorker } from "./mock-worker";
import { DESIGN_ACCOUNT, seedDesignData } from "./seed";

const DB_PORT = Number(process.env.DESIGN_DB_PORT ?? 54_329);
const WORKER_PORT = Number(process.env.DESIGN_WORKER_PORT ?? 54_330);
const APP_PORT = Number(process.env.DESIGN_PORT ?? 5174);
const ORIGIN = `http://localhost:${APP_PORT}`;

const paint = (code: number, text: string) =>
	process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
const say = (line: string) => console.log(`${paint(36, "[design]")} ${line}`);

/** Polls `url` until it answers 2xx, or throws after `timeoutMs`. */
async function waitFor(url: string, timeoutMs = 120_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		// oxlint-disable-next-line no-await-in-loop -- polling one attempt at a time
		const ok = await fetch(url)
			.then((response) => response.ok)
			.catch(() => false);
		if (ok) {
			return;
		}
		// oxlint-disable-next-line no-await-in-loop -- polling one attempt at a time
		await Bun.sleep(500);
	}
	throw new Error(`${url} didn't answer within ${timeoutMs / 1000}s`);
}

await mkdir("node_modules/.cache/homerun/design-traefik", { recursive: true });
say("starting an in-memory Postgres (PGlite), nothing is kept between runs");
const pglite = await PGlite.create({ extensions: { pg_trgm } });
await migrate(drizzle(pglite), { migrationsFolder: "drizzle" });
await seedDesignData(pglite);
say("database migrated and seeded");
const dbServer = new PGLiteSocketServer({ db: pglite, port: DB_PORT });
await dbServer.start();

const worker = startMockWorker(WORKER_PORT);
say(`mock worker on :${WORKER_PORT}, Docker calls answer with made-up data`);

const app = Bun.spawn(
	[
		process.execPath,
		"--bun",
		"x",
		"vite",
		"dev",
		"--port",
		String(APP_PORT),
		"--strictPort",
	],
	{
		env: {
			...process.env,
			AUTH_SECRET: "design-mode-secret-not-for-production-use-0000",
			BASE_DOMAIN: "homerun.test",
			DATABASE_POOL_MAX: "1",
			DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`,
			HOMERUN_DISABLE_AUTH_RATE_LIMIT: "1",
			HOMERUN_MIRROR_URL: "http://127.0.0.1:1",
			ORIGIN,
			TRAEFIK_DYNAMIC_CONFIG_DIR: "node_modules/.cache/homerun/design-traefik",
			WORKER_URL: `http://127.0.0.1:${WORKER_PORT}`,
		},
		stdio: ["inherit", "inherit", "inherit"],
	},
);

/** Stops the app, the mock worker and the database, then exits. */
async function shutdown(code = 0): Promise<never> {
	app.kill("SIGTERM");
	await worker.stop(true);
	await dbServer.stop();
	await pglite.close();
	process.exit(code);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
void app.exited.then((code) => shutdown(code));

try {
	await waitFor(`${ORIGIN}/api/health`);
	say(paint(32, `ready at ${ORIGIN}`));
	say(`sign in as ${DESIGN_ACCOUNT.email} / ${DESIGN_ACCOUNT.password}`);
} catch (error) {
	console.error(error);
	await shutdown(1);
}
