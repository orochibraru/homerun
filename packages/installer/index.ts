import { StepRunner } from "./exec";
import { OptionsParser } from "./options";
import { AgentInstaller } from "./steps/agent";
import { Detector } from "./steps/detect";
import { FullStackInstaller } from "./steps/full-stack";
import { NetworkSetup } from "./steps/network";
import { RootlessDockerInstaller } from "./steps/rootless-docker";

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

	console.log("== 1/5 Docker engine + rootless prerequisites ==");
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
		await FullStackInstaller.bringUpFullStack(
			run,
			opts.rootlessUser,
			opts.version,
			dockerSocket,
		);
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
		const composePath = `/home/${opts.rootlessUser}/homerun/compose.yaml`;
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
			)} ; if it's not up yet, check the other vars there (ORIGIN, BASE_DOMAIN, etc.) then re-run \`docker compose -f ${composePath} up -d\` as ${opts.rootlessUser}.`,
		);
	}
}

main().catch((error) => {
	console.error(
		`\ninstaller failed: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(1);
});
