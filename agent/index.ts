import { config } from "./config";
import { DockerService } from "./docker";
import { AgentHttpServer } from "./http";
import { TokenManager } from "./token";
import { AGENT_VERSION } from "./version";

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
	Bun.serve({
		fetch: server.notFound,
		port: config.port,
		routes: server.routes,
	});

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
		console.log("  Paste this (plus this host's reachable URL) into the main");
		console.log(
			"  Homerun instance's Remote Hosts page → Add Host → Homerun Agent.",
		);
	}
	console.log("");
}

main();
