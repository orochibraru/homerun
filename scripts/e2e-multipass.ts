import process from "node:process";
import {
	AGENT_PORT,
	APP_PORT,
	AppClient,
	arch,
	exec,
	log,
	parseActionData,
	preflight,
	ROOTLESS_USER,
	Vm,
	waitFor,
} from "./e2e/multipass";

const FULL_VM = "homerun-e2e-full";
const AGENT_VM = "homerun-e2e-agent";
const CLI_CONTAINER = "homerun-e2e-cli";

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const keep = args.has("--keep");

async function buildBinaries(): Promise<void> {
	log(`Building installer/agent/cli binaries for ${arch}`);
	if (skipBuild) {
		console.log(`  --skip-build : reusing dist/homerun-*-${arch}`);
		return;
	}
	await exec(["bun", "run", "scripts/build-packages.ts", arch]);
}

async function provisionAgent(vm: Vm): Promise<{ token: string; url: string }> {
	log(`Launching ${vm.name} and installing the Homerun Agent (--mode=agent)`);
	await vm.recreate(1, "2G", "10G");
	await vm.transfer(`dist/homerun-installer-${arch}`, "/tmp/homerun-installer");
	await vm.exec(["chmod", "+x", "/tmp/homerun-installer"]);
	await vm.exec(["sudo", "/tmp/homerun-installer", "--mode=agent", "--yes"]);

	const ip = await vm.ip();
	const token = (
		await vm.exec([
			"sudo",
			"cat",
			`/home/${ROOTLESS_USER}/.homerun-agent/token`,
		])
	).trim();

	await waitFor(`agent health at ${ip}:${AGENT_PORT}`, async () => {
		const res = await fetch(`http://${ip}:${AGENT_PORT}/v1/health`).catch(
			() => null,
		);
		return res?.ok ?? false;
	});

	console.log(`  Agent reachable at http://${ip}:${AGENT_PORT}`);
	return { token, url: `http://${ip}:${AGENT_PORT}` };
}

async function provisionFull(vm: Vm): Promise<AppClient> {
	log(`Launching ${vm.name} and installing the full stack (--mode=full)`);
	await vm.recreate(2, "4G", "20G");
	await vm.transfer(`dist/homerun-installer-${arch}`, "/tmp/homerun-installer");
	await vm.exec(["chmod", "+x", "/tmp/homerun-installer"]);
	await vm.exec(["sudo", "/tmp/homerun-installer", "--mode=full", "--yes"]);

	const ip = await vm.ip();
	const baseUrl = `http://${ip}:${APP_PORT}`;
	const composePath = `/home/${ROOTLESS_USER}/homerun/compose.yaml`;

	await vm.exec([
		"sudo",
		"-u",
		ROOTLESS_USER,
		"bash",
		"-c",
		`echo 'ORIGIN=${baseUrl}' >> /home/${ROOTLESS_USER}/homerun/.env`,
	]);
	await vm.docker([
		"compose",
		"-f",
		composePath,
		"up",
		"-d",
		"--force-recreate",
		"app",
	]);

	await waitFor(`app healthy at ${baseUrl}`, async () => {
		const res = await fetch(baseUrl, { redirect: "manual" }).catch(() => null);
		return res !== null && res.status < 500;
	});

	console.log(`  Full stack reachable at ${baseUrl}`);
	return new AppClient(baseUrl);
}

async function bootstrapAdmin(client: AppClient): Promise<void> {
	log("Signing up the bootstrap admin and completing onboarding");
	const email = "e2e@homerun-multipass-suite.local";
	const password = "MultipassE2eSuite123!";

	await client.postJson("/api/v1/auth/sign-up/email", {
		email,
		name: "Multipass E2E",
		password,
	});

	await client.postForm("/onboarding?/finish", {
		baseDomain: "homerun-e2e.local",
		traefikCertResolver: "letsencrypt",
		traefikEntrypoint: "web",
	});
	console.log("  Onboarding complete.");
}

async function testRemoteHostAndDeploy(
	client: AppClient,
	agentVm: Vm,
	agent: { token: string; url: string },
): Promise<void> {
	log(
		"Registering the agent VM as a Remote Host and deploying a real service to it",
	);

	const hostResult = (await client.postForm("/remote-hosts/new?/create", {
		agentToken: agent.token,
		agentUrl: agent.url,
		kind: "agent",
		name: "e2e-agent-host",
	})) as { data: string };
	const remoteHostId = parseActionData<string>(hostResult.data, "hostId");
	console.log(`  Remote host registered: ${remoteHostId}`);

	const service = (await client.postJson("/api/v1/services", {
		containerPort: 80,
		dnsResolvable: false,
		image: "nginx",
		name: "e2e-multipass-nginx",
		slug: "e2e-multipass-nginx",
		tag: "alpine",
	})) as { id: string };
	console.log(`  Service created: ${service.id}`);

	await client.postForm(`/services/${service.id}/settings?/moveRemoteHost`, {
		remoteHostId,
	});

	const deployResult = (await client.postJson(
		`/api/v1/services/${service.id}/deploy`,
		{},
	)) as { containerId?: string; success: boolean };
	if (!deployResult.success) {
		throw new Error(`Deploy failed: ${JSON.stringify(deployResult)}`);
	}
	console.log(`  Deployed, containerId=${deployResult.containerId}`);

	const running = await agentVm.docker([
		"ps",
		"--filter",
		"name=e2e-multipass-nginx",
		"--format",
		"{{.Names}}: {{.Status}}",
	]);
	if (!running.includes("e2e-multipass-nginx")) {
		throw new Error(
			`Expected the deployed container on the agent VM, found:\n${running}`,
		);
	}
	console.log(`  Confirmed on the agent VM: ${running.trim()}`);

	await client.postJson(`/api/v1/services/${service.id}/stop`, {});
	const stopped = await agentVm.docker([
		"ps",
		"-a",
		"--filter",
		"name=e2e-multipass-nginx",
		"--format",
		"{{.Status}}",
	]);
	if (!stopped.toLowerCase().includes("exited")) {
		throw new Error(`Expected the container stopped, got: ${stopped}`);
	}

	await client.postJson(`/api/v1/services/${service.id}/start`, {});
	const restarted = await agentVm.docker([
		"ps",
		"--filter",
		"name=e2e-multipass-nginx",
		"--format",
		"{{.Status}}",
	]);
	if (!restarted.toLowerCase().includes("up")) {
		throw new Error(`Expected the container running again, got: ${restarted}`);
	}
	console.log("  Stop/start round trip through the agent confirmed.");
}

async function testCli(fullVm: Vm): Promise<void> {
	log(
		"Testing the CLI (install.sh + homerun login device flow + every command)",
	);

	await exec(["docker", "rm", "-f", CLI_CONTAINER], { allowFailure: true });
	await exec([
		"docker",
		"run",
		"-d",
		"--name",
		CLI_CONTAINER,
		"--network",
		"host",
		"ubuntu:24.04",
		"sleep",
		"infinity",
	]);

	await exec([
		"docker",
		"exec",
		CLI_CONTAINER,
		"bash",
		"-c",
		"apt-get -qq update && apt-get -qq install -y curl",
	]);
	await exec([
		"docker",
		"exec",
		CLI_CONTAINER,
		"bash",
		"-c",
		"curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/packages/cli/install.sh | bash",
	]);
	await exec(["docker", "exec", CLI_CONTAINER, "homerun", "--version"]);

	const ip = await fullVm.ip();
	const baseUrl = `http://${ip}:${APP_PORT}`;

	await exec([
		"docker",
		"exec",
		"-d",
		CLI_CONTAINER,
		"bash",
		"-c",
		`homerun login --base-url ${baseUrl} > /tmp/login.log 2>&1`,
	]);

	const userCode = await waitFor(
		"CLI login user code",
		async () => {
			const { stdout } = await exec(
				["docker", "exec", CLI_CONTAINER, "cat", "/tmp/login.log"],
				{ allowFailure: true },
			);
			const match = stdout.match(/Code: ([A-Z0-9-]+)/);
			return match?.[1] ?? null;
		},
		{ intervalMs: 1000, timeoutMs: 30_000 },
	);
	console.log(`  Device code: ${userCode}`);

	const client = new AppClient(baseUrl);

	await client.postJson("/api/v1/auth/sign-in/email", {
		email: "e2e@homerun-multipass-suite.local",
		password: "MultipassE2eSuite123!",
	});
	await client.postForm("/cli-auth?/approve", { code: userCode });

	await waitFor(
		"CLI login completion",
		async () => {
			const { stdout } = await exec(
				["docker", "exec", CLI_CONTAINER, "cat", "/tmp/login.log"],
				{ allowFailure: true },
			);
			return stdout.includes("Logged in to");
		},
		{ intervalMs: 1000, timeoutMs: 30_000 },
	);
	console.log("  homerun login completed, API key saved.");

	for (const cmd of [
		["services", "list"],
		["projects", "list"],
		["templates", "list"],
	]) {
		await exec(["docker", "exec", CLI_CONTAINER, "homerun", ...cmd]);
	}

	const { code: badKeyCode } = await exec(
		[
			"docker",
			"exec",
			CLI_CONTAINER,
			"homerun",
			"services",
			"list",
			"--api-key",
			"not-a-real-key",
			"--base-url",
			baseUrl,
		],
		{ allowFailure: true },
	);
	if (badKeyCode === 0) {
		throw new Error(
			"Expected a bad API key to fail, but the command succeeded.",
		);
	}
	console.log("  Bad API key correctly rejected.");

	await exec(["docker", "exec", CLI_CONTAINER, "homerun", "logout"]);
}

async function cleanup(): Promise<void> {
	if (keep) {
		console.log(
			"\n--keep set : leaving the VMs and CLI container running for inspection.",
		);
		console.log(`  multipass shell ${FULL_VM}`);
		console.log(`  multipass shell ${AGENT_VM}`);
		console.log(`  docker exec -it ${CLI_CONTAINER} bash`);
		console.log(
			`\nClean up later with: multipass delete ${FULL_VM} ${AGENT_VM} --purge && docker rm -f ${CLI_CONTAINER}`,
		);
		return;
	}
	log("Cleaning up (VMs, CLI container)");
	await new Vm(FULL_VM).delete();
	await new Vm(AGENT_VM).delete();
	await exec(["docker", "rm", "-f", CLI_CONTAINER], { allowFailure: true });
}

async function main(): Promise<void> {
	const startedAt = Date.now();

	try {
		await preflight(["multipass", "docker"]);
		await buildBinaries();

		const fullVm = new Vm(FULL_VM);
		const agentVm = new Vm(AGENT_VM);

		const [agent, client] = await Promise.all([
			provisionAgent(agentVm),
			provisionFull(fullVm),
		]);

		await bootstrapAdmin(client);
		await testRemoteHostAndDeploy(client, agentVm, agent);
		await testCli(fullVm);

		const elapsed = Math.round((Date.now() - startedAt) / 1000);
		console.log(`\n✔ All checks passed (${elapsed}s).`);
		await cleanup();
	} catch (error) {
		console.error(
			`\n✘ FAILED: ${error instanceof Error ? error.message : String(error)}`,
		);
		await cleanup();
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
