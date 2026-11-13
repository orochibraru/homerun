import { describe, expect, test } from "bun:test";

import {
	parseRepoIdentity,
	renameRepoInUrl,
	repoByIdPath,
	repoByNamePath,
	repoName,
} from "../../../src/lib/git-repo-identity";

describe("repository lookups", () => {
	test("read by id on every provider, Bitbucket under its workspace", () => {
		expect(repoByIdPath("github", "42")).toBe("/repositories/42");
		expect(repoByIdPath("gitea", "7")).toBe("/repositories/7");
		expect(repoByIdPath("gitlab", "9")).toBe("/projects/9");
		expect(repoByIdPath("bitbucket", "{ws}/{repo}")).toBe(
			"/repositories/%7Bws%7D/%7Brepo%7D",
		);
	});

	test("read by path, GitLab's encoded", () => {
		expect(repoByNamePath("github", "ada/app")).toBe("/repos/ada/app");
		expect(repoByNamePath("gitlab", "group/sub/app")).toBe(
			"/projects/group%2Fsub%2Fapp",
		);
		expect(repoByNamePath("bitbucket", "team/app")).toBe(
			"/repositories/team/app",
		);
	});

	test("answers turn into an id and a current path", () => {
		expect(
			parseRepoIdentity("github", { full_name: "grace/app", id: 42 }),
		).toEqual({ fullName: "grace/app", id: "42" });
		expect(
			parseRepoIdentity("gitlab", { id: 9, path_with_namespace: "g/app" }),
		).toEqual({ fullName: "g/app", id: "9" });
		expect(
			parseRepoIdentity("bitbucket", {
				full_name: "team/app",
				uuid: "{repo}",
				workspace: { uuid: "{ws}" },
			}),
		).toEqual({ fullName: "team/app", id: "{ws}/{repo}" });
		expect(() => parseRepoIdentity("github", { full_name: "a/b" })).toThrow();
		expect(() =>
			parseRepoIdentity("bitbucket", { full_name: "a/b", uuid: "{r}" }),
		).toThrow();
	});

	test("a repository's name is its last segment", () => {
		expect(repoName("group/sub/app")).toBe("app");
		expect(repoName("app")).toBe("app");
	});
});

describe("renameRepoInUrl", () => {
	test("moves https, ssh and web URLs, whatever the case", () => {
		expect(
			renameRepoInUrl("https://github.com/Ada/app.git", "ada/app", "grace/app"),
		).toBe("https://github.com/grace/app.git");
		expect(
			renameRepoInUrl("git@github.com:ada/app.git", "ada/app", "grace/app"),
		).toBe("git@github.com:grace/app.git");
		expect(
			renameRepoInUrl("https://github.com/ada/app", "ada/app", "grace/app"),
		).toBe("https://github.com/grace/app");
	});

	test("leaves a URL to another repository alone", () => {
		expect(
			renameRepoInUrl("https://github.com/ada/application", "ada/app", "x/y"),
		).toBe("https://github.com/ada/application");
		expect(
			renameRepoInUrl("https://github.com/bob/app.git", "ada/app", "x/y"),
		).toBe("https://github.com/bob/app.git");
	});
});
