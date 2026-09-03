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
 * Spawns the real `agent/index.ts` binary from source (same shape as `bun
 * run dev:agent`), pointed at whatever Docker socket this machine's own
 * `docker context` resolves (the agent's own auto-detection, see
 * packages/agent/config.ts) : a real agent, not a stub, so the deploy-target
 * and build-server scenarios exercise the actual HTTP surface this session
 * built. `port` is picked fresh per run (port.ts) so two runs of this suite
 * never collide on a fixed agent port.
 */
export function spawnAgent(port: number, token: string) {
	const proc = Bun.spawn(["bun", "run", "packages/agent/index.ts"], {
		cwd: process.cwd(),
		env: {
			...process.env,
			AGENT_TOKEN: token,
			HOMERUN_NETWORK_NAME: "homerun",
			PORT: String(port),
		},
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
