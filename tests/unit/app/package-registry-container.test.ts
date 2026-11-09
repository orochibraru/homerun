import { describe, expect, test } from "bun:test";

import {
	PACKAGE_REGISTRY_SPECS,
	packageRegistryEnv,
	packageRegistryFileEnv,
	packageRegistryFileScript,
	packageRegistryLabels,
	packageRegistryMatches,
	verdaccioConfig,
} from "#lib/services/docker/package-registry-container.js";

const internal = { htpasswd: "ci:$2b$10$hash", publicHost: null };
const published = { htpasswd: "ci:$2b$10$hash", publicHost: "npm.example.com" };

describe("verdaccioConfig", () => {
	test("only htpasswd users get in, and nobody can sign up", () => {
		const yaml = verdaccioConfig();
		expect(yaml).toContain("file: /verdaccio/conf/htpasswd");
		expect(yaml).toContain("max_users: -1");
		expect(yaml).not.toContain("$all");
		expect(yaml).toContain("access: $authenticated");
		expect(yaml).toContain("proxy: npmjs");
	});
});

describe("packageRegistryFileScript", () => {
	test("writes every config file and the htpasswd, then hands them to the registry's user", () => {
		const script = packageRegistryFileScript("npm");
		expect(script).toContain(
			`printf '%s' "$FILE_0" > /verdaccio/conf/config.yaml`,
		);
		expect(script).toContain(
			`printf '%s' "$FILE_1" > /verdaccio/conf/htpasswd`,
		);
		expect(script).toContain("chown -R 10001:0 /verdaccio/conf");
		const env = packageRegistryFileEnv("npm", "ci:hash");
		expect(env.FILE_0).toBe(verdaccioConfig());
		expect(env.FILE_1).toBe("ci:hash\n");
	});

	test("pypiserver has no config file, only its htpasswd", () => {
		expect(packageRegistryFileScript("pypi")).toContain(
			`printf '%s' "$FILE_0" > /data/auth/htpasswd`,
		);
		expect(packageRegistryFileEnv("pypi", "")).toEqual({ FILE_0: "" });
	});

	test("pypiserver authenticates installs, listings and uploads against that file", () => {
		const cmd = PACKAGE_REGISTRY_SPECS.pypi.cmd ?? [];
		expect(cmd).toContain("/data/auth/htpasswd");
		expect(cmd[cmd.indexOf("-a") + 1]).toBe("update,download,list");
	});
});

describe("packageRegistryLabels", () => {
	test("an internal registry gets no Traefik router", () => {
		const labels = packageRegistryLabels("npm", internal);
		expect(labels["homerun.infra"]).toBe("npm-registry");
		expect(Object.keys(labels).some((key) => key.startsWith("traefik."))).toBe(
			false,
		);
	});

	test("a published registry routes its hostname to the registry's port", () => {
		const labels = packageRegistryLabels("pypi", {
			...published,
			publicHost: "pypi.example.com",
		});
		expect(labels["traefik.http.routers.homerun-pypi.rule"]).toBe(
			"Host(`pypi.example.com`)",
		);
		expect(
			labels["traefik.http.services.homerun-pypi.loadbalancer.server.port"],
		).toBe("8080");
	});
});

describe("packageRegistryMatches", () => {
	const image = "verdaccio/verdaccio:6.11.1";

	test("a container on the pinned image with the same env and labels is left alone", () => {
		expect(
			packageRegistryMatches(
				"npm",
				{
					env: [...packageRegistryEnv("npm", published), "PATH=/usr/bin"],
					image,
					labels: packageRegistryLabels("npm", published),
				},
				published,
			),
		).toBe(true);
	});

	test("an older image, a removed hostname or a changed config means a recreate", () => {
		const env = packageRegistryEnv("npm", published);
		const labels = packageRegistryLabels("npm", published);
		expect(
			packageRegistryMatches(
				"npm",
				{ env, image: "verdaccio/verdaccio:5", labels },
				published,
			),
		).toBe(false);
		expect(
			packageRegistryMatches("npm", { env, image, labels }, internal),
		).toBe(false);
		expect(
			packageRegistryMatches(
				"npm",
				{
					env: env.filter(
						(entry) => !entry.startsWith("VERDACCIO_PUBLIC_URL="),
					),
					image,
					labels: packageRegistryLabels("npm", internal),
				},
				internal,
			),
		).toBe(true);
		expect(
			packageRegistryMatches(
				"npm",
				{
					env: ["HOMERUN_PACKAGE_REGISTRY_CONFIG=stale"],
					image,
					labels: packageRegistryLabels("npm", internal),
				},
				internal,
			),
		).toBe(false);
	});

	test("the htpasswd isn't part of the match: Verdaccio and pypiserver reread it", () => {
		const env = packageRegistryEnv("pypi", internal);
		expect(
			packageRegistryMatches(
				"pypi",
				{
					env,
					image: "pypiserver/pypiserver:v2.4.2",
					labels: packageRegistryLabels("pypi", internal),
				},
				{ ...internal, htpasswd: "" },
			),
		).toBe(true);
	});
});
