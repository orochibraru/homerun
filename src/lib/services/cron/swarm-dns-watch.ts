import { lookup } from "node:dns/promises";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { NotificationDTO } from "$lib/dto/notification-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { DockerService } from "../docker.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";

const TICK_MS = 5 * 60 * 1000;
export const RESTART_COOLDOWN_MS = 60 * 60 * 1000;

export interface SlugLookup {
	resolved: boolean;
	serviceId: string;
	slug: string;
}

/**
 * The services whose slug alias Docker's DNS lost: the ones that don't
 * resolve, as long as at least one other does. When none resolves, the app
 * itself isn't on the swarm network (dev, or an overlay it wasn't attached
 * to), and restarting everything would fix nothing.
 */
export function lostAliases(lookups: SlugLookup[]): SlugLookup[] {
	if (!lookups.some((entry) => entry.resolved)) {
		return [];
	}
	return lookups.filter((entry) => !entry.resolved);
}

/**
 * Catches a swarm service whose slug stopped resolving on the overlay while
 * the service runs fine: a Docker race when an old task sharing the alias
 * shuts down after the new one registered it, which deletes the alias for
 * good. Every link to it (`redis://…@vortex-redis:6379`) then fails with
 * "not found" while only the full swarm service name still resolves. It
 * force-restarts such a service, which registers the alias again, at most
 * once an hour per service, and says so in the notification feed.
 */
export class SwarmDnsWatch extends BaseScheduler {
	protected readonly label = "SwarmDns";

	protected readonly intervalMs = TICK_MS;

	readonly #lastRestart = new Map<string, number>();

	/** Whether `name` resolves from this process, through Docker's embedded DNS when it runs in a container. */
	protected async resolves(name: string): Promise<boolean> {
		return await lookup(name)
			.then(() => true)
			.catch(() => false);
	}

	/** One pass: resolves every running swarm service's slug and restarts the ones Docker's DNS lost. */
	protected async tick(): Promise<void> {
		const settings = await InstanceSettingsDTO.get();
		if (settings.orchestrationMode !== "swarm") {
			return;
		}
		const services = (await ServiceDTO.listRunningWithContainers()).filter(
			(svc) => svc.swarmServiceId && svc.toJSON().networkMode !== "host",
		);
		const lookups = await Promise.all(
			services.map(async (svc) => ({
				resolved: await this.resolves(svc.slug),
				serviceId: svc.id,
				slug: svc.slug,
			})),
		);
		const now = Date.now();
		for (const lost of lostAliases(lookups)) {
			const last = this.#lastRestart.get(lost.serviceId) ?? 0;
			const svc = services.find((s) => s.id === lost.serviceId);
			if (!svc?.swarmServiceId || now - last < RESTART_COOLDOWN_MS) {
				continue;
			}
			this.#lastRestart.set(lost.serviceId, now);
			this.logger.warn(
				`${lost.slug} no longer resolves on the swarm network: restarting it to register its name again`,
			);
			// oxlint-disable-next-line no-await-in-loop -- one restart at a time, each is a rolling update
			await DockerService.restartSwarmService(svc.swarmServiceId).catch(
				(err) => {
					this.logger.error(`Couldn't restart ${lost.slug}`, err);
				},
			);
			NotificationDTO.notify({
				message: `"${svc.name}" (${lost.slug}) had dropped out of Docker's DNS, so nothing could reach it by name. Homerun restarted it to register the name again.`,
				serviceId: svc.id,
				type: "service_started",
			});
		}
	}
}
