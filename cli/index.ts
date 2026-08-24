import { Command } from "commander";
import { ClientFactory } from "./client";
import { Commands } from "./commands";
import { LoginFlow } from "./login";
import { Output } from "./output";
import { UpdateService } from "./update";
import { CLI_VERSION } from "./version";

interface GlobalOptions {
	baseUrl?: string;
	apiKey?: string;
}

interface ListOptions {
	json?: boolean;
}

/**
 * Resolves the API client from the root program's already-parsed
 * `--base-url`/`--api-key` (see `program.opts()` below), same "not logged in"
 * fallback the old hand-rolled `index.ts` had : `Output.fail(...)` (not a
 * plain `fail()` function) isn't recognized by TS's control-flow analysis as
 * making the rest of a caller unreachable, so every call site here still
 * needs its own `return` in front of it.
 */
function requireClient(): ReturnType<typeof ClientFactory.makeClient> {
	const config = ClientFactory.resolveConfig(program.opts<GlobalOptions>());
	if (!config) {
		return Output.fail("Not logged in. Run `homerun login` to get started.");
	}
	return ClientFactory.makeClient(config);
}

const program = new Command();

program
	.name("homerun")
	.description(
		"CLI for the Homerun REST API (openapi-fetch, typed against /api/v1/openapi.json : see cli/README.md).",
	)
	.version(CLI_VERSION, "-v, --version")
	.option(
		"--base-url <url>",
		"instance URL, overrides the saved login (or HOMERUN_BASE_URL)",
	)
	.option(
		"--api-key <key>",
		"API key, overrides the saved login (or HOMERUN_API_KEY)",
	)
	.addHelpText(
		"after",
		`
Auth/target: run \`homerun login\` once (stores your instance URL and a
CLI-scoped API key in ~/.config/homerun/config.json), or override per-call
with --base-url/--api-key above or their HOMERUN_BASE_URL/HOMERUN_API_KEY
env var equivalents.`,
	);

program
	.command("login")
	.description("log in via a device-code flow and save the resulting API key")
	.action(async () => {
		const { baseUrl } = program.opts<GlobalOptions>();
		await LoginFlow.login(baseUrl);
	});

program
	.command("logout")
	.description("clear the saved login")
	.action(() => {
		LoginFlow.logout();
	});

program
	.command("update")
	.description("self-update the installed binary to the latest release")
	.action(async () => {
		await UpdateService.update();
	});

const services = program.command("services").description("manage services");

services
	.command("list")
	.description("list services")
	.option("--json", "print raw JSON instead of a table")
	.action(async (options: ListOptions) => {
		await Commands.servicesList(requireClient(), options.json ?? false);
	});

services
	.command("get <id>")
	.description("get a service by id")
	.action(async (id: string) => {
		await Commands.serviceGet(requireClient(), id);
	});

for (const action of ["deploy", "start", "stop", "restart"] as const) {
	services
		.command(`${action} <id>`)
		.description(`${action} a service`)
		.action(async (id: string) => {
			await Commands.serviceAction(requireClient(), action, id);
		});
}

const projects = program.command("projects").description("manage projects");

projects
	.command("list")
	.description("list projects")
	.option("--json", "print raw JSON instead of a table")
	.action(async (options: ListOptions) => {
		await Commands.projectsList(requireClient(), options.json ?? false);
	});

const templates = program.command("templates").description("manage templates");

templates
	.command("list")
	.description("list templates")
	.option("--json", "print raw JSON instead of a table")
	.action(async (options: ListOptions) => {
		await Commands.templatesList(requireClient(), options.json ?? false);
	});

// No subcommand at all : commander itself only prints help on an unknown or
// missing *required* argument, not on a bare `homerun`, so this matches the
// old hand-rolled index.ts's "no args -> print help, exit 0" behavior
// explicitly rather than leaving a silent no-op.
if (process.argv.length <= 2) {
	program.outputHelp();
	process.exit(0);
}

program.parseAsync(process.argv).catch((error: unknown) => {
	Output.fail(error instanceof Error ? error.message : String(error));
});
