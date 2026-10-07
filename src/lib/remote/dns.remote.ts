import { z } from "zod";
import { DnsConnectionDTO } from "#lib/dto/dns-connection-dto.js";
import { requirePermission } from "#lib/server/remote-auth.js";
import type { DnsZone } from "#lib/services/dns-providers/types.js";
import { query } from "$app/server";

/** The zones a DNS connection can manage, listed on demand for the add-domain picker: a round-trip to the provider the page shouldn't wait on. */
export const getConnectionZones = query(
	z.string(),
	async (connectionId): Promise<{ error: string | null; zones: DnsZone[] }> => {
		requirePermission("dns", "read");
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
