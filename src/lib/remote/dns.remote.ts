import { z } from "zod";
import { query } from "$app/server";
import { DnsConnectionDTO } from "$lib/dto/dns-connection-dto";
import { requireAdmin } from "$lib/server/remote-auth";
import type { DnsZone } from "$lib/services/dns-providers/types";

/** The zones a DNS connection can manage, listed on demand for the add-domain picker: a round-trip to the provider the page shouldn't wait on. */
export const getConnectionZones = query(
	z.string(),
	async (connectionId): Promise<{ error: string | null; zones: DnsZone[] }> => {
		requireAdmin();
		const connection = await DnsConnectionDTO.get(connectionId);
		if (!connection) {
			return { error: "That connection doesn't exist any more.", zones: [] };
		}
		try {
			const zones = await connection.client().listZones();
			return {
				error: null,
				zones: zones.sort((a, b) => a.name.localeCompare(b.name)),
			};
		} catch (err) {
			return {
				error: err instanceof Error ? err.message : String(err),
				zones: [],
			};
		}
	},
);
