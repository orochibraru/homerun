import { JobDTO } from "$lib/dto/job-dto";
import { DockerService } from "../docker.service.ts";
import { enqueueCleanup } from "../docker-cleanup-queue.ts";
import { UserService } from "../user.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";

const RUN_HOUR = 4;
const TICK_MS = 10 * 60 * 1000;

function dayKey(date: Date): string {
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export class MirrorGcScheduler extends BaseScheduler {
	protected readonly label = "MirrorGC";

	protected readonly intervalMs = TICK_MS;

	#lastRunDay: string | null = null;

	protected async tick(): Promise<void> {
		const now = new Date();
		if (now.getHours() !== RUN_HOUR || this.#lastRunDay === dayKey(now)) {
			return;
		}
		if (!(await DockerService.imageMirrorRunning().catch(() => false))) {
			this.#lastRunDay = dayKey(now);
			return;
		}
		const busy = await JobDTO.countByTypes(
			["deploy", "image_scan"],
			["queued", "running"],
		);
		if (busy > 0) {
			this.logger.info(
				`Mirror cleanup postponed: ${busy} deploy or scan job(s) queued or running.`,
			);
			return;
		}
		const adminId = await UserService.firstAdminId();
		if (!adminId) {
			return;
		}
		await enqueueCleanup("pruneMirror", false, adminId);
		this.#lastRunDay = dayKey(now);
		this.logger.info("Scheduled mirror cleanup queued.");
	}
}
