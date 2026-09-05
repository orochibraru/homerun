/**
 * Global setup/teardown for the whole integration suite, registered once
 * via bunfig.toml's `[test].preload` (native to bun, not a CLI flag on some
 * one-off `test:integration` script) — `beforeAll`/`afterAll` called at the
 * top level of a *preloaded* file (not inside any `describe`) are bun:test's
 * own documented mechanism for a run-wide fixture : verified empirically
 * before committing to this design (a two-file smoke test, global
 * `beforeAll` fired exactly once, before the first file's own tests; a
 * same-file `beforeAll` fired *after* it, same run). This is what makes
 * `bun test` alone — no wrapper script, no --preload flag — run the *entire*
 * suite (agent/cli/installer *and* integration) end to end.
 *
 * Building the app is a separate, explicit operation, not something this
 * setup does for you: run `bun run build:app` yourself before this suite
 * (see `assertAppIsBuilt` in ./server.ts, which just checks the compiled
 * `build/server` exists and fails fast with that instruction if not, and is
 * shared with tests/e2e's own bootstrap). This used to run
 * `bun run build:app` inline here on every invocation, which meant every
 * local re-run of this suite paid a full rebuild even when nothing under
 * `src/` had changed, and any build failure surfaced as a confusing
 * integration-test failure rather than its own build step.
 *
 * Every port (this throwaway Postgres container, the spawned app, the
 * spawned agent, the socat proxy) is resolved fresh each run (port.ts) —
 * no fixed ports anywhere in this suite any more — specifically so two runs
 * of this suite (two terminals, a local run next to CI) never collide.
 *
 * Runs by default, whenever this preload loads at all (which is every
 * `bun test` invocation, per bunfig.toml's [test].preload) — real,
 * confirmed finding while building this : `process.argv` cannot be used to
 * detect "does this invocation include an integration test file" the way
 * an earlier version of this file assumed. `bun test`'s own argv, as seen
 * from a preload, isn't the original CLI arguments at all, it's
 * `[bunExecPath, <the first resolved test file bun happens to pick>]`,
 * regardless of whether you passed a directory, a single file, or nothing;
 * verified live with a debug dump. There's no reliable signal available
 * here for "which files will run" to skip on. The fast, scoped package.json
 * scripts (test:unit, test:unit:agent, etc.) opt out explicitly instead,
 * via `HOMERUN_SKIP_INTEGRATION_SETUP=1`, rather than this file trying to
 * infer their scope.
 *
 * `./ci.ts` layers CI-awareness on top of the above : `ciTimeout` picks a
 * longer bound under a cold CI runner (first-time image pulls take real
 * wall-clock time a warm local Docker cache never pays), and
 * `dumpDockerDiagnostics` prints `docker ps -a`/`docker logs` before a setup
 * failure propagates, so a CI log shows *why* something didn't come up
 * instead of a bare timeout message.
 */
import { afterAll, beforeAll } from "bun:test";
import process from "node:process";
import { config as agentConfig } from "../../../packages/agent/config";
import { bootstrapAdmin } from "./bootstrap";
import { ciTimeout, dumpDockerDiagnostics, stepLog } from "./ci";
import { AGENT_TOKEN, TEST_AUTH_SECRET, TEST_BASE_DOMAIN } from "./config";
import { createGitBuildFixture } from "./git-fixture";
import { runMigrations } from "./migrate";
import { getFreePort } from "./port";
import { startTestPostgres, type TestPostgres } from "./postgres";
import { spawnAgent, startSocatProxy } from "./processes";
import {
	registerAgentRemoteHost,
	registerDockerRemoteHost,
} from "./remote-hosts";
import { assertAppIsBuilt, spawnApp } from "./server";

export interface IntegrationContext {
	agentRemoteHostId: string;
	apiKey: string;
	dockerRemoteHostId: string;
	gitBuildFixtureUrl: string;
	origin: string;
	userId: string;
}

const globalForIntegration = globalThis as unknown as {
	__integration_ctx?: IntegrationContext;
};

/**
 * The one reliable opt-out : set explicitly by this repo's own fast, scoped
 * test scripts (package.json's test:unit*), not inferred from argv (see the
 * docstring above for why that doesn't work). Anything else — a bare
 * `bun test`, `bun run test`, `bun run test:integration` — runs the full
 * setup.
 */
function wantsIntegrationTests(): boolean {
	return process.env.HOMERUN_SKIP_INTEGRATION_SETUP !== "1";
}

if (wantsIntegrationTests()) {
	let pg: TestPostgres | undefined;
	const stopFns: Array<() => Promise<void>> = [];
	const rawProcs: ReturnType<typeof Bun.spawn>[] = [];

	beforeAll(
		async () => {
			try {
				assertAppIsBuilt();

				stepLog("Resolving a fresh test database...");
				pg = await startTestPostgres();

				stepLog("Running migrations...");
				await runMigrations(pg.databaseUrl);

				stepLog("Starting socat proxy (second Docker connection)...");
				const socatPort = getFreePort();
				const socat = startSocatProxy(socatPort, agentConfig.dockerSocketPath);
				stopFns.push(socat.stop);
				rawProcs.push(socat.proc);
				await socat.ready();

				stepLog("Starting agent process...");
				const agentPort = getFreePort();
				const agent = spawnAgent(agentPort, AGENT_TOKEN);
				stopFns.push(agent.stop);
				rawProcs.push(agent.proc);
				await agent.ready();

				stepLog("Building and starting the app...");
				const appPort = getFreePort();
				const origin = `http://localhost:${appPort}`;
				const app = await spawnApp({
					authSecret: TEST_AUTH_SECRET,
					baseDomain: TEST_BASE_DOMAIN,
					databaseUrl: pg.databaseUrl,
					origin,
					port: appPort,
				});
				stopFns.push(app.stop);
				rawProcs.push(app.proc);

				stepLog("Bootstrapping admin account + API key...");
				const { apiKey, userId } = await bootstrapAdmin(origin);

				stepLog("Registering remote hosts...");
				const dockerRemoteHostId = await registerDockerRemoteHost(
					origin,
					apiKey,
					socatPort,
				);
				const agentRemoteHostId = await registerAgentRemoteHost(
					origin,
					apiKey,
					agentPort,
					AGENT_TOKEN,
				);

				stepLog("Building git-build fixture repo...");
				const gitBuildFixtureUrl = await createGitBuildFixture();

				globalForIntegration.__integration_ctx = {
					agentRemoteHostId,
					apiKey,
					dockerRemoteHostId,
					gitBuildFixtureUrl,
					origin,
					userId,
				};

				stepLog("Ready.");
			} catch (err) {
				await dumpDockerDiagnostics();
				throw err;
			}
			// Real, tested-in-review finding : bunfig.toml's [test].timeout only
			// bounds `test()` bodies, not beforeAll/afterAll hooks, which bun
			// defaults to a *separate* 5-second timeout regardless. Without the
			// explicit second argument below, this whole setup (Postgres +
			// migrate + agent + socat + bootstrap, `build:app` included back
			// when this ran it inline, see this file's own top comment) got
			// SIGTERM'd at exactly 5000ms, every run, silently eating the real
			// error underneath a generic "hook timed out" message until this
			// was traced down.
		},
		ciTimeout(120_000, 300_000),
	);

	afterAll(
		async () => {
			stepLog("Tearing down...");
			for (const stop of stopFns.reverse()) {
				await stop().catch((err) => {
					console.warn("[integration] Cleanup step failed", err);
				});
			}
			await pg?.stop().catch((err) => {
				console.warn("[integration] Postgres container cleanup failed", err);
			});
		},
		ciTimeout(30_000, 60_000),
	);

	// bun:test's own afterAll above covers the normal (pass or fail) exit
	// path. This is only a synchronous last-resort net for a hard interrupt
	// (Ctrl+C) that never reaches afterAll at all, so the throwaway Postgres
	// container / spawned app / agent / socat don't outlive the run.
	process.on("SIGINT", () => {
		for (const proc of rawProcs) {
			proc.kill("SIGKILL");
		}
		// pg.stop() is async (awaits `docker stop`) : this handler can't await
		// anything before exiting, so this fires the same command
		// synchronously instead, best-effort.
		if (pg?.containerName) {
			Bun.spawnSync(["docker", "kill", pg.containerName], {
				stderr: "ignore",
				stdout: "ignore",
			});
		}
		process.exit(130);
	});
}
