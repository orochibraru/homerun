import { describe, expect, mock, test } from "bun:test";
import type { StepRunner } from "../../installer/exec";
import {
	downloadReleaseBinary,
	imageRef,
	releaseAssetUrl,
} from "../../installer/steps/release";

describe("releaseAssetUrl", () => {
	test("'latest' resolves to the latest-release download path", () => {
		expect(releaseAssetUrl("latest", "homerun-agent-amd64")).toBe(
			"https://git.ombrage.space/orochibraru/homerun/releases/latest/download/homerun-agent-amd64",
		);
	});

	test("a specific tag pins to that release", () => {
		expect(releaseAssetUrl("v1.2.3", "homerun-cli-arm64")).toBe(
			"https://git.ombrage.space/orochibraru/homerun/releases/download/v1.2.3/homerun-cli-arm64",
		);
	});
});

describe("imageRef", () => {
	test("'latest' maps to the :latest image tag", () => {
		expect(imageRef("latest")).toBe(
			"git.ombrage.space/orochibraru/homerun:latest",
		);
	});

	test("a specific version is used as the literal image tag", () => {
		// Real asymmetry documented in release.ts : there's no :vX.Y.Z image
		// tag actually published, this only reflects what the caller asked for.
		expect(imageRef("v1.2.3")).toBe(
			"git.ombrage.space/orochibraru/homerun:v1.2.3",
		);
	});
});

describe("downloadReleaseBinary", () => {
	test("curls the release asset URL to dest, then chmods it executable", async () => {
		const run = mock(async () => ({ code: 0, stderr: "", stdout: "" }));
		const runner = { run } as unknown as StepRunner;

		await downloadReleaseBinary(
			runner,
			"v1.2.3",
			"homerun-agent-arm64",
			"/usr/local/bin/homerun-agent",
		);

		expect(run.mock.calls[0][0]).toEqual([
			"curl",
			"-fsSL",
			"https://git.ombrage.space/orochibraru/homerun/releases/download/v1.2.3/homerun-agent-arm64",
			"-o",
			"/usr/local/bin/homerun-agent",
		]);
		expect(run.mock.calls[1][0]).toEqual([
			"chmod",
			"+x",
			"/usr/local/bin/homerun-agent",
		]);
	});
});
