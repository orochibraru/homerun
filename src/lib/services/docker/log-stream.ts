import { demuxDockerFrames } from "./git-build.ts";

type DockerLogs = Buffer | (NodeJS.ReadableStream & { destroy: () => void });

/**
 * Wraps what dockerode's `logs()` returns as a web ReadableStream: a follow
 * stream is piped through chunk by chunk and destroyed on cancel, a one-shot
 * Buffer is demuxed from Docker's stdout/stderr frames and sent whole.
 */
export function toLogStream(logs: DockerLogs): ReadableStream<Uint8Array> {
	if (Buffer.isBuffer(logs)) {
		const text = demuxDockerFrames(logs);
		return new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(text ? `${text}\n` : ""));
				controller.close();
			},
		});
	}
	return new ReadableStream<Uint8Array>({
		cancel() {
			logs.destroy();
		},
		start(controller) {
			logs.on("data", (chunk: Buffer) => {
				controller.enqueue(new Uint8Array(chunk));
			});
			logs.on("end", () => controller.close());
			logs.on("error", (err: Error) => controller.error(err));
		},
	});
}
