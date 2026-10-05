import { describe, expect, test } from "bun:test";
import {
	BUILTIN_BUILD_CACHE,
	buildCacheChoice,
} from "../../../src/lib/build-cache";

describe("buildCacheChoice", () => {
	test("the built-in pick sets the flag and no registry", () => {
		expect(
			buildCacheChoice({
				buildCacheRegistryId: BUILTIN_BUILD_CACHE,
				buildSource: "git",
			}),
		).toEqual({
			buildCacheBuiltin: true,
			buildCacheRegistryId: null,
		});
	});

	test("a registry id picks that registry", () => {
		expect(
			buildCacheChoice({ buildCacheRegistryId: "reg-1", buildSource: "git" }),
		).toEqual({
			buildCacheBuiltin: false,
			buildCacheRegistryId: "reg-1",
		});
	});

	test("no pick, or an image service, has no cache", () => {
		const none = { buildCacheBuiltin: false, buildCacheRegistryId: null };
		expect(
			buildCacheChoice({ buildCacheRegistryId: "", buildSource: "git" }),
		).toEqual(none);
		expect(
			buildCacheChoice({
				buildCacheRegistryId: BUILTIN_BUILD_CACHE,
				buildSource: "image",
			}),
		).toEqual(none);
	});
});
