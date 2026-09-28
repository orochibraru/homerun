import { describe, expect, test } from "bun:test";
import { isDatabaseImage } from "../../../src/lib/service-link";
import {
	fillSecretInEnv,
	fillSecretInRuntime,
	generateTemplateSecret,
	SECRET_TOKEN,
	secretEnvKeysOf,
	secretTokensValid,
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
	runAsUser: null,
};

describe("template secrets", () => {
	test("the vars filled from {{secret}} start out marked secret", () => {
		expect(
			secretEnvKeysOf({
				DB_URL: `postgres://u:${SECRET_TOKEN}@db/app`,
				REDIS_PASSWORD: SECRET_TOKEN,
				TZ: "UTC",
			}),
		).toEqual(["DB_URL", "REDIS_PASSWORD"]);
	});

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

	test("{{secret:hex<N>}} fills N fresh hex characters per occurrence", () => {
		const env = fillSecretInEnv(
			{
				KEY: "{{secret:hex64}}",
				ODD: "k={{secret:hex7}}",
				OTHER: "{{secret:hex64}}",
			},
			"s1",
		);
		expect(env.KEY).toMatch(/^[0-9a-f]{64}$/);
		expect(env.ODD).toMatch(/^k=[0-9a-f]{7}$/);
		expect(env.OTHER).not.toBe(env.KEY);
		expect(
			fillSecretInRuntime(
				{ ...runtime, command: ["--key", "{{secret:hex32}}"] },
				"s1",
			).command?.[1],
		).toMatch(/^[0-9a-f]{32}$/);
	});

	test("hex secret vars start out marked secret too", () => {
		expect(
			secretEnvKeysOf({ KEY: "{{secret:hex64}}", TZ: "{{secret:hex}}" }),
		).toEqual(["KEY"]);
	});

	test("only {{secret}} and {{secret:hex1..999}} are valid tokens", () => {
		expect(secretTokensValid("a {{secret}} {{secret:hex64}} {{db.X}}")).toBe(
			true,
		);
		expect(secretTokensValid("{{secret:hex0}}")).toBe(false);
		expect(secretTokensValid("{{secret:hex1000}}")).toBe(false);
		expect(secretTokensValid("{{secret:base64}}")).toBe(false);
	});
});
