import { ServiceDTO } from "$lib/dto/service-dto";

const CACHE_TTL_MS = 10_000;

const globalForGate = globalThis as unknown as {
	__homerun_gate_cache?: Map<
		string,
		{ fetchedAt: number; service: ServiceDTO | null }
	>;
};

function getCache() {
	if (!globalForGate.__homerun_gate_cache) {
		globalForGate.__homerun_gate_cache = new Map();
	}
	return globalForGate.__homerun_gate_cache;
}

export async function gatedService(
	serviceId: string,
): Promise<ServiceDTO | null> {
	const cache = getCache();
	const hit = cache.get(serviceId);
	if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
		return hit.service;
	}
	const service = await ServiceDTO.getForGate(serviceId);
	cache.set(serviceId, { fetchedAt: Date.now(), service });
	return service;
}

export function invalidateGatedService(serviceId: string): void {
	getCache().delete(serviceId);
}
