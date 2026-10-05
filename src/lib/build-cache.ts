export const BUILTIN_BUILD_CACHE = "builtin";

/**
 * The service columns a build cache pick sets: the built-in registry, a
 * configured cache registry by id, or none. Only a git build has a cache.
 */
export function buildCacheChoice(input: {
	buildCacheRegistryId?: string | null;
	buildSource: string;
}): { buildCacheBuiltin: boolean; buildCacheRegistryId: string | null } {
	const value = input.buildCacheRegistryId;
	if (!(input.buildSource === "git" && value)) {
		return { buildCacheBuiltin: false, buildCacheRegistryId: null };
	}
	return value === BUILTIN_BUILD_CACHE
		? { buildCacheBuiltin: true, buildCacheRegistryId: null }
		: { buildCacheBuiltin: false, buildCacheRegistryId: value };
}
