import process from "node:process";
import { createInterface } from "node:readline/promises";
import { StepRunner } from "./exec";
import type { Options } from "./options";
import { OptionsParser } from "./options";
import { AgentInstaller } from "./steps/agent";
import { Detector } from "./steps/detect";
import { FullStackInstaller } from "./steps/full-stack";
import { NetworkSetup } from "./steps/network";
import { RootlessDockerInstaller } from "./steps/rootless-docker";

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

	console.log(
		"Homerun installer : draft/WIP, see installer/README.md before running against a real box.\n",
	);

	if (!opts.dryRun) {
		Detector.requireLinux();
		Detector.requireRoot();
	}

	const run = new StepRunner(opts.dryRun);

	console.log(
		`Target: mode=${opts.mode} user=${opts.rootlessUser} arch=${Detector.arch()} version=${opts.version} dryRun=${opts.dryRun}\n`,
	);

	const host = opts.mode === "full" ? await resolveHost(opts) : "";

	console.log("\n== 1/5 Docker engine + rootless prerequisites ==");
	// --dry-run is also how this installer's own logic gets exercised outside
	// a real Debian/RHEL box (e.g. from a macOS dev machine) : fall back to a
	// fake apt manager there instead of failing before anything else runs.
	const pm = opts.dryRun
		? await Detector.detectPackageManager().catch(() => ({
				install: ["apt-get", "install", "-y"],
				kind: "apt" as const,
			}))
		: await Detector.detectPackageManager();
	await RootlessDockerInstaller.installDockerEngine(run);
	await RootlessDockerInstaller.installRootlessPrereqs(run, pm);

	console.log("\n== 2/5 Rootless user ==");
	await RootlessDockerInstaller.ensureRootlessUser(run, opts.rootlessUser);

	console.log("\n== 3/5 Rootless Docker daemon ==");
	const dockerSocket = await RootlessDockerInstaller.installRootlessDocker(
		run,
		opts.rootlessUser,
	);

	console.log("\n== 4/5 homerun ==");
	await NetworkSetup.ensureHomerunNetwork(run, opts.rootlessUser, dockerSocket);

	console.log("\n== 5/5 Install ==");
	if (opts.mode === "agent") {
		await AgentInstaller.installAgentBinary(run, opts.version, Detector.arch());
		await AgentInstaller.installAgentSystemdUnit(
			run,
			opts.rootlessUser,
			dockerSocket,
			opts.agentPort,
		);
	} else {
		await FullStackInstaller.bringUpFullStack({
			dockerSocket,
			host,
			run,
			username: opts.rootlessUser,
			version: opts.version,
		});
	}

	console.log("\nDone.");
	printNextSteps(opts, dockerSocket, host);
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
	console.log(
		`  sudo -u ${opts.rootlessUser} env DOCKER_HOST=unix://${dockerSocket} docker compose -f ${composePath} ps`,
	);
	console.log(
		`AUTH_SECRET was auto-generated into ${composePath.replace(
			"compose.yaml",
			".env",
		)} ; if it's not up yet, check the other vars there (ORIGIN, ACME_EMAIL, etc.) then re-run \`docker compose -f ${composePath} up -d\` as ${opts.rootlessUser}.`,
	);
}

main().catch((error) => {
	console.error(
		`\ninstaller failed: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(1);
});
