import { CronJobDTO } from "#lib/dto/cron-job-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { WorkstationDTO } from "#lib/dto/workstation-dto.js";
import { formatBytes } from "#lib/formatting.js";
import type { ResourceCause } from "#lib/resource-incidents.js";
import { WorkerClient } from "#lib/server/worker-client.js";
import { SERVICE_ID_LABEL } from "#lib/services/docker/labels.js";
import {
	type SystemStats,
	SystemStatsService,
} from "#lib/services/system-stats.service.js";

export const INSIGHT_RESOURCES = ["cpu", "memory", "disk"] as const;

export type InsightResource = (typeof INSIGHT_RESOURCES)[number];

export type ConsumerKind =
	| "build cache"
	| "container"
	| "cron job"
	| "helper"
	| "images"
	| "other"
	| "service"
	| "volume"
	| "workstation";

/** One thing using a share of a host resource. */
export interface ResourceConsumer {
	/** How much it uses, in words: `62%, 2.5 cores`, `1.2 GB`. */
	amount: string;
	/** What it is beyond its name: an image, a container name. */
	detail: string | null;
	kind: ConsumerKind;
	label: string;
	/** The Homerun item it belongs to, for a link to it. */
	link: { id: string; kind: "cronJob" | "service" | "workstation" } | null;
	/** Its share of the whole host's capacity, in percent. */
	share: number;
}

/** What uses one host resource right now, biggest first. */
export interface ResourceInsight {
	consumers: ResourceConsumer[];
	/** The host's own reading, in percent. */
	percent: number;
	resource: InsightResource;
}

interface ContainerUsage {
	cpuPercent: number;
	hostCpuPercent: number;
	id: string;
	image: string;
	labels: Record<string, string>;
	memUsedMb: number;
	name: string;
}

interface DiskUsageResponse {
	BuildCache?: { Shared?: boolean; Size?: number }[] | null;
	Containers?: { Names?: string[] | null; SizeRw?: number }[] | null;
	LayersSize?: number;
	Volumes?: { Name?: string; UsageData?: { Size?: number } | null }[] | null;
}

const CRON_JOB_LABEL = "homerun.cronjob.id";
const WORKSTATION_LABEL = "homerun.workstation.id";
const HELPER_LABEL = "homerun.helper";
const MB = 1024 * 1024;
const GB = 1024 * MB;

/** A remainder too small to be worth a row, in points of the host's capacity. */
const NOISE_SHARE = 1;

/** One decimal under ten, whole past it. */
function round(value: number): string {
	return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

/** Who a container belongs to, by its homerun labels. */
interface Owners {
	cronJobs: Map<string, string>;
	services: Map<string, string>;
	workstations: Map<string, { name: string; userId: string }>;
}

/**
 * Tells what is using the host's CPU, memory or disk: every running
 * container's share (named after the service, workstation or cron job it
 * runs for) and what's left outside containers, or for the disk what Docker
 * keeps there (volumes, images, build cache, container layers) and the rest.
 * Read live, for the dashboard's resource rings and for what a resource
 * alert records as its cause.
 */
class ResourceInsightsServiceClass {
	/**
	 * What uses `resource` right now, biggest first. A workstation is named
	 * only for its owner, `viewerId`; anyone else, and an alert (no viewer),
	 * sees "A workstation".
	 *
	 * @throws When the worker can't read the host or its containers.
	 */
	async insight(
		resource: InsightResource,
		viewerId: string | null = null,
	): Promise<ResourceInsight> {
		const host = await SystemStatsService.getSystemStats();
		if (resource === "disk") {
			return this.#disk(host);
		}
		const [usage, owners] = await Promise.all([
			WorkerClient.get<ContainerUsage[]>("/v1/host/usage"),
			this.#owners(),
		]);
		return resource === "cpu"
			? this.#cpu(host, usage, owners, viewerId)
			: this.#memory(host, usage, owners, viewerId);
	}

	/**
	 * The biggest `limit` consumers of `resource`, for an alert to name what
	 * it fired for. Empty when they can't be read: an alert never waits on
	 * or fails over its explanation.
	 */
	async causes(resource: InsightResource, limit = 3): Promise<ResourceCause[]> {
		try {
			const { consumers } = await this.insight(resource);
			return consumers
				.slice(0, limit)
				.map(({ amount, label }) => ({ amount, label }));
		} catch {
			return [];
		}
	}

	/** Every service, cron job and workstation by id, to name containers after. */
	async #owners(): Promise<Owners> {
		const [services, cronJobs, workstations] = await Promise.all([
			ServiceDTO.list(),
			CronJobDTO.list(),
			WorkstationDTO.listAll(),
		]);
		return {
			cronJobs: new Map(cronJobs.map((job) => [job.id, job.name])),
			services: new Map(services.map((svc) => [svc.id, svc.name])),
			workstations: new Map(
				workstations.map((ws) => [ws.id, { name: ws.name, userId: ws.userId }]),
			),
		};
	}

	/** A container named after what it runs for. */
	#describe(
		container: ContainerUsage,
		owners: Owners,
		viewerId: string | null,
	): Pick<ResourceConsumer, "detail" | "kind" | "label" | "link"> {
		const { labels } = container;
		const serviceId = labels[SERVICE_ID_LABEL];
		const serviceName = serviceId ? owners.services.get(serviceId) : undefined;
		if (serviceId && serviceName) {
			return {
				detail: container.image,
				kind: "service",
				label: serviceName,
				link: { id: serviceId, kind: "service" },
			};
		}
		const workstationId = labels[WORKSTATION_LABEL];
		if (workstationId) {
			const ws = owners.workstations.get(workstationId);
			const mine = !!ws && ws.userId === viewerId;
			return {
				detail: container.image,
				kind: "workstation",
				label: mine ? `Workstation ${ws.name}` : "A workstation",
				link: mine ? { id: workstationId, kind: "workstation" } : null,
			};
		}
		const cronJobId = labels[CRON_JOB_LABEL];
		const cronJobName = cronJobId ? owners.cronJobs.get(cronJobId) : undefined;
		if (cronJobId && cronJobName) {
			return {
				detail: container.image,
				kind: "cron job",
				label: `Cron job ${cronJobName}`,
				link: { id: cronJobId, kind: "cronJob" },
			};
		}
		return {
			detail: container.image,
			kind: labels[HELPER_LABEL] ? "helper" : "container",
			label: container.name,
			link: null,
		};
	}

	/** CPU by container, each as a share of every core, plus what runs outside containers. */
	#cpu(
		host: SystemStats,
		usage: ContainerUsage[],
		owners: Owners,
		viewerId: string | null,
	): ResourceInsight {
		const consumers: ResourceConsumer[] = usage
			.filter((container) => container.hostCpuPercent > 0)
			.map((container) => ({
				...this.#describe(container, owners, viewerId),
				amount: `${round(container.hostCpuPercent)}%, ${round(container.cpuPercent / 100)} cores`,
				share: container.hostCpuPercent,
			}));
		const outside =
			host.cpuPercent -
			usage.reduce((sum, container) => sum + container.hostCpuPercent, 0);
		if (outside >= NOISE_SHARE) {
			consumers.push({
				amount: `${round(outside)}%`,
				detail:
					"The system and anything this host runs outside Docker, measured as what the containers don't account for",
				kind: "other",
				label: "Outside containers",
				link: null,
				share: outside,
			});
		}
		return {
			consumers: consumers.toSorted((a, b) => b.share - a.share),
			percent: host.cpuPercent,
			resource: "cpu",
		};
	}

	/** Memory by container, without its reclaimable page cache, plus what's held outside containers. */
	#memory(
		host: SystemStats,
		usage: ContainerUsage[],
		owners: Owners,
		viewerId: string | null,
	): ResourceInsight {
		const total = host.memTotalMb || 1;
		const consumers: ResourceConsumer[] = usage
			.filter((container) => container.memUsedMb > 0)
			.map((container) => ({
				...this.#describe(container, owners, viewerId),
				amount: formatBytes(container.memUsedMb * MB),
				share: (container.memUsedMb / total) * 100,
			}));
		const outsideMb =
			host.memUsedMb -
			usage.reduce((sum, container) => sum + container.memUsedMb, 0);
		if ((outsideMb / total) * 100 >= NOISE_SHARE) {
			consumers.push({
				amount: formatBytes(outsideMb * MB),
				detail:
					"The system, its caches the kernel can't drop, and anything outside Docker",
				kind: "other",
				label: "Outside containers",
				link: null,
				share: (outsideMb / total) * 100,
			});
		}
		return {
			consumers: consumers.toSorted((a, b) => b.share - a.share),
			percent: (host.memUsedMb / total) * 100,
			resource: "memory",
		};
	}

	/** What Docker keeps on disk, its biggest volumes one by one, plus everything else on the disk. */
	async #disk(host: SystemStats): Promise<ResourceInsight> {
		const df = await WorkerClient.get<DiskUsageResponse>("/v1/df");
		const totalBytes = (host.diskTotalGb ?? 0) * GB || 1;
		const entry = (
			bytes: number,
			fields: Omit<ResourceConsumer, "amount" | "link" | "share">,
		): ResourceConsumer => ({
			...fields,
			amount: formatBytes(bytes),
			link: null,
			share: (bytes / totalBytes) * 100,
		});
		const consumers: ResourceConsumer[] = [];
		for (const volume of df.Volumes ?? []) {
			const size = volume.UsageData?.Size ?? 0;
			if (size > 0) {
				consumers.push(
					entry(size, {
						detail: null,
						kind: "volume",
						label: volume.Name ?? "",
					}),
				);
			}
		}
		const images = df.LayersSize ?? 0;
		if (images > 0) {
			consumers.push(
				entry(images, {
					detail: "Every image on the host, layers they share counted once",
					kind: "images",
					label: "Images",
				}),
			);
		}
		const cache = (df.BuildCache ?? [])
			.filter((record) => !record.Shared)
			.reduce((sum, record) => sum + (record.Size ?? 0), 0);
		if (cache > 0) {
			consumers.push(
				entry(cache, {
					detail: "Docker Cleanup can clear what no build uses",
					kind: "build cache",
					label: "Build cache",
				}),
			);
		}
		for (const container of df.Containers ?? []) {
			const size = container.SizeRw ?? 0;
			if (size > 0) {
				consumers.push(
					entry(size, {
						detail: "Files written inside the container, outside its volumes",
						kind: "container",
						label: (container.Names?.[0] ?? "").replace(/^\//, ""),
					}),
				);
			}
		}
		const docker = consumers.reduce((sum, consumer) => sum + consumer.share, 0);
		const percent =
			host.diskUsedGb !== null && host.diskTotalGb
				? (host.diskUsedGb / host.diskTotalGb) * 100
				: 0;
		if (percent - docker >= NOISE_SHARE) {
			consumers.push({
				amount: formatBytes(((percent - docker) / 100) * totalBytes),
				detail:
					"The system, logs and anything outside Docker on this disk (Docker's own data may live on another one)",
				kind: "other",
				label: "Everything else",
				link: null,
				share: percent - docker,
			});
		}
		return {
			consumers: consumers.toSorted((a, b) => b.share - a.share),
			percent,
			resource: "disk",
		};
	}
}

export const ResourceInsightsService = new ResourceInsightsServiceClass();
