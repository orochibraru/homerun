import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const updateApiKey = mock(async (_input: unknown) => ({}));
const deleteApiKey = mock(async (_input: unknown) => ({}));
const listApiKeys = mock(
	async (_input: unknown): Promise<unknown> => ({
		apiKeys: [],
	}),
);

mock.module("#lib/services/auth.js", () => ({
	auth: { api: { deleteApiKey, listApiKeys, updateApiKey } },
	rebuildAuth: () => undefined,
}));

const { listOwnApiKeys, revokeApiKeyAction, updateApiKeyAction } = await import(
	"../../../src/lib/server/api-keys"
);

function form(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [name, value] of Object.entries(fields)) {
		data.set(name, value);
	}
	return data;
}

beforeEach(() => {
	updateApiKey.mockClear();
	updateApiKey.mockImplementation(async () => ({}));
	deleteApiKey.mockClear();
	deleteApiKey.mockImplementation(async () => ({}));
});

describe("listOwnApiKeys", () => {
	test("maps each key, null permissions meaning all of them", async () => {
		const createdAt = new Date();
		listApiKeys.mockImplementation(async () => ({
			apiKeys: [
				{
					createdAt,
					enabled: null,
					expiresAt: null,
					id: "k1",
					lastRequest: null,
					name: "CI",
					permissions: { services: ["write"] },
					prefix: "hr_",
					start: "abcd",
				},
				{
					createdAt,
					enabled: false,
					expiresAt: null,
					id: "k2",
					lastRequest: null,
					name: null,
					permissions: null,
					prefix: null,
					start: null,
				},
			],
		}));
		const keys = await listOwnApiKeys(new Headers());
		expect(keys[0]).toMatchObject({
			enabled: true,
			id: "k1",
			permissions: { services: "write" },
		});
		expect(keys[1]).toMatchObject({ enabled: false, permissions: null });
	});

	test("an empty list when better-auth refuses", async () => {
		listApiKeys.mockImplementation(async () => {
			throw new Error("down");
		});
		expect(await listOwnApiKeys(new Headers())).toEqual([]);
	});
});

describe("revokeApiKeyAction", () => {
	function request(keyId: string): Request {
		return new Request("http://localhost/", {
			body: form({ keyId }),
			method: "POST",
		});
	}

	test("deletes the key as the signed-in user", async () => {
		expect(await revokeApiKeyAction(request("k1"), "u1")).toEqual({
			revoked: true,
		});
		expect(deleteApiKey.mock.calls[0][0]).toMatchObject({
			body: { keyId: "k1" },
		});
	});

	test("refuses a missing id and reports a refused delete", async () => {
		expect(await revokeApiKeyAction(request(" "), "u1")).toMatchObject({
			status: 400,
		});
		deleteApiKey.mockImplementation(async () => {
			throw new Error("nope");
		});
		expect(await revokeApiKeyAction(request("k1"), "u1")).toMatchObject({
			data: { error: "Couldn't revoke that key." },
		});
	});
});

describe("updateApiKeyAction", () => {
	test("cuts the permissions down to what the owner holds", async () => {
		const result = await updateApiKeyAction(
			"k1",
			"u1",
			{ services: "read" },
			form({
				name: " CI ",
				"permission.dns": "write",
				"permission.services": "write",
			}),
		);
		expect(result).toEqual({ updated: true });
		expect(updateApiKey).toHaveBeenCalledWith({
			body: {
				keyId: "k1",
				name: "CI",
				permissions: { services: ["read"] },
				userId: "u1",
			},
		});
	});

	test("all permissions clears the list", async () => {
		await updateApiKeyAction("k1", "u1", {}, form({ allPermissions: "on" }));
		expect(updateApiKey.mock.calls[0][0]).toMatchObject({
			body: { name: "API key", permissions: null },
		});
	});

	test("refuses an empty list and reports a refused update", async () => {
		const empty = await updateApiKeyAction("k1", "u1", {}, form({}));
		expect(empty).toMatchObject({ status: 400 });
		expect(updateApiKey).not.toHaveBeenCalled();

		updateApiKey.mockImplementation(async () => {
			throw new Error("KEY_NOT_FOUND");
		});
		const refused = await updateApiKeyAction(
			"k1",
			"u1",
			{ services: "write" },
			form({ "permission.services": "read" }),
		);
		expect(refused).toMatchObject({
			data: { error: "Couldn't update that key." },
			status: 400,
		});
	});
});
