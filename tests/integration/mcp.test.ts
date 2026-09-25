import { describe, expect, test } from "bun:test";
import { nativeFetch } from "./support/config";
import { integrationContext } from "./support/context";

const MCP_HEADERS = {
	accept: "application/json, text/event-stream",
	"content-type": "application/json",
};

interface RpcAnswer {
	error?: { message: string };
	result?: {
		content?: { text: string }[];
		isError?: boolean;
		tools?: { name: string }[];
	};
}

async function readRpc(res: Response): Promise<RpcAnswer> {
	const text = await res.text();
	if (res.headers.get("content-type")?.includes("text/event-stream")) {
		const data = text
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trim())
			.at(-1);
		return JSON.parse(data ?? "{}") as RpcAnswer;
	}
	return JSON.parse(text) as RpcAnswer;
}

function rpc(
	credentials: Record<string, string>,
	method: string,
	params: Record<string, unknown> = {},
): Promise<Response> {
	return nativeFetch(`${integrationContext().origin}/api/v1/mcp`, {
		body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
		headers: {
			...MCP_HEADERS,
			...credentials,
			"mcp-protocol-version": "2025-06-18",
		},
		method: "POST",
	});
}

async function initialize(credentials: Record<string, string>): Promise<void> {
	const res = await rpc(credentials, "initialize", {
		capabilities: {},
		clientInfo: { name: "integration", version: "0" },
		protocolVersion: "2025-06-18",
	});
	expect(res.status).toBe(200);
}

async function pkcePair(): Promise<{ challenge: string; verifier: string }> {
	const verifier = crypto.randomUUID() + crypto.randomUUID();
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(verifier),
	);
	const challenge = Buffer.from(digest).toString("base64url");
	return { challenge, verifier };
}

describe("MCP server", () => {
	test("an anonymous call is challenged with where to find the resource metadata", async () => {
		const { origin } = integrationContext();
		const res = await rpc({}, "tools/list");
		expect(res.status).toBe(401);
		expect(res.headers.get("www-authenticate")).toBe(
			`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/v1/mcp"`,
		);
	});

	test("the protected resource and authorization server metadata are served at the root", async () => {
		const { origin } = integrationContext();
		const resource = await nativeFetch(
			`${origin}/.well-known/oauth-protected-resource/api/v1/mcp`,
		);
		expect(resource.status).toBe(200);
		const resourceBody = (await resource.json()) as {
			authorization_servers: string[];
			resource: string;
		};
		expect(resourceBody.resource).toBe(`${origin}/api/v1/mcp`);

		const server = await nativeFetch(
			`${origin}/.well-known/oauth-authorization-server/api/v1/auth`,
		);
		expect(server.status).toBe(200);
		const serverBody = (await server.json()) as {
			issuer: string;
			registration_endpoint?: string;
		};
		expect(resourceBody.authorization_servers).toEqual([serverBody.issuer]);
		expect(serverBody.registration_endpoint).toBe(
			`${origin}/api/v1/auth/oauth2/register`,
		);
	});

	test("an API key lists the tools and runs one", async () => {
		const key = { "x-api-key": integrationContext().apiKey };
		await initialize(key);

		const listed = await readRpc(await rpc(key, "tools/list"));
		const names = listed.result?.tools?.map((tool) => tool.name) ?? [];
		expect(names).toContain("get_service_config");
		expect(names).toContain("deploy_service");
		expect(names).not.toContain("delete_service");

		const called = await readRpc(
			await rpc(key, "tools/call", { arguments: {}, name: "list_services" }),
		);
		expect(called.result?.isError).toBeFalsy();
		expect(
			Array.isArray(JSON.parse(called.result?.content?.[0]?.text ?? "")),
		).toBe(true);

		const missing = await readRpc(
			await rpc(key, "tools/call", {
				arguments: { serviceId: "no-such-service" },
				name: "get_service_config",
			}),
		);
		expect(missing.result?.isError).toBe(true);
		expect(missing.result?.content?.[0]?.text).toStartWith("HTTP 404");
	});

	test("a client that registers itself, signs in and consents gets a token the MCP endpoint accepts", async () => {
		const { origin } = integrationContext();
		const redirectUri = "https://claude.example/api/mcp/auth_callback";
		const resource = `${origin}/api/v1/mcp`;

		const registered = await nativeFetch(
			`${origin}/api/v1/auth/oauth2/register`,
			{
				body: JSON.stringify({
					client_name: "Integration MCP client",
					grant_types: ["authorization_code", "refresh_token"],
					redirect_uris: [redirectUri],
					response_types: ["code"],
					token_endpoint_auth_method: "none",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			},
		);
		expect(registered.status).toBeLessThan(300);
		const { client_id: clientId } = (await registered.json()) as {
			client_id: string;
		};

		const signedIn = await nativeFetch(`${origin}/api/v1/auth/sign-in/email`, {
			body: JSON.stringify({
				email: "admin@integration.test",
				password: "integration-test-password-1234",
			}),
			headers: { "content-type": "application/json", origin },
			method: "POST",
		});
		expect(signedIn.status).toBe(200);
		const cookie = signedIn.headers
			.getSetCookie()
			.map((entry) => entry.split(";")[0])
			.join("; ");

		const { challenge, verifier } = await pkcePair();
		const authorizeUrl = new URL(`${origin}/api/v1/auth/oauth2/authorize`);
		for (const [name, value] of Object.entries({
			client_id: clientId,
			code_challenge: challenge,
			code_challenge_method: "S256",
			redirect_uri: redirectUri,
			resource,
			response_type: "code",
			scope: "openid offline_access",
			state: "integration",
		})) {
			authorizeUrl.searchParams.set(name, value);
		}
		const authorized = await nativeFetch(authorizeUrl, {
			headers: { cookie },
			redirect: "manual",
		});
		const consentUrl = new URL(
			authorized.headers.get("location") ?? "",
			origin,
		);
		expect(consentUrl.pathname).toBe("/auth/consent");

		const consented = await nativeFetch(
			`${origin}/api/v1/auth/oauth2/consent`,
			{
				body: JSON.stringify({
					accept: true,
					oauth_query: consentUrl.search.slice(1),
				}),
				headers: { "content-type": "application/json", cookie, origin },
				method: "POST",
			},
		);
		expect(consented.status).toBe(200);
		const { url: callback } = (await consented.json()) as { url: string };
		const code = new URL(callback).searchParams.get("code") ?? "";
		expect(code).not.toBe("");

		const tokened = await nativeFetch(`${origin}/api/v1/auth/oauth2/token`, {
			body: new URLSearchParams({
				client_id: clientId,
				code,
				code_verifier: verifier,
				grant_type: "authorization_code",
				redirect_uri: redirectUri,
				resource,
			}),
			headers: { "content-type": "application/x-www-form-urlencoded" },
			method: "POST",
		});
		expect(tokened.status).toBe(200);
		const { access_token: accessToken } = (await tokened.json()) as {
			access_token: string;
		};

		const bearer = { authorization: `Bearer ${accessToken}` };
		await initialize(bearer);
		const called = await readRpc(
			await rpc(bearer, "tools/call", { arguments: {}, name: "list_stacks" }),
		);
		expect(called.result?.isError).toBeFalsy();

		const forged = await rpc(
			{ authorization: `Bearer ${accessToken.slice(0, -4)}AAAA` },
			"tools/list",
		);
		expect(forged.status).toBe(401);
	});
});
