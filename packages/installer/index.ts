import process from "node:process";
import { StepRunner } from "./exec";
import { OptionsParser } from "./options";
import { AgentInstaller } from "./steps/agent";
import { Detector } from "./steps/detect";
import { FullStackInstaller } from "./steps/full-stack";
import { NetworkSetup } from "./steps/network";
import { RootlessDockerInstaller } from "./steps/rootless-docker";

async function main() {
	const opts = OptionsParser.parseArgs(process.argv.slice(2));

	if (!opts.dryRun) {
		Detector.requireLinux();
		Detector.requireRoot();
	}

	const run = new StepRunner(opts.dryRun);
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
	await RootlessDockerInstaller.ensureRootlessUser(run, opts.rootlessUser);
	const dockerSocket = await RootlessDockerInstaller.installRootlessDocker(
		run,
		opts.rootlessUser,
	);
	await NetworkSetup.ensureHomerunNetwork(run, opts.rootlessUser, dockerSocket);
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
	if (opts.mode === "agent") {
	} else {
		const _composePath = `/home/${opts.rootlessUser}/homerun/compose.yaml`;
	}
}

main().catch((_error) => {
	process.exit(1);
});
