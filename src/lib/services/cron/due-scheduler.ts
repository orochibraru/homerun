import { BaseScheduler } from "./base-scheduler.ts";
import { cronMatches, sameMinute } from "./cron-expression.ts";

export interface DueSchedulerConfig<T> {
	fire: (entity: T) => Promise<unknown>;
	label: string;
	lastRunAt: (entity: T) => Date | null;
	list: () => Promise<T[]>;
	markRun: (entity: T, now: Date) => Promise<unknown>;
	schedule: (entity: T) => string | null;
	describe: (entity: T) => string;
}

export class DueScheduler<T> extends BaseScheduler {
	protected readonly label: string;

	constructor(private readonly config: DueSchedulerConfig<T>) {
		super();
		this.label = config.label;
	}

	private isDueNow(entity: T, now: Date): boolean {
		const schedule = this.config.schedule(entity);
		if (!(schedule && cronMatches(schedule, now))) {
			return false;
		}
		const last = this.config.lastRunAt(entity);
		return !(last && sameMinute(last, now));
	}

	private async run(entity: T, now: Date): Promise<void> {
		this.logger.info(`Triggered: ${this.config.describe(entity)}`);
		await this.config.markRun(entity, now);
		await this.config.fire(entity);
	}

	protected async tick(): Promise<void> {
		const now = new Date();
		const due = (await this.config.list()).filter((entity) =>
			this.isDueNow(entity, now),
		);
		await Promise.all(due.map((entity) => this.run(entity, now)));
	}
}
