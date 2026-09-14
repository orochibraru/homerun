import { config } from "$lib/config";
import { CloudflareService } from "./cloudflare.service.ts";
import type { DnsSyncResult } from "./dns-result.ts";
import { PangolinService } from "./pangolin.service.ts";

const providers = [
	{
		delete: (hostname: string) => CloudflareService.deleteDnsRecord(hostname),
		name: "cloudflare" as const,
		sync: (hostname: string) =>
			CloudflareService.syncDnsRecord(hostname, config.baseDomain),
	},
	{
		delete: (hostname: string) => PangolinService.deleteDnsRecord(hostname),
		name: "pangolin" as const,
		sync: (hostname: string) => PangolinService.syncDnsRecord(hostname),
	},
];

export function serviceHostname(
	slug: string,
	projectSlug: string | null | undefined,
): string {
	const host = projectSlug ? `${projectSlug}-${slug}` : slug;
	return `${host}.${config.baseDomain}`;
}

/**
 * Runs every configured provider over every hostname and returns what each
 * one did. A provider that isn't configured returns null and is dropped, so
 * an empty array means "no DNS automation is on", not "nothing happened".
 * Neither provider throws, but a rejection is still reported rather than
 * dropped, since silently swallowing one is the bug this replaced.
 */
async function fanOut(
	op: "delete" | "sync",
	hostnames: string[],
): Promise<DnsSyncResult[]> {
	const tasks = providers.flatMap((provider) =>
		hostnames.map((hostname) =>
			provider[op](hostname)
				.then((result) =>
					result
						? { ...result, detail: `${hostname}: ${result.detail}` }
						: null,
				)
				.catch(
					(err: unknown): DnsSyncResult => ({
						detail: `${hostname}: ${err instanceof Error ? err.message : String(err)}`,
						ok: false,
						provider: provider.name,
					}),
				),
		),
	);
	const results = await Promise.all(tasks);
	return results.filter((result): result is DnsSyncResult => result !== null);
}

export function syncDns(hostnames: string[]): Promise<DnsSyncResult[]> {
	return fanOut("sync", hostnames);
}

export function deleteDns(hostnames: string[]): Promise<DnsSyncResult[]> {
	return fanOut("delete", hostnames);
}
