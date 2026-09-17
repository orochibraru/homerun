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

		const composePath = await FullStackInstaller.bringUpFullStack({
			dockerSocket: "/run/user/1000/docker.sock",
			host: "homerun.example.com",
			run: runner,
			username: "homerun",
			version: "v1.2.3",
		});

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
		expect(content).toContain("DOCKER_SOCKET_PATH: /run/user/1000/docker.sock");
		expect(content).toContain(
			"- /run/user/1000/docker.sock:/var/run/docker.sock:ro",
		);
		expect(content).toContain("./homerun.yaml:/app/homerun.yaml:ro");
		expect(content).toContain("name: homerun");
		expect(content).toContain("AUTH_SECRET");
		expect(content).toMatch(
			/ORIGIN: \$\{ORIGIN:-http:\/\/homerun\.example\.com:3000\}/,
		);
		expect(content).not.toContain("localhost");

		const configCall = writeFile.mock.calls.find(
			(call) => call[0] === "/home/homerun/homerun/homerun.yaml",
		) as [string, string];
		expect(configCall[1]).toContain("socketPath: /run/user/1000/docker.sock");
		expect(configCall[1]).toContain("baseDomain: homerun.example.com");
		expect(configCall[1]).not.toContain("localhost");

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
			["docker", "compose", "-f", composePath, "pull", "--quiet"],
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

		await FullStackInstaller.bringUpFullStack({
			dockerSocket: "/var/run/docker.sock",
			host: "203.0.113.10",
			run: runner,
			username: "homerun",
			version: "latest",
		});

		const composeCall = writeFile.mock.calls.find(
			(call) => call[0] === "/home/homerun/homerun/compose.yaml",
		) as [string, string];
		expect(composeCall[1]).toContain(
			"image: docker.io/orochibraru/homerun:latest",
		);
		expect(composeCall[1]).toContain("traefik.enable=true");
		expect(composeCall[1]).toContain("DASHBOARD_DOMAIN:-203.0.113.10");
		expect(composeCall[1]).toContain("DASHBOARD_CERT_RESOLVER:-}");
	});

	test("shares a dynamic-config volume between the app and Traefik, with the file provider on", async () => {
		const run = mock(async () => ({ code: 0, stderr: "", stdout: "" }));
		const writeFile = mock(
			async (_path: string, _content: string) => undefined,
		);
		const appendLine = mock(async (_path: string, _line: string) => undefined);
		const runner = { appendLine, run, writeFile } as unknown as StepRunner;

		await FullStackInstaller.bringUpFullStack({
			dockerSocket: "/var/run/docker.sock",
			host: "homerun.example.com",
			run: runner,
			username: "homerun",
			version: "latest",
		});

		const compose = (
			writeFile.mock.calls.find(
				(call) => call[0] === "/home/homerun/homerun/compose.yaml",
			) as [string, string]
		)[1];
		expect(compose).toContain(
			"--providers.file.directory=/etc/traefik/dynamic",
		);
		expect(compose).toContain("--providers.file.watch=true");
		expect(compose).toContain("traefik-dynamic:/app/traefik-dynamic");
		expect(compose).toContain("traefik-dynamic:/etc/traefik/dynamic");
		expect(compose).toContain("traefik-dynamic: {}");
		expect(compose).toContain(
			"TRAEFIK_DYNAMIC_CONFIG_DIR: /app/traefik-dynamic",
		);

		const configCall = writeFile.mock.calls.find(
			(call) => call[0] === "/home/homerun/homerun/homerun.yaml",
		) as [string, string];
		expect(configCall[1]).toContain("dynamicConfigDir: /app/traefik-dynamic");
	});

	test("gives the dashboard router a real cert resolver on a domain install", async () => {
		const run = mock(async () => ({ code: 0, stderr: "", stdout: "" }));
		const writeFile = mock(
			async (_path: string, _content: string) => undefined,
		);
		const appendLine = mock(async (_path: string, _line: string) => undefined);
		const runner = { appendLine, run, writeFile } as unknown as StepRunner;

		await FullStackInstaller.bringUpFullStack({
			dockerSocket: "/var/run/docker.sock",
			host: "homerun.example.com",
			run: runner,
			username: "homerun",
			version: "latest",
		});

		const composeCall = writeFile.mock.calls.find(
			(call) => call[0] === "/home/homerun/homerun/compose.yaml",
		) as [string, string];
		expect(composeCall[1]).toContain("DASHBOARD_DOMAIN:-homerun.example.com");
		expect(composeCall[1]).toContain("DASHBOARD_CERT_RESOLVER:-letsencrypt}");
	});

	test("--docker=rootful runs compose as root on the system socket and leaves the port sysctl alone", async () => {
		const run = mock(
			async (
				_cmd: string[],
				_opts?: { as?: string; cwd?: string; env?: Record<string, string> },
			) => ({ code: 0, stderr: "", stdout: "" }),
		);
		const writeFile = mock(
			async (_path: string, _content: string) => undefined,
		);
		const appendLine = mock(async (_path: string, _line: string) => undefined);
		const runner = { appendLine, run, writeFile } as unknown as StepRunner;

		const composePath = await FullStackInstaller.bringUpFullStack({
			dockerSocket: "/var/run/docker.sock",
			host: "homerun.example.com",
			rootful: true,
			run: runner,
			username: "homerun",
			version: "latest",
		});

		const composeCalls = run.mock.calls.filter(
			(call) => call[0][0] === "docker",
		);
		expect(composeCalls.map((call) => call[0])).toEqual([
			["docker", "compose", "-f", composePath, "pull", "--quiet"],
			["docker", "compose", "-f", composePath, "up", "-d"],
		]);
		for (const call of composeCalls) {
			expect(call[1]).toEqual({
				cwd: "/home/homerun/homerun",
				env: { DOCKER_HOST: "unix:///var/run/docker.sock" },
			});
		}
		expect(
			writeFile.mock.calls.some((call) => call[0].startsWith("/etc/sysctl.d/")),
		).toBe(false);

		const compose = (
			writeFile.mock.calls.find((call) => call[0] === composePath) as [
				string,
				string,
			]
		)[1];
		expect(compose).toContain("- /var/run/docker.sock:/var/run/docker.sock:ro");
	});
});

describe("FullStackInstaller.bringUpFullStack in swarm mode", () => {
	function fakeRunner() {
		const run = mock(async () => ({ code: 0, stderr: "", stdout: "" }));
		const writeFile = mock(
			async (_path: string, _content: string) => undefined,
		);
		const appendLine = mock(async (_path: string, _line: string) => undefined);
		return {
			run,
			runner: { appendLine, run, writeFile } as unknown as StepRunner,
			writeFile,
		};
	}

	function composeFrom(writeFile: ReturnType<typeof mock>): string {
		return (
			writeFile.mock.calls.find(
				(call) => call[0] === "/home/homerun/homerun/compose.yaml",
			) as [string, string]
		)[1];
	}

	test("ends Traefik's command with the exact swarm flags the app applies, and joins the overlay", async () => {
		const { runner, writeFile } = fakeRunner();
		await FullStackInstaller.bringUpFullStack({
			dockerSocket: "/var/run/docker.sock",
			host: "203.0.113.10",
			rootful: true,
			run: runner,
			swarm: true,
			username: "homerun",
			version: "latest",
		});
		const compose = composeFrom(writeFile);
		expect(compose).toContain(
			"acme.json\n      - --providers.swarm=true\n      - --providers.swarm.exposedByDefault=false\n      - --providers.swarm.network=homerun-swarm\n      - --providers.swarm.refreshSeconds=2\n",
		);
		expect(compose).toContain("- --providers.docker=true");
		expect(compose).toContain("- /var/run/docker.sock:/var/run/docker.sock:ro");
		expect(compose).toContain("DOCKER_SOCKET_PATH: /var/run/docker.sock");
		expect(compose).toContain(
			"    networks:\n      - homerun\n      - homerun-swarm\n",
		);
		expect(compose).toContain(
			"  homerun-swarm:\n    name: homerun-swarm\n    external: true",
		);
	});

	test("a standalone install has no swarm provider or overlay", async () => {
		const { runner, writeFile } = fakeRunner();
		await FullStackInstaller.bringUpFullStack({
			dockerSocket: "/run/user/1000/docker.sock",
			host: "203.0.113.10",
			run: runner,
			username: "homerun",
			version: "latest",
		});
		const compose = composeFrom(writeFile);
		expect(compose).not.toContain("providers.swarm");
		expect(compose).not.toContain("homerun-swarm");
	});

	test("runs a given image and tolerates it not being pullable", async () => {
		const { run, runner, writeFile } = fakeRunner();
		await FullStackInstaller.bringUpFullStack({
			dockerSocket: "/var/run/docker.sock",
			host: "203.0.113.10",
			image: "homerun-e2e:local",
			rootful: true,
			run: runner,
			swarm: true,
			username: "homerun",
			version: "latest",
		});
		expect(composeFrom(writeFile)).toContain("image: homerun-e2e:local");
		expect(run).toHaveBeenCalledWith(
			[
				"docker",
				"compose",
				"-f",
				"/home/homerun/homerun/compose.yaml",
				"pull",
				"--quiet",
				"--ignore-pull-failures",
			],
			expect.objectContaining({ cwd: "/home/homerun/homerun" }),
		);
	});
});
