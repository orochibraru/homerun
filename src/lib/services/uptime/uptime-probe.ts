import { config } from "$lib/config";
import { ServiceDTO } from "$lib/dto/service-dto";
import { type ProbeResult, UptimeCheckDTO } from "$lib/dto/uptime-check-dto";
import { BaseScheduler } from "../cron/base-scheduler.ts";
import { DockerService } from "../docker.service.ts";

const TIMEOUT_MS = 5000;

/** One in this many ticks also prunes, same amortized shape as the stats sampler. */
const PRUNE_EVERY_TICKS = 60;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * Why the external probe can't mean anything for this hostname, or null when
 * it can. A `localhost` base domain is the dev/first-boot default and the
 * "public" hostname then resolves to this machine, so probing it proves
 * nothing about whether anyone else can reach the service : reporting that as
 * an outage would be noise, and reporting it as up would be a lie.
 */
export function externalProbeSkipReason(host: string): string | null {
	const bare = host.split(":")[0]?.toLowerCase() ?? "";
	if (LOOPBACK_HOSTS.has(bare) || bare.endsWith(".localhost")) {
		return `${host} is a loopback address, so there's nothing to reach from outside this machine. Set a real base domain in Settings → General.`;
	}
	return null;
}

/** The hostname a service is published at, or null when it isn't published. */
export function externalHostFor(svc: {
	customDomain: string | null;
	dnsResolvable: boolean;
	slug: string;
}): string | null {
	if (!svc.dnsResolvable) {
		return null;
	}
	return svc.customDomain ?? `${svc.slug}.${config.baseDomain}`;
}

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

	protected readonly runOnStart = true;

	#ticks = 0;

	protected async tick(): Promise<void> {
		this.#ticks += 1;

		const services = await ServiceDTO.listRunningWithContainers();
		const probes = services
			.filter((svc) => svc.uptimeEnabled)
			.flatMap((svc) => [this.#internal(svc), this.#external(svc)]);
		const results = await Promise.all(probes);
		await UptimeCheckDTO.recordMany(results.filter((r) => r !== null));

		if (this.#ticks % PRUNE_EVERY_TICKS === 0) {
			await UptimeCheckDTO.prune();
		}
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
		const host = externalHostFor(svc);
		if (!host || externalProbeSkipReason(host)) {
			return null;
		}
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
