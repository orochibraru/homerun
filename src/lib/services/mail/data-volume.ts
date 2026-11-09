import { StorageVolumeDTO } from "#lib/dto/storage-volume-dto.js";

import { MAIL_DATA_VOLUME } from "../docker/mail-container.ts";

/**
 * The mail data volume as a Storage entry, so Backups treats every
 * mailbox's mail like a service volume: restic snapshots on the schedule and
 * destination set on its Storage page.
 */
class MailDataVolumeServiceClass {
	/** The Storage entry standing for the mail data volume, null until it's added. */
	async get(): Promise<StorageVolumeDTO | null> {
		const volumes = await StorageVolumeDTO.list();
		return (
			volumes.find((volume) => {
				const row = volume.toJSON();
				return row.kind === "volume" && row.source === MAIL_DATA_VOLUME;
			}) ?? null
		);
	}

	/**
	 * Adds the mail data volume to Storage. Only the row: the Docker volume
	 * is the mail server's own and is never touched, and deleting the entry
	 * leaves it alone. An existing entry is returned as is.
	 */
	async add(userId: string): Promise<StorageVolumeDTO> {
		const existing = await this.get();
		if (existing) {
			return existing;
		}
		return await StorageVolumeDTO.create({
			description:
				"Every mailbox's mail, the mail server's own Docker volume. Removing this entry leaves the volume and its mail alone.",
			kind: "volume",
			name: "Mail data",
			source: MAIL_DATA_VOLUME,
			userId,
		});
	}
}

export const MailDataVolumeService = new MailDataVolumeServiceClass();
