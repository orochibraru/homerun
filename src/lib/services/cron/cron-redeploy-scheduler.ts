import { ServiceDTO } from "$lib/dto/service-dto";
import { DeploymentService } from "../deploy.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";
import { cronMatches, sameMinute } from "./cron-expression.ts";

/**
 * Opt-in, per-service redeploy scheduler (Settings tab's `cronEnabled` +
 * `cronSchedule`). Queues a deploy job for whatever's due each tick,
 * guarding against a double-fire in the same matching minute via
 * `cronLastRunAt` ; the queue's own per-service dedupe is the second
 * guard, so a redeploy that's still waiting its turn is never queued
 * twice.
 */
export class CronRedeployScheduler extends BaseScheduler {
	protected readonly label = "Cron";

	private isDueNow(svc: ServiceDTO, now: Date): boolean {
		const schedule = svc.cronSchedule;
		if (!(schedule && cronMatches(schedule, now))) {
			return false;
		}
		// Guards against a double-fire within the same due minute if the
		// interval ever jitters (e.g. two ticks landing 59s apart) : the
		// cron spec is minute-resolution, so "already ran this minute" is a
		// legitimate reason to skip, not just bookkeeping for the UI.
		return !(svc.cronLastRunAt && sameMinute(svc.cronLastRunAt, now));
	}

	private async fireRedeploy(svc: ServiceDTO, now: Date): Promise<void> {
		this.logger.info(
			`Cron redeploy triggered: service=${svc.id} schedule="${svc.cronSchedule}"`,
		);
		await svc.update({ cronLastRunAt: now });
		await DeploymentService.enqueueDeploy({
			svc,
			trigger: "cron",
			userId: svc.userId,
		});
	}

	protected async tick(): Promise<void> {
		const now = new Date();
		const due = (await ServiceDTO.listCronEnabled()).filter((svc) =>
			this.isDueNow(svc, now),
		);

		await Promise.all(due.map((svc) => this.fireRedeploy(svc, now)));
	}
}
