import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { ciTimeout } from "./ci";

/** Captures a spawned process's stdout+stderr into one buffer as it runs, so a readiness failure can show *why* (same pattern server.ts's spawnApp already uses for the app itself). */
function captureOutput(proc: ReturnType<typeof Bun.spawn>): {
	lines: () => string;
} {
	const chunks: string[] = [];
	const pump = async (stream: ReadableStream<Uint8Array> | null) => {
		if (!stream) {
			return;
		}
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			chunks.push(decoder.decode(value));
		}
	};
	void pump(proc.stdout as ReadableStream<Uint8Array> | null);
	void pump(proc.stderr as ReadableStream<Uint8Array> | null);
	return { lines: () => chunks.join("") };
}

async function waitForPort(
	port: number,
	deadlineMs: number,
	label: string,
	captured?: { lines: () => string },
): Promise<void> {
	const deadline = Date.now() + deadlineMs;
	while (Date.now() < deadline) {
		try {
			const sock = await Bun.connect({
				hostname: "127.0.0.1",
				port,
				socket: { data() {}, error() {}, open(_s) {} },
			});
			sock.end();
			return;
		} catch {
			await new Promise((r) => setTimeout(r, 200));
		}
	}
	const output = captured?.lines();
	throw new Error(
		`${label} : nothing listening on 127.0.0.1:${port} after ${deadlineMs}ms` +
			(output ? `\n--- captured output ---\n${output}` : ""),
	);
}

/**
 * Builds the real Go worker (`cmd/worker`) and spawns it in agent mode, pointed
 * at whatever Docker socket this machine's own `docker context` resolves (the
 * worker's own auto-detection) : a real remote build host, not a stub, so the
 * build-server scenarios exercise the actual HTTP surface. `DATABASE_URL` is
 * stripped from the inherited environment, since its presence is what would
 * turn this into a full worker leasing jobs from the test database. `port` is
 * picked fresh per run (port.ts) so two runs of this suite never collide on a
 * fixed agent port.
 */
export function spawnAgent(port: number, token: string) {
	const binary = join(tmpdir(), `homerun-worker-agent-it-${process.pid}`);
	const build = Bun.spawnSync(["go", "build", "-o", binary, "./cmd/worker"], {
		cwd: process.cwd(),
		stderr: "pipe",
	});
	if (build.exitCode !== 0) {
		throw new Error(`go build ./cmd/worker failed: ${build.stderr.toString()}`);
	}
	const env: Record<string, string | undefined> = {
		...process.env,
		WORKER_PORT: String(port),
		WORKER_TOKEN: token,
	};
	delete env.DATABASE_URL;
	const proc = Bun.spawn([binary], {
		cwd: process.cwd(),
		env,
		stderr: "pipe",
		stdout: "pipe",
	});
	const captured = captureOutput(proc);
	return {
		proc,
		ready: () =>
			waitForPort(port, ciTimeout(15_000, 30_000), "agent", captured),
		stop: async () => {
			proc.kill("SIGTERM");
			await proc.exited;
		},
	};
}

// Matches both the current "[info] [worker] ready:" and the older
// "[homerun-worker] ready:" a previously published image would print, so the
// harness works against either binary.
const WORKER_READY = "worker] ready:";

/** Resolves once the spawned worker has logged its ready line, or throws with its output if it exits or `deadlineMs` passes first. */
async function waitForWorker(
	proc: ReturnType<typeof Bun.spawn>,
	captured: { lines: () => string },
	deadlineMs: number,
): Promise<void> {
	const deadline = Date.now() + deadlineMs;
	while (Date.now() < deadline && proc.exitCode === null) {
		if (captured.lines().includes(WORKER_READY)) {
			return;
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(
		`worker never became ready within ${deadlineMs}ms\n--- captured output ---\n${captured.lines()}`,
	);
}

export interface SpawnWorkerOptions {
	authSecret: string;
	databaseUrl: string;
	port: number;
}

/**
 * Builds the real Go worker (`cmd/worker`) and spawns it against the test
 * Postgres with the same `AUTH_SECRET` as the spawned app, so job specs the
 * app encrypts decrypt on the worker side. The same secret also derives the
 * Docker control API's bearer token on both sides, so the spawned app can
 * reach the worker without either being told a token. Ready once it prints
 * its `ready:` line, which it does after its first successful ping.
 */
export function spawnWorker(options: SpawnWorkerOptions) {
	const binary = join(tmpdir(), `homerun-worker-it-${process.pid}`);
	const build = Bun.spawnSync(["go", "build", "-o", binary, "./cmd/worker"], {
		cwd: process.cwd(),
		stderr: "pipe",
	});
	if (build.exitCode !== 0) {
		throw new Error(`go build ./cmd/worker failed: ${build.stderr.toString()}`);
	}
	const proc = Bun.spawn([binary], {
		cwd: process.cwd(),
		env: {
			...process.env,
			AUTH_SECRET: options.authSecret,
			DATABASE_URL: options.databaseUrl,
			WORKER_ID: `integration-${process.pid}`,
			WORKER_PORT: String(options.port),
		},
		stderr: "pipe",
		stdout: "pipe",
	});
	const captured = captureOutput(proc);
	return {
		output: captured.lines,
		proc,
		ready: () => waitForWorker(proc, captured, ciTimeout(15_000, 30_000)),
		stop: async () => {
			proc.kill("SIGTERM");
			await proc.exited;
		},
	};
}

/**
 * A genuine *second* TCP connection to the same local Docker daemon,
 * standing in for a truly separate remote host : the exact
 * `socat TCP-LISTEN:...,fork UNIX-CONNECT:/var/run/docker.sock` trick
 * CLAUDE.md documents as how the Remote Hosts feature was originally
 * verified, reused here as real integration-test infrastructure instead of
 * a one-off manual check. Requires `socat` on PATH (documented as a CI
 * setup step, `apt-get install -y socat`). `port` is picked fresh per run
 * for the same reason as spawnAgent above.
 */
export function startSocatProxy(port: number, dockerSocketPath: string) {
	const proc = Bun.spawn(
		[
			"socat",
			`TCP-LISTEN:${port},fork,reuseaddr`,
			`UNIX-CONNECT:${dockerSocketPath}`,
		],
		{ stderr: "pipe", stdout: "pipe" },
	);
	const captured = captureOutput(proc);
	return {
		proc,
		ready: () =>
			waitForPort(port, ciTimeout(10_000, 20_000), "socat", captured),
		stop: async () => {
			proc.kill("SIGTERM");
			await proc.exited;
		},
	};
}
