import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { BackupRunDTO } from "$lib/dto/backup-run-dto";
import { JobDTO } from "$lib/dto/job-dto";
import { S3DestinationDTO } from "$lib/dto/s3-destination-dto";
import { ServiceVolumeDTO } from "$lib/dto/service-volume-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import { parseListQuery } from "$lib/server/list-query";
import {
	cancelBackupRun,
	enqueueVolumeBackup,
} from "$lib/services/backup-queue";
import { nextCronRun } from "$lib/services/cron/cron-expression";
import { stackPath } from "$lib/stack-tree";

const logger = new Logger("Backups");

export const load = async ({ parent, url }) => {
	const { preferences } = await parent();
	const query = parseListQuery(
		url,
		{ filterKeys: ["kind", "outcome"] },
		preferences.perPage,
	);
	const [volumes, runs, destinations, volumeUsers, stackRows] =
		await Promise.all([
			StorageVolumeDTO.list(),
			BackupRunDTO.listPaged(query),
			S3DestinationDTO.list(),
			ServiceVolumeDTO.usersByVolume(),
			StackDTO.list(),
		]);
	const stacks = stackRows.map((s) => s.toJSON());
	const origin = (volumeId: string) => {
		const users = volumeUsers.get(volumeId) ?? [];
		return {
			services: users.map((u) => u.serviceName),
			stacks: [
				...new Set(
					users.flatMap((u) =>
						u.stackId ? [stackPath(u.stackId, stacks)] : [],
					),
				),
			],
		};
	};
	const destinationNames = new Map(destinations.map((d) => [d.id, d.name]));
	const logs = await JobDTO.logsFor(
		runs.items.map(({ run }) => run.toJSON().jobId),
	);

	return {
		filtered: query.active,
		page: runs.page,
		perPage: runs.perPage,
		runs: runs.items.map(({ run, volumeName }) => {
			const row = run.toJSON();
			return {
				...row,
				log: (row.jobId && logs.get(row.jobId)) || "",
				origin: origin(row.volumeId),
				volumeName,
			};
		}),
		total: runs.total,
		volumes: volumes.map((v) => ({
			destinationName: v.s3DestinationId
				? (destinationNames.get(v.s3DestinationId) ?? "unknown destination")
				: "no destination",
			nextRunAt:
				v.backupEnabled && v.backupSchedule
					? nextCronRun(v.backupSchedule, new Date())
					: null,
			origin: origin(v.id),
			...v.toJSON(),
		})),
	};
};

export const actions = {
	cancelRun: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const run = await BackupRunDTO.get(
			String((await request.formData()).get("runId") ?? ""),
		);
		if (!run) {
			return fail(404, { error: "That run doesn't exist any more." });
		}
		if (!(await cancelBackupRun(run, locals.user.name || locals.user.email))) {
			return fail(400, { error: "That run already finished." });
		}
		logger.info(
			`Backup run cancelled: run=${run.toJSON().id} user=${locals.user.id}`,
		);
		return { cancelled: true };
	},

	run: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const volumeId = (formData.get("volumeId") as string | null)?.trim();
		if (!volumeId) {
			return fail(400, { error: "Missing volume id." });
		}

		const volume = await StorageVolumeDTO.get(volumeId);
		if (!volume) {
			return fail(404, { error: "Volume not found." });
		}

		await volume.update({ backupLastRunAt: new Date() });
		const entry = await enqueueVolumeBackup(volume);
		logger.info(`Manual backup queued: volume=${volume.id} job=${entry.id}`);
		return { success: true };
	},
};
