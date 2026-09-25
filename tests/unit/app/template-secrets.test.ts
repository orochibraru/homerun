import { describe, expect, test } from "bun:test";
import { isDatabaseImage } from "../../../src/lib/service-link";
import {
	fillSecretInEnv,
	fillSecretInRuntime,
	generateTemplateSecret,
	SECRET_TOKEN,
	submittedSecret,
} from "../../../src/lib/template-secrets";

const runtime = {
	capAdd: [],
	command: ["redis-server", "--requirepass", SECRET_TOKEN],
	devices: [],
	entrypoint: null,
	envFiles: [],
	labels: {},
	privileged: false,
};

describe("template secrets", () => {
	test("a generated secret is 48 hex characters and fresh every time", () => {
		const secret = generateTemplateSecret();
		expect(secret).toMatch(/^[0-9a-f]{48}$/);
		expect(generateTemplateSecret()).not.toBe(secret);
	});

	test("one secret fills the env and the command alike", () => {
		expect(
			fillSecretInEnv(
				{ OTHER: "x", REDIS_PASSWORD: SECRET_TOKEN, URL: `a:${SECRET_TOKEN}` },
				"s3",
			),
		).toEqual({ OTHER: "x", REDIS_PASSWORD: "s3", URL: "a:s3" });
		expect(fillSecretInRuntime(runtime, "s3").command).toEqual([
			"redis-server",
			"--requirepass",
			"s3",
		]);
		expect(fillSecretInRuntime(runtime, "s3").entrypoint).toBeNull();
	});

	test("the wizard's command uses the password the form actually submitted", () => {
		const template = { REDIS_PASSWORD: SECRET_TOKEN };
		expect(submittedSecret(template, { REDIS_PASSWORD: "edited" })).toBe(
			"edited",
		);
		expect(submittedSecret(template, { REDIS_PASSWORD: "" })).toBeNull();
		expect(submittedSecret({ A: "b" }, { A: "b" })).toBeNull();
	});

	test("memcached counts as a datastore", () => {
		expect(isDatabaseImage("memcached")).toBe(true);
		expect(isDatabaseImage("bitnami/memcached")).toBe(true);
		expect(isDatabaseImage("nginx")).toBe(false);
	});
});
