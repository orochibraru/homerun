import { BuildCacheRegistryDTO } from "$lib/dto/build-cache-registry-dto";
import { ServiceDTO } from "$lib/dto/service-dto";

export const load = async () => {
	const registries = await BuildCacheRegistryDTO.list();
	const services = await ServiceDTO.list();
	return {
		registries: registries.map((registry) => registry.toJSON()),
		servicesWithOwnCredentials: services
			.filter((svc) => svc.registryUrl && svc.registryUsername)
			.map((svc) => ({
				id: svc.id,
				name: svc.name,
				registryUrl: svc.registryUrl,
				username: svc.registryUsername,
			})),
	};
};
