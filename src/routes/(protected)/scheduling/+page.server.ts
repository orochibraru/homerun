import { CronJobDTO } from "$lib/dto/cron-job-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { S3DestinationDTO } from "$lib/dto/s3-destination-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";

export const load = async ({ parent, locals }) => {
	const { user } = await parent();

	const [
		servicesWithProjects,
		volumes,
		remoteHosts,
		destinations,
		_settings,
		cronJobs,
	] = await Promise.all([
		ServiceDTO.listWithProjectNames(user.id),
		StorageVolumeDTO.list(user.id),
		RemoteHostDTO.list(user.id),
		S3DestinationDTO.list(user.id),
		// Instance-wide, only meaningful to show to an admin (see Settings'
		// own admin-only gate); a developer's own cron/backup rows are still
		locals.isAdmin ? InstanceSettingsDTO.get() : null,
		CronJobDTO.list(user.id),
	]);

	const _remoteHostNames = new Map(remoteHosts.map((h) => [h.id, h.name]));
	const destinationNames = new Map(destinations.map((d) => [d.id, d.name]));
	const services = servicesWithProjects.map(({ projectName, service }) => ({
		projectName,
		service: service.toJSON(),
	}));

	const cronServices = services.filter(({ service }) => service.cronEnabled);

	const backupVolumes = volumes
		.filter((v) => v.backupEnabled)
		.map((v) => ({
			destinationName: v.s3DestinationId
				? (destinationNames.get(v.s3DestinationId) ?? "unknown destination")
				: "no destination",
			...v.toJSON(),
		}));

	return {
		backupVolumes,
		cronJobs: cronJobs.filter((j) => j.enabled).map((j) => j.toJSON()),
		cronServices,
		isAdmin: locals.isAdmin,
	};
};
