import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { toLogStream } = await import(
	"../../../src/lib/services/docker/log-stream"
);

function frame(stream: 1 | 2, text: string): Buffer {
	const payload = Buffer.from(text, "utf8");
	const header = Buffer.alloc(8);
	header[0] = stream;
	header.writeUInt32BE(payload.length, 4);
	return Buffer.concat([header, payload]);
}

describe("toLogStream", () => {
	test("demuxes a one-shot buffer and closes", async () => {
		const logs = Buffer.concat([frame(1, "ready\n"), frame(2, "warn\n")]);
		const text = await new Response(toLogStream(logs)).text();
		expect(text).toBe("ready\nwarn\n");
	});

	test("sends nothing for an empty buffer", async () => {
		expect(await new Response(toLogStream(Buffer.alloc(0))).text()).toBe("");
	});

	test("pipes a follow stream and destroys it on cancel", async () => {
		const destroy = mock(() => undefined);
		const source = Object.assign(new EventEmitter(), { destroy });
		const stream = toLogStream(
			source as unknown as NodeJS.ReadableStream & { destroy: () => void },
		);
		const reader = stream.getReader();
		source.emit("data", Buffer.from("line\n"));
		const { value } = await reader.read();
		expect(new TextDecoder().decode(value)).toBe("line\n");
		await reader.cancel();
		expect(destroy).toHaveBeenCalled();
	});
});
