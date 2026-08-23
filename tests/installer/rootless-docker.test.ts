import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { StepRunner } from "../../installer/exec";
import * as exec from "../../installer/exec";
import type { PackageManager } from "../../installer/steps/detect";
import {
	ensureRootlessUser,
	installDockerEngine,
	installRootlessDocker,
	installRootlessPrereqs,
} from "../../installer/steps/rootless-docker";

function fakeRunner(overrides?: {
	run?: ReturnType<typeof mock>;
	runOk?: ReturnType<typeof mock>;
}) {
	const run =
		overrides?.run ?? mock(async () => ({ code: 0, stderr: "", stdout: "" }));
	const runOk = overrides?.runOk ?? mock(async () => true);
	return { run, runOk } as unknown as StepRunner;
}

describe("installDockerEngine", () => {
	afterEach(() => {
		mock.restore();
	});

	test("skips installing when docker is already present", async () => {
		spyOn(exec, "commandExists").mockImplementation(async () => true);
		const run = mock(async () => ({ code: 0, stderr: "", stdout: "" }));
		const runner = fakeRunner({ run });

		await installDockerEngine(runner);

		expect(run).not.toHaveBeenCalled();
	});

	test("runs the convenience script when docker is missing", async () => {
		spyOn(exec, "commandExists").mockImplementation(async () => false);
		const run = mock(async () => ({ code: 0, stderr: "", stdout: "" }));
		const runner = fakeRunner({ run });

		await installDockerEngine(runner);

		expect(run).toHaveBeenCalledWith([
			"sh",
			"-c",
			"curl -fsSL https://get.docker.com | sh",
		]);
	});
});

describe("installRootlessPrereqs", () => {
	test("installs uidmap/dbus-user-session on apt", async () => {
		const run = mock(async () => ({ code: 0, stderr: "", stdout: "" }));
		const runner = fakeRunner({ run });
		const pm: PackageManager = {
			install: ["apt-get", "install", "-y"],
			kind: "apt",
		};

		await installRootlessPrereqs(runner, pm);

		expect(run).toHaveBeenCalledWith([
			"apt-get",
			"install",
			"-y",
			"uidmap",
			"dbus-user-session",
		]);
	});

	test("installs shadow-utils on dnf/yum", async () => {
		const run = mock(async () => ({ code: 0, stderr: "", stdout: "" }));
		const runner = fakeRunner({ run });
		const pm: PackageManager = {
			install: ["dnf", "install", "-y"],
			kind: "dnf",
		};

		await installRootlessPrereqs(runner, pm);

		expect(run).toHaveBeenCalledWith(["dnf", "install", "-y", "shadow-utils"]);
	});
});

describe("ensureRootlessUser", () => {
	test("reuses the user when `id <user>` succeeds", async () => {
		const runOk = mock(async () => true);
		const run = mock(async () => ({ code: 0, stderr: "", stdout: "" }));
		const runner = fakeRunner({ run, runOk });

		await ensureRootlessUser(runner, "homerun");

		expect(runOk).toHaveBeenCalledWith(["id", "homerun"]);
		expect(run).not.toHaveBeenCalled();
	});

	test("creates the user when it doesn't exist yet", async () => {
		const runOk = mock(async () => false);
		const run = mock(async () => ({ code: 0, stderr: "", stdout: "" }));
		const runner = fakeRunner({ run, runOk });

		await ensureRootlessUser(runner, "homerun");

		expect(run).toHaveBeenCalledWith([
			"useradd",
			"--create-home",
			"--shell",
			"/bin/bash",
			"homerun",
		]);
	});
});

describe("installRootlessDocker", () => {
	test("enables lingering, installs rootless Docker as the user, and returns its socket path", async () => {
		const run = mock(async (cmd: string[]) => {
			if (cmd[0] === "id" && cmd[1] === "-u") {
				return { code: 0, stderr: "", stdout: "1000\n" };
			}
			return { code: 0, stderr: "", stdout: "" };
		});
		const runner = fakeRunner({ run });

		const socket = await installRootlessDocker(runner, "homerun");

		expect(socket).toBe("/run/user/1000/docker.sock");
		expect(run).toHaveBeenCalledWith(["loginctl", "enable-linger", "homerun"]);
		const rootlessInstallCall = run.mock.calls.find((c) =>
			(c[0] as string[]).some((arg) => arg.includes("get.docker.com/rootless")),
		);
		expect(rootlessInstallCall?.[1]).toMatchObject({
			as: "homerun",
			env: { HOME: "/home/homerun", XDG_RUNTIME_DIR: "/run/user/1000" },
		});
		const enableCall = run.mock.calls.find(
			(c) =>
				(c[0] as string[]).join(" ") === "systemctl --user enable --now docker",
		);
		expect(enableCall?.[1]).toMatchObject({ as: "homerun" });
	});

	test("falls back to a placeholder uid when `id -u` returns nothing usable", async () => {
		const run = mock(async (cmd: string[]) => {
			if (cmd[0] === "id" && cmd[1] === "-u") {
				return { code: 0, stderr: "", stdout: "" };
			}
			return { code: 0, stderr: "", stdout: "" };
		});
		const runner = fakeRunner({ run });

		const socket = await installRootlessDocker(runner, "homerun");

		expect(socket).toBe("/run/user/<uid>/docker.sock");
	});
});
