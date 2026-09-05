import {
	type ComposeServiceDraft,
	orderByDependencies,
	slugifyComposeKey,
} from "$lib/compose-import";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { ProjectDTO } from "$lib/dto/project-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import { DeploymentService } from "./deploy.service.ts";

const logger = new Logger("ComposeImport");

export interface ComposeImportInput {
	drafts: ComposeServiceDraft[];
	projectId: string | null;
	projectName: string | null;
	userId: string;
}

export interface ComposeImportResult {
	projectId: string | null;
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

async function uniqueProjectSlug(name: string): Promise<string> {
	const base = slugifyComposeKey(name) || "imported-stack";
	let candidate = base;
	let attempt = 2;
	// biome-ignore lint/performance/noAwaitInLoops: each candidate can only be checked once the previous one came back taken
	while (await ProjectDTO.slugTaken(candidate)) {
		candidate = `${base.slice(0, 58)}-${attempt}`;
		attempt += 1;
	}
	return candidate;
}

class ComposeImportServiceClass {
	async #resolveProjectId(input: ComposeImportInput): Promise<string | null> {
		if (input.projectId) {
			const existing = await ProjectDTO.get(input.projectId, input.userId);
			return existing ? existing.id : null;
		}
		if (!input.projectName) {
			return null;
		}
		const created = await ProjectDTO.create({
			name: input.projectName,
			slug: await uniqueProjectSlug(input.projectName),
			userId: input.userId,
		});
		return created.id;
	}

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

	async #createService(
		draft: ComposeServiceDraft,
		projectId: string | null,
		userId: string,
		volumes: StorageVolumeDTO[],
	): Promise<ServiceDTO> {
		const svc = await ServiceDTO.create({
			containerPort: draft.containerPort,
			cpuLimit: draft.cpuLimit,
			dnsResolvable: draft.dnsResolvable,
			envVars: draft.envVars,
			image: draft.image,
			memoryLimitMb: draft.memoryLimitMb,
			name: draft.name,
			networkMode: draft.networkMode,
			portProtocol: draft.portProtocol,
			projectId,
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

	async importPlan(input: ComposeImportInput): Promise<ComposeImportResult> {
		const projectId = await this.#resolveProjectId(input);
		const volumes = await StorageVolumeDTO.list(input.userId);
		const ordered = orderByDependencies(input.drafts);

		const services: ServiceDTO[] = [];
		for (const draft of ordered) {
			// biome-ignore lint/performance/noAwaitInLoops: slug uniqueness is checked against rows the previous iteration just inserted
			const created = await this.#createService(
				draft,
				projectId,
				input.userId,
				volumes,
			);
			services.push(created);
		}

		logger.info(
			`Compose stack imported: services=${services.length} project=${projectId ?? "none"} user=${input.userId}`,
		);
		return { projectId, services };
	}

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
