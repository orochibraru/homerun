/**
 * Decodes Docker's multiplexed stdout/stderr stream format (an 8-byte header
 * per frame: stream type + big-endian length, then that many payload bytes)
 * into plain text, for a non-Tty container's combined logs/output. Falls
 * back to treating `raw` as plain UTF-8 text when it doesn't parse as framed
 * output.
 */
export function demuxDockerFrames(raw: Buffer): string {
	const parts: string[] = [];
	let offset = 0;
	while (offset + 8 <= raw.length) {
		const stream = raw[offset];
		if (stream > 2 || raw[offset + 1] !== 0) {
			return raw.toString("utf8").trim();
		}
		const length = raw.readUInt32BE(offset + 4);
		parts.push(raw.subarray(offset + 8, offset + 8 + length).toString("utf8"));
		offset += 8 + length;
	}
	return parts.join("").trim();
}

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
