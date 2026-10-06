import { BackupCapacityService } from "../backup-capacity.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";

const HOUR_MS = 60 * 60 * 1000;

/** Hourly pass measuring how full the SFTP, SMB and WebDAV backup destinations are. */
export class BackupCapacityScheduler extends BaseScheduler {
	protected readonly label: string;
	protected readonly intervalMs = HOUR_MS;

	/** Ticks every hour under the `BackupCapacity` label. */
	constructor() {
		super();
		this.label = "BackupCapacity";
	}

	/** Runs `BackupCapacityService.checkAll`. */
	protected async tick(): Promise<void> {
		await BackupCapacityService.checkAll();
	}
}
