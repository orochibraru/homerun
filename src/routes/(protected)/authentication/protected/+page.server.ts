import { ServiceDTO } from "$lib/dto/service-dto";

export const load = async ({ parent }) => {
	await parent();
	const services = await ServiceDTO.list();
	return {
		gatedServices: services
			.filter((svc) => svc.authRequired)
			.map((svc) => ({
				id: svc.id,
				methods: svc.authProviders,
				name: svc.name,
			})),
	};
};
