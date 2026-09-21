import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";

const logger = new Logger("Docker");

interface TerminalSession {
	containerId: string;
	serviceId: string;
	userId: string;
}

export interface OpenSessionParams {
	containerId: string;
	serviceId: string;
	userId: string;
}

/**
 * Mixin adding the interactive web terminal : session open/subscribe/write/close.
 *
 * The shell itself lives in the Go worker, which owns the exec, the hijacked
 * stream and the idle reaper. What stays here is the part the worker can't
 * know: who a session belongs to. The worker only ever sees a container id, so
 * this mixin keeps its own session book (service, user, container) and checks
 * the user on every operation, exactly as it did when it held the socket.
 *
 * Security-sensitive by nature (arbitrary command execution inside a container
 * this app manages) : every route that touches this module MUST re-check
 * service ownership itself; this module only trusts the containerId it's given.
 */
// oxlint-disable-next-line max-lines-per-function -- mixin factory: the body is a class definition, not a procedure
export function DockerTerminalMixin<
	TBase extends Constructor<BaseDockerService>,
>(Base: TBase) {
	return class DockerTerminalService extends Base {
		readonly #sessions = new Map<string, TerminalSession>();

		/** Starts a new interactive shell session inside the container, and remembers whose it is. */
		async openTerminalSession(params: OpenSessionParams): Promise<string> {
			const { sessionId } = await this.worker.post<{ sessionId: string }>(
				"/v1/terminal",
				{ containerId: params.containerId },
			);
			this.#sessions.set(sessionId, {
				containerId: params.containerId,
				serviceId: params.serviceId,
				userId: params.userId,
			});
			return sessionId;
		}

		/**
		 * Pumps the worker's output stream into `onChunk` until the shell ends,
		 * the reader cancels through `signal`, or the connection drops, then
		 * forgets the session so a dead one stops reading as open.
		 */
		async #pump(
			sessionId: string,
			signal: AbortSignal,
			onChunk: (chunk: Uint8Array) => void,
		): Promise<void> {
			try {
				const stream = await this.worker.stream(
					`/v1/terminal/${sessionId}/stream`,
					{ signal },
				);
				await stream.pipeTo(
					new WritableStream<Uint8Array>({
						/** Hands each raw TTY chunk the worker sent straight to the subscriber. */
						write(chunk) {
							onChunk(chunk);
						},
					}),
					{ signal },
				);
				this.#sessions.delete(sessionId);
			} catch (error) {
				if (signal.aborted) {
					return;
				}
				this.#sessions.delete(sessionId);
				logger.warn(`Terminal stream ${sessionId} ended`, error);
			}
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
			const controller = new AbortController();
			void this.#pump(sessionId, controller.signal, onChunk);
			return () => controller.abort();
		}

		/** Writes to the session's stdin. Returns false if the session doesn't exist / isn't owned by this user. */
		writeToSession(sessionId: string, userId: string, data: string): boolean {
			const session = this.#sessions.get(sessionId);
			if (!session || session.userId !== userId) {
				return false;
			}
			this.worker
				.postRaw(`/v1/terminal/${sessionId}/input`, data)
				.catch((error: unknown) => {
					logger.warn(`Couldn't write to terminal session ${sessionId}`, error);
				});
			return true;
		}

		/** Closes and forgets a session. No-op if it's already gone. */
		closeSession(sessionId: string): void {
			if (!this.#sessions.delete(sessionId)) {
				return;
			}
			this.worker
				.delete(`/v1/terminal/${sessionId}`)
				.catch((error: unknown) => {
					logger.warn(`Couldn't close terminal session ${sessionId}`, error);
				});
		}

		/** Whether `sessionId` exists and belongs to `userId`. */
		ownsSession(sessionId: string, userId: string): boolean {
			return this.#sessions.get(sessionId)?.userId === userId;
		}
	};
}
