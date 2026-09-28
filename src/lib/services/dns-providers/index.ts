import { azureDns } from "./azure-dns";
import { cloudflare } from "./cloudflare";
import { desec } from "./desec";
import { digitalocean } from "./digitalocean";
import { dnsimple } from "./dnsimple";
import { gandi } from "./gandi";
import { godaddy } from "./godaddy";
import { googleCloudDns } from "./google-cloud-dns";
import { hetzner } from "./hetzner";
import { linode } from "./linode";
import { namecheap } from "./namecheap";
import { ovh } from "./ovh";
import { porkbun } from "./porkbun";
import { route53 } from "./route53";
import { scaleway } from "./scaleway";
import type { DnsProviderDefinition } from "./types";
import { vultr } from "./vultr";

export const DNS_PROVIDERS: DnsProviderDefinition[] = [
	cloudflare,
	route53,
	googleCloudDns,
	azureDns,
	digitalocean,
	hetzner,
	linode,
	vultr,
	namecheap,
	godaddy,
	porkbun,
	gandi,
	ovh,
	dnsimple,
	desec,
	scaleway,
];

/** The provider definition with this id, null when there's none. */
export function dnsProviderById(id: string): DnsProviderDefinition | null {
	return DNS_PROVIDERS.find((provider) => provider.id === id) ?? null;
}
