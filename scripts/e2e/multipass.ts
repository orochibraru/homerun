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

export function log(message: string): void {
	step += 1;
	console.log(`\n[${step}] ${message}`);
}

export function run(cmd: string): void {
	console.log(`  $ ${cmd}`);
}

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

	async writeFile(remotePath: string, content: string): Promise<void> {
		const local = `${tmpdir()}/homerun-e2e-${randomUUID()}`;
		await Bun.write(local, content);
		try {
			await this.transfer(local, remotePath);
		} finally {
			await rm(local, { force: true });
		}
	}

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

	async delete(): Promise<void> {
		await exec(["multipass", "delete", this.name, "--purge"], {
			allowFailure: true,
		});
	}

	async uid(): Promise<string> {
		if (!this.#uid) {
			this.#uid = (await this.exec(["sudo", "id", "-u", ROOTLESS_USER])).trim();
		}
		return this.#uid;
	}

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

export function parseActionData<T = unknown>(dataStr: string, key: string): T {
	const arr = JSON.parse(dataStr) as unknown[];
	const shape = arr[0] as Record<string, number> | undefined;
	const index = shape?.[key];
	if (index === undefined) {
		throw new Error(`Field "${key}" not found in action response: ${dataStr}`);
	}
	return arr[index] as T;
}

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

export function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

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
