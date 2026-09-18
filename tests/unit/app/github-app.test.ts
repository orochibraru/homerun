import { afterEach, describe, expect, mock, test } from "bun:test";
import {
	convertGithubAppManifest,
	githubAppRegistration,
} from "$lib/github-app";

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("githubAppRegistration", () => {
	const input = {
		name: "homerun-acme",
		org: null,
		origin: "https://dash.example.com",
		providerId: "p1",
		state: "s/t+ate",
	};

	test("targets the personal account and carries the encoded state", () => {
		expect(githubAppRegistration(input).action).toBe(
			"https://github.com/settings/apps/new?state=s%2Ft%2Bate",
		);
	});

	test("targets an organization's settings when one is given", () => {
		expect(githubAppRegistration({ ...input, org: "acme" }).action).toStartWith(
			"https://github.com/organizations/acme/settings/apps/new?state=",
		);
	});

	test("points GitHub back at the provider's own routes", () => {
		const manifest = JSON.parse(githubAppRegistration(input).manifest);
		expect(manifest.redirect_url).toBe(
			"https://dash.example.com/api/v1/git-providers/p1/github-app",
		);
		expect(manifest.callback_urls).toEqual([
			"https://dash.example.com/api/v1/git-providers/p1/callback",
		]);
		expect(manifest.public).toBe(false);
		expect(manifest.default_permissions.repository_hooks).toBe("write");
		expect(manifest.default_permissions.contents).toBe("read");
	});
});

describe("convertGithubAppManifest", () => {
	test("maps GitHub's answer onto the app's credentials", async () => {
		const fetchMock = mock(async (_url: string) =>
			Response.json({
				client_id: "Iv1.abc",
				client_secret: "shh",
				html_url: "https://github.com/apps/homerun-acme",
				name: "homerun-acme",
			}),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		expect(await convertGithubAppManifest("c0de")).toEqual({
			clientId: "Iv1.abc",
			clientSecret: "shh",
			htmlUrl: "https://github.com/apps/homerun-acme",
			name: "homerun-acme",
		});
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			"https://api.github.com/app-manifests/c0de/conversions",
		);
	});

	test("throws when GitHub refuses the code", async () => {
		globalThis.fetch = mock(
			async () => new Response("gone", { status: 404 }),
		) as unknown as typeof fetch;
		await expect(convertGithubAppManifest("old")).rejects.toThrow("404");
	});
});
