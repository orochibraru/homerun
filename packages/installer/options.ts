import process from "node:process";
export type InstallMode = "agent" | "full";

export interface Options {
	/** Print every command instead of running it : the only way this installer's logic gets exercised in review/CI without root or a disposable VM. */
	dryRun: boolean;
	/** The rootless-Docker system user to create (or reuse if it already exists). */
	rootlessUser: string;
	/** "agent" installs just the Homerun Agent (lighter : for a host that only receives migrated/placed workloads). "full" also brings up the main app + Traefik + Postgres via a generated docker compose file. */
	mode: InstallMode;
	/** Which release to install from, "latest" or a tag like "v1.2.3". Selects the agent/installer/cli binaries fetched from this repo's GitHub releases; see steps/release.ts for why the app's Docker image (--mode=full) isn't pinned the same way. */
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

/** Bare flags : an exact argv token that just sets a field. */
const FLAG_ARGS: Record<string, (opts: Options) => void> = {
	"--dry-run": (opts) => {
		opts.dryRun = true;
	},
	"--mode=agent": (opts) => {
		opts.mode = "agent";
	},
	"--mode=full": (opts) => {
		opts.mode = "full";
	},
	"--yes": (opts) => {
		opts.yes = true;
	},
	"-y": (opts) => {
		opts.yes = true;
	},
};

/** `--name=value` options, keyed by prefix and handed everything after the `=`. */
const VALUED_ARGS: Record<string, (opts: Options, value: string) => void> = {
	"--port=": (opts, value) => {
		opts.agentPort = Number.parseInt(value, 10);
	},
	"--user=": (opts, value) => {
		opts.rootlessUser = value;
	},
	"--version=": (opts, value) => {
		opts.version = value;
	},
};

/** argv parsing, grouped as a class for consistency with the rest of installer/ : neither method carries instance state, both are pure/one-shot over the given argv. */
class InstallerOptionsParser {
	parseArgs(argv: string[]): Options {
		const opts: Options = { ...DEFAULTS };
		for (const arg of argv) {
			this.#applyArg(opts, arg);
		}
		return opts;
	}

	/** Applies one argv token, exiting the process on `--help` or anything unrecognized. */
	#applyArg(opts: Options, arg: string): void {
		const flag = FLAG_ARGS[arg];
		if (flag) {
			flag(opts);
			return;
		}

		const prefix = Object.keys(VALUED_ARGS).find((p) => arg.startsWith(p));
		if (prefix) {
			VALUED_ARGS[prefix](opts, arg.slice(prefix.length));
			return;
		}

		if (arg === "--help" || arg === "-h") {
			this.printHelp();
			process.exit(0);
		}

		console.error(`Unknown argument: ${arg} (see --help)`);
		process.exit(1);
	}

	printHelp(): void {
		console.log(`
homerun-install : sets up Docker (rootless), the homerun, and the
Homerun Agent (or the full stack) on a fresh Linux server, entirely from
prebuilt release binaries and Docker images, nothing built from source.

Usage:
  homerun-install [options]

Options:
  --version=<tag>     Release to install from : "latest" (default) or a tag
                       like "v1.2.3". Selects the agent/installer/cli
                       binaries fetched from GitHub releases.
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
