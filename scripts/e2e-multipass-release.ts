import { readFileSync } from "node:fs";
import process from "node:process";
import { commandLines, Docs, normalizeCommand } from "./e2e/docs";
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
import { PublishedRelease } from "./e2e/release";

const FULL_VM = "homerun-e2e-rel-full";
const AGENT_VM = "homerun-e2e-rel-agent";
const COMPOSE_VM = "homerun-e2e-rel-compose";
const CLI_CONTAINER = "homerun-e2e-rel-cli";
const ADMIN_EMAIL = "e2e@homerun-release-suite.local";
const ADMIN_PASSWORD = "ReleaseE2eSuite123!";
const APP_IMAGE = "orochibraru/homerun";

const ALL_PHASES = [
	"docs",
	"full",
	"agent",
	"remote",
	"cli",
	"compose",
] as const;
type Phase = (typeof ALL_PHASES)[number];

const argv = process.argv.slice(2);

function flag(name: string): string | undefined {
	const found = argv.find((arg) => arg.startsWith(`--${name}=`));
	return found?.slice(name.length + 3);
}

function phaseList(name: string): Phase[] | undefined {
	const raw = flag(name);
	if (raw === undefined) {
		return undefined;
	}
	return raw.split(",").map((entry) => {
		const phase = entry.trim();
		if (!ALL_PHASES.includes(phase as Phase)) {
			throw new Error(
				`Unknown phase "${phase}" in --${name}=. Known phases: ${ALL_PHASES.join(", ")}`,
			);
		}
		return phase as Phase;
	});
}

const keep = argv.includes("--keep");
const version = flag("version") ?? "latest";
const ref = flag("ref") ?? "main";
const only = phaseList("only");
const skip = new Set(phaseList("skip") ?? []);

function enabled(phase: Phase): boolean {
	if (phase === "docs") {
		return true;
	}
	return (only ? only.includes(phase) : true) && !skip.has(phase);
}

const needsVms = ALL_PHASES.some((phase) => phase !== "docs" && enabled(phase));

function pinned(command: string): string {
	return version === "latest" ? command : `${command} --version=${version}`;
}

function showCommand(source: string, command: string): void {
	console.log(`  verbatim from ${source}:`);
	for (const line of command.split("\n")) {
		console.log(`    | ${line}`);
	}
}

interface DocumentedCommands {
	installerFull: string;
	installerAgent: string;
	composeStack: string;
	cliInstall: string;
	cliReference: string[];
	cliEnvUsage: string;
}

function atRef(command: string): string {
	if (ref === "main") {
		return command;
	}
	return command.replace(
		/(https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/)main\//g,
		`$1${ref}/`,
	);
}

async function assertDocumentedUrls(command: string): Promise<void> {
	for (const url of command.match(/https:\/\/\S*githubusercontent\S+/g) ?? []) {
		const repoPath = url.replace(
			/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\//,
			"",
		);
		assert(
			await Bun.file(repoPath).exists(),
			`Documented URL ${url} points at "${repoPath}", which doesn't exist in this checkout.`,
		);
		const live = atRef(url);
		const res = await fetch(live, { method: "HEAD" });
		assert(res.ok, `Documented URL ${live} isn't reachable: ${res.status}`);
	}
}

async function readDocumentedCommands(): Promise<DocumentedCommands> {
	log("Cross-checking the documented install commands against each other");

	const installerFull = Docs.command(
		"docs/getting-started.md",
		"bootstrap.sh",
		"--mode=full",
	);
	showCommand("docs/getting-started.md", installerFull);

	const installerReadme = Docs.command(
		"packages/installer/README.md",
		"bootstrap.sh",
		"--mode=full",
	);
	assert(
		normalizeCommand(installerReadme) === normalizeCommand(installerFull),
		`packages/installer/README.md's one-liner differs from docs/getting-started.md's:\n  ${normalizeCommand(installerReadme)}\n  ${normalizeCommand(installerFull)}`,
	);
	assert(
		normalizeCommand(Docs.siteOneLiner()) === normalizeCommand(installerFull),
		`The docs site landing page's copy-paste command differs from docs/getting-started.md's:\n  ${normalizeCommand(Docs.siteOneLiner())}\n  ${normalizeCommand(installerFull)}`,
	);

	const installerAgent = Docs.command(
		"packages/agent/README.md",
		"bootstrap.sh",
		"--mode=agent",
	);
	assert(
		normalizeCommand(installerAgent) ===
			normalizeCommand(installerFull).replace("--mode=full", "--mode=agent"),
		`packages/agent/README.md's --mode=agent one-liner isn't docs/getting-started.md's with the mode swapped:\n  ${normalizeCommand(installerAgent)}`,
	);

	const cliInstall = Docs.command(
		"docs/api-and-cli.md",
		"packages/cli/install.sh",
	);
	const cliReference = commandLines(
		Docs.command(
			"docs/api-and-cli.md",
			"homerun services list",
			"homerun templates list",
		),
	);
	const cliEnvUsage = Docs.command("docs/api-and-cli.md", "HOMERUN_API_KEY");
	const composeStack = Docs.command(
		"docs/getting-started.md",
		"compose.prod.yaml",
	);

	for (const command of [installerFull, cliInstall, composeStack]) {
		await assertDocumentedUrls(command);
	}

	const cliInstallUrl = cliInstall.match(/https:\/\/\S+install\.sh/)?.[0];
	assert(cliInstallUrl, `No install.sh URL found in:\n${cliInstall}`);
	assert(
		readFileSync("packages/cli/install.sh", "utf8").includes(cliInstallUrl),
		`packages/cli/install.sh's own header doesn't document the URL the docs tell users to curl (${cliInstallUrl}).`,
	);

	console.log(`  Documented CLI commands: ${cliReference.length}`);
	if (ref !== "main") {
		console.log(`  (fetching documented URLs from the "${ref}" ref, not main)`);
	}
	return {
		cliEnvUsage,
		cliInstall: atRef(cliInstall),
		cliReference,
		composeStack: atRef(composeStack),
		installerAgent: atRef(installerAgent),
		installerFull: atRef(installerFull),
	};
}

async function resolveRelease(): Promise<PublishedRelease> {
	log(`Resolving the published release under test (${version})`);
	const release = await PublishedRelease.resolve(version);
	release.assertAssets([
		"homerun-agent-amd64",
		"homerun-agent-arm64",
		"homerun-cli-amd64",
		"homerun-cli-arm64",
		"homerun-installer-amd64",
		"homerun-installer-arm64",
	]);
	console.log(
		`  ${release.repo} ${release.tag}, all six binaries published (this host pulls the ${arch} ones).`,
	);
	return release;
}

async function provisionAgent(
	vm: Vm,
	cmds: DocumentedCommands,
): Promise<{ token: string; url: string }> {
	log(`Launching ${vm.name} and running the documented agent one-liner`);
	await vm.recreate(1, "2G", "10G");
	showCommand("packages/agent/README.md", cmds.installerAgent);
	await vm.runScript(pinned(cmds.installerAgent));

	const ip = await vm.ip();
	const url = `http://${ip}:${AGENT_PORT}`;
	const token = (
		await vm.exec([
			"sudo",
			"cat",
			`/home/${ROOTLESS_USER}/.homerun-agent/token`,
		])
	).trim();

	await waitFor(`agent health at ${url}`, async () => {
		const res = await fetch(`${url}/v1/health`).catch(() => null);
		return res?.ok ?? false;
	});

	const spec = (await (await fetch(`${url}/v1/openapi.json`)).json()) as {
		openapi?: string;
	};
	assert(
		spec.openapi?.startsWith("3.1"),
		`Agent /v1/openapi.json isn't an OpenAPI 3.1 document: ${JSON.stringify(spec).slice(0, 120)}`,
	);
	const unauthed = await fetch(`${url}/v1/stats`);
	assert(
		unauthed.status === 401,
		`Expected 401 from an unauthenticated /v1/stats, got ${unauthed.status}.`,
	);

	console.log(`  Agent reachable at ${url}, spec + auth rejection confirmed.`);
	return { token, url };
}

async function provisionFull(
	vm: Vm,
	cmds: DocumentedCommands,
): Promise<AppClient> {
	log(`Launching ${vm.name} and running the documented installer one-liner`);
	await vm.recreate(2, "4G", "20G");
	showCommand("docs/getting-started.md", cmds.installerFull);
	await vm.runScript(pinned(cmds.installerFull));

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

	const health = await fetch(`${baseUrl}/api/health`);
	assert(
		health.status === 200,
		`GET /api/health returned ${health.status}, docs promise a plain 200.`,
	);

	const images = await vm.docker(["ps", "--format", "{{.Image}}"]);
	assert(
		images.includes(APP_IMAGE),
		`Expected the published ${APP_IMAGE} image to be running, found:\n${images}`,
	);

	console.log(`  Full stack reachable at ${baseUrl}, running ${APP_IMAGE}.`);
	return new AppClient(baseUrl);
}

async function bootstrapAdmin(client: AppClient): Promise<void> {
	log("Signing up the bootstrap admin and completing onboarding");
	await client.postJson("/api/v1/auth/sign-up/email", {
		email: ADMIN_EMAIL,
		name: "Release E2E",
		password: ADMIN_PASSWORD,
	});
	await client.postForm("/onboarding?/finish", {
		baseDomain: "homerun-e2e.local",
		traefikCertResolver: "letsencrypt",
		traefikEntrypoint: "web",
	});

	const session = await client.request("/api/v1/services");
	assert(
		session.ok,
		`Expected an authenticated session after onboarding, GET /api/v1/services returned ${session.status}.`,
	);
	console.log("  Onboarding complete, session authenticated.");
}

async function testLocalDeploy(client: AppClient, vm: Vm): Promise<string> {
	log("Deploying a real service on the full-stack VM itself");
	const service = (await client.postJson("/api/v1/services", {
		containerPort: 80,
		dnsResolvable: false,
		image: "nginx",
		name: "e2e-release-local",
		slug: "e2e-release-local",
		tag: "alpine",
	})) as { id: string };

	const result = (await client.postJson(
		`/api/v1/services/${service.id}/deploy`,
		{},
	)) as { containerId?: string; error?: string; success: boolean };
	assert(result.success, `Local deploy failed: ${JSON.stringify(result)}`);

	const running = await vm.docker([
		"ps",
		"--filter",
		"name=e2e-release-local",
		"--format",
		"{{.Names}}: {{.Status}}",
	]);
	assert(
		running.includes("e2e-release-local"),
		`Expected the deployed container on the full-stack VM, found:\n${running}`,
	);
	console.log(`  Deployed locally: ${running.trim()}`);
	return service.id;
}

async function testRemoteHostAndDeploy(
	client: AppClient,
	agentVm: Vm,
	agent: { token: string; url: string },
): Promise<void> {
	log("Registering the agent VM as a Remote Host and deploying through it");

	const hostResult = (await client.postForm("/remote-hosts/new?/create", {
		agentToken: agent.token,
		agentUrl: agent.url,
		kind: "agent",
		name: "e2e-release-agent-host",
	})) as { data: string };
	const remoteHostId = parseActionData<string>(hostResult.data, "hostId");
	console.log(`  Remote host registered: ${remoteHostId}`);

	const service = (await client.postJson("/api/v1/services", {
		containerPort: 80,
		dnsResolvable: false,
		image: "nginx",
		name: "e2e-release-remote",
		slug: "e2e-release-remote",
		tag: "alpine",
	})) as { id: string };

	await client.postForm(`/services/${service.id}/settings?/moveRemoteHost`, {
		remoteHostId,
	});

	const deployResult = (await client.postJson(
		`/api/v1/services/${service.id}/deploy`,
		{},
	)) as { containerId?: string; success: boolean };
	assert(
		deployResult.success,
		`Remote deploy failed: ${JSON.stringify(deployResult)}`,
	);

	const running = await agentVm.docker([
		"ps",
		"--filter",
		"name=e2e-release-remote",
		"--format",
		"{{.Names}}: {{.Status}}",
	]);
	assert(
		running.includes("e2e-release-remote"),
		`Expected the deployed container on the agent VM, found:\n${running}`,
	);
	console.log(`  Confirmed on the agent VM: ${running.trim()}`);

	await client.postJson(`/api/v1/services/${service.id}/stop`, {});
	const stopped = await agentVm.docker([
		"ps",
		"-a",
		"--filter",
		"name=e2e-release-remote",
		"--format",
		"{{.Status}}",
	]);
	assert(
		stopped.toLowerCase().includes("exited"),
		`Expected the container stopped, got: ${stopped}`,
	);

	await client.postJson(`/api/v1/services/${service.id}/start`, {});
	const restarted = await agentVm.docker([
		"ps",
		"--filter",
		"name=e2e-release-remote",
		"--format",
		"{{.Status}}",
	]);
	assert(
		restarted.toLowerCase().includes("up"),
		`Expected the container running again, got: ${restarted}`,
	);
	console.log("  Stop/start round trip through the agent confirmed.");
}

async function testCli(
	fullVm: Vm,
	cmds: DocumentedCommands,
	serviceId: string | null,
): Promise<void> {
	log("Installing the published CLI and running its documented commands");

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

	const inContainer = async (
		command: string,
		opts?: { allowFailure?: boolean; detach?: boolean },
	) =>
		exec(
			[
				"docker",
				"exec",
				...(opts?.detach ? ["-d"] : []),
				CLI_CONTAINER,
				"bash",
				"-c",
				command,
			],
			{ allowFailure: opts?.allowFailure },
		);

	await inContainer("apt-get -qq update && apt-get -qq install -y curl");
	showCommand("docs/api-and-cli.md", cmds.cliInstall);
	await inContainer(pinned(cmds.cliInstall));
	const { stdout: cliVersion } = await inContainer("homerun --version");
	assert(
		cliVersion.trim().length > 0,
		"homerun --version printed nothing after the documented install.",
	);
	console.log(`  Installed CLI reports version: ${cliVersion.trim()}`);

	const baseUrl = `http://${await fullVm.ip()}:${APP_PORT}`;
	await inContainer(
		`homerun login --base-url ${baseUrl} > /tmp/login.log 2>&1`,
		{
			detach: true,
		},
	);

	const userCode = await waitFor(
		"CLI login user code",
		async () => {
			const { stdout } = await inContainer("cat /tmp/login.log", {
				allowFailure: true,
			});
			return stdout.match(/Code: ([A-Z0-9-]+)/)?.[1] ?? null;
		},
		{ intervalMs: 1000, timeoutMs: 30_000 },
	);
	console.log(`  Device code: ${userCode}`);

	const client = new AppClient(baseUrl);
	await client.postJson("/api/v1/auth/sign-in/email", {
		email: ADMIN_EMAIL,
		password: ADMIN_PASSWORD,
	});
	await client.postForm("/cli-auth?/approve", { code: userCode });

	await waitFor(
		"CLI login completion",
		async () => {
			const { stdout } = await inContainer("cat /tmp/login.log", {
				allowFailure: true,
			});
			return stdout.includes("Logged in to");
		},
		{ intervalMs: 1000, timeoutMs: 30_000 },
	);
	console.log("  homerun login completed, API key saved.");

	for (const documented of cmds.cliReference) {
		const command = documented.replace(/\s*\[--json\]/g, "");
		if (command.includes("<id>")) {
			if (!serviceId) {
				console.log(`  (skipped, no service this run) ${command}`);
				continue;
			}
			await inContainer(command.replace("<id>", serviceId));
			continue;
		}
		await inContainer(command);
	}
	console.log(`  All ${cmds.cliReference.length} documented commands ran.`);

	const { stdout: configJson } = await inContainer(
		"cat ~/.config/homerun/config.json",
	);
	const apiKey = (JSON.parse(configJson) as { apiKey?: string }).apiKey;
	assert(apiKey, `No apiKey in the CLI's saved config: ${configJson}`);
	await inContainer("homerun logout");

	const envUsage = cmds.cliEnvUsage
		.replace(/HOMERUN_BASE_URL=\S+/, `HOMERUN_BASE_URL=${baseUrl}`)
		.replace(/HOMERUN_API_KEY=[^\n\\]*/, `HOMERUN_API_KEY=${apiKey} `)
		.replace(/\\\n\s*/g, " ");
	showCommand("docs/api-and-cli.md", envUsage);
	await inContainer(envUsage);

	const { code: badKeyCode } = await inContainer(
		`homerun services list --api-key not-a-real-key --base-url ${baseUrl}`,
		{ allowFailure: true },
	);
	assert(
		badKeyCode !== 0,
		"Expected a bad API key to fail, but the command succeeded.",
	);
	console.log("  Env-var invocation and bad-key rejection both confirmed.");
}

async function testComposeStack(
	vm: Vm,
	cmds: DocumentedCommands,
): Promise<void> {
	log(
		`Launching ${vm.name} and running the documented compose stack (Option B)`,
	);
	await vm.recreate(2, "4G", "20G");

	await vm.runScript("curl -fsSL https://get.docker.com | sh", { sudo: true });

	await vm.writeFile(
		"/tmp/homerun-e2e-editor",
		`#!/bin/sh\nsed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -hex 32)|" "$1"\n`,
	);
	await vm.runScript("chmod +x /tmp/homerun-e2e-editor", { sudo: true });

	showCommand("docs/getting-started.md", cmds.composeStack);
	await vm.runScript(cmds.composeStack, {
		cwd: "/root/homerun-compose",
		env: { EDITOR: "/tmp/homerun-e2e-editor" },
		sudo: true,
	});

	const baseUrl = `http://${await vm.ip()}:${APP_PORT}`;
	await waitFor(
		`compose stack healthy at ${baseUrl}`,
		async () => {
			const res = await fetch(`${baseUrl}/api/health`).catch(() => null);
			return res?.status === 200;
		},
		{ timeoutMs: 180_000 },
	);

	const images = await vm.dockerRoot(["ps", "--format", "{{.Image}}"]);
	assert(
		images.includes(APP_IMAGE),
		`Expected the published ${APP_IMAGE} image in the compose stack, found:\n${images}`,
	);
	console.log(
		`  Compose stack up and healthy at ${baseUrl}, running ${APP_IMAGE}.`,
	);
}

async function cleanup(): Promise<void> {
	if (!needsVms) {
		return;
	}
	if (keep) {
		console.log(
			"\n--keep set : leaving the VMs and CLI container running for inspection.",
		);
		for (const name of [FULL_VM, AGENT_VM, COMPOSE_VM]) {
			console.log(`  multipass shell ${name}`);
		}
		console.log(`  docker exec -it ${CLI_CONTAINER} bash`);
		console.log(
			`\nClean up later with: multipass delete ${FULL_VM} ${AGENT_VM} ${COMPOSE_VM} --purge && docker rm -f ${CLI_CONTAINER}`,
		);
		return;
	}
	log("Cleaning up (VMs, CLI container)");
	for (const name of [FULL_VM, AGENT_VM, COMPOSE_VM]) {
		await new Vm(name).delete();
	}
	await exec(["docker", "rm", "-f", CLI_CONTAINER], { allowFailure: true });
}

function checkPhaseDependencies(): void {
	for (const phase of ["remote", "cli"] as const) {
		assert(
			!enabled(phase) || enabled("full"),
			`--only/--skip: the "${phase}" phase needs the "full" phase (it drives that instance).`,
		);
	}
	assert(
		!enabled("remote") || enabled("agent"),
		'--only/--skip: the "remote" phase needs the "agent" phase (it registers that VM as a Remote Host).',
	);
}

async function main(): Promise<void> {
	const startedAt = Date.now();

	try {
		checkPhaseDependencies();
		await preflight(needsVms ? ["multipass", "docker"] : []);

		const cmds = await readDocumentedCommands();
		await resolveRelease();

		const fullVm = new Vm(FULL_VM);
		const agentVm = new Vm(AGENT_VM);

		const [agent, client] = await Promise.all([
			enabled("agent") ? provisionAgent(agentVm, cmds) : null,
			enabled("full") ? provisionFull(fullVm, cmds) : null,
			enabled("compose") ? testComposeStack(new Vm(COMPOSE_VM), cmds) : null,
		]);

		let serviceId: string | null = null;
		if (client) {
			await bootstrapAdmin(client);
			serviceId = await testLocalDeploy(client, fullVm);
		}
		if (client && agent && enabled("remote")) {
			await testRemoteHostAndDeploy(client, agentVm, agent);
		}
		if (enabled("cli")) {
			await testCli(fullVm, cmds, serviceId);
		}

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
