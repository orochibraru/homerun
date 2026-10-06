import { type Capacity, capacityAlertChange } from "#lib/backup-capacity.js";
import { config } from "#lib/config.js";
import { S3DestinationDTO } from "#lib/dto/s3-destination-dto.js";
import { Logger } from "#lib/logger.js";
import { remoteAbout } from "./backup/rclone.ts";
import { NotificationChannelService } from "./notification-channel.service.ts";
import { backupCapacityMessage } from "./notification-messages.ts";
import { S3BackupService } from "./s3-backup.service.ts";

const logger = new Logger("BackupCapacity");

/**
 * Watches how full the SFTP, SMB and WebDAV backup destinations are (S3 has
 * no fixed size to fill): measures them with `rclone about`, keeps the last
 * figures on the destination, and alerts the channels subscribed to
 * `backup.storage_low` once a destination crosses its threshold.
 */
class BackupCapacityServiceClass {
	/**
	 * Measures one destination, records the result and sends or clears its
	 * low-space alert. A failed measurement is recorded too, keeping the
	 * last good figures.
	 *
	 * @returns The figures, or the reason they couldn't be read.
	 */
	async check(
		destination: S3DestinationDTO,
	): Promise<{ capacity: Capacity } | { error: string }> {
		const target = S3BackupService.targetOf(destination);
		if (!("remote" in target)) {
			return { error: "An S3 bucket has no fixed size to watch." };
		}
		let result: { capacity: Capacity } | { error: string };
		try {
			result = { capacity: await remoteAbout(target.remote) };
		} catch (err) {
			result = { error: err instanceof Error ? err.message : String(err) };
		}
		await destination.recordCapacity(result);
		if ("capacity" in result) {
			await this.#alert(destination, result.capacity);
		}
		return result;
	}

	/** Sends the alert when the destination just crossed its threshold, clears it once it's clearly back under. */
	async #alert(
		destination: S3DestinationDTO,
		capacity: Capacity,
	): Promise<void> {
		const row = destination.toJSON();
		const change = capacityAlertChange({
			alerted: row.capacityAlertedAt !== null,
			capacity,
			thresholdPercent: row.capacityAlertPercent,
		});
		if (change === "recovered") {
			await destination.setCapacityAlerted(null);
			return;
		}
		if (change !== "alert") {
			return;
		}
		const now = new Date();
		await destination.setCapacityAlerted(now);
		const message = backupCapacityMessage(
			{
				capacity,
				destinationId: destination.id,
				name: destination.name,
				origin: config.auth.origin ?? null,
				thresholdPercent: row.capacityAlertPercent,
			},
			now.toISOString(),
		);
		logger.warn(message.title);
		NotificationChannelService.notify(message);
	}

	/** Measures every SFTP, SMB and WebDAV destination, one at a time so they don't all start a container at once. */
	async checkAll(): Promise<void> {
		for (const destination of await S3DestinationDTO.listNonS3()) {
			// oxlint-disable-next-line no-await-in-loop -- one rclone container at a time
			const result = await this.check(destination).catch((err: unknown) => ({
				error: err instanceof Error ? err.message : String(err),
			}));
			if ("error" in result) {
				logger.warn(
					`Capacity check failed for ${destination.name}: ${result.error}`,
				);
			}
		}
	}
}

export const BackupCapacityService = new BackupCapacityServiceClass();
