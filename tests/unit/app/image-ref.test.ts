import { describe, expect, test } from "bun:test";
import { bindVolumeName } from "../../../src/lib/compose-import";
import { splitImageRef } from "../../../src/lib/image-ref";

describe("splitImageRef", () => {
	test("defaults an untagged reference to latest", () => {
		expect(splitImageRef("nginx")).toEqual({ image: "nginx", tag: "latest" });
	});

	test("splits a plain tag", () => {
		expect(splitImageRef("nginx:1.27-alpine")).toEqual({
			image: "nginx",
			tag: "1.27-alpine",
		});
	});

	test("treats a registry port as part of the repository", () => {
		expect(splitImageRef("localhost:5000/app")).toEqual({
			image: "localhost:5000/app",
			tag: "latest",
		});
		expect(splitImageRef("registry:5000/team/app:v2")).toEqual({
			image: "registry:5000/team/app",
			tag: "v2",
		});
	});

	test("drops a pinned digest", () => {
		expect(splitImageRef("redis@sha256:abc")).toEqual({
			image: "redis",
			tag: "latest",
		});
		expect(splitImageRef("nginx:1.27@sha256:abc")).toEqual({
			image: "nginx",
			tag: "1.27",
		});
		expect(splitImageRef("registry:5000/app@sha256:abc")).toEqual({
			image: "registry:5000/app",
			tag: "latest",
		});
	});

	test("falls back to latest for an empty tag", () => {
		expect(splitImageRef("app:")).toEqual({ image: "app", tag: "latest" });
	});
});

describe("bindVolumeName", () => {
	test("derives the suffix from the container path", () => {
		expect(bindVolumeName("web", "/var/lib/data")).toBe("web-var-lib-data");
	});

	test("falls back to data for the root path", () => {
		expect(bindVolumeName("web", "/")).toBe("web-data");
	});

	test("caps the name at 63 characters", () => {
		expect(bindVolumeName("a".repeat(60), "/config")).toHaveLength(63);
	});
});
