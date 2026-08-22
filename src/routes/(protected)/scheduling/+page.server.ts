import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { S3DestinationDTO } from "$lib/dto/s3-destination-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";

export const load = async ({ parent, locals }) => {
	const { user } = await parent();

	const [servicesWithProjects, volumes, remoteHosts, destinations, settings] =
		await Promise.all([
			ServiceDTO.listWithProjectNames(user.id),
			StorageVolumeDTO.list(user.id),
			RemoteHostDTO.list(user.id),
			S3DestinationDTO.list(user.id),
			// Instance-wide, only meaningful to show to an admin (see Settings'
			// own admin-only gate); a developer's own cron/backup rows are still
			// theirs to see regardless, unlike autoscale which is instance config.
			locals.isAdmin ? InstanceSettingsDTO.get() : null,
		]);

	const remoteHostNames = new Map(remoteHosts.map((h) => [h.id, h.name]));
	const destinationNames = new Map(destinations.map((d) => [d.id, d.name]));
	const services = servicesWithProjects.map(({ projectName, service }) => ({
		projectName,
		service: service.toJSON(),
	}));

	const cronServices = services.filter(({ service }) => service.cronEnabled);

	const autoscaleServices = services
		.filter(({ service }) => service.autoscaleEligible)
		.map(({ projectName, service }) => ({
			hostName: service.remoteHostId
				? (remoteHostNames.get(service.remoteHostId) ?? "unknown remote host")
				: "local",
			projectName,
			service,
		}));

	const backupVolumes = volumes
		.filter((v) => v.backupEnabled)
		.map((v) => ({
			destinationName: v.s3DestinationId
				? (destinationNames.get(v.s3DestinationId) ?? "unknown destination")
				: "no destination",
			...v.toJSON(),
		}));

	return {
		autoscale: settings
			? {
					...settings.autoscale,
					overflowHostName: settings.autoscale.autoscaleOverflowRemoteHostId
						? (remoteHostNames.get(
								settings.autoscale.autoscaleOverflowRemoteHostId,
							) ?? "unknown remote host")
						: null,
				}
			: null,
		autoscaleServices,
		backupVolumes,
		cronServices,
		isAdmin: locals.isAdmin,
	};
};
