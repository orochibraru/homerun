import { StepRunner } from "./exec";
import { parseArgs, printHelp } from "./options";
import {
	buildAndInstallAgent,
	cloneRepo,
	ensureBunInstalled,
	installAgentSystemdUnit,
} from "./steps/build-agent";
import {
	arch,
	detectPackageManager,
	requireLinux,
	requireRoot,
} from "./steps/detect";
import { bringUpFullStack } from "./steps/full-stack";
import { ensureHomerunNetwork } from "./steps/network";
import {
	ensureRootlessUser,
	installDockerEngine,
	installRootlessDocker,
	installRootlessPrereqs,
} from "./steps/rootless-docker";

async function main() {
	const opts = parseArgs(process.argv.slice(2));

	console.log(
		"Homerun installer : draft/WIP, see installer/README.md before running against a real box.\n",
	);

	if (!opts.dryRun) {
		requireLinux();
		requireRoot();
	}

	if (!opts.repoUrl) {
		printHelp();
		console.error("\n--repo=<git url> is required.");
		process.exit(1);
	}

	const run = new StepRunner(opts.dryRun);
	const repoDir = `/home/${opts.rootlessUser}/homerun`;

	console.log(
		`Target: mode=${opts.mode} user=${opts.rootlessUser} arch=${arch()} dryRun=${opts.dryRun}\n`,
	);

	console.log("== 1/6 Docker engine + rootless prerequisites ==");
	// --dry-run is also how this installer's own logic gets exercised outside
	// a real Debian/RHEL box (e.g. from a macOS dev machine) : fall back to a
	// fake apt manager there instead of failing before anything else runs.
	const pm = opts.dryRun
		? await detectPackageManager().catch(() => ({
				install: ["apt-get", "install", "-y"],
				kind: "apt" as const,
			}))
		: await detectPackageManager();
	await installDockerEngine(run);
	await installRootlessPrereqs(run, pm);

	console.log("\n== 2/6 Rootless user ==");
	await ensureRootlessUser(run, opts.rootlessUser);

	console.log("\n== 3/6 Rootless Docker daemon ==");
	const dockerSocket = await installRootlessDocker(run, opts.rootlessUser);

	console.log("\n== 4/6 homerun-network ==");
	await ensureHomerunNetwork(run, opts.rootlessUser, dockerSocket);

	console.log("\n== 5/6 Build from source ==");
	await ensureBunInstalled(run, opts.rootlessUser);
	await cloneRepo(run, opts.rootlessUser, opts.repoUrl, opts.repoRef, repoDir);

	console.log("\n== 6/6 Install ==");
	if (opts.mode === "agent") {
		await buildAndInstallAgent(run, opts.rootlessUser, repoDir);
		await installAgentSystemdUnit(
			run,
			opts.rootlessUser,
			dockerSocket,
			opts.agentPort,
		);
	} else {
		await bringUpFullStack(run, opts.rootlessUser, repoDir, dockerSocket);
	}

	console.log("\nDone.");
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
	} else {
		console.log(
			`The full stack should be coming up under ${repoDir} : check with:`,
		);
		console.log(
			`  sudo -u ${opts.rootlessUser} env DOCKER_HOST=unix://${dockerSocket} docker compose -f ${repoDir}/compose.yaml ps`,
		);
	}
}

main().catch((error) => {
	console.error(
		`\ninstaller failed: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(1);
});
