import { join } from "node:path";
import { DEFAULT_BASE_URL } from "./webview";

/**
 * Server-lifecycle wrapper for the e2e suite — the Bun.WebView-era
 * replacement for @playwright/test's `webServer` config block. Boots an
 * isolated `NODE_ENV=test` dev server, waits for it to answer, runs every
 * `e2e/*.spec.ts` file via `bun test`, then tears the server down — success
 * or failure.
 *
 * **Why a dedicated, unusual port bound explicitly to 127.0.0.1, never
 * "localhost:5173"**: verified live during development that two `vite dev`
 * processes can both successfully bind the *same* port simultaneously — one
 * on `::1`, one on `127.0.0.1` — with no `EADDRINUSE`, because they're
 * different sockets at the OS level. `localhost` then resolves
 * nondeterministically between them (getaddrinfo ordering), so a second dev
 * server silently coexisting with the maintainer's own real one is a real,
 * hit-in-practice failure mode, not a hypothetical — this suite very nearly
 * drove browser automation against the maintainer's real dev session as a
 * result. `--strictPort` makes a genuine collision fail loudly instead of
 * silently coexisting; `--host 127.0.0.1` plus always targeting
 * `127.0.0.1:<port>` (never the bare hostname) removes the dual-stack
 * ambiguity entirely.
 *
 * **Why `--env-file=.env.test` and not just `NODE_ENV=test`**: verified
 * live that `NODE_ENV=test bun run dev` (the command this repo's docs and
 * the old playwright.config.ts both documented) does NOT load `.env.test`
 * — `pg_stat_activity` on a real run showed it holding connections to the
 * real `homerun` database, not `homerun_test`. Bun's automatic
 * `.env.$NODE_ENV` cascade only fires when Bun directly executes a file;
 * `bun run dev` hands off to `vite` as a package.json script, which never
 * gets that cascade, so `config.ts`'s `databaseUrl` zod default (the real
 * local Postgres) silently won. Passing `--env-file=.env.test` explicitly
 * is what actually routes this at the real Postgres container's own
 * connection list — confirmed the same way. Every past e2e run in this
 * repo's history almost certainly hit the real database as a result; the
 * throwaway-account/cleanup discipline in the specs is what kept it from
 * being destructive, not the isolation this was supposed to provide.
 */

const BASE_URL = DEFAULT_BASE_URL;
const { hostname: HOST, port: PORT } = new URL(BASE_URL);
const READY_TIMEOUT_MS = 30_000;
const DEFAULT_TEST_TIMEOUT_MS = 180_000;

const repoRoot = join(import.meta.dir, "..");

async function waitForReady() {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${BASE_URL}/`, { redirect: "manual" });
			// Any response at all (including a 3xx redirect to sign-in/sign-up)
			// means the server is up; only a connection failure means "not yet".
			if (res.status > 0) {
				return;
			}
		} catch {
			// not up yet
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	throw new Error(
		`e2e dev server never answered at ${BASE_URL}/ within ${READY_TIMEOUT_MS}ms`,
	);
}

async function main() {
	const specGlob = new Bun.Glob("*.spec.ts");
	const specFiles = [...specGlob.scanSync({ cwd: import.meta.dir })].sort();
	if (specFiles.length === 0) {
		console.error("No e2e/*.spec.ts files found.");
		process.exit(1);
	}

	console.log(`Starting isolated e2e dev server on ${BASE_URL} ...`);
	const devServer = Bun.spawn(
		[
			"bun",
			"--env-file=.env.test",
			"run",
			"dev",
			"--",
			"--port",
			String(PORT),
			"--host",
			HOST,
			"--strictPort",
		],
		{
			cwd: repoRoot,
			env: { ...process.env, NODE_ENV: "test" },
			stderr: "pipe",
			stdout: "pipe",
		},
	);

	let exitCode = 1;
	try {
		try {
			await waitForReady();
		} catch (err) {
			const stdout = await new Response(devServer.stdout)
				.text()
				.catch(() => "");
			const stderr = await new Response(devServer.stderr)
				.text()
				.catch(() => "");
			console.error(
				"Dev server failed to come up. This usually means the dedicated e2e port",
				`(${PORT}) is already in use — check for a leftover process from a`,
				"previous interrupted run before assuming this is a real bug.",
			);
			console.error("--- dev server stdout ---\n", stdout);
			console.error("--- dev server stderr ---\n", stderr);
			throw err;
		}
		console.log(`Dev server ready. Running: ${specFiles.join(", ")}`);

		const testRun = Bun.spawn(
			[
				"bun",
				"test",
				`--timeout=${DEFAULT_TEST_TIMEOUT_MS}`,
				...specFiles.map((f) => join(import.meta.dir, f)),
			],
			{
				cwd: repoRoot,
				env: { ...process.env, E2E_BASE_URL: BASE_URL },
				stderr: "inherit",
				stdin: "inherit",
				stdout: "inherit",
			},
		);
		exitCode = await testRun.exited;
	} finally {
		// `bun test` runs as its own child process (spawned above), so the
		// Chrome/WebView subprocesses it starts are its own to clean up —
		// Bun.WebView.closeAll() runs automatically at that child's exit
		// (see Bun.WebView's own docs), nothing to do for it from here.
		devServer.kill();
		await devServer.exited;
	}

	process.exit(exitCode);
}

await main();
