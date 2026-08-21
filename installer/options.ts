export type InstallMode = "agent" | "full";

export interface Options {
	/** Print every command instead of running it : the only way this installer's logic gets exercised in review/CI without root or a disposable VM. */
	dryRun: boolean;
	/** The rootless-Docker system user to create (or reuse if it already exists). */
	rootlessUser: string;
	/** "agent" installs just the Homerun Agent (lighter : for a host that only receives migrated/placed workloads). "full" also brings up the main app + Traefik + Postgres via docker compose. */
	mode: InstallMode;
	/** Where to clone the app from, to build the agent (and, in --mode=full, the app itself) from source : there's no prebuilt-binary release feed yet, see README. */
	repoUrl: string;
	repoRef: string;
	agentPort: number;
	/** Skip the "here's what I'm about to do, continue?" prompt : required for a non-interactive `curl | sh` install. */
	yes: boolean;
}

const DEFAULTS: Options = {
	agentPort: 7420,
	dryRun: false,
	mode: "agent",
	repoRef: "main",
	repoUrl: process.env.HOMERUN_REPO_URL ?? "",
	rootlessUser: "homerun",
	yes: false,
};

export function parseArgs(argv: string[]): Options {
	const opts: Options = { ...DEFAULTS };
	for (const arg of argv) {
		if (arg === "--dry-run") {
			opts.dryRun = true;
		} else if (arg === "--yes" || arg === "-y") {
			opts.yes = true;
		} else if (arg === "--mode=full") {
			opts.mode = "full";
		} else if (arg === "--mode=agent") {
			opts.mode = "agent";
		} else if (arg.startsWith("--user=")) {
			opts.rootlessUser = arg.slice("--user=".length);
		} else if (arg.startsWith("--repo=")) {
			opts.repoUrl = arg.slice("--repo=".length);
		} else if (arg.startsWith("--ref=")) {
			opts.repoRef = arg.slice("--ref=".length);
		} else if (arg.startsWith("--port=")) {
			opts.agentPort = Number.parseInt(arg.slice("--port=".length), 10);
		} else if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		} else {
			console.error(`Unknown argument: ${arg} (see --help)`);
			process.exit(1);
		}
	}
	return opts;
}

export function printHelp(): void {
	console.log(`
homerun-install : sets up Docker (rootless), the homerun-network, and the
Homerun Agent (or the full stack) on a fresh Linux server.

Usage:
  homerun-install --repo=<git url> [options]

Options:
  --repo=<url>       Git URL to build from (required : no prebuilt-binary
                      feed exists yet). Also settable via HOMERUN_REPO_URL.
  --ref=<ref>         Branch/tag to build (default: main)
  --mode=agent|full   agent = just the Homerun Agent (default)
                      full  = also brings up the main app via docker compose
  --user=<name>       Rootless-Docker system user to create (default: homerun)
  --port=<n>          Agent HTTP port (default: 7420)
  --dry-run           Print every command instead of running it
  --yes, -y            Skip the confirmation prompt (needed for curl | sh)
`);
}
