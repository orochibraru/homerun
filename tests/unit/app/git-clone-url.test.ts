import { describe, expect, test } from "bun:test";
import {
	cloneFailureHint,
	hasEmbeddedCredentials,
	providerForGitUrl,
	providerHost,
} from "../../../src/lib/git-clone-url";

describe("hasEmbeddedCredentials", () => {
	test("spots a token in the URL", () => {
		expect(hasEmbeddedCredentials("https://tok@host/a.git")).toBe(true);
		expect(hasEmbeddedCredentials("https://host/a.git")).toBe(false);
		expect(hasEmbeddedCredentials("git@github.com:a/b.git")).toBe(false);
	});
});

describe("providerHost / providerForGitUrl", () => {
	const github = { baseUrl: null, id: "gh", kind: "github" as const };
	const gitea = {
		baseUrl: "https://git.ombrage.space/",
		id: "ge",
		kind: "gitea" as const,
	};

	test("uses the well-known host when there's no base URL", () => {
		expect(providerHost(github)).toBe("github.com");
	});

	test("uses the configured base URL's host for a self-hosted provider", () => {
		expect(providerHost(gitea)).toBe("git.ombrage.space");
	});

	test("matches a repo URL to the provider serving that host", () => {
		expect(
			providerForGitUrl("https://git.ombrage.space/me/app.git", [
				github,
				gitea,
			]),
		).toBe(gitea);
		expect(
			providerForGitUrl("https://github.com/me/app.git", [github, gitea]),
		).toBe(github);
		expect(
			providerForGitUrl("https://elsewhere.dev/me/app.git", [github, gitea]),
		).toBeNull();
	});
});

describe("cloneFailureHint", () => {
	test("turns git's credential prompt failure into something actionable", () => {
		const hint = cloneFailureHint(
			"https://git.ombrage.space/me/app.git",
			"fatal: could not read Username for 'https://git.ombrage.space': No such device or address",
		);
		expect(hint).toContain("git.ombrage.space");
		expect(hint).toContain("Git Providers");
	});

	test("passes an unrelated failure through unchanged", () => {
		expect(
			cloneFailureHint("https://host/a.git", "fatal: repository not found"),
		).toBe("fatal: repository not found");
	});
});
