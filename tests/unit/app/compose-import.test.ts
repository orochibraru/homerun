import { describe, expect, test } from "bun:test";
import {
	ComposeParseError,
	orderByDependencies,
	parseComposeFile,
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

	test("routes the main port through Traefik rather than publishing it", () => {
		expect(web?.publishedPorts).toEqual([]);
		expect(api?.publishedPorts).toEqual([]);
	});

	test("publishes every other host mapping, UDP and long form included", () => {
		const gitea = parseComposeFile(`
services:
  gitea:
    image: gitea/gitea
    ports:
      - "3000:3000"
      - "2222:22"
      - "127.0.0.1:2222:22"
  vpn:
    image: kylemanna/openvpn
    ports:
      - target: 1194
        published: 1194
        protocol: udp
      - "7000-7010:7000-7010"
`).services;
		expect(gitea.find((s) => s.key === "gitea")?.publishedPorts).toEqual([
			{ containerPort: 22, hostPort: 2222, protocol: "tcp" },
		]);
		expect(gitea.find((s) => s.key === "vpn")?.publishedPorts).toEqual([
			{ containerPort: 1194, hostPort: 1194, protocol: "udp" },
		]);
	});

	test("maps the command instead of warning about it", () => {
		expect(api?.command).toEqual(["./serve"]);
		expect(api?.warnings.some((w) => w.startsWith("command:"))).toBe(false);
		expect(web?.command).toBeNull();
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

describe("build:", () => {
	test("maps compose's git-context syntax onto a git-based service", () => {
		const plan = parseComposeFile(`
services:
  api:
    build: https://github.com/acme/api.git#main:backend
    ports: ["8080:8080"]
`);
		const api = plan.services[0];
		expect(api.build).toEqual({
			context: "backend",
			dockerfile: null,
			gitRef: "main",
			gitUrl: "https://github.com/acme/api.git",
		});
		expect(api.warnings.join(" ")).not.toContain("Source tab");
	});

	test("reads the object form, including a custom dockerfile", () => {
		const plan = parseComposeFile(`
services:
  api:
    build:
      context: https://github.com/acme/api.git
      dockerfile: docker/Dockerfile.prod
`);
		expect(plan.services[0].build).toEqual({
			context: null,
			dockerfile: "docker/Dockerfile.prod",
			gitRef: null,
			gitUrl: "https://github.com/acme/api.git",
		});
	});

	test("a local path has nothing to clone, so it says so instead of failing", () => {
		const plan = parseComposeFile(`
services:
  api:
    build: ./api
`);
		const api = plan.services[0];
		expect(api.build).toEqual({
			context: "./api",
			dockerfile: null,
			gitRef: null,
			gitUrl: null,
		});
		expect(api.warnings[0]).toContain("./api");
		expect(api.warnings[0]).toContain("Source tab");
	});

	test("a service with no build section stays image-based", () => {
		const plan = parseComposeFile(`
services:
  cache:
    image: redis:alpine
`);
		expect(plan.services[0].build).toBeNull();
	});
});

describe("runtime options", () => {
	const RUNTIME = `
services:
  ha:
    image: homeassistant/home-assistant
    entrypoint: /init
    command: python3 -m homeassistant --config "/config dir"
    privileged: true
    cap_add: [NET_ADMIN, SYS_TIME]
    devices:
      - /dev/ttyUSB0:/dev/zigbee
      - source: /dev/dri
        target: /dev/dri
        permissions: rw
    labels:
      com.example.team: home
      traefik.enable: "true"
    env_file:
      - ./ha.env
      - path: ./optional.env
        required: false
      - /opt/ha/secrets.env
    environment:
      TZ: Europe/Paris
`;

	test("maps entrypoint, command, capabilities, devices and privileged", () => {
		const ha = parseComposeFile(RUNTIME).services[0];
		expect(ha?.entrypoint).toEqual(["/init"]);
		expect(ha?.command).toEqual([
			"python3",
			"-m",
			"homeassistant",
			"--config",
			"/config dir",
		]);
		expect(ha?.privileged).toBe(true);
		expect(ha?.capAdd).toEqual(["NET_ADMIN", "SYS_TIME"]);
		expect(ha?.devices).toEqual([
			"/dev/ttyUSB0:/dev/zigbee",
			"/dev/dri:/dev/dri:rw",
		]);
	});

	test("keeps custom labels and drops Traefik's with a warning", () => {
		const ha = parseComposeFile(RUNTIME).services[0];
		expect(ha?.labels).toEqual({ "com.example.team": "home" });
		expect(ha?.warnings.some((w) => w.includes("Traefik"))).toBe(true);
	});

	test("an env_file that wasn't supplied: absolute is read at deploy, relative is missing", () => {
		const plan = parseComposeFile(RUNTIME);
		const ha = plan.services[0];
		expect(ha?.envFiles).toEqual(["/opt/ha/secrets.env"]);
		expect(ha?.missingEnvFiles).toEqual(["./ha.env"]);
		expect(plan.missingEnvFiles).toEqual(["./ha.env"]);
		expect(ha?.envVars).toEqual({ TZ: "Europe/Paris" });
	});

	test("a supplied env_file becomes variables, environment winning", () => {
		const ha = parseComposeFile(RUNTIME, {
			envFiles: { "ha.env": "TZ=UTC\nexport TOKEN='abc'\n# note" },
		}).services[0];
		expect(ha?.envVars).toEqual({ TOKEN: "abc", TZ: "Europe/Paris" });
		expect(ha?.missingEnvFiles).toEqual([]);
	});
});
