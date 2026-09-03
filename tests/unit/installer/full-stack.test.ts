import { describe, expect, mock, test } from "bun:test";
import type { StepRunner } from "../../../packages/installer/exec";
import { FullStackInstaller } from "../../../packages/installer/steps/full-stack";

describe("FullStackInstaller.bringUpFullStack", () => {
	test("writes a compose file wiring in the image and docker socket, then pulls and starts it", async () => {
		const run = mock(async () => ({ code: 0, stderr: "", stdout: "" }));
		const writeFile = mock(
			async (_path: string, _content: string) => undefined,
		);
		const appendLine = mock(async (_path: string, _line: string) => undefined);
		const runner = { appendLine, run, writeFile } as unknown as StepRunner;

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

		const composeCall = writeFile.mock.calls.find(
			(call) => call[0] === composePath,
		) as [string, string];
		const content = composeCall[1];
		expect(content).toContain("image: docker.io/orochibraru/homerun:v1.2.3");
		expect(content).toContain(
			"- /run/user/1000/docker.sock:/run/user/1000/docker.sock",
		);
		expect(content).toContain("./homerun.yaml:/app/homerun.yaml:ro");
		expect(content).toContain("name: homerun");
		expect(content).toContain("AUTH_SECRET");

		const configCall = writeFile.mock.calls.find(
			(call) => call[0] === "/home/homerun/homerun/homerun.yaml",
		) as [string, string];
		expect(configCall[1]).toContain("socketPath: /run/user/1000/docker.sock");

		expect(appendLine).toHaveBeenCalledTimes(1);
		const [envPath, line] = appendLine.mock.calls[0] as [string, string];
		expect(envPath).toBe("/home/homerun/homerun/.env");
		expect(line).toMatch(/^AUTH_SECRET=[0-9a-f]{64}$/);

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
		const writeFile = mock(
			async (_path: string, _content: string) => undefined,
		);
		const appendLine = mock(async (_path: string, _line: string) => undefined);
		const runner = { appendLine, run, writeFile } as unknown as StepRunner;

		await FullStackInstaller.bringUpFullStack(
			runner,
			"homerun",
			"latest",
			"/var/run/docker.sock",
		);

		const composeCall = writeFile.mock.calls.find(
			(call) => call[0] === "/home/homerun/homerun/compose.yaml",
		) as [string, string];
		expect(composeCall[1]).toContain(
			"image: docker.io/orochibraru/homerun:latest",
		);
	});
});
