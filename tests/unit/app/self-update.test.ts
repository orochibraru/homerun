import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	composeEnvDefaults,
	composeTargetFrom,
	containerIdFromMountinfo,
	pinnedTagFor,
	splitImageRef,
	updaterBinds,
	updaterScript,
} from "../../../src/lib/services/self-update/compose-target";
import {
	compareVersions,
	isNewerVersion,
	normalizeVersion,
} from "../../../src/lib/services/self-update/version";
import {
	isUpdateChannel,
	type UpdateChannel,
} from "../../../src/lib/update-channel";

const labels = {
	"com.docker.compose.project": "homerun",
	"com.docker.compose.project.config_files":
		"/home/homerun/homerun/compose.yaml",
	"com.docker.compose.project.working_dir": "/home/homerun/homerun",
	"com.docker.compose.service": "app",
};

describe("version comparison", () => {
	test("orders by major, minor, then patch", () => {
		expect(compareVersions("1.0.22", "1.0.21")).toBe(1);
		expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
		expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
		expect(compareVersions("1.0.21", "1.0.21")).toBe(0);
	});

	test("accepts a leading v on either side", () => {
		expect(compareVersions("v1.0.22", "1.0.21")).toBe(1);
		expect(isNewerVersion("v1.0.21", "1.0.21")).toBe(false);
		expect(normalizeVersion("v1.0.22")).toBe("1.0.22");
	});

	test("ranks a prerelease below its release", () => {
		expect(compareVersions("1.1.0-beta.2", "1.1.0")).toBe(-1);
		expect(compareVersions("1.1.0-beta.10", "1.1.0-beta.2")).toBe(1);
		expect(compareVersions("1.0.41-canary.100", "1.0.41-canary.99")).toBe(1);
		expect(isNewerVersion("1.0.41", "1.0.41-canary.100")).toBe(true);
		expect(isNewerVersion("1.0.40", "1.0.41-canary.100")).toBe(false);
		expect(isNewerVersion("1.0.41-canary.101", "1.0.41-nightly.100")).toBe(
			true,
		);
		expect(compareVersions("1.0.41-canary.100", "1.0.41-nightly.100")).toBe(0);
		expect(isNewerVersion("1.0.41-nightly.9", "1.0.41-canary.10")).toBe(false);
	});

	test("never reports an update for something that isn't a version", () => {
		expect(compareVersions("latest", "1.0.0")).toBeNull();
		expect(isNewerVersion("abc123", "1.0.0")).toBe(false);
		expect(normalizeVersion("pr-12")).toBeNull();
	});
});

describe("composeTargetFrom", () => {
	test("reads the project, service, working dir and config files", () => {
		expect(
			composeTargetFrom(labels, "docker.io/orochibraru/homerun:latest"),
		).toEqual({
			configFiles: ["/home/homerun/homerun/compose.yaml"],
			image: "docker.io/orochibraru/homerun:latest",
			project: "homerun",
			service: "app",
			workingDir: "/home/homerun/homerun",
		});
	});

	test("splits several config files and resolves relative ones", () => {
		const target = composeTargetFrom(
			{
				...labels,
				"com.docker.compose.project.config_files":
					"/srv/homerun/compose.yaml, override.yaml",
				"com.docker.compose.project.working_dir": "/srv/homerun",
			},
			"homerun:latest",
		);
		expect(target?.configFiles).toEqual([
			"/srv/homerun/compose.yaml",
			"/srv/homerun/override.yaml",
		]);
	});

	test("is null outside compose", () => {
		expect(composeTargetFrom(undefined, "homerun")).toBeNull();
		expect(composeTargetFrom({}, "homerun")).toBeNull();
		expect(
			composeTargetFrom({ "com.docker.compose.project": "homerun" }, "homerun"),
		).toBeNull();
	});
});

describe("own container discovery", () => {
	test("finds the container id in mountinfo", () => {
		const id = "a".repeat(64);
		const mountinfo = `1 2 0:1 /var/lib/docker/containers/${id}/hostname /etc/hostname rw - ext4 /dev/sda1 rw`;
		expect(containerIdFromMountinfo(mountinfo)).toBe(id);
		expect(containerIdFromMountinfo("1 2 0:1 / / rw - overlay rw")).toBeNull();
	});
});

describe("image tags", () => {
	test("splits a reference", () => {
		expect(splitImageRef("docker.io/orochibraru/homerun:v1.0.20")).toEqual({
			repository: "docker.io/orochibraru/homerun",
			tag: "v1.0.20",
		});
		expect(splitImageRef("localhost:5000/homerun")).toEqual({
			repository: "localhost:5000/homerun",
			tag: "latest",
		});
	});

	test("canary always runs the moving canary tag", () => {
		expect(pinnedTagFor("v1.0.20", "1.0.22-canary.7", "canary")).toBe("canary");
		expect(pinnedTagFor("latest", "1.0.22-canary.7", "canary")).toBe("canary");
		expect(pinnedTagFor("canary", "1.0.22-canary.7", "canary")).toBeNull();
		expect(pinnedTagFor("canary", "1.0.22-nightly.8", "nightly")).toBe(
			"nightly",
		);
		expect(pinnedTagFor("nightly", "1.0.22-nightly.8", "nightly")).toBeNull();
	});

	test("only rewrites a pinned tag, keeping its v prefix style", () => {
		expect(pinnedTagFor("latest", "1.0.22", "stable")).toBeNull();
		expect(pinnedTagFor("canary", "1.0.22", "stable")).toBe("v1.0.22");
		expect(pinnedTagFor("nightly", "1.0.22", "stable")).toBe("v1.0.22");
		expect(pinnedTagFor("v1.0.20", "1.0.22", "stable")).toBe("v1.0.22");
		expect(pinnedTagFor("1.0.20", "1.0.22", "stable")).toBe("1.0.22");
		expect(pinnedTagFor("pr-12", "1.0.22", "stable")).toBe("v1.0.22");
		expect(pinnedTagFor("v1.0.22", "1.0.22", "stable")).toBeNull();
	});
});

describe("updaterScript", () => {
	test("pulls and recreates only the app service", () => {
		const target = composeTargetFrom(
			labels,
			"docker.io/orochibraru/homerun:latest",
		);
		if (!target) {
			throw new Error("expected a target");
		}
		const script = updaterScript(target, {
			channel: "stable",
			version: "1.0.22",
		});
		expect(script).not.toContain("sed");
		expect(script).toContain("set -- -f '/home/homerun/homerun/compose.yaml'");
		expect(script).toContain(`docker compose -p 'homerun' "$@" pull 'app'`);
		expect(script).toContain("up -d --no-deps 'app'");
		expect(script.indexOf("pull 'app'")).toBeLessThan(
			script.indexOf(" up -d "),
		);
	});

	test("recreates the worker service alongside the app", () => {
		const target = composeTargetFrom(labels, "homerun:latest");
		if (!target) {
			throw new Error("expected a target");
		}
		const script = updaterScript(
			target,
			{ channel: "stable", version: "1.0.22" },
			{ companions: ["worker", "app"] },
		);
		expect(script).toContain("pull 'app' 'worker'");
		expect(script).toContain("up -d --no-deps 'app' 'worker'");
	});

	test("bumps a pinned tag in the compose file and .env before pulling", () => {
		const target = composeTargetFrom(
			labels,
			"docker.io/orochibraru/homerun:v1.0.20",
		);
		if (!target) {
			throw new Error("expected a target");
		}
		const script = updaterScript(target, {
			channel: "stable",
			version: "1.0.22",
		});
		expect(script).toContain("homerun:)v1\\.0\\.20");
		expect(script).toContain("\\1v1.0.22\\2");
		expect(script).toContain("HOMERUN_VERSION=");
		expect(script.indexOf("sed")).toBeLessThan(script.indexOf("pull 'app'"));
	});

	test("never recreates Traefik, Postgres or anything outside the project", () => {
		const target = composeTargetFrom(labels, "homerun:latest");
		if (!target) {
			throw new Error("expected a target");
		}
		const script = updaterScript(
			target,
			{ channel: "stable", version: "1.0.22" },
			{ companions: ["worker"] },
		);
		expect(script).not.toContain("--remove-orphans");
		expect(script).not.toMatch(/up -d(?! --no-deps)/);
		expect(script).not.toMatch(/'traefik'|'postgres'/);
	});

	test("mounts the socket and the project dir at their host paths", () => {
		const target = composeTargetFrom(labels, "homerun:latest");
		if (!target) {
			throw new Error("expected a target");
		}
		expect(updaterBinds(target, "/run/user/1001/docker.sock")).toEqual([
			"/run/user/1001/docker.sock:/var/run/docker.sock",
			"/home/homerun/homerun:/home/homerun/homerun",
		]);
	});
});

describe("composeEnvDefaults", () => {
	test("recovers the host, resolver, origin and socket off the running app", () => {
		expect(
			composeEnvDefaults(
				{
					"traefik.http.routers.homerun.rule": "Host(`203.0.113.10`)",
					"traefik.http.routers.homerun.tls.certresolver": "",
				},
				"http://203.0.113.10:3000",
				"/run/user/1000/docker.sock",
			),
		).toEqual({
			DASHBOARD_CERT_RESOLVER: "",
			HOMERUN_DOCKER_SOCKET: "/run/user/1000/docker.sock",
			HOMERUN_HOST: "203.0.113.10",
			ORIGIN: "http://203.0.113.10:3000",
		});
	});

	test("leaves out what it can't recover", () => {
		expect(composeEnvDefaults({}, undefined, "/var/run/docker.sock")).toEqual({
			HOMERUN_DOCKER_SOCKET: "/var/run/docker.sock",
		});
	});
});

const FAKE_DOCKER = `#!/bin/sh
echo "docker $*" >> "$DOCKER_LOG"
if [ "$1" = run ]; then
	eval "file=\\\${$#}"
	printf '# homerun:generated\\nnew %s\\n' "$(basename "$file")"
fi
case "$*" in
	*" ps -q "*) echo app-container ;;
	"inspect "*) echo true ;;
	"exec "*homerun-update-candidate*) [ -z "$FAIL_CANDIDATE" ] || exit 1 ;;
	"exec "*app-container*) [ -z "$FAIL_APP" ] || exit 1 ;;
esac
`;

/** Runs `script` under sh in a scratch compose dir holding `files`, with a fake `docker` on PATH, and returns the dir's files afterwards plus every docker call made. */
async function runUpdater(
	files: Record<string, string>,
	image: string,
	envDefaults: Record<string, string> = {},
	channel: UpdateChannel = "stable",
	failures: { app?: boolean; candidate?: boolean } = {},
): Promise<{
	calls: string[];
	code: number;
	dir: string;
	read: (name: string) => Promise<string>;
}> {
	const dir = await mkdtemp(join(tmpdir(), "homerun-updater-"));
	const bin = await mkdtemp(join(tmpdir(), "homerun-bin-"));
	await writeFile(join(bin, "docker"), FAKE_DOCKER, { mode: 0o755 });
	for (const [name, content] of Object.entries(files)) {
		await writeFile(join(dir, name), content);
	}
	const target = composeTargetFrom(
		{
			...labels,
			"com.docker.compose.project.config_files": join(dir, "compose.yaml"),
			"com.docker.compose.project.working_dir": dir,
		},
		image,
	);
	if (!target) {
		throw new Error("expected a target");
	}
	const log = join(dir, "docker.log");
	const proc = Bun.spawn(
		[
			"sh",
			"-c",
			updaterScript(
				target,
				{ channel, version: "1.0.22" },
				{ companions: ["worker"], envDefaults },
			),
		],
		{
			env: {
				DOCKER_LOG: log,
				FAIL_APP: failures.app ? "1" : "",
				FAIL_CANDIDATE: failures.candidate ? "1" : "",
				HOMERUN_CHECK_INTERVAL: "0",
				HOMERUN_CHECK_TRIES: "2",
				PATH: `${bin}:${process.env.PATH}`,
			},
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	const code = await proc.exited;
	if (code !== 0 && !(failures.app || failures.candidate)) {
		throw new Error(await new Response(proc.stderr).text());
	}
	const calls = (await readFile(log, "utf8")).trim().split("\n");
	return {
		calls,
		code,
		dir,
		read: (name) => readFile(join(dir, name), "utf8"),
	};
}

describe("updaterScript against a real shell", () => {
	test("replaces a generated compose file with the new image's and pins .env", async () => {
		const { calls, read } = await runUpdater(
			{
				".env":
					"AUTH_SECRET=keep\nHOMERUN_VERSION=v1.0.20\nHOMERUN_HOST=mine.example.com",
				"compose.yaml": "# homerun:generated\nold\n",
			},
			"docker.io/orochibraru/homerun:v1.0.20",
			{ HOMERUN_HOST: "ignored.example.com", ORIGIN: "http://x:3000" },
		);
		expect(await read("compose.yaml")).toBe(
			"# homerun:generated\nnew compose.yaml\n",
		);
		const env = await read(".env");
		expect(env).toContain("AUTH_SECRET=keep\n");
		expect(env).toContain("HOMERUN_HOST=mine.example.com\n");
		expect(env).not.toContain("ignored.example.com");
		expect(env).toContain("ORIGIN=http://x:3000\n");
		expect(env).toContain("HOMERUN_IMAGE=docker.io/orochibraru/homerun\n");
		expect(env).toContain("HOMERUN_VERSION=v1.0.22\n");
		expect(env).not.toContain("v1.0.20");
		expect(calls).toContain(
			"docker run --rm --entrypoint cat docker.io/orochibraru/homerun:v1.0.22 /app/compose/compose.yaml",
		);
		expect(calls.findLast((call) => call.includes(" up -d "))).toMatch(
			/^docker compose -p homerun -f compose\.yaml up -d --no-deps app worker$/,
		);
	});

	test("switching to canary points .env at the canary image", async () => {
		const { calls, read } = await runUpdater(
			{
				".env": "AUTH_SECRET=keep\nHOMERUN_VERSION=v1.0.20\n",
				"compose.yaml": "# homerun:generated\nold\n",
			},
			"docker.io/orochibraru/homerun:v1.0.20",
			{},
			"canary",
		);
		expect(await read(".env")).toContain("HOMERUN_VERSION=canary\n");
		expect(calls).toContain("docker pull docker.io/orochibraru/homerun:canary");
	});

	test("migrates an old installer file, keeping a swarm install on the swarm overlay", async () => {
		const { calls, read } = await runUpdater(
			{
				".env": "AUTH_SECRET=keep\n",
				"compose.yaml":
					"# Generated by the Homerun installer (--mode=full).\n      - --providers.swarm=true\n",
			},
			"docker.io/orochibraru/homerun:latest",
			{ HOMERUN_HOST: "203.0.113.10" },
		);
		expect(await read("compose.swarm.yaml")).toBe(
			"# homerun:generated\nnew compose.swarm.yaml\n",
		);
		const env = await read(".env");
		expect(env).toContain("HOMERUN_HOST=203.0.113.10\n");
		expect(env).toContain("HOMERUN_VERSION=latest\n");
		expect(calls.findLast((call) => call.includes(" up -d "))).toBe(
			"docker compose -p homerun -f compose.yaml -f compose.swarm.yaml up -d --no-deps app worker",
		);
	});

	test.skipIf(process.platform === "darwin")(
		"leaves a hand-written compose file alone apart from its pinned tag",
		async () => {
			const { calls, dir, read } = await runUpdater(
				{
					"compose.yaml": "services:\n  app:\n    image: homerun:v1.0.20\n",
				},
				"homerun:v1.0.20",
			);
			expect(await read("compose.yaml")).toBe(
				"services:\n  app:\n    image: homerun:v1.0.22\n",
			);
			expect(calls.some((call) => call.startsWith("docker run"))).toBe(false);
			expect(calls.findLast((call) => call.includes(" up -d "))).toBe(
				`docker compose -p homerun -f ${join(dir, "compose.yaml")} up -d --no-deps app worker`,
			);
		},
	);
});

describe("the updater's safety net", () => {
	const files = {
		".env": "HOMERUN_VERSION=v1.0.21\n",
		"compose.yaml": "# homerun:generated\nold\n",
	};

	test("checks the new version in a candidate before switching, then drops the backups", async () => {
		const { calls, code, read } = await runUpdater(
			files,
			"docker.io/orochibraru/homerun:v1.0.21",
		);
		expect(code).toBe(0);
		const candidate = calls.findIndex((call) =>
			call.includes(
				"run -d --no-deps --name homerun-update-candidate -e HOMERUN_CANDIDATE=1 -l traefik.enable=false app",
			),
		);
		const handoff = calls.indexOf(
			"docker network connect --alias homerun-auth homerun homerun-update-candidate",
		);
		const recreate = calls.findIndex((call) =>
			call.includes("up -d --no-deps"),
		);
		const removed = calls.lastIndexOf("docker rm -f homerun-update-candidate");
		expect(candidate).toBeGreaterThan(-1);
		expect(handoff).toBeGreaterThan(candidate);
		expect(calls[handoff - 1]).toBe(
			"docker network disconnect homerun homerun-update-candidate",
		);
		expect(recreate).toBeGreaterThan(handoff);
		expect(removed).toBeGreaterThan(recreate);
		expect(calls).toContain(
			"docker exec -e HEALTHCHECK_PATH=/api/v1/ready homerun-update-candidate /app/build/healthcheck",
		);
		expect(calls).toContain(
			"docker exec -e HEALTHCHECK_PATH=/api/v1/ready app-container /app/build/healthcheck",
		);
		expect(await read(".env")).toContain("v1.0.22");
		await expect(read(".env.homerun-rollback")).rejects.toThrow();
	});

	test("a candidate that fails its check leaves the running version and its files alone", async () => {
		const { calls, code, read } = await runUpdater(
			files,
			"docker.io/orochibraru/homerun:v1.0.21",
			{},
			"stable",
			{ candidate: true },
		);
		expect(code).toBe(1);
		expect(calls.some((call) => call.includes("up -d --no-deps"))).toBe(false);
		expect(await read(".env")).toBe("HOMERUN_VERSION=v1.0.21\n");
		expect(await read("compose.yaml")).toBe("# homerun:generated\nold\n");
	});

	test("a new version that passes the check but doesn't come up is rolled back", async () => {
		const { calls, code, read } = await runUpdater(
			files,
			"docker.io/orochibraru/homerun:v1.0.21",
			{},
			"stable",
			{ app: true },
		);
		expect(code).toBe(1);
		expect(
			calls.filter((call) => call.includes("up -d --no-deps")),
		).toHaveLength(2);
		expect(await read(".env")).toBe("HOMERUN_VERSION=v1.0.21\n");
		expect(await read("compose.yaml")).toBe("# homerun:generated\nold\n");
	});
});

describe("isUpdateChannel", () => {
	test("accepts the three channels and nothing else", () => {
		expect(["stable", "canary", "nightly"].every(isUpdateChannel)).toBe(true);
		expect(isUpdateChannel("beta")).toBe(false);
		expect(isUpdateChannel(null)).toBe(false);
	});
});
