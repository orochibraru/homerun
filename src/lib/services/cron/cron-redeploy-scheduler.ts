import { ServiceDTO } from "$lib/dto/service-dto";
import { DeploymentService } from "../deploy.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";
import { cronMatches, sameMinute } from "./cron-expression.ts";

/**
 * Opt-in, per-service redeploy scheduler (Settings tab's `cronEnabled` +
 * `cronSchedule`). Fires `DeploymentService.deployService()` for whatever's
 * due each tick, guarding against a double-fire in the same matching
 * minute via `cronLastRunAt`.
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

		// Fire-and-forget the actual deploy: one service's failure shouldn't
		// block the others, and the tick itself only needs to record intent.
		DeploymentService.deployService(svc, svc.userId, undefined, "cron")
			.then((result) => {
				if (!result.success) {
					this.logger.error(
						`Cron redeploy failed: service=${svc.id}`,
						result.error,
					);
				}
			})
			.catch((err) => {
				this.logger.error(`Cron redeploy threw: service=${svc.id}`, err);
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
