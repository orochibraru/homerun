import { describe, expect, test } from "bun:test";
import { agentSetupCommands } from "$lib/server/node-install-script";

describe("agentSetupCommands", () => {
	test("a release pins the installer and the image to its release tag", () => {
		const commands = agentSetupCommands("1.4.2");
		expect(commands.installer).toEndWith("--mode=agent --version=v1.4.2");
		expect(commands.docker).toEndWith("homerun-worker:v1.4.2");
	});

	test("a nightly pins its own prerelease tag", () => {
		const commands = agentSetupCommands("1.0.50-nightly.403");
		expect(commands.installer).toEndWith("--version=v1.0.50-nightly.403");
		expect(commands.docker).toEndWith("homerun-worker:v1.0.50-nightly.403");
	});

	test("a dev build falls back to latest", () => {
		const commands = agentSetupCommands("dev");
		expect(commands.installer).toEndWith("--mode=agent");
		expect(commands.docker).toEndWith("homerun-worker:latest");
	});
});
