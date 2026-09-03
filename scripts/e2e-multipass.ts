import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * Local-only, real-infrastructure end-to-end test for the installer, agent,
 * and CLI: everything `packages/installer/README.md` and
 * `packages/cli/README.md` used to flag as "not verified... needs a
 * disposable VM/CI runner this environment doesn't have". Requires
 * Multipass (real Ubuntu VMs) and Docker on the machine running it.
 *
 * **Deliberately not wired into any GitHub Actions workflow**: this repo's
 * CI runners have no nested-virtualization access, so Multipass can't run
 * there at all — this is a local developer tool, run by hand before cutting
 * a release or after touching installer/agent/cli code, not part of
 * `bun run test`/`bun run check`.
 *
 * What it does, against real infrastructure, no mocks:
 *   1. Builds the installer/agent/cli binaries from local source (not a
 *      published release: this is what lets it catch a regression before
 *      it ships, which downloading bootstrap.sh's own released binary
 *      wouldn't).
 *   2. Launches two disposable Multipass Ubuntu VMs.
 *   3. Runs the real installer binary directly (skipping bootstrap.sh's own
 *      GitHub-release download, for the same "test local source" reason
 *      above) with `--mode=agent` on one VM, `--mode=full` on the other —
 *      the full-stack one pulls the real published `docker.io/orochibraru/
 *      homerun` app image, this suite doesn't rebuild the app itself.
 *   4. Signs up the bootstrap admin and completes onboarding on the full
 *      instance over its real HTTP API (a hand-rolled cookie-jar client
 *      below, no browser).
 *   5. Registers the agent VM as a real agent-kind Remote Host, deploys a
 *      real service to it, and confirms (via `docker ps` on the agent VM
 *      itself) that the container actually landed there, then round-trips
 *      stop/start through the agent too.
 *   6. Installs the real CLI (via its own install.sh) in a throwaway Linux
 *      Docker container, drives a real `homerun login` device-code round
 *      trip against the full-stack VM, then runs every documented CLI
 *      command against it.
 *   7. Tears everything down (unless `--keep`).
 *
 * **Scope note**: step 3's `--mode=full` always pulls the real *published*
 * `docker.io/orochibraru/homerun` app image, the same one a real user's
 * install gets — this suite deliberately doesn't rebuild/inject the app
 * itself (that's a separate release artifact, see root CLAUDE.md's Release
 * automation section). That means an app-level fix that's landed in git but
 * not shipped in a release yet won't be reflected here : this run genuinely
 * failed once, correctly, at the `homerun login` step for exactly that
 * reason (a real bug fixed in `src/hooks.server.ts` this same session,
 * un-released at the time). That's this suite doing its job, not a false
 * negative — installer/agent/cli fixes are always tested from local source
 * (step 1), only the app image itself lags until the next release.
 *
 * Usage:
 *   bun run e2e:multipass              # full run, builds binaries, cleans up after
 *   bun run e2e:multipass --skip-build # reuse dist/homerun-*-<arch> from a previous build
 *   bun run e2e:multipass --keep       # leave the VMs/container running for debugging
 */

const FULL_VM = "homerun-e2e-full";
const AGENT_VM = "homerun-e2e-agent";
const CLI_CONTAINER = "homerun-e2e-cli";
const ROOTLESS_USER = "homerun";
const APP_PORT = 3000;
const AGENT_PORT = 7420;

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const keep = args.has("--keep");

const arch = process.arch === "arm64" ? "arm64" : "amd64";

let step = 0;
/** One numbered, timestamped line per phase, same spirit as StepRunner's own `[run]` logging, so a long run's output stays skimmable. */
function log(message: string): void {
	step += 1;
	console.log(`\n[${step}] ${message}`);
}

function run(cmd: string): void {
	console.log(`  $ ${cmd}`);
}

/** Runs a command, capturing output (printed below once it exits, so a slow step like a VM boot or an image pull doesn't leave interleaved-and-confusing output), throwing on a non-zero exit unless `allowFailure`. */
async function exec(
	cmd: string[],
	opts?: { allowFailure?: boolean },
): Promise<{ code: number; stdout: string; stderr: string }> {
	run(cmd.join(" "));
	const proc = Bun.spawn(cmd, {
		stderr: "pipe",
		stdin: "ignore",
		stdout: "pipe",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	if (stdout.trim()) {
		process.stdout.write(stdout);
	}
	if (stderr.trim()) {
		process.stderr.write(stderr);
	}
	const code = await proc.exited;
	if (code !== 0 && !opts?.allowFailure) {
		throw new Error(`command failed (${code}): ${cmd.join(" ")}`);
	}
	return { code, stderr, stdout };
}

/** A disposable Multipass VM this suite owns : launch/exec/transfer/delete, plus the "run docker as the rootless user" incantation every installer step needs (mirrors packages/installer/steps/rootless-docker.ts's own env threading). */
class Vm {
	#uid: string | null = null;

	constructor(readonly name: string) {}

	async recreate(cpus: number, memory: string, disk: string): Promise<void> {
		await exec(["multipass", "delete", this.name, "--purge"], {
			allowFailure: true,
		});
		await exec([
			"multipass",
			"launch",
			"24.04",
			"--name",
			this.name,
			"--cpus",
			String(cpus),
			"--memory",
			memory,
			"--disk",
			disk,
		]);
	}

	async ip(): Promise<string> {
		const { stdout } = await exec([
			"multipass",
			"info",
			this.name,
			"--format",
			"json",
		]);
		const info = JSON.parse(stdout) as {
			info: Record<string, { ipv4: string[] }>;
		};
		const [address] = info.info[this.name]?.ipv4 ?? [];
		if (!address) {
			throw new Error(`Couldn't determine ${this.name}'s IP address.`);
		}
		return address;
	}

	async exec(
		cmd: string[],
		opts?: { allowFailure?: boolean },
	): Promise<string> {
		const { stdout } = await exec(
			["multipass", "exec", this.name, "--", ...cmd],
			opts,
		);
		return stdout;
	}

	async transfer(localPath: string, remotePath: string): Promise<void> {
		await exec([
			"multipass",
			"transfer",
			localPath,
			`${this.name}:${remotePath}`,
		]);
	}

	async delete(): Promise<void> {
		await exec(["multipass", "delete", this.name, "--purge"], {
			allowFailure: true,
		});
	}

	/** The rootless user's uid, looked up once and cached (same as installRootlessDocker's own #uidOf). */
	async uid(): Promise<string> {
		if (!this.#uid) {
			this.#uid = (await this.exec(["sudo", "id", "-u", ROOTLESS_USER])).trim();
		}
		return this.#uid;
	}

	/** Runs a docker CLI command as the rootless user against its rootless daemon : the "sudo -u homerun env DOCKER_HOST=... docker ..." incantation every step needs. */
	async docker(
		args: string[],
		opts?: { allowFailure?: boolean },
	): Promise<string> {
		const uid = await this.uid();
		return this.exec(
			[
				"sudo",
				"-u",
				ROOTLESS_USER,
				"env",
				`DOCKER_HOST=unix:///run/user/${uid}/docker.sock`,
				`HOME=/home/${ROOTLESS_USER}`,
				"docker",
				...args,
			],
			opts,
		);
	}
}

/**
 * A minimal hand-rolled HTTP client with a cookie jar : Bun's `fetch` doesn't
 * persist cookies across calls the way a browser (or curl -b/-c) does, and
 * this suite needs a real cookie session (sign-up -> onboarding -> remote
 * host -> deploy, all as the same signed-in admin). `baseUrl` must equal
 * whatever the target instance's own ORIGIN resolves to (see
 * provisionFull() below, which sets ORIGIN=http://<vm-ip>:3000 for exactly
 * this reason) : SvelteKit's CSRF protection 403s any form POST whose
 * Origin header doesn't match the server's own computed origin, and a
 * mismatched Host would fail for the same reason curl's own cookie-jar
 * matching did during this suite's manual dry run (cookies are keyed by the
 * exact host string a request used).
 */
class AppClient {
	readonly #cookies = new Map<string, string>();

	constructor(private readonly baseUrl: string) {}

	#applyCookies(headers: Headers): void {
		for (const raw of headers.getSetCookie()) {
			const pair = raw.split(";", 1)[0] ?? "";
			const eq = pair.indexOf("=");
			if (eq === -1) {
				continue;
			}
			this.#cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
		}
	}

	#cookieHeader(): string | null {
		if (this.#cookies.size === 0) {
			return null;
		}
		return [...this.#cookies].map(([k, v]) => `${k}=${v}`).join("; ");
	}

	async request(path: string, init: RequestInit = {}): Promise<Response> {
		const headers = new Headers(init.headers);
		const cookie = this.#cookieHeader();
		if (cookie) {
			headers.set("cookie", cookie);
		}
		if (!headers.has("origin")) {
			headers.set("origin", this.baseUrl);
		}
		const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
		this.#applyCookies(res.headers);
		return res;
	}

	async postForm(
		path: string,
		fields: Record<string, string>,
	): Promise<unknown> {
		const body = new FormData();
		for (const [key, value] of Object.entries(fields)) {
			body.append(key, value);
		}
		const res = await this.request(path, { body, method: "POST" });
		const json = await res.json();
		if (!res.ok) {
			throw new Error(`POST ${path} -> ${res.status}: ${JSON.stringify(json)}`);
		}
		if (
			typeof json === "object" &&
			json !== null &&
			(json as { type?: string }).type === "failure"
		) {
			throw new Error(`POST ${path} failed: ${JSON.stringify(json)}`);
		}
		return json;
	}

	async postJson(path: string, body: unknown): Promise<unknown> {
		const res = await this.request(path, {
			body: JSON.stringify(body),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		const json = await res.json();
		if (!res.ok) {
			throw new Error(`POST ${path} -> ${res.status}: ${JSON.stringify(json)}`);
		}
		return json;
	}
}

/**
 * A SvelteKit form action's `data` field is devalue-serialized as
 * `[{fieldName: index, ...}, ...values]` (the first element maps each
 * returned field name to its index in the rest of the array) rather than a
 * plain object. Looks up one field by name from that shape instead of
 * hardcoding an index, which would silently break if a route ever reorders
 * its return object.
 */
function parseActionData<T = unknown>(dataStr: string, key: string): T {
	const arr = JSON.parse(dataStr) as unknown[];
	const shape = arr[0] as Record<string, number> | undefined;
	const index = shape?.[key];
	if (index === undefined) {
		throw new Error(`Field "${key}" not found in action response: ${dataStr}`);
	}
	return arr[index] as T;
}

/** Polls `check` every `intervalMs` until it returns truthy, or throws after `timeoutMs`. */
async function waitFor<T>(
	label: string,
	check: () => Promise<T | null | undefined | false>,
	{ intervalMs = 2000, timeoutMs = 120_000 } = {},
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const result = await check().catch(() => null);
		if (result) {
			return result;
		}
		await sleep(intervalMs);
	}
	throw new Error(`Timed out waiting for: ${label}`);
}

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

	// The installer's own generated compose.yaml defaults ORIGIN to
	// http://localhost:3000 (see steps/full-stack.ts's own docstring on why
	// : a real deployment sets this to its real domain once it has one).
	// This suite's "real domain" is the VM's own IP, so it's set here and
	// the app recreated to pick it up, which is also what makes every
	// AppClient request below able to just use plain http://<ip>:3000
	// consistently (URL, Origin header, and the server's own computed
	// origin all agree) rather than needing curl --resolve-style tricks.
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

	// Real, tested-live finding : plain ubuntu:24.04 doesn't ship curl, so
	// this used to fail with "curl: command not found" — silently, since
	// that error came from the *first* stage of a `curl ... | bash` pipe,
	// whose reported exit status is its *last* stage's (an empty-stdin
	// `bash` that "succeeds" doing nothing), not curl's own failure. Install
	// curl first, and verify the CLI actually landed right after (bash -c's
	// own pipe-failure-masking bug this replaced would otherwise resurface
	// identically for install.sh's own internal curl calls).
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
	// Re-authenticate as the admin created in bootstrapAdmin() : this
	// function's own client instance is separate from that one.
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

async function preflight(): Promise<void> {
	for (const cmd of ["multipass", "docker"]) {
		const found = await exec(["which", cmd], { allowFailure: true });
		if (found.code !== 0) {
			console.error(
				`error: "${cmd}" isn't on PATH — this suite needs Multipass and Docker installed locally.`,
			);
			process.exit(1);
		}
	}
}

async function main(): Promise<void> {
	const startedAt = Date.now();

	try {
		await preflight();
		await buildBinaries();

		const fullVm = new Vm(FULL_VM);
		const agentVm = new Vm(AGENT_VM);

		// Both VMs provision independently : running them concurrently nearly
		// halves this suite's wall-clock time versus doing one after the other.
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
