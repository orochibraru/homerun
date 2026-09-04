import { Logger } from "$lib/logger";
import type { BaseDockerService, Constructor } from "./base.ts";

const logger = new Logger("DockerCleanup");

export interface PruneSummary {
	itemsDeleted: number;
	spaceReclaimedBytes: number;
}

export interface SystemPruneSummary {
	buildCache: PruneSummary;
	containers: PruneSummary;
	images: PruneSummary;
	networks: PruneSummary;
}

export interface CleanupItem {
	dangling?: boolean;
	detail?: string;
	id: string;
	label: string;
	sizeBytes?: number;
}

export interface CleanupCategory {
	items: CleanupItem[];
	totalCount: number;
	totalSizeBytes?: number;
}

export interface CleanupPreview {
	buildCache: CleanupCategory;
	containers: CleanupCategory;
	images: CleanupCategory;
	networks: CleanupCategory;
	volumes: CleanupCategory;
}

interface DockerDfImage {
	Containers?: number;
	Id?: string;
	RepoTags?: string[] | null;
	Size?: number;
}

interface DockerDfContainer {
	Id?: string;
	Image?: string;
	Names?: string[];
	NetworkSettings?: { Networks?: Record<string, unknown> };
	SizeRw?: number;
	State?: string;
	Status?: string;
}

interface DockerDfVolume {
	Driver?: string;
	Name?: string;
	UsageData?: { RefCount?: number; Size?: number } | null;
}

interface DockerDfBuildCache {
	Description?: string;
	ID?: string;
	InUse?: boolean;
	LastUsedAt?: string;
	Size?: number;
}

interface DockerDfResponse {
	BuildCache?: DockerDfBuildCache[] | null;
	Containers?: DockerDfContainer[] | null;
	Images?: DockerDfImage[] | null;
	Volumes?: DockerDfVolume[] | null;
}

const DEFAULT_NETWORK_NAMES = new Set(["bridge", "host", "none"]);

function isDanglingImage(repoTags: string[] | null | undefined): boolean {
	return (
		!repoTags ||
		repoTags.length === 0 ||
		(repoTags.length === 1 && repoTags[0] === "<none>:<none>")
	);
}

function shortId(id: string | undefined): string {
	return (id ?? "").replace(/^sha256:/, "").slice(0, 12);
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: mixin factory: the body is a class definition, not a procedure
export function DockerCleanupMixin<
	TBase extends Constructor<BaseDockerService>,
>(Base: TBase) {
	return class DockerCleanupService extends Base {
		async getCleanupPreview(): Promise<CleanupPreview> {
			const docker = this.getDocker();
			const [df, networks] = await Promise.all([
				docker.df() as Promise<DockerDfResponse>,
				docker.listNetworks(),
			]);

			const images = df.Images ?? [];
			const containers = df.Containers ?? [];
			const volumes = df.Volumes ?? [];
			const buildCache = df.BuildCache ?? [];

			const usedNetworkNames = new Set<string>();
			for (const c of containers) {
				for (const name of Object.keys(c.NetworkSettings?.Networks ?? {})) {
					usedNetworkNames.add(name);
				}
			}

			return {
				buildCache: {
					items: buildCache
						.filter((b) => !b.InUse)
						.map((b) => ({
							detail: b.LastUsedAt ? `last used ${b.LastUsedAt}` : "never used",
							id: b.ID ?? "",
							label: b.Description || shortId(b.ID),
							sizeBytes: b.Size ?? 0,
						})),
					totalCount: buildCache.length,
					totalSizeBytes: buildCache.reduce((sum, b) => sum + (b.Size ?? 0), 0),
				},
				containers: {
					items: containers
						.filter((c) => c.State !== "running")
						.map((c) => ({
							detail: `${c.Image ?? "unknown image"} · ${c.Status ?? c.State}`,
							id: c.Id ?? "",
							label: (c.Names?.[0] ?? shortId(c.Id)).replace(/^\//, ""),
							sizeBytes: c.SizeRw ?? 0,
						})),
					totalCount: containers.length,
					totalSizeBytes: containers.reduce(
						(sum, c) => sum + (c.SizeRw ?? 0),
						0,
					),
				},
				images: {
					items: images
						.filter((img) => (img.Containers ?? 0) <= 0)
						.map((img) => ({
							dangling: isDanglingImage(img.RepoTags),
							detail: isDanglingImage(img.RepoTags)
								? "dangling"
								: (img.RepoTags ?? []).join(", "),
							id: img.Id ?? "",
							label: img.RepoTags?.[0] || shortId(img.Id),
							sizeBytes: img.Size ?? 0,
						})),
					totalCount: images.length,
					totalSizeBytes: images.reduce((sum, img) => sum + (img.Size ?? 0), 0),
				},
				networks: {
					items: networks
						.filter(
							(n) =>
								!(
									DEFAULT_NETWORK_NAMES.has(n.Name) ||
									usedNetworkNames.has(n.Name)
								),
						)
						.map((n) => ({
							detail: n.Driver,
							id: n.Id,
							label: n.Name,
						})),
					totalCount: networks.length,
				},
				volumes: {
					items: volumes
						.filter((v) => (v.UsageData?.RefCount ?? 0) <= 0)
						.map((v) => ({
							detail: v.Driver,
							id: v.Name ?? "",
							label: v.Name ?? "",
							sizeBytes: v.UsageData?.Size ?? 0,
						})),
					totalCount: volumes.length,
					totalSizeBytes: volumes.reduce(
						(sum, v) => sum + (v.UsageData?.Size ?? 0),
						0,
					),
				},
			};
		}

		async pruneContainers(): Promise<PruneSummary> {
			const result = await this.getDocker().pruneContainers();
			const itemsDeleted = result.ContainersDeleted?.length ?? 0;
			logger.info(
				`Pruned ${itemsDeleted} stopped container(s), reclaimed ${result.SpaceReclaimed ?? 0} bytes`,
			);
			return { itemsDeleted, spaceReclaimedBytes: result.SpaceReclaimed ?? 0 };
		}

		async pruneImages(all = false): Promise<PruneSummary> {
			const result = await this.getDocker().pruneImages(
				all ? { filters: { dangling: ["false"] } } : {},
			);
			const itemsDeleted = result.ImagesDeleted?.length ?? 0;
			logger.info(
				`Pruned ${itemsDeleted} unused image(s)${all ? " (including tagged)" : ""}, reclaimed ${result.SpaceReclaimed ?? 0} bytes`,
			);
			return { itemsDeleted, spaceReclaimedBytes: result.SpaceReclaimed ?? 0 };
		}

		async pruneNetworks(): Promise<PruneSummary> {
			const result = await this.getDocker().pruneNetworks();
			const itemsDeleted = result.NetworksDeleted?.length ?? 0;
			logger.info(`Pruned ${itemsDeleted} unused network(s)`);
			return { itemsDeleted, spaceReclaimedBytes: 0 };
		}

		async pruneBuildCache(): Promise<PruneSummary> {
			const result = await this.getDocker().pruneBuilder();
			logger.info(
				`Pruned build cache, reclaimed ${result.SpaceReclaimed ?? 0} bytes`,
			);
			return {
				itemsDeleted: 0,
				spaceReclaimedBytes: result.SpaceReclaimed ?? 0,
			};
		}

		async pruneVolumes(): Promise<PruneSummary> {
			const result = await this.getDocker().pruneVolumes({
				filters: { all: ["true"] },
			});
			const itemsDeleted = result.VolumesDeleted?.length ?? 0;
			logger.info(
				`Pruned ${itemsDeleted} unused volume(s), reclaimed ${result.SpaceReclaimed ?? 0} bytes`,
			);
			return { itemsDeleted, spaceReclaimedBytes: result.SpaceReclaimed ?? 0 };
		}

		async pruneSystem(): Promise<SystemPruneSummary> {
			const containers = await this.pruneContainers();
			const images = await this.pruneImages(false);
			const networks = await this.pruneNetworks();
			const buildCache = await this.pruneBuildCache();
			return { buildCache, containers, images, networks };
		}
	};
}
