import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { StepRunner } from "../../installer/exec";
import {
	agentSystemdUnit,
	installAgentBinary,
	installAgentSystemdUnit,
} from "../../installer/steps/agent";
import * as release from "../../installer/steps/release";

describe("agentSystemdUnit", () => {
	test("renders a systemd --user unit wired to the given binary/socket/port/token file", () => {
		const unit = agentSystemdUnit({
			binaryPath: "/usr/local/bin/homerun-agent",
			dockerSocket: "/run/user/1000/docker.sock",
			port: 7420,
			tokenFile: "/home/homerun/.homerun-agent/token",
		});

		expect(unit).toContain("ExecStart=/usr/local/bin/homerun-agent");
		expect(unit).toContain("Environment=PORT=7420");
		expect(unit).toContain(
			"Environment=DOCKER_SOCKET_PATH=/run/user/1000/docker.sock",
		);
		expect(unit).toContain(
			"Environment=AGENT_TOKEN_FILE=/home/homerun/.homerun-agent/token",
		);
		expect(unit).toContain("After=docker.service");
		expect(unit).toContain("WantedBy=default.target");
	});
});

describe("installAgentBinary", () => {
	afterEach(() => {
		mock.restore();
	});

	test("downloads the arch-specific binary to /usr/local/bin/homerun-agent", async () => {
		const download = spyOn(release, "downloadReleaseBinary").mockImplementation(
			async () => undefined,
		);
		const runner = {} as StepRunner;

		const path = await installAgentBinary(runner, "v1.2.3", "arm64");

		expect(path).toBe("/usr/local/bin/homerun-agent");
		expect(download).toHaveBeenCalledWith(
			runner,
			"v1.2.3",
			"homerun-agent-arm64",
			"/usr/local/bin/homerun-agent",
		);
	});
});

describe("installAgentSystemdUnit", () => {
	test("writes the unit, chowns it, and enables it via systemctl --user", async () => {
		const run = mock(async (cmd: string[]) => {
			if (cmd[0] === "id" && cmd[1] === "-u") {
				return { code: 0, stderr: "", stdout: "1000\n" };
			}
			return { code: 0, stderr: "", stdout: "" };
		});
		const writeFile = mock(async () => undefined);
		const runner = { run, writeFile } as unknown as StepRunner;

		await installAgentSystemdUnit(
			runner,
			"homerun",
			"/run/user/1000/docker.sock",
			7420,
		);

		expect(run).toHaveBeenCalledWith(
			["mkdir", "-p", "/home/homerun/.config/systemd/user"],
			{ as: "homerun" },
		);

		const [unitPath, unitContent] = writeFile.mock.calls[0] as [string, string];
		expect(unitPath).toBe(
			"/home/homerun/.config/systemd/user/homerun-agent.service",
		);
		expect(unitContent).toContain("ExecStart=/usr/local/bin/homerun-agent");

		expect(run).toHaveBeenCalledWith([
			"chown",
			"-R",
			"homerun:homerun",
			"/home/homerun/.config/systemd/user",
		]);
		expect(run).toHaveBeenCalledWith(
			["systemctl", "--user", "daemon-reload"],
			expect.objectContaining({
				as: "homerun",
				env: expect.objectContaining({ XDG_RUNTIME_DIR: "/run/user/1000" }),
			}),
		);
		expect(run).toHaveBeenCalledWith(
			["systemctl", "--user", "enable", "--now", "homerun-agent"],
			expect.objectContaining({ as: "homerun" }),
		);
	});
});
