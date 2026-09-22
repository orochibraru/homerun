import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { WorkerClient } from "$lib/server/worker-client";
import { syncDashboardDns } from "../dns.service.ts";
import { DockerService } from "../docker.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";

const TICK_MS = 15_000;

export class CoreServicesWatch extends BaseScheduler {
	protected readonly label = "CoreServices";

	protected readonly intervalMs = TICK_MS;

	protected readonly runOnStart = true;

	#bootId: string | null = null;

	/**
	 * Polls the worker's health and, whenever its boot id differs from the
	 * last one seen (the first successful contact included), re-asserts the
	 * core services onto it: the dashboard's Traefik router and DNS record,
	 * the Newt tunnel, and swarm mode when that's the orchestration mode. So a
	 * worker restarted alone, or one that wasn't up yet when the app booted,
	 * still ends up converged. An unreachable worker is skipped silently and
	 * retried next tick; a failed convergence step is logged, not retried
	 * until the next worker restart.
	 */
	protected async tick(): Promise<void> {
		const health = await WorkerClient.get<{ bootId?: string }>(
			"/v1/health",
		).catch(() => null);
		const bootId = health?.bootId;
		if (!bootId || bootId === this.#bootId) {
			return;
		}
		this.logger.info(
			this.#bootId
				? "Worker restarted, re-asserting the core services"
				: "Worker reachable, asserting the core services",
		);
		this.#bootId = bootId;
		const settings = await InstanceSettingsDTO.get();
		await DockerService.syncDashboardRouter();
		void syncDashboardDns();
		await DockerService.syncNewt(
			settings.newtCredentials(),
			settings.orchestrationMode === "swarm",
		);
		if (settings.orchestrationMode === "swarm") {
			await DockerService.enableSwarmMode().catch((err) => {
				this.logger.warn("Couldn't re-assert swarm mode on this host", err);
			});
		}
	}
}
