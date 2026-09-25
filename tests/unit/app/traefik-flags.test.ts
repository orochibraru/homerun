import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const {
	applyFlags,
	expectedTraefikFlags,
	infraContainersFrom,
	missingTraefikFlags,
} = await import("../../../src/lib/services/docker/core-services");

const CMD = [
	"--providers.docker=true",
	"--providers.docker.exposedbydefault=false",
	"--entrypoints.web.address=:80",
	"--certificatesresolvers.letsencrypt.acme.email=old@example.com",
];

describe("applyFlags", () => {
	test("replaces a flag in place of appending a second copy", () => {
		const next = applyFlags(CMD, {
			"certificatesresolvers.letsencrypt.acme.email": "new@example.com",
		});
		expect(next.filter((arg) => arg.includes("acme.email"))).toEqual([
			"--certificatesresolvers.letsencrypt.acme.email=new@example.com",
		]);
		expect(next).toHaveLength(CMD.length);
	});

	test("appends a flag the command line didn't carry", () => {
		const next = applyFlags(CMD, { "providers.swarm": "true" });
		expect(next).toHaveLength(CMD.length + 1);
		expect(next.at(-1)).toBe("--providers.swarm=true");
	});

	test("a null value removes the flag, including the bare --flag spelling", () => {
		const next = applyFlags(
			[...CMD, "--providers.swarm", "--api.dashboard=true"],
			{
				"providers.swarm": null,
			},
		);
		expect(next.some((arg) => arg.startsWith("--providers.swarm"))).toBe(false);
		expect(next).toContain("--api.dashboard=true");
	});

	test("leaves a flag whose key is only a prefix of another alone", () => {
		const next = applyFlags(CMD, { "providers.docker": "false" });
		expect(next).toContain("--providers.docker.exposedbydefault=false");
		expect(next).toContain("--providers.docker=false");
	});
});

describe("Traefik drift", () => {
	const everything = expectedTraefikFlags({
		acmeEmail: "me@example.com",
		certResolver: "letsencrypt",
		httpCache: true,
		swarm: true,
	});

	test("a Traefik recreated from the compose file misses what the settings added", () => {
		expect(missingTraefikFlags(CMD, everything)).toEqual([
			"the swarm provider",
			"the HTTP cache plugin",
			"the ACME email",
		]);
	});

	test("the flags as Homerun or compose.swarm.yaml write them count as present", () => {
		const cmd = [
			...CMD.filter((arg) => !arg.includes("acme.email")),
			"--providers.swarm",
			"--providers.swarm.exposedByDefault=false",
			"--providers.swarm.network=homerun-swarm",
			"--providers.swarm.refreshSeconds=2",
			"--experimental.plugins.souin.modulename=github.com/darkweak/souin",
			"--experimental.plugins.souin.version=v1.7.9",
			"--certificatesresolvers.letsencrypt.acme.email=me@example.com",
		];
		expect(missingTraefikFlags(cmd, everything)).toEqual([]);
	});

	test("a setting that's off expects nothing, and an old value is drift", () => {
		expect(
			expectedTraefikFlags({
				acmeEmail: null,
				certResolver: "letsencrypt",
				httpCache: false,
				swarm: false,
			}),
		).toEqual({});
		expect(
			missingTraefikFlags(
				CMD,
				expectedTraefikFlags({
					acmeEmail: "new@example.com",
					certResolver: "letsencrypt",
					httpCache: false,
					swarm: false,
				}),
			),
		).toEqual(["the ACME email"]);
	});
});

describe("infraContainersFrom", () => {
	const container = (name: string, labels: Record<string, string>) => ({
		Id: `${name}-id`,
		Image: "img",
		Labels: labels,
		Names: [`/${name}`],
		State: "running",
	});
	const listed = [
		container("homerun-app-1", { "com.docker.compose.project": "homerun" }),
		container("homerun-traefik-1", { "com.docker.compose.project": "homerun" }),
		container("newt", { "com.docker.compose.project": "dokploy" }),
		container("trigger-webapp", { "com.docker.compose.project": "trigger" }),
		container("homerun-newt", { "homerun.core": "newt" }),
		container("my-app", {
			"com.docker.compose.project": "homerun",
			"homerun.managed": "true",
		}),
	];

	test("only its own compose project and its core containers, never a deployed service", () => {
		expect(
			infraContainersFrom(listed as never, "homerun").map((c) => c.name),
		).toEqual(["homerun-app-1", "homerun-newt", "homerun-traefik-1"]);
	});

	test("with no known project, any compose container counts", () => {
		expect(infraContainersFrom(listed as never, null)).toHaveLength(5);
	});
});

describe("applyFlags on a Traefik that already has them", () => {
	const live = [
		"--providers.docker=true",
		"--providers.docker.exposedbydefault=false",
		"--providers.docker.network=homerun",
		"--providers.file.directory=/etc/traefik/dynamic",
		"--providers.file.watch=true",
		"--entrypoints.web.address=:80",
		"--entrypoints.websecure.address=:443",
		"--certificatesresolvers.letsencrypt.acme.httpchallenge=true",
		"--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web",
		"--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json",
		"--providers.swarm=true",
		"--providers.swarm.exposedByDefault=false",
		"--providers.swarm.network=homerun-swarm",
		"--providers.swarm.refreshSeconds=2",
		"--experimental.plugins.souin.modulename=github.com/darkweak/souin",
		"--experimental.plugins.souin.version=v1.7.9",
		"--certificatesresolvers.letsencrypt.acme.email=me@example.com",
	];

	test("comes back identical, so nothing gets recreated on boot", () => {
		const groups = expectedTraefikFlags({
			acmeEmail: "me@example.com",
			certResolver: "letsencrypt",
			httpCache: true,
			swarm: true,
		});
		for (const flags of Object.values(groups)) {
			expect(applyFlags(live, flags)).toEqual(live);
		}
		expect(
			applyFlags(["--providers.swarm", "--x=1"], { "providers.swarm": "true" }),
		).toEqual(["--providers.swarm", "--x=1"]);
	});

	test("a changed value is replaced where it stands, a new one appended", () => {
		expect(
			applyFlags(["--a=1", "--b=2", "--c=3"], { b: "9", d: "4", a: null }),
		).toEqual(["--b=9", "--c=3", "--d=4"]);
	});
});
