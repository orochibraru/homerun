import process from "node:process";
import {
	AGENT_PORT,
	APP_PORT,
	AppClient,
	arch,
	assert,
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
const SWARM_MANAGER_VM = "homerun-e2e-swarm-manager";
const SWARM_WORKER_VM = "homerun-e2e-swarm-worker";
const SWARM_REPLICAS = 3;

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const keep = args.has("--keep");
const swarm = args.has("--swarm");

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

async function provisionFull(
	vm: Vm,
	installerFlags: string[] = [],
): Promise<AppClient> {
	log(
		`Launching ${vm.name} and installing the full stack (--mode=full ${installerFlags.join(" ")})`,
	);
	await vm.recreate(2, "4G", "20G");
	await vm.transfer(`dist/homerun-installer-${arch}`, "/tmp/homerun-installer");
	await vm.exec(["chmod", "+x", "/tmp/homerun-installer"]);
	await vm.exec([
		"sudo",
		"/tmp/homerun-installer",
		"--mode=full",
		...installerFlags,
		"--yes",
	]);

	const ip = await vm.ip();
	const baseUrl = `http://${ip}:${APP_PORT}`;

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

async function testBuildServerAndDeploy(
	client: AppClient,
	agent: { token: string; url: string },
): Promise<void> {
	log("Registering the agent VM as a build server and deploying a service");

	const hostResult = (await client.postForm("/remote-hosts/new?/create", {
		agentToken: agent.token,
		agentUrl: agent.url,
		kind: "agent",
		name: "e2e-agent-host",
	})) as { data: string };
	const buildServerId = parseActionData<string>(hostResult.data, "hostId");
	console.log(
		`  Build server registered (token verified live): ${buildServerId}`,
	);

	const service = (await client.postJson("/api/v1/services", {
		containerPort: 80,
		dnsResolvable: false,
		image: "nginx",
		name: "e2e-multipass-nginx",
		slug: "e2e-multipass-nginx",
		tag: "alpine",
	})) as { id: string };
	console.log(`  Service created: ${service.id}`);

	const deployResult = (await client.postJson(
		`/api/v1/services/${service.id}/deploy`,
		{},
	)) as { containerId?: string; success: boolean };
	if (!deployResult.success) {
		throw new Error(`Deploy failed: ${JSON.stringify(deployResult)}`);
	}
	console.log(`  Deployed, containerId=${deployResult.containerId}`);

	await client.postJson(`/api/v1/services/${service.id}/stop`, {});
	await client.postJson(`/api/v1/services/${service.id}/start`, {});
	console.log("  Stop/start round trip confirmed.");
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
		["stacks", "list"],
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

/**
 * Switches the manager to swarm mode the way Settings, Docker does, joins the
 * worker VM with `swarm-join.sh` piped into `sudo bash -s --` as documented,
 * then deploys a replicated `traefik/whoami` service and checks that tasks
 * land on the worker and that Traefik on the manager answers from every
 * replica.
 *
 * @throws When any step fails or a check times out.
 */
async function testSwarm(
	client: AppClient,
	managerVm: Vm,
	workerVm: Vm,
): Promise<void> {
	log("Enabling swarm mode on the manager");
	await client.postForm("/settings/docker?/updateOrchestration", {
		orchestrationMode: "swarm",
	});
	const token = (
		await managerVm.dockerRoot(["swarm", "join-token", "-q", "worker"])
	).trim();
	const managerIp = await managerVm.ip();

	log(`Launching ${workerVm.name} and running swarm-join.sh`);
	await workerVm.recreate(2, "2G", "12G");
	await workerVm.transfer(
		"packages/installer/swarm-join.sh",
		"/tmp/swarm-join.sh",
	);
	await workerVm.exec([
		"bash",
		"-c",
		`cat /tmp/swarm-join.sh | sudo bash -s -- --token=${token} --manager=${managerIp}:2377`,
	]);
	const nodes = await managerVm.dockerRoot([
		"node",
		"ls",
		"--format",
		"{{.Hostname}} {{.Status}}",
	]);
	assert(
		nodes.includes(`${workerVm.name} Ready`),
		`Worker never joined the swarm: ${nodes}`,
	);
	const workerIp = await workerVm.ip();
	await waitFor(`agent health at ${workerIp}:${AGENT_PORT}`, async () => {
		const res = await fetch(`http://${workerIp}:${AGENT_PORT}/v1/health`).catch(
			() => null,
		);
		return res?.ok ?? false;
	});

	log(`Deploying a ${SWARM_REPLICAS}-replica service across both nodes`);
	const slug = "e2e-swarm-whoami";
	const service = (await client.postJson("/api/v1/services", {
		containerPort: 80,
		image: "traefik/whoami",
		name: slug,
		slug,
		tag: "latest",
	})) as { id: string };
	await client.postForm(`/services/${service.id}/compute?/updateCompute`, {
		cpuLimit: "",
		memoryLimitMb: "",
		replicas: String(SWARM_REPLICAS),
	});
	await client.postJson(`/api/v1/services/${service.id}/deploy`, {});

	const swarmServiceId = await waitFor("swarm service created", async () =>
		(
			await managerVm.dockerRoot([
				"service",
				"ls",
				"-q",
				"--filter",
				`label=homerun.service.id=${service.id}`,
			])
		).trim(),
	);
	const tasks = await waitFor("every replica running", async () => {
		const output = await managerVm.dockerRoot([
			"service",
			"ps",
			swarmServiceId,
			"--filter",
			"desired-state=running",
			"--format",
			"{{.Node}} {{.CurrentState}}",
		]);
		const running = output
			.split("\n")
			.filter((line) => line.includes(" Running"));
		return running.length === SWARM_REPLICAS ? running : null;
	});
	assert(
		tasks.some((line) => line.startsWith(workerVm.name)),
		`No replica was scheduled on the worker: ${tasks.join(", ")}`,
	);

	const hostname = `${slug}.homerun-e2e.local`;
	const seen = new Set<string>();
	await waitFor(
		"Traefik answering from every replica",
		async () => {
			const { stdout } = await exec(
				[
					"curl",
					"-sk",
					"-m",
					"5",
					"--resolve",
					`${hostname}:80:${managerIp}`,
					`https://${hostname}:80/`,
				],
				{ allowFailure: true },
			);
			const match = stdout.match(/Hostname: (\S+)/);
			if (match?.[1]) {
				seen.add(match[1]);
			}
			return seen.size === SWARM_REPLICAS;
		},
		{ intervalMs: 1000, timeoutMs: 120_000 },
	);
	console.log(
		`  ${SWARM_REPLICAS} replicas answered through Traefik, including the worker's.`,
	);
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
	await new Vm(SWARM_MANAGER_VM).delete();
	await new Vm(SWARM_WORKER_VM).delete();
	await exec(["docker", "rm", "-f", CLI_CONTAINER], { allowFailure: true });
}

async function main(): Promise<void> {
	const startedAt = Date.now();

	try {
		await preflight(["multipass", "docker"]);
		await buildBinaries();

		if (swarm) {
			const managerVm = new Vm(SWARM_MANAGER_VM);
			const client = await provisionFull(managerVm, ["--docker=rootful"]);
			await bootstrapAdmin(client);
			await testSwarm(client, managerVm, new Vm(SWARM_WORKER_VM));
			console.log(
				`\n✔ Swarm checks passed (${Math.round((Date.now() - startedAt) / 1000)}s).`,
			);
			await cleanup();
			return;
		}

		const fullVm = new Vm(FULL_VM);
		const agentVm = new Vm(AGENT_VM);

		const [agent, client] = await Promise.all([
			provisionAgent(agentVm),
			provisionFull(fullVm),
		]);

		await bootstrapAdmin(client);
		await testBuildServerAndDeploy(client, agent);
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
