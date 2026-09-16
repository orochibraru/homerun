import { stripAnsi } from "$lib/ansi";
import { config } from "$lib/config";
import { ServiceDTO } from "$lib/dto/service-dto";
import { type ProbeResult, UptimeCheckDTO } from "$lib/dto/uptime-check-dto";
import { isDatabaseImage } from "$lib/service-link";
import { BaseScheduler } from "../cron/base-scheduler.ts";
import { DockerService } from "../docker.service.ts";
import {
	detectTransitions,
	StatusAlertService,
} from "../status-alert.service.ts";

const TIMEOUT_MS = 5000;

/** One in this many ticks also prunes, same amortized shape as the stats sampler. */
const PRUNE_EVERY_TICKS = 60;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

const UNTRUSTED_CERT_NOTE =
	"certificate not trusted (self-signed, or not issued yet)";

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

export type InternalProbeMethod = "healthcheck" | "http" | "tcp";

export function internalProbeMethod(
	image: string,
	hasHealthcheck: boolean,
): InternalProbeMethod {
	if (hasHealthcheck) {
		return "healthcheck";
	}
	return isDatabaseImage(image) ? "tcp" : "http";
}

export function probeErrorMessage(err: unknown): string {
	const raw = err instanceof Error ? err.message : String(err);
	const message = raw.split("For more information")[0]?.trim() || raw;
	if (/timed? ?out|aborted/i.test(message)) {
		return "Timed out.";
	}
	if (/refused|failed to connect/i.test(message)) {
		return "Connection refused.";
	}
	if (/certificate|tls|ssl/i.test(message)) {
		return `TLS failed: ${message}`;
	}
	return message;
}

export function isCertificateError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return /certificate|tls|ssl/i.test(message);
}

const REQUIRED_BY_BUN_CONNECT = () => undefined;

export function tcpConnect(
	host: string,
	port: number,
	timeoutMs: number = TIMEOUT_MS,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error("Timed out."));
		}, timeoutMs);
		let settled = false;
		const settle = (err?: unknown) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			if (err) {
				reject(err instanceof Error ? err : new Error(String(err)));
			} else {
				resolve();
			}
		};
		Bun.connect({
			hostname: host,
			port,
			socket: {
				connectError: (_socket, err) => settle(err),
				data: REQUIRED_BY_BUN_CONNECT,
				error: (_socket, err) => settle(err),
				open: (socket) => {
					socket.end();
					settle();
				},
			},
		}).catch(settle);
	});
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

		const services = (await ServiceDTO.listRunningWithContainers()).filter(
			(svc) => svc.uptimeEnabled,
		);
		const previous = await UptimeCheckDTO.latestByProbe(
			services.map((svc) => svc.id),
		);

		const probes = services.flatMap((svc) => [
			this.#internal(svc),
			this.#external(svc),
		]);
		const results = (await Promise.all(probes)).filter((r) => r !== null);
		await UptimeCheckDTO.recordMany(results);

		const transitions = detectTransitions(previous, results);
		if (transitions.length > 0) {
			await StatusAlertService.dispatch(
				transitions,
				new Map(
					services.map((svc) => [svc.id, { host: externalHostFor(svc), svc }]),
				),
			);
		}

		if (this.#ticks % PRUNE_EVERY_TICKS === 0) {
			await UptimeCheckDTO.prune();
		}
	}

	async #internal(svc: ServiceDTO): Promise<ProbeResult | null> {
		if (!svc.containerId) {
			return null;
		}

		const health = await DockerService.containerHealth(svc.containerId);
		const method = internalProbeMethod(svc.image, health !== null);
		if (method === "healthcheck" && health) {
			const output = health.output ? stripAnsi(health.output).trim() : "";
			return {
				detail: `Healthcheck: ${health.status}${output ? ` · ${output.slice(0, 120)}` : ""}`,
				kind: "internal",
				ok: health.status !== "unhealthy",
				serviceId: svc.id,
				target: "docker healthcheck",
			};
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

		return method === "tcp"
			? await this.#tcpProbe(svc.id, address, svc.containerPort)
			: await this.#probe(
					svc.id,
					"internal",
					`http://${address}:${svc.containerPort}/`,
				);
	}

	async #tcpProbe(
		serviceId: string,
		host: string,
		port: number,
	): Promise<ProbeResult> {
		const startedAt = Date.now();
		const target = `tcp://${host}:${port}`;
		try {
			await tcpConnect(host, port);
			return {
				detail: "Port accepting connections",
				kind: "internal",
				latencyMs: Date.now() - startedAt,
				ok: true,
				serviceId,
				target,
			};
		} catch (err) {
			return {
				detail: probeErrorMessage(err),
				kind: "internal",
				latencyMs: Date.now() - startedAt,
				ok: false,
				serviceId,
				target,
			};
		}
	}

	async #external(svc: ServiceDTO): Promise<ProbeResult | null> {
		const host = externalHostFor(svc);
		if (!host || externalProbeSkipReason(host)) {
			return null;
		}
		const scheme = config.traefik.entrypoint === "web" ? "http" : "https";
		return await this.#probe(svc.id, "external", `${scheme}://${host}/`);
	}

	#request(target: string, verifyTls: boolean): Promise<Response> {
		return fetch(target, {
			// A redirect is an answer, not a failure.
			redirect: "manual",
			signal: AbortSignal.timeout(TIMEOUT_MS),
			tls: { rejectUnauthorized: verifyTls },
		});
	}

	async #probe(
		serviceId: string,
		kind: "internal" | "external",
		target: string,
	): Promise<ProbeResult> {
		const startedAt = Date.now();
		const failure = (err: unknown): ProbeResult => ({
			detail: probeErrorMessage(err),
			kind,
			latencyMs: Date.now() - startedAt,
			ok: false,
			serviceId,
			target,
		});

		try {
			const response = await this.#request(target, true);
			return {
				detail: `HTTP ${response.status}`,
				kind,
				latencyMs: Date.now() - startedAt,
				ok: true,
				serviceId,
				target,
			};
		} catch (err) {
			if (!isCertificateError(err)) {
				return failure(err);
			}
			try {
				const response = await this.#request(target, false);
				return {
					detail: `HTTP ${response.status} · ${UNTRUSTED_CERT_NOTE}`,
					kind,
					latencyMs: Date.now() - startedAt,
					ok: true,
					serviceId,
					target,
				};
			} catch (retryErr) {
				return failure(retryErr);
			}
		}
	}
}
