import { describe, expect, test } from "bun:test";
import {
	parseSyncedExtensions,
	parseSyncedSettings,
} from "../../../src/lib/services/vscode-settings-sync";

function body(version: number, entries: unknown[]): string {
	return JSON.stringify({
		content: JSON.stringify(entries),
		machineId: "m",
		version,
	});
}

describe("parseSyncedExtensions", () => {
	test("keeps enabled, user-installed extensions, lowercased and deduplicated", () => {
		const ids = parseSyncedExtensions(
			body(6, [
				{ identifier: { id: "Esbenp.Prettier-VSCode" }, installed: true },
				{ identifier: { id: "esbenp.prettier-vscode" }, installed: true },
				{ identifier: { id: "golang.go" }, installed: true, disabled: true },
				{ identifier: { id: "vscode.git" }, disabled: true },
				{ identifier: { id: "ms-python.python" } },
			]),
		);
		expect(ids).toEqual(["esbenp.prettier-vscode"]);
	});

	test("keeps every enabled entry from pre-v3 data, which has no installed flag", () => {
		const ids = parseSyncedExtensions(
			body(2, [
				{ identifier: { id: "golang.go" } },
				{ disabled: true, identifier: { id: "rust-lang.rust-analyzer" } },
			]),
		);
		expect(ids).toEqual(["golang.go"]);
	});

	test("an empty body means nothing was synced", () => {
		expect(parseSyncedExtensions("")).toEqual([]);
	});

	test("throws on something that isn't sync data", () => {
		expect(() => parseSyncedExtensions('{"nope":true}')).toThrow();
	});
});

describe("parseSyncedSettings", () => {
	test("unwraps the settings file and strips its JSONC", () => {
		const settings = parseSyncedSettings(
			JSON.stringify({
				content: JSON.stringify({
					settings:
						'{\n  // theme\n  "workbench.colorTheme": "Dark+",\n  "http.proxy": "http://x",\n}',
				}),
				version: 1,
			}),
		);
		expect(settings).toEqual({
			"http.proxy": "http://x",
			"workbench.colorTheme": "Dark+",
		});
	});

	test("reads legacy content that is the file itself", () => {
		expect(
			parseSyncedSettings(
				JSON.stringify({ content: '{"editor.tabSize": 2}', version: 1 }),
			),
		).toEqual({ "editor.tabSize": 2 });
	});

	test("nothing synced, or an empty file, is null", () => {
		expect(parseSyncedSettings("")).toBeNull();
		expect(
			parseSyncedSettings(
				JSON.stringify({
					content: JSON.stringify({ settings: "{}" }),
					version: 1,
				}),
			),
		).toBeNull();
	});
});
