import { describe, expect, test } from "bun:test";
import {
	countsLine,
	describeBlockPolicy,
	emptyCounts,
	evaluateScanPolicy,
	isBlockSeverity,
	severitiesAtOrAbove,
} from "../../../src/lib/image-scan";
import type { GitBuildPlan } from "../../../src/lib/services/deploy/plan";
import { buildScanTargets } from "../../../src/lib/services/deploy/scan-targets";
import {
	isRootlessDaemon,
	MIRROR_HOST_PORT,
	mirrorRefs,
	normalizeImageRef,
	REGISTRY_AUTH_ENV,
	skopeoArchiveCommand,
	skopeoCopyCommand,
} from "../../../src/lib/services/docker/image-scan-refs";
import { imageScanMessage } from "../../../src/lib/services/notification-messages";

describe("evaluateScanPolicy", () => {
	const counts = { ...emptyCounts(), high: 2, low: 4, medium: 3, unknown: 7 };
	const scan = { counts, fixableCounts: null };
	const policy = (
		severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | null,
		fixableOnly = false,
	) => ({ fixableOnly, severity });

	test("never blocks with the policy off", () => {
		const verdict = evaluateScanPolicy(
			{ counts: { ...counts, critical: 5 }, fixableCounts: null },
			policy(null),
		);
		expect(verdict).toEqual({
			blocked: false,
			blocking: emptyCounts(),
			reason: null,
		});
	});

	test("CRITICAL ignores HIGH and below", () => {
		expect(evaluateScanPolicy(scan, policy("CRITICAL")).blocked).toBe(false);
		const verdict = evaluateScanPolicy(
			{ counts: { ...counts, critical: 1 }, fixableCounts: null },
			policy("CRITICAL"),
		);
		expect(verdict.blocked).toBe(true);
		expect(verdict.blocking).toEqual({ ...emptyCounts(), critical: 1 });
		expect(verdict.reason).toContain("block at CRITICAL");
		expect(verdict.reason).toContain(
			"1 vulnerability at or above the threshold (1 critical)",
		);
	});

	test("HIGH blocks on HIGH or CRITICAL", () => {
		const verdict = evaluateScanPolicy(scan, policy("HIGH"));
		expect(verdict.blocked).toBe(true);
		expect(verdict.blocking).toEqual({ ...emptyCounts(), high: 2 });
		expect(verdict.reason).toContain("block at HIGH or above");
		expect(
			evaluateScanPolicy(
				{ counts: { ...emptyCounts(), medium: 9 }, fixableCounts: null },
				policy("HIGH"),
			).blocked,
		).toBe(false);
	});

	test("MEDIUM and LOW count everything at or above, never UNKNOWN", () => {
		expect(evaluateScanPolicy(scan, policy("MEDIUM")).blocking).toEqual({
			...emptyCounts(),
			high: 2,
			medium: 3,
		});
		const low = evaluateScanPolicy(scan, policy("LOW"));
		expect(low.blocking).toEqual({
			...emptyCounts(),
			high: 2,
			low: 4,
			medium: 3,
		});
		expect(low.reason).toContain(
			"9 vulnerabilities at or above the threshold (2 high, 3 medium, 4 low)",
		);
		expect(
			evaluateScanPolicy(
				{ counts: { ...emptyCounts(), unknown: 3 }, fixableCounts: null },
				policy("LOW"),
			).blocked,
		).toBe(false);
	});

	test("the reason lists the whole scan's counts", () => {
		expect(evaluateScanPolicy(scan, policy("HIGH")).reason).toContain(
			`Full scan: ${countsLine(counts)}.`,
		);
	});

	test("fixable only counts findings that have a fix", () => {
		const withFixes = {
			counts: { ...emptyCounts(), critical: 3, high: 1 },
			fixableCounts: { ...emptyCounts(), high: 1 },
		};
		expect(
			evaluateScanPolicy(withFixes, policy("CRITICAL", true)).blocked,
		).toBe(false);
		const verdict = evaluateScanPolicy(withFixes, policy("HIGH", true));
		expect(verdict.blocking).toEqual({ ...emptyCounts(), high: 1 });
		expect(verdict.reason).toContain("fixable only");
		expect(verdict.reason).toContain(
			"1 fixable vulnerability at or above the threshold (1 high)",
		);
		expect(evaluateScanPolicy(withFixes, policy("CRITICAL")).blocked).toBe(
			true,
		);
	});

	test("fixable only falls back to every finding on an older scan", () => {
		expect(
			evaluateScanPolicy(
				{ counts: { ...emptyCounts(), critical: 1 }, fixableCounts: null },
				policy("CRITICAL", true),
			).blocked,
		).toBe(true);
	});

	test("orders severities and describes a policy", () => {
		expect(severitiesAtOrAbove("CRITICAL")).toEqual(["CRITICAL"]);
		expect(severitiesAtOrAbove("MEDIUM")).toEqual([
			"CRITICAL",
			"HIGH",
			"MEDIUM",
		]);
		expect(describeBlockPolicy(policy(null, true))).toBe("off");
		expect(describeBlockPolicy(policy("LOW", true))).toBe(
			"LOW or above, fixable only",
		);
	});

	test("validates a stored severity value", () => {
		expect(isBlockSeverity("HIGH")).toBe(true);
		expect(isBlockSeverity("LOW")).toBe(true);
		expect(isBlockSeverity("UNKNOWN")).toBe(false);
		expect(isBlockSeverity("off")).toBe(false);
		expect(isBlockSeverity(null)).toBe(false);
	});

	test("summarizes counts in one line", () => {
		expect(countsLine({ ...emptyCounts(), critical: 1, high: 2 })).toBe(
			"1 critical, 2 high, 0 medium, 0 low, 0 unknown",
		);
	});
});

describe("image refs", () => {
	test("normalizes Docker Hub shorthands", () => {
		expect(normalizeImageRef("nginx", "1.27")).toEqual({
			registry: "docker.io",
			repository: "library/nginx",
			tag: "1.27",
		});
		expect(normalizeImageRef("grafana/grafana", "latest").repository).toBe(
			"grafana/grafana",
		);
	});

	test("keeps an explicit registry, including one with a port", () => {
		expect(normalizeImageRef("ghcr.io/acme/api", "v1")).toEqual({
			registry: "ghcr.io",
			repository: "acme/api",
			tag: "v1",
		});
		expect(normalizeImageRef("localhost:5000/app", "dev").registry).toBe(
			"localhost:5000",
		);
	});

	test("builds the mirror's internal, loopback and source refs", () => {
		expect(mirrorRefs("nginx", "1.27")).toEqual({
			internalRef: "homerun-mirror:5000/docker.io/library/nginx:1.27",
			loopbackImage: `127.0.0.1:${MIRROR_HOST_PORT}/docker.io/library/nginx`,
			loopbackTag: "1.27",
			sourceRef: "docker.io/library/nginx:1.27",
		});
		expect(mirrorRefs("registry.local:8443/Team/App", "x").internalRef).toBe(
			"homerun-mirror:5000/registry.local-8443/team/app:x",
		);
	});
});

describe("helper commands", () => {
	test("a public copy runs skopeo directly", () => {
		expect(
			skopeoCopyCommand({
				destination: "homerun-mirror:5000/docker.io/library/nginx:1",
				source: "docker.io/library/nginx:1",
				withAuth: false,
			}),
		).toEqual({
			cmd: [
				"copy",
				"--quiet",
				"--dest-tls-verify=false",
				"--digestfile",
				"/dev/stdout",
				"docker://docker.io/library/nginx:1",
				"docker://homerun-mirror:5000/docker.io/library/nginx:1",
			],
			entrypoint: ["skopeo"],
		});
	});

	test("an authenticated copy keeps credentials out of argv", () => {
		const command = skopeoCopyCommand({
			destination: "dest",
			source: "src",
			withAuth: true,
		});
		expect(command.entrypoint[0]).toBe("sh");
		expect(command.entrypoint[2]).toContain(`"$${REGISTRY_AUTH_ENV}"`);
		expect(command.entrypoint[2]).toContain('exec skopeo "$@"');
		expect(command.cmd[0]).toBe("skopeo");
		expect(command.cmd).toContain("--src-authfile");
		expect(command.cmd.slice(-2)).toEqual(["docker://src", "docker://dest"]);
	});
});

describe("buildScanTargets", () => {
	const git = {
		bakeFile: null,
		bakeTarget: null,
		buildContext: null,
		buildMethod: "dockerfile" as const,
		dockerfilePath: null,
		gitRef: "main",
		gitUrl: "https://example.com/app.git",
	};
	const registry = {
		password: "secret",
		registryUrl: "registry.example.com",
		username: "builder",
	};

	test("a local build scans the image on this host", () => {
		const targets = buildScanTargets(
			{ cacheRegistry: null, git, kind: "local-build" },
			{ image: "homerun-build-app", tag: "abc" },
		);
		expect(targets).toHaveLength(1);
		expect(targets[0]?.ref).toBe("homerun-build-app:abc");
		expect(targets[0]?.source).toEqual({ kind: "docker" });
	});

	test("a cross-host build scans the pushed ref, then falls back to the local pull", () => {
		const plan = {
			git,
			kind: "docker-build",
			registry,
			server: { connection: {}, hostId: "h", kind: "docker" },
		} as unknown as GitBuildPlan;
		const [remote, local] = buildScanTargets(plan, {
			image: "registry.example.com/homerun-build-app",
			tag: "abc",
		});
		expect(remote?.source).toEqual({ insecure: false, kind: "remote" });
		expect(remote?.auth).toEqual({
			password: "secret",
			serveraddress: "registry.example.com",
			username: "builder",
		});
		expect(local?.source).toEqual({ kind: "docker" });
		expect(local?.ref).toBe(remote?.ref);
	});

	test("a build server without a cache registry only scans the streamed-back local image", () => {
		const plan = {
			git,
			kind: "agent-build",
			registry: null,
			server: { connection: {}, hostId: "h", kind: "agent" },
		} as unknown as GitBuildPlan;
		const targets = buildScanTargets(plan, {
			image: "homerun-build-app",
			tag: "abc",
		});
		expect(targets).toHaveLength(1);
		expect(targets[0]?.source).toEqual({ kind: "docker" });
	});
});

describe("skopeoArchiveCommand", () => {
	test("reads the mirror copy insecurely and writes a named docker-archive to stdout", () => {
		expect(
			skopeoArchiveCommand({
				name: "nginx:1",
				source: "homerun-mirror:5000/docker.io/library/nginx:1",
			}),
		).toEqual({
			cmd: [
				"copy",
				"--quiet",
				"--src-tls-verify=false",
				"docker://homerun-mirror:5000/docker.io/library/nginx:1",
				"docker-archive:/dev/stdout:nginx:1",
			],
			entrypoint: ["skopeo"],
		});
	});
});

describe("isRootlessDaemon", () => {
	test("spots the rootless security option", () => {
		expect(
			isRootlessDaemon(["name=seccomp,profile=builtin", "name=rootless"]),
		).toBe(true);
		expect(
			isRootlessDaemon(["name=seccomp,profile=builtin,name=rootless"]),
		).toBe(true);
	});

	test("a rootful or unknown daemon isn't rootless", () => {
		expect(isRootlessDaemon(["name=seccomp,profile=builtin"])).toBe(false);
		expect(isRootlessDaemon(undefined)).toBe(false);
	});
});

describe("imageScanMessage", () => {
	test("lists the critical findings and links to the Security tab", () => {
		const message = imageScanMessage(
			{
				counts: { ...emptyCounts(), critical: 2, high: 1 },
				findings: [
					{
						fixedVersion: "1.1",
						id: "CVE-1",
						installedVersion: "1.0",
						pkg: "busybox",
						severity: "CRITICAL",
						title: null,
					},
					{
						fixedVersion: null,
						id: "CVE-2",
						installedVersion: "2.0",
						pkg: "zlib",
						severity: "CRITICAL",
						title: null,
					},
					{
						fixedVersion: null,
						id: "CVE-3",
						installedVersion: "3.0",
						pkg: "curl",
						severity: "HIGH",
						title: null,
					},
				],
				imageRef: "alpine:3.18.0",
				origin: "https://homerun.example.com/",
				service: { id: "svc-1", name: "web" },
			},
			"2026-01-01T00:00:00.000Z",
		);
		expect(message.event).toBe("image.vulnerable");
		expect(message.title).toBe("web has 2 critical vulnerabilities");
		expect(message.link).toBe(
			"https://homerun.example.com/services/svc-1/security",
		);
		expect(message.detail).toBe(
			"CVE-1 busybox 1.0 (fixed in 1.1)\nCVE-2 zlib 2.0",
		);
	});
});
