import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyInstanceSettings,
	config,
	firstNonBlank,
	isPlaceholderAuthSecret,
	parseConfig,
	yamlConfigSchema,
} from "../../../src/lib/config";

const saved = {
	AUTH_SECRET: Bun.env.AUTH_SECRET,
	BETTER_AUTH_SECRET: Bun.env.BETTER_AUTH_SECRET,
	CONFIG_FILE: Bun.env.CONFIG_FILE,
	ORIGIN: Bun.env.ORIGIN,
	TRAEFIK_DYNAMIC_CONFIG_DIR: Bun.env.TRAEFIK_DYNAMIC_CONFIG_DIR,
};

function setEnv(name: keyof typeof saved, value: string | undefined) {
	if (value === undefined) {
		delete Bun.env[name];
	} else {
		Bun.env[name] = value;
	}
}

afterEach(() => {
	for (const [name, value] of Object.entries(saved)) {
		setEnv(name as keyof typeof saved, value);
	}
	applyInstanceSettings({});
});

describe("firstNonBlank", () => {
	test("skips unset, empty and whitespace-only values", () => {
		expect(firstNonBlank(undefined, "", "  ", "real")).toBe("real");
		expect(firstNonBlank("", " \t")).toBeUndefined();
		expect(firstNonBlank()).toBeUndefined();
	});
});

describe("auth secret", () => {
	test("an empty AUTH_SECRET falls through to BETTER_AUTH_SECRET", () => {
		setEnv("AUTH_SECRET", "");
		setEnv("BETTER_AUTH_SECRET", "from-better-auth");
		expect(parseConfig().auth.secret).toBe("from-better-auth");
	});

	test("both blank falls back to the placeholder, which is flagged", () => {
		setEnv("AUTH_SECRET", "   ");
		setEnv("BETTER_AUTH_SECRET", "");
		const secret = parseConfig().auth.secret;
		expect(secret).toBe("default-secret");
		expect(isPlaceholderAuthSecret(secret)).toBe(true);
	});

	test("a real secret isn't flagged, a blank one is", () => {
		expect(isPlaceholderAuthSecret("a-real-secret")).toBe(false);
		expect(isPlaceholderAuthSecret("")).toBe(true);
		expect(isPlaceholderAuthSecret(" ")).toBe(true);
		expect(isPlaceholderAuthSecret(undefined)).toBe(true);
	});

	test("an empty ORIGIN counts as unset", () => {
		setEnv("ORIGIN", "");
		expect(parseConfig().auth.origin).toBeUndefined();
	});
});

describe("traefik.dynamicConfigDir", () => {
	test("falls back to TRAEFIK_DYNAMIC_CONFIG_DIR when the file doesn't set it", () => {
		setEnv("CONFIG_FILE", join(tmpdir(), "homerun-missing-config.yaml"));
		setEnv("TRAEFIK_DYNAMIC_CONFIG_DIR", "/app/traefik-dynamic");
		expect(parseConfig().traefik.dynamicConfigDir).toBe("/app/traefik-dynamic");
	});

	test("the config file wins over the env var", () => {
		const dir = mkdtempSync(join(tmpdir(), "homerun-config-"));
		const file = join(dir, "homerun.yaml");
		writeFileSync(file, "traefik:\n  dynamicConfigDir: /from/file\n");
		setEnv("CONFIG_FILE", file);
		setEnv("TRAEFIK_DYNAMIC_CONFIG_DIR", "/from/env");
		expect(parseConfig().traefik.dynamicConfigDir).toBe("/from/file");
	});

	test("a blank env var counts as unset", () => {
		setEnv("CONFIG_FILE", join(tmpdir(), "homerun-missing-config.yaml"));
		setEnv("TRAEFIK_DYNAMIC_CONFIG_DIR", " ");
		expect(parseConfig().traefik.dynamicConfigDir).toBeUndefined();
	});
});

describe("auth.oauthProviders", () => {
	test("isn't part of the YAML schema", () => {
		expect(
			Object.keys(yamlConfigSchema.shape.auth.unwrap().shape),
		).not.toContain("oauthProviders");
	});

	test("a leftover file value is ignored, the DB list is what applies", () => {
		const dir = mkdtempSync(join(tmpdir(), "homerun-config-"));
		const file = join(dir, "homerun.yaml");
		writeFileSync(
			file,
			[
				"auth:",
				"  oauthProviders:",
				"    - name: from-file",
				"      clientId: id",
				"      clientSecret: secret",
				"      discoveryUrl: https://idp.example.com/.well-known/openid-configuration",
			].join("\n"),
		);
		setEnv("CONFIG_FILE", file);
		expect(parseConfig().auth.oauthProviders).toEqual([]);

		applyInstanceSettings({ oauthProviders: [] });
		expect(config.auth.oauthProviders).toEqual([]);
	});
});
