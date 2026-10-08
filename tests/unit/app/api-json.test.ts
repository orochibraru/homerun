import { describe, expect, test } from "bun:test";
import {
	backupDestinationApiJson,
	bucketApiJson,
	buildCacheRegistryApiJson,
	cronJobApiJson,
	gitProviderApiJson,
	isEnvironmentRow,
	notificationChannelApiJson,
	redactedChannelTarget,
	serviceApiJson,
	serviceEnvironmentApiJson,
	statusPageApiJson,
} from "../../../src/lib/server/api-json";
import type {
	BuildCacheRegistry,
	CronJob,
	NotificationChannel,
	S3Destination,
	Service,
	StatusPage,
} from "../../../src/lib/server/db/schema";

function loose(value: unknown): unknown {
	return value;
}

const service = {
	buildSource: "git",
	channelCanary: false,
	customSslCertEnc: "c",
	customSslKeyEnc: "k",
	domains: ["staging.example.com"],
	environmentName: "staging",
	gitRef: "develop",
	gitWebhookSecretEnc: "w",
	id: "env-1",
	previewParentId: "svc-1",
	previewPrNumber: null,
	primaryDomain: "web-staging.example.com",
	registryPasswordEnc: null,
	slug: "web-staging",
	tag: "latest",
} as unknown as Service;

describe("API JSON", () => {
	test("a service drops its ciphertext and says what's set", () => {
		const json = serviceApiJson(service) as Record<string, unknown>;
		expect(json.customSslSet).toBe(true);
		expect(json.registryPasswordSet).toBe(false);
		expect("customSslCertEnc" in json).toBe(false);
		expect("gitWebhookSecretEnc" in json).toBe(false);
	});

	test("an environment reads off its child service", () => {
		expect(isEnvironmentRow(service)).toBe(true);
		expect(isEnvironmentRow({ ...service, previewPrNumber: 4 })).toBe(false);
		expect(isEnvironmentRow({ ...service, previewParentId: null })).toBe(false);
		const json = serviceEnvironmentApiJson(service);
		expect(json).toMatchObject({
			domain: "staging.example.com",
			name: "staging",
			ref: "develop",
			serviceId: "svc-1",
		});
		expect(
			serviceEnvironmentApiJson({
				...service,
				buildSource: "image",
				domains: [],
				environmentName: null,
				previewParentId: null,
			}),
		).toMatchObject({ domain: null, name: "", ref: "latest", serviceId: "" });
	});

	test("secrets become flags and targets lose their secret part", () => {
		expect(
			loose(
				cronJobApiJson({
					id: "c",
					registryPasswordEnc: "x",
				} as unknown as CronJob),
			),
		).toEqual({ id: "c", registryPasswordSet: true });
		expect(
			loose(
				backupDestinationApiJson({
					id: "d",
					secretAccessKeyEnc: "",
				} as unknown as S3Destination),
			),
		).toEqual({ id: "d", secretAccessKeySet: false });
		expect(
			loose(
				buildCacheRegistryApiJson({
					id: "r",
					passwordEnc: "x",
				} as unknown as BuildCacheRegistry),
			),
		).toEqual({ id: "r", passwordSet: true });
		expect(
			gitProviderApiJson({
				baseUrl: null,
				clientId: "id",
				clientSecretEnc: "x",
				enabled: true,
				id: "g",
				kind: "gitlab",
				name: "GitLab",
			}),
		).toMatchObject({ clientSecretSet: true, id: "g" });
		expect(
			redactedChannelTarget("slack", "https://hooks.slack.com/services/T/B/x"),
		).toBe("https://hooks.slack.com/…");
		expect(redactedChannelTarget("webhook", "not a url")).toBe("…");
		expect(redactedChannelTarget("email", "me@example.com")).toBe(
			"me@example.com",
		);
		expect(
			loose(
				notificationChannelApiJson({
					id: "n",
					kind: "discord",
					target: "https://discord.com/api/webhooks/1/abc",
				} as unknown as NotificationChannel),
			),
		).toEqual({
			id: "n",
			kind: "discord",
			targetLabel: "https://discord.com/…",
		});
	});

	test("status pages carry their picks and buckets a composite id", () => {
		expect(
			loose(
				statusPageApiJson({ id: "p" } as unknown as StatusPage, [
					{ includeChildren: true, serviceId: "s" },
				]),
			),
		).toEqual({
			id: "p",
			services: [{ includeChildren: true, serviceId: "s" }],
		});
		expect(bucketApiJson("s1", "state", 7, true)).toEqual({
			expirationDays: 7,
			id: "s1/state",
			name: "state",
			public: true,
			storeId: "s1",
		});
	});
});
