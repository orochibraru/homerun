import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { decodeProtectedHeader, importSPKI, jwtVerify } from "jose";
import { googleCloudDns } from "../../../../src/lib/services/dns-providers/google-cloud-dns";
import { type StubbedCall, stubFetch } from "./stub-fetch";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { format: "pem", type: "pkcs8" },
	publicKeyEncoding: { format: "pem", type: "spki" },
});

const key = JSON.stringify({
	client_email: "homerun@proj-1.iam.gserviceaccount.com",
	private_key: privateKey,
	private_key_id: "kid-1",
	project_id: "proj-1",
	token_uri: "https://oauth2.googleapis.com/token",
	type: "service_account",
});

const API = "https://dns.googleapis.com/dns/v1/projects/proj-1";
const zone = { id: "example-zone", name: "example.com" };

const tokenAnswer = {
	access_token: "at-1",
	expires_in: 3600,
	token_type: "Bearer",
};

/** Answers the token exchange, and hands every other call to `handler`. */
function withToken(handler: (request: StubbedCall) => unknown) {
	return stubFetch((request) =>
		request.url === "https://oauth2.googleapis.com/token"
			? tokenAnswer
			: handler(request),
	);
}

afterEach(() => stubFetch.restore());

describe("Google Cloud DNS", () => {
	test("exchanges an RS256 JWT signed by the service account key, once", async () => {
		const calls = withToken(() => ({ managedZones: [] }));
		const client = googleCloudDns.create({ serviceAccountKey: key });
		await client.listZones();
		await client.listZones();
		const tokens = calls.filter((call) => call.url.includes("oauth2"));
		expect(tokens).toHaveLength(1);
		expect(tokens[0]?.method).toBe("POST");
		expect(tokens[0]?.headers.get("content-type")).toBe(
			"application/x-www-form-urlencoded",
		);
		const form = new URLSearchParams(tokens[0]?.body ?? "");
		expect(form.get("grant_type")).toBe(
			"urn:ietf:params:oauth:grant-type:jwt-bearer",
		);
		const assertion = form.get("assertion") ?? "";
		expect(decodeProtectedHeader(assertion)).toEqual({
			alg: "RS256",
			kid: "kid-1",
			typ: "JWT",
		});
		const { payload } = await jwtVerify(
			assertion,
			await importSPKI(publicKey, "RS256"),
		);
		expect(payload.iss).toBe("homerun@proj-1.iam.gserviceaccount.com");
		expect(payload.scope).toBe(
			"https://www.googleapis.com/auth/ndev.clouddns.readwrite",
		);
		expect(payload.aud).toBe("https://oauth2.googleapis.com/token");
		expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(3600);
		expect(calls[1]?.headers.get("authorization")).toBe("Bearer at-1");
	});

	test("lists every page of zones, under an overridden project", async () => {
		const calls = withToken((request) =>
			new URL(request.url).searchParams.get("pageToken")
				? { managedZones: [{ dnsName: "other.org.", name: "other" }] }
				: {
						managedZones: [{ dnsName: "Example.com.", name: "example-zone" }],
						nextPageToken: "p2",
					},
		);
		const client = googleCloudDns.create({
			projectId: "proj-2",
			serviceAccountKey: key,
		});
		expect(await client.listZones()).toEqual([
			{ id: "example-zone", name: "example.com" },
			{ id: "other", name: "other.org" },
		]);
		expect(calls.slice(1).map((call) => `${call.method} ${call.url}`)).toEqual([
			"GET https://dns.googleapis.com/dns/v1/projects/proj-2/managedZones",
			"GET https://dns.googleapis.com/dns/v1/projects/proj-2/managedZones?pageToken=p2",
		]);
	});

	test("splits every rrset value into its own record", async () => {
		const calls = withToken((request) =>
			new URL(request.url).searchParams.get("pageToken")
				? {
						rrsets: [
							{
								name: "example.com.",
								rrdatas: ['"v=spf1 " "-all"', '"say \\"hi\\""'],
								ttl: 300,
								type: "TXT",
							},
						],
					}
				: {
						nextPageToken: "n",
						rrsets: [
							{
								name: "App.example.com.",
								rrdatas: ["example.com."],
								ttl: 60,
								type: "CNAME",
							},
							{
								name: "example.com.",
								rrdatas: ["10 mx1.example.com.", "20 mx2.example.com."],
								ttl: 3600,
								type: "MX",
							},
						],
					},
		);
		const records = await googleCloudDns
			.create({ serviceAccountKey: key })
			.listRecords(zone);
		expect(calls[1]?.url).toBe(`${API}/managedZones/example-zone/rrsets`);
		expect(calls[2]?.url).toBe(
			`${API}/managedZones/example-zone/rrsets?pageToken=n`,
		);
		expect(records).toEqual([
			{
				content: "example.com",
				id: "CNAME:app.example.com:example.com",
				name: "app.example.com",
				priority: null,
				ttl: 60,
				type: "CNAME",
			},
			{
				content: "mx1.example.com",
				id: "MX:example.com:mx1.example.com",
				name: "example.com",
				priority: 10,
				ttl: 3600,
				type: "MX",
			},
			{
				content: "mx2.example.com",
				id: "MX:example.com:mx2.example.com",
				name: "example.com",
				priority: 20,
				ttl: 3600,
				type: "MX",
			},
			{
				content: "v=spf1 -all",
				id: "TXT:example.com:v=spf1 -all",
				name: "example.com",
				priority: null,
				ttl: 300,
				type: "TXT",
			},
			{
				content: 'say "hi"',
				id: 'TXT:example.com:say "hi"',
				name: "example.com",
				priority: null,
				ttl: 300,
				type: "TXT",
			},
		]);
	});

	test("creates a new rrset, adds to an existing one, and rewrites it on update and delete", async () => {
		const sets: Record<string, { rrdatas: string[]; ttl: number }> = {
			"mail.example.com./MX": { rrdatas: ["10 mx1.example.com."], ttl: 600 },
		};
		const calls = withToken((request) => {
			const path = decodeURIComponent(new URL(request.url).pathname);
			const key = path.split("/rrsets/")[1] ?? "";
			if (request.method === "GET") {
				const set = sets[key];
				return set
					? { name: key.split("/")[0], type: key.split("/")[1], ...set }
					: {
							body: { error: { code: 404, message: "not found" } },
							status: 404,
						};
			}
			if (request.method === "DELETE") {
				return {};
			}
			return JSON.parse(request.body ?? "{}");
		});
		const client = googleCloudDns.create({ serviceAccountKey: key });

		const a = await client.createRecord(zone, {
			content: "1.2.3.4",
			name: "App.example.com",
			type: "A",
		});
		expect(a).toEqual({
			content: "1.2.3.4",
			id: "A:app.example.com:1.2.3.4",
			name: "app.example.com",
			priority: null,
			ttl: 300,
			type: "A",
		});
		expect(calls[1]?.url).toBe(
			`${API}/managedZones/example-zone/rrsets/app.example.com./A`,
		);
		expect(calls[2]?.method).toBe("POST");
		expect(calls[2]?.url).toBe(`${API}/managedZones/example-zone/rrsets`);
		expect(JSON.parse(calls[2]?.body ?? "{}")).toEqual({
			name: "app.example.com.",
			rrdatas: ["1.2.3.4"],
			ttl: 300,
			type: "A",
		});

		const mx = await client.createRecord(zone, {
			content: "mx2.example.com",
			name: "mail.example.com",
			priority: 20,
			type: "MX",
		});
		expect(mx.priority).toBe(20);
		expect(calls[4]?.method).toBe("PATCH");
		expect(calls[4]?.url).toBe(
			`${API}/managedZones/example-zone/rrsets/mail.example.com./MX`,
		);
		expect(JSON.parse(calls[4]?.body ?? "{}")).toEqual({
			name: "mail.example.com.",
			rrdatas: ["10 mx1.example.com.", "20 mx2.example.com."],
			ttl: 600,
			type: "MX",
		});

		sets["mail.example.com./MX"] = {
			rrdatas: ["10 mx1.example.com.", "20 mx2.example.com."],
			ttl: 600,
		};
		await client.updateRecord(zone, mx, {
			content: "mx3.example.com",
			name: "mail.example.com",
			priority: 30,
			ttl: 120,
			type: "MX",
		});
		expect(calls[6]?.method).toBe("PATCH");
		expect(JSON.parse(calls[6]?.body ?? "{}").rrdatas).toEqual([
			"10 mx1.example.com.",
			"30 mx3.example.com.",
		]);
		expect(JSON.parse(calls[6]?.body ?? "{}").ttl).toBe(120);

		await client.deleteRecord(zone, mx);
		expect(calls[8]?.method).toBe("PATCH");
		expect(JSON.parse(calls[8]?.body ?? "{}").rrdatas).toEqual([
			"10 mx1.example.com.",
		]);

		sets["mail.example.com./MX"] = {
			rrdatas: ["20 mx2.example.com."],
			ttl: 600,
		};
		await client.deleteRecord(zone, mx);
		expect(calls[10]?.method).toBe("DELETE");
		expect(calls[10]?.url).toBe(
			`${API}/managedZones/example-zone/rrsets/mail.example.com./MX`,
		);

		const before = calls.length;
		await client.deleteRecord(zone, a);
		expect(calls).toHaveLength(before + 1);
	});

	test("writes long TXT values as quoted 255-character strings", async () => {
		const calls = withToken((request) =>
			request.method === "GET"
				? { body: { error: { code: 404, message: "nope" } }, status: 404 }
				: JSON.parse(request.body ?? "{}"),
		);
		await googleCloudDns.create({ serviceAccountKey: key }).createRecord(zone, {
			content: `${"a".repeat(255)}b"c`,
			name: "example.com",
			type: "TXT",
		});
		expect(JSON.parse(calls[2]?.body ?? "{}").rrdatas).toEqual([
			`"${"a".repeat(255)}" "b\\"c"`,
		]);
	});

	test("a failed call names Google's own error", async () => {
		withToken(() => ({
			body: {
				error: {
					code: 403,
					message: "Forbidden: dns.managedZones.list denied",
					status: "PERMISSION_DENIED",
				},
			},
			status: 403,
		}));
		await expect(
			googleCloudDns.create({ serviceAccountKey: key }).listZones(),
		).rejects.toThrow(
			"Google Cloud DNS 403: PERMISSION_DENIED: Forbidden: dns.managedZones.list denied",
		);
	});

	test("a rejected token exchange names the OAuth error", async () => {
		stubFetch(() => ({
			body: {
				error: "invalid_grant",
				error_description: "Invalid JWT Signature.",
			},
			status: 400,
		}));
		await expect(
			googleCloudDns.create({ serviceAccountKey: key }).listZones(),
		).rejects.toThrow(
			"Google Cloud DNS 400: invalid_grant: Invalid JWT Signature.",
		);
	});

	test("a key that isn't JSON fails before any call", async () => {
		const calls = stubFetch(() => ({}));
		await expect(
			googleCloudDns.create({ serviceAccountKey: "nope" }).listZones(),
		).rejects.toThrow("isn't JSON");
		expect(calls).toHaveLength(0);
	});
});
