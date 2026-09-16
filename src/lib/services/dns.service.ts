import { config } from "$lib/config";
import { Logger } from "$lib/logger";
import { CloudflareService } from "./cloudflare.service.ts";
import type { DnsSyncResult } from "./dns-result.ts";
import { dashboardHostFrom } from "./docker/dashboard.ts";
import { PangolinService } from "./pangolin.service.ts";

const logger = new Logger("DNS");

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export interface DnsSyncOptions {
	sso?: boolean;
}

const providers = [
	{
		delete: (hostname: string) => CloudflareService.deleteDnsRecord(hostname),
		name: "cloudflare" as const,
		sync: (hostname: string, _opts: DnsSyncOptions) =>
			CloudflareService.syncDnsRecord(hostname, config.baseDomain),
	},
	{
		delete: (hostname: string) => PangolinService.deleteDnsRecord(hostname),
		name: "pangolin" as const,
		sync: (hostname: string, opts: DnsSyncOptions) =>
			PangolinService.syncDnsRecord(hostname, opts),
	},
];

export function serviceHostname(
	slug: string,
	stackSlug: string | null | undefined,
): string {
	const host = stackSlug ? `${stackSlug}-${slug}` : slug;
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
	opts: DnsSyncOptions = {},
): Promise<DnsSyncResult[]> {
	const tasks = providers.flatMap((provider) =>
		hostnames.map((hostname) =>
			(op === "sync"
				? provider.sync(hostname, opts)
				: provider.delete(hostname)
			)
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

export function syncDns(
	hostnames: string[],
	opts: DnsSyncOptions = {},
): Promise<DnsSyncResult[]> {
	return fanOut("sync", hostnames, opts);
}

export function deleteDns(hostnames: string[]): Promise<DnsSyncResult[]> {
	return fanOut("delete", hostnames);
}

export async function syncDashboardDns(): Promise<void> {
	const host = dashboardHostFrom(config.auth.origin ?? null);
	if (!host?.includes(".") || IPV4_RE.test(host)) {
		return;
	}
	const results = await syncDns([host], { sso: false });
	for (const result of results) {
		if (result.ok) {
			logger.info(`Dashboard (${result.provider}): ${result.detail}`);
		} else {
			logger.warn(
				`Dashboard sync failed (${result.provider}): ${result.detail}`,
			);
		}
	}
}
