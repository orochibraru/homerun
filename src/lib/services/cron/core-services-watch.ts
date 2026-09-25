import {
	applyInstanceSettings,
	config,
	setDetectedAuthCheckUrl,
} from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { WorkerClient } from "$lib/server/worker-client";
import { syncDashboardDns } from "../dns.service.ts";
import type { TraefikExpectation } from "../docker/core-services.ts";
import { DockerService } from "../docker.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";

const TICK_MS = 15_000;

/**
 * Points the login wall's forwardAuth at this dashboard's own container on the
 * Docker network (unless the config file pins the URL), then re-applies the
 * instance settings so it takes effect. Asks the worker, so it does nothing
 * while the worker isn't reachable; the core-services watch calls it again
 * once it is.
 *
 * @returns Whether the dashboard's container was found.
 */
export async function detectAuthCheckUrl(): Promise<boolean> {
	const self = await DockerService.selfContainer().catch(() => null);
	if (!(self?.name && self.networkAddress)) {
		return false;
	}
	setDetectedAuthCheckUrl(
		`http://${self.name}:${config.port}/api/v1/auth-check`,
	);
	const settings = await InstanceSettingsDTO.get();
	applyInstanceSettings(settings.toConfigOverride());
	return true;
}

/** What the running Traefik should be configured with, from the effective settings. */
export function traefikExpectation(swarm: boolean): TraefikExpectation {
	return {
		acmeEmail: config.traefik.acmeEmail ?? null,
		certResolver: config.traefik.certResolver,
		httpCache: config.traefik.httpCache,
		swarm,
	};
}

export class CoreServicesWatch extends BaseScheduler {
	protected readonly label = "CoreServices";

	protected readonly intervalMs = TICK_MS;

	protected readonly runOnStart = true;

	#bootId: string | null = null;

	/**
	 * Polls the worker's health and, whenever its boot id differs from the
	 * last one seen (the first successful contact included), re-asserts the
	 * core services onto it: the forward-auth URL detection, the dashboard's
	 * Traefik router and DNS record, the Newt tunnel, swarm mode when
	 * that's the orchestration mode, and the Traefik flags Settings →
	 * Networking adds (the HTTP cache plugin, the ACME email), which a
	 * `docker compose up --force-recreate` or a self-update wipes by
	 * recreating Traefik from the compose file. So a
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
		await detectAuthCheckUrl();
		const settings = await InstanceSettingsDTO.get();
		await DockerService.syncDashboardRouter();
		void syncDashboardDns();
		await DockerService.syncNewt(
			settings.newtCredentials(),
			settings.orchestrationMode === "swarm",
		);
		const failures = await DockerService.reassertTraefikConfig(
			traefikExpectation(settings.orchestrationMode === "swarm"),
		);
		for (const failure of failures) {
			this.logger.warn(
				`Couldn't re-assert the Traefik configuration: ${failure}`,
			);
		}
	}
}
