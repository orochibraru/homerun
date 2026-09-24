import type { CleanupItem } from "$lib/services/docker.service";

export type CleanupAction =
	| "pruneBuildCache"
	| "pruneContainers"
	| "pruneImages"
	| "pruneMirror"
	| "pruneNetworks"
	| "pruneSystem"
	| "pruneVolumes"
	| "reclaimStackNetworks";

export const confirmCopy: Record<
	CleanupAction,
	{ confirmLabel: string; description: string; title: string }
> = {
	pruneBuildCache: {
		confirmLabel: "Prune",
		description:
			"Removes the Docker builder's cache. The next git-based build starts from scratch, or from a configured build-cache registry if one's set.",
		title: "Prune build cache?",
	},
	pruneContainers: {
		confirmLabel: "Prune",
		description:
			"Permanently removes every stopped container on this host, not just ones this app created. Their logs and any un-mounted data inside them are gone.",
		title: "Prune stopped containers?",
	},
	pruneImages: {
		confirmLabel: "Prune",
		description:
			"Removes dangling images by default. Check “Include tagged, unused images” below to remove any image not used by a container, tagged or not.",
		title: "Prune images?",
	},
	pruneMirror: {
		confirmLabel: "Clean up",
		description:
			"Deletes every image in the homerun-mirror registry that no service runs, keeping each service's current image and its last two scanned versions, then reclaims the space. Deploys wait until it's done.",
		title: "Clean up the image mirror?",
	},
	pruneNetworks: {
		confirmLabel: "Prune",
		description:
			"Removes every Docker network on this host not currently used by a container.",
		title: "Prune unused networks?",
	},
	reclaimStackNetworks: {
		confirmLabel: "Reclaim",
		description:
			"Removes the per-stack networks whose stack no longer exists. One with containers still attached is left alone. Nothing else on this host is touched.",
		title: "Reclaim orphaned stack networks?",
	},
	pruneSystem: {
		confirmLabel: "Clean up",
		description:
			"Runs stopped-container, dangling-image, unused-network, and build-cache pruning together, same as docker system prune. Doesn't touch volumes.",
		title: "Clean up this Docker host?",
	},
	pruneVolumes: {
		confirmLabel: "Prune",
		description:
			"Permanently deletes every Docker-managed volume on this host that no container uses. A volume mounted into a Homerun service is always kept, even while that service is stopped or has no container. This can't be undone.",
		title: "Prune unused volumes?",
	},
};

/** Human byte size with one decimal above bytes, as the cleanup page shows it. */
export function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let i = 0;
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i += 1;
	}
	return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Total reclaimable bytes across a preview section's items. */
export function sumSize(items: CleanupItem[]): number {
	return items.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
}

function isSystemResult(
	result: unknown,
): result is Record<
	string,
	{ itemsDeleted: number; spaceReclaimedBytes: number }
> {
	return !!result && typeof result === "object" && "containers" in result;
}

/** Toast line for a finished prune, summing every section of a system prune. */
export function describeResult(result: unknown): string {
	if (isSystemResult(result)) {
		const parts = Object.values(result);
		const items = parts.reduce((sum, p) => sum + p.itemsDeleted, 0);
		const bytes = parts.reduce((sum, p) => sum + p.spaceReclaimedBytes, 0);
		return `Cleaned up ${items} item(s), reclaimed ${formatBytes(bytes)}.`;
	}
	const r = result as { itemsDeleted: number; spaceReclaimedBytes: number };
	return `Removed ${r.itemsDeleted} item(s), reclaimed ${formatBytes(r.spaceReclaimedBytes)}.`;
}
