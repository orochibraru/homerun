import { describe, expect, test } from "bun:test";
import {
	ComposeParseError,
	orderByDependencies,
	parseComposeFile,
	splitImageRef,
} from "../../../src/lib/compose-import";

const COMPOSE = `
services:
  web:
    image: nginx:1.27-alpine
    restart: always
    ports:
      - "8080:80"
    environment:
      APP_ENV: production
      EMPTY:
    volumes:
      - /srv/www:/usr/share/nginx/html:ro
      - assets:/assets
    depends_on:
      - api
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 512m
  api:
    image: ghcr.io/acme/api
    expose:
      - "9000/udp"
    environment:
      - DATABASE_URL=postgres://db:5432/app
      - TOKEN=abc=def
    command: ["./serve"]
volumes:
  assets:
`;

describe("parseComposeFile", () => {
	const plan = parseComposeFile(COMPOSE);
	const web = plan.services.find((s) => s.key === "web");
	const api = plan.services.find((s) => s.key === "api");

	test("maps every compose service", () => {
		expect(
			plan.services.map((s) => s.key).sort((a, b) => a.localeCompare(b)),
		).toEqual(["api", "web"]);
	});

	test("splits image and tag, defaulting the tag", () => {
		expect(web?.image).toBe("nginx");
		expect(web?.tag).toBe("1.27-alpine");
		expect(api?.image).toBe("ghcr.io/acme/api");
		expect(api?.tag).toBe("latest");
	});

	test("takes the container side of a port mapping", () => {
		expect(web?.containerPort).toBe(80);
		expect(web?.portProtocol).toBe("tcp");
		expect(api?.containerPort).toBe(9000);
		expect(api?.portProtocol).toBe("udp");
	});

	test("only publishes services that published a host port", () => {
		expect(web?.dnsResolvable).toBe(true);
		expect(api?.dnsResolvable).toBe(false);
	});

	test("reads both environment shapes", () => {
		expect(web?.envVars).toEqual({ APP_ENV: "production", EMPTY: "" });
		expect(api?.envVars.DATABASE_URL).toBe("postgres://db:5432/app");
		expect(api?.envVars.TOKEN).toBe("abc=def");
	});

	test("maps bind mounts and named volumes", () => {
		expect(web?.volumes).toEqual([
			{
				containerPath: "/usr/share/nginx/html",
				kind: "bind",
				name: "web-usr-share-nginx-html",
				readOnly: true,
				source: "/srv/www",
			},
			{
				containerPath: "/assets",
				kind: "volume",
				name: "assets",
				readOnly: false,
				source: "assets",
			},
		]);
		expect(plan.volumeNames).toEqual(["assets"]);
	});

	test("maps restart policy and resource limits", () => {
		expect(web?.restartPolicy).toBe("always");
		expect(web?.cpuLimit).toBe("0.5");
		expect(web?.memoryLimitMb).toBe(512);
		expect(api?.restartPolicy).toBe("unless-stopped");
	});

	test("warns about what it can't reproduce", () => {
		expect(api?.warnings.some((w) => w.startsWith("command:"))).toBe(true);
		expect(web?.warnings.some((w) => w.includes("Host port mappings"))).toBe(
			true,
		);
	});

	test("rejects input that isn't a compose file", () => {
		expect(() => parseComposeFile("just a string")).toThrow(ComposeParseError);
		expect(() => parseComposeFile("services: {}")).toThrow(ComposeParseError);
		expect(() => parseComposeFile("a: [")).toThrow(ComposeParseError);
	});

	test("skips relative bind mounts it can't resolve", () => {
		const relative = parseComposeFile(
			'services:\n  app:\n    image: redis\n    volumes:\n      - "./data:/data"\n',
		);
		expect(relative.services[0]?.volumes).toEqual([]);
		expect(
			relative.services[0]?.warnings.some((w) => w.includes("relative")),
		).toBe(true);
	});

	test("de-duplicates slugs across services", () => {
		const dupes = parseComposeFile(
			"services:\n  web:\n    image: nginx\n    container_name: web\n  web-2:\n    image: nginx\n    container_name: web\n",
		);
		expect(dupes.services.map((s) => s.slug)).toEqual(["web", "web-2"]);
	});

	test("maps network_mode host", () => {
		const host = parseComposeFile(
			"services:\n  ha:\n    image: homeassistant\n    network_mode: host\n",
		);
		expect(host.services[0]?.networkMode).toBe("host");
		expect(host.services[0]?.dnsResolvable).toBe(false);
	});
});

describe("orderByDependencies", () => {
	test("puts a dependency before its dependent", () => {
		const plan = parseComposeFile(COMPOSE);
		expect(orderByDependencies(plan.services).map((s) => s.key)).toEqual([
			"api",
			"web",
		]);
	});

	test("survives a dependency cycle", () => {
		const plan = parseComposeFile(
			"services:\n  a:\n    image: a\n    depends_on: [b]\n  b:\n    image: b\n    depends_on: [a]\n",
		);
		expect(orderByDependencies(plan.services)).toHaveLength(2);
	});
});

describe("splitImageRef", () => {
	test("handles a registry port and a digest", () => {
		expect(splitImageRef("localhost:5000/app")).toEqual({
			image: "localhost:5000/app",
			tag: "latest",
		});
		expect(splitImageRef("localhost:5000/app:v2")).toEqual({
			image: "localhost:5000/app",
			tag: "v2",
		});
		expect(splitImageRef("redis@sha256:abc")).toEqual({
			image: "redis",
			tag: "latest",
		});
	});
});
