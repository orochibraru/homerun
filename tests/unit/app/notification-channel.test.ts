import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { discordPayload, messageBody, messageSubject } = await import(
	"../../../src/lib/services/notification-channel.service"
);
const { deployEvent, deployTitle, isFailureEvent } = await import(
	"../../../src/lib/notification-events"
);
const {
	deployMessage,
	formatDuration,
	logTail,
	revisionHealthMessage,
	statusChecksMessage,
	uptimeMessage,
} = await import("../../../src/lib/services/notification-messages");
const { validateChannelTarget } = await import(
	"../../../src/lib/server/validation/notification-channel"
);

const message = {
	detail: "exit code 1",
	event: "build.failed" as const,
	fields: [
		{ name: "Branch", value: "main" },
		{ name: "Repository", value: `https://example.com/${"a".repeat(60)}.git` },
	],
	link: "https://homerun.example.com/services/svc-1/revisions",
	serviceId: "svc-1",
	serviceName: "api",
	timestamp: "2026-09-16T12:00:00.000Z",
	title: "api failed to build",
};

describe("deployEvent", () => {
	test("a git service reports builds whatever triggered it", () => {
		expect(deployEvent("git", "manual", false)).toBe("build.failed");
		expect(deployEvent("git", "cron", true)).toBe("build.succeeded");
	});

	test("a scheduled image redeploy is an update", () => {
		expect(deployEvent("image", "cron", false)).toBe("update.failed");
		expect(deployEvent("image", "cron", true)).toBe("update.succeeded");
	});

	test("a manual image deploy is a deploy", () => {
		expect(deployEvent("image", "manual", false)).toBe("deploy.failed");
	});

	test("the title reads as a sentence", () => {
		expect(deployTitle("update.failed", "api")).toBe("api failed to update");
	});
});

describe("channel formatting", () => {
	test("email subject and body carry the title and the detail", () => {
		expect(messageSubject(message)).toBe("[Homerun] api failed to build");
		expect(messageBody(message)).toContain("Event: Build failed");
		expect(messageBody(message)).toContain("exit code 1");
		expect(messageBody(message)).toContain("Branch: main");
		expect(messageBody(message)).toContain(
			"Open: https://homerun.example.com/services/svc-1/revisions",
		);
		expect(messageBody({ ...message, detail: null })).not.toContain(
			"exit code 1",
		);
	});

	test("a Discord failure is a red embed, a success a green one", () => {
		const [failed] = discordPayload(message).embeds;
		expect(failed?.title).toBe("api failed to build");
		expect(failed?.color).toBe(0xef_44_44);
		expect(failed?.description).toContain("exit code 1");
		expect(failed?.url).toBe(message.link);
		expect(failed?.fields).toContainEqual({
			inline: true,
			name: "Branch",
			value: "main",
		});
		expect(
			failed?.fields.find((field) => field.name === "Repository")?.inline,
		).toBe(false);

		const [recovered] = discordPayload({
			...message,
			detail: null,
			event: "service.up",
		}).embeds;
		expect(recovered?.color).toBe(0x10_b9_81);
		expect(recovered?.description).toBeUndefined();
	});

	test("a huge Discord detail keeps its end, where the error is", () => {
		const [embed] = discordPayload({
			...message,
			detail: `${"x".repeat(10_000)}the real error`,
		}).embeds;
		expect(embed?.description?.length).toBeLessThan(4100);
		expect(embed?.description).toContain("the real error");
	});
});

describe("validateChannelTarget", () => {
	test("a Discord channel needs a Discord webhook URL", () => {
		expect(
			validateChannelTarget(
				"discord",
				"https://discord.com/api/webhooks/1/abc",
			),
		).toBeNull();
		expect(
			validateChannelTarget("discord", "https://example.com/hook"),
		).not.toBeNull();
	});

	test("a generic webhook needs http(s), an email needs an address", () => {
		expect(validateChannelTarget("webhook", "https://example.com")).toBeNull();
		expect(
			validateChannelTarget("webhook", "ftp://example.com"),
		).not.toBeNull();
		expect(validateChannelTarget("webhook", "not-a-url")).toBe(
			"That doesn't look like a URL.",
		);
		expect(validateChannelTarget("email", "a@example.com")).toBeNull();
		expect(validateChannelTarget("email", "nope")).not.toBeNull();
	});
});

describe("deploy and uptime messages", () => {
	const service = {
		buildSource: "image" as const,
		gitRef: null,
		gitUrl: null,
		id: "svc-1",
		image: "nginx",
		name: "web",
		tag: "1.27",
	};
	const deployment = {
		errorMessage: null,
		finishedAt: new Date("2026-09-16T12:01:05Z"),
		gitCommit: null,
		gitRef: null,
		imageDigest: "sha256:0123456789abcdef0123456789abcdef",
		log: "",
		startedAt: new Date("2026-09-16T12:00:00Z"),
	};

	test("a successful scheduled update lists the image, digest, duration and URL", () => {
		const built = deployMessage(
			{
				deployment,
				origin: "https://homerun.example.com/",
				stackName: "Blog",
				publicUrl: "https://web.example.com",
				service,
				trigger: "cron",
			},
			true,
			"2026-09-16T12:01:05Z",
		);
		expect(built.event).toBe("update.succeeded");
		expect(built.title).toBe("web was updated");
		expect(built.detail).toBeNull();
		expect(built.link).toBe(
			"https://homerun.example.com/services/svc-1/revisions",
		);
		expect(built.fields).toEqual([
			{ name: "Stack", value: "Blog" },
			{ name: "Trigger", value: "Scheduled" },
			{ name: "Image", value: "nginx:1.27" },
			{ name: "Digest", value: "sha256:0123456789ab" },
			{ name: "Duration", value: "1m 05s" },
			{ name: "URL", value: "https://web.example.com" },
		]);
	});

	test("a failed build carries the commit, the error and the log tail", () => {
		const built = deployMessage(
			{
				deployment: {
					...deployment,
					errorMessage: "Build failed.",
					gitCommit: "abcdef0123456789",
					gitRef: "release",
					imageDigest: "",
					log: "\u001b[32mStep 1/3\u001b[0m\nRUN bun install\nerror: lockfile mismatch\nBuild failed.\n",
				},
				origin: null,
				stackName: null,
				publicUrl: "https://web.example.com",
				service: {
					...service,
					buildSource: "git",
					gitUrl: "https://github.com/example/web.git",
				},
				trigger: "manual",
			},
			false,
			"2026-09-16T12:01:05Z",
		);
		expect(built.event).toBe("build.failed");
		expect(built.link).toBeNull();
		expect(built.fields).toContainEqual({ name: "Commit", value: "abcdef0" });
		expect(built.fields).toContainEqual({ name: "Branch", value: "release" });
		expect(built.fields.some((field) => field.name === "URL")).toBe(false);
		expect(built.detail).toBe(
			"Build failed.\n\nStep 1/3\nRUN bun install\nerror: lockfile mismatch",
		);
	});

	test("an uptime message names the probe and the public host", () => {
		const built = uptimeMessage(
			{
				detail: "Timed out.",
				kind: "external",
				ok: false,
				origin: null,
				publicHost: "web.example.com",
				service: { id: "svc-1", name: "web" },
			},
			"2026-09-16T12:00:00Z",
		);
		expect(built.event).toBe("service.down");
		expect(built.title).toBe("web is down");
		expect(built.fields).toContainEqual({
			name: "Host",
			value: "web.example.com",
		});
	});

	test("a status checks message lists what failed and says the build stops", () => {
		const built = statusChecksMessage(
			{
				commit: "0123456789abcdef",
				failed: ["test"],
				missing: ["e2e"],
				origin: "https://homerun.example.com",
				pending: [],
				reason: "Required status checks didn't pass.",
				service: {
					gitRef: "main",
					gitUrl: "https://github.com/acme/api.git",
					id: "svc-1",
					name: "api",
				},
				stackName: null,
			},
			"2026-09-16T12:00:00Z",
		);
		expect(built.event).toBe("build.checks_failed");
		expect(built.title).toBe("api was not built: status checks failed");
		expect(built.fields).toContainEqual({
			name: "Failed checks",
			value: "test",
		});
		expect(built.fields).toContainEqual({
			name: "Never reported",
			value: "e2e",
		});
		expect(built.fields).toContainEqual({ name: "Commit", value: "0123456" });
		expect(built.detail).toContain("The build will not carry on.");
		expect(isFailureEvent("build.checks_failed")).toBe(true);
	});

	test("a revision health message is a rollback only when there was a target", () => {
		const input = {
			origin: null,
			reason: "The container exited with code 1.",
			revision: { gitCommit: null, id: "dep-2", imageRef: "nginx:1.28" },
			service: { id: "svc-1", name: "web" },
		};
		const rolled = revisionHealthMessage(
			{
				...input,
				rolledBackTo: { gitCommit: null, id: "dep-1", imageRef: "nginx:1.27" },
				skipReason: null,
			},
			"2026-09-16T12:00:00Z",
		);
		expect(rolled.event).toBe("deploy.rolled_back");
		expect(rolled.fields).toContainEqual({
			name: "Rolled back to",
			value: "nginx:1.27",
		});
		const left = revisionHealthMessage(
			{ ...input, rolledBackTo: null, skipReason: "Auto-rollback is off." },
			"2026-09-16T12:00:00Z",
		);
		expect(left.event).toBe("deploy.unhealthy");
		expect(left.detail).toBe(
			"The container exited with code 1.\n\nAuto-rollback is off.",
		);
		expect(isFailureEvent("deploy.rolled_back")).toBe(true);
	});

	test("durations and log tails", () => {
		expect(formatDuration(null, new Date())).toBeNull();
		expect(formatDuration(new Date(0), new Date(9000))).toBe("9s");
		const log = Array.from({ length: 30 }, (_, index) => `line ${index}`).join(
			"\n",
		);
		expect(logTail(log, null).split("\n")).toHaveLength(15);
		expect(logTail(log, null)).toEndWith("line 29");
	});
});
