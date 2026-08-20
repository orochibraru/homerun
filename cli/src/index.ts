import { makeClient, resolveConfig } from "./client";
import {
	projectsList,
	serviceAction,
	serviceGet,
	servicesList,
	templatesList,
} from "./commands";
import { fail } from "./output";

function printHelp(): void {
	console.log(`
homerun — CLI for the Homerun REST API (openapi-fetch, typed against
/api/v1/openapi.json — see cli/README.md).

Usage:
  homerun services list [--json]
  homerun services get <id>
  homerun services deploy <id>
  homerun services start <id>
  homerun services stop <id>
  homerun services restart <id>
  homerun projects list [--json]
  homerun templates list [--json]

Auth/target (flag or env var):
  --base-url <url>    or HOMERUN_BASE_URL
  --api-key <key>     or HOMERUN_API_KEY
`);
}

/** Splits argv into positionals (resource/action/id) vs the handful of known flags — small and fixed enough that a real parser library isn't worth pulling in, same instinct as installer/'s hand-rolled options.ts. */
function parseArgv(argv: string[]): { positionals: string[]; json: boolean } {
	const positionals: string[] = [];
	let json = false;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--json") {
			json = true;
		} else if (arg === "--base-url" || arg === "--api-key") {
			i += 1; // consume the flag's value, handled separately by resolveConfig
		} else if (arg === "--help" || arg === "-h") {
			printHelp();
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

	const config = resolveConfig(argv);
	const client = makeClient(config);

	if (resource === "services") {
		if (action === "list") {
			return servicesList(client, json);
		}
		if (action === "get" && id) {
			return serviceGet(client, id, json);
		}
		if (
			(action === "deploy" ||
				action === "start" ||
				action === "stop" ||
				action === "restart") &&
			id
		) {
			return serviceAction(client, action, id);
		}
	}

	if (resource === "projects" && action === "list") {
		return projectsList(client, json);
	}

	if (resource === "templates" && action === "list") {
		return templatesList(client, json);
	}

	printHelp();
	fail(`Unknown command: ${argv.join(" ")}`);
}

main().catch((error) => {
	fail(error instanceof Error ? error.message : String(error));
});
