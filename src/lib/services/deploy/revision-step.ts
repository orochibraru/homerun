import { DeploymentDTO } from "#lib/dto/deployment-dto.js";
import type { ServiceDTO } from "#lib/dto/service-dto.js";
import { ServiceVolumeDTO } from "#lib/dto/service-volume-dto.js";
import { StorageVolumeDTO } from "#lib/dto/storage-volume-dto.js";
import { DEPLOY_LOG_SCOPE, Logger } from "#lib/logger.js";
import {
	changedRevisionConfigFields,
	restorableRuntimeOptions,
	type VolumeMountSnapshot,
} from "#lib/revision-config.js";
import { isRevision } from "#lib/revisions.js";

const logger = new Logger(DEPLOY_LOG_SCOPE);

interface RevisionContext {
	dep: DeploymentDTO;
	svc: ServiceDTO;
}

/**
 * For a rollback asked to restore config, writes the target revision's
 * recorded env vars, resources and networking back onto the service before
 * the deploy plan is built, so the workload starts with them. A revision
 * recorded before snapshots existed is logged and skipped rather than
 * failing the rollback.
 */
export async function restoreRevisionConfig(
	ctx: RevisionContext,
	revisionId: string,
): Promise<void> {
	const { dep, svc } = ctx;
	const snapshot = (await DeploymentDTO.get(revisionId))?.configSnapshot;
	if (!snapshot) {
		await dep.appendLog(
			"This revision has no recorded environment, resources or networking to restore, keeping the current ones.",
		);
		return;
	}
	const currentMounts = (await ServiceVolumeDTO.listForService(svc.id)).map(
		({ mount }) => mount.snapshot(),
	);
	const changed = changedRevisionConfigFields(
		svc.toJSON(),
		snapshot,
		currentMounts,
	);
	await dep.appendLog(
		changed.length > 0
			? `Restoring this revision's config: ${changed.join(", ")}.`
			: "This revision's environment, resources and networking match the current ones.",
	);
	await svc.update({
		containerPort: snapshot.containerPort,
		cpuLimit: snapshot.cpuLimit,
		dnsResolvable: snapshot.dnsResolvable,
		envVars: snapshot.envVars,
		memoryLimitMb: snapshot.memoryLimitMb,
		networkMode: snapshot.networkMode,
		portProtocol: snapshot.portProtocol,
		...(snapshot.publishedPorts
			? { publishedPorts: snapshot.publishedPorts }
			: {}),
		replicas: snapshot.replicas,
		...restorableRuntimeOptions(snapshot),
	});
	if (snapshot.volumeMounts) {
		await restoreMounts(ctx, snapshot.volumeMounts);
	}
	logger.info(
		`Revision config restored: service=${svc.id} revision=${revisionId} fields=${changed.join("|") || "none"}`,
	);
}

/**
 * Puts back the volumes a revision was deployed with. A volume deleted since
 * can't come back: its mount is dropped and logged.
 */
async function restoreMounts(
	ctx: RevisionContext,
	mounts: VolumeMountSnapshot[],
): Promise<void> {
	const { dep, svc } = ctx;
	const kept: VolumeMountSnapshot[] = [];
	for (const mount of mounts) {
		// oxlint-disable-next-line no-await-in-loop -- a service mounts a handful of volumes
		if (await StorageVolumeDTO.get(mount.volumeId)) {
			kept.push(mount);
		} else {
			// oxlint-disable-next-line no-await-in-loop -- see above
			await dep.appendLog(
				`The volume this revision mounted at ${mount.containerPath} was deleted, so that mount is left out.`,
			);
		}
	}
	await ServiceVolumeDTO.replaceForService(svc.id, kept);
}

/**
 * For the redeploy that follows a restore into a new volume: mounts the
 * restored volume wherever the old one was mounted and turns off the old
 * volume's scheduled backups, since the restored one is the live copy now.
 * The old volume is kept, so rolling back to the previous revision with its
 * config puts it back.
 */
export async function swapRestoredVolume(
	ctx: RevisionContext,
	swap: { from: string; to: string },
): Promise<void> {
	const { dep, svc } = ctx;
	const [from, to] = await Promise.all([
		StorageVolumeDTO.get(swap.from),
		StorageVolumeDTO.get(swap.to),
	]);
	if (!to) {
		throw new Error(
			"The volume the backup was restored into was deleted before this deploy ran.",
		);
	}
	await recordMountsOnPreviousRevision(ctx);
	const moved = await ServiceVolumeDTO.swapVolume(svc.id, swap.from, swap.to);
	if (from?.toJSON().backupEnabled) {
		await from.update({ backupEnabled: false });
	}
	await dep.appendLog(
		moved > 0
			? `Mounting the restored volume ${to.name} in place of ${from?.name ?? "the previous one"}. Roll back with its config to go back to it.`
			: `${from?.name ?? "The previous volume"} isn't mounted any more, so the restored volume ${to.name} wasn't swapped in.`,
	);
	logger.info(
		`Restored volume swapped in: service=${svc.id} from=${swap.from} to=${swap.to} mounts=${moved}`,
	);
}

/**
 * Gives the revision a restore replaces the mounts it ran with, when it was
 * deployed before snapshots recorded them: without them, rolling back to it
 * with its config couldn't put the old volume back.
 */
async function recordMountsOnPreviousRevision(
	ctx: RevisionContext,
): Promise<void> {
	const { dep, svc } = ctx;
	const previous = (await DeploymentDTO.listForService(svc.id, 20)).find(
		(row) => row.id !== dep.id && isRevision(row.toJSON()),
	);
	const snapshot = previous?.configSnapshot;
	if (!previous || !snapshot || snapshot.volumeMounts) {
		return;
	}
	const mounts = await ServiceVolumeDTO.listForService(svc.id);
	await previous.update({
		configSnapshot: {
			...snapshot,
			volumeMounts: mounts.map(({ mount }) => mount.snapshot()),
		},
	});
}
