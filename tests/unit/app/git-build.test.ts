import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { demuxDockerFrames, extractCommitSha } = await import(
	"../../../src/lib/services/docker/git-build"
);

function frame(stream: 1 | 2, text: string): Buffer {
	const payload = Buffer.from(text, "utf8");
	const header = Buffer.alloc(8);
	header[0] = stream;
	header.writeUInt32BE(payload.length, 4);
	return Buffer.concat([header, payload]);
}

describe("demuxDockerFrames", () => {
	test("unwraps stdout and stderr frames into one block of text", () => {
		const raw = Buffer.concat([
			frame(2, "Cloning into '/workspace/repo'...\n"),
			frame(1, "9f8e7d6c5b4a39281706f5e4d3c2b1a099887766\n"),
		]);

		expect(demuxDockerFrames(raw)).toBe(
			"Cloning into '/workspace/repo'...\n9f8e7d6c5b4a39281706f5e4d3c2b1a099887766",
		);
	});

	test("a frame whose length byte is printable doesn't leak into the payload", () => {
		const sha = "9f8e7d6c5b4a39281706f5e4d3c2b1a099887766\n";
		expect(sha.length).toBe(41);

		expect(demuxDockerFrames(frame(1, sha))).toBe(sha.trim());
	});

	test("passes TTY output (no frames) straight through", () => {
		expect(demuxDockerFrames(Buffer.from("plain output\n", "utf8"))).toBe(
			"plain output",
		);
	});

	test("survives an empty buffer", () => {
		expect(demuxDockerFrames(Buffer.alloc(0))).toBe("");
	});
});

describe("extractCommitSha", () => {
	test("finds the SHA even with other output around it", () => {
		expect(
			extractCommitSha(
				"Cloning into '/workspace/repo'...\n9f8e7d6c5b4a39281706f5e4d3c2b1a099887766\n",
			),
		).toBe("9f8e7d6c5b4a39281706f5e4d3c2b1a099887766");
	});

	test("returns null rather than a truncated or dirty value", () => {
		expect(extractCommitSha("fatal: not a git repository")).toBeNull();
		expect(extractCommitSha(")68c1b9")).toBeNull();
		expect(extractCommitSha("")).toBeNull();
	});
});
