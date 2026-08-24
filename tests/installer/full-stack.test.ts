import { describe, expect, mock, test } from "bun:test";
import type { StepRunner } from "../../installer/exec";
import { FullStackInstaller } from "../../installer/steps/full-stack";

describe("FullStackInstaller.bringUpFullStack", () => {
	test("writes a compose file wiring in the image and docker socket, then pulls and starts it", async () => {
		const run = mock(async () => ({ code: 0, stderr: "", stdout: "" }));
		const writeFile = mock(async () => undefined);
		const runner = { run, writeFile } as unknown as StepRunner;

		const composePath = await FullStackInstaller.bringUpFullStack(
			runner,
			"homerun",
			"v1.2.3",
			"/run/user/1000/docker.sock",
		);

		expect(composePath).toBe("/home/homerun/homerun/compose.yaml");
		expect(run).toHaveBeenCalledWith(["mkdir", "-p", "/home/homerun/homerun"], {
			as: "homerun",
		});

		const [writtenPath, content] = writeFile.mock.calls[0] as [string, string];
		expect(writtenPath).toBe(composePath);
		expect(content).toContain(
			"image: git.ombrage.space/orochibraru/homerun:v1.2.3",
		);
		expect(content).toContain(
			"- /run/user/1000/docker.sock:/run/user/1000/docker.sock",
		);
		expect(content).toContain("name: homerun");
		expect(content).toContain("AUTH_SECRET");

		expect(run).toHaveBeenCalledWith([
			"chown",
			"-R",
			"homerun:homerun",
			"/home/homerun/homerun",
		]);
		expect(run).toHaveBeenCalledWith(
			["docker", "compose", "-f", composePath, "pull"],
			expect.objectContaining({ as: "homerun", cwd: "/home/homerun/homerun" }),
		);
		expect(run).toHaveBeenCalledWith(
			["docker", "compose", "-f", composePath, "up", "-d"],
			expect.objectContaining({ as: "homerun", cwd: "/home/homerun/homerun" }),
		);
	});

	test("resolves 'latest' the same way ReleaseAssets.imageRef does", async () => {
		const run = mock(async () => ({ code: 0, stderr: "", stdout: "" }));
		const writeFile = mock(async () => undefined);
		const runner = { run, writeFile } as unknown as StepRunner;

		await FullStackInstaller.bringUpFullStack(
			runner,
			"homerun",
			"latest",
			"/var/run/docker.sock",
		);

		const [, content] = writeFile.mock.calls[0] as [string, string];
		expect(content).toContain(
			"image: git.ombrage.space/orochibraru/homerun:latest",
		);
	});
});
