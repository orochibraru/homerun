import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { DeploymentService } from "../deploy.service.ts";
import { DockerService } from "../docker.service.ts";
import { SystemStatsService } from "../system-stats.service.ts";
import { BaseScheduler } from "./base-scheduler.ts";

/**
 * Migrates one autoscale-eligible service off the local host onto
 * `instanceSettings.autoscaleOverflowRemoteHostId` : the "GCP Cloud Run
 * like" load-shedding behavior: local host over threshold + a service opted
 * in (Compute tab) = move it, don't spin up a second replica (this app's
 * data model is one container per service, not N : see the Network mode
 * section's own precedent for what's realistic to build without a real
 * rearchitecture). Explicitly stops/removes the *old* local container
 * before deploying the new one on the overflow host : `deployService`'s own
 * "replace previous container" logic (`findServiceContainer`) only looks on
 * whichever daemon it's pointed at, so it would never find (and thus never
 * clean up) a container left behind on a *different* host.
 *
 * Untested against a real second host from the session that built this
 * (no second Docker daemon available to migrate a live service across and
 * verify) : composed entirely from already-exercised primitives instead
 * (RemoteHostDTO's own ownership-scoped connectionFor, DockerService's
 * removeContainer against a remote connection, DeploymentService's
 * deployService) rather than new Docker API shapes, which is meaningfully
 * lower-risk than inventing new container-creation mechanics, but still:
 * verify the first real migration by hand.
 */
export class AutoscaleScheduler extends BaseScheduler {
	protected readonly label = "Autoscale";

	private async migrateToOverflow(
		svc: ServiceDTO,
		overflowRemoteHostId: string,
	): Promise<void> {
		this.logger.info(
			`Autoscale migrating service: service=${svc.id} to remoteHost=${overflowRemoteHostId}`,
		);

		// The overflow host must be owned by the same user as the service
		// being migrated : RemoteHostDTO.connectionFor() is ownership-scoped
		// like every other DTO lookup, so a host configured by a different
		// account makes this a safe no-op (logged) rather than a
		// cross-account leak.
		const newHost = await RemoteHostDTO.get(overflowRemoteHostId, svc.userId);
		if (!newHost) {
			this.logger.warn(
				`Autoscale overflow host not visible to service owner, skipping: service=${svc.id} user=${svc.userId} host=${overflowRemoteHostId}`,
			);
			return;
		}

		if (svc.containerId) {
			try {
				// No `remote` arg : this service's containerId is still on
				// the local host at this point, since remoteHostId hasn't
				// been switched yet.
				await DockerService.removeContainer(svc.containerId, {
					force: true,
				});
			} catch (err) {
				this.logger.warn(
					`Couldn't remove old local container before migrating: service=${svc.id}`,
					err,
				);
			}
		}

		await svc.update({ remoteHostId: overflowRemoteHostId });

		const result = await DeploymentService.deployService(svc, svc.userId);
		if (!result.success) {
			this.logger.error(
				`Autoscale migration deploy failed: service=${svc.id}`,
				result.error,
			);
		}
	}

	protected async tick(): Promise<void> {
		const settings = await InstanceSettingsDTO.get();
		const { autoscaleEnabled, autoscaleOverflowRemoteHostId } =
			settings.autoscale;
		if (!(autoscaleEnabled && autoscaleOverflowRemoteHostId)) {
			return;
		}

		const stats = await SystemStatsService.getSystemStats();
		const memPercent =
			stats.memTotalMb > 0 ? (stats.memUsedMb / stats.memTotalMb) * 100 : 0;
		const overCpu =
			stats.cpuPercent > settings.autoscale.autoscaleCpuThresholdPercent;
		const overMem =
			memPercent > settings.autoscale.autoscaleMemoryThresholdPercent;
		if (!(overCpu || overMem)) {
			return;
		}

		const candidates = await ServiceDTO.listAutoscaleEligibleOnLocalHost();
		if (candidates.length === 0) {
			this.logger.warn(
				`Host over threshold (cpu=${stats.cpuPercent.toFixed(1)}% mem=${memPercent.toFixed(
					1,
				)}%) but no autoscale-eligible service to migrate.`,
			);
			return;
		}

		// One migration per tick : re-checks the threshold on the next tick
		// rather than potentially moving several services off the local
		// host at once for a single reading.
		await this.migrateToOverflow(candidates[0], autoscaleOverflowRemoteHostId);
	}
}
