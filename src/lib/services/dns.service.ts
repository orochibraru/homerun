import { config } from "$lib/config";
import { CloudflareService } from "./cloudflare.service.ts";
import { PangolinService } from "./pangolin.service.ts";

const providers = [
	{
		delete: (hostname: string) => CloudflareService.deleteDnsRecord(hostname),
		sync: (hostname: string) =>
			CloudflareService.syncDnsRecord(hostname, config.baseDomain),
	},
	{
		delete: (hostname: string) => PangolinService.deleteDnsRecord(hostname),
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

function fanOut(op: "delete" | "sync", hostname: string): void {
	for (const provider of providers) {
		provider[op](hostname).catch(() => undefined);
	}
}

export function syncDns(hostname: string): void {
	fanOut("sync", hostname);
}

export function deleteDns(hostname: string): void {
	fanOut("delete", hostname);
}
