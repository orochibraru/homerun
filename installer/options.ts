export type InstallMode = "agent" | "full";

export interface Options {
	/** Print every command instead of running it : the only way this installer's logic gets exercised in review/CI without root or a disposable VM. */
	dryRun: boolean;
	/** The rootless-Docker system user to create (or reuse if it already exists). */
	rootlessUser: string;
	/** "agent" installs just the Homerun Agent (lighter : for a host that only receives migrated/placed workloads). "full" also brings up the main app + Traefik + Postgres via a generated docker compose file. */
	mode: InstallMode;
	/** Which release to install from, "latest" or a tag like "v1.2.3". Selects the agent/installer/cli binaries fetched from this repo's Gitea releases; see steps/release.ts for why the app's Docker image (--mode=full) isn't pinned the same way. */
	version: string;
	agentPort: number;
	/** Skip the "here's what I'm about to do, continue?" prompt : required for a non-interactive `curl | sh` install. */
	yes: boolean;
}

const DEFAULTS: Options = {
	agentPort: 7420,
	dryRun: false,
	mode: "agent",
	rootlessUser: "homerun",
	version: "latest",
	yes: false,
};

/** argv parsing, grouped as a class for consistency with the rest of installer/ : neither method carries instance state, both are pure/one-shot over the given argv. */
class InstallerOptionsParser {
	parseArgs(argv: string[]): Options {
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
			} else if (arg.startsWith("--version=")) {
				opts.version = arg.slice("--version=".length);
			} else if (arg.startsWith("--port=")) {
				opts.agentPort = Number.parseInt(arg.slice("--port=".length), 10);
			} else if (arg === "--help" || arg === "-h") {
				this.printHelp();
				process.exit(0);
			} else {
				console.error(`Unknown argument: ${arg} (see --help)`);
				process.exit(1);
			}
		}
		return opts;
	}

	printHelp(): void {
		console.log(`
homerun-install : sets up Docker (rootless), the homerun-network, and the
Homerun Agent (or the full stack) on a fresh Linux server, entirely from
prebuilt release binaries and Docker images, nothing built from source.

Usage:
  homerun-install [options]

Options:
  --version=<tag>     Release to install from : "latest" (default) or a tag
                       like "v1.2.3". Selects the agent/installer/cli
                       binaries fetched from Gitea releases.
  --mode=agent|full   agent = just the Homerun Agent (default)
                      full  = also brings up the main app via docker compose
  --user=<name>       Rootless-Docker system user to create (default: homerun)
  --port=<n>          Agent HTTP port (default: 7420)
  --dry-run           Print every command instead of running it
  --yes, -y            Skip the confirmation prompt (needed for curl | sh)
`);
	}
}

export const OptionsParser = new InstallerOptionsParser();
