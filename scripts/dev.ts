import { watch } from "node:fs";
import { mkdir } from "node:fs/promises";
import process from "node:process";
import Bun from "bun";

const WORKER_BINARY = "node_modules/.cache/homerun/homerun-worker";
const WATCHED = ["cmd", "internal", "go.mod", "go.sum"];
const RELEVANT = /\.(go|sh|json)$|^go\.(mod|sum)$/;
const STOP_TIMEOUT_MS = 10_000;

const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const runApp = only !== "worker";
const runWorker = only !== "app";

const paint = (code: number, text: string) =>
	process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
const tag = paint(35, "[worker]");

/** Prints one worker line with the `[worker]` prefix, so it stands out from vite's output. */
function say(line: string): void {
	console.log(`${tag} ${line}`);
}

/** Forwards a stream line by line with the `[worker]` prefix. */
async function pipe(stream: ReadableStream<Uint8Array>): Promise<void> {
	const decoder = new TextDecoder();
	let pending = "";
	for await (const chunk of stream) {
		pending += decoder.decode(chunk, { stream: true });
		const lines = pending.split("\n");
		pending = lines.pop() ?? "";
		for (const line of lines) {
			say(line);
		}
	}
	if (pending) {
		say(pending);
	}
}

/** Compiles cmd/worker, returning the compiler's output when it fails. */
async function buildWorker(): Promise<string | null> {
	await mkdir("node_modules/.cache/homerun", { recursive: true });
	const build = Bun.spawn(
		["go", "build", "-o", WORKER_BINARY, "./cmd/worker"],
		{
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	const [stderr, code] = await Promise.all([
		new Response(build.stderr).text(),
		build.exited,
	]);
	return code === 0 ? null : stderr.trim();
}

let worker: ReturnType<typeof Bun.spawn> | null = null;

/** Stops the running worker: SIGTERM, then SIGKILL after `STOP_TIMEOUT_MS`. An interrupted job's lease expires and it runs again. */
async function stopWorker(): Promise<void> {
	const running = worker;
	worker = null;
	if (!running) {
		return;
	}
	running.kill("SIGTERM");
	const killed = setTimeout(() => running.kill("SIGKILL"), STOP_TIMEOUT_MS);
	await running.exited;
	clearTimeout(killed);
}

/** Starts the freshly built worker binary with this process's env (Bun already loaded `.env`). */
function startWorker(): void {
	const proc = Bun.spawn([WORKER_BINARY], {
		env: process.env,
		stderr: "pipe",
		stdout: "pipe",
	});
	worker = proc;
	void pipe(proc.stdout);
	void pipe(proc.stderr);
	void proc.exited.then((code) => {
		if (worker === proc) {
			worker = null;
			say(`exited with code ${code}, waiting for a change to restart it`);
		}
	});
}

let rebuilding: Promise<void> = Promise.resolve();

/** Rebuilds, and only swaps the running worker once the new binary compiled. */
function rebuild(reason: string): void {
	rebuilding = rebuilding.then(async () => {
		say(`${reason}, building…`);
		const failure = await buildWorker();
		if (failure) {
			say(paint(31, "build failed, the previous worker keeps running:"));
			for (const line of failure.split("\n")) {
				say(line);
			}
			return;
		}
		await stopWorker();
		startWorker();
		say(paint(32, "running"));
	});
}

const children: ReturnType<typeof Bun.spawn>[] = [];

if (runWorker) {
	if (Bun.which("go")) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		for (const path of WATCHED) {
			watch(path, { recursive: true }, (_event, file) => {
				const name = file?.toString() ?? path;
				if (
					!RELEVANT.test(name.split("/").pop() ?? "") ||
					name.endsWith("_test.go")
				) {
					return;
				}
				clearTimeout(timer);
				timer = setTimeout(() => rebuild(`${name} changed`), 300);
			});
		}
		rebuild("starting");
	} else {
		say(
			paint(
				33,
				"Go isn't installed, so jobs won't run. Install Go, or run the worker in Docker: docker compose --profile worker up -d --build worker",
			),
		);
	}
}

if (runApp) {
	children.push(
		Bun.spawn(["bunx", "vite", "dev"], {
			stdio: ["inherit", "inherit", "inherit"],
		}),
	);
}

/** Stops everything this script started and exits. */
async function shutdown(): Promise<never> {
	for (const child of children) {
		child.kill("SIGTERM");
	}
	await stopWorker();
	process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

if (runApp) {
	const code = await children[0].exited;
	await stopWorker();
	process.exit(code);
}
