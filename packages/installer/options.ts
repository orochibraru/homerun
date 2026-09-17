import process from "node:process";
export type InstallMode = "agent" | "full";
export type DockerFlavour = "rootful" | "rootless";

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
	/** Domain or IP this instance will be reached at (`--mode=full`): becomes the app's baseDomain and its ORIGIN. Prompted for, or detected from this host's own address, when not given : it must never end up as localhost, see steps/full-stack.ts. */
	domain?: string;
	/** Which Docker daemon `--mode=full` runs the stack on, unset meaning the default (see `dockerFlavourOf`). "rootful" is the system daemon, set up as a swarm manager so the instance starts in swarm mode; "rootless" is a per-user daemon, standalone only, since rootless Docker can't create overlay networks. */
	docker?: DockerFlavour;
	/** Address `docker swarm init` advertises to other nodes (rootful `--mode=full`), detected from the default route when unset. */
	advertiseAddress?: string;
	/** App image to run instead of the release's `docker.io/orochibraru/homerun:<version>`, e.g. a locally loaded build. */
	image?: string;
	/** Move an existing rootless `--mode=full` install onto the system daemon in swarm mode, see steps/migrate-rootful.ts. */
	migrateToRootful: boolean;
	/** Skip the "here's what I'm about to do, continue?" prompt : required for a non-interactive `curl | sh` install. */
	yes: boolean;
}

const DEFAULTS: Options = {
	agentPort: 7420,
	dryRun: false,
	migrateToRootful: false,
	mode: "agent",
	rootlessUser: "homerun",
	version: "latest",
	yes: false,
};

/** Bare flags : an exact argv token that just sets a field. */
const FLAG_ARGS: Record<string, (opts: Options) => void> = {
	"--docker=rootful": (opts) => {
		opts.docker = "rootful";
	},
	"--docker=rootless": (opts) => {
		opts.docker = "rootless";
	},
	"--dry-run": (opts) => {
		opts.dryRun = true;
	},
	"--migrate-to-rootful": (opts) => {
		opts.migrateToRootful = true;
		opts.mode = "full";
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
	"--advertise-addr=": (opts, value) => {
		opts.advertiseAddress = value;
	},
	"--port=": (opts, value) => {
		opts.agentPort = Number.parseInt(value, 10);
	},
	"--domain=": (opts, value) => {
		opts.domain = value;
	},
	"--image=": (opts, value) => {
		opts.image = value;
	},
	"--user=": (opts, value) => {
		opts.rootlessUser = value;
	},
	"--version=": (opts, value) => {
		opts.version = value;
	},
};

/**
 * The daemon an install actually uses: the agent always gets its own rootless
 * one, `--mode=full` defaults to the system daemon.
 */
export function dockerFlavourOf(opts: Options): DockerFlavour {
	if (opts.mode === "agent") {
		return "rootless";
	}
	return opts.docker ?? "rootful";
}

/** argv parsing, grouped as a class for consistency with the rest of installer/ : neither method carries instance state, both are pure/one-shot over the given argv. */
class InstallerOptionsParser {
	/**
	 * Parses installer flags over the defaults.
	 *
	 * @param argv The arguments after the binary name.
	 * @returns The resolved options. Exits the process on `--help` or an unknown argument.
	 */
	parseArgs(argv: string[]): Options {
		const opts: Options = { ...DEFAULTS };
		for (const arg of argv) {
			this.#applyArg(opts, arg);
		}
		return opts;
	}

	/**
	 * Cross-flag checks the per-token parser can't make.
	 *
	 * @returns An error message, or null when the combination is valid.
	 */
	validate(opts: Options): string | null {
		if (opts.docker && opts.mode !== "full") {
			return `--docker=${opts.docker} only applies to --mode=full : the agent always runs on its own rootless daemon.`;
		}
		if (opts.migrateToRootful && opts.docker === "rootless") {
			return "--migrate-to-rootful moves an install onto the system daemon : drop --docker=rootless.";
		}
		if (opts.advertiseAddress && dockerFlavourOf(opts) !== "rootful") {
			return "--advertise-addr only applies to a rootful --mode=full install, the only kind that runs a swarm.";
		}
		return null;
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

	/** Prints the installer's usage and flag reference to stdout. */
	printHelp(): void {
		console.log(`
homerun-install : sets up Docker, then the Homerun Agent or the full stack,
on a fresh Linux server, entirely from prebuilt release binaries and Docker
images, nothing built from source.

Usage:
  homerun-install [options]

Options:
  --version=<tag>     Release to install from : "latest" (default) or a tag
                       like "v1.2.3". Selects the agent/installer/cli
                       binaries fetched from GitHub releases.
  --mode=agent|full   agent = just the Homerun Agent (default), on a
                              rootless daemon
                      full  = also brings up the main app via docker compose
  --domain=<host>     Domain or IP the instance is reached at (--mode=full).
                      Prompted for, or detected from this host's own address,
                      when omitted. Never defaults to localhost.
  --docker=rootless|rootful
                      Daemon --mode=full runs the stack on (default: rootful).
                      rootful = the system daemon (runs as root), initialised
                                as a swarm manager : the instance starts in
                                swarm mode
                      rootless = a per-user daemon, standalone mode only
  --advertise-addr=<ip>
                      Address the swarm advertises to other nodes (rootful
                      --mode=full). Default: this host's default-route address.
  --migrate-to-rootful
                      Move an existing rootless --mode=full install onto the
                      system daemon in swarm mode : copies every volume, keeps
                      .env and homerun.yaml, redeploys every service. Safe to
                      re-run after a failure.
  --image=<ref>       App image to run instead of the release's
                      docker.io/orochibraru/homerun:<version>
  --user=<name>       System user owning the install (default: homerun)
  --port=<n>          Agent HTTP port (default: 7420)
  --dry-run           Print every command instead of running it
  --yes, -y            Skip the confirmation prompt (needed for curl | sh)
`);
	}
}

export const OptionsParser = new InstallerOptionsParser();
