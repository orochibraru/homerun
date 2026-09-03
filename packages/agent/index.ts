import process from "node:process";
import { config } from "./config";
import { DockerService } from "./docker";
import { AgentHttpServer } from "./http";
import { TokenManager } from "./token";

/**
 * SIGINT/SIGTERM used to have no handler at all here, Bun's default
 * behavior on either is to terminate the process immediately, which for
 * this agent specifically risks killing an in-flight `/v1/deploy` (a
 * `docker pull` partway through) or `/v1/build` (a git clone or `docker
 * build` partway through) mid-operation : a half-pulled image, a truncated
 * clone, or a build silently cut off, none of which fail cleanly on the
 * next attempt the way a fresh request would.
 *
 * `server.stop()` (no argument, i.e. `false`) is the actual graceful
 * variant : Bun stops accepting new connections but lets in-flight
 * requests finish naturally, only `server.stop(true)` force-closes them.
 * Bounded by `config.shutdownTimeoutSeconds` so a genuinely stuck request
 * (an unreachable registry a pull is hanging against, say) can't block
 * shutdown forever, systemd/docker's own kill-after-timeout would just cut
 * the process at a moment of its own choosing instead of this one. A
 * second SIGINT/SIGTERM while already shutting down forces an immediate
 * exit, the standard "one more Ctrl+C to really stop now" escape hatch.
 */
function registerGracefulShutdown(bunServer: ReturnType<typeof Bun.serve>) {
	let shuttingDown = false;

	async function shutdown(_signal: string) {
		if (shuttingDown) {
			process.exit(1);
		}
		shuttingDown = true;

		const forceTimer = setTimeout(() => {
			bunServer.stop(true).finally(() => process.exit(1));
		}, config.shutdownTimeoutSeconds * 1000);

		await bunServer.stop();
		clearTimeout(forceTimer);
		process.exit(0);
	}

	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

async function main() {
	const arg = process.argv[2];
	if (arg === "--version" || arg === "-v") {
		return;
	}
	if (arg === "--help" || arg === "-h") {
		return;
	}

	const { token, source } = await TokenManager.resolveToken();

	await DockerService.ensureNetwork().catch((_error) => {
		process.exit(1);
	});

	const server = new AgentHttpServer(token);
	const bunServer = Bun.serve({
		fetch: server.notFound,
		port: config.port,
		routes: server.routes,
	});

	registerGracefulShutdown(bunServer);
	if (source !== "env") {
	}
}

main();
