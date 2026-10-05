import { describe, expect, test } from "bun:test";

const {
	escapeRegex,
	normalizeDestination,
	normalizeSource,
	redirectRegexFor,
	REDIRECT_ROUTER_PRIORITY,
	redirectsConfig,
	splitSource,
} = await import("../../../src/lib/redirects");

const rule = (over: Partial<Parameters<typeof redirectRegexFor>[0]> = {}) => ({
	destination: "https://new.example.com/",
	enabled: true,
	id: "abc",
	keepPath: true,
	permanent: true,
	source: "old.example.com",
	...over,
});

function apply(r: { regex: string; replacement: string }, url: string) {
	const match = new RegExp(r.regex).exec(url);
	if (!match) {
		return null;
	}
	return r.replacement
		.replace(/\$\{1\}/g, match[1] ?? "")
		.replaceAll("$$", "$");
}

describe("source parsing", () => {
	test("splits host and path prefix, lowercased, no trailing slash", () => {
		expect(splitSource("Example.com/Blog/")).toEqual({
			host: "example.com",
			pathPrefix: "/blog",
		});
		expect(normalizeSource("old.example.com")).toBe("old.example.com");
	});

	test("rejects junk", () => {
		expect(splitSource("nodot")).toBeNull();
		expect(splitSource("https://old.example.com")).toBeNull();
		expect(splitSource("example.com/a b")).toBeNull();
	});

	test("destination must be http(s)", () => {
		expect(normalizeDestination("https://x.example.com")).toBe(
			"https://x.example.com/",
		);
		expect(normalizeDestination("javascript:alert(1)")).toBeNull();
		expect(normalizeDestination("nope")).toBeNull();
	});
});

describe("redirectRegexFor", () => {
	test("escapes dots in the host", () => {
		expect(escapeRegex("a.b")).toBe("a\\.b");
		expect(redirectRegexFor(rule())?.regex).toContain("old\\.example\\.com");
	});

	test("keep path carries path and query", () => {
		const r = redirectRegexFor(rule());
		expect(r && apply(r, "https://old.example.com/a/b?x=1")).toBe(
			"https://new.example.com/a/b?x=1",
		);
		expect(r && apply(r, "https://old.example.com/")).toBe(
			"https://new.example.com/",
		);
	});

	test("does not match a lookalike host", () => {
		const r = redirectRegexFor(rule());
		expect(new RegExp(r?.regex ?? "").test("https://oldxexample.com/")).toBe(
			false,
		);
	});

	test("keep path off sends everything to the exact destination", () => {
		const r = redirectRegexFor(
			rule({ destination: "https://new.example.com/landing", keepPath: false }),
		);
		expect(r && apply(r, "https://old.example.com/a/b?x=1")).toBe(
			"https://new.example.com/landing",
		);
	});

	test("path prefix is stripped and must end on a boundary", () => {
		const r = redirectRegexFor(rule({ source: "example.com/blog" }));
		expect(r && apply(r, "https://example.com/blog/post?x=1")).toBe(
			"https://new.example.com/post?x=1",
		);
		expect(r && apply(r, "https://example.com/blog")).toBe(
			"https://new.example.com",
		);
		expect(new RegExp(r?.regex ?? "").test("https://example.com/blogger")).toBe(
			false,
		);
	});

	test("a dollar in the destination is doubled for Traefik", () => {
		const r = redirectRegexFor(
			rule({ destination: "https://x.example.com/$1", keepPath: false }),
		);
		expect(r?.replacement).toBe("https://x.example.com/$$1");
	});
});

describe("redirectsConfig", () => {
	const options = { certResolver: () => "le", entrypoint: "websecure" };

	test("one router and middleware per enabled redirect", () => {
		const out = redirectsConfig(
			[rule({ permanent: false }), rule({ enabled: false, id: "off" })],
			options,
		);
		const parsed = JSON.parse(out ?? "");
		expect(Object.keys(parsed.http.routers)).toEqual(["homerun-redirect-abc"]);
		const router = parsed.http.routers["homerun-redirect-abc"];
		expect(router.rule).toBe("Host(`old.example.com`)");
		expect(router.service).toBe("noop@internal");
		expect(router.tls).toEqual({ certResolver: "le" });
		expect(router.entryPoints).toEqual(["websecure"]);
		expect(router.priority).toBe(REDIRECT_ROUTER_PRIORITY);
		expect(
			parsed.http.middlewares["homerun-redirect-abc"].redirectRegex.permanent,
		).toBe(false);
	});

	test("path prefix goes into the rule; plain tls without a resolver", () => {
		const out = redirectsConfig([rule({ source: "example.com/blog" })], {
			...options,
			certResolver: () => null,
		});
		const router = JSON.parse(out ?? "").http.routers["homerun-redirect-abc"];
		expect(router.rule).toBe(
			"Host(`example.com`) && (Path(`/blog`) || PathPrefix(`/blog/`))",
		);
		expect(router.tls).toEqual({});
	});

	test("nothing enabled means no file", () => {
		expect(redirectsConfig([rule({ enabled: false })], options)).toBeNull();
	});
});
