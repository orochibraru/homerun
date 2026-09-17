import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { ClientFactory } from "../../../packages/cli/client";
import { ConfigStore } from "../../../packages/cli/config";
import { LoginFlow } from "../../../packages/cli/login";

type Client = ReturnType<typeof ClientFactory.makeClient>;

function fakeDeleteClient(overrides: { DELETE?: ReturnType<typeof mock> }) {
	return {
		DELETE: overrides.DELETE ?? mock(),
	} as unknown as Client;
}

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

	test("says so when not logged in, without touching the filesystem or the network", async () => {
		ConfigStore.clearStoredConfig();
		const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
		const fetchSpy = spyOn(globalThis, "fetch");

		await LoginFlow.logout();

		expect(logSpy).toHaveBeenCalledWith("Not logged in.");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	test("revokes the API key on the server, then clears the local config", async () => {
		ConfigStore.writeStoredConfig({
			apiKey: "k",
			baseUrl: "https://h.example.com",
		});
		const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
		const DELETE = mock(async () => ({
			data: { success: true },
			error: undefined,
			response: { ok: true, status: 200 },
		}));
		spyOn(ClientFactory, "makeClient").mockReturnValue(
			fakeDeleteClient({ DELETE }),
		);

		await LoginFlow.logout();

		expect(DELETE).toHaveBeenCalledWith("/auth-token", {});
		expect(logSpy).toHaveBeenCalledWith(
			"Logged out of https://h.example.com and revoked the API key.",
		);
		expect(ConfigStore.readStoredConfig()).toBeNull();
	});

	test("still clears the local config when the server rejects the revoke", async () => {
		ConfigStore.writeStoredConfig({
			apiKey: "k",
			baseUrl: "https://h.example.com",
		});
		const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
		const DELETE = mock(async () => ({
			data: undefined,
			error: { error: "Unauthorized" },
			response: { ok: false, status: 401 },
		}));
		spyOn(ClientFactory, "makeClient").mockReturnValue(
			fakeDeleteClient({ DELETE }),
		);

		await LoginFlow.logout();

		expect(logSpy).toHaveBeenCalledWith(
			"Logged out of https://h.example.com. Couldn't revoke the API key on the server (it may already be invalid, or the server is unreachable) : cleared the local config anyway.",
		);
		expect(ConfigStore.readStoredConfig()).toBeNull();
	});

	test("still clears the local config when the server is unreachable", async () => {
		ConfigStore.writeStoredConfig({
			apiKey: "k",
			baseUrl: "https://h.example.com",
		});
		const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
		const DELETE = mock(async () => {
			throw new Error("fetch failed");
		});
		spyOn(ClientFactory, "makeClient").mockReturnValue(
			fakeDeleteClient({ DELETE }),
		);

		await LoginFlow.logout();

		expect(logSpy).toHaveBeenCalledWith(
			"Logged out of https://h.example.com. Couldn't revoke the API key on the server (it may already be invalid, or the server is unreachable) : cleared the local config anyway.",
		);
		expect(ConfigStore.readStoredConfig()).toBeNull();
	});
});
