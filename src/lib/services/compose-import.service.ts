import {
	type ComposeServiceDraft,
	orderByDependencies,
	slugifyComposeKey,
} from "$lib/compose-import";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import { DeploymentService } from "./deploy.service.ts";

const logger = new Logger("ComposeImport");

export interface ComposeImportInput {
	drafts: ComposeServiceDraft[];
	stackId: string | null;
	stackName: string | null;
	userId: string;
}

export interface ComposeImportResult {
	stackId: string | null;
	services: ServiceDTO[];
}

async function uniqueServiceSlug(slug: string): Promise<string> {
	let candidate = slug;
	let attempt = 2;
	// biome-ignore lint/performance/noAwaitInLoops: each candidate can only be checked once the previous one came back taken
	while (await ServiceDTO.slugTaken(candidate)) {
		candidate = `${slug.slice(0, 58)}-${attempt}`;
		attempt += 1;
	}
	return candidate;
}

async function uniqueStackSlug(name: string): Promise<string> {
	const base = slugifyComposeKey(name) || "imported-stack";
	let candidate = base;
	let attempt = 2;
	// biome-ignore lint/performance/noAwaitInLoops: each candidate can only be checked once the previous one came back taken
	while (await StackDTO.slugTaken(candidate)) {
		candidate = `${base.slice(0, 58)}-${attempt}`;
		attempt += 1;
	}
	return candidate;
}

class ComposeImportServiceClass {
	/** Resolves which stack imported services belong to: the given `stackId` if it exists, a newly created stack from `stackName`, or null (no stack) if neither is given. */
	async #resolveStackId(input: ComposeImportInput): Promise<string | null> {
		if (input.stackId) {
			const existing = await StackDTO.get(input.stackId, input.userId);
			return existing ? existing.id : null;
		}
		if (!input.stackName) {
			return null;
		}
		const created = await StackDTO.create({
			name: input.stackName,
			slug: await uniqueStackSlug(input.stackName),
			userId: input.userId,
		});
		return created.id;
	}

	/**
	 * Maps each of `draft`'s volume mounts to a storage volume id, reusing an
	 * existing volume with the same kind/source or creating a new one
	 * (appended to `existing` so a later draft in the same import can reuse
	 * it too).
	 */
	async #resolveVolumes(
		draft: ComposeServiceDraft,
		userId: string,
		existing: StorageVolumeDTO[],
	): Promise<Map<string, string>> {
		const byMount = new Map<string, string>();
		for (const mount of draft.volumes) {
			const match = existing.find(
				(vol) => vol.kind === mount.kind && vol.source === mount.source,
			);
			if (match) {
				byMount.set(mount.containerPath, match.id);
				continue;
			}
			// biome-ignore lint/performance/noAwaitInLoops: each volume is created before the next one's name collision can be checked
			const created = await StorageVolumeDTO.create({
				kind: mount.kind,
				name: mount.name,
				source: mount.source,
				userId,
			});
			existing.push(created);
			byMount.set(mount.containerPath, created.id);
		}
		return byMount;
	}

	/**
	 * Creates one service row from a parsed compose draft, resolves and
	 * attaches its volume mounts (`#resolveVolumes`), and fires a
	 * `service_created` notification.
	 */
	async #createService(
		draft: ComposeServiceDraft,
		stackId: string | null,
		userId: string,
		volumes: StorageVolumeDTO[],
	): Promise<ServiceDTO> {
		const svc = await ServiceDTO.create({
			buildSource: draft.build ? "git" : "image",
			containerPort: draft.containerPort,
			cpuLimit: draft.cpuLimit,
			dnsResolvable: draft.dnsResolvable,
			envVars: draft.envVars,
			gitBuildContext: draft.build?.context ?? null,
			gitDockerfilePath: draft.build?.dockerfile ?? null,
			gitRef: draft.build?.gitRef ?? null,
			gitUrl: draft.build?.gitUrl ?? null,
			image: draft.image,
			memoryLimitMb: draft.memoryLimitMb,
			name: draft.name,
			networkMode: draft.networkMode,
			portProtocol: draft.portProtocol,
			stackId,
			restartPolicy: draft.restartPolicy,
			slug: await uniqueServiceSlug(draft.slug),
			tag: draft.tag,
			userId,
		});

		const mounts = await this.#resolveVolumes(draft, userId, volumes);
		for (const mount of draft.volumes) {
			const volumeId = mounts.get(mount.containerPath);
			if (!volumeId) {
				continue;
			}
			// biome-ignore lint/performance/noAwaitInLoops: mounts are inserted in declaration order
			await ServiceVolumeDTO.attach({
				containerPath: mount.containerPath,
				readOnly: mount.readOnly,
				serviceId: svc.id,
				volumeId,
			});
		}

		NotificationDTO.notify({
			message: `"${svc.name}" was created from a compose file.`,
			serviceId: svc.id,
			type: "service_created",
			userId,
		});
		return svc;
	}

	/**
	 * Creates every service (and their stack, if any) from a parsed compose
	 * file, in dependency order (`orderByDependencies`) so a `depends_on`
	 * target already exists by the time a dependent service references it.
	 * Does not deploy anything, see `deployImported` for that.
	 */
	async importPlan(input: ComposeImportInput): Promise<ComposeImportResult> {
		const stackId = await this.#resolveStackId(input);
		const volumes = await StorageVolumeDTO.list(input.userId);
		const ordered = orderByDependencies(input.drafts);

		const services: ServiceDTO[] = [];
		for (const draft of ordered) {
			// biome-ignore lint/performance/noAwaitInLoops: slug uniqueness is checked against rows the previous iteration just inserted
			const created = await this.#createService(
				draft,
				stackId,
				input.userId,
				volumes,
			);
			services.push(created);
		}

		logger.info(
			`Compose stack imported: services=${services.length} stack=${stackId ?? "none"} user=${input.userId}`,
		);
		return { stackId, services };
	}

	/** Enqueues a stack deploy for freshly imported services, deploying the last one (by import order) as primary with the rest as its dependencies. No-op if `services` is empty. */
	async deployImported(services: ServiceDTO[], userId: string): Promise<void> {
		if (services.length === 0) {
			return;
		}
		const primary = services[services.length - 1] as ServiceDTO;
		await DeploymentService.enqueueStackDeploy(
			primary,
			services.slice(0, -1),
			userId,
		);
	}
}

export const ComposeImportService = new ComposeImportServiceClass();
