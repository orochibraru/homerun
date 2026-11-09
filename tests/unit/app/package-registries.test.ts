import { describe, expect, test } from "bun:test";

import {
	isPackageRegistryKind,
	npmAuthValue,
	packageRegistryUsage,
} from "#lib/package-registries.js";

describe("isPackageRegistryKind", () => {
	test("accepts the registries Homerun runs and nothing else", () => {
		expect(isPackageRegistryKind("npm")).toBe(true);
		expect(isPackageRegistryKind("pypi")).toBe(true);
		expect(isPackageRegistryKind("maven")).toBe(false);
		expect(isPackageRegistryKind(undefined)).toBe(false);
	});
});

describe("packageRegistryUsage", () => {
	const credentials = { secret: "s3cret", username: "ci" };

	test("npm gets an .npmrc whose _auth is base64 of username:token", () => {
		const [npmrc, publish] = packageRegistryUsage(
			"npm",
			"https://npm.example.com/",
			credentials,
		);
		expect(npmrc.code).toBe(
			`registry=https://npm.example.com/\n//npm.example.com/:_auth=${npmAuthValue(credentials)}\n`,
		);
		expect(atob(npmAuthValue(credentials))).toBe("ci:s3cret");
		expect(publish.code).toBe(
			"npm publish --registry https://npm.example.com/",
		);
	});

	test("the internal address keeps its port in the .npmrc auth key", () => {
		const [npmrc] = packageRegistryUsage(
			"npm",
			"http://homerun-npm:4873/",
			null,
		);
		expect(npmrc.code).toContain("//homerun-npm:4873/:_auth=<base64 of");
	});

	test("pip gets an index URL with the token in it, and twine the upload URL", () => {
		const [pipConf, upload] = packageRegistryUsage(
			"pypi",
			"https://pypi.example.com/",
			credentials,
		);
		expect(pipConf.code).toBe(
			"[global]\nindex-url = https://ci:s3cret@pypi.example.com/simple/\n",
		);
		expect(upload.code).toBe(
			"twine upload --repository-url https://pypi.example.com/ -u ci -p s3cret dist/*",
		);
	});
});
