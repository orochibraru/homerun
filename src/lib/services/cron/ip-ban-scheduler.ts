import { IpBanService } from "../ip-ban.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";

/** Per-minute pass lifting expired IP bans and dropping old blocked-request counts. */
export class IpBanScheduler extends BaseScheduler {
	protected readonly label: string;

	/** Ticks every minute under the `IpBans` label. */
	constructor() {
		super();
		this.label = "IpBans";
	}

	/** Runs `IpBanService.prune`. */
	protected async tick(): Promise<void> {
		await IpBanService.prune();
	}
}
