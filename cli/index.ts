import { ClientFactory } from "./client";
import { Commands } from "./commands";
import { LoginFlow } from "./login";
import { Output } from "./output";
import { UpdateService } from "./update";
import { CLI_VERSION } from "./version";

function printHelp(): void {
	console.log(`
homerun : CLI for the Homerun REST API (openapi-fetch, typed against
/api/v1/openapi.json : see cli/README.md).

Usage:
  homerun login [--base-url <url>]
  homerun logout
  homerun update
  homerun services list [--json]
  homerun services get <id>
  homerun services deploy <id>
  homerun services start <id>
  homerun services stop <id>
  homerun services restart <id>
  homerun projects list [--json]
  homerun templates list [--json]
  homerun --version

Auth/target: run \`homerun login\` once (stores your instance URL and a
CLI-scoped API key in ~/.config/homerun/config.json), or override per-call
with a flag or env var:
  --base-url <url>    or HOMERUN_BASE_URL
  --api-key <key>     or HOMERUN_API_KEY
`);
}

/** Splits argv into positionals (resource/action/id) vs the handful of known flags : small and fixed enough that a real parser library isn't worth pulling in, same instinct as installer/'s hand-rolled options.ts. */
function parseArgv(argv: string[]): { positionals: string[]; json: boolean } {
	const positionals: string[] = [];
	let json = false;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--json") {
			json = true;
		} else if (arg === "--base-url" || arg === "--api-key") {
			i += 1; // consume the flag's value, handled separately by ClientFactory.resolveConfig
		} else if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		} else if (arg === "--version" || arg === "-v") {
			console.log(`v${CLI_VERSION}`);
			process.exit(0);
		} else if (!arg.startsWith("--")) {
			positionals.push(arg);
		}
	}
	return { json, positionals };
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.length === 0) {
		printHelp();
		return;
	}

	const { positionals, json } = parseArgv(argv);
	const [resource, action, id] = positionals;

	if (resource === "login") {
		return LoginFlow.login(argv);
	}
	if (resource === "logout") {
		return LoginFlow.logout();
	}
	if (resource === "update") {
		return UpdateService.update();
	}

	const config = ClientFactory.resolveConfig(argv);
	if (!config) {
		// `return` (not just a bare statement) : an `Output.fail(...)` method
		// call, unlike a plain `fail()` function call, isn't recognized by
		// TS's control-flow analysis as making the rest of this block
		// unreachable, so `config` wouldn't otherwise narrow to non-null below.
		return Output.fail("Not logged in. Run `homerun login` to get started.");
	}
	const client = ClientFactory.makeClient(config);

	if (resource === "services") {
		if (action === "list") {
			return Commands.servicesList(client, json);
		}
		if (action === "get" && id) {
			return Commands.serviceGet(client, id, json);
		}
		if (
			(action === "deploy" ||
				action === "start" ||
				action === "stop" ||
				action === "restart") &&
			id
		) {
			return Commands.serviceAction(client, action, id);
		}
	}

	if (resource === "projects" && action === "list") {
		return Commands.projectsList(client, json);
	}

	if (resource === "templates" && action === "list") {
		return Commands.templatesList(client, json);
	}

	printHelp();
	Output.fail(`Unknown command: ${argv.join(" ")}`);
}

main().catch((error) => {
	Output.fail(error instanceof Error ? error.message : String(error));
});
