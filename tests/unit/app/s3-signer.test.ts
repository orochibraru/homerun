import { describe, expect, mock, test } from "bun:test";

const { expectS3Ok, s3Fetch, signS3Request } = await import(
	"../../../src/lib/services/s3/signer"
);

const aws = {
	accessKeyId: "AKIAIOSFODNN7EXAMPLE",
	endpoint: "https://examplebucket.s3.amazonaws.com",
	region: "us-east-1",
	secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
const when = new Date("2013-05-24T00:00:00Z");

function signatureOf(authorization: string | undefined): string | undefined {
	return authorization?.match(/Signature=([0-9a-f]+)/)?.[1];
}

describe("signS3Request against AWS's published examples", () => {
	test("GET an object with a Range header", () => {
		const signed = signS3Request(
			aws,
			{ headers: { Range: "bytes=0-9" }, method: "GET", path: "/test.txt" },
			when,
		);
		expect(signed.headers.authorization).toContain(
			"SignedHeaders=host;range;x-amz-content-sha256;x-amz-date",
		);
		expect(signatureOf(signed.headers.authorization)).toBe(
			"f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
		);
	});

	test("GET a bucket's lifecycle, a query parameter with no value", () => {
		const signed = signS3Request(
			aws,
			{ method: "GET", path: "/", query: { lifecycle: "" } },
			when,
		);
		expect(signed.url.search).toBe("?lifecycle=");
		expect(signatureOf(signed.headers.authorization)).toBe(
			"fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543",
		);
	});

	test("list objects, query parameters sorted", () => {
		const signed = signS3Request(
			aws,
			{ method: "GET", path: "/", query: { prefix: "J", "max-keys": "2" } },
			when,
		);
		expect(signatureOf(signed.headers.authorization)).toBe(
			"34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7",
		);
	});

	test("encodes each path segment once and collapses slashes", () => {
		const signed = signS3Request(aws, {
			method: "GET",
			path: "//bucket//a b/(c).tfstate",
		});
		expect(signed.url.pathname).toBe("/bucket/a%20b/%28c%29.tfstate");
	});
});

describe("s3Fetch", () => {
	test("sends the signed headers and the body", async () => {
		const fetcher = mock(
			async (_url: URL | RequestInfo, _init?: RequestInit) =>
				new Response("ok"),
		);
		await s3Fetch(
			aws,
			{ body: "hello", method: "PUT", path: "/b/k" },
			fetcher as unknown as typeof fetch,
		);
		const [url, init] = fetcher.mock.calls[0];
		expect(String(url)).toBe("https://examplebucket.s3.amazonaws.com/b/k");
		expect(init?.method).toBe("PUT");
		expect(init?.body).toBe("hello");
		const headers = init?.headers as Record<string, string> | undefined;
		expect(headers?.authorization).toStartWith(
			"AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/",
		);
	});
});

describe("expectS3Ok", () => {
	test("passes a success through", async () => {
		await expect(
			expectS3Ok(new Response("", { status: 200 }), "X"),
		).resolves.toBeUndefined();
	});

	test("surfaces the store's own code and message", async () => {
		await expect(
			expectS3Ok(
				new Response(
					"<Error><Code>AccessDenied</Code><Message>Nope</Message></Error>",
					{ status: 403, statusText: "Forbidden" },
				),
				"PutObject",
			),
		).rejects.toThrow("S3 PutObject failed: 403 Forbidden AccessDenied: Nope");
		await expect(
			expectS3Ok(new Response("plain", { status: 500 }), "GetObject"),
		).rejects.toThrow("plain");
	});
});
