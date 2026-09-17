import { describe, expect, test } from "bun:test";
import {
	countsLine,
	describeBlockPolicy,
	emptyCounts,
	evaluateScanPolicy,
	isBlockSeverity,
	severitiesAtOrAbove,
	summarizeTrivyReport,
} from "../../../src/lib/image-scan";
import type { GitBuildPlan } from "../../../src/lib/services/deploy/plan";
import { buildScanTargets } from "../../../src/lib/services/deploy/scan-targets";
import {
	extractDigest,
	isRootlessDaemon,
	lastErrorLine,
	MIRROR_HOST_PORT,
	mirrorRefs,
	normalizeImageRef,
	pinnedToDigest,
	REGISTRY_AUTH_ENV,
	registryAuthFile,
	skopeoArchiveCommand,
	skopeoCopyCommand,
	trivyImageCommand,
} from "../../../src/lib/services/docker/image-scan-refs";
import { imageScanMessage } from "../../../src/lib/services/notification-messages";

const DIGEST = `sha256:${"a".repeat(64)}`;

function vulnerability(
	id: string,
	severity: string,
	pkg = "openssl",
	fixed: string | null = "3.0.9",
) {
	return {
		FixedVersion: fixed ?? undefined,
		InstalledVersion: "3.0.8",
		PkgName: pkg,
		Severity: severity,
		Title: `${id} title`,
		VulnerabilityID: id,
	};
}

function report(results: unknown[]): string {
	return JSON.stringify({ ArtifactName: "alpine:3.18.0", Results: results });
}

describe("summarizeTrivyReport", () => {
	test("counts findings per severity across every result", () => {
		const summary = summarizeTrivyReport(
			report([
				{
					Target: "alpine",
					Vulnerabilities: [
						vulnerability("CVE-1", "CRITICAL"),
						vulnerability("CVE-2", "HIGH"),
						vulnerability("CVE-3", "MEDIUM"),
					],
				},
				{
					Target: "app/package-lock.json",
					Vulnerabilities: [
						vulnerability("GHSA-1", "LOW", "lodash"),
						vulnerability("CVE-4", "weird", "zlib"),
					],
				},
				{ Target: "clean layer" },
			]),
		);
		expect(summary.counts).toEqual({
			critical: 1,
			high: 1,
			low: 1,
			medium: 1,
			unknown: 1,
		});
		expect(summary.totalFindings).toBe(5);
		expect(summary.fixableCounts).toEqual({
			critical: 1,
			high: 1,
			low: 1,
			medium: 1,
			unknown: 1,
		});
	});

	test("counts only findings with a fixed version as fixable", () => {
		const summary = summarizeTrivyReport(
			report([
				{
					Vulnerabilities: [
						vulnerability("CVE-1", "CRITICAL", "a", null),
						vulnerability("CVE-2", "CRITICAL", "b"),
						vulnerability("CVE-3", "HIGH", "c", null),
					],
				},
			]),
		);
		expect(summary.counts).toEqual({ ...emptyCounts(), critical: 2, high: 1 });
		expect(summary.fixableCounts).toEqual({ ...emptyCounts(), critical: 1 });
	});

	test("de-duplicates a CVE reported twice for the same package version", () => {
		const summary = summarizeTrivyReport(
			report([
				{ Vulnerabilities: [vulnerability("CVE-1", "HIGH")] },
				{ Vulnerabilities: [vulnerability("CVE-1", "HIGH")] },
				{ Vulnerabilities: [vulnerability("CVE-1", "HIGH", "libssl")] },
			]),
		);
		expect(summary.totalFindings).toBe(2);
		expect(summary.counts.high).toBe(2);
	});

	test("sorts by severity, fixable first, and caps what it keeps", () => {
		const summary = summarizeTrivyReport(
			report([
				{
					Vulnerabilities: [
						vulnerability("CVE-LOW", "LOW"),
						vulnerability("CVE-B", "CRITICAL", "b", null),
						vulnerability("CVE-A", "CRITICAL", "a"),
						vulnerability("CVE-HIGH", "HIGH"),
					],
				},
			]),
			3,
		);
		expect(summary.findings.map((finding) => finding.id)).toEqual([
			"CVE-A",
			"CVE-B",
			"CVE-HIGH",
		]);
		expect(summary.findings[1]?.fixedVersion).toBeNull();
		expect(summary.totalFindings).toBe(4);
	});

	test("maps the fields the UI shows", () => {
		const [finding] = summarizeTrivyReport(
			report([{ Vulnerabilities: [vulnerability("CVE-9", "critical")] }]),
		).findings;
		expect(finding).toEqual({
			fixedVersion: "3.0.9",
			id: "CVE-9",
			installedVersion: "3.0.8",
			pkg: "openssl",
			severity: "CRITICAL",
			title: "CVE-9 title",
		});
	});

	test("a report with no results is a clean image", () => {
		const summary = summarizeTrivyReport(JSON.stringify({ SchemaVersion: 2 }));
		expect(summary.counts).toEqual(emptyCounts());
		expect(summary.findings).toEqual([]);
	});

	test("rejects output that isn't a JSON report", () => {
		expect(() => summarizeTrivyReport("FATAL no such image")).toThrow(
			"Trivy didn't return a JSON report.",
		);
		expect(() => summarizeTrivyReport("[]")).toThrow();
	});
});

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

	test("pins a swarm image to the scanned digest", () => {
		const pinned = pinnedToDigest("nginx", "1.27", DIGEST);
		expect(`${pinned.image}:${pinned.tag}`).toBe(`nginx:1.27@${DIGEST}`);
	});

	test("reads the digest skopeo writes, ignoring anything before it", () => {
		expect(
			extractDigest(`Copying blob sha256:${"b".repeat(64)}\n${DIGEST}`),
		).toBe(DIGEST);
		expect(extractDigest("no digest here")).toBeNull();
	});

	test("writes a skopeo auth file keyed by the image's registry", () => {
		const file = JSON.parse(
			registryAuthFile("docker.io", { password: "p@ss", username: "me" }),
		);
		const auth = Buffer.from("me:p@ss").toString("base64");
		expect(file).toEqual({
			auths: {
				"docker.io": { auth },
				"index.docker.io": { auth },
			},
		});
		expect(
			Object.keys(
				JSON.parse(registryAuthFile("ghcr.io", { password: "", username: "u" }))
					.auths,
			),
		).toEqual(["ghcr.io"]);
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

	test("trivy scans the mirror over plain HTTP", () => {
		const args = trivyImageCommand("homerun-mirror:5000/x:1", {
			insecure: true,
			kind: "remote",
		});
		expect(args.slice(0, 4)).toEqual([
			"image",
			"--image-src",
			"remote",
			"--insecure",
		]);
		expect(args).toContain("json");
		expect(args.at(-1)).toBe("homerun-mirror:5000/x:1");
	});

	test("trivy scans a local image through the socket", () => {
		expect(trivyImageCommand("app:1", { kind: "docker" }).slice(1, 3)).toEqual([
			"--image-src",
			"docker",
		]);
		expect(trivyImageCommand("app:1", { kind: "any" })[2]).toBe(
			"docker,remote",
		);
		expect(
			trivyImageCommand("r/app:1", { insecure: false, kind: "remote" }),
		).not.toContain("--insecure");
	});

	test("picks the error line out of helper output", () => {
		expect(
			lastErrorLine(
				"2024 INFO starting\n2024 FATAL unable to find the specified image\n\n",
			),
		).toBe("2024 FATAL unable to find the specified image");
		expect(lastErrorLine("just a line\n")).toBe("just a line");
		expect(lastErrorLine("")).toBe("no output");
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
