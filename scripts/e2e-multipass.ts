import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
const FRESH_SWARM_VM = "homerun-e2e-fresh-swarm";
const MIGRATE_VM = "homerun-e2e-migrate";
const DOKPLOY_VM = "homerun-e2e-dokploy";
const DOKPLOY_PORT = 3000;
const SIDE_BY_SIDE_FLAGS = [
	"--dashboard-port=4500",
	"--http-port=8080",
	"--https-port=8443",
];
const LOCAL_IMAGE = "homerun-e2e:local";
const PREVIOUS_RELEASE = "v1.0.26";
const ADMIN_EMAIL = "e2e@homerun-multipass-suite.local";
const ADMIN_PASSWORD = "MultipassE2eSuite123!";
const MARKER = "migration-marker-42";

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const keep = args.has("--keep");
const swarm = args.has("--swarm");
const freshSwarm = args.has("--fresh-swarm");
const migrate = args.has("--migrate");
const dokploy = args.has("--dokploy");
const localImage = args.has("--local-image");
const localImageArchive = `${tmpdir()}/homerun-e2e-image.tar.gz`;

/** With `--local-image`, builds the app image from this checkout once and saves it for loading into each VM, so app-side changes are exercised instead of the published image. */
async function buildLocalImage(): Promise<void> {
	if (!localImage) {
		return;
	}
	log(`Building ${LOCAL_IMAGE} from this checkout`);
	await exec(["docker", "build", "--target", "app", "-t", LOCAL_IMAGE, "."]);
	await exec([
		"bash",
		"-c",
		`docker save ${LOCAL_IMAGE} | gzip > ${localImageArchive}`,
	]);
}

/** With `--local-image`, installs Docker on the VM and loads the locally built app image into its system daemon, returning the installer flag that selects it. */
async function loadLocalImage(vm: Vm): Promise<string[]> {
	if (!localImage) {
		return [];
	}
	await vm.exec([
		"bash",
		"-c",
		"command -v docker || curl -fsSL https://get.docker.com | sudo sh",
	]);
	await vm.transfer(localImageArchive, "/tmp/homerun-image.tar.gz");
	await vm.exec([
		"bash",
		"-c",
		"gunzip -c /tmp/homerun-image.tar.gz | sudo docker load",
	]);
	return [`--image=${LOCAL_IMAGE}`];
}

/** Runs one SQL query against the stack's Postgres on the system daemon and returns its unaligned rows. */
async function sql(vm: Vm, query: string): Promise<string> {
	return (
		await vm.exec([
			"sudo",
			"docker",
			"compose",
			"-f",
			`/home/${ROOTLESS_USER}/homerun/compose.yaml`,
			"exec",
			"-T",
			"postgres",
			"psql",
			"-U",
			"homerun",
			"-d",
			"homerun",
			"-tAc",
			query,
		])
	).trim();
}

/** Fetches a path on a service through Traefik on the VM (the web entrypoint serves TLS, on :80 unless published elsewhere) and returns the body. */
async function throughTraefik(
	vm: Vm,
	host: string,
	path: string,
	port = 80,
): Promise<string> {
	const { stdout } = await exec(
		[
			"curl",
			"-sk",
			"-m",
			"5",
			"--resolve",
			`${host}:${port}:${await vm.ip()}`,
			`https://${host}:${port}${path}`,
		],
		{ allowFailure: true },
	);
	return stdout;
}

async function buildBinaries(): Promise<void> {
	log(`Building installer/worker/cli binaries for ${arch}`);
	if (skipBuild) {
		console.log(`  --skip-build : reusing dist/homerun-*-${arch}`);
		return;
	}
	await exec(["bun", "run", "scripts/build-packages.ts", arch]);
}

async function provisionAgent(vm: Vm): Promise<{ token: string; url: string }> {
	log(
		`Launching ${vm.name} and installing the Homerun worker in agent mode (--mode=agent)`,
	);
	await vm.recreate(1, "2G", "10G");
	await vm.transfer(`dist/homerun-installer-${arch}`, "/tmp/homerun-installer");
	await vm.exec(["chmod", "+x", "/tmp/homerun-installer"]);
	await vm.exec(["sudo", "/tmp/homerun-installer", "--mode=agent", "--yes"]);

	const ip = await vm.ip();
	const token = (
		await vm.exec([
			"sudo",
			"cat",
			`/home/${ROOTLESS_USER}/.homerun-worker/token`,
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
	installerFlags.push(...(await loadLocalImage(vm)));
	return installFull(vm, installerFlags);
}

/** Runs this checkout's installer in `--mode=full` on an existing VM and waits for the dashboard on `port`. */
async function installFull(
	vm: Vm,
	installerFlags: string[],
	port = APP_PORT,
): Promise<AppClient> {
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
	const baseUrl = `http://${ip}:${port}`;

	await waitFor(`app healthy at ${baseUrl}`, async () => {
		const res = await fetch(baseUrl, { redirect: "manual" }).catch(() => null);
		return res !== null && res.status < 500;
	});

	console.log(`  Full stack reachable at ${baseUrl}`);
	return new AppClient(baseUrl);
}

async function bootstrapAdmin(client: AppClient): Promise<void> {
	log("Signing up the bootstrap admin and completing onboarding");
	await client.postJson("/api/v1/auth/sign-up/email", {
		email: ADMIN_EMAIL,
		name: "Multipass E2E",
		password: ADMIN_PASSWORD,
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
		"curl -fsSL https://raw.githubusercontent.com/orochibraru/homerun/main/cmd/cli/install.sh | bash",
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
		email: ADMIN_EMAIL,
		password: ADMIN_PASSWORD,
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
	await workerVm.transfer("cmd/installer/swarm-join.sh", "/tmp/swarm-join.sh");
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

/**
 * Scenario (a): a default `--mode=full` install lands in swarm mode on its
 * own, with no settings change, and Traefik routes a replicated service.
 *
 * @throws When the instance isn't in swarm mode or a check times out.
 */
async function testFreshSwarm(client: AppClient, vm: Vm): Promise<void> {
	log("Checking a default install starts in swarm mode");
	const mode = await sql(
		vm,
		"select orchestration_mode from instance_settings",
	);
	assert(
		mode === "swarm",
		`Expected swarm mode on a fresh install, got "${mode}"`,
	);
	const node = await vm.dockerRoot([
		"info",
		"--format",
		"{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}",
	]);
	assert(node.trim() === "active true", `Not a swarm manager: ${node}`);

	log("Deploying a 2-replica service without touching settings");
	const slug = "e2e-fresh-whoami";
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
		replicas: "2",
	});
	await client.postJson(`/api/v1/services/${service.id}/deploy`, {});
	const seen = new Set<string>();
	await waitFor(
		"Traefik answering from both replicas",
		async () => {
			const match = (
				await throughTraefik(vm, `${slug}.homerun-e2e.local`, "/")
			).match(/Hostname: (\S+)/);
			if (match?.[1]) {
				seen.add(match[1]);
			}
			return seen.size === 2;
		},
		{ intervalMs: 1000, timeoutMs: 180_000 },
	);
	console.log("  Both replicas answered through Traefik.");
}

/**
 * Scenario (b): installs the previous release's rootless default, deploys a
 * service with a named volume holding a marker file, runs
 * `--migrate-to-rootful` with this checkout's installer, then checks the
 * users and services survived, the service was redeployed as a swarm
 * service and still serves the marker through Traefik.
 *
 * @throws When any check fails or times out.
 */
async function testMigration(vm: Vm): Promise<void> {
	log(`Installing ${PREVIOUS_RELEASE}'s rootless default on ${vm.name}`);
	await vm.recreate(2, "4G", "20G");
	await vm.exec([
		"bash",
		"-c",
		`curl -fsSL https://github.com/orochibraru/homerun/releases/download/${PREVIOUS_RELEASE}/homerun-installer-${arch} -o /tmp/previous-installer && chmod +x /tmp/previous-installer && sudo /tmp/previous-installer --mode=full --version=${PREVIOUS_RELEASE} --yes`,
	]);
	const ip = await vm.ip();
	const client = new AppClient(`http://${ip}:${APP_PORT}`);
	await waitFor("rootless app answering", async () => {
		const res = await fetch(client.baseUrl, { redirect: "manual" }).catch(
			() => null,
		);
		return res !== null && res.status < 500;
	});
	await bootstrapAdmin(client);

	log("Deploying a service with a named volume and writing a marker");
	const slug = "e2e-migrate-nginx";
	const service = (await client.postJson("/api/v1/services", {
		containerPort: 80,
		image: "nginx",
		name: slug,
		slug,
		tag: "alpine",
	})) as { id: string };
	const created = (await client.postForm(
		`/services/${service.id}/volumes?/createVolume`,
		{ kind: "volume", name: "e2e-marker", source: "e2e-marker" },
	)) as { data: string };
	await client.postForm(`/services/${service.id}/volumes?/attachVolume`, {
		containerPath: "/usr/share/nginx/html",
		volumeId: parseActionData<string>(created.data, "volumeId"),
	});
	await client.postJson(`/api/v1/services/${service.id}/deploy`, {});
	const containerId = (
		await vm.docker(["ps", "-q", "--filter", "label=homerun.managed=true"])
	).trim();
	await vm.docker([
		"exec",
		containerId,
		"sh",
		"-c",
		`echo ${MARKER} > /usr/share/nginx/html/marker.txt && chown 101:101 /usr/share/nginx/html/marker.txt`,
	]);
	const host = `${slug}.homerun-e2e.local`;
	await waitFor("marker served on the rootless install", async () =>
		(await throughTraefik(vm, host, "/marker.txt")).includes(MARKER),
	);

	log("Running --migrate-to-rootful");
	const imageFlags = await loadLocalImage(vm);
	await vm.transfer(`dist/homerun-installer-${arch}`, "/tmp/homerun-installer");
	await vm.exec(["chmod", "+x", "/tmp/homerun-installer"]);
	await vm.exec([
		"sudo",
		"/tmp/homerun-installer",
		"--migrate-to-rootful",
		...imageFlags,
		"--yes",
	]);

	log("Checking data, the redeploy and routing after the migration");
	assert(
		(await sql(vm, 'select email from "user"')).includes(ADMIN_EMAIL),
		"The admin user didn't survive the migration.",
	);
	assert(
		(await sql(vm, "select orchestration_mode from instance_settings")) ===
			"swarm",
		"The instance isn't in swarm mode after the migration.",
	);
	await waitFor(
		"service redeployed as a swarm service",
		async () =>
			(await sql(
				vm,
				`select current_status from service where id = '${service.id}' and swarm_service_id is not null`,
			)) === "running",
		{ intervalMs: 5000, timeoutMs: 600_000 },
	);
	const owner = await vm.dockerRoot([
		"run",
		"--rm",
		"-v",
		"e2e-marker:/volume",
		"alpine:3",
		"stat",
		"-c",
		"%u:%g",
		"/volume/marker.txt",
	]);
	assert(owner.trim() === "101:101", `Marker ownership changed: ${owner}`);
	await waitFor(
		"marker served through Traefik in swarm mode",
		async () =>
			(await throughTraefik(vm, host, "/marker.txt")).includes(MARKER),
		{ intervalMs: 2000, timeoutMs: 120_000 },
	);
	const rootless = await vm.docker(["info"], { allowFailure: true });
	assert(
		!rootless.includes("Server Version"),
		"The rootless daemon is still running after the migration.",
	);
	console.log("  Users, services, the marker and routing all survived.");
}

/** A Dokploy instance's REST API, signed in by session cookie until an API key replaces it. */
class DokployClient {
	#headers: Record<string, string> = {};

	constructor(readonly baseUrl: string) {}

	/**
	 * Calls `/api/<path>`: a GET without a body, a JSON POST with one. Keeps the
	 * session cookie a sign-in sets.
	 *
	 * @throws When Dokploy answers non-2xx.
	 */
	async call<T>(path: string, body?: unknown): Promise<T> {
		const res = await fetch(`${this.baseUrl}/api/${path}`, {
			body: body === undefined ? undefined : JSON.stringify(body),
			headers: { ...this.#headers, "content-type": "application/json" },
			method: body === undefined ? "GET" : "POST",
		});
		const text = await res.text();
		if (!res.ok) {
			throw new Error(`Dokploy ${path} -> ${res.status}: ${text}`);
		}
		const cookies = res.headers
			.getSetCookie()
			.map((raw) => raw.split(";", 1)[0])
			.join("; ");
		if (cookies && !this.#headers["x-api-key"]) {
			this.#headers.cookie = cookies;
		}
		return (text ? JSON.parse(text) : null) as T;
	}

	/** Swaps the session cookie for an API key on every later call. */
	useApiKey(key: string): void {
		this.#headers = { "x-api-key": key };
	}
}

/** Waits until the Dokploy swarm service `appName` runs its one replica. */
async function dokployRunning(vm: Vm, appName: string): Promise<void> {
	await waitFor(
		`Dokploy's ${appName} running`,
		async () =>
			(
				await vm.dockerRoot([
					"service",
					"ls",
					"--filter",
					`name=${appName}`,
					"--format",
					"{{.Replicas}}",
				])
			).trim() === "1/1",
		{ intervalMs: 3000, timeoutMs: 300_000 },
	);
}

/** Runs `psql` inside the first running task of a swarm service and returns its unaligned rows. */
async function psqlInService(
	vm: Vm,
	serviceFilter: string,
	query: string,
): Promise<string> {
	const container = (
		await vm.dockerRoot(["ps", "-q", "--filter", serviceFilter])
	)
		.trim()
		.split("\n")[0];
	assert(container, `No running container for ${serviceFilter}`);
	return (
		await vm.dockerRoot([
			"exec",
			container,
			"psql",
			"-U",
			"e2e",
			"-d",
			"e2e",
			"-tAc",
			query,
		])
	).trim();
}

/**
 * Scenario (c), the same-host move off Dokploy: installs Dokploy, gives it an
 * nginx app on a named volume with a domain and a Postgres database, both
 * holding a marker. Installs Homerun next to it with the side-by-side ports,
 * checks Dokploy still owns 80, imports both through Settings, Migrate, stops
 * each on Dokploy and deploys its Homerun copy, checks both markers came across
 * with their volumes, then takes over 80/443 by stopping dokploy-traefik and
 * re-running the installer.
 *
 * @throws When any check fails or times out.
 */
async function testDokployMigration(vm: Vm): Promise<void> {
	log(`Launching ${vm.name} and installing Dokploy`);
	await vm.recreate(2, "6G", "30G");
	await vm.exec([
		"bash",
		"-c",
		"curl -sSL https://dokploy.com/install.sh | sudo sh",
	]);
	const ip = await vm.ip();
	const dokployUrl = `http://${ip}:${DOKPLOY_PORT}`;
	await waitFor(
		"Dokploy answering",
		async () => (await fetch(`${dokployUrl}/api/health`).catch(() => null))?.ok,
		{ intervalMs: 3000, timeoutMs: 300_000 },
	);

	log("Creating Dokploy's admin and an API key");
	const dokployApi = new DokployClient(dokployUrl);
	const credentials = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
	await new DokployClient(dokployUrl).call("auth/sign-up/email", {
		...credentials,
		lastName: "E2E",
		name: "Multipass",
	});
	await dokployApi.call("auth/sign-in/email", credentials);
	const session = await dokployApi.call<{
		session: { activeOrganizationId: string };
	}>("auth/get-session");
	const { key } = await dokployApi.call<{ key: string }>("user.createApiKey", {
		metadata: { organizationId: session.session.activeOrganizationId },
		name: "homerun-e2e",
		rateLimitEnabled: false,
	});
	dokployApi.useApiKey(key);

	log("Deploying an nginx app on a named volume and a Postgres on Dokploy");
	const { environment } = await dokployApi.call<{
		environment: { environmentId: string };
	}>("project.create", { name: "e2e" });
	const app = await dokployApi.call<{ applicationId: string; appName: string }>(
		"application.create",
		{
			appName: "e2e-nginx",
			environmentId: environment.environmentId,
			name: "e2e-nginx",
		},
	);
	await dokployApi.call("application.saveDockerProvider", {
		applicationId: app.applicationId,
		dockerImage: "nginx:alpine",
		password: null,
		registryUrl: null,
		username: null,
	});
	await dokployApi.call("mounts.create", {
		mountPath: "/usr/share/nginx/html",
		serviceId: app.applicationId,
		serviceType: "application",
		type: "volume",
		volumeName: "e2e-dokploy-html",
	});
	const dokployHost = "e2e-nginx.dokploy-e2e.local";
	await dokployApi.call("domain.create", {
		applicationId: app.applicationId,
		certificateType: "none",
		domainType: "application",
		host: dokployHost,
		https: false,
		path: "/",
		port: 80,
	});
	await dokployApi.call("application.deploy", {
		applicationId: app.applicationId,
	});
	const db = await dokployApi.call<{ appName: string; postgresId: string }>(
		"postgres.create",
		{
			appName: "e2e-db",
			databaseName: "e2e",
			databasePassword: "e2e-password",
			databaseUser: "e2e",
			dockerImage: "postgres:16",
			environmentId: environment.environmentId,
			name: "e2e-db",
		},
	);
	await dokployApi.call("postgres.deploy", { postgresId: db.postgresId });
	await dokployRunning(vm, app.appName);
	await dokployRunning(vm, db.appName);

	await vm.dockerRoot([
		"run",
		"--rm",
		"-v",
		"e2e-dokploy-html:/html",
		"alpine:3",
		"sh",
		"-c",
		`echo ${MARKER} > /html/marker.txt`,
	]);
	const dokployDb = `label=com.docker.swarm.service.name=${db.appName}`;
	await waitFor("Dokploy's Postgres accepting queries", () =>
		psqlInService(
			vm,
			dokployDb,
			`create table if not exists marker(value text primary key); insert into marker values ('${MARKER}') on conflict do nothing`,
		).then(() => true),
	);
	const viaDokploy = async () =>
		(
			await exec(
				[
					"curl",
					"-s",
					"-m",
					"5",
					"--resolve",
					`${dokployHost}:80:${ip}`,
					`http://${dokployHost}/marker.txt`,
				],
				{ allowFailure: true },
			)
		).stdout.includes(MARKER);
	await waitFor("marker served by Dokploy's Traefik", viaDokploy);

	log(`Installing Homerun next to Dokploy (${SIDE_BY_SIDE_FLAGS.join(" ")})`);
	const installerFlags = [...SIDE_BY_SIDE_FLAGS, ...(await loadLocalImage(vm))];
	const client = await installFull(vm, installerFlags, 4500);
	await bootstrapAdmin(client);
	assert(
		await viaDokploy(),
		"Dokploy stopped serving after Homerun's install.",
	);
	assert(
		(await fetch(`${dokployUrl}/api/health`).catch(() => null))?.ok,
		"Dokploy's dashboard stopped answering after Homerun's install.",
	);

	log("Importing both from Dokploy through Settings, Migrate");
	const form = new FormData();
	form.append("baseUrl", dokployUrl);
	form.append("token", key);
	form.append("ids", app.applicationId);
	form.append("ids", db.postgresId);
	const imported = await client.request("/settings/migrate/dokploy?/import", {
		body: form,
		method: "POST",
	});
	const importBody = await imported.text();
	assert(
		imported.ok && !importBody.includes('"type":"failure"'),
		`Import failed: ${importBody}`,
	);
	const services = (
		await sql(vm, "select id, image from service order by image")
	)
		.split("\n")
		.map((line) => line.split("|"));
	const nginx = services.find(([, image]) => image?.includes("nginx"))?.[0];
	const postgres = services.find(([, image]) =>
		image?.includes("postgres"),
	)?.[0];
	assert(
		nginx && postgres,
		`Expected an nginx and a postgres service, got ${JSON.stringify(services)}`,
	);

	log("Stopping each on Dokploy and deploying its Homerun copy");
	await dokployApi.call("application.stop", {
		applicationId: app.applicationId,
	});
	await dokployApi.call("postgres.stop", { postgresId: db.postgresId });
	for (const id of [nginx, postgres]) {
		await client.postJson(`/api/v1/services/${id}/deploy`, {});
		await waitFor(
			`service ${id} running on Homerun`,
			async () =>
				(await sql(
					vm,
					`select current_status from service where id = '${id}'`,
				)) === "running",
			{ intervalMs: 5000, timeoutMs: 300_000 },
		);
	}
	const rule = await vm.dockerRoot([
		"service",
		"inspect",
		await sql(vm, `select swarm_service_id from service where id = '${nginx}'`),
		"--format",
		"{{json .Spec.Labels}}",
	]);
	const homerunHost = /Host\(`([^`]+)`\)/.exec(rule)?.[1];
	assert(homerunHost, `No Traefik host rule on the nginx service: ${rule}`);
	await waitFor(
		"nginx volume's marker served through Homerun's Traefik on :8080",
		async () =>
			(await throughTraefik(vm, homerunHost, "/marker.txt", 8080)).includes(
				MARKER,
			),
		{ intervalMs: 2000, timeoutMs: 120_000 },
	);
	const swarmServiceId = await sql(
		vm,
		`select swarm_service_id from service where id = '${postgres}'`,
	);
	const rows = await waitFor("Postgres marker row on Homerun", () =>
		psqlInService(
			vm,
			`label=com.docker.swarm.service.id=${swarmServiceId}`,
			"select value from marker",
		),
	);
	assert(rows === MARKER, `Postgres data didn't come across: "${rows}"`);

	log("Taking over 80/443 from Dokploy");
	await vm.dockerRoot(["stop", "dokploy-traefik"]);
	await installFull(
		vm,
		[...installerFlags, "--http-port=80", "--https-port=443"],
		4500,
	);
	await waitFor(
		"marker served through Homerun's Traefik on :80",
		async () =>
			(await throughTraefik(vm, homerunHost, "/marker.txt")).includes(MARKER),
		{ intervalMs: 2000, timeoutMs: 120_000 },
	);
	console.log(
		"  Both services, their volumes and routing moved off Dokploy on the same host.",
	);
}

async function cleanup(): Promise<void> {
	if (keep) {
		console.log(
			"\n--keep set : leaving the VMs and CLI container running for inspection.",
		);
		console.log(`  multipass shell ${FULL_VM}`);
		console.log(`  multipass shell ${AGENT_VM}`);
		console.log(`  multipass shell ${DOKPLOY_VM}`);
		console.log(`  docker exec -it ${CLI_CONTAINER} bash`);
		console.log(
			`\nClean up later with: multipass delete ${FULL_VM} ${AGENT_VM} ${DOKPLOY_VM} --purge && docker rm -f ${CLI_CONTAINER}`,
		);
		return;
	}
	log("Cleaning up (VMs, CLI container)");
	await new Vm(FULL_VM).delete();
	await new Vm(AGENT_VM).delete();
	await new Vm(SWARM_MANAGER_VM).delete();
	await new Vm(SWARM_WORKER_VM).delete();
	await new Vm(FRESH_SWARM_VM).delete();
	await new Vm(MIGRATE_VM).delete();
	await rm(localImageArchive, { force: true });
	await exec(["docker", "rm", "-f", CLI_CONTAINER], { allowFailure: true });
}

async function main(): Promise<void> {
	const startedAt = Date.now();

	try {
		await preflight(["multipass", "docker"]);
		await buildBinaries();
		await buildLocalImage();

		if (dokploy) {
			await testDokployMigration(new Vm(DOKPLOY_VM));
			console.log(
				`\n✔ Dokploy migration checks passed (${Math.round((Date.now() - startedAt) / 1000)}s).`,
			);
			await cleanup();
			return;
		}

		if (freshSwarm || migrate) {
			if (freshSwarm) {
				const vm = new Vm(FRESH_SWARM_VM);
				const client = await provisionFull(vm);
				await bootstrapAdmin(client);
				await testFreshSwarm(client, vm);
			}
			if (migrate) {
				await testMigration(new Vm(MIGRATE_VM));
			}
			console.log(
				`\n✔ Rootful swarm checks passed (${Math.round((Date.now() - startedAt) / 1000)}s).`,
			);
			await cleanup();
			return;
		}

		if (swarm) {
			const managerVm = new Vm(SWARM_MANAGER_VM);
			const client = await provisionFull(managerVm);
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
			provisionFull(fullVm, ["--docker=rootless"]),
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
