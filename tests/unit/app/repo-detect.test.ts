import { describe, expect, test } from "bun:test";

import { emptyDetected } from "../../../src/lib/image-config";
import { sniffRepo, withSniff } from "../../../src/lib/repo-detect";

describe("sniffRepo", () => {
	test("a Bake file builds with Bake", () => {
		expect(sniffRepo("docker-bake.hcl", "")?.method).toBe("bake");
	});

	test("a Node project names its framework, port and package", () => {
		expect(
			sniffRepo(
				"web/package.json",
				JSON.stringify({ dependencies: { astro: "5" }, name: "site" }),
			),
		).toEqual({
			method: "railpack",
			name: "site",
			port: 4321,
			reason: "package.json found, no Dockerfile",
			runtime: "Node.js (Astro)",
		});
		expect(sniffRepo("package.json", "{ nope")?.runtime).toBe("Node.js");
	});

	test("Go and Python frameworks", () => {
		const go = sniffRepo(
			"go.mod",
			"module github.com/acme/api\n\nrequire github.com/go-chi/chi/v5 v5.0.0\n",
		);
		expect(go?.runtime).toBe("Go (chi)");
		expect(go?.name).toBe("api");
		const py = sniffRepo("requirements.txt", "Django==5.1\n");
		expect(py?.runtime).toBe("Python (Django)");
		expect(py?.port).toBe(8000);
	});

	test("an unknown file", () => {
		expect(sniffRepo("README.md", "")).toBeNull();
	});
});

describe("withSniff", () => {
	const sniff = {
		method: "railpack" as const,
		name: "site",
		port: 3000,
		reason: "package.json found, no Dockerfile",
		runtime: "Node.js (Next.js)",
	};

	test("fills what nothing else declared", () => {
		const config = withSniff(emptyDetected("repository"), sniff, true);
		expect(config.build?.method).toBe("railpack");
		expect(config.ports).toEqual([{ port: 3000, protocol: "tcp" }]);
		expect(config.prefill.name).toBe("site");
	});

	test("never overrides a declared port or name, nor suggests when told not to", () => {
		const base = {
			...emptyDetected("manifest"),
			ports: [{ port: 8080, protocol: "tcp" as const }],
			prefill: { name: "Storefront" },
		};
		const config = withSniff(base, sniff, false);
		expect(config.build).toBeNull();
		expect(config.ports).toEqual([{ port: 8080, protocol: "tcp" }]);
		expect(config.prefill.name).toBe("Storefront");
		expect(config.runtime).toBe("Node.js (Next.js)");
	});
});
