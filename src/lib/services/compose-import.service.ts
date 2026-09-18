import {
	bindVolumeName,
	type ComposeFileDraft,
	type ComposeServiceDraft,
	orderByDependencies,
	slugifyComposeKey,
} from "$lib/compose-import";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { HOST_ACCESS_MESSAGE, hostAccessRequested } from "$lib/host-access";
import { Logger } from "$lib/logger";
import { uniqueSlug } from "$lib/slug";
import { tarArchive } from "$lib/tar";
import { DeploymentService } from "./deploy.service.ts";
import { DockerService } from "./docker.service.ts";
import { encryptSecret } from "./secrets.ts";

const logger = new Logger("ComposeImport");

const HOST_FILES_DIR = "/var/lib/homerun/files";
const HELPER_IMAGE = "alpine";
const HELPER_TAG = "3";

export interface ComposeImportInput {
	allowHostAccess: boolean;
	drafts: ComposeServiceDraft[];
	stackId: string | null;
	stackName: string | null;
	userId: string;
}

export class HostAccessError extends Error {}

export interface ComposeImportResult {
	stackId: string | null;
	services: ServiceDTO[];
}

class ComposeImportServiceClass {
	/** Resolves which stack imported services belong to: the given `stackId` if it exists, a newly created stack from `stackName`, or null (no stack) if neither is given. */
	async #resolveStackId(input: ComposeImportInput): Promise<string | null> {
		if (input.stackId) {
			const existing = await StackDTO.get(input.stackId);
			return existing ? existing.id : null;
		}
		if (!input.stackName) {
			return null;
		}
		const created = await StackDTO.create({
			name: input.stackName,
			slug: await uniqueSlug(
				slugifyComposeKey(input.stackName) || "imported-stack",
				(slug) => StackDTO.slugTaken(slug),
			),
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
			// oxlint-disable-next-line no-await-in-loop -- each volume is created before the next one's name collision can be checked
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

	/** A draft's private registry credentials as service columns, the password encrypted. */
	#registryColumns(draft: ComposeServiceDraft) {
		return {
			registryPasswordEnc: draft.registry?.password
				? encryptSecret(draft.registry.password)
				: null,
			registryUrl: draft.registry?.url ?? null,
			registryUsername: draft.registry?.username ?? null,
		};
	}

	/**
	 * Carries file mounts over : every file's content goes to
	 * `HOST_FILES_DIR/<slug>/` in one tar through Docker's archive endpoint
	 * (a stopped helper container with that host directory bound), so there's
	 * no size limit, then each is bind-mounted read-only at its container path
	 * through a new bind storage volume.
	 *
	 * @throws When the helper container can't be created or the archive
	 * can't be extracted.
	 */
	async #attachFiles(
		svc: ServiceDTO,
		files: ComposeFileDraft[],
		userId: string,
	): Promise<void> {
		if (files.length === 0) {
			return;
		}
		const mounts = files.map((file, index) => {
			const baseName =
				slugifyComposeKey(file.containerPath.split("/").pop() ?? "") || "file";
			return { ...file, relative: `${svc.slug}/${index + 1}-${baseName}` };
		});
		await DockerService.extractIntoVolume({
			archive: tarArchive([
				{ name: svc.slug, type: "directory" },
				...mounts.map((mount) => ({
					content: mount.content,
					name: mount.relative,
					type: "file" as const,
				})),
			]),
			image: HELPER_IMAGE,
			mountPath: "/files",
			tag: HELPER_TAG,
			volumeName: HOST_FILES_DIR,
		});
		for (const mount of mounts) {
			// oxlint-disable-next-line no-await-in-loop -- mounts are attached in declaration order
			const volume = await StorageVolumeDTO.create({
				kind: "bind",
				name: bindVolumeName(svc.slug, mount.containerPath),
				source: `${HOST_FILES_DIR}/${mount.relative}`,
				userId,
			});
			// oxlint-disable-next-line no-await-in-loop -- volumes attach in order to the service just created
			await ServiceVolumeDTO.attach({
				containerPath: mount.containerPath,
				readOnly: true,
				serviceId: svc.id,
				volumeId: volume.id,
			});
		}
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
			...this.#registryColumns(draft),
			buildSource: draft.build ? "git" : "image",
			containerPort: draft.containerPort,
			cpuLimit: draft.cpuLimit,
			dnsResolvable: draft.dnsResolvable,
			envVars: draft.envVars,
			gitBuildContext: draft.build?.context ?? null,
			gitBuildMethod: draft.build?.method ?? "dockerfile",
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
			runtime: {
				capAdd: draft.capAdd,
				command: draft.command,
				devices: draft.devices,
				entrypoint: draft.entrypoint,
				envFiles: draft.envFiles,
				labels: draft.labels,
				privileged: draft.privileged,
			},
			slug: await uniqueSlug(draft.slug, (slug) => ServiceDTO.slugTaken(slug)),
			tag: draft.tag,
			userId,
		});

		const mounts = await this.#resolveVolumes(draft, userId, volumes);
		for (const mount of draft.volumes) {
			const volumeId = mounts.get(mount.containerPath);
			if (!volumeId) {
				continue;
			}
			// oxlint-disable-next-line no-await-in-loop -- mounts are inserted in declaration order
			await ServiceVolumeDTO.attach({
				containerPath: mount.containerPath,
				readOnly: mount.readOnly,
				serviceId: svc.id,
				volumeId,
			});
		}

		await this.#attachFiles(svc, draft.files, userId);

		NotificationDTO.notify({
			message: `"${svc.name}" was created from a compose file.`,
			serviceId: svc.id,
			type: "service_created",
		});
		return svc;
	}

	/**
	 * Creates every service (and their stack, if any) from a parsed compose
	 * file, in dependency order (`orderByDependencies`) so a `depends_on`
	 * target already exists by the time a dependent service references it.
	 * Does not deploy anything, see `deployImported` for that.
	 *
	 * @throws HostAccessError When `allowHostAccess` is false and a draft asks
	 * for privileged mode, devices, added capabilities or host env files.
	 */
	async importPlan(input: ComposeImportInput): Promise<ComposeImportResult> {
		if (
			!input.allowHostAccess &&
			input.drafts.some((draft) => hostAccessRequested(draft))
		) {
			throw new HostAccessError(HOST_ACCESS_MESSAGE);
		}
		const stackId = await this.#resolveStackId(input);
		const volumes = await StorageVolumeDTO.list();
		const ordered = orderByDependencies(input.drafts);

		const services: ServiceDTO[] = [];
		for (const draft of ordered) {
			// oxlint-disable-next-line no-await-in-loop -- slug uniqueness is checked against rows the previous iteration just inserted
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
		const primary = services[services.length - 1];
		await DeploymentService.enqueueStackDeploy(
			primary,
			services.slice(0, -1),
			userId,
		);
	}
}

export const ComposeImportService = new ComposeImportServiceClass();
