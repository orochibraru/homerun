import { describe, expect, test } from "bun:test";
import { agentSetupCommands } from "$lib/server/node-install-script";

describe("agentSetupCommands", () => {
	test("a release pins the installer tag and the bare image version", () => {
		const commands = agentSetupCommands("1.4.2");
		expect(commands.installer).toEndWith("--mode=agent --version=v1.4.2");
		expect(commands.docker).toEndWith("homerun-worker:1.4.2");
	});

	test("a dev build falls back to latest", () => {
		const commands = agentSetupCommands("dev");
		expect(commands.installer).toEndWith("--mode=agent");
		expect(commands.docker).toEndWith("homerun-worker:latest");
	});
});
