export const GATE_RECHECK_MS = 5 * 60 * 1000;

const SWEEP_THRESHOLD = 1000;

interface GateAccessEntry {
	allowed: Promise<boolean>;
	checkedAt: number;
	userId: string;
}

const globalForGateAccess = globalThis as unknown as {
	__homerun_gate_access_cache?: Map<string, GateAccessEntry>;
};

function getCache(): Map<string, GateAccessEntry> {
	if (!globalForGateAccess.__homerun_gate_access_cache) {
		globalForGateAccess.__homerun_gate_access_cache = new Map();
	}
	return globalForGateAccess.__homerun_gate_access_cache;
}

function sweep(cache: Map<string, GateAccessEntry>, now: number): void {
	if (cache.size < SWEEP_THRESHOLD) {
		return;
	}
	for (const [key, entry] of cache) {
		if (now - entry.checkedAt >= GATE_RECHECK_MS) {
			cache.delete(key);
		}
	}
}

/**
 * Answers whether a login-wall cookie holder is still allowed into a service,
 * re-running `check` at most once every `GATE_RECHECK_MS` per service, user and
 * policy version. Concurrent callers share one in-flight check. A check that
 * throws isn't cached, so the next request retries it.
 */
export function cachedGateAccess(
	key: { policyVersion: string; serviceId: string; userId: string },
	check: () => Promise<boolean>,
	now: number = Date.now(),
): Promise<boolean> {
	const cache = getCache();
	const cacheKey = `${key.serviceId}:${key.userId}:${key.policyVersion}`;
	const hit = cache.get(cacheKey);
	if (hit && now - hit.checkedAt < GATE_RECHECK_MS) {
		return hit.allowed;
	}
	sweep(cache, now);
	const allowed = check();
	const entry: GateAccessEntry = {
		allowed,
		checkedAt: now,
		userId: key.userId,
	};
	cache.set(cacheKey, entry);
	allowed.catch(() => {
		if (cache.get(cacheKey) === entry) {
			cache.delete(cacheKey);
		}
	});
	return allowed;
}

/**
 * Drops every cached login-wall decision for a user, so the next request to
 * any gated app re-checks them against the database. Called whenever the user
 * or one of their linked accounts changes or is deleted.
 */
export function forgetGateAccess(userId: string): void {
	const cache = getCache();
	for (const [key, entry] of cache) {
		if (entry.userId === userId) {
			cache.delete(key);
		}
	}
}
