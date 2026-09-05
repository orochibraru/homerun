import { DeploymentDTO } from "$lib/dto/deployment-dto";
import type { JobDTO } from "$lib/dto/job-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import type { JobType } from "$lib/types";
import { DeploymentService } from "../deploy.service.ts";
import {
	DockerService,
	type PruneSummary,
	type SystemPruneSummary,
} from "../docker.service.ts";
import { S3BackupService } from "../s3-backup.service.ts";
import {
	backupJobPayload,
	type DockerCleanupAction,
	deployJobPayload,
	dockerCleanupJobPayload,
} from "./payloads.ts";

export type JobResult = Record<string, unknown> | null;
type JobHandler = (job: JobDTO) => Promise<JobResult>;

async function runDeploy(entry: JobDTO): Promise<JobResult> {
	const { deploymentId, serviceId, trigger, userId } = deployJobPayload.parse(
		entry.payload,
	);
	const svc = await ServiceDTO.get(serviceId, userId);
	if (!svc) {
		const message = "The service was deleted before its deploy ran.";
		const dep = await DeploymentDTO.get(deploymentId);
		await dep?.update({
			errorMessage: message,
			finishedAt: new Date(),
			status: "failed",
		});
		throw new Error(message);
	}

	const result = await DeploymentService.deployService(
		svc,
		userId,
		deploymentId,
		trigger,
	);
	if (!result.success) {
		throw new Error(result.error ?? "Deploy failed.");
	}
	return { containerId: result.containerId ?? null, deploymentId };
}

async function runBackup(entry: JobDTO): Promise<JobResult> {
	const { userId, volumeId } = backupJobPayload.parse(entry.payload);
	const volume = await StorageVolumeDTO.get(volumeId, userId);
	if (!volume) {
		throw new Error("The volume was deleted before its backup ran.");
	}

	const result = await S3BackupService.backupVolume(volume);
	await volume.update({ backupLastRunAt: new Date() });
	if (!result.success) {
		throw new Error(result.error ?? "Backup failed.");
	}
	return { key: result.key ?? null, sizeBytes: result.sizeBytes ?? null };
}

function cleanupRunner(
	action: DockerCleanupAction,
	all: boolean,
): Promise<PruneSummary | SystemPruneSummary> {
	switch (action) {
		case "pruneBuildCache":
			return DockerService.pruneBuildCache();
		case "pruneContainers":
			return DockerService.pruneContainers();
		case "pruneImages":
			return DockerService.pruneImages(all);
		case "pruneNetworks":
			return DockerService.pruneNetworks();
		case "pruneSystem":
			return DockerService.pruneSystem();
		default:
			return DockerService.pruneVolumes();
	}
}

async function runDockerCleanup(entry: JobDTO): Promise<JobResult> {
	const { action, all } = dockerCleanupJobPayload.parse(entry.payload);
	return { ...(await cleanupRunner(action, all)) };
}

export const jobHandlers: Record<JobType, JobHandler> = {
	backup: runBackup,
	deploy: runDeploy,
	docker_cleanup: runDockerCleanup,
};
