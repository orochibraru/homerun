import { CronJobDTO } from "#lib/dto/cron-job-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { WorkstationDTO } from "#lib/dto/workstation-dto.js";
import { formatBytes } from "#lib/formatting.js";
import type { ResourceCause } from "#lib/resource-incidents.js";
import { WorkerClient } from "#lib/server/worker-client.js";
import {
	AgentClientService,
	type AgentConnection,
} from "#lib/services/agent-client.service.js";
import {
	VOLUME_HELPER_IMAGE,
	VOLUME_HELPER_TAG,
} from "#lib/services/backup/volume-services.js";
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
	| "process"
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

/** Every process on a host sharing a name and a cgroup unit, summed, as a worker reads them. */
export interface HostProcess {
	container: boolean;
	count: number;
	/** Their share of every core together, the host's own CPU% scale. */
	cpuPercent: number;
	/** The cgroup unit they run in (`docker.service`), or a container's short id. */
	group: string;
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

/** The smallest share a process outside containers needs to get its own row, in points of the host's capacity. */
const PROCESS_SHARE = 0.5;

/** How many processes outside containers get their own row. */
const PROCESS_ROWS = 8;

/** What the processes Docker itself runs on the host are, for the ones worth explaining. */
const KNOWN_PROCESSES: Record<string, string> = {
	containerd: "The container runtime Docker runs on",
	"containerd-shim": "Keeps one container running for containerd",
	"containerd-shim-runc-v2": "Keeps one container running for containerd",
	"docker-proxy": "Forwards a published port to its container",
	dockerd: "The Docker daemon",
	pasta: "Rootless Docker's network: every container's traffic goes through it",
	rootlesskit:
		"Rootless Docker's wrapper, forwarding published ports through it",
	slirp4netns:
		"Rootless Docker's network: every container's traffic goes through it",
	vpnkit:
		"Rootless Docker's network: every container's traffic goes through it",
};

/** One decimal under ten, whole past it. */
function round(value: number): string {
	return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

/** A process group's name: `php-fpm ×12` when it's several. */
function processLabel(process: HostProcess): string {
	return process.count > 1 ? `${process.name} ×${process.count}` : process.name;
}

/** Where a process outside containers runs, and what it is when it's one of Docker's own. */
function processDetail(process: HostProcess): string {
	const known = KNOWN_PROCESSES[process.name];
	const where = process.group
		? `Outside containers, in ${process.group}`
		: "Outside containers";
	return known ? `${known}. ${where}` : where;
}

/** What names a host's consumers: whose containers they are, its processes, and who's looking. */
interface Readers {
	owners: Owners;
	processes: HostProcess[] | null;
	viewerId: string | null;
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
	#processes: Promise<HostProcess[] | null> | null = null;

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
		const [usage, owners, processes] = await Promise.all([
			WorkerClient.get<ContainerUsage[]>("/v1/host/usage"),
			this.#owners(),
			this.#hostProcesses(),
		]);
		return resource === "cpu"
			? this.#cpu(host, usage, { owners, processes, viewerId })
			: this.#memory(host, usage, { owners, processes, viewerId });
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

	/**
	 * The biggest `limit` users of `resource` on a remote host, from its
	 * agent's processes: an agent runs on the host itself, so it sees them
	 * all, containers' included. Empty for the disk, and when the agent
	 * can't be read or is too old to know the route.
	 */
	async remoteCauses(
		connection: AgentConnection,
		resource: InsightResource,
		limit = 3,
	): Promise<ResourceCause[]> {
		if (resource === "disk") {
			return [];
		}
		try {
			const processes = await AgentClientService.request<HostProcess[]>(
				connection,
				"GET",
				"/v1/processes",
				{ timeoutMs: 10_000 },
			);
			const cpu = resource === "cpu";
			return processes
				.toSorted((a, b) =>
					cpu ? b.cpuPercent - a.cpuPercent : b.memUsedMb - a.memUsedMb,
				)
				.slice(0, limit)
				.map((process) => ({
					amount: cpu
						? `${round(process.cpuPercent)}%`
						: formatBytes(process.memUsedMb * MB),
					label: `${processLabel(process)}${process.container ? " (container)" : ""}`,
				}));
		} catch {
			return [];
		}
	}

	/**
	 * Every process on this host, read by the worker through a helper in the
	 * host's PID namespace; reads asked for while one runs (an alert's CPU and
	 * memory causes) share it. Null when they can't be read: the
	 * outside-containers row then stays one line.
	 */
	#hostProcesses(): Promise<HostProcess[] | null> {
		this.#processes ??= WorkerClient.get<HostProcess[]>("/v1/host/processes", {
			image: `${VOLUME_HELPER_IMAGE}:${VOLUME_HELPER_TAG}`,
		})
			.catch(() => null)
			.finally(() => {
				this.#processes = null;
			});
		return this.#processes;
	}

	/**
	 * What runs outside containers, `outside` points of the host in all: its
	 * biggest processes one by one when they could be read, and the rest as
	 * one row, or that whole remainder as one row when they couldn't.
	 */
	#outside(
		outside: number,
		processes: HostProcess[] | null,
		measure: {
			amount: (share: number) => string;
			share: (process: HostProcess) => number;
		},
		whole: ResourceConsumer,
	): ResourceConsumer[] {
		const { amount, share } = measure;
		const listed = (processes ?? [])
			.filter((process) => !process.container)
			.map((process) => ({ process, share: share(process) }))
			.filter((entry) => entry.share >= PROCESS_SHARE)
			.toSorted((a, b) => b.share - a.share)
			.slice(0, PROCESS_ROWS);
		if (listed.length === 0) {
			return outside >= NOISE_SHARE ? [whole] : [];
		}
		const rows: ResourceConsumer[] = listed.map((entry) => ({
			amount: amount(entry.share),
			detail: processDetail(entry.process),
			kind: "process",
			label: processLabel(entry.process),
			link: null,
			share: entry.share,
		}));
		const rest = outside - listed.reduce((sum, entry) => sum + entry.share, 0);
		if (rest >= NOISE_SHARE) {
			rows.push({
				...whole,
				amount: amount(rest),
				label: "Rest outside containers",
				share: rest,
			});
		}
		return rows;
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
		{ owners, processes, viewerId }: Readers,
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
		consumers.push(
			...this.#outside(
				outside,
				processes,
				{
					amount: (share) => `${round(share)}%`,
					share: (process) => process.cpuPercent,
				},
				{
					amount: `${round(outside)}%`,
					detail:
						"The system and anything this host runs outside Docker, measured as what the containers don't account for",
					kind: "other",
					label: "Outside containers",
					link: null,
					share: outside,
				},
			),
		);
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
		{ owners, processes, viewerId }: Readers,
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
		consumers.push(
			...this.#outside(
				(outsideMb / total) * 100,
				processes,
				{
					amount: (share) => formatBytes((share / 100) * total * MB),
					share: (process) => (process.memUsedMb / total) * 100,
				},
				{
					amount: formatBytes(outsideMb * MB),
					detail:
						"The system, its caches the kernel can't drop, and anything outside Docker",
					kind: "other",
					label: "Outside containers",
					link: null,
					share: (outsideMb / total) * 100,
				},
			),
		);
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
