import { describe, expect, test } from "bun:test";
import {
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

	test("only rewrites a pinned tag, keeping its v prefix style", () => {
		expect(pinnedTagFor("latest", "1.0.22")).toBeNull();
		expect(pinnedTagFor("v1.0.20", "1.0.22")).toBe("v1.0.22");
		expect(pinnedTagFor("1.0.20", "1.0.22")).toBe("1.0.22");
		expect(pinnedTagFor("pr-12", "1.0.22")).toBe("v1.0.22");
		expect(pinnedTagFor("v1.0.22", "1.0.22")).toBeNull();
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
		const script = updaterScript(target, "1.0.22");
		expect(script).not.toContain("sed");
		expect(script).toContain(
			"docker compose -p 'homerun' -f '/home/homerun/homerun/compose.yaml' pull 'app'",
		);
		expect(script).toContain("up -d --no-deps 'app'");
		expect(script.indexOf(" pull ")).toBeLessThan(script.indexOf(" up -d "));
	});

	test("bumps a pinned tag in the compose file and .env before pulling", () => {
		const target = composeTargetFrom(
			labels,
			"docker.io/orochibraru/homerun:v1.0.20",
		);
		if (!target) {
			throw new Error("expected a target");
		}
		const script = updaterScript(target, "1.0.22");
		expect(script).toContain("homerun:)v1\\.0\\.20");
		expect(script).toContain("\\1v1.0.22\\2");
		expect(script).toContain("HOMERUN_VERSION=");
		expect(script.indexOf("sed")).toBeLessThan(script.indexOf(" pull "));
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
