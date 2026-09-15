import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { applyFlags } = await import(
	"../../../src/lib/services/docker/core-services"
);

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
