import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
	apiCaller,
	apiError,
	readApiBody,
} from "../../../src/lib/server/api-route";
import {
	cronJobApiBody,
	notificationChannelApiBody,
	serviceEnvironmentApiBody,
	updateBucketApiBody,
	updateCronJobApiBody,
	updateStatusPageApiBody,
	volumeMountApiBody,
} from "../../../src/lib/server/validation/api-resources";

function jsonRequest(body: string): Request {
	return new Request("http://localhost/api/v1/x", { body, method: "POST" });
}

describe("api route helpers", () => {
	test("refuses anonymous and non-admin callers", async () => {
		const anonymous = apiCaller({});
		expect("refused" in anonymous && anonymous.refused.status).toBe(401);
		const developer = apiCaller(
			{ isAdmin: false, user: { id: "u" } },
			{ adminOnly: true },
		);
		expect("refused" in developer && (await developer.refused.json())).toEqual({
			error: "Admins only.",
		});
		expect(
			apiCaller({ isAdmin: true, user: { id: "u" } }, { adminOnly: true }),
		).toEqual({
			isAdmin: true,
			userId: "u",
		});
		expect(apiError("Nope").status).toBe(400);
	});

	test("reads a body or answers 400", async () => {
		const schema = z.object({ name: z.string() });
		expect(await readApiBody(jsonRequest('{"name":"a"}'), schema)).toEqual({
			data: { name: "a" },
		});
		const invalid = await readApiBody(jsonRequest("not json"), schema);
		expect("response" in invalid && invalid.response.status).toBe(400);
	});
});

describe("resource bodies", () => {
	test("fill in defaults and validate", () => {
		expect(
			serviceEnvironmentApiBody.parse({
				name: "Staging",
				ref: "develop",
				serviceId: "s",
			}),
		).toEqual({
			deploy: false,
			envOverrides: {},
			name: "staging",
			ref: "develop",
			serviceId: "s",
		});
		expect(
			volumeMountApiBody.safeParse({
				containerPath: "data",
				serviceId: "s",
				volumeId: "v",
			}).success,
		).toBe(false);
		expect(
			cronJobApiBody.parse({
				kind: "image",
				name: "Job",
				schedule: "* * * * *",
			}).enabled,
		).toBe(false);
		expect(updateCronJobApiBody.parse({})).toEqual({});
		expect(
			notificationChannelApiBody.safeParse({
				events: ["nope"],
				kind: "webhook",
				name: "n",
				target: "https://x.io",
			}).success,
		).toBe(false);
		expect(updateStatusPageApiBody.parse({ name: "Status" })).toEqual({
			name: "Status",
		});
		expect(updateBucketApiBody.parse({ expirationDays: null })).toEqual({
			expirationDays: null,
		});
	});
});
