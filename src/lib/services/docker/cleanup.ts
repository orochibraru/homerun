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

/** Shapes the images half of a `docker system df` response into a `CleanupCategory`, excluding images still in use by a container or in `keep`. */
function imageCategory(
	images: DockerDfImage[],
	keep: Set<string>,
): CleanupCategory {
	return {
		items: images
			.filter((img) => (img.Containers ?? 0) <= 0 && !keep.has(img.Id ?? ""))
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
	};
}

/**
 * The volumes a volume prune may remove : unreferenced by any container
 * (stopped ones included, which Docker already counts) and not named in
 * `keep`, the Homerun-mounted volumes whose service's container may be gone
 * entirely while the service still owns the data.
 */
export function prunableVolumes<
	T extends { Name?: string; UsageData?: { RefCount?: number } | null },
>(volumes: T[], keep: Set<string>): T[] {
	return volumes.filter(
		(volume) =>
			(volume.UsageData?.RefCount ?? 0) <= 0 && !keep.has(volume.Name ?? ""),
	);
}

/** Mixin adding the "Docker Cleanup" surface : previewing and pruning unused containers/images/networks/volumes/build cache. */
// oxlint-disable-next-line max-lines-per-function -- mixin factory: the body is a class definition, not a procedure
export function DockerCleanupMixin<
	TBase extends Constructor<BaseDockerService>,
>(Base: TBase) {
	return class DockerCleanupService extends Base {
		/**
		 * Docker-managed volumes that already exist on the host, for the
		 * "pull in existing volumes" picker : a fresh Homerun on a machine
		 * that has been running containers for years shouldn't make you
		 * retype names it can already see.
		 */
		async listHostVolumes(): Promise<string[]> {
			const { Volumes } = await this.getDocker().listVolumes();
			return (Volumes ?? [])
				.map((volume) => volume.Name)
				.filter(Boolean)
				.sort((a, b) => a.localeCompare(b));
		}

		/**
		 * Builds the full "Docker Cleanup" preview : containers, images,
		 * networks, volumes and build cache the daemon would remove on a
		 * prune, without actually removing anything. Backed by a single
		 * `docker system df` call plus `listNetworks`, so it's cheap enough to
		 * call on every page load.
		 *
		 * @param keepImageIds Image ids to exclude from the images category
		 *   even if otherwise unused, e.g. retained revision images a rollback
		 *   might still need.
		 * @param keepVolumeNames Volume names to exclude from the volumes
		 *   category even if no container references them, i.e. every volume
		 *   a Homerun service mounts.
		 */
		async getCleanupPreview(
			keepImageIds: string[] = [],
			keepVolumeNames: string[] = [],
		): Promise<CleanupPreview> {
			const keep = new Set(keepImageIds);
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
				images: imageCategory(images, keep),
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
					items: prunableVolumes(volumes, new Set(keepVolumeNames)).map(
						(v) => ({
							detail: v.Driver,
							id: v.Name ?? "",
							label: v.Name ?? "",
							sizeBytes: v.UsageData?.Size ?? 0,
						}),
					),
					totalCount: volumes.length,
					totalSizeBytes: volumes.reduce(
						(sum, v) => sum + (v.UsageData?.Size ?? 0),
						0,
					),
				},
			};
		}

		/** Removes every stopped container on the host via `docker container prune`. Not scoped to Homerun-managed containers. */
		async pruneContainers(): Promise<PruneSummary> {
			const result = await this.getDocker().pruneContainers();
			const itemsDeleted = result.ContainersDeleted?.length ?? 0;
			logger.info(
				`Pruned ${itemsDeleted} stopped container(s), reclaimed ${result.SpaceReclaimed ?? 0} bytes`,
			);
			return { itemsDeleted, spaceReclaimedBytes: result.SpaceReclaimed ?? 0 };
		}

		/**
		 * Removes unused images host-wide (not scoped to Homerun-managed
		 * ones). Dangling-only by default; `all` also removes tagged images
		 * with no container using them. When `keepImageIds` is non-empty,
		 * delegates to `#pruneImagesKeeping` instead of the daemon's own
		 * prune, since dockerode's `pruneImages` has no way to exclude
		 * specific image ids.
		 */
		async pruneImages(
			all = false,
			keepImageIds: string[] = [],
		): Promise<PruneSummary> {
			if (keepImageIds.length > 0) {
				return await this.#pruneImagesKeeping(all, new Set(keepImageIds));
			}
			const result = await this.getDocker().pruneImages(
				all ? { filters: { dangling: ["false"] } } : {},
			);
			const itemsDeleted = result.ImagesDeleted?.length ?? 0;
			logger.info(
				`Pruned ${itemsDeleted} unused image(s)${all ? " (including tagged)" : ""}, reclaimed ${result.SpaceReclaimed ?? 0} bytes`,
			);
			return { itemsDeleted, spaceReclaimedBytes: result.SpaceReclaimed ?? 0 };
		}

		/**
		 * `pruneImages`'s path when specific image ids must survive : removes
		 * unused images one at a time (skipping anything in `keep`) rather
		 * than the daemon's own bulk prune, logging and continuing past any
		 * individual removal failure (e.g. a parent/child image conflict)
		 * instead of aborting the whole batch.
		 */
		async #pruneImagesKeeping(
			all: boolean,
			keep: Set<string>,
		): Promise<PruneSummary> {
			const docker = this.getDocker();
			const df = (await docker.df()) as DockerDfResponse;
			const candidates = (df.Images ?? []).filter(
				(image) =>
					image.Id &&
					!keep.has(image.Id) &&
					(image.Containers ?? 0) <= 0 &&
					(all || isDanglingImage(image.RepoTags)),
			);
			let itemsDeleted = 0;
			let spaceReclaimedBytes = 0;
			for (const image of candidates) {
				try {
					// oxlint-disable-next-line no-await-in-loop -- images are removed one at a time so a parent/child conflict only skips that one
					await docker.getImage(image.Id ?? "").remove({ force: false });
					itemsDeleted += 1;
					spaceReclaimedBytes += image.Size ?? 0;
				} catch (err) {
					logger.warn(`Skipped image ${shortId(image.Id)} during prune`, err);
				}
			}
			logger.info(
				`Pruned ${itemsDeleted} unused image(s)${all ? " (including tagged)" : ""}, kept ${keep.size} retained revision image(s), reclaimed ${spaceReclaimedBytes} bytes`,
			);
			return { itemsDeleted, spaceReclaimedBytes };
		}

		/** Removes every unused network on the host via `docker network prune`. Not scoped to Homerun-managed networks. */
		async pruneNetworks(): Promise<PruneSummary> {
			const result = await this.getDocker().pruneNetworks();
			const itemsDeleted = result.NetworksDeleted?.length ?? 0;
			logger.info(`Pruned ${itemsDeleted} unused network(s)`);
			return { itemsDeleted, spaceReclaimedBytes: 0 };
		}

		/** Clears the daemon's build cache via `docker builder prune`. `itemsDeleted` is always 0 : the daemon's response only reports reclaimed space, not an item count. */
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

		/**
		 * Removes every unused volume on the host, including named ones, not
		 * scoped to Homerun-managed volumes. With an empty `keepVolumeNames`
		 * this is the daemon's own `docker volume prune --all`; otherwise it
		 * removes unreferenced volumes one at a time, skipping every kept name
		 * (the daemon's prune only filters by label, and a volume a stopped
		 * or removed service still mounts carries none), and logs and
		 * continues past any single removal the daemon refuses.
		 */
		async pruneVolumes(keepVolumeNames: string[] = []): Promise<PruneSummary> {
			if (keepVolumeNames.length === 0) {
				const result = await this.getDocker().pruneVolumes({
					filters: { all: ["true"] },
				});
				const itemsDeleted = result.VolumesDeleted?.length ?? 0;
				logger.info(
					`Pruned ${itemsDeleted} unused volume(s), reclaimed ${result.SpaceReclaimed ?? 0} bytes`,
				);
				return {
					itemsDeleted,
					spaceReclaimedBytes: result.SpaceReclaimed ?? 0,
				};
			}
			const docker = this.getDocker();
			const df = (await docker.df()) as DockerDfResponse;
			const keep = new Set(keepVolumeNames);
			const candidates = prunableVolumes(df.Volumes ?? [], keep);
			let itemsDeleted = 0;
			let spaceReclaimedBytes = 0;
			for (const volume of candidates) {
				if (!volume.Name) {
					continue;
				}
				try {
					// oxlint-disable-next-line no-await-in-loop -- volumes are removed one at a time so a volume the daemon refuses only skips that one
					await docker.getVolume(volume.Name).remove();
					itemsDeleted += 1;
					spaceReclaimedBytes += Math.max(0, volume.UsageData?.Size ?? 0);
				} catch (err) {
					logger.warn(`Skipped volume ${volume.Name} during prune`, err);
				}
			}
			logger.info(
				`Pruned ${itemsDeleted} unused volume(s), kept ${keep.size} volume(s) mounted by Homerun services, reclaimed ${spaceReclaimedBytes} bytes`,
			);
			return { itemsDeleted, spaceReclaimedBytes };
		}

		/**
		 * Runs containers/images/networks/build-cache prunes in sequence, as
		 * the "prune everything" bulk action. Deliberately excludes
		 * `pruneVolumes` : a volume can hold real data, so that one stays an
		 * explicit, separate action rather than bundled into a broad sweep.
		 */
		async pruneSystem(
			keepImageIds: string[] = [],
		): Promise<SystemPruneSummary> {
			const containers = await this.pruneContainers();
			const images = await this.pruneImages(false, keepImageIds);
			const networks = await this.pruneNetworks();
			const buildCache = await this.pruneBuildCache();
			return { buildCache, containers, images, networks };
		}
	};
}
