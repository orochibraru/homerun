import { CronJobDTO } from "#lib/dto/cron-job-dto.js";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { RemoteHostDTO } from "#lib/dto/remote-host-dto.js";
import { S3DestinationDTO } from "#lib/dto/s3-destination-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { StorageVolumeDTO } from "#lib/dto/storage-volume-dto.js";

export const load = async ({ parent, locals }) => {
	await parent();

	const [
		servicesWithStacks,
		volumes,
		remoteHosts,
		destinations,
		_settings,
		cronJobs,
	] = await Promise.all([
		ServiceDTO.listWithStackNames(),
		StorageVolumeDTO.list(),
		RemoteHostDTO.list(),
		S3DestinationDTO.list(),
		// Instance-wide, only meaningful to show to an admin (see Settings'
		// own admin-only gate); a developer's own cron/backup rows are still
		locals.isAdmin ? InstanceSettingsDTO.get() : null,
		CronJobDTO.list(),
	]);

	const _remoteHostNames = new Map(remoteHosts.map((h) => [h.id, h.name]));
	const destinationNames = new Map(destinations.map((d) => [d.id, d.name]));
	const services = servicesWithStacks.map(({ stackName, service }) => ({
		stackName,
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
