import { describe, expect, test } from "bun:test";
import {
	baseDomainFromConfig,
	copyableVolumes,
	envValue,
	holdsDataElsewhere,
	hostFromCompose,
	rootfulConfig,
	SWITCH_TO_SWARM_SQL,
	volumeCopyScript,
	volumeCreateCommand,
} from "../../../packages/installer/steps/migrate-rootful";

describe("copyableVolumes", () => {
	test("keeps named volumes and drops anonymous ones and blanks", () => {
		expect(
			copyableVolumes([
				"homerun_postgres-data",
				"a".repeat(64),
				"",
				" e2e-marker ",
			]),
		).toEqual(["homerun_postgres-data", "e2e-marker"]);
	});
});

function originDefault(url: string): string {
	return ["ORIGIN: $", "{ORIGIN:-", url, "}"].join("");
}

describe("hostFromCompose", () => {
	test("reads the host an installer compose file bakes into ORIGIN", () => {
		expect(
			hostFromCompose(
				`      ${originDefault("http://192.168.1.20:3000")}\n      DOCKER_SOCKET_PATH: /run/user/1000/docker.sock`,
			),
		).toBe("192.168.1.20");
		expect(hostFromCompose(originDefault("https://homerun.example.com"))).toBe(
			"homerun.example.com",
		);
	});

	test("ignores a loopback origin and a file without one", () => {
		expect(hostFromCompose(originDefault("http://localhost:3000"))).toBe(null);
		expect(hostFromCompose("services: {}")).toBe(null);
	});
});

describe("baseDomainFromConfig", () => {
	test("reads baseDomain and ignores loopback", () => {
		expect(
			baseDomainFromConfig("baseDomain: apps.example.com\ndocker:\n"),
		).toBe("apps.example.com");
		expect(baseDomainFromConfig("baseDomain: localhost\n")).toBe(null);
	});
});

describe("rootfulConfig", () => {
	test("points socketPath at the system daemon and keeps everything else", () => {
		const config =
			"baseDomain: example.com\ndocker:\n  networkName: homerun\n  socketPath: /run/user/1000/docker.sock\ntraefik:\n  dynamicConfigDir: /app/traefik-dynamic\n";
		expect(rootfulConfig(config)).toBe(
			"baseDomain: example.com\ndocker:\n  networkName: homerun\n  socketPath: /var/run/docker.sock\ntraefik:\n  dynamicConfigDir: /app/traefik-dynamic\n",
		);
	});

	test("leaves a config without socketPath alone", () => {
		expect(rootfulConfig("baseDomain: example.com\n")).toBe(
			"baseDomain: example.com\n",
		);
	});
});

describe("envValue", () => {
	test("reads a value, unquoted, and null when missing", () => {
		const env = 'AUTH_SECRET=abc\nPOSTGRES_USER="app"\n';
		expect(envValue(env, "POSTGRES_USER")).toBe("app");
		expect(envValue(env, "AUTH_SECRET")).toBe("abc");
		expect(envValue(env, "POSTGRES_DB")).toBe(null);
	});
});

describe("volumeCreateCommand", () => {
	test("carries the driver, labels and options over", () => {
		expect(
			volumeCreateCommand({
				Driver: "local",
				Labels: {
					"com.docker.compose.project": "homerun",
					"com.docker.compose.volume": "postgres-data",
				},
				Name: "homerun_postgres-data",
				Options: null,
			}),
		).toEqual([
			"docker",
			"volume",
			"create",
			"--driver",
			"local",
			"--label",
			"com.docker.compose.project=homerun",
			"--label",
			"com.docker.compose.volume=postgres-data",
			"homerun_postgres-data",
		]);
	});

	test("passes driver options through", () => {
		expect(
			volumeCreateCommand({
				Driver: "local",
				Labels: null,
				Name: "media",
				Options: { device: "/srv/media", o: "bind", type: "none" },
			}),
		).toEqual([
			"docker",
			"volume",
			"create",
			"--driver",
			"local",
			"--opt",
			"device=/srv/media",
			"--opt",
			"o=bind",
			"--opt",
			"type=none",
			"media",
		]);
	});
});

describe("holdsDataElsewhere", () => {
	test("is true only for a volume backed by a device path", () => {
		const volume = { Driver: "local", Labels: null, Name: "media" };
		expect(
			holdsDataElsewhere({ ...volume, Options: { device: "/srv/media" } }),
		).toBe(true);
		expect(holdsDataElsewhere({ ...volume, Options: null })).toBe(false);
	});
});

describe("volumeCopyScript", () => {
	test("streams the volume between the two daemons with numeric ownership", () => {
		const script = volumeCopyScript(
			"homerun_postgres-data",
			"/run/user/1000/docker.sock",
		);
		expect(script).toContain("set -euo pipefail");
		expect(script).toContain(
			"docker -H unix:///run/user/1000/docker.sock run --rm -v homerun_postgres-data:/from:ro alpine:3 tar -C /from --numeric-owner -cf - .",
		);
		expect(script).toContain(
			"docker -H unix:///var/run/docker.sock run --rm -i -v homerun_postgres-data:/to alpine:3 tar -C /to --numeric-owner -xf -",
		);
	});
});

describe("SWITCH_TO_SWARM_SQL", () => {
	test("stores swarm, requests the redeploy and drops a rootless socket override", () => {
		expect(SWITCH_TO_SWARM_SQL).toContain("orchestration_mode = 'swarm'");
		expect(SWITCH_TO_SWARM_SQL).toContain("pending_service_redeploy = true");
		expect(SWITCH_TO_SWARM_SQL).toContain("LIKE '/run/user/%'");
	});
});
