import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";
import { DeploymentService } from "./deploy.service.ts";
import { DockerService } from "./docker.service.ts";
import { S3BackupService } from "./s3-backup.service.ts";
import { SystemStatsService } from "./system-stats.service.ts";

const logger = new Logger("Cron");
const TICK_MS = 60_000;

/**
 * Minimal standard 5-field cron ("min hour day month weekday") matcher :
 * no external dependency, deliberately: this app stays dependency-light
 * (see e.g. no AWS SDK for storage, no cron package here) and a redeploy
 * scheduler only needs minute-resolution matching, not a full spec.
 *
 * Supports a wildcard, a literal number, "a-b" ranges, "a,b,c" lists, and
 * step values (asterisk, slash, N) : combinable per field (e.g.
 * "0,30 9-17 * * 1-5"). Evaluated against the server's local time; no
 * timezone field.
 */

const FIELD_RANGES = {
	day: [1, 31],
	hour: [0, 23],
	minute: [0, 59],
	month: [1, 12],
	weekday: [0, 6],
} as const;

type FieldName = keyof typeof FIELD_RANGES;
const FIELD_ORDER: FieldName[] = ["minute", "hour", "day", "month", "weekday"];

const STEP_PART_RE = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/;
const RANGE_RE = /^(\d+)(?:-(\d+))?$/;
const WHITESPACE_RE = /\s+/;

/** Parses one comma-separated part (e.g. "9-17", "*\/15", "5") into the values it covers, or null if malformed. */
function parsePart(part: string, min: number, max: number): number[] | null {
	const stepMatch = part.match(STEP_PART_RE);
	if (!stepMatch) {
		return null;
	}
	const [, base, stepStr] = stepMatch;
	const step = stepStr ? Number(stepStr) : 1;
	if (!(Number.isInteger(step) && step > 0)) {
		return null;
	}

	let rangeStart = min;
	let rangeEnd = max;
	if (base !== "*") {
		const rangeMatch = base.match(RANGE_RE);
		if (!rangeMatch) {
			return null;
		}
		rangeStart = Number(rangeMatch[1]);
		rangeEnd = rangeMatch[2] ? Number(rangeMatch[2]) : rangeStart;
	}
	if (rangeStart < min || rangeEnd > max || rangeStart > rangeEnd) {
		return null;
	}

	const values: number[] = [];
	for (let v = rangeStart; v <= rangeEnd; v += step) {
		values.push(v);
	}
	return values;
}

function parseField(raw: string, field: FieldName): Set<number> | null {
	const [min, max] = FIELD_RANGES[field];
	const values = new Set<number>();

	for (const part of raw.split(",")) {
		const parsed = parsePart(part, min, max);
		if (!parsed) {
			return null;
		}
		for (const v of parsed) {
			values.add(v);
		}
	}

	return values.size > 0 ? values : null;
}

export interface ParsedCron {
	day: Set<number>;
	hour: Set<number>;
	minute: Set<number>;
	month: Set<number>;
	weekday: Set<number>;
}

function sameMinute(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate() &&
		a.getHours() === b.getHours() &&
		a.getMinutes() === b.getMinutes()
	);
}

// Survive Vite HMR the same way the db singleton does (db/lib.ts) : without
// these, every hot reload of a module in this import chain would start a
// second interval, double-firing redeploys/backups. Kept as two distinct
// keys even though both schedulers now live in one file, so one starting
// never short-circuits the other.
const globalForCron = globalThis as unknown as {
	__cron_interval?: ReturnType<typeof setInterval>;
};
const globalForBackup = globalThis as unknown as {
	__backup_interval?: ReturnType<typeof setInterval>;
};
const globalForAutoscale = globalThis as unknown as {
	__autoscale_interval?: ReturnType<typeof setInterval>;
};

function isServiceDueNow(svc: ServiceDTO, now: Date): boolean {
	const schedule = svc.cronSchedule;
	if (!(schedule && CronService.cronMatches(schedule, now))) {
		return false;
	}
	// Guards against a double-fire within the same due minute if the
	// interval ever jitters (e.g. two ticks landing 59s apart) : the cron
	// spec is minute-resolution, so "already ran this minute" is a
	// legitimate reason to skip, not just bookkeeping for the UI.
	return !(svc.cronLastRunAt && sameMinute(svc.cronLastRunAt, now));
}

async function fireCronRedeploy(svc: ServiceDTO, now: Date): Promise<void> {
	logger.info(
		`Cron redeploy triggered: service=${svc.id} schedule="${svc.cronSchedule}"`,
	);
	await svc.update({ cronLastRunAt: now });

	// Fire-and-forget the actual deploy: one service's failure shouldn't
	// block the others, and the tick itself only needs to record intent.
	DeploymentService.deployService(svc, svc.userId)
		.then((result) => {
			if (!result.success) {
				logger.error(`Cron redeploy failed: service=${svc.id}`, result.error);
			}
		})
		.catch((err) => {
			logger.error(`Cron redeploy threw: service=${svc.id}`, err);
		});
}

async function cronTick(): Promise<void> {
	const now = new Date();
	const due = (await ServiceDTO.listCronEnabled()).filter((svc) =>
		isServiceDueNow(svc, now),
	);

	await Promise.all(due.map((svc) => fireCronRedeploy(svc, now)));
}

function isVolumeDueNow(volume: StorageVolumeDTO, now: Date): boolean {
	const schedule = volume.backupSchedule;
	if (!(schedule && CronService.cronMatches(schedule, now))) {
		return false;
	}
	return !(volume.backupLastRunAt && sameMinute(volume.backupLastRunAt, now));
}

async function runScheduledBackup(
	volume: StorageVolumeDTO,
	now: Date,
): Promise<void> {
	logger.info(
		`Scheduled backup triggered: volume=${volume.id} schedule="${volume.backupSchedule}"`,
	);
	await volume.update({ backupLastRunAt: now });

	const result = await S3BackupService.backupVolume(volume);
	if (!result.success) {
		logger.error(`Scheduled backup failed: volume=${volume.id}`, result.error);
	}
}

async function backupTick(): Promise<void> {
	const now = new Date();
	const due = (await StorageVolumeDTO.listBackupEnabled()).filter((v) =>
		isVolumeDueNow(v, now),
	);

	await Promise.all(due.map((v) => runScheduledBackup(v, now)));
}

/**
 * Migrates one autoscale-eligible service off the local host onto
 * `instanceSettings.autoscaleOverflowRemoteHostId` : the "GCP Cloud Run
 * like" load-shedding behavior: local host over threshold + a service opted
 * in (Compute tab) = move it, don't spin up a second replica (this app's
 * data model is one container per service, not N : see the Network mode
 * section's own precedent for what's realistic to build without a real
 * rearchitecture). Explicitly stops/removes the *old* local container
 * before deploying the new one on the overflow host : `deployService`'s own
 * "replace previous container" logic (`findServiceContainer`) only looks on
 * whichever daemon it's pointed at, so it would never find (and thus never
 * clean up) a container left behind on a *different* host.
 *
 * Untested against a real second host from this session (no second Docker
 * daemon available to migrate a live service across and verify) : composed
 * entirely from already-exercised primitives instead (RemoteHostDTO's own
 * ownership-scoped connectionFor, DockerService.removeContainer against a
 * remote connection, DeploymentService.deployService) rather than new Docker
 * API shapes, which is meaningfully lower-risk than inventing new container-
 * creation mechanics, but still: verify the first real migration by hand.
 */
async function migrateToOverflow(
	svc: ServiceDTO,
	overflowRemoteHostId: string,
): Promise<void> {
	logger.info(
		`Autoscale migrating service: service=${svc.id} to remoteHost=${overflowRemoteHostId}`,
	);

	// The overflow host must be owned by the same user as the service being
	// migrated : RemoteHostDTO.connectionFor() is ownership-scoped like
	// every other DTO lookup, so a host configured by a different account
	// makes this a safe no-op (logged) rather than a cross-account leak.
	const newHost = await RemoteHostDTO.get(overflowRemoteHostId, svc.userId);
	if (!newHost) {
		logger.warn(
			`Autoscale overflow host not visible to service owner, skipping: service=${svc.id} user=${svc.userId} host=${overflowRemoteHostId}`,
		);
		return;
	}

	if (svc.containerId) {
		try {
			// No `remote` arg : this service's containerId is still on the
			// local host at this point, since remoteHostId hasn't been
			// switched yet.
			await DockerService.removeContainer(svc.containerId, { force: true });
		} catch (err) {
			logger.warn(
				`Couldn't remove old local container before migrating: service=${svc.id}`,
				err,
			);
		}
	}

	await svc.update({ remoteHostId: overflowRemoteHostId });

	const result = await DeploymentService.deployService(svc, svc.userId);
	if (!result.success) {
		logger.error(
			`Autoscale migration deploy failed: service=${svc.id}`,
			result.error,
		);
	}
}

async function autoscaleTick(): Promise<void> {
	const settings = await InstanceSettingsDTO.get();
	const { autoscaleEnabled, autoscaleOverflowRemoteHostId } =
		settings.autoscale;
	if (!(autoscaleEnabled && autoscaleOverflowRemoteHostId)) {
		return;
	}

	const stats = await SystemStatsService.getSystemStats();
	const memPercent =
		stats.memTotalMb > 0 ? (stats.memUsedMb / stats.memTotalMb) * 100 : 0;
	const overCpu =
		stats.cpuPercent > settings.autoscale.autoscaleCpuThresholdPercent;
	const overMem =
		memPercent > settings.autoscale.autoscaleMemoryThresholdPercent;
	if (!(overCpu || overMem)) {
		return;
	}

	const candidates = await ServiceDTO.listAutoscaleEligibleOnLocalHost();
	if (candidates.length === 0) {
		logger.warn(
			`Host over threshold (cpu=${stats.cpuPercent.toFixed(1)}% mem=${memPercent.toFixed(1)}%) but no autoscale-eligible service to migrate.`,
		);
		return;
	}

	// One migration per tick : re-checks the threshold on the next tick
	// rather than potentially moving several services off the local host
	// at once for a single reading.
	await migrateToOverflow(candidates[0], autoscaleOverflowRemoteHostId);
}

/** Cron-expression parsing plus the two 60s-tick schedulers (redeploys, volume backups). */
export class CronService {
	/** Parses a 5-field cron expression, or null if it's malformed. */
	static parseCronSchedule(schedule: string): ParsedCron | null {
		const parts = schedule.trim().split(WHITESPACE_RE);
		if (parts.length !== 5) {
			return null;
		}

		const result: Partial<ParsedCron> = {};
		for (const [i, field] of FIELD_ORDER.entries()) {
			const parsed = parseField(parts[i], field);
			if (!parsed) {
				return null;
			}
			result[field] = parsed;
		}
		return result as ParsedCron;
	}

	/** Whether the given schedule is due at the given date (minute resolution : seconds are ignored). */
	static cronMatches(schedule: string, date: Date): boolean {
		const parsed = CronService.parseCronSchedule(schedule);
		if (!parsed) {
			return false;
		}
		return (
			parsed.minute.has(date.getMinutes()) &&
			parsed.hour.has(date.getHours()) &&
			parsed.day.has(date.getDate()) &&
			parsed.month.has(date.getMonth() + 1) &&
			parsed.weekday.has(date.getDay())
		);
	}

	/** Starts the once-a-minute cron redeploy check. Idempotent : safe to call on every dev-server HMR reload. */
	static startCronScheduler(): void {
		if (globalForCron.__cron_interval) {
			return;
		}
		logger.info("Cron scheduler started (60s tick).");
		globalForCron.__cron_interval = setInterval(() => {
			cronTick().catch((err) => logger.error("Cron tick failed", err));
		}, TICK_MS);
	}

	/** Starts the once-a-minute scheduled-backup check. Idempotent : safe to call on every dev-server HMR reload. */
	static startBackupScheduler(): void {
		if (globalForBackup.__backup_interval) {
			return;
		}
		logger.info("Backup scheduler started (60s tick).");
		globalForBackup.__backup_interval = setInterval(() => {
			backupTick().catch((err) => logger.error("Backup tick failed", err));
		}, TICK_MS);
	}

	/**
	 * Starts the once-a-minute autoscale check. Idempotent : safe to call on
	 * every dev-server HMR reload. A no-op every tick unless
	 * instanceSettings.autoscaleEnabled is on *and* an overflow remote host
	 * is configured (Settings' Autoscaling section) : same opt-in-and-inert-
	 * by-default posture as the other two schedulers here.
	 */
	static startAutoscaleScheduler(): void {
		if (globalForAutoscale.__autoscale_interval) {
			return;
		}
		logger.info("Autoscale scheduler started (60s tick).");
		globalForAutoscale.__autoscale_interval = setInterval(() => {
			autoscaleTick().catch((err) =>
				logger.error("Autoscale tick failed", err),
			);
		}, TICK_MS);
	}
}
