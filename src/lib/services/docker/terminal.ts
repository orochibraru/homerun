import Bun from "bun";
import { config } from "$lib/config";
import type { BaseDockerService, Constructor } from "./base.ts";

/**
 * Interactive `docker exec` sessions, exposed to the browser over plain
 * chunked HTTP rather than a WebSocket : this app has no custom server
 * (SvelteKit route handlers only, `vite dev` in dev / a plain Bun HTTP
 * server via `bun run start` in prod), so there's no upgrade hook to hang
 * a `ws` server off. Output streams via one long-lived GET (same
 * ReadableStream pattern as streamLogs in containers.ts); input is sent via
 * short POSTs, one per line/keystroke-batch, each writing straight into
 * the exec's stdin. Less slick than a real terminal library, genuinely
 * usable for basic shell work.
 *
 * **Why this doesn't use dockerode's `exec.start()`**: verified during
 * development that it hangs forever under Bun : `exec.start({hijack:true})`
 * relies on Node's `http.request` completing an HTTP/1.1 `Connection:
 * Upgrade` handshake and handing back the raw duplex socket, and that
 * upgrade flow never resolves under Bun's `node:http` compatibility layer
 * (confirmed via a minimal repro before writing this). `container.exec()`
 * : the *create* call, a normal request/response : works fine and is
 * still used below. Only the *start* step is done manually: a raw
 * `Bun.connect()` Unix-socket connection to the Docker daemon, writing
 * the HTTP/1.1 Upgrade request by hand and treating the socket as a raw
 * duplex stream once the "101 UPGRADED" response header block is past :
 * confirmed working end-to-end (real shell prompt, real command echoed
 * back) against a live container before this was wired into routes.
 *
 * Security-sensitive by nature (arbitrary command execution inside a
 * container this app manages) : every route that touches this module
 * MUST re-check service ownership itself; this module only trusts the
 * containerId it's given.
 */

interface TerminalSession {
	containerId: string;
	createdAt: number;
	lastActivity: number;
	listeners: Set<(chunk: Uint8Array) => void>;
	serviceId: string;
	socket: Bun.Socket<undefined>;
	userId: string;
}

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const REAP_INTERVAL_MS = 60 * 1000;

// Survives Vite HMR the same way the other schedulers do (cron.service.ts) :
// guards the *interval*, not the sessions themselves (those live on the
// DockerService singleton instance, see #sessions below).
const globalForTerminal = globalThis as unknown as {
	__terminal_reaper?: ReturnType<typeof setInterval>;
};

export interface OpenSessionParams {
	containerId: string;
	serviceId: string;
	userId: string;
}

const HEADER_END = "\r\n\r\n";

/** Interactive web terminal : open/subscribe/write/close a `docker exec` session, plus an idle reaper. */
export function DockerTerminalMixin<
	TBase extends Constructor<BaseDockerService>,
>(Base: TBase) {
	return class DockerTerminalService extends Base {
		#sessions = new Map<string, TerminalSession>();

		// biome-ignore lint/suspicious/noExplicitAny: TS's mixin pattern requires this exact constructor shape
		constructor(...args: any[]) {
			super(...args);
			this.#startReaper();
		}

		#startReaper(): void {
			if (globalForTerminal.__terminal_reaper) {
				return;
			}
			globalForTerminal.__terminal_reaper = setInterval(() => {
				const now = Date.now();
				for (const [id, session] of this.#sessions) {
					if (now - session.lastActivity > IDLE_TIMEOUT_MS) {
						this.closeSession(id);
					}
				}
			}, REAP_INTERVAL_MS);
		}

		/** Starts a new interactive shell session inside the container. Tries `/bin/sh` : the one shell essentially every image has. */
		async openTerminalSession(params: OpenSessionParams): Promise<string> {
			const container = this.getDocker().getContainer(params.containerId);
			const exec = await container.exec({
				AttachStderr: true,
				AttachStdin: true,
				AttachStdout: true,
				Cmd: ["/bin/sh"],
				Tty: true,
			});

			const sessionId = crypto.randomUUID();
			const listeners = new Set<(chunk: Uint8Array) => void>();

			const startPayload = JSON.stringify({ Detach: false, Tty: true });
			const startRequest = [
				`POST /exec/${exec.id}/start HTTP/1.1`,
				"Host: docker",
				"Content-Type: application/json",
				`Content-Length: ${Buffer.byteLength(startPayload)}`,
				"Connection: Upgrade",
				"Upgrade: tcp",
				"",
				startPayload,
			].join("\r\n");

			let headerBuffer = "";
			let headersParsed = false;
			const sessions = this.#sessions;

			const socket = await Bun.connect({
				socket: {
					close() {
						sessions.delete(sessionId);
					},
					data(_s, chunk) {
						if (!headersParsed) {
							headerBuffer += chunk.toString("binary");
							const idx = headerBuffer.indexOf(HEADER_END);
							if (idx === -1) {
								return;
							}
							headersParsed = true;
							const rest = headerBuffer.slice(idx + HEADER_END.length);
							headerBuffer = "";
							if (rest) {
								const bytes = Buffer.from(rest, "binary");
								for (const listener of listeners) {
									listener(new Uint8Array(bytes));
								}
							}
							return;
						}
						for (const listener of listeners) {
							listener(new Uint8Array(chunk));
						}
					},
					error() {
						sessions.delete(sessionId);
					},
				},
				unix: config.docker.socketPath,
			});

			socket.write(startRequest);

			const now = Date.now();
			this.#sessions.set(sessionId, {
				containerId: params.containerId,
				createdAt: now,
				lastActivity: now,
				listeners,
				serviceId: params.serviceId,
				socket,
				userId: params.userId,
			});

			return sessionId;
		}

		/**
		 * Subscribes to a session's output. Returns an unsubscribe function,
		 * or null if the session doesn't exist / isn't owned by this user.
		 */
		subscribeToSession(
			sessionId: string,
			userId: string,
			onChunk: (chunk: Uint8Array) => void,
		): (() => void) | null {
			const session = this.#sessions.get(sessionId);
			if (!session || session.userId !== userId) {
				return null;
			}
			session.lastActivity = Date.now();
			session.listeners.add(onChunk);
			return () => session.listeners.delete(onChunk);
		}

		/** Writes to the session's stdin. Returns false if the session doesn't exist / isn't owned by this user. */
		writeToSession(sessionId: string, userId: string, data: string): boolean {
			const session = this.#sessions.get(sessionId);
			if (!session || session.userId !== userId) {
				return false;
			}
			session.lastActivity = Date.now();
			session.socket.write(data);
			return true;
		}

		/** Closes and forgets a session. No-op if it's already gone. */
		closeSession(sessionId: string): void {
			const session = this.#sessions.get(sessionId);
			if (!session) {
				return;
			}
			try {
				session.socket.end();
			} catch {
				// Already closed on the Docker side : fine.
			}
			this.#sessions.delete(sessionId);
		}

		ownsSession(sessionId: string, userId: string): boolean {
			return this.#sessions.get(sessionId)?.userId === userId;
		}
	};
}
