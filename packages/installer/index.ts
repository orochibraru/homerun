import process from "node:process";
import { createInterface } from "node:readline/promises";
import { StepRunner } from "./exec";
import type { DockerFlavour, Options } from "./options";
import { dockerFlavourOf, OptionsParser } from "./options";
import { AgentInstaller } from "./steps/agent";
import { Detector, type PackageManager } from "./steps/detect";
import { FullStackInstaller } from "./steps/full-stack";
import { RootfulMigration } from "./steps/migrate-rootful";
import { NetworkSetup } from "./steps/network";
import { RootlessDockerInstaller } from "./steps/rootless-docker";
import { SwarmSetup } from "./steps/swarm";

/**
 * Where this instance will actually be reached, in order: --domain=, an
 * interactive answer, then this host's own address. Never localhost : a
 * localhost ORIGIN makes the very first sign-up 403 with better-auth's
 * "Invalid origin" from any browser that isn't on the box (see
 * steps/full-stack.ts). curl | bash has no TTY on stdin, so that path takes
 * the detected address silently rather than hanging on a prompt nobody can
 * answer.
 */
async function resolveHost(opts: Options): Promise<string> {
	if (opts.domain) {
		return normalizeHost(opts.domain);
	}
	const detected =
		(await Detector.hostAddress()) ?? (opts.dryRun ? "203.0.113.10" : null);
	const answer =
		process.stdin.isTTY && !opts.yes ? await promptHost(detected) : "";
	const host = answer || detected;
	if (!host) {
		throw new Error(
			'Could not work out an address for this host : re-run with --domain=<domain or IP>. It must not be localhost, or the first sign-up fails with "Invalid origin".',
		);
	}
	if (!answer) {
		console.log(
			`\nUsing ${host} as this instance's address (--domain=<domain> to override).`,
		);
	}
	return host;
}

/** EOF on stdin (Ctrl+D, or a TTY whose input closes) rejects rl.question : that's an unanswered prompt, not a failed install, so it falls through to the detected address. */
async function promptHost(detected: string | null): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return normalizeHost(
			await rl.question(
				`\nDomain this instance will be reached at, e.g. homerun.example.com${
					detected ? ` (blank uses this host's address, ${detected})` : ""
				}: `,
			),
		);
	} catch {
		return "";
	} finally {
		rl.close();
	}
}

/** A pasted dashboard URL is the obvious thing to answer with, but baseDomain is a bare host. */
function normalizeHost(value: string): string {
	return value
		.trim()
		.replace(/^https?:\/\//, "")
		.replace(/\/+$/, "");
}

async function main() {
	const opts = OptionsParser.parseArgs(process.argv.slice(2));
	const invalid = OptionsParser.validate(opts);
	if (invalid) {
		console.error(invalid);
		process.exit(1);
	}

	console.log(
		"Homerun installer : draft/WIP, see installer/README.md before running against a real box.\n",
	);

	if (!opts.dryRun) {
		Detector.requireLinux();
		Detector.requireRoot();
	}

	const run = new StepRunner(opts.dryRun);
	const docker = dockerFlavourOf(opts);

	console.log(
		`Target: mode=${opts.mode} docker=${docker} migrate=${opts.migrateToRootful} user=${opts.rootlessUser} arch=${Detector.arch()} version=${opts.version} dryRun=${opts.dryRun}\n`,
	);

	if (opts.migrateToRootful) {
		await migrateToRootful(opts, run);
		return;
	}

	const { dockerSocket, host } = await installDocker(opts, run, docker);
	await installStack(opts, run, { dockerSocket, docker, host });

	console.log("\nDone.");
	printNextSteps(opts, dockerSocket, host);
}

/**
 * Steps 1 to 3 of a fresh install: Docker Engine, the install user, then the
 * system daemon as a swarm manager or a rootless daemon for that user.
 *
 * @returns The daemon's socket and the instance's address (empty for an agent install).
 */
async function installDocker(
	opts: Options,
	run: StepRunner,
	docker: DockerFlavour,
): Promise<{ dockerSocket: string; host: string }> {
	const host = opts.mode === "full" ? await resolveHost(opts) : "";
	const rootful = docker === "rootful";

	console.log(
		`\n== 1/5 Docker engine${rootful ? "" : " + rootless prerequisites"} ==`,
	);
	await RootlessDockerInstaller.installDockerEngine(run);
	if (!rootful) {
		await RootlessDockerInstaller.installRootlessPrereqs(
			run,
			await packageManagerFor(opts),
		);
	}

	console.log(`\n== 2/5 ${rootful ? "Install" : "Rootless"} user ==`);
	await RootlessDockerInstaller.ensureRootlessUser(run, opts.rootlessUser);

	console.log(
		`\n== 3/5 ${rootful ? "System Docker daemon + swarm manager" : "Rootless Docker daemon"} ==`,
	);
	if (!rootful) {
		return {
			dockerSocket: await RootlessDockerInstaller.installRootlessDocker(
				run,
				opts.rootlessUser,
			),
			host,
		};
	}
	const dockerSocket = await RootlessDockerInstaller.enableRootfulDocker(run);
	await RootlessDockerInstaller.addUserToDockerGroup(run, opts.rootlessUser);
	await SwarmSetup.ensureManager(run, await advertiseAddressFor(opts));
	return { dockerSocket, host };
}

/**
 * The host's package manager. --dry-run is also how this installer's own
 * logic gets exercised outside a real Debian/RHEL box (e.g. from a macOS dev
 * machine), so there it falls back to apt instead of failing before anything
 * else runs.
 */
async function packageManagerFor(opts: Options): Promise<PackageManager> {
	if (!opts.dryRun) {
		return await Detector.detectPackageManager();
	}
	return await Detector.detectPackageManager().catch(() => ({
		install: ["apt-get", "install", "-y"],
		kind: "apt" as const,
	}));
}

/** Steps 4 and 5 of a fresh install: the networks on the chosen daemon, then the agent or the full stack. */
async function installStack(
	opts: Options,
	run: StepRunner,
	target: { dockerSocket: string; docker: DockerFlavour; host: string },
): Promise<void> {
	const { dockerSocket, host } = target;
	const rootful = target.docker === "rootful";
	console.log("\n== 4/5 Networks ==");
	await NetworkSetup.ensureHomerunNetwork(
		run,
		rootful ? null : opts.rootlessUser,
		dockerSocket,
	);
	if (rootful) {
		await SwarmSetup.ensureOverlayNetwork(run);
	}

	console.log("\n== 5/5 Install ==");
	if (opts.mode === "agent") {
		await AgentInstaller.installAgentBinary(run, opts.version, Detector.arch());
		await AgentInstaller.installAgentSystemdUnit(
			run,
			opts.rootlessUser,
			dockerSocket,
			opts.agentPort,
		);
		return;
	}
	await FullStackInstaller.bringUpFullStack({
		dockerSocket,
		host,
		image: opts.image,
		rootful,
		run,
		swarm: rootful,
		username: opts.rootlessUser,
		version: opts.version,
	});
}

/** `--advertise-addr=`, else this host's default-route address, else null to let `docker swarm init` pick. */
async function advertiseAddressFor(opts: Options): Promise<string | null> {
	return opts.advertiseAddress ?? (await Detector.hostAddress());
}

/** `--migrate-to-rootful`: runs the migration, then prints what's left for the operator. */
async function migrateToRootful(opts: Options, run: StepRunner): Promise<void> {
	const report = await RootfulMigration.migrate({
		advertiseAddress: await advertiseAddressFor(opts),
		domain: opts.domain,
		dryRun: opts.dryRun,
		image: opts.image,
		resolveHost: () => resolveHost(opts),
		run,
		username: opts.rootlessUser,
		version: opts.version,
	});

	console.log(
		"\nDone. Homerun now runs on the system Docker daemon in swarm mode.",
	);
	console.log(
		"Every deployed service has been queued for a redeploy as a swarm service : follow them on the dashboard's Services page.",
	);
	console.log(
		`Check the stack with: sudo docker compose -f ${report.composePath} ps`,
	);
	if (report.otherContainers.length > 0) {
		console.log(
			"\nThese containers weren't created by Homerun and weren't moved, recreate them on the system daemon yourself:",
		);
		for (const container of report.otherContainers) {
			console.log(`  ${container}`);
		}
	}
	if (report.bindMounts.length > 0) {
		console.log(
			"\nServices bind-mount these host paths. Files there are still owned by the rootless user's mapped ids, so a container running as a non-root user may need a chown:",
		);
		for (const path of report.bindMounts) {
			console.log(`  ${path}`);
		}
	}
	console.log(
		`\nThe rootless daemon is stopped and disabled, its data is untouched. Once you're happy, remove it with:
  sudo -u ${opts.rootlessUser} env XDG_RUNTIME_DIR=/run/user/${report.uid} /home/${opts.rootlessUser}/bin/dockerd-rootless-setuptool.sh uninstall
  sudo rm -rf /home/${opts.rootlessUser}/.local/share/docker /home/${opts.rootlessUser}/bin
  sudo rm -f /home/${opts.rootlessUser}/homerun/compose.rootless.yaml /etc/sysctl.d/90-homerun-rootless-ports.conf`,
	);
}

function printNextSteps(
	opts: Options,
	dockerSocket: string,
	host: string,
): void {
	if (opts.mode === "agent") {
		console.log(
			`Homerun Agent should now be listening on port ${opts.agentPort}.`,
		);
		console.log(
			`Its token: sudo -u ${opts.rootlessUser} cat /home/${opts.rootlessUser}/.homerun-agent/token`,
		);
		console.log(
			"Paste that (plus this host's reachable URL) into the main Homerun instance's Remote Hosts page.",
		);
		return;
	}
	const composePath = `/home/${opts.rootlessUser}/homerun/compose.yaml`;
	console.log(`Dashboard: http://${host}:3000`);
	console.log(
		`The full stack should be coming up under ${composePath}, check with:`,
	);
	const asUser =
		dockerFlavourOf(opts) === "rootful"
			? "sudo"
			: `sudo -u ${opts.rootlessUser} env DOCKER_HOST=unix://${dockerSocket}`;
	console.log(`  ${asUser} docker compose -f ${composePath} ps`);
	console.log(
		`AUTH_SECRET was auto-generated into ${composePath.replace(
			"compose.yaml",
			".env",
		)} ; if it's not up yet, check the other vars there (ORIGIN, ACME_EMAIL, etc.) then re-run \`${asUser} docker compose -f ${composePath} up -d\`.`,
	);
}

main().catch((error) => {
	console.error(
		`\ninstaller failed: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(1);
});
