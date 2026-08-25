import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { ConfigStore } from "../../../packages/cli/config";
import { LoginFlow } from "../../../packages/cli/login";

// See tests/cli/config.test.ts for why : logout() reads/clears the real
// on-disk config path, which needs the same mocked-homedir guarantee (see
// tests/support/homedir-preload.ts).
if (!homedir().startsWith(tmpdir())) {
	throw new Error(
		"os.homedir() isn't mocked to a scratch directory : refusing to risk " +
			`touching the real ${ConfigStore.configPath()}. Check bunfig.toml's ` +
			"[test].preload.",
	);
}

// `LoginFlow.login()` itself is intentionally not covered here : it's an
// interactive device-code flow (readline prompts, real polling `fetch`
// calls against whatever instance the user points it at), not
// unit-testable without reimplementing most of node:readline and the CLI's
// own network layer. Same "flagged, not faked" posture this repo takes with
// agent/installer's own unverified-by-necessity flows (see CLAUDE.md).

describe("LoginFlow.logout", () => {
	afterEach(() => {
		mock.restore();
		ConfigStore.clearStoredConfig();
	});

	test("says so when not logged in, without touching the filesystem", () => {
		ConfigStore.clearStoredConfig();
		const logSpy = spyOn(console, "log").mockImplementation(() => undefined);

		LoginFlow.logout();

		expect(logSpy).toHaveBeenCalledWith("Not logged in.");
	});

	test("clears the stored config and reports the instance logged out of", () => {
		ConfigStore.writeStoredConfig({
			apiKey: "k",
			baseUrl: "https://h.example.com",
		});
		const logSpy = spyOn(console, "log").mockImplementation(() => undefined);

		LoginFlow.logout();

		expect(logSpy).toHaveBeenCalledWith("Logged out of https://h.example.com.");
	});
});
