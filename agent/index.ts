import { config } from "./config";
import { createHandler, ensureNetwork } from "./http";
import { resolveToken } from "./token";

async function main() {
	const { token, source } = await resolveToken();

	await ensureNetwork().catch((error) => {
		console.error(
			`[homerun-agent] couldn't ensure "${config.dockerNetworkName}" network exists : is Docker reachable at ${config.dockerSocketPath}?`,
		);
		console.error(error);
		process.exit(1);
	});

	Bun.serve({
		fetch: createHandler(token),
		port: config.port,
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
