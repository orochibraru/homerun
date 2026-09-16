import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

export const ROOTLESS_USER = "homerun";
export const APP_PORT = 3000;
export const AGENT_PORT = 7420;

export const arch = process.arch === "arm64" ? "arm64" : "amd64";

let step = 0;

/** Prints a numbered step heading, bumping the module-wide step counter. */
export function log(message: string): void {
	step += 1;
	console.log(`\n[${step}] ${message}`);
}

/** Echoes a command as `$ <cmd>` without running it; `exec` calls it before spawning. */
export function run(cmd: string): void {
	console.log(`  $ ${cmd}`);
}

/**
 * Runs a local command with stdin closed, echoing it and streaming its
 * captured stdout/stderr back to this process once it exits.
 *
 * @param opts.allowFailure Return a non-zero exit instead of throwing.
 * @throws When the command exits non-zero and `allowFailure` isn't set.
 */
export async function exec(
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

let launchQueue: Promise<unknown> = Promise.resolve();

function serializeLaunch<T>(task: () => Promise<T>): Promise<T> {
	const result = launchQueue.then(task, task);
	launchQueue = result.catch(() => undefined);
	return result;
}

export class Vm {
	#uid: string | null = null;

	constructor(readonly name: string) {}

	/**
	 * Deletes and purges any existing VM of this name, then launches a fresh
	 * Ubuntu 24.04 one. Launches are queued so only one runs at a time across
	 * every VM.
	 *
	 * @param memory Multipass size string, e.g. `4G`.
	 * @param disk Multipass size string, e.g. `20G`.
	 */
	async recreate(cpus: number, memory: string, disk: string): Promise<void> {
		await serializeLaunch(async () => {
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
		});
	}

	/**
	 * The VM's first IPv4 address, from `multipass info`.
	 *
	 * @throws When multipass reports no address for it.
	 */
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

	/** Runs a command inside the VM via `multipass exec` and returns its stdout. Throws on a non-zero exit unless `allowFailure` is set. */
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

	/** Copies a local file to a path inside the VM with `multipass transfer`. */
	async transfer(localPath: string, remotePath: string): Promise<void> {
		await exec([
			"multipass",
			"transfer",
			localPath,
			`${this.name}:${remotePath}`,
		]);
	}

	/** Writes content to a path inside the VM by staging it in a local temp file, transferring it and deleting the temp file. */
	async writeFile(remotePath: string, content: string): Promise<void> {
		const local = `${tmpdir()}/homerun-e2e-${randomUUID()}`;
		await Bun.write(local, content);
		try {
			await this.transfer(local, remotePath);
		} finally {
			await rm(local, { force: true });
		}
	}

	/**
	 * Uploads a bash script to a temp path in the VM and runs it under
	 * `set -euo pipefail`.
	 *
	 * @param opts.cwd Directory created and entered before the script body runs.
	 * @param opts.env Variables passed through `env`, so they survive `sudo`.
	 * @param opts.sudo Run the script as root.
	 * @returns The script's stdout.
	 */
	async runScript(
		script: string,
		opts?: {
			allowFailure?: boolean;
			cwd?: string;
			env?: Record<string, string>;
			sudo?: boolean;
		},
	): Promise<string> {
		const remote = `/tmp/homerun-e2e-${randomUUID()}.sh`;
		const cwd = opts?.cwd ? `mkdir -p ${opts.cwd}\ncd ${opts.cwd}\n` : "";
		await this.writeFile(remote, `set -euo pipefail\n${cwd}${script}\n`);
		const env = Object.entries(opts?.env ?? {}).map(
			([key, value]) => `${key}=${value}`,
		);
		return this.exec(
			[
				...(opts?.sudo ? ["sudo"] : []),
				...(env.length > 0 ? ["env", ...env] : []),
				"bash",
				remote,
			],
			{ allowFailure: opts?.allowFailure },
		);
	}

	/** Deletes and purges the VM, ignoring failure when it doesn't exist. */
	async delete(): Promise<void> {
		await exec(["multipass", "delete", this.name, "--purge"], {
			allowFailure: true,
		});
	}

	/** The rootless Docker user's uid inside the VM, looked up once and cached on the instance. */
	async uid(): Promise<string> {
		if (!this.#uid) {
			this.#uid = (await this.exec(["sudo", "id", "-u", ROOTLESS_USER])).trim();
		}
		return this.#uid;
	}

	/** Runs a `docker` command as the rootless user against its own daemon socket and returns stdout. */
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

	/** Runs a `docker` command with sudo against the VM's rootful daemon and returns stdout. */
	async dockerRoot(
		args: string[],
		opts?: { allowFailure?: boolean },
	): Promise<string> {
		return this.exec(["sudo", "docker", ...args], opts);
	}
}

export class AppClient {
	readonly #cookies = new Map<string, string>();

	constructor(readonly baseUrl: string) {}

	/** Stores the name/value of every `Set-Cookie` header in the jar, ignoring attributes, expiry and deletion. */
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

	/** The jar serialised as a `Cookie` header value, or null when it's empty. */
	#cookieHeader(): string | null {
		if (this.#cookies.size === 0) {
			return null;
		}
		return [...this.#cookies].map(([k, v]) => `${k}=${v}`).join("; ");
	}

	/** Fetches a path on the app with the jar's cookies and an `Origin` of the base URL (unless one is given), then records any cookies it sets. */
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

	/**
	 * Posts fields as multipart form data, the way a SvelteKit form action
	 * expects them, and returns the parsed JSON response.
	 *
	 * @throws When the response isn't 2xx or the action returned `type: "failure"`.
	 */
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

	/**
	 * Posts a JSON body and returns the parsed JSON response.
	 *
	 * @throws When the response isn't 2xx.
	 */
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
 * Reads one top-level field out of a form action's devalue-serialised `data`
 * string, where the first array entry maps field names to value indices. Only
 * primitive fields come back intact; a nested value would be a raw index.
 *
 * @throws When the field isn't present.
 */
export function parseActionData<T = unknown>(dataStr: string, key: string): T {
	const arr = JSON.parse(dataStr) as unknown[];
	const shape = arr[0] as Record<string, number> | undefined;
	const index = shape?.[key];
	if (index === undefined) {
		throw new Error(`Field "${key}" not found in action response: ${dataStr}`);
	}
	return arr[index] as T;
}

/**
 * Polls `check` until it returns a truthy value, treating a thrown error as
 * not ready yet.
 *
 * @param label What's being waited for, used in the timeout error.
 * @returns The first truthy result.
 * @throws When `timeoutMs` passes first.
 */
export async function waitFor<T>(
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

/** Throws `message` when `condition` is falsy, narrowing it for the caller. */
export function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

/** Exits the process with an error when any of the given commands isn't on the local PATH. */
export async function preflight(commands: string[]): Promise<void> {
	for (const cmd of commands) {
		const found = await exec(["which", cmd], { allowFailure: true });
		if (found.code !== 0) {
			console.error(
				`error: "${cmd}" isn't on PATH — this suite needs ${commands.join(" and ")} installed locally.`,
			);
			process.exit(1);
		}
	}
}
