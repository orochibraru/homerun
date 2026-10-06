import { describe, expect, test } from "bun:test";

const { normalizeStatusDomains, STATUS_PAGE_SERVICE, statusPagesConfig } =
	await import("../../../src/lib/status-page-domains");

describe("normalizeStatusDomains", () => {
	test("lowercases, trims, dedupes, from a list or text", () => {
		expect(
			normalizeStatusDomains(
				" Status.Example.com, status.example.com\nup.example.org. ",
			),
		).toEqual({
			domains: ["status.example.com", "up.example.org"],
		});
		expect(normalizeStatusDomains(["A.example.com", ""])).toEqual({
			domains: ["a.example.com"],
		});
		expect(normalizeStatusDomains("")).toEqual({ domains: [] });
	});

	test("refuses what isn't a domain", () => {
		expect(normalizeStatusDomains("localhost")).toEqual({
			error: '"localhost" isn\'t a domain, e.g. status.example.com.',
		});
		expect(
			normalizeStatusDomains(["https://status.example.com"]),
		).toMatchObject({
			error: expect.stringContaining("isn't a domain"),
		});
	});
});

describe("statusPagesConfig", () => {
	const options = {
		certResolverFor: (host: string) =>
			host.endsWith(".internal") ? null : "le",
		entrypoint: "websecure",
		target: "http://homerun-auth:3000",
	};

	test("is null when no public page has a domain", () => {
		expect(statusPagesConfig([], options)).toBeNull();
		expect(
			statusPagesConfig(
				[
					{ domains: ["status.example.com"], isPublic: false, slug: "prod" },
					{ domains: [], isPublic: true, slug: "lab" },
				],
				options,
			),
		).toBeNull();
	});

	test("routes only the page's paths on each domain, with its own TLS", () => {
		const yaml = statusPagesConfig(
			[
				{
					domains: ["status.example.com", "status.lab.internal"],
					isPublic: true,
					slug: "prod",
				},
			],
			options,
		) as string;
		expect(yaml).toContain(
			"rule: Host(`status.example.com`) && (Path(`/`) || PathPrefix(`/status/prod`) || PathPrefix(`/_app/`) || Path(`/favicon.svg`) || Path(`/robots.txt`))",
		);
		expect(yaml).toContain("homerun-status-prod-1:");
		expect(yaml).toContain("certResolver: le");
		expect(yaml).toContain("tls: {}");
		expect(yaml).toContain(`service: ${STATUS_PAGE_SERVICE}`);
		expect(yaml).toContain("- url: http://homerun-auth:3000");
	});

	test("redirects the domain's root to the page, keeping the query", () => {
		const yaml = statusPagesConfig(
			[{ domains: ["status.example.com"], isPublic: true, slug: "prod" }],
			options,
		) as string;
		const regex = new RegExp(
			(yaml.match(/regex: '(.*)'/) as RegExpMatchArray)[1],
		);
		const replacement = (
			yaml.match(/replacement: '(.*)'/) as RegExpMatchArray
		)[1];
		const apply = (url: string) =>
			url.replace(
				regex,
				(_all, scheme: string, host: string, query: string | undefined) =>
					replacement
						.replace("${1}", scheme)
						.replace("${2}", host)
						.replace("${3}", query ?? ""),
			);
		expect(apply("https://status.example.com/")).toBe(
			"https://status.example.com/status/prod",
		);
		expect(apply("https://status.example.com/?x=1")).toBe(
			"https://status.example.com/status/prod?x=1",
		);
		expect(regex.test("https://status.example.com/status/prod")).toBe(false);
		expect(regex.test("https://status.example.com/_app/x.js")).toBe(false);
	});
});
