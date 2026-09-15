import { describe, expect, test } from "bun:test";
import {
	authenticatedCloneUrl,
	cloneFailureHint,
	hasEmbeddedCredentials,
	providerForGitUrl,
	providerHost,
	redactCloneUrl,
} from "../../../src/lib/git-clone-url";

const cred = { token: "ghp_secret", username: "ada" };

describe("authenticatedCloneUrl", () => {
	test("injects credentials into an https URL", () => {
		expect(
			authenticatedCloneUrl("https://git.ombrage.space/me/app.git", cred),
		).toBe("https://ada:ghp_secret@git.ombrage.space/me/app.git");
	});

	test("leaves a URL that already carries credentials alone", () => {
		const url = "https://tok@git.ombrage.space/me/app.git";
		expect(authenticatedCloneUrl(url, cred)).toBe(url);
	});

	test("leaves ssh and unparseable URLs alone", () => {
		expect(authenticatedCloneUrl("git@github.com:me/app.git", cred)).toBe(
			"git@github.com:me/app.git",
		);
		expect(authenticatedCloneUrl("ssh://git@host/me/app.git", cred)).toBe(
			"ssh://git@host/me/app.git",
		);
	});

	test("is a no-op with no credential", () => {
		expect(authenticatedCloneUrl("https://github.com/me/app.git", null)).toBe(
			"https://github.com/me/app.git",
		);
	});

	test("percent-encodes a token containing URL-significant characters", () => {
		const url = authenticatedCloneUrl("https://host/me/app.git", {
			token: "p@ss/word",
			username: "ada",
		});
		expect(url).toBe("https://ada:p%40ss%2Fword@host/me/app.git");
		expect(new URL(url).password).toBe("p%40ss%2Fword");
	});
});

describe("redactCloneUrl", () => {
	test("never lets a token reach a log line", () => {
		const redacted = redactCloneUrl(
			"https://ada:ghp_secret@git.ombrage.space/me/app.git",
		);
		expect(redacted).not.toContain("ghp_secret");
		expect(redacted).toContain("***@git.ombrage.space");
	});

	test("leaves a credential-free URL untouched", () => {
		expect(redactCloneUrl("https://github.com/me/app.git")).toBe(
			"https://github.com/me/app.git",
		);
	});
});

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
