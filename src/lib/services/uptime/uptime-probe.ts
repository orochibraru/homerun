import { config } from "$lib/config";
import { ServiceDTO } from "$lib/dto/service-dto";
import { type ProbeResult, UptimeCheckDTO } from "$lib/dto/uptime-check-dto";
import { BaseScheduler } from "../cron/base-scheduler.ts";
import { DockerService } from "../docker.service.ts";

const TIMEOUT_MS = 5000;

/**
 * Two liveness probes per service, every minute:
 *
 * - **internal**: does the container's own port answer on the Docker network?
 *   This is what a sibling service sees, and it fails on a crashed process
 *   inside a container the daemon still calls "running".
 * - **external**: does the hostname Traefik publishes actually answer? This
 *   fails on DNS, on a missing route, on a certificate, on a tunnel that isn't
 *   up — none of which the internal probe can see.
 *
 * Any HTTP response counts as alive, including 401/403 (a service behind the
 * login wall is up, it's just refusing *you*) and 404 (the app answered, it
 * just has no route at `/`). Only a transport-level failure or a timeout is a
 * failure.
 */
export class UptimeProbe extends BaseScheduler {
	protected readonly label = "Uptime";

	protected async tick(): Promise<void> {
		const services = await ServiceDTO.listRunningWithContainers();
		const probes = services
			.filter((svc) => svc.uptimeEnabled)
			.flatMap((svc) => [this.#internal(svc), this.#external(svc)]);
		const results = await Promise.all(probes);
		await Promise.all(
			results.filter((r) => r !== null).map((r) => UptimeCheckDTO.record(r)),
		);
	}

	async #internal(svc: ServiceDTO): Promise<ProbeResult | null> {
		if (!svc.containerId) {
			return null;
		}
		const address = await DockerService.containerAddress(svc.containerId);
		if (!address) {
			return {
				detail: "The container has no address on the Docker network.",
				kind: "internal",
				ok: false,
				serviceId: svc.id,
			};
		}
		return await this.#probe(
			svc.id,
			"internal",
			`http://${address}:${svc.containerPort}/`,
		);
	}

	async #external(svc: ServiceDTO): Promise<ProbeResult | null> {
		if (!svc.dnsResolvable) {
			return null;
		}
		const host = svc.customDomain ?? `${svc.slug}.${config.baseDomain}`;
		const scheme = config.traefik.entrypoint === "web" ? "http" : "https";
		return await this.#probe(svc.id, "external", `${scheme}://${host}/`);
	}

	async #probe(
		serviceId: string,
		kind: "internal" | "external",
		target: string,
	): Promise<ProbeResult> {
		const startedAt = Date.now();
		try {
			const response = await fetch(target, {
				// A self-signed certificate is the normal case behind a tunnel,
				// and a redirect is an answer : neither means "down".
				redirect: "manual",
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			return {
				detail: `HTTP ${response.status}`,
				kind,
				latencyMs: Date.now() - startedAt,
				ok: true,
				serviceId,
				target,
			};
		} catch (err) {
			return {
				detail: err instanceof Error ? err.message : String(err),
				kind,
				latencyMs: Date.now() - startedAt,
				ok: false,
				serviceId,
				target,
			};
		}
	}
}
