import { formatBytes } from "#lib/formatting.js";

interface PruneCounts {
	itemsDeleted: number;
	spaceReclaimedBytes: number;
}

function isPruneCounts(value: unknown): value is PruneCounts {
	return (
		!!value &&
		typeof value === "object" &&
		typeof (value as PruneCounts).itemsDeleted === "number" &&
		typeof (value as PruneCounts).spaceReclaimedBytes === "number"
	);
}

/**
 * One line saying what a finished Docker cleanup job reclaimed, summing every
 * section of a system prune. Null for a result of another shape (the mirror
 * and stack-network cleanups report their own fields in their log).
 */
export function describeCleanupResult(result: unknown): string | null {
	if (isPruneCounts(result)) {
		return `Removed ${result.itemsDeleted} item(s), reclaimed ${formatBytes(result.spaceReclaimedBytes)}.`;
	}
	if (!result || typeof result !== "object") {
		return null;
	}
	const parts = Object.values(result);
	if (parts.length === 0 || !parts.every(isPruneCounts)) {
		return null;
	}
	const items = parts.reduce((sum, part) => sum + part.itemsDeleted, 0);
	const bytes = parts.reduce((sum, part) => sum + part.spaceReclaimedBytes, 0);
	return `Cleaned up ${items} item(s), reclaimed ${formatBytes(bytes)}.`;
}
