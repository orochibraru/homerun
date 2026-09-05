import { DeploymentDTO } from "$lib/dto/deployment-dto";

const POLL_MS = 500;
const HEARTBEAT_MS = 15_000;
const MAX_WAIT_FOR_ROW_MS = 60_000;
const TERMINAL_STATUSES = new Set(["running", "stopped", "failed"]);

const encoder = new TextEncoder();

export interface DeployProgressSnapshot {
	errorMessage: string | null;
	log: string;
	status: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function snapshot(
	deploymentId: string,
	serviceId: string,
): Promise<DeployProgressSnapshot | null> {
	const dep = await DeploymentDTO.get(deploymentId);
	if (!dep) {
		return null;
	}
	const row = dep.toJSON();
	if (row.serviceId !== serviceId) {
		return null;
	}
	return { errorMessage: row.errorMessage, log: dep.log, status: row.status };
}

class ProgressEmitter {
	#lastBeat = Date.now();
	#lastSerialized = "";

	constructor(
		private readonly controller: ReadableStreamDefaultController<Uint8Array>,
	) {}

	#send(event: string, data: unknown): void {
		this.controller.enqueue(
			encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
		);
		this.#lastBeat = Date.now();
	}

	progress(current: DeployProgressSnapshot): void {
		const serialized = JSON.stringify(current);
		if (serialized === this.#lastSerialized) {
			return;
		}
		this.#lastSerialized = serialized;
		this.#send("progress", current);
	}

	done(status: string): void {
		this.#send("done", { status });
	}

	beat(): void {
		if (Date.now() - this.#lastBeat < HEARTBEAT_MS) {
			return;
		}
		this.#lastBeat = Date.now();
		this.controller.enqueue(encoder.encode(": keep-alive\n\n"));
	}
}

async function step(
	emitter: ProgressEmitter,
	deploymentId: string,
	serviceId: string,
	deadline: number,
): Promise<boolean> {
	const current = await snapshot(deploymentId, serviceId);
	if (!current) {
		if (Date.now() > deadline) {
			emitter.done("missing");
			return true;
		}
		emitter.beat();
		return false;
	}

	emitter.progress(current);
	if (TERMINAL_STATUSES.has(current.status)) {
		emitter.done(current.status);
		return true;
	}
	emitter.beat();
	return false;
}

export function deployProgressStream(
	deploymentId: string,
	serviceId: string,
): ReadableStream<Uint8Array> {
	let cancelled = false;

	return new ReadableStream<Uint8Array>({
		cancel() {
			cancelled = true;
		},
		async start(controller) {
			const emitter = new ProgressEmitter(controller);
			const deadline = Date.now() + MAX_WAIT_FOR_ROW_MS;
			try {
				let finished = await step(emitter, deploymentId, serviceId, deadline);
				while (!(cancelled || finished)) {
					// biome-ignore lint/performance/noAwaitInLoops: the interval between polls is the point
					await sleep(POLL_MS);
					finished = await step(emitter, deploymentId, serviceId, deadline);
				}
			} catch {
				// A client that navigated away mid-write is the normal ending.
			} finally {
				try {
					controller.close();
				} catch {
					// Already closed by the client cancelling.
				}
			}
		},
	});
}
