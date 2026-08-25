import { config } from "./config";
import { DockerService } from "./docker";
import { AgentHttpServer } from "./http";
import { TokenManager } from "./token";
import { AGENT_VERSION } from "./version";

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

	async function shutdown(signal: string) {
		if (shuttingDown) {
			console.log(
				`[homerun-agent] received ${signal} again, forcing immediate shutdown.`,
			);
			process.exit(1);
		}
		shuttingDown = true;
		console.log(
			`[homerun-agent] received ${signal}, shutting down gracefully (waiting up to ${config.shutdownTimeoutSeconds}s for any in-flight deploy/build to finish)...`,
		);

		const forceTimer = setTimeout(() => {
			console.warn(
				`[homerun-agent] graceful shutdown exceeded ${config.shutdownTimeoutSeconds}s, forcing.`,
			);
			bunServer.stop(true).finally(() => process.exit(1));
		}, config.shutdownTimeoutSeconds * 1000);

		await bunServer.stop();
		clearTimeout(forceTimer);
		console.log("[homerun-agent] shut down cleanly.");
		process.exit(0);
	}

	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

async function main() {
	const arg = process.argv[2];
	if (arg === "--version" || arg === "-v") {
		console.log(`v${AGENT_VERSION}`);
		return;
	}
	if (arg === "--help" || arg === "-h") {
		console.log(`
homerun-agent : token-authenticated HTTP control surface for a remote host's
Docker daemon. See agent/README.md.

Usage:
  homerun-agent            Start the agent (reads its config from env vars)
  homerun-agent --version  Print the version and exit
`);
		return;
	}

	const { token, source } = await TokenManager.resolveToken();

	await DockerService.ensureNetwork().catch((error) => {
		console.error(
			`[homerun-agent] couldn't ensure "${config.dockerNetworkName}" network exists : is Docker reachable at ${config.dockerSocketPath}?`,
		);
		console.error(error);
		process.exit(1);
	});

	const server = new AgentHttpServer(token);
	const bunServer = Bun.serve({
		fetch: server.notFound,
		port: config.port,
		routes: server.routes,
	});

	registerGracefulShutdown(bunServer);

	console.log("");
	console.log("  Homerun Agent is running.");
	console.log(`  Listening on:   http://0.0.0.0:${config.port}`);
	console.log(`  Docker socket:  ${config.dockerSocketPath}`);
	console.log(`  Network:        ${config.dockerNetworkName}`);
	console.log(
		source === "env"
			? "  Token source:   AGENT_TOKEN env var"
			: `  Token source:   ${source === "generated" ? "generated just now" : "persisted"} (${config.tokenFile})`,
	);
	if (source !== "env") {
		console.log("");
		console.log(`  Agent token:    ${token}`);
		console.log(
			"  Keep this token secret : it's a full-access credential for this host's Docker daemon.",
		);
	}
	console.log("");
}

main();
